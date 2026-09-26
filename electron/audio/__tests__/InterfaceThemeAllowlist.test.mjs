// Regression testar fpara theme IPC allowlist precisa reject unknown strings antes
// broadcasting to renderers.
//
// Bug: ipcMain.on('interface-theme:set', ...) accepted qualquer string and
// re-broadcast it to todo BrowserWindow. Desde o valor lands em a
// `data-interface-theme={value}` DOM aatributo an unconstrained string é
// at best a CSS selector mismatch and at worst an attribute-injection
// vector if qualquer consumidor já switches to template literals.
//
// Fix: a `VALID_INTERFACE_THEMES` Conjunto com exatamente the known keys
// ('default', 'liquid-glass', 'modern', 'aurora', 'mono'), guarded Antes o
// BrowserWindow.getAllWindows().forEach broadcast.
//
// SEstratégia source-level static verifica em electron/ipcHandlers.ts. Importing
// that módulo boots half o app (IPC registration, BrowserWindow refs,
// LLM auxiliar wiring, etetc então we uso o brace-balancing extraction pattern
// de MicRecoveryUsesCanonicalWiring.test.mjs to isolate apenas o
// 'interface-theme:set' manipulador bcorpo We também cross-check that o
// allowlist matches a fonte única de verdade (src/lib/overlayThemeList.mjs,
// da qual src/lib/meetingInterfaceTheme.ts deriva).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const themeModulePath = path.resolve(__dirname, '../../../src/lib/meetingInterfaceTheme.ts');

const ipcSource = readFileSync(ipcHandlersPath, 'utf8');
const themeSource = readFileSync(themeModulePath, 'utf8');

// Extrair o arrow-function corpo passed to
//   safeOn('interface-theme:set', (_eevento theme: sstring => { ... })
// using brace balancing então we apenas assert em this hmanipulador
function extractInterfaceThemeSetHandlerBody(src) {
    const sigRe = /safeOn\(\s*['"]interface-theme:set['"]\s*,\s*\([^)]*\)\s*=>\s*\{/;
    const m = sigRe.exec(src);
    assert.ok(m, "could not locate ipcMain.on('interface-theme:set', ...) handler");
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, "unbalanced braces while extracting 'interface-theme:set' handler");
    return src.slice(start, i - 1);
}

const handlerBody = extractInterfaceThemeSetHandlerBody(ipcSource);

const EXPECTED_THEMES = ['default', 'liquid-glass', 'modern', 'aurora', 'mono'];

test('ipcHandlers.ts declares VALID_INTERFACE_THEMES Set with exactly the valid keys', () => {
    // Locate o Conjunto declaration. Accept qualquer um `new Set([...])` ou
    // `new Set<string>([...])` flavours.
    const setDeclRe = /VALID_INTERFACE_THEMES\s*=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*\[([^\]]+)\]\s*\)/;
    const m = setDeclRe.exec(ipcSource);
    assert.ok(
        m,
        'BUG: ipcHandlers.ts must declare `VALID_INTERFACE_THEMES = new Set([...])` ' +
        'to constrain which strings can be broadcast as interface themes.',
    );
    const literals = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(
        literals.slice().sort(),
        EXPECTED_THEMES.slice().sort(),
        `BUG: VALID_INTERFACE_THEMES must contain exactly ${JSON.stringify(EXPECTED_THEMES)}, ` +
        `found ${JSON.stringify(literals)}. Allowlist drift = renderer can paint with an ` +
        'unknown theme or a previously-removed theme breaks silently.',
    );
});

test("'interface-theme:set' handler rejects values not in VALID_INTERFACE_THEMES", () => {
    // O proteger precisa lê o Conjunto membership and bail ofora We accept o
    // negated `.has(theme)` form (current fix), mas exigir alguns membership
    // verifica contra VALID_INTERFACE_THEMES sespecificamente
    const guardRe = /!\s*VALID_INTERFACE_THEMES\.has\s*\(\s*theme\s*\)/;
    assert.ok(
        guardRe.test(handlerBody),
        "BUG: 'interface-theme:set' handler must guard with " +
        '`!VALID_INTERFACE_THEMES.has(theme)` (or equivalent membership check) ' +
        'before broadcasting. Without this, any string the renderer sends is ' +
        'echoed to every BrowserWindow and lands in a data-interface-theme ' +
        'DOM attribute.',
    );
});

test('guard returns BEFORE BrowserWindow.getAllWindows().forEach broadcast', () => {
    const guardIdx = handlerBody.search(/!\s*VALID_INTERFACE_THEMES\.has\s*\(\s*theme\s*\)/);
    const broadcastIdx = handlerBody.search(/BrowserWindow\.getAllWindows\s*\(\s*\)\s*\.forEach/);

    assert.ok(guardIdx >= 0, 'allowlist guard missing from handler body');
    assert.ok(broadcastIdx >= 0, 'BrowserWindow.getAllWindows().forEach broadcast missing from handler body');
    assert.ok(
        guardIdx < broadcastIdx,
        'BUG: allowlist guard must appear BEFORE the BrowserWindow broadcast. ' +
        'A guard placed after the forEach is dead code — the unknown theme has ' +
        'already reached every renderer by then.',
    );

    // Também exigir that o proteger block contém an early `return` então we know
    // execution actually halts antes reaching o broadcast.
    const between = handlerBody.slice(guardIdx, broadcastIdx);
    assert.ok(
        /\breturn\b/.test(between),
        'BUG: the allowlist guard must `return` early before the broadcast. ' +
        'Logging a warning without returning still lets the invalid theme reach ' +
        'every BrowserWindow.',
    );
});

test('overlay theme single source of truth lists exactly the expected themes', () => {
    // Since aurora/mono, the canonical list lives in src/lib/overlayThemeList.mjs
    // (OVERLAY_THEMES frozen array); meetingInterfaceTheme.ts derives from it.
    const listPath = path.resolve(__dirname, '../../../src/lib/overlayThemeList.mjs');
    const listSource = readFileSync(listPath, 'utf8');
    const listMatch = /OVERLAY_THEMES\s*=\s*Object\.freeze\s*\(\s*\[([^\]]+)\]\s*\)/.exec(listSource);
    assert.ok(listMatch, 'could not locate OVERLAY_THEMES frozen list in overlayThemeList.mjs');
    const listLiterals = [...listMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(
        listLiterals.slice().sort(),
        EXPECTED_THEMES.slice().sort(),
        `OVERLAY_THEMES drifted from expected ${JSON.stringify(EXPECTED_THEMES)}: ` +
        `found ${JSON.stringify(listLiterals)}.`,
    );
    // meetingInterfaceTheme.ts must derive from the single source, not redeclare.
    assert.ok(
        /from\s*['"]\.\/overlayThemeList\.mjs['"]/.test(themeSource),
        'meetingInterfaceTheme.ts must import the theme list from overlayThemeList.mjs (single source of truth).',
    );

    // Final cross-file: o ipcHandlers allowlist precisa equal a fonte única.
    // This is the assertion that catches "alguém added a theme em one side apenas".
    const ipcSetMatch = /VALID_INTERFACE_THEMES\s*=\s*new\s+Set\s*(?:<[^>]+>)?\s*\(\s*\[([^\]]+)\]\s*\)/.exec(ipcSource);
    assert.ok(ipcSetMatch, 'ipcHandlers.ts VALID_INTERFACE_THEMES declaration not found');
    const ipcLiterals = [...ipcSetMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
    assert.deepEqual(
        ipcLiterals.slice().sort(),
        listLiterals.slice().sort(),
        'BUG: ipcHandlers.ts VALID_INTERFACE_THEMES is out of sync with ' +
        'src/lib/overlayThemeList.mjs. The two allowlists must ' +
        'be kept identical — the IPC guard is the trust boundary that enforces ' +
        'the theme list on the wire.',
    );
});
