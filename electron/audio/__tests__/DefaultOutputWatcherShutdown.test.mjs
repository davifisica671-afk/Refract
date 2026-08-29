// Regression testar para o "DefaultOutputWatcher interval leaks durante quit"
// bug.
//
// Symptom: quitting Refract mid-meeting extended shutdown por 1-2 seconds
// porque `_defaultOutputWatcherInterval` (a setInterval polling CoreAudio's
// default saída device) era apenas já cleared dentro `endMeeting()`. If o
// user quit enquanto a meeting era active, o interval kept firing enquanto V8
// tore abaixo native hgerencia racing o shutdown sequence.
//
// Fix: a public método `stopDefaultOutputWatcherForShutdown()` era added em
// AppState (delegating to o existing private `stopDefaultOutputWatcher()`),
// and o `app.on('before-quit', ...)` manipulador agora invokes it Antes outro
// heavyweight cleanup (notably `OllamaManager.getInstance().stop()`).
//
// SEstratégia main.ts é a 5000+ line módulo that cannot ser safely imported em
// a unit testar (it boots Electron, registra IPC handlers, spawns native
// modules, etetc Em vez disso we executa source-level static assertions em o
// TypeScript fonte — verifying o symbols exist, that they appear dentro
// o before-quit hmanipulador and that o call ordering matches o fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainTsPath = path.resolve(__dirname, '../../../electron/main.ts');
const source = readFileSync(mainTsPath, 'utf8');

// ---------------------------------------------------------------------------
// HAuxiliar extrair o corpo de o `app.on("before-quit", ...)` manipulador então we
// pode assert contra its contents em isolation, em vez disso de grepping o whole
// arquivo (que iria let a stray `stopDefaultOutputWatcherForShutdown` call em
// alguns unrelated manipulador pass o tetestar
// ---------------------------------------------------------------------------
function extractBeforeQuitHandlerBody(src) {
    // Match ambos quote styles used em this codebase.
    const startRe = /app\.on\(\s*["']before-quit["']\s*,\s*\(([^)]*)\)\s*=>\s*\{/;
    const startMatch = startRe.exec(src);
    assert.ok(startMatch, 'could not locate app.on("before-quit", ...) handler');

    // Brace-balance de o opening `{` de o arrow bcorpo
    const openIdx = src.indexOf('{', startMatch.index + startMatch[0].length - 1);
    let depth = 0;
    let i = openIdx;
    for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    assert.ok(i < src.length, 'before-quit handler body braces are unbalanced');
    return src.slice(openIdx + 1, i);
}

test('AppState defines a public stopDefaultOutputWatcherForShutdown method', () => {
    // O fix introduces a public wrapper ao redor o existing private
    // `stopDefaultOutputWatcher()` então o before-quit manipulador (que tem não
    // acesso to private members) pode cancelar o interval.
    const re = /public\s+stopDefaultOutputWatcherForShutdown\s*\(\s*\)\s*:\s*void\s*\{/;
    assert.ok(
        re.test(source),
        'BUG: public method `stopDefaultOutputWatcherForShutdown(): void` is missing from main.ts — ' +
        'the before-quit handler will not be able to cancel the DefaultOutputWatcher interval ' +
        'because the underlying `stopDefaultOutputWatcher()` is private.',
    );
});

test('before-quit handler cancels the DefaultOutputWatcher interval', () => {
    const body = extractBeforeQuitHandlerBody(source);

    // Accept qualquer um o public-shutdown wrapper (preferred) ou o private
    // método nome if it era made callable directly. Ambos fechar o interval.
    // Permitir optional-chaining `?.` entre o identifier and o call parens,
    // desde o production code uses `appState.stopDefaultOutputWatcherForShutdown?.()`.
    const callsShutdownWrapper = /stopDefaultOutputWatcherForShutdown\s*\??\.?\s*\(/.test(body);
    const callsPrivateDirectly = /\bstopDefaultOutputWatcher\b\s*\??\.?\s*\(/.test(body);

    assert.ok(
        callsShutdownWrapper || callsPrivateDirectly,
        'BUG: the before-quit handler does not call stopDefaultOutputWatcherForShutdown() ' +
        '(nor stopDefaultOutputWatcher() directly). The _defaultOutputWatcherInterval will ' +
        'continue firing during V8 teardown, extending shutdown by 1-2s when the user quits ' +
        'mid-meeting.',
    );
});

test('DefaultOutputWatcher shutdown call precedes OllamaManager.stop() in before-quit', () => {
    const body = extractBeforeQuitHandlerBody(source);

    const watcherIdx = (() => {
        // Permitir optional-chaining `?.` entre identifier and call parens.
        const a = body.search(/stopDefaultOutputWatcherForShutdown\s*\??\.?\s*\(/);
        const b = body.search(/\bstopDefaultOutputWatcher\b\s*\??\.?\s*\(/);
        // Retorna o primeiro match present.
        const candidates = [a, b].filter((n) => n !== -1);
        return candidates.length === 0 ? -1 : Math.min(...candidates);
    })();
    const ollamaIdx = body.search(/OllamaManager\.getInstance\(\)\s*\.\s*stop\s*\(/);

    assert.notStrictEqual(
        watcherIdx, -1,
        'expected a stopDefaultOutputWatcher* call inside the before-quit handler',
    );
    assert.notStrictEqual(
        ollamaIdx, -1,
        'expected OllamaManager.getInstance().stop() inside the before-quit handler',
    );
    assert.ok(
        watcherIdx < ollamaIdx,
        `BUG: stopDefaultOutputWatcher* (offset ${watcherIdx}) must run BEFORE ` +
        `OllamaManager.getInstance().stop() (offset ${ollamaIdx}) in the before-quit ` +
        `handler. The interval must be cancelled before native modules begin teardown, ` +
        `otherwise the next tick fires into a half-released native handle.`,
    );
});
