# Análise Técnica — Refract v2.8.0

**Data:** 2026-09-04
**Commit analisado:** `ff50c8b` (`refactor: rename natively-browser to refract-browser (rebrand)`)
**Ambiente de medição:** Linux, Node 22.22.3, `npm install --ignore-scripts` (mesma estratégia do CI)

> Todos os números de build/teste abaixo foram **medidos neste workspace**, não copiados de documentação.

---

## 1. O que é o projeto

Refract é um **aplicativo desktop Electron** (macOS/Windows/Linux) que funciona como um "copiloto de IA" para reuniões e entrevistas ao vivo: captura áudio do sistema e do microfone em canais separados, transcreve em tempo real, mantém contexto rolante e gera respostas/sugestões numa sobreposição invisível.

Proposta de valor declarada no README:

- **Privacidade por arquitetura** — transcrição, embeddings e chaves ficam na máquina; traga sua própria chave (BYOK) ou rode 100% offline com Ollama.
- **<500 ms de latência** via captura de áudio nativa em Rust com transferência zero-copy.
- **Modo stealth** — esconde do dock, disfarça o nome do processo, invisível em compartilhamento de tela.
- **Código publicado para auditoria** (licença *source-available*, **não** open source).

Posicionamento competitivo: alternativa gratuita e local a Cluely, Final Round AI, LockedIn AI, Interview Coder.

**Escala declarada no README:** 9.000+ usuários, 700+ DAU.

---

## 2. Radiografia do repositório

| Métrica | Valor |
|---|---|
| Arquivos versionados | **1.343** |
| Arquivos de código | 890 |
| Linhas TypeScript/TSX | **142.674** |
| Linhas Rust | 4.935 |
| Linhas de Markdown (108 docs) | **29.273** |
| Arquivos de teste | 402 |
| Binários versionados (png/icns/fontes/vídeo) | **83 MB** |
| Tamanho do `.git` | 63 MB |
| Histórico Git | **1 commit** (clone shallow) |
| Release atual | v2.8.0 |

### Onde está o código

| Diretório | LOC (TS/TSX) | Papel |
|---|---|---|
| `src/components` | 36.936 | Renderer React 19 (overlay, dashboard, settings) |
| `electron/services` | 22.266 | Modos, reuniões, tela, telemetria, billing, Codex, phone mirror |
| `electron/llm` | 20.252 | Planejador de resposta, WTA, provedores, verificação de código |
| `electron/audio` | 8.064 | 8 provedores de STT + captura |
| `electron/intelligence` | 4.394 | "Intelligence OS" — flags, roteador, fusão, memória |
| `electron/rag` | 4.212 | Embeddings + `sqlite-vec` |
| `electron/db` | 2.166 | SQLite |
| `native-module/src` | 4.935 (Rust) | Áudio nativo, VAD, stealth, licença |

**Distribuição de tamanho de arquivo:** mediana 182 linhas, p90 693 — saudável. O problema está concentrado numa cauda curta e muito longa.

---

## 3. Arquitetura

```
┌─ native-module/ (Rust · napi-rs · cdylib) ──────────────────────────┐
│  cpal / ScreenCaptureKit (macOS) / WASAPI (Win)  → captura de áudio  │
│  rubato resampler · webrtc-vad · silence_suppression                │
│  keyboard_tap.rs (CGEventTap) · stealth_window.rs (objc2/AppKit)    │
│  process_name.rs (disfarce) · license.rs (machine-uid + sha2)       │
│  → napi::Buffer zero-copy para o Node                               │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌─ electron/ (main process · CommonJS · esbuild) ─────────────────────┐
│  main.ts ................. AppState (6.425 linhas, orquestra tudo)  │
│  ipcHandlers.ts .......... 8.079 linhas de handlers IPC             │
│  preload.ts .............. contextBridge, 443 métodos expostos      │
│  LLMHelper.ts ............ roteamento multi-provedor (6.410)        │
│  ├─ audio/    8 provedores STT (Whisper local, OpenAI, Deepgram,    │
│  │            ElevenLabs, Google, Soniox, Rest, RefractPro)         │
│  ├─ llm/      AnswerPlanner → WhatToAnswer → providers + judge      │
│  ├─ intelligence/  flags, ContextRouter, ContextFusionEngine,       │
│  │                 PromptAssemblerV2, memória, métricas             │
│  ├─ rag/      sqlite-vec + embeddings locais                        │
│  └─ services/ modes, meeting, screen, telemetry, billing, Codex,    │
│               PhoneMirror, Hindsight, LemonSqueezy/Dodo             │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ contextBridge (isolado)
┌─ src/ (renderer · React 19 + Vite + Tailwind) ──────────────────────┐
│  RefractInterface.tsx (6.566) · SettingsOverlay (3.135) · dashboard  │
└─────────────────────────────────────────────────────────────────────┘

Satélites:
  refract-browser/     extensão Chrome MV3 (WebSocket loopback + token)
  lemonsqueezy-server/ servidor de billing/relay STT (Node + Docker/fly)
  renderer/            scaffold CRA morto (React 18 + react-scripts)
  landing/             site
```

**Decisões arquiteturais boas:**

- Rust na fronteira de áudio com zero-copy real (`bytemuck` reinterpreta `&[i16]` → `&[u8]`), evitando pressão de GC do V8.
- `contextIsolation: true` + `nodeIntegration: false` em **todas** as `BrowserWindow`.
- Separação de canais (sistema vs. microfone) com pipelines distintos.
- `electron/intelligence/` foi construído inteiramente **flag-gated, default OFF** — dá para ligar feature por feature e fazer rollback instantâneo.
- RAG local com `sqlite-vec`, sem serviço externo.

---

## 4. Estado real de build e testes (medido)

| Gate | Resultado |
|---|---|
| `tsc --noEmit` (renderer, `strict: true`) | ✅ **0 erros** |
| `npm run typecheck:electron` | ✅ **0 erros** — mas o tsconfig do electron **não é `strict`** (só `noImplicitAny`) |
| `npx vite build` | ✅ 11,4 s — chunk principal **2,11 MB** (600 kB gzip), sem code-splitting |
| `npm run build:electron` | ✅ 7,6 s — **após o commit `b0d1c7a`** (antes: ❌ falha, ver §5.1) |
| Testes renderer | ✅ **135/135** |
| Testes LLM | 2.304 → ✅ 2.263 / ❌ 22 / 16 skip / 3 cancelados |
| Testes intelligence | 508 → ✅ 471 / ❌ 28 / 9 todo |
| Testes services | ~1.471 → ✅ 1.237 / ❌ 234 — e **um arquivo trava o runner** |

> **Nota metodológica:** os testes rodam contra `dist-electron/` (saída do build), não contra o fonte. Sem o binário do Electron no ambiente, 38 arquivos de teste falham com `Electron failed to install correctly`; medi com `ELECTRON_OVERRIDE_DIST_PATH` apontando para um stub para isolar as falhas reais.

---

## 5. Problemas encontrados (priorizados)

### P0 — Bloqueantes

#### 5.1 O repositório publicado não compila

> **✅ RESOLVIDO em 2026-09-05 (commit `b0d1c7a`).** `scripts/build-electron.js`
> agora marca os requires relativos de `premium/` como externos no esbuild, então o
> build passa com ou sem o submódulo. Os efeitos colaterais descritos abaixo
> (CI vermelho, tier bloqueante nunca executando, billing quebrado) também foram
> resolvidos — o CI está verde. **O que permanece:** os módulos proprietários em si
> (licenciamento, busca em conhecimento, pesquisa de empresa) continuam inexistentes,
> então as features premium seguem degradando para o fallback open-source. Ver §5.1.1.

```
✘ [ERROR] Could not resolve "../../premium/electron/services/LicenseManager"
    electron/services/PurchaseActivationService.ts:422:55
[build-electron] Build failed
```

`premium/` é um **submódulo Git** apontando para `https://github.com/Natively-AI-assistant/natively-premium.git`, que hoje retorna:

```
remote: Repository not found.
```

Impacto medido:

- **102 referências** a `premium/` no código, **34 sites de `require()`**, **9 módulos distintos**: `LicenseManager`, `KnowledgeOrchestrator`, `KnowledgeDatabaseManager`, `NegotiationConversationTracker`, `RefractSearchProvider`, `TavilySearchProvider`, `CompanyResearchEngine`, `IntentClassifier`, `types`.
- Sem eles, **o build falha**. Criei um stub mínimo com os 9 módulos → o build passou em 10,2 s. Ou seja: **o único bloqueio é a ausência do submódulo**.
- ~10 arquivos de teste do tier `services` (incluindo `InterviewerPerspectiveEval`, 90 falhas) dependem do `KnowledgeOrchestrator` real e **não podem passar** sem ele.

