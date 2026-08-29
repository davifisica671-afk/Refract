/**
 * @file LocalEmbeddingProvider.ts
 * @description Provedor de embedding local usando o modelo MiniLM-L6-v2 via transformers.js.
 * Executa 100% offline no dispositivo, sem necessidade de API externa.
 * Utiliza 384 dimensões e suporta embeddings simétricos. O modelo é carregado
 * de forma preguiçosa (lazy) na primeira chamada de embedding para não
 * bloquear a inicialização do aplicativo.
 */

// @huggingface/transformers é ESM-only — precisa uso dynamic imimportar
import path from 'path';
import { app } from 'electron';
import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

/** Provedor de embedding local usando MiniLM-L6-v2 via transformers.js (384d) */
export class LocalEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'local';
  readonly dimensions = 384; // all-MiniLM-L6-v2
  readonly model = 'Xenova/all-MiniLM-L6-v2';
  readonly space: string;

  private pipe: any = null;
  private loadingPromise: Promise<void> | null = null; // previne concurrent init races
  private modelPath: string;

  constructor() {
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
    // Point para o bundled modelo dentro o app's resources.
    // Em dev: uso app.getAppPath() então o caminho é independent de como esbuild
    // bundles isso arquivo (bundle: verdadeiro inlines o provedor dentro de main.js, que
    // makes __dirname-relative paths fragile).
    // Em prod: app.isPackaged = verdadeiro → uso process.resourcesPath (electron-builder extraResources).
    this.modelPath = path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
      'models'
    );
  }

  /** Verifica se o modelo local pode ser carregado */
  async isAvailable(): Promise<boolean> {
    // Local modelo é Sempre disponível após install — isso é o guarantee
    try {
      await this.ensureLoaded();
      return true;
    } catch (e) {
      console.error('[LocalEmbeddingProvider] Model failed to load:', e);
      return false;
    }
  }

  /** Carrega o modelo de forma preguiçosa (lazy) na primeira chamada */
  private async ensureLoaded(): Promise<void> {
    if (this.pipe) return;

    // If outro caller já kicked fora loading, aguardar para que mesmo promise
    // em vez than launching a segundo concurrent pipeline() call.
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    this.loadingPromise = (async () => {
      // Uso novo FuFunção para force a verdadeiro ESM dynamic importar at runtime.
      // TypeScript com module:commonjs rewrites `await import(...)` to
      // `Promise.resolve().then(() => require(...))`, que fails para ESM-only
      // packages como @huggingface/transformers. O novo FuFunção trick é opaque
      // para o TypeScript compiler então it é esquerda como a real imimportar call.
      const { pipeline, env } = await (new Function('return import("@huggingface/transformers")')()) as any;

      // Tell transformers.js para uso o local pcaminho nunca download em production
      env.allowRemoteModels = false;
      env.localModelPath = this.modelPath;

      this.pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        local_files_only: true,
      });
    })();

    try {
      await this.loadingPromise;
    } catch (e) {
      // Reinicia então a future chamar pode tentar novamente
      this.loadingPromise = null;
      throw e;
    }
  }

  /** Gera embedding de um texto */
  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();
    const output = await this.pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  /** Gera embedding de consulta (simétrico, mesmo formato que documento) */
  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text); // all-MiniLM-L6-v2 é symmetric
  }

  /** Gera embeddings em lote (transformers.js gerencia batching internamente) */
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();
    // transformers.js gerencia batching internally
    const output = await this.pipe(texts, { pooling: 'mean', normalize: true });
    // output.data é flat [n * 384], reshape it
    const batchSize = texts.length;
    const result: number[][] = [];
    for (let i = 0; i < batchSize; i++) {
      result.push(Array.from(output.data.slice(i * this.dimensions, (i + 1) * this.dimensions)));
    }
    return result;
  }
}
