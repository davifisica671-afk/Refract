/**
 * codeAssistantHandlers.ts — coding-assistant code:* IPC.
 *
 * Explain / generate / review / refactor / test code via the LLM-backed
 * CodeAssistantEngine, streaming tokens back to the renderer over
 * `code-stream-token`. `code:flags` exposes the intelligence feature-flag
 * snapshot to the renderer.
 */
import type { AppState } from '../main';
import type { SafeHandle } from './safeIpc';

export function registerCodeAssistantHandlers(appState: AppState, safeHandle: SafeHandle): void {
  safeHandle('code:explain', async (event, code: string, language: string) => {
    try {
      const { CodeAssistantEngine } = require('../code-assistant/CodeAssistantEngine');
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      console.log('[code:explain] llmHelper:', !!llmHelper);
      if (!llmHelper) throw new Error('LLM not available');
      const engine = new CodeAssistantEngine(llmHelper);
      const tokens: string[] = [];
      for await (const token of engine.explain(code, language)) {
        tokens.push(token);
        event.sender.send('code-stream-token', token);
      }
      return { success: true, result: tokens.join('') };
    } catch (err: any) {
      console.error('[IPC] code:explain failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('code:generate', async (event, description: string, language: string) => {
    try {
      const { CodeAssistantEngine } = require('../code-assistant/CodeAssistantEngine');
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (!llmHelper) throw new Error('LLM not available');
      const engine = new CodeAssistantEngine(llmHelper);
      const tokens: string[] = [];
      for await (const token of engine.generate(description, language)) {
        tokens.push(token);
        event.sender.send('code-stream-token', token);
      }
      return { success: true, result: tokens.join('') };
    } catch (err: any) {
      console.error('[IPC] code:generate failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('code:review', async (event, code: string, language: string) => {
    try {
      const { CodeAssistantEngine } = require('../code-assistant/CodeAssistantEngine');
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (!llmHelper) throw new Error('LLM not available');
      const engine = new CodeAssistantEngine(llmHelper);
      const tokens: string[] = [];
      for await (const token of engine.review(code, language)) {
        tokens.push(token);
        event.sender.send('code-stream-token', token);
      }
      return { success: true, result: tokens.join('') };
    } catch (err: any) {
      console.error('[IPC] code:review failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('code:refactor', async (event, code: string, language: string, target: string) => {
    try {
      const { CodeAssistantEngine } = require('../code-assistant/CodeAssistantEngine');
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (!llmHelper) throw new Error('LLM not available');
      const engine = new CodeAssistantEngine(llmHelper);
      const tokens: string[] = [];
      for await (const token of engine.refactor(code, language, target)) {
        tokens.push(token);
        event.sender.send('code-stream-token', token);
      }
      return { success: true, result: tokens.join('') };
    } catch (err: any) {
      console.error('[IPC] code:refactor failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('code:test', async (event, code: string, language: string, framework?: string) => {
    try {
      const { CodeAssistantEngine } = require('../code-assistant/CodeAssistantEngine');
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (!llmHelper) throw new Error('LLM not available');
      const engine = new CodeAssistantEngine(llmHelper);
      const tokens: string[] = [];
      for await (const token of engine.generateTests(code, language, framework)) {
        tokens.push(token);
        event.sender.send('code-stream-token', token);
      }
      return { success: true, result: tokens.join('') };
    } catch (err: any) {
      console.error('[IPC] code:test failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('code:flags', async () => {
    try {
      const { intelligenceFlagSnapshot } = require('../intelligence/intelligenceFlags');
      return { success: true, flags: intelligenceFlagSnapshot() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