**Isso corrói diretamente a promessa central do README**: "o código é publicado para você auditar". Justamente os módulos de licenciamento e de conhecimento/perfil — os mais sensíveis do ponto de vista de privacidade — estão fora do que é auditável.

##### 5.1.1 O que a correção resolve e o que deixa em aberto

O commit `b0d1c7a` adiciona um plugin `onResolve` ao esbuild que marca os requires
relativos (`../premium/…`, `../../premium/…`) como externos. O `require()` é emitido
literalmente no bundle e resolvido em tempo de execução:

| Cenário | Comportamento | Verificado |
|---|---|---|
| Submódulo **presente** | Os arquivos compilam para `dist-electron/premium/…`, os caminhos relativos casam, `isPremiumAvailable()` → `true` | ✅ com árvore stub |
| Submódulo **ausente** | O `require()` lança e cai no `try/catch` que todos os 34 call sites já têm, `isPremiumAvailable()` → `false` | ✅ |

**Resolvido:** build quebrado, CI vermelho, tier bloqueante do CI que nunca executava,
e o bloqueio mecânico sobre o billing.

**Ainda em aberto** — e é o que realmente importa:

- Os **9 módulos continuam sem existir**. Licenciamento, `KnowledgeOrchestrator`,
  pesquisa de empresa e provedores de busca seguem degradando para o fallback
  open-source. O produto compila; as features premium não funcionam.
- `PurchaseActivationService` e `LemonSqueezyManager` dependem de `LicenseManager`.
  Compilar não é o mesmo que conseguir ativar uma licença — **é necessário decidir se
  o `LicenseManager` volta a existir, onde, e sob qual licença.**
- ~10 arquivos de teste do tier `services` (incluindo `InterviewerPerspectiveEval`,
  90 falhas) dependem do `KnowledgeOrchestrator` real e seguem falhando.
- A pergunta de auditoria do parágrafo acima continua de pé.

#### 5.2 O CI é majoritariamente decorativo

> **🟡 PARCIALMENTE RESOLVIDO em 2026-09-05 (commit `b0d1c7a`).** `typecheck:electron`
> foi promovido a blocking (mede 0 erros, a nota antiga de "14 erros" estava
> desatualizada) e o build não quebra mais, então **o tier bloqueante do renderer
> finalmente executa** — o CI está verde. **O que permanece:** os tiers de LLM e
> intelligence seguem `continue-on-error` (têm falhas reais), o tier de services não
> roda, e continua sendo Linux-only.

`.github/workflows/ci.yml`:

| Tier | Status (antes) | Status (2026-09-05) |
|---|---|---|
| Renderer typecheck + testes | ✅ blocking | ✅ blocking |
| `typecheck:electron` | ⚠️ `continue-on-error` | ✅ **blocking** |
| Build electron | ❌ quebrava o job | ✅ ok |
| Testes LLM | ⚠️ `continue-on-error` | ⚠️ `continue-on-error` |
| Testes intelligence | ⚠️ `continue-on-error` | ⚠️ `continue-on-error` |
| Testes services | ❌ **não roda** | ❌ **não roda** |

- 2 de 3 tiers de teste não podem reprovar um PR.
- **Só roda em `ubuntu-latest`** — sendo um app desktop cujo core é Rust + APIs nativas de macOS/Windows, não há matriz de plataforma.
- O cabeçalho do CI dizia "typecheck:electron = 14 erros pré-existentes". Medido: **0 erros**. O comentário estava desatualizado e induzia quem revisa a ignorar um gate que funciona — corrigido e promovido a blocking.
- O próprio cabeçalho admite que o tier de services "pendura o runner" — confirmei: `IntelligenceEngineScreenContext` não termina.

### P1 — Qualidade e risco técnico

#### 5.3 God objects

| Arquivo | Linhas |
|---|---|
| `electron/ipcHandlers.ts` | 8.079 |
| `src/components/RefractInterface.tsx` | 6.566 |
| `electron/main.ts` (`AppState`) | 6.425 |
| `electron/LLMHelper.ts` | 6.410 |
| `electron/preload.ts` | 2.694 (**443 métodos** expostos ao renderer) |

