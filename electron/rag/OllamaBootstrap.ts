/**
 * @file OllamaBootstrap.ts
 * @description Inicializador do daemon Ollama para embeddings locais.
 * Verifica se o Ollama está em execução, tenta iniciá-lo via shell se necessário,
 * verifica se modelos estão disponíveis e realiza o download com streaming
 * de progresso. Mantém estado de pull no banco de dados para resiliência
 * entre reinicializações do aplicativo.
 */

import { spawn } from 'child_process';
import { DatabaseManager } from '../db/DatabaseManager';

/** Inicializador do daemon Ollama para gerenciamento de modelos de embedding */
export class OllamaBootstrap {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  /** Verifica se o daemon Ollama está acessível */
  async isOllamaRunning(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { 
        signal: AbortSignal.timeout(2000) 
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Tenta iniciar o daemon Ollama via shell e aguarda ficar disponível */
  async ensureOllamaRunning(): Promise<boolean> {
    if (await this.isOllamaRunning()) return true;
    
    // Tentar para inicia it
    try {
      const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
      child.on('error', (err) => {
        console.error('[OllamaBootstrap] Failed to spawn ollama (not installed?):', err);
      });
      child.unref();
    } catch (e) {
      console.error('[OllamaBootstrap] Synchronous error spawning ollama:', e);
      return false;
    }
    
    // Aguardar para cima para 5 seconds para it para come para cima
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await this.isOllamaRunning()) return true;
    }
    return false;
  }

  /** Verifica se um modelo específico já foi baixado (pulled) */
  async isModelPulled(model: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      const data = await res.json();
      return data.models?.some((m: any) => m.name.startsWith(model)) ?? false;
    } catch {
      return false;
    }
  }

  /** Baixa (pull) um modelo com streaming de progresso */
  async pullModel(
    model: string,
    onProgress: (status: string, percent: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    // FIX (P1-3): Encapsular com a hard tempo limite então a stalled Ollama HTTP stream
    // doesn't hang o caller indefinitely.
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 10 * 60 * 1000); // 10 min

    // Mescla external sinal com nosso tempo limite sinal
    const effectiveSignal = (() => {
      if (!signal) return timeoutController.signal;
      const merged = new AbortController();
      const abort = () => merged.abort();
      signal.addEventListener('abort', abort, { once: true });
      timeoutController.signal.addEventListener('abort', abort, { once: true });
      return merged.signal;
    })();

    try {
      const res = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: true }),
        signal: effectiveSignal,
      });

      if (!res.ok) throw new Error(`Ollama pull failed: ${res.statusText}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const lines = decoder.decode(value).split('\n').filter(Boolean);

          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event.total && event.completed) {
                const percent = Math.round((event.completed / event.total) * 100);
                onProgress(event.status ?? 'downloading', percent);
              } else if (event.status) {
                onProgress(event.status, 0);
              }
            } catch {
              // Partial JSON line — ignorar
            }
          }
        }
      } finally {
        // Sempre release o reader ltravar até em AbortError, preventing
        // o underlying conexão de sendo held abrir indefinitely.
        reader.cancel().catch(() => { /* ignorar cancelar errors */ });
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Sequência completa de bootstrap: verifica daemon, modelo e baixa se necessário */
  async bootstrap(
    model = 'nomic-embed-text',
    onProgress: (status: string, percent: number) => void
  ): Promise<'not_running' | 'already_pulled' | 'pulled' | 'failed' | 'in_progress'> {
    
    const db = DatabaseManager.getInstance();
    const status = db.getAppState('ollama_pull_status');
    
    if (status === 'complete') {
        // Duplo verifica contra daemon apenas em case user deleted it manually
        const pulled = await this.isModelPulled(model);
        if (pulled) return 'already_pulled';
    }

    const running = await this.ensureOllamaRunning();
    if (!running) return 'not_running';

    const pulled = await this.isModelPulled(model);
    if (pulled) {
        db.setAppState('ollama_pull_status', 'complete');
        return 'already_pulled';
    }

    try {
      db.setAppState('ollama_pull_status', 'in_progress');
      onProgress('starting download', 0);
      
      await this.pullModel(model, onProgress);
      
      onProgress('ready', 100);
      db.setAppState('ollama_pull_status', 'complete');
      return 'pulled';
    } catch (err: any) {
      console.error('[OllamaBootstrap] Pull failed:', err.message);
      db.setAppState('ollama_pull_status', 'failed');
      return 'failed';
    }
  }
}
