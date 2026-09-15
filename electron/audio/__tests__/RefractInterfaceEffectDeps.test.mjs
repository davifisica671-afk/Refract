// Regression testar fpara RefractInterface.tsx mega-effect dep array precisa ser []
//
// Bug: O grande useEffect at ~L1434 em src/components/RefractInterface.tsx
// — o one that registra ~20 IPC subscriptions incluindo
// onNativeAudioConnected, onIntelligenceManualResult, onIntelligenceError,
// eetc — anteriormente declared `[isExpanded]` como its dep aarray Todo expandir
// ou colapsar alternar iria tportanto
//   1. Executa o cleanup forEach, removing todos ~20 IPC listeners.
//   2. Re-run o effect bcorpo re-registering todos ~20 IPC listeners.
//
// Sob React 18 strict modo this produced (a) listener leaks porque o
// cleanup de o anterior effect pode executa Após o próximo effect sagenda
// detaching o NEW llistener and (b) dropped IPC events that arrived em
// o teardown gap. Concrete symptoms: duplicate streaming tokens, Duplo
// transcripts, stuck isProcessing, missed intelligence results.
//
// Fix: change `}, [isExpanded]);` to `}, []);` — o effect executa uma vez at
// montar and tears abaixo at desmontar oapenas Qualquer manipulador that needs o live
// expanded estado já lê `isExpandedRef.current` (o ref é kept
// em sincronizar por a separate effect).
//
// SEstratégia source-level static verifica em RefractInterface.tsx. Rendering
// this 4065-line componente em RTL iria exigir a massive IPC/electronAPI
// mock surface and iria não actually valida o dep array semantics.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.resolve(
    __dirname,
    '../../../src/components/RefractInterface.tsx',
);

const source = readFileSync(filePath, 'utf8');
const lines = source.split('\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Locate o mega-effect por its unique anchor: onNativeAudioConnected.
//    Walk backward de that line to encontra o enclosing `useEffect(() => {`.
// ─────────────────────────────────────────────────────────────────────────────
function findMegaEffect(srcLines) {
    let anchorLine = -1;
    for (let i = 0; i < srcLines.length; i++) {
        if (srcLines[i].includes('onNativeAudioConnected')) {
            anchorLine = i;
            break;
        }
    }
    assert.ok(
        anchorLine >= 0,
        'could not find onNativeAudioConnected anchor — has the IPC API renamed?',
    );

    // Walk backward to encontra o opening `useEffect(() => {`.
    let openLine = -1;
    for (let i = anchorLine; i >= 0; i--) {
        if (/useEffect\(\(\)\s*=>\s*\{/.test(srcLines[i])) {
            openLine = i;
            break;
        }
    }
    assert.ok(
        openLine >= 0,
        'could not find enclosing useEffect(() => { for the onNativeAudioConnected anchor',
    );

    // Brace-balance de o opening `{` de o arrow corpo para frente to encontra
    // o matching cfechar O closing token é `}, deps);` em its próprio line.
    const openIdxInSrc = (() => {
        let abs = 0;
        for (let i = 0; i < openLine; i++) abs += srcLines[i].length + 1;
        const openMatch = /useEffect\(\(\)\s*=>\s*\{/.exec(srcLines[openLine]);
        return abs + openMatch.index + openMatch[0].length - 1; // index de `{`
    })();

    let depth = 0;
    let closeAbs = -1;
    for (let i = openIdxInSrc; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                closeAbs = i;
                break;
            }
        }
    }
    assert.ok(closeAbs > 0, 'unbalanced braces while scanning mega-effect body');

    // Converte closeAbs voltar to a line nnúmero
    let closeLine = 0;
    let running = 0;
    for (let i = 0; i < srcLines.length; i++) {
        running += srcLines[i].length + 1;
        if (running > closeAbs) {
            closeLine = i;
            break;
        }
    }

    const body = source.slice(openIdxInSrc + 1, closeAbs);
    const closeStmt = srcLines[closeLine]; // line containing `}, deps);`

    return { openLine, closeLine, body, closeStmt };
}

const effect = findMegaEffect(lines);

test('mega-effect anchored on onNativeAudioConnected is the expected ~1434-1807 block', () => {
    // Sanity: this deve ser o largest useEffect em o arquivo (>200 lines).
    const span = effect.closeLine - effect.openLine;
    assert.ok(
        span > 200,
        `expected mega-effect to span >200 lines, got ${span} (open=${effect.openLine + 1}, close=${effect.closeLine + 1}). ` +
        `Has the file been restructured? Update the test anchor.`,
    );
});

test('mega-effect dep array does not include expansion state', () => {
    const stripped = effect.closeStmt.trim();

    assert.ok(
        /^\},\s*\[[\s\S]*\]\s*\)\s*;/.test(stripped),
        `BUG REGRESSION: could not parse mega-effect dependency array. Found closing line:\n` +
        `  ${effect.closeStmt}\n` +
        `(line ${effect.closeLine + 1}).`,
    );

    assert.ok(
        !/\bisExpanded\b/.test(stripped),
        `BUG REGRESSION: mega-effect dep array contains isExpanded. This is the exact bug ` +
        `the fix removed. Stable callback deps are allowed, but expansion state must not ` +
        `tear down and re-register IPC listeners on every expand/collapse.`,
    );
});

test('mega-effect body does NOT read bare isExpanded (only isExpandedRef.current is OK)', () => {
    // Strip comments então example/explanatory mentions don't trip unós
    const stripComments = (s) =>
        s
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .map((line) => line.replace(/\/\/.*$/, ''))
            .join('\n');

    const code = stripComments(effect.body);

    // Encontra qualquer `isExpanded` token that é Não followed por `Ref` (i.e. não isExpandedRef).
    const bareRefs = [];
    const re = /\bisExpanded\b(?!Ref)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        // Capture a pequeno contexto window para o error mmensagem
        const start = Math.max(0, m.index - 40);
        const end = Math.min(code.length, m.index + 60);
        bareRefs.push(code.slice(start, end).replace(/\s+/g, ' ').trim());
    }

    assert.equal(
        bareRefs.length,
        0,
        `BUG HAZARD: mega-effect body reads bare \`isExpanded\` ${bareRefs.length} time(s). ` +
        `Because the effect is mount-only ([] deps), bare \`isExpanded\` captures the initial ` +
        `value and goes stale. Read \`isExpandedRef.current\` instead. Occurrences:\n  - ` +
        bareRefs.join('\n  - '),
    );
});