`ipcHandlers.ts` com 8 mil linhas e `preload.ts` com 443 bridges são, juntos, a superfície de ataque e o gargalo de manutenção do projeto. Qualquer auditoria de segurança real precisa ler esses dois arquivos inteiros.

#### 5.4 Não existe lint

- **Zero** arquivo de configuração de ESLint/Prettier/Biome na raiz, apesar de `@typescript-eslint/*` estar nas devDependencies.
- **1.489 ocorrências** de `: any`, `as any`, `@ts-ignore`, `@ts-expect-error` ou `eslint-disable` em `electron/` + `src/`.
  Concentração: `ipcHandlers.ts` (310), `preload.ts` (162), `LLMHelper.ts` (129), `RefractInterface.tsx` (70).
- O typecheck do electron não é `strict` (só `noImplicitAny`) — o "0 erros" é mais fraco do que parece.
- O typecheck do renderer **é** `strict: true`, mas `include: ["src", "premium/src"]` — e `premium/` não existe, então metade do escopo é fantasma.

#### 5.5 Testes frágeis e suíte que não fecha

- Muitos testes são **"wiring pins"**: leem o arquivo `.ts` com regex e afirmam que certo texto existe no fonte. Qualquer refatoramento cosmético quebra.
- `IntelligenceFlags.test.mjs` espera 24 flags; o código tem **34**. Falha como bug, mas é teste congelado — o comportamento de runtime está correto.
- Os testes dependem do build (`dist-electron/`), então `npm test` sem `build:electron` testa código velho.
- Tier `services`: **234 falhas**, parte dependente do submódulo ausente, parte real (ex.: `TranscriptAwareIntentRouting` 12 falhas, `ProfileFactualRecallProductionPath` 14).
- Um arquivo (`IntelligenceEngineScreenContext`) **trava** o runner — o CI simplesmente desistiu de rodar a suíte.

### P2 — Higiene, produto e identidade

#### 5.6 Rebrand inacabado e contradições de autoria

O projeto é um rebrand de "Natively" → "Refract", e a transição está pela metade:

- **65 arquivos** de código ainda contêm `natively`/`Natively`/`NATIVELY`.
- `.gitmodules` aponta para `Natively-AI-assistant/natively-premium` (inexistente).
- `docs/engineering/NATIVELY_CLUELY_PARITY_*.md`, `docs/LOCAL_STT_NATIVELY_SETUP.md`, `assets/natively.icns` (2 MB).
- **Autoria conflitante:** `LICENSE` diz "Copyright (c) 2026 Davi (davifisica671-afk)"; `package.json` diz `"author": "João Lucas"`; `README.md` credita `@joaolucas` como lead developer e aponta para `Refract-AI-assistant/refract`; `appId` é `com.joaolucas.refract`.
- **Licença conflitante:** a raiz é *source-available* ("não é open source"), mas `refract-browser/package.json` declara `"license": "AGPL-3.0-only"` e o `CONTRIBUTING.md` chama o projeto de "open source project". Uma extensão AGPL dentro de um repo cuja licença proíbe redistribuição é uma contradição jurídica que precisa ser resolvida.
- `publish` no `package.json` aponta para `owner: joaolucas, repo: refract`, que não é o remote deste clone.

#### 5.7 Comentários corrompidos por tradução automática

`scripts/translate-comments.mjs` (1.726 linhas) é um tradutor EN→PT-BR por dicionário que foi **executado sobre o código**. Exemplos reais no fonte:

```js
// electron/CropperWindowHelper.ts:274
* Pre-creates o janela in hidden estado para eliminate cold-start delay.

// electron/main.ts:6134
// doesn't tear abaixo audio em ltravar então we don't inscrever para it.

// electron/intelligence/intelligenceFlags.ts
// Default Fora → atual pcaminho
```

Boa parte dos comentários ficou em "portunhol" ilegível — às vez mais difícil de entender que o original em inglês. **Verifiquei que o dano está confinado a comentários**: identificadores e strings de UI estão intactos (`let para = []` em `phoneMirrorClient.ts` é "paragraph", não tradução). Ainda assim, é dívida de legibilidade em ~140 mil linhas, num projeto que se vende como auditável.

#### 5.8 Peso do repositório

