// electron/services/HindsightManager.ts
//
// Hosted de produção para o servidor opcional de memória de longo prazo Hindsight
//
// O servidor Hindsight é Python + um Postgres embarcado + modelo de embedding HuggingFace —
// pesado demais para empacotar dentro do app Electron assinado. Então, exatamente como Ollama
// (OllamaManager) e Codex CLI (codexCliEnabled/codexCliPath), é tratado como um
// SIDECAR OPCIONAL FORNECIDO PELO USUÁRIO: o app verifica sua integridade e degrada para Noop
// se não estiver rodando. Dois destinos suportados, mesmo código/caminho:
//   • Local  — o usuário executa `bash scripts/hindsight-start.sh` (ou `pip install hindsight-all`
//              + o servidor) e aponta o baseUrl para http://localhost:8888.
//   • Cloud  — o usuário cola o baseUrl + apiKey do Hindsight Cloud.
//
// Configuração via settings + health-gating em cache: os caminhos retain/recall verificam
// isAvailable(), então o servidor em execução (local ou Cloud) funciona em build empacotado —
// a configuração vem do SettingsManager, não apenas de variáveis de ambiente shell. Auto-spawn
// É implementado: quando a flag memory está ligada + o baseUrl está configurado + o servidor
// não está saudável + o hindsightServerCommand está definido (autoStart padrão ligado), inicia
// o servidor (desanexado, morto em grupo ao sair via stopSync) e faz polling para prontidão.
// Cloud / servidor executado pelo usuário permanece saudável → não inicia.
//
// Encaminhamento de credenciais LLM: ao iniciar o servidor local, buildCredentialEnv() lê o
// CredentialsManager e mapeia todas as chaves de provedores de IA configuradas para as
// variáveis de ambiente que hindsight-start.sh + hindsight-llm-config.mjs esperam. Esta é a
// ÚNICA forma do app empacotado encaminhar chaves — o CredentialsManager criptografa-as em
// repouso e elas nunca ficam no process.env. O filho herda process.env MAIS essas chaves
// injetadas; o script shell então constrói a cadeia litellm.Router com qualquer subconjunto
// que esteja presente.

import type { HindsightConfig } from '../intelligence/memory/HindsightClientAdapter';
import type { ChildProcess } from 'child_process';

interface SettingsLike {
  get(key: string): unknown;
}

const HEALTH_TIMEOUT_MS = 1000;       // corresponde a OllamaManager.checkIsRunning
const AVAILABILITY_TTL_MS = 30_000;   // cache de health para que chamadas retain/recall sejam baratas
const SPAWN_POLL_INTERVAL_MS = 5000;  // polling para prontidão (como OllamaManager)
const SPAWN_MAX_ATTEMPTS = 36;        // 36 * 5s = 180s (primeiro boot baixa modelos de embedding)

export class HindsightManager {
  private static instance: HindsightManager | null = null;
  static getInstance(): HindsightManager {
    if (!HindsightManager.instance) HindsightManager.instance = new HindsightManager();
    return HindsightManager.instance;
  }

  /** Cached health result + quando it era taken. */
  private lastHealthy = false;
  private lastCheckedAt = 0;
  /** True apenas quando WE spawned o server (so we kill it on quit). A user-run ou Cloud
   *  server is nunca app-managed e is esquerda running. */
  private isAppManaged = false;
  private serverProcess: ChildProcess | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private spawnAttempts = 0;

  /** Lê SettingsManager de forma lazy — evita ciclo de importação forçado + funciona headless (retorna null). */
  private settings(): SettingsLike | null {
    try {
      const { SettingsManager } = require('./SettingsManager');
      return SettingsManager.getInstance();
    } catch {
      return null;
    }
  }

  /**
   * Resolve a configuração do Hindsight: env (dev) tem precedência sobre a configuração
   * persistida (app empacotado). Retorna null quando nenhum baseUrl está configurado
   * (→ recurso desligado).
   */
  getHindsightConfig(): HindsightConfig | null {
    try {
      const s = this.settings();
      const baseUrl = (process.env.HINDSIGHT_BASE_URL
        || (s?.get('hindsightBaseUrl') as string | undefined)
        || '').trim();
      if (!baseUrl) return null;
      const apiKey = (process.env.HINDSIGHT_API_KEY
        || (s?.get('hindsightApiKey') as string | undefined)
        || '').trim() || undefined;
      const timeoutMs = Number(process.env.HINDSIGHT_TIMEOUT_MS) || 800;
      return { baseUrl, apiKey, timeoutMs };
    } catch {
      return null;
    }
  }

