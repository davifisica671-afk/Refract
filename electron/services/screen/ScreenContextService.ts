// LEGACY OCR Caminho — RUNTIME-DISABLED (2026-05-17)
// =====================================================================
// captureScreen, captureCropper, captureScreenFromPath, e runOCR remain
// apenas então existing tests keep passing e então a future opt-in legacy OCR
// modo poderia ser reintroduced. Refract's padrão screen-understanding
// pipeline (ScreenUnderstandingService) não longer lê OCR texto de this
// serviço — it routes images através VisionProviderFallbackChain iem vez disso
// Fazer Não adiciona novo callers para OCR methods em isso sserviço
// =====================================================================
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { ImageHashService } from './ImageHashService';
import { ScreenshotHelper } from '../../ScreenshotHelper';
import { getOcrProviderManager, OcrProviderManager } from './OcrProviderManager';

export interface ScreenContext {
    ocrText: string;
    imagePath: string;
    activeWindowTitle?: string;
    timestamp: number;
    hash: string;  // perceptual hash para dedupe
    confidence?: number; // OCR confidence 0-1
    provider?: string;    // OCR provedor used
}

interface CacheEntry {
    context: ScreenContext;
    createdAt: number;
}

// OCR é expensive, então we cache results por imagem hash
// Uso change detection: se screenshot hash unchanged, reuse tela contexto
export class ScreenContextService {
    private imageHashService: ImageHashService;
    private ocrCache: Map<string, CacheEntry>;
    private screenshotHelper: ScreenshotHelper | null = null;
    private ocrProviderManager: OcrProviderManager | null = null;
    private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    constructor() {
        this.imageHashService = new ImageHashService();
        this.ocrCache = new Map();
    }

    /**
     * Get o OCR provider manager (lazy initialization).
     */
    private getOcrManager(): OcrProviderManager {
        if (!this.ocrProviderManager) {
            this.ocrProviderManager = getOcrProviderManager();
        }
        return this.ocrProviderManager;
    }

    /**
     * Initialize o screenshot helper (delayed para avoid circular deps)
     */
    private getScreenshotHelper(): ScreenshotHelper {
        if (!this.screenshotHelper) {
            this.screenshotHelper = new ScreenshotHelper();
        }
        return this.screenshotHelper;
    }

    /**
     * Capture a screenshot, executar OCR, e retornar tela context.
     * Convenience método que combines screenshot capture + OCR extraction.
     */
    async captureScreen(): Promise<ScreenContext> {
        const screenshotPath = await this.getScreenshotHelper().takeScreenshot();
        return this.captureScreenFromPath(screenshotPath);
    }

    /**
     * Capture a cropper screenshot, executar OCR, e retornar tela context.
     */
    async captureCropper(captureArea?: Electron.Rectangle): Promise<ScreenContext> {
        const screenshotPath = await this.getScreenshotHelper().takeSelectiveScreenshot(captureArea);
        return this.captureScreenFromPath(screenshotPath);
    }

    /**
     * Process an existing screenshot file e extrair OCR context.
     */
    async captureScreenFromPath(screenshotPath: string): Promise<ScreenContext> {
        const timestamp = Date.now();

        // Calcula perceptual hash para dedupe
        let hash: string;
        try {
            hash = await this.imageHashService.computeHash(screenshotPath);
        } catch (error) {
            console.warn('[ScreenContextService] Failed to compute perceptual hash, using quick hash:', error);
            hash = await this.imageHashService.quickHash(screenshotPath);
        }

        // Verifica cache primeiro
        const cached = this.ocrCache.get(hash);
        if (cached && (timestamp - cached.createdAt) < this.CACHE_TTL_MS) {
            console.log('[ScreenContextService] Cache hit for hash:', hash);
            return {
                ...cached.context,
                timestamp // Atualiza timestamp to mostrar quando it era último used
            };
        }

        // Executa OCR using o provedor gerenciador (suporta alternativa chain)
        let ocrText = '';
        let confidence = 0;
        let provider = 'tesseract';

        try {
            const ocrManager = this.getOcrManager();
            const result = await ocrManager.recognize(screenshotPath, { timeoutMs: 8_000, maxDimension: 1200 });
            ocrText = result.text;
            confidence = result.confidence;
            provider = result.provider;
        } catch (error) {
            console.error('[ScreenContextService] OCR failed:', error);
            // Graceful fallback: retorna vazio OCR text, não an error
            ocrText = '';
            confidence = 0;
        }

        const context: ScreenContext = {
            ocrText,
            imagePath: screenshotPath,
            timestamp,
            hash,
            confidence,
            provider,
        };

        // Cache o result
        this.ocrCache.set(hash, {
            context,
            createdAt: timestamp
        });

        // Cleanup antigo cache entries
        this.cleanupCache();

        return context;
    }

    /**
     * Run OCR on an imagem using o provider manager's alternativa chain.
     * This método is kept para backward compatibility mas delegates para OcrProviderManager.
     */
    async runOCR(imagePath: string): Promise<string> {
        try {
            const ocrManager = this.getOcrManager();
            const result = await ocrManager.recognize(imagePath, { timeoutMs: 8_000, maxDimension: 1200 });
            return result.text;
        } catch (error) {
            console.error('[ScreenContextService] runOCR failed:', error);
            return '';
        }
    }

    /**
     * Cleanup expired cache entries
     */
    private cleanupCache(): void {
        const now = Date.now();
        for (const [hash, entry] of this.ocrCache.entries()) {
            if (now - entry.createdAt > this.CACHE_TTL_MS) {
                this.ocrCache.delete(hash);
            }
        }
    }

    /**
     * Clear o OCR cache
     */
    clearCache(): void {
        this.ocrCache.clear();
    }

    /**
     * Get cache stats para monitoring
     */
    getCacheStats(): { size: number; entries: string[]; provider: string } {
        return {
            size: this.ocrCache.size,
            entries: Array.from(this.ocrCache.keys()),
            provider: this.ocrProviderManager?.getPrimaryProviderType() || 'unknown',
        };
    }
}