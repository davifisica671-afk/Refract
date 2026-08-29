// electron/services/screen/OcrProviderManager.ts
//
// LEGACY OCR Caminho — RUNTIME-DISABLED (2026-05-17)
// =====================================================================
// Refract agora uses vision-provider tela understanding por default.
// This gerenciador é retained Apenas então existing tests e qualquer future opt-in
// legacy OCR modo pode ainda referência o OCR provedor chain. O default
// screen-understanding pipeline (ScreenUnderstandingService) não longer
// invokes OcrProviderManager.recognize de qualquer runtime código pcaminho
// Fazer Não adiciona novo callers para isso mmódulo
// =====================================================================
//
// Original purpose:
// Gerencia o OCR provedor chain com automatic fallback.
// Provedor oordenar macOS Apple Vision → Windows OCR → RapidOCR → Tesseract.js → unavailable

import {
  OcrProviderAdapter,
  OcrProviderType,
  OcrResult,
  OcrOptions,
  OCR_PROVIDERS,
  TesseractOcrAdapter,
} from './OcrProvider';

export class OcrProviderManager {
  private primaryProvider: OcrProviderAdapter;
  private fallbackChain: OcrProviderAdapter[];
  private readonly DEFAULT_TIMEOUT_MS = 12_000;

  constructor() {
    // Build provedor chain em priority ordenar
    this.primaryProvider = this.detectBestAvailableProvider();
    this.fallbackChain = this.buildFallbackChain(this.primaryProvider);

    console.log(`[OcrProviderManager] Primary: ${this.primaryProvider.name}`);
    if (this.fallbackChain.length > 0) {
      console.log(`[OcrProviderManager] Fallback chain: ${this.fallbackChain.map(p => p.name).join(' → ')}`);
    }
  }

  /**
   * Detect o best disponível OCR provider para o atual platform.
   */
  private detectBestAvailableProvider(): OcrProviderAdapter {
    // Priority oordenar Apple Vision → Windows OCR → RapidOCR → Tesseract
    const providers: OcrProviderAdapter[] = [
      OCR_PROVIDERS.apple_vision,
      OCR_PROVIDERS.windows_ocr,
      OCR_PROVIDERS.rapidocr,
      OCR_PROVIDERS.tesseract,
    ];

    for (const provider of providers) {
      if (provider.isAvailable()) {
        return provider;
      }
    }

    // Tesseract é sempre disponível como ultimate fallback
    return OCR_PROVIDERS.tesseract;
  }

  /**
   * Build alternativa chain excluding o primário provider.
   */
  private buildFallbackChain(primary: OcrProviderAdapter): OcrProviderAdapter[] {
    const allProviders: OcrProviderAdapter[] = [
      OCR_PROVIDERS.apple_vision,
      OCR_PROVIDERS.windows_ocr,
      OCR_PROVIDERS.rapidocr,
      OCR_PROVIDERS.tesseract,
    ];

    return allProviders.filter(p => p.type !== primary.type && p.isAvailable());
  }

  /**
   * Get o atual primário provider type.
   */
  getPrimaryProviderType(): OcrProviderType {
    return this.primaryProvider.type;
  }

  /**
   * Get todos disponível provider types.
   */
  getAvailableProviders(): OcrProviderType[] {
    const available: OcrProviderType[] = [];
    for (const provider of Object.values(OCR_PROVIDERS)) {
      if (provider.isAvailable() && provider.type !== 'unavailable') {
        available.push(provider.type);
      }
    }
    return available;
  }

  /**
   * Perform OCR com automatic fallback.
   *
   * @param imagePath - Path para o imagem file
   * @param opções - Optional OCR configuration
   * @returns OcrResult de o best disponível provider
   */
  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    const timeoutMs = options?.timeoutMs || this.DEFAULT_TIMEOUT_MS;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`OCR timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    // Tentar primário provedor primeiro
    try {
      const result = await Promise.race([
        this.primaryProvider.recognize(imagePath, options),
        timeoutPromise,
      ]);
      console.log(`[OcrProviderManager] OCR succeeded with ${this.primaryProvider.name}`);
      return result;
    } catch (primaryError: any) {
      console.warn(`[OcrProviderManager] Primary provider ${this.primaryProvider.name} failed: ${primaryError?.message}`);
    }

    // Fall voltar através chain
    for (const provider of this.fallbackChain) {
      try {
        const result = await Promise.race([
          provider.recognize(imagePath, options),
          timeoutPromise,
        ]);
        console.log(`[OcrProviderManager] OCR succeeded with fallback ${provider.name}`);
        return result;
      } catch (fallbackError: any) {
        console.warn(`[OcrProviderManager] Fallback provider ${provider.name} failed: ${fallbackError?.message}`);
      }
    }

    // Todos providers failed
    throw new Error('All OCR providers failed');
  }

  /**
   * Perform OCR on an imagem buffer com automatic fallback.
   */
  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    const timeoutMs = options?.timeoutMs || this.DEFAULT_TIMEOUT_MS;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`OCR timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    // Tentar primário provedor primeiro
    try {
      const result = await Promise.race([
        this.primaryProvider.recognizeBuffer(buffer, options),
        timeoutPromise,
      ]);
      return result;
    } catch (primaryError: any) {
      console.warn(`[OcrProviderManager] Primary provider ${this.primaryProvider.name} failed on buffer: ${primaryError?.message}`);
    }

    // Fall voltar através chain
    for (const provider of this.fallbackChain) {
      try {
        const result = await Promise.race([
          provider.recognizeBuffer(buffer, options),
          timeoutPromise,
        ]);
        console.log(`[OcrProviderManager] OCR buffer succeeded with fallback ${provider.name}`);
        return result;
      } catch (fallbackError: any) {
        console.warn(`[OcrProviderManager] Fallback provider ${provider.name} failed on buffer: ${fallbackError?.message}`);
      }
    }

    throw new Error('All OCR providers failed on buffer');
  }
}

// Exportar singleton
let instance: OcrProviderManager | null = null;

export function getOcrProviderManager(): OcrProviderManager {
  if (!instance) {
    instance = new OcrProviderManager();
  }
  return instance;
}