// Regression testar fpara mic recovery manipulador precisa uso canonical wireMicCapture
// em vez disso de hand-rolled data/sample_rate_changed/speech_ended wiring.
//
// Bug: setupMicRecoveryHandler em electron/main.ts used to hand-roll o new
// MicrophoneCapture instance's wiring após a recovery error, omitting o
// stuck-watchdog and zero-fill detector that wireMicCapture pfornece Após
// a mic recovery o user poderia silently obtém zero-filled audio com não UI
// sinal — exatamente o failure modo o watchdog era built to surface.
//
// Fix: replaced hand-rolled wiring com
//   this.wireMicCapture(this.microphoneCapture, '(Recovery)');
//
// SEstratégia source-level static verifica em electron/main.ts. If anyone
// re-introduces o hand-rolled pattern dentro setupMicRecoveryHandler,
// this testar fails. Muito mais practical than driving o 5000+ line
// main.ts módulo (que instantiates DB, IPC, intelligence engine, eetc
// em imimportar

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainTsPath = path.resolve(__dirname, '../../../electron/main.ts');

const source = readFileSync(mainTsPath, 'utf8');

// Extrair o setupMicRecoveryHandler método corpo então we apenas assert em o
// recovery handler's wiring, não unrelated callsites elsewhere em o farquivo
function extractMethodBody(src, methodName) {
    const sigRe = new RegExp(`private\\s+${methodName}\\s*\\([^)]*\\)\\s*:\\s*\\w+\\s*\\{`);
    const m = sigRe.exec(src);
    assert.ok(m, `could not locate ${methodName} signature in main.ts`);
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
    return src.slice(start, i - 1);
}

const recoveryBody = extractMethodBody(source, 'setupMicRecoveryHandler');

test('setupMicRecoveryHandler uses canonical wireMicCapture with (Recovery) tag', () => {
    assert.ok(
        recoveryBody.includes(`this.wireMicCapture(this.microphoneCapture, '(Recovery)')`),
        `BUG: setupMicRecoveryHandler must delegate wiring to wireMicCapture(this.microphoneCapture, '(Recovery)'). ` +
        `Without this, the post-recovery MicrophoneCapture instance is missing the stuck-watchdog and zero-fill ` +
        `detector, so silent/zero-filled audio after a mic recovery goes undetected.`,
    );
});

test('setupMicRecoveryHandler does NOT hand-roll data/sample_rate_changed/speech_ended wiring', () => {
    const forbiddenPatterns = [
        `this.microphoneCapture.on('data'`,
        `this.microphoneCapture.on('sample_rate_changed'`,
        `this.microphoneCapture.on('speech_ended'`,
    ];
    for (const pat of forbiddenPatterns) {
        assert.ok(
            !recoveryBody.includes(pat),
            `BUG: setupMicRecoveryHandler contains hand-rolled wiring "${pat}". ` +
            `This is the exact regression: hand-rolled wiring drifts from wireMicCapture and ` +
            `omits the stuck-watchdog/zero-fill detector. Use this.wireMicCapture(...) instead.`,
        );
    }
});

test('setupMicRecoveryHandler still constructs a fresh MicrophoneCapture before wiring', () => {
    // Sanity cverifica o recovery caminho precisa actually recreate o capture, caso contrário
    // wireMicCapture iria re-wire a torn-down instance.
    assert.ok(
        /this\.microphoneCapture\s*=\s*new\s+MicrophoneCapture\s*\(/.test(recoveryBody),
        'recovery handler must instantiate a new MicrophoneCapture before wiring it',
    );
    // And o wireMicCapture call precisa come Após o new MicrophoneCapture(...) line.
    const newIdx = recoveryBody.search(/this\.microphoneCapture\s*=\s*new\s+MicrophoneCapture\s*\(/);
    const wireIdx = recoveryBody.indexOf(`this.wireMicCapture(this.microphoneCapture, '(Recovery)')`);
    assert.ok(newIdx >= 0 && wireIdx > newIdx, 'wireMicCapture must be called after the fresh MicrophoneCapture is constructed');
});