  /**
   * ID de escopo de memória estável por instalação. Usado como `userId` do Hindsight para que
   * o banco/tags sejam únicos para ESTA instalação. Importante para o caminho Cloud: duas
   * instalações diferentes que apontam para a mesma conta Cloud escritariam ambas no banco
   * `user_local` com tags idênticas e MERGIRIAM as memórias uma da outra. Derivado do UUID
   * de instalação persistido (getOrCreateInstallId). Volta para 'local' se indisponível
   * (caminho local-only é single-user então a constante é segura lá).
   */
  private _localUserId: string | null = null;
  localUserId(): string {
    if (this._localUserId) return this._localUserId;
    try {
      const { getOrCreateInstallId } = require('./InstallPingManager');
      const id = String(getOrCreateInstallId() || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
      this._localUserId = id ? `local_${id}` : 'local';
    } catch {
      this._localUserId = 'local';
    }
    return this._localUserId;
  }

  /** Obtém <baseUrl>/health com timeout de 1s. Retorna falso em qualquer erro/timeout. */
  async healthCheck(): Promise<boolean> {
    const cfg = this.getHindsightConfig();
    if (!cfg) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const headers: Record<string, string> = {};
      if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
      const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/health`, {
        signal: controller.signal,
        headers,
      });
      clearTimeout(timer);
      const ok = res.ok;
      this.lastHealthy = ok;
      this.lastCheckedAt = Date.now();
      return ok;
    } catch {
      this.lastHealthy = false;
      this.lastCheckedAt = Date.now();
      return false;
    }
  }

  /**
   * Gate barato para os caminhos retain/recall: o baseUrl está configurado E uma verificação
   * de health recente passou. Cacheia por AVAILABILITY_TTL_MS para que chamá-lo por resposta
   * seja gratuito; inicia re-verificação em background quando obsoleto (nunca bloqueia o
   * chamador). Retorna o valor em cache imediatamente — chamadores que precisam de um
   * resultado fresco aguardam healthCheck() diretamente.
   */
  isAvailable(): boolean {
    if (!this.getHindsightConfig()) return false;
    // Inicialização fria ainda não verificou health (ex: init não executou / completou).
    // Ser OTIMISTA — retorna verdadeiro e inicia a verificação. Pior caso é um recall para
    // o servidor abaixo (já limitado por timeout); a alternativa (retornar false) pularia
    // incorretamente o recall para o servidor configurado+saudável na primeira pergunta
    // após o lançamento.
    if (this.lastCheckedAt === 0) { void this.healthCheck(); return true; }
    const stale = Date.now() - this.lastCheckedAt > AVAILABILITY_TTL_MS;
    if (stale) { void this.healthCheck(); } // fire-and-forget ratualiza nunca awaited aqui
    return this.lastHealthy;
  }

  /** A flag de recurso memory está habilitada? (lê fresco, nunca lança erro.) */
  private memoryFlagOn(): boolean {
    try {
      const { isIntelligenceFlagEnabled } = require('../intelligence/intelligenceFlags');
      return Boolean(isIntelligenceFlagEnabled('hindsightMemory'));
    } catch {
      return false;
    }
  }

  /** Devemos iniciar automaticamente o servidor local? Resolve o comando de lançamento + alternância autoStart */
  private autoStartCommand(): string | null {
    try {
      const s = this.settings();
      // Default Em (auto-start-when-installed, por o design) a menos que explicitly disabled.
      const autoStart = (s?.get('hindsightAutoStart') as boolean | undefined) ?? true;
      if (!autoStart) return null;
      const cmd = (process.env.HINDSIGHT_SERVER_COMMAND
        || (s?.get('hindsightServerCommand') as string | undefined)
        || '').trim();
      return cmd || null;
    } catch {
      return null;
    }
  }

  /**
   * Hook de inicialização. Prepara o cache de health; se a flag memory está ligada, o baseUrl
   * está configurado, o servidor NÃO está saudável e um comando de auto-start está definido,
   * inicia-o (auto-start-when-installed, como OllamaManager) e faz polling para prontidão.
   * Nunca bloqueia a inicialização, nunca lança erro. Sem efeito quando não configurado /
   * flag desligada / Cloud (Cloud já está saudável então não inicia).
   */
  async start(): Promise<void> {
    try {
      const cfg = this.getHindsightConfig();
      if (!cfg) return;                 // não baseUrl → feature ofora stay Noop
      if (!this.memoryFlagOn()) return; // flag fora → don't gerencia qualquer coisa

      const healthy = await this.healthCheck();
      if (healthy) {
        console.log('[HindsightManager] server already running — connecting (not app-managed).', { baseUrl: cfg.baseUrl });
        this.isAppManaged = false;
        return;
      }

      const cmd = this.autoStartCommand();
      if (!cmd) {
        console.log('[HindsightManager] server not running + auto-start off/unset — staying Noop until a server appears.', { baseUrl: cfg.baseUrl });
        return;
      }

      console.log('[HindsightManager] server not detected — auto-starting:', cmd);
      this.spawnServer(cmd);
      this.pollUntilReady();
    } catch (e: any) {
      console.warn('[HindsightManager] start skipped (non-fatal):', e?.message);
    }
  }

  /**
   * Constrói o ambiente que o processo filho do servidor Hindsight deve ver.
   *
   * O app empacotado nunca expõe credenciais do usuário no process.env — elas ficam no
   * CredentialsManager (criptografadas em disco). Este método lê todas as chaves de
   * provedores de IA configuradas e as mapeia para as variáveis de ambiente padrão que
   * hindsight-llm-config.mjs (e transitoriamente litellm) espera. O resultado é mesclado
   * com process.env para que o filho receba o ambiente completo MAIS as substituições
   * de credenciais.
   *
   * Prioridade dos provedores espelha hindsight-llm-config.mjs:
   *   Gemini → OpenAI → Anthropic → DeepSeek → Groq → LiteLLM gateway → Ollama
   *
   * Nunca lança erro — um CredentialsManager ausente (ex: ambiente de teste) é
   * silenciosamente tratado e o filho volta para os padrões das variáveis de ambiente
   * (caminho .env de dev).
   */
  private buildCredentialEnv(): Record<string, string> {
    const extra: Record<string, string> = {};
    try {
      const { CredentialsManager } = require('./CredentialsManager') as typeof import('./CredentialsManager');
      const cm = CredentialsManager.getInstance();

      const gemini = cm.getGeminiApiKey();
      if (gemini) extra.GEMINI_API_KEY = gemini;

      const openai = cm.getOpenaiApiKey();
      if (openai) extra.OPENAI_API_KEY = openai;

      const claude = cm.getClaudeApiKey();
      if (claude) extra.ANTHROPIC_API_KEY = claude;

      const deepseek = cm.getDeepseekApiKey();
      if (deepseek) extra.DEEPSEEK_API_KEY = deepseek;

      const groq = cm.getGroqApiKey();
      if (groq) extra.GROQ_API_KEY = groq;

      // Gateway LiteLLM — tratado como um endpoint compatível com OpenAI. O script shell
      // passa OPENAI_API_KEY para litellm; OPENAI_API_BASE redireciona chamadas para o gateway.
      // Aplicado apenas quando a URL base está configurada (chave sozinha é sem sentido sem URL).
      const litellmUrl = cm.getLitellmBaseURL();
      if (litellmUrl?.trim()) {
        extra.OPENAI_API_BASE = litellmUrl.trim();
        // Preferir a chave explícita do LiteLLM, voltar para a chave OpenAI já definida acima
        const litellmKey = cm.getLitellmApiKey();
        if (litellmKey) extra.OPENAI_API_KEY = litellmKey;
        // Proteger: se nenhuma chave está presente, litellm ainda precisa de uma string não-vazia
        if (!extra.OPENAI_API_KEY) extra.OPENAI_API_KEY = 'refract-gateway';
      }

      // Ollama — não usa chave de API, sinaliza disponibilidade via flag de habilitação e
      // passa a URL base. LLMHelper sempre usa 127.0.0.1:11434 como padrão quando OLLAMA_URL
      // não está definido; espelhar isso.
      const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
      // Habilitar Ollama para Hindsight apenas quando o app está usando ativamente (evitar
      // forçar um modelo local pesado quando o usuário tem chaves cloud configuradas).
      try {
        const { llmHelper } = require('../LLMHelper') as { llmHelper: { isUsingOllama(): boolean } };
        if (llmHelper?.isUsingOllama?.()) {
          extra.HINDSIGHT_LLM_ENABLE_OLLAMA = 'true';
          extra.HINDSIGHT_LLM_OLLAMA_BASE = ollamaUrl;
        }
      } catch { /* LLMHelper não disponível ainda — pular Ollama */ }
    } catch (e: any) {
      console.warn('[HindsightManager] buildCredentialEnv: could not read CredentialsManager (non-fatal):', e?.message);
    }

    if (Object.keys(extra).length > 0) {
      const providerList = Object.keys(extra)
        .filter((k) => k.endsWith('_API_KEY') || k === 'HINDSIGHT_LLM_ENABLE_OLLAMA')
        .map((k) => k.replace('_API_KEY', '').replace('HINDSIGHT_LLM_ENABLE_', '').toLowerCase())
        .join(', ');
      console.log(`[HindsightManager] credential env: forwarding providers → ${providerList || 'none'}`);
    } else {
      console.warn('[HindsightManager] credential env: no provider keys found — Hindsight server will fall back to its own env defaults');
    }

    return extra;
  }

  /** Inicia o comando de servidor configurado (forma shell, como `bash scripts/hindsight-start.sh`).
   *  Degrada graciosamente em erro ("python/script não encontrado") — app não é afetado. */
  private spawnServer(command: string): void {
    try {
      const { spawn } = require('child_process') as typeof import('child_process');
      this.isAppManaged = true;
      // Forma shell para que comandos com múltiplos tokens (`bash scripts/...`) funcionem
      // entre plataformas. detached:true no POSIX coloca o servidor em seu próprio grupo de
      // processos para que ao sair possamos matar sincronicamente toda a árvore (Python +
      // workers Postgres embarcados, que re-parent/daemonize) com um `process.kill(-pid)`
      // dentro do before-quit — tree-kill é assíncrono e o app pode sair antes que finalize,
      // órfãos do Postgres. (Windows não tem grupos de processos; voltamos para taskkill /T
      // em stopSync.)

      const isWin = process.platform === 'win32';
      this.serverProcess = spawn(command, {
        shell: true,
        detached: !isWin,   // próprio processo agrupar em POSIX para group-kill em quit
        windowsHide: true,
        stdio: 'ignore',
        cwd: process.cwd(),
        // Encaminhar credenciais do CredentialsManager para o env do filho para que o
        // app empacotado não precise de .env ou exportação manual de GEMINI_API_KEY.
        // O script shell (hindsight-start.sh) pega essas e constrói o router litellm.
        env: { ...process.env, ...this.buildCredentialEnv() },
      });
      // Não deixar o filho desanexado manter o loop de eventos do pai ativo.
      this.serverProcess.unref?.();
      this.serverProcess.on('error', (err: any) => {
        console.error('[HindsightManager] failed to start server (is it installed?):', err?.message);
        this.isAppManaged = false;
        this.serverProcess = null;
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
      });
      this.serverProcess.on('close', (code: number | null) => {
        console.log('[HindsightManager] server process exited', { code });
        this.serverProcess = null;
      });
    } catch (e: any) {
      console.error('[HindsightManager] exception spawning server:', e?.message);
      this.isAppManaged = false;
    }
  }

  /** Faz polling em /health a cada 5s por até ~3min (primeiro boot baixa modelos de embedding). */
  private pollUntilReady(): void {
    // Proteger contra intervalo vazado se pollUntilReady já foi chamado duas vezes (ex:
    // uma segunda inicialização futura limpa qualquer anterior antes de armazenar a nova.
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    this.spawnAttempts = 0;
    this.pollInterval = setInterval(async () => {
      this.spawnAttempts++;
      const healthy = await this.healthCheck();
      if (healthy) {
        console.log(`[HindsightManager] server ready after ~${this.spawnAttempts * 5}s`);
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
        return;
      }
      if (this.spawnAttempts >= SPAWN_MAX_ATTEMPTS) {
        console.warn('[HindsightManager] timeout waiting for server — staying Noop. Check the install / command.');
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
      }
    }, SPAWN_POLL_INTERVAL_MS);
    this.pollInterval.unref?.(); // nunca manter o processo ativo por causa disso
  }

  /**
   * Hook de saída SINCRônO. Mata a árvore do servidor APENAS se NÓS o iniciamos (um servidor
   * executado pelo usuário ou Cloud permanece intocado). Deve ser síncrono: o manipulador
   * `before-quit` pode permitir que o app saia antes que qualquer trabalho assíncrono
   * (tree-kill) complete, órfãos da árvore Python+Postgres. Como o servidor foi iniciado
   * desanexado (seu próprio grupo de processos no POSIX), um `process.kill(-pid, SIGKILL)`
   * mata todo o grupo imediatamente. Nunca lança erro.
   */
  stopSync(): void {
    try {
      if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
      if (!this.isAppManaged || !this.serverProcess?.pid) return;
      const pid = this.serverProcess.pid;
      if (process.platform === 'win32') {
        // Sem grupos de processos no Windows — taskkill na árvore sincronamente.
        try {
          require('child_process').execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } catch { try { process.kill(pid); } catch { /* gone */ } }
      } else {
        // PID negativo → mata todo o grupo de processos (servidor + workers Postgres).
        try { process.kill(-pid, 'SIGKILL'); }
        catch { try { process.kill(pid, 'SIGKILL'); } catch { /* já encerrado */ } }
      }
      this.serverProcess = null;
      this.isAppManaged = false;
      console.log('[HindsightManager] app-managed server tree terminated on quit.');
    } catch (e: any) {
      console.warn('[HindsightManager] stopSync skipped (non-fatal):', e?.message);
    }
  }

  /** Wrapper assíncrono mantido para compatibilidade de API / chamadores não-quit. Delega para stopSync. */
  async stop(): Promise<void> {
    this.stopSync();
  }
}
