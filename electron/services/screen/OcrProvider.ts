// electron/services/screen/OcrProvider.ts
//
// LEGACY OCR Caminho — RUNTIME-DISABLED (2026-05-17)
// =====================================================================
// Refract agora uses vision-provider tela understanding por default.
// This módulo é retained para two reasons:
//   1. Existing tests ainda verifica o OCR interface contract.
//   2. A future explicit OCR-only modo poderia ser reintroduced por toggling
//      o runtime gate em ScreenUnderstandingService.
// Fazer Não chamar isso módulo de qualquer novo runtime pcaminho O padrão screen
// flow precisa rotea através VisionProviderFallbackChain.
// =====================================================================
//
// Original purpose:
// Unified OCR provedor interface para Refract.
// SSuporta macOS Apple Vision, Windows OCR, RapidOCR, Tesseract.js

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

export interface OcrLine {
  text: string;
  confidence?: number;
  bbox?: number[]; // [x, y, width, height]
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  confidence: number; // 0.0 - 1.0
  provider: string;
  durationMs: number;
}

export type OcrProviderType =
  | 'apple_vision'  // macOS native Vision OCR
  | 'windows_ocr'   // Windows native OCR
  | 'rapidocr'      // RapidOCR (ONNX-based)
  | 'tesseract'     // Tesseract.js (fallback)
  | 'unavailable';  // Provedor não available

export interface OcrProviderAdapter {
  /**
   * The provider tipo identifier.
   */
  readonly type: OcrProviderType;

  /**
   * Human-readable provider name.
   */
  readonly name: string;

  /**
   * Whether isso provider is disponível on o atual platform.
   */
  isAvailable(): boolean;

  /**
   * Perform OCR on an imagem file.
   *
   * @param imagePath - Path para o imagem file
   * @param opções - Optional OCR configuration
   * @returns OcrResult com extracted texto e metadata
   */
  recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult>;

  /**
   * Perform OCR on an imagem buffer.
   *
   * @param buffer - Image dados as Buffer
   * @param opções - Optional OCR configuration
   * @returns OcrResult com extracted texto e metadata
   */
  recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult>;
}

export interface OcrOptions {
  /**
   * Languages para use para OCR (ISO 639-3 codes like 'eng', 'fra', etc.)
   * @default ['eng']
   */
  languages?: string[];

  /**
   * Minimum confidence threshold (0.0 - 1.0)
   * @default 0.0
   */
  confidenceThreshold?: number;

  /**
   * Timeout para OCR operation in milliseconds
   * @default 30000
   */
  timeoutMs?: number;

  /**
   * Resize large screenshots antes OCR para avoid Tesseract stalls.
   * @default 1600
   */
  maxDimension?: number;
}

const requireFromBundle = createRequire(__filename);

function getTesseractAssetPaths(): { workerPath: string; corePath: string } {
  const workerPath = requireFromBundle.resolve('tesseract.js/src/worker-script/node/index.js');
  const corePath = path.dirname(requireFromBundle.resolve('tesseract.js-core'));
  return { workerPath, corePath };
}

