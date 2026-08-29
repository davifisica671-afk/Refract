// electron/services/screen/ImageOptimizer.ts
//
// Sharp-based imagem optimizer para vision-provider payloads.
//
// Responsibilities:
//   - redimensionar screenshots então long-edge é bounded (default 1280px; technical 1536px; fast 1024px)
//   - re-encode PNG → JPEG (ou WebP) com quality 78–88 para shrink base64 payloads
//   - strip EXIF/metadata
//   - enforce a hard max byte cap então we nunca blow past provedor corpo limits
//   - escreve o optimized copiar para an app-owned temp dir, retorna caminho + stats
//   - keep a pequeno in-memory cache keyed por `${imageHash}|${profile}` então o mesmo
//     screenshot é não re-encoded twice em o mesmo sessão
//
// Notes:
//   - Sharp é já a project dep (used elsewhere para OCR preprocessing and
//     Refract-API imagem compression). We centralize provider-ready optimization
//     aqui então o vision pipeline tem a único fonte de truth para sizes/quality.
//   - We fazer Não exclui optimized files imediatamente — VisionProviderFallbackChain
//     pode tentar novamente o mesmo payload através providers em one rrequisição Callers deve
//     invocar `cleanup()` após o requisição ccompleta ou rely em `cleanupAll()`
//     at meeting etermina

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

export type OptimizationProfile = 'fast' | 'balanced' | 'technical' | 'best';
export type ProviderHint =
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'groq'
  | 'ollama'
  | 'refract'
  | 'codex'
  | 'custom'
  | 'generic';

export interface OptimizeOptions {
  profile?: OptimizationProfile;          // default 'balanced'
  provider?: ProviderHint;                // tweaks formata and quality
  maxLongEdgePx?: number;                 // sobrescrever perfil default
  format?: 'jpeg' | 'webp' | 'png';       // sobrescrever perfil default
  quality?: number;                       // sobrescrever perfil default (jpeg/webp)
  maxBytes?: number;                      // hard cap; default 3.5 MB
  cacheKey?: string;                      // tipicamente o perceptual hash
}

export interface OptimizedImage {
  path: string;
  buffer?: Buffer;                        // populated quando caller asks via getBuffer()
  mimeType: 'image/jpeg' | 'image/webp' | 'image/png';
  width: number;
  height: number;
  byteSize: number;
  originalWidth: number;
  originalHeight: number;
  originalByteSize: number;
  durationMs: number;
  profile: OptimizationProfile;
  provider: ProviderHint;
  cacheHit: boolean;
}

// Perfil defaults — tuned para vision LLM quality vs payload size.
const PROFILE_DEFAULTS: Record<OptimizationProfile, { maxLongEdgePx: number; quality: number; format: 'jpeg' | 'webp' | 'png' }> = {
  fast:      { maxLongEdgePx: 1024, quality: 78, format: 'jpeg' },
  balanced:  { maxLongEdgePx: 1280, quality: 85, format: 'jpeg' },
  technical: { maxLongEdgePx: 1536, quality: 88, format: 'jpeg' }, // code text needs clarity
  best:      { maxLongEdgePx: 1920, quality: 90, format: 'jpeg' },
};

// Provedor sobrescreve — apenas quando a provedor tem known stricter constraints.
function applyProviderTweaks(
  provider: ProviderHint,
  base: { maxLongEdgePx: number; quality: number; format: 'jpeg' | 'webp' | 'png' },
): { maxLongEdgePx: number; quality: number; format: 'jpeg' | 'webp' | 'png' } {
  switch (provider) {
    case 'ollama':
      // Local — keep buffer reasonable então base64 payload doesn't choke HTTP.
      return { ...base, format: 'jpeg' };
    case 'refract':
      // Servidor enforces a 4 MB corpo cap; o per-image quality bump used em
      // streamWithRefract (q=85, 1920px) é consistent com o 'best' pperfil
      return base;
    case 'gemini':
    case 'openai':
    case 'claude':
    case 'groq':
    case 'codex':
    case 'custom':
    case 'generic':
    default:
      return base;
  }
}

const DEFAULT_MAX_BYTES = 3.5 * 1024 * 1024; // 3.5 MB safety margin sob maioria provedor limits

export class ImageOptimizer {
  private tempDir: string;
  private cache = new Map<string, OptimizedImage>();
  // Files we próprio e pode precisa para clean upara cima Keyed por cacheKey então we don't double-write.
  private ownedFiles = new Map<string, string>();

  constructor(tempDirOverride?: string) {
    this.tempDir = tempDirOverride || path.join(os.tmpdir(), 'refract-vision-optimized');
  }

  async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
    }
  }

  /**
   * Optimize an imagem para a específico vision provider. Returns an OptimizedImage
   * pointing para a temp file. Caller may re-use isso caminho across múltiplos provider
   * attempts dentro o mesmo vision-fallback request.
   */
  async optimize(sourcePath: string, opts: OptimizeOptions = {}): Promise<OptimizedImage> {
    const started = Date.now();
    const profile: OptimizationProfile = opts.profile || 'balanced';
    const provider: ProviderHint = opts.provider || 'generic';

    const baseDefaults = PROFILE_DEFAULTS[profile];
    const tuned = applyProviderTweaks(provider, baseDefaults);
    const maxLongEdgePx = opts.maxLongEdgePx ?? tuned.maxLongEdgePx;
    const format = opts.format ?? tuned.format;
    const quality = opts.quality ?? tuned.quality;
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const cacheKey = opts.cacheKey ? `${opts.cacheKey}|${profile}|${provider}|${maxLongEdgePx}|${format}|${quality}` : undefined;

    if (cacheKey && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return { ...cached, cacheHit: true };
    }

    await this.ensureTempDir();

    let originalStats: { size: number };
    try {
      originalStats = await fs.stat(sourcePath);
    } catch (err: any) {
      throw new Error(`ImageOptimizer: cannot stat source image: ${err?.message || err}`);
    }

    const pipeline = sharp(sourcePath, { failOnError: false });
    const metadata = await pipeline.metadata();
    const originalWidth = metadata.width ?? 0;
    const originalHeight = metadata.height ?? 0;

    // Resize apenas se necessário (Sharp's `withoutEnlargement` keeps pequeno images intact).
    const resized = pipeline.resize({
      width: maxLongEdgePx,
      height: maxLongEdgePx,
      fit: 'inside',
      withoutEnlargement: true,
    }).rotate(); // honor EXIF orientation antes metadados é stripped

    // Codificar com selected fformata We sempre strip metadados via `withMetadata({})`
    // não sendo chamado (Sharp drops metadados por padrão a menos que asked para keep it).
    let encoded;
    let mimeType: OptimizedImage['mimeType'];
    let effectiveQuality = quality;

    // We pode precisa para dial quality abaixo para honor maxBytes. Permitir para cima para 3 attempts.
    let attempt = 0;
    let buffer: Buffer;
    let outputWidth = 0;
    let outputHeight = 0;

    while (true) {
      switch (format) {
        case 'webp':
          encoded = resized.clone().webp({ quality: effectiveQuality, effort: 4 });
          mimeType = 'image/webp';
          break;
        case 'png':
          encoded = resized.clone().png({ compressionLevel: 8, palette: false });
          mimeType = 'image/png';
          break;
        case 'jpeg':
        default:
          encoded = resized.clone().jpeg({
            quality: effectiveQuality,
            mozjpeg: true,
            chromaSubsampling: '4:2:0',
          });
          mimeType = 'image/jpeg';
          break;
      }

      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
      buffer = data;
      outputWidth = info.width;
      outputHeight = info.height;

      if (buffer.byteLength <= maxBytes || attempt >= 2 || format === 'png') break;
      // Soltar quality 10 points e rtentar novamente
      effectiveQuality = Math.max(60, effectiveQuality - 10);
      attempt++;
    }

    // Determine saída extensão de chosen fformata
    const ext = format === 'jpeg' ? 'jpg' : format;
    const outPath = path.join(this.tempDir, `${uuidv4()}.${ext}`);
    await fs.writeFile(outPath, buffer);

    const result: OptimizedImage = {
      path: outPath,
      mimeType,
      width: outputWidth,
      height: outputHeight,
      byteSize: buffer.byteLength,
      originalWidth,
      originalHeight,
      originalByteSize: originalStats.size,
      durationMs: Date.now() - started,
      profile,
      provider,
      cacheHit: false,
    };

    if (cacheKey) {
      this.cache.set(cacheKey, result);
      this.ownedFiles.set(cacheKey, outPath);
    }

    return result;
  }

  /**
   * Read o optimized imagem bytes (used quando a provider expects base64 in-band).
   * Caller decides whether para base64-encode; we retornar o raw buffer.
   */
  async getBuffer(optimized: OptimizedImage): Promise<Buffer> {
    if (optimized.buffer) return optimized.buffer;
    return await fs.readFile(optimized.path);
  }

  /**
   * Read o optimized imagem as base64 (no `data:` prefix).
   */
  async getBase64(optimized: OptimizedImage): Promise<string> {
    const buf = await this.getBuffer(optimized);
    return buf.toString('base64');
  }

  /**
   * Read o optimized imagem as a `data:` URL (suitable para OpenAI/Ollama image_url).
   */
  async getDataUrl(optimized: OptimizedImage): Promise<string> {
    const b64 = await this.getBase64(optimized);
    return `data:${optimized.mimeType};base64,${b64}`;
  }

  /**
   * Delete a específico optimized file quando o caller is done com it.
   */
  async cleanup(optimized: OptimizedImage): Promise<void> {
    try {
      await fs.unlink(optimized.path);
    } catch {
      // best-effort
    }
    for (const [key, p] of this.ownedFiles.entries()) {
      if (p === optimized.path) {
        this.ownedFiles.delete(key);
        this.cache.delete(key);
      }
    }
  }

  /**
   * Delete todo optimized file written by isso optimizer. Call at meeting end.
   */
  async cleanupAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [, p] of this.ownedFiles.entries()) {
      tasks.push(fs.unlink(p).catch((): void => undefined));
    }
    await Promise.all(tasks);
    this.ownedFiles.clear();
    this.cache.clear();
  }

  /**
   * For tests/benchmarks: introspection of cache state.
   */
  getCacheStats(): { entries: number; ownedFiles: number; tempDir: string } {
    return {
      entries: this.cache.size,
      ownedFiles: this.ownedFiles.size,
      tempDir: this.tempDir,
    };
  }
}

// Singleton — maioria callers deve uso this. Pass a custom instance apenas em tests.
let singleton: ImageOptimizer | null = null;
export function getImageOptimizer(): ImageOptimizer {
  if (!singleton) singleton = new ImageOptimizer();
  return singleton;
}