- **83 MB de binários versionados**: 4 cópias idênticas do mesmo `.icns` de 2,2 MB (`assets/icon.icns`, `assets/refract.icns`, `assets/icons/mac/icon.icns`, `src/icons/AppIcon.icns`) + `assets/natively.icns`; `src/font/Inter-4.1/Inter.ttc` sozinho tem **13 MB**; 154 arquivos em `src/font`.
- Lixo na raiz: `meetily.md` (325 KB), `termsandcondition.md` (44 KB), `report.md`, `refund.md`, `perssua-full-screenshot.png` (494 KB), `perssua-html.txt`, e um `vite.config.mts.timestamp-*.mjs` de 0 bytes.
- `renderer/` é um scaffold CRA (React 18 + react-scripts) que duplica o papel de `src/` e não é referenciado por nenhum script da raiz — candidato óbvio a remoção.

#### 5.9 Superfície de segurança a auditar

Pontos **positivos** verificados: `contextIsolation: true` e `nodeIntegration: false` em todas as janelas; nenhum segredo real no código (só fixtures com `sk-abcdef...`); o `sqliteDb.exec()` em `ipcHandlers.ts` usa SQL estático, sem concatenação de entrada do renderer.

Pontos **a verificar/corrigir**:

- `sandbox` não está explicitamente `true` nas `BrowserWindow` — hoje depende do default do Electron.
- `webSecurity: !isDev` desliga a segurança web em desenvolvimento.
- `main.ts` faz **monkey-patch global de `dns.lookup`** para forçar IPv4 em `api.refract.software`. É um hack de processo inteiro e frágil; a causa raiz (resolução IPv6) deveria ser tratada no servidor/DNS.
- O preload expõe **incondicionalmente** `__evalInjectTranscript` → canal `test-inject-transcript`, inerte apenas porque o handler checa `NODE_ENV === 'test'`. Vale mover para trás de uma flag de build.
- `openExternal` está exposto ao renderer (precisa de allowlist de domínios no handler — não auditei a fundo).
- `scripts/patch-electron-plist.js` roda no `postinstall` e altera o `Info.plist` do Electron — vale revisar o que ele faz.

#### 5.10 Produto e estratégia

- **`ROADMAP.md` está defasado**: lista "Persona System" como *Planned/Medium*, mas o `CHANGELOG` 2.7.0 já entrega "Profile Intelligence Router v2" e o README anuncia 7 personas. Última atualização: março/2026.
- **`PHASE_STATUS.md`** documenta 21 fases de um "Intelligence OS" como completas — mas **todas as 16+ flags estão default OFF**. São ~4,4 mil linhas de código novo que não estão ligadas em produção. Sem um plano de rollout com datas, isso vira código morto.
- **Risco de plataforma**: stealth mode (keyboard tap, disfarce de processo, evasão do Activity Monitor) é o principal argumento de marketing e também o principal risco — viola políticas de proctoring e de lojas de aplicativo, e é um imã para remoção/processo.
- **Contradição de narrativa**: o README ataca concorrentes por "guardar seus dados em servidores", enquanto o produto tem `api.refract.software` (18 referências), relay STT próprio, servidor de billing e integração com PostHog. A telemetria é descrita como "anônima e limitada", mas `posthog-js` está nas dependências — vale documentar exatamente o que sai da máquina.

---

## 6. O que o projeto faz bem

1. **Engineered de verdade, não um wrapper de API** — Rust na fronteira de áudio com zero-copy, VAD, resampler e supressão de silêncio é diferenciais real.
2. **Disciplina de feature flags** em `electron/intelligence/`: 34 flags, default OFF, snapshot dinâmico, ordem de rollout documentada, rollback instantâneo. É engenharia de lançamento séria.
3. **Cultura de evidência**: 402 arquivos de teste, `PHASE_STATUS.md` com resultados medidos por fase, latências medidas com números (ex.: `getLiveWindow` 0,012 ms), e honestidade explícita quando uma fase revelou que o sistema "já estava pronto".
4. **Isolamento de processo correto** em todas as janelas Electron.
5. **Arquitetura de privacidade coerente**: STT 100% local (ONNX + CoreML/DirectML), RAG com `sqlite-vec`, BYOK, modo offline com Ollama.
6. **Extensão de browser bem pensada**: o service worker é o único componente que guarda o token de pareamento; o content script (que roda na página não confiável) nunca o recebe.

---

## 7. Recomendações

### Imediatas (esta semana)

1. ~~**Resolver o bloqueio do build.**~~ — ✅ **FEITO** (`b0d1c7a`), via opção **(b)**: os 34
   `require('.../premium/...')` agora são externos no esbuild e tolerantes à ausência.
   **Restam as decisões de produto:** as opções (a) e (c) seguem abertas — é preciso
   decidir se o `LicenseManager` volta a existir e onde, porque compilar não é o mesmo
   que conseguir ativar uma licença. Até lá, o billing não funciona de verdade e a
   promessa de "auditável" do README continua parcial.
2. ~~**Tornar o CI honesto**: promover `typecheck:electron` a blocking~~ — ✅ **FEITO**
   (`b0d1c7a`). Falta: matrix `macos-latest` + `windows-latest`, e promover os tiers de
   LLM e intelligence quando as falhas conhecidas forem zeradas.
3. **Corrigir as contradições de licença**: decidir se `refract-browser/` é AGPL ou segue a licença da raiz, e alinhar `CONTRIBUTING.md`.

### Curto prazo (1 mês)

4. **Adicionar ESLint + Prettier** (as deps já estão lá) com regra de não-regressão em `any`, e ligar `strict: true` no `tsconfig` do electron.
5. **Zerar ou isolar o tier de services**: colocar timeout por arquivo, quarentenar `IntelligenceEngineScreenContext` (que hoje trava o runner) e separar os testes que dependem de `premium/` numa suíte marcada como "requer submódulo".
6. **Desacoplar testes do build**: rodar `node:test` contra o fonte (via loader de TS) ou, no mínimo, fazer `build:electron` ser pré-requisito explícito e falhar rápido.
7. **Atualizar `ROADMAP.md`** para refletir o que já foi entregue, e publicar um plano de rollout com datas para as flags do Intelligence OS.

### Médio prazo (trimestre)

8. **Quebrar os god objects**: extrair `ipcHandlers.ts` por domínio (já existe o padrão em `services/LemonSqueezeIpc.ts`, `RoleTwinIpc.ts` — basta aplicá-lo), e reduzir `RefractInterface.tsx`.
9. **Code-splitting no renderer**: o chunk de 2,11 MB é a primeira carga do overlay; `framer-motion`, `three`, `katex` e `jspdf` são candidatos a lazy loading.
10. **Limpar o repositório**: `git-lfs` (ou `git filter-repo`) para os 83 MB de binários, deduplicar os `.icns`, remover `renderer/`, `meetily.md`, `perssua-*`, `report.md`, `refund.md` e o arquivo `.timestamp` de 0 bytes.
11. **Reverter a tradução automática** nos arquivos mais críticos (`main.ts`, `ipcHandlers.ts`, `intelligence/*`) ou, no mínimo, aposentar `scripts/translate-comments.mjs`.
12. **Documentar a telemetria**: publicar a lista exata de eventos PostHog e o que o relay STT recebe. Numa categoria onde o concorrente sofreu um vazamento de 83 mil usuários, isso é vantagem competitiva — e hoje está subaproveitado.

---

## 8. Veredito

O Refract é um projeto **substancial e competentemente construído** — 142 mil linhas de TypeScript, 5 mil de Rust, arquitetura de áudio nativa genuína, disciplina de feature flags e uma cultura de testes e medição acima da média para projetos desse porte.

Mas ele tem uma **fratura estrutural na proposta**: vende-se como "auditável e privado" enquanto (a) os módulos mais sensíveis — licenciamento e conhecimento/perfil — vivem num submódulo inacessível, e (b) tem 3 de 4 suítes de teste marcadas como `continue-on-error` num CI que só roda Linux para um app desktop multiplataforma. Somado a 8 mil linhas num único arquivo de IPC, ausência total de lint e 83 MB de binários duplicados, o resultado é um código que **inspira menos confiança do que merece** — exatamente o oposto do que o posicionamento exige.

**Atualização 2026-09-05 (commit `b0d1c7a`):** o build quebrado e o `typecheck:electron`
em modo advisory foram corrigidos, e o CI está verde pela primeira vez — o tier
bloqueante agora executa. Dois dos três itens "imediatos" acima estão resolvidos no
aspecto mecânico. O que **não** mudou: o `LicenseManager` continua não existindo, então
o billing segue sem funcionar de verdade, e a pergunta de auditoria continua de pé.
Build verde é pré-requisito, não solução.
