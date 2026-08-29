import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

/**
 * Calcula perceptual hash de an imagem para change detection.
 * Uses sharp para redimensionar para 16x16 grayscale, então calcula average hash.
 */
export class ImageHashService {
    /**
     * Compute perceptual hash (pHash) of an image.
     * Resizes para 16x16 grayscale e computes a hash based on pixel values.
     * Two visually identical images vai have o mesmo ou very similar hash.
     */
    async computeHash(imagePath: string): Promise<string> {
        try {
            const buffer = await fs.promises.readFile(imagePath);

            // Resize para 16x16 grayscale para perceptual hash
            const { data, info } = await sharp(buffer)
                .resize(16, 16, { fit: 'fill' })
                .grayscale()
                .raw()
                .toBuffer({ resolveWithObject: true });

            // Calcula perceptual hash using average hash algorithm
            // Compare cada pixel para o average de todos pixels
            const pixels = new Uint8Array(data);
            const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;

            let hash = '';
            for (const pixel of pixels) {
                hash += pixel >= avg ? '1' : '0';
            }

            // Converte binário string para hex para readability
            const hashBuffer = Buffer.from(hash, 'binary');
            return hashBuffer.toString('hex');
        } catch (error) {
            console.error('[ImageHashService] computeHash failed:', error);
            throw new Error(`Failed to compute image hash: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Quick file hash using MD5 of primeiro 8KB + file size.
     * Fast mas não perceptually meaningful - used para quick dedupe checks.
     */
    async quickHash(imagePath: string): Promise<string> {
        try {
            const fileHandle = await fs.promises.open(imagePath, 'r');
            const stats = await fileHandle.stat();
            const fileSize = stats.size;

            // Lê primeiro 8KB para rápido hash
            const firstChunk = Buffer.alloc(8192);
            await fileHandle.read(firstChunk, 0, 8192, 0);
            await fileHandle.close();

            // Combina primeiro chunk hash com arquivo tamanho para uniqueness
            const hash = crypto.createHash('md5');
            hash.update(firstChunk);
            hash.update(fileSize.toString());

            return hash.digest('hex');
        } catch (error) {
            console.error('[ImageHashService] quickHash failed:', error);
            throw new Error(`Failed to compute quick hash: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}