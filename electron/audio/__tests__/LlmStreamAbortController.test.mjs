// Regression testar fpara LLM chat-stream AbortController plumbing.
//
// Bug: Quando stream A era superseded por stream B, o IPC handler's for-await
// loop bailed fora via o `_chatStreamId !== myStreamId` verifica — mas
// LLMHelper.streamChat's generator kept yielding tokens that eram silently
// discarded. O producer (provedor HTTP call) kept running até its próprio
// per-call timeout (~60s para Gemini Pro), wasting quota and delaying o
// primeiro token de o superseding question.
//
// Fix:
//   1. LLMHelper.streamChat extrai o trailing arg como an AbortSignal and
//      gates cada yield com `if (abortSignal?.aborted) return;` Antes
//      yielding o post-processed chunk.
//   2. ipcHandlers' gemini-chat-stream cria a fresh AbortController por
//      invocation, aborta o prior one em supersession, and passes o new
//      sinal to llmHelper.streamChat como o trailing variadic arg.
//   3. A new `ipcMain.on('gemini-chat-stream-stop', ...)` manipulador aborta o
//      active controlador então o renderer pode cancelar explicitly.
//   4. preload.ts exposes `cancelChatStream` mapped to
//      `ipcRenderer.send('gemini-chat-stream-stop')`; o binding é typed
//      em src/types/electron.d.ts.
//
// SEstratégia source-level static assertions. Driving o real streamChat
// generator iria pull em o entire LLMHelper módulo (Gemini SDK, Groq,
// OpenAI, Claude, Refract, RAG, knowledge orchestrator, modo loader,
// post-processor, …) que é impractical para a fast unit ttestar O static
// verifica abaixo catch qualquer regression onde o abort-gate, controlador
// supersession, para hmanipulador ou preload binding é removed ou weakened —
// que é exatamente o failure modo this fix pprevine

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const llmHelperPath = path.join(repoRoot, 'electron/LLMHelper.ts');
const ipcHandlersPath = path.join(repoRoot, 'electron/ipcHandlers.ts');
const preloadPath = path.join(repoRoot, 'electron/preload.ts');
const electronDtsPath = path.join(repoRoot, 'src/types/electron.d.ts');

const llmHelperSrc = readFileSync(llmHelperPath, 'utf8');
const ipcHandlersSrc = readFileSync(ipcHandlersPath, 'utf8');
const preloadSrc = readFileSync(preloadPath, 'utf8');
const electronDtsSrc = readFileSync(electronDtsPath, 'utf8');

// Brace-balancing corpo extractor (mirrors o auxiliar em
// MicRecoveryUsesCanonicalWiring.test.mjs). Extrai o corpo de o primeiro
// método matching `signatureRe` então assertions apenas aplica to that escopo and
// don't obtém false-positive matches de unrelated callsites elsewhere em
// o (47k-line) farquivo
function extractBalancedBody(src, signatureRe, label) {
    const m = signatureRe.exec(src);
    assert.ok(m, `could not locate ${label} signature`);
    // Encontra o primeiro '{' at ou após o match termina (gerencia multi-line sigs).
    let i = src.indexOf('{', m.index + m[0].length);
    assert.ok(i >= 0, `could not find opening brace for ${label}`);
    i++;
    const start = i;
    let depth = 1;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces while extracting ${label}`);
    return src.slice(start, i - 1);
}

// ---------------------------------------------------------------------------
// LLMHelper.streamChat — o public generator that gates yields em aabortar
// ---------------------------------------------------------------------------

const streamChatBody = extractBalancedBody(
    llmHelperSrc,
    /public\s+async\s*\*\s*streamChat\s*\(/,
    'LLMHelper.streamChat',
);

test('streamChat extracts trailing arg as AbortSignal via args[args.length - 1] and instanceof check', () => {
    // O exact extraction pattern: pull o último positional arg, narrow com
    // `instanceof AbortSignal`. Duck-typing em `.aborted` era o primeiro
    // implementation; we tightened to `instanceof` porque future params
    // (extraDataScopes, options objects) poderia accidentally ter an `aborted`
    // shape and qualquer um crash em acesso ou ser misclassified como a never-aborted
    // ssinal
    const hasLastArgLookup = /args\s*\[\s*args\.length\s*-\s*1\s*\]/.test(streamChatBody);
    const hasInstanceOfCheck = /instanceof\s+AbortSignal/.test(streamChatBody);
    assert.ok(
        hasLastArgLookup,
        'BUG: streamChat must extract the trailing positional arg via args[args.length - 1]. ' +
        'Without this, callers that pass an AbortSignal as the variadic trailing arg cannot ' +
        'cancel the generator, and supersession-discarded tokens keep streaming from the provider.',
    );
    assert.ok(
        hasInstanceOfCheck,
        'BUG: streamChat must narrow the trailing arg with `instanceof AbortSignal`. ' +
        'Without the instanceof check, a non-signal trailing arg (boolean / scope array / ' +
        'undefined) could either crash on .aborted access or be treated as a never-aborted signal.',
    );
});

test('streamChat declares an abortSignal local typed as AbortSignal', () => {
    // Sanity cverifica o extracted valor precisa ser bound to a local that o
    // for-await loop pode rreferência
    assert.ok(
        /const\s+abortSignal\s*=/.test(streamChatBody),
        'streamChat must bind the extracted signal to a const named abortSignal so the for-await loop can gate on it',
    );
    // O implementation qualquer um casts via `as AbortSignal` (duck-type variant)
    // ou narrows via `instanceof AbortSignal` ternary (current implementation).
    // Qualquer um é acceptable para tipo safety — ambos pin o local to AbortSignal.
    const hasInstanceOf = /instanceof\s+AbortSignal/.test(streamChatBody);
    const hasAsCast = /as\s+AbortSignal/.test(streamChatBody);
    assert.ok(
        hasInstanceOf || hasAsCast,
        'streamChat must narrow the trailing arg as AbortSignal (instanceof or as-cast) for type safety',
    );
});

test('streamChat gates each yield with `if (abortSignal?.aborted) return;` BEFORE yielding', () => {
    // O fix's load-bearing line. O verifica Precisa come antes o yield;
    // gating *aapós o yield iria let one already-discarded token escape
    // cada cancellation, que é exatamente o silent-discard regression.
    const gatePattern = /if\s*\(\s*abortSignal\s*\?\.\s*aborted\s*\)\s*return\s*;?/;
    assert.ok(
        gatePattern.test(streamChatBody),
        'BUG: streamChat must contain `if (abortSignal?.aborted) return;` inside the for-await ' +
        'loop. Without this gate the generator keeps yielding tokens after cancellation, which ' +
        'is the exact silent-discard bug this fix addresses.',
    );

    // Enforce ordering: o abortar verifica precisa appear antes o `yield`
    // statement dentro o loop bcorpo Match o actual yield statement
    // (yield followed por an identifier/call expression) em vez than o
    // substring "yield " que também appears em comments acima o loop.
    const gateIdx = streamChatBody.search(gatePattern);
    const yieldStmtRe = /(^|\n)\s*yield\s+\w/;
    const yieldMatch = yieldStmtRe.exec(streamChatBody);
    assert.ok(gateIdx >= 0, 'abort gate not found');
    assert.ok(yieldMatch, 'yield statement not found in streamChat body');
    assert.ok(
        gateIdx < yieldMatch.index,
        'BUG: abort gate must come BEFORE the yield. Gating after the yield lets one token ' +
        'leak through per cancellation — the exact silent-discard regression we are guarding against.',
    );

    // And ambos precisa live dentro a for-await loop sobre _streamChatInner.
    assert.ok(
        /for\s+await\s*\(\s*const\s+\w+\s+of\s+this\._streamChatInner\s*\(/.test(streamChatBody),
        'streamChat must iterate _streamChatInner via for-await; otherwise the abort gate has nothing to gate',
    );
});

// ---------------------------------------------------------------------------
// ipcHandlers — gemini-chat-stream cria a per-sender AbortController,
// aborta apenas that sender's prior stream em supersession, and passes o sinal to streamChat.
// ATambém gemini-chat-stream-stop é scoped to o sender that requested cancellation.
// ---------------------------------------------------------------------------

test('ipcHandlers tracks active gemini chat streams by sender id', () => {
    assert.ok(
        /const\s+_chatStreamsBySender\s*=\s*new\s+Map\s*</.test(ipcHandlersSrc),
        'BUG: ipcHandlers must track chat streams by event.sender.id so launcher and overlay streams cannot cancel each other.',
    );
    assert.ok(
        !/let\s+_chatStreamController\s*:\s*AbortController\s*\|\s*null\s*=\s*null/.test(ipcHandlersSrc),
        'BUG: a single module-scoped _chatStreamController reintroduces cross-renderer cancellation.',
    );
});

test('gemini-chat-stream handler supersedes only the current sender and passes signal to streamChat', () => {
    const handlerStart = ipcHandlersSrc.indexOf("'gemini-chat-stream'");
    assert.ok(handlerStart >= 0, "could not locate 'gemini-chat-stream' safeHandle registration");
    const handlerRegion = ipcHandlersSrc.slice(handlerStart, handlerStart + 12_000);

    assert.ok(
        /const\s+senderId\s*=\s*event\.sender\.id/.test(handlerRegion),
        'BUG: gemini-chat-stream handler must key stream ownership by event.sender.id.',
    );
    assert.ok(
        /const\s+priorStream\s*=\s*_chatStreamsBySender\.get\s*\(\s*senderId\s*\)/.test(handlerRegion),
        'BUG: gemini-chat-stream handler must look up only the current sender prior stream.',
    );
    assert.ok(
        /priorStream\.controller\.abort\s*\(\s*\)/.test(handlerRegion),
        'BUG: same-sender supersession must abort that sender\'s prior controller.',
    );
    assert.ok(
        /_chatStreamsBySender\.set\s*\(\s*senderId\s*,\s*\{\s*streamId\s*:\s*myStreamId\s*,\s*controller\s*:\s*myController\s*\}\s*\)/.test(handlerRegion),
        'BUG: gemini-chat-stream handler must store the fresh controller under senderId.',
    );
    assert.ok(
        /_chatStreamsBySender\.get\s*\(\s*senderId\s*\)\?\.streamId\s*!==\s*myStreamId/.test(handlerRegion),
        'BUG: supersession checks must compare against the current sender stream id, not a global active stream id.',
    );
    assert.ok(
        /llmHelper\.streamChat\s*\([\s\S]*?myController\.signal\s*,?\s*\)/.test(handlerRegion),
        'BUG: gemini-chat-stream handler must pass myController.signal to llmHelper.streamChat.',
    );
});

test('gemini-chat-stream-stop handler aborts only the requesting sender stream', () => {
    const stopRegPattern = /safeOn\s*\(\s*['"]gemini-chat-stream-stop['"]\s*,/;
    assert.ok(
        stopRegPattern.test(ipcHandlersSrc),
        "BUG: ipcMain.on('gemini-chat-stream-stop', ...) must be registered so the renderer's cancelChatStream can reach the main process.",
    );

    const stopHandlerBody = extractBalancedBody(
        ipcHandlersSrc,
        stopRegPattern,
        "gemini-chat-stream-stop handler",
    );
    assert.ok(
        /_chatStreamsBySender\.get\s*\(\s*senderId\s*\)/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop must look up the stream for the captured senderId only.',
    );
    assert.ok(
        /stream\.controller\.abort\s*\(\s*\)/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop handler must abort the sender-owned controller.',
    );
    assert.ok(
        /const\s+senderId\s*=\s*event\.sender\.id/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop must capture event.sender.id before cancelling.',
    );
    assert.ok(
        /_chatStreamsBySender\.delete\s*\(\s*senderId\s*\)/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop handler must remove only the sender-owned stream entry.',
    );
    assert.ok(
        !/_chatStreamsBySender\.clear\s*\(/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop must not clear streams owned by other renderers.',
    );
});

// ---------------------------------------------------------------------------
// preload.ts — cancelChatStream binding.
// ---------------------------------------------------------------------------

test('preload exposes cancelChatStream mapped to ipcRenderer.send("gemini-chat-stream-stop")', () => {
    // O binding precisa uso .envia (não .invoke) porque o main-side manipulador
    // é registered com ipcMain.on, não ipcMain.handle / safeHandle.
    const cancelBindingPattern =
        /cancelChatStream\s*:\s*\(\s*\)\s*=>\s*\{[\s\S]*?ipcRenderer\.send\s*\(\s*['"]gemini-chat-stream-stop['"]\s*\)/;
    assert.ok(
        cancelBindingPattern.test(preloadSrc),
        "BUG: preload.ts must expose cancelChatStream as () => ipcRenderer.send('gemini-chat-stream-stop'). " +
        'Using ipcRenderer.invoke would deadlock the renderer (no main-side handle), and any other ' +
        'channel name would silently miss the gemini-chat-stream-stop handler.',
    );
});

test('preload ElectronAPI interface and src/types/electron.d.ts both type cancelChatStream', () => {
    // Type-level binding em o preload module's iinterface
    assert.ok(
        /cancelChatStream\s*:\s*\(\s*\)\s*=>\s*void/.test(preloadSrc),
        'preload.ts ElectronAPI interface must declare `cancelChatStream: () => void`',
    );
    // And o renderer-facing tipo declaration. Sem this, renderer
    // callers (e.g., chat-overlay udesmontar obtém a tipo error and o
    // cancellation caminho é removed por o bbuild regressing o bug.
    assert.ok(
        /cancelChatStream\s*:\s*\(\s*\)\s*=>\s*void/.test(electronDtsSrc),
        'src/types/electron.d.ts must declare `cancelChatStream: () => void` so renderer code can call it type-safely',
    );
});
