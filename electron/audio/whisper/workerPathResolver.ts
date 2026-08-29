/**
 * Resolves o on-disk caminho para whisperWorker.js através two build layouts:
 *
 *   - Unbundled (tsc → dist-electron):
 *       isso módulo compiles para dist-electron/electron/audio/whisper/workerPathResolver.js
 *       __dirname = dist-electron/electron/audio/whisper/
 *       worker é a sibling → whisperWorker.js
 *
 *   - Bundled (esbuild `bundle: true` inlines dentro de main.js):
 *       isso módulo é folded dentro de dist-electron/electron/main.js
 *       __dirname = dist-electron/electron/
 *       worker stays at its source-mirrored location → audio/whisper/whisperWorker.js
 *
 * Porque isso resolver é si mesmo bundled alongside its callers, its próprio
 * __dirname tracks o bundling estado — então callers don't precisa para pass aqualquer coisa
 */

import path from 'path';
import fs from 'fs';

export function findFirstExistingPath(
    candidates: readonly string[],
    exists: (p: string) => boolean = fs.existsSync,
): string {
    return candidates.find(p => exists(p)) ?? candidates[0];
}

export function resolveWhisperWorkerPath(): string {
    return findFirstExistingPath([
        path.join(__dirname, 'whisperWorker.js'),
        path.join(__dirname, 'audio', 'whisper', 'whisperWorker.js'),
    ]);
}
