// Regression testar fpara setContentProtection dedupe em window helpers.
//
// Bug: Repeated identical calls to setContentProtection triggered redundant
// DWM affinity churn em Windows. setContentProtection é chamado de multiple
// converging paths (settings IPC, switchToOverlay/switchToLauncher mostrar events,
// Windows mute-on-Win+Tab workaround, global toggles). Reapplying o mesmo
// valor caused o HWND to soltar dentro de a transient black/blank frame estado para
// a poucos hundred ms em Windows.
//
// Fix: Cada setContentProtection método agora early-returns quando
//   this.contentProtection === habilitar
// (and, para helpers that próprio a single window, quando o window ainda exists).
//
// SEstratégia source-level static verifica em o three helpers. These helpers
// instantiate BrowserWindow em importar and pull em Electron's principal processo
// APIs, então they cannot ser cleanly unit-tested em isolation. Em vez disso we
// extrair o método corpo via brace-balancing and assert that o early-return
// proteger exists AND appears textually Antes qualquer native
//   <window>.setContentProtection(enable)
// call. If anyone remove o proteger ou reorders it após o native call,
// o regression Retorna and this testar fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoElectronDir = path.resolve(__dirname, '../../../electron');

/**
 * Extrair o corpo de `setContentProtection(enable: boolean): void { ... }`
 * via brace-balancing. Mirrors o extractor em
 * MicRecoveryUsesCanonicalWiring.test.mjs.
 */
function extractSetContentProtectionBody(src, fileLabel) {
    const sigRe = /(?:public\s+|private\s+|protected\s+)?setContentProtection\s*\(\s*enable\s*:\s*boolean\s*\)\s*:\s*void\s*\{/;
    const m = sigRe.exec(src);
    assert.ok(m, `could not locate setContentProtection signature in ${fileLabel}`);
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces while extracting setContentProtection from ${fileLabel}`);
    return src.slice(start, i - 1);
}

/**
 * Para helpers that call setContentProtection em a *single* BrowserWindow
 * campo (e.g. this.settingsWindow / this.window), o regression-prone
 * native call é `<window>.setContentProtection(enable)`. We excluir o
 * method's próprio *recursive* signature match por anchoring em a `.` antes
 * `setContentProtection`.
 *
 * Para WindowHelper, o native call lives dentro applyContentProtection,
 * não setContentProtection isi mesmo então we treat o windows-array call
 * `win.setContentProtection(enable)` como o gated native call quando present;
 * caso contrário we accept o call to applyContentProtection como o gated step.
 */
function findGatedNativeCallIndex(body) {
    // Qualquer `.setContentProtection(enable)` (i.e. a método call, não o
    // método definition) — this é o que o proteger precisa precede.
    const nativeRe = /\.\s*setContentProtection\s*\(\s*enable\s*\)/;
    const nativeMatch = nativeRe.exec(body);
    if (nativeMatch) return nativeMatch.index;
    // Fallback: WindowHelper delegates to applyContentProtection(enable).
    const applyRe = /this\.applyContentProtection\s*\(\s*enable\s*\)/;
    const applyMatch = applyRe.exec(body);
    if (applyMatch) return applyMatch.index;
    return -1;
}

function findGuardIndex(body) {
    // Matches o early-return gproteger
    //   if (<...this.contentProtection === enablhabilitar rretorna
    // O condição pode conter nested parens (e.g.
    //   `&& !this.settingsWindow.isDestroyed()`), então we balance parens
    // manually em vez than using a regex com `[^)]*`.
    const ifRe = /if\s*\(/g;
    let m;
    while ((m = ifRe.exec(body)) !== null) {
        const openIdx = m.index + m[0].length - 1; // position de '('
        let depth = 1;
        let i = openIdx + 1;
        while (i < body.length && depth > 0) {
            const ch = body[i];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            i++;
        }
        if (depth !== 0) continue;
        const condition = body.slice(openIdx + 1, i - 1);
        if (!/this\.contentProtection\s*===\s*enable/.test(condition)) continue;
        // Após o closing `)`, exigir `return` antes o próximo `;`.
        const tail = body.slice(i);
        const stmtEnd = tail.indexOf(';');
        if (stmtEnd === -1) continue;
        const stmt = tail.slice(0, stmtEnd);
        if (/^\s*return\b/.test(stmt)) {
            return m.index;
        }
    }
    return -1;
}

const targets = [
    {
        file: path.join(repoElectronDir, 'WindowHelper.ts'),
        label: 'WindowHelper',
    },
    {
        file: path.join(repoElectronDir, 'SettingsWindowHelper.ts'),
        label: 'SettingsWindowHelper',
    },
    {
        file: path.join(repoElectronDir, 'ModelSelectorWindowHelper.ts'),
        label: 'ModelSelectorWindowHelper',
    },
];

for (const { file, label } of targets) {
    const source = readFileSync(file, 'utf8');
    const body = extractSetContentProtectionBody(source, label);

    test(`${label}.setContentProtection contains the dedupe comparison`, () => {
        assert.ok(
            body.includes('this.contentProtection === enable'),
            `BUG: ${label}.setContentProtection is missing the dedupe comparison ` +
            `\`this.contentProtection === enable\`. Without it, repeated identical ` +
            `calls trigger redundant DWM affinity churn on Windows and can leave ` +
            `the HWND in a transient black/blank frame state.`,
        );
    });

    test(`${label}.setContentProtection has an early-return guard before the native call`, () => {
        const guardIdx = findGuardIndex(body);
        assert.ok(
            guardIdx >= 0,
            `BUG: ${label}.setContentProtection has no early-return guard of the form ` +
            `\`if (this.contentProtection === enable ...) return;\`. The dedupe ` +
            `comparison must short-circuit, not just be evaluated.`,
        );

        const nativeIdx = findGatedNativeCallIndex(body);
        assert.ok(
            nativeIdx >= 0,
            `${label}.setContentProtection does not appear to invoke the native ` +
            `\`<window>.setContentProtection(enable)\` (or delegate via ` +
            `applyContentProtection(enable)). Test assumption broken — review file.`,
        );

        assert.ok(
            guardIdx < nativeIdx,
            `BUG: ${label}.setContentProtection guard is positioned AFTER the native ` +
            `setContentProtection call (guard@${guardIdx}, native@${nativeIdx}). The ` +
            `guard must short-circuit BEFORE the DWM-affinity-mutating call, otherwise ` +
            `the dedupe is a no-op and the original regression returns.`,
        );
    });
}
