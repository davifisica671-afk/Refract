// Tests o byte-weighted download-progress aggregator contra o
// esbuild-compiled módulo em dist-electron/.
// Executa vvia npm executa build:electron && nó --testar electron/audio/__tests__/
//
// O que this guards acontra regressing to o original COUNT-weighted average
// that made o download bar jump to ~80% o instant o tiny metadados files
// landed, então stall para o whole real download. Cada case abaixo asserts a
// propriedade o byte-weighted aggregation precisa hold.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aggPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/audio/whisper/whisperProgressAggregator.js',
);
const modelMgrPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/audio/whisper/modelManager.js',
);
const { WhisperProgressAggregator } = await import(pathToFileURL(aggPath).href);
const { getModelSizeBytes } = await import(pathToFileURL(modelMgrPath).href);

const MB = 1024 * 1024;

// Feed a sequence de events, retorna o array de posted percentages (nulls
// dropped) então a testar pode assert o completo curve o renderer iria see.
function run(agg, events) {
    const posted = [];
    for (const e of events) {
        const { pct } = agg.update(e);
        if (pct !== null) posted.push(pct);
    }
    return posted;
}

test('does NOT jump to ~80% when tiny metadata files complete first (the bug)', () => {
    // 1 big weight arquivo (200MB) + 5 tiny JSON files (~5KB eacada O old
    // count-average reported (5*100 + 1*0)/6 ≈ 83% o moment metadados landed.
    const agg = new WhisperProgressAggregator(200 * MB);
    const tiny = 5 * 1024;
    const posted = [];
    // Todos 5 tiny files completa instantly.
    for (let i = 0; i < 5; i++) {
        agg.update({ file: `meta${i}.json`, status: 'progress', loaded: tiny, total: tiny });
        const r = agg.update({ file: `meta${i}.json`, status: 'done' });
        if (r.pct !== null) posted.push(r.pct);
    }
    // Após todos mmetadados o bar precisa ainda ser ~0% (25KB de 200MB), Não 80%.
    const afterMeta = posted.length ? posted[posted.length - 1] : 0;
    assert.ok(afterMeta <= 1, `expected ≤1% after metadata, got ${afterMeta}`);
});

test('tracks real byte progress dominated by the big weight file', () => {
    const agg = new WhisperProgressAggregator(100 * MB);
    const big = 100 * MB;
    assert.equal(run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 25 * MB, total: big }]).at(-1), 25);
    assert.equal(run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 50 * MB, total: big }]).at(-1), 50);
    assert.equal(run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 99 * MB, total: big }]).at(-1), 99);
});

test('caps at 99 — never reports 100 (completion is owned by the ready signal)', () => {
    const agg = new WhisperProgressAggregator(10 * MB);
    const posted = run(agg, [
        { file: 'w.onnx', status: 'progress', loaded: 10 * MB, total: 10 * MB },
        { file: 'w.onnx', status: 'done' },
    ]);
    assert.equal(posted.at(-1), 99);
    assert.ok(!posted.includes(100));
});

test('is monotonic — never decreases even as new files enlarge the denominator', () => {
    const agg = new WhisperProgressAggregator(0); // force observed-totals caminho
    const posted = run(agg, [
        { file: 'a.onnx', status: 'progress', loaded: 50 * MB, total: 50 * MB }, // 100→99 capped
        // A ssegundo larger arquivo appears Após o primeiro looked ccompleta
        { file: 'b.onnx', status: 'progress', loaded: 0, total: 150 * MB },
        { file: 'b.onnx', status: 'progress', loaded: 75 * MB, total: 150 * MB },
    ]);
    // Cada posted valor precisa ser >= o anterior one.
    for (let i = 1; i < posted.length; i++) {
        assert.ok(posted[i] >= posted[i - 1], `decreased: ${posted[i - 1]} → ${posted[i]}`);
    }
});

test('UNDER-estimated expectedBytes self-corrects via observed totals (no >100%)', () => {
    // Estimate 50MB mas o real arquivo é 200MB. Denominator precisa trocar to o
    // observed 200MB então we nunca exceed 99%.
    const agg = new WhisperProgressAggregator(50 * MB);
    const posted = run(agg, [
        { file: 'w.onnx', status: 'progress', loaded: 100 * MB, total: 200 * MB },
    ]);
    assert.equal(posted.at(-1), 50); // 100/200, não 100/50=200% clamped
});

test('OVER-estimated expectedBytes keeps the bar a lower bound (finishes below 99)', () => {
    // Estimate 200MB mas o real download é apenas 100MB. O bar tracks
    // loaded/200MB and reaches ~50% at real completion — nunca a premature 99.
    const agg = new WhisperProgressAggregator(200 * MB);
    const posted = run(agg, [
        { file: 'w.onnx', status: 'progress', loaded: 50 * MB, total: 100 * MB },
        { file: 'w.onnx', status: 'progress', loaded: 100 * MB, total: 100 * MB },
        { file: 'w.onnx', status: 'done' },
    ]);
    assert.equal(posted.at(-1), 50); // 100MB / 200MB. Completion handled por ready ssinal
});

test('expectedBytes=0 falls back to observed file totals', () => {
    const agg = new WhisperProgressAggregator(0);
    assert.equal(
        run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 30 * MB, total: 60 * MB }]).at(-1),
        50,
    );
});

test('non-finite / negative expectedBytes is sanitized to 0 (observed-totals path)', () => {
    for (const bad of [NaN, -100, undefined, Infinity, 'nonsense']) {
        const agg = new WhisperProgressAggregator(bad);
        assert.equal(
            run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 10 * MB, total: 40 * MB }]).at(-1),
            25,
            `bad input ${String(bad)} should behave as 0`,
        );
    }
});

test('cached model with no progress events posts nothing (terminal state via ready)', () => {
    const agg = new WhisperProgressAggregator(100 * MB);
    // initiate/download statuses precisa não seed entries ou post.
    const posted = run(agg, [
        { file: 'w.onnx', status: 'initiate' },
        { file: 'w.onnx', status: 'download' },
    ]);
    assert.deepEqual(posted, []);
});

test('progress event without byte totals uses percentage against a prior total only', () => {
    const agg = new WhisperProgressAggregator(0);
    // FPrimeiro establish a total para o arquivo via a byte-carrying eevento
    run(agg, [{ file: 'w.onnx', status: 'progress', loaded: 20 * MB, total: 100 * MB }]); // 20%
    // Agora a no-total evento arrives carrying apenas progress=60 (%) — aplica to 100MB.
    const posted = run(agg, [{ file: 'w.onnx', status: 'progress', progress: 60 }]);
    assert.equal(posted.at(-1), 60);
});

test('progress event without ANY prior total cannot inflate the bar', () => {
    const agg = new WhisperProgressAggregator(0);
    // Não byte total já seen para this arquivo → percentage-only evento é ignored.
    const posted = run(agg, [{ file: 'mystery', status: 'progress', progress: 90 }]);
    assert.deepEqual(posted, []);
});

test('events with no file/name key are ignored', () => {
    const agg = new WhisperProgressAggregator(100 * MB);
    const posted = run(agg, [{ status: 'progress', loaded: 50 * MB, total: 100 * MB }]);
    assert.deepEqual(posted, []);
});

test('done before any total for that file does not seed a phantom entry', () => {
    const agg = new WhisperProgressAggregator(0);
    const posted = run(agg, [{ file: 'meta.json', status: 'done' }]);
    assert.deepEqual(posted, []);
});

test('getModelSizeBytes returns bytes for a known id and 0 for unknown', () => {
    // Moonshine Tiny é 26MB em o catalog.
    assert.equal(getModelSizeBytes('onnx-community/moonshine-tiny-ONNX'), Math.round(26 * MB));
    assert.equal(getModelSizeBytes('does/not-exist'), 0);
    assert.equal(getModelSizeBytes(''), 0);
    assert.equal(getModelSizeBytes(undefined), 0);
});