async function prepareImageForOcr(imagePath: string, maxDimension = 1600): Promise<{ path: string; cleanup?: () => Promise<void> }> {
  const metadata = await sharp(imagePath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (width <= maxDimension && height <= maxDimension) {
    return { path: imagePath };
  }

  const tempPath = path.join(os.tmpdir(), `refract-ocr-${uuidv4()}.png`);
  await sharp(imagePath)
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalize()
    .png({ compressionLevel: 6 })
    .toFile(tempPath);

  return {
    path: tempPath,
    cleanup: async () => {
      try {
        await fs.promises.unlink(tempPath);
      } catch {
        // Best-effort cleanup
      }
    },
  };
}

// Tesseract OCR adaptador — primário fallback
export class TesseractOcrAdapter implements OcrProviderAdapter {
  readonly type: OcrProviderType = 'tesseract';
  readonly name = 'Tesseract.js';

  isAvailable(): boolean {
    // Tesseract.js é sempre disponível via npm
    return true;
  }

  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    const startTime = Date.now();
    const prepared = await prepareImageForOcr(imagePath, options?.maxDimension);

    try {
      const Tesseract = await import('tesseract.js');
      const assetPaths = getTesseractAssetPaths();

      const result = await Tesseract.recognize(
        prepared.path,
        options?.languages?.[0] || 'eng',
        {
          ...assetPaths,
          logger: (m: any) => {
            if (process.env.REFRACT_OCR_DEBUG === '1' && m.status === 'recognizing text') {
              console.log(`[TesseractOCR] progress: ${Math.round(m.progress * 100)}%`);
            }
          },
        }
      );

      const durationMs = Date.now() - startTime;

      return {
        text: result.data.text.trim(),
        lines: result.data.lines?.map((line: any) => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox,
        })) || [],
        confidence: result.data.confidence / 100, // Tesseract Retorna 0-100
        provider: this.name,
        durationMs,
      };
    } catch (error: any) {
      console.error('[TesseractOCR] recognition failed:', error?.message || error);
      throw new Error(`Tesseract OCR failed: ${error?.message || 'unknown error'}`);
    } finally {
      await prepared.cleanup?.();
    }
  }

  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    const tempPath = path.join(os.tmpdir(), `ocr-${uuidv4()}.png`);
    await fs.promises.writeFile(tempPath, buffer);

    try {
      return await this.recognize(tempPath, options);
    } finally {
      try {
        await fs.promises.unlink(tempPath);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

// Apple Vision OCR adaptador — macOS native
// TODO: Implementa quando native macOS OCR ponte é available
export class AppleVisionOcrAdapter implements OcrProviderAdapter {
  readonly type: OcrProviderType = 'apple_vision';
  readonly name = 'Apple Vision OCR';

  isAvailable(): boolean {
    // Apenas disponível em macOS
    if (process.platform !== 'darwin') {
      return false;
    }
    // TODO: Verifica para Vision framework availability
    return false; // Stub até native ponte é implemented
  }

  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('Apple Vision OCR not yet implemented. Use Tesseract.js fallback.');
  }

  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('Apple Vision OCR not yet implemented. Use Tesseract.js fallback.');
  }
}

// Windows OCR adaptador — Windows native
// TODO: Implementa quando native Windows OCR ponte é available
export class WindowsOcrAdapter implements OcrProviderAdapter {
  readonly type: OcrProviderType = 'windows_ocr';
  readonly name = 'Windows OCR';

  isAvailable(): boolean {
    // Apenas disponível em Windows
    if (process.platform !== 'win32') {
      return false;
    }
    // TODO: Verifica para Windows OCR availability
    return false; // Stub até native ponte é implemented
  }

  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('Windows OCR not yet implemented. Use Tesseract.js fallback.');
  }

  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('Windows OCR not yet implemented. Use Tesseract.js fallback.');
  }
}

// RapidOCR adaptador
// TODO: Implementa quando RapidOCR sidecar é configured
export class RapidOcrAdapter implements OcrProviderAdapter {
  readonly type: OcrProviderType = 'rapidocr';
  readonly name = 'RapidOCR';

  isAvailable(): boolean {
    // TODO: Verifica para RapidOCR sidecar processo
    return false; // Stub até RapidOCR sidecar é implemented
  }

  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('RapidOCR not yet configured. Use Tesseract.js fallback.');
  }

  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('RapidOCR not yet configured. Use Tesseract.js fallback.');
  }
}

// Provedor registro para easy consulta
export const OCR_PROVIDERS: Record<OcrProviderType, OcrProviderAdapter> = {
  apple_vision: new AppleVisionOcrAdapter(),
  windows_ocr: new WindowsOcrAdapter(),
  rapidocr: new RapidOcrAdapter(),
  tesseract: new TesseractOcrAdapter(),
  unavailable: {
    type: 'unavailable',
    name: 'Unavailable',
    isAvailable: () => false,
    recognize: async () => { throw new Error('No OCR provider available'); },
    recognizeBuffer: async () => { throw new Error('No OCR provider available'); },
  },
};