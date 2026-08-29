// electron/rag/__tests__/GeminiProviderParsing.test.mjs
//
// Mandate #7: response-parsing / validation hardening para GeminiEmbeddingProvider v2,
// Sem network. We monkeypatch global.fetch to retorna canned Response-like objects
// and assert o pprovedor
//   - validateVector throws em wrong shape / wrong length / non-array / null,
//     and ACCEPTS a correct-length array (até com NaN — documents that NaN é Não
//     rejected, apenas shape/length são checked).
//   - embed/embedQuery throw em non-OK HTTP and nunca retorna a malformed vector.
//   - embedBatch: happy caminho mapeia 1:1; falls voltar to SERIAL em network error,
//     non-OK sstatus AND length mismatch — and o serial fallback ainda produces
//     exatamente texts.length validated vectors.
//   - embedBatch com a per-element malformed `values` THROWS (nunca silently armazena
//     a bad vector positionally mapped to o wrong chunk).
//   - o v2 wire contract: x-goog-api-key cabeçalho (Não a URL consulta param),
//     outputDimensionality em o bcorpo and o document/query prompt prefixes.
//
// Pure logic + busca stub → executa sob plain nó Ou electron.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const provPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/GeminiEmbeddingProvider.js');
const { GeminiEmbeddingProvider } = await import(pathToFileURL(provPath).href);

const DIMS = 768;
const goodVec = () => new Array(DIMS).fill(0).map((_, i) => (i % 7) * 0.01);

// Build a minimal Response-like objeto o provider's code caminho uses:
//   res.ok, res.status, res.statusText, res.json(), res.text()
function fakeRes({ ok = true, status = 200, statusText = 'OK', json = {}, text = '' } = {}) {
  return {
    ok, status, statusText,
    json: async () => json,
    text: async () => text,
  };
}

let realFetch;
let fetchCalls;
beforeEach(() => {
  realFetch = global.fetch;
  fetchCalls = [];
});
afterEach(() => { global.fetch = realFetch; });

// HAuxiliar define a busca manipulador that records o call and Retorna a scripted resposta
// (ou scripted sequence). `handler(url, init, callIndex)` Retorna a fakeRes / throws.
function stubFetch(handler) {
  global.fetch = async (url, init) => {
    const idx = fetchCalls.length;
    fetchCalls.push({ url, init });
    return handler(url, init, idx);
  };
}

describe('embed() — single document', () => {
  test('valid 768-dim response returns the vector', async () => {
    const p = new GeminiEmbeddingProvider('KEY', 'gemini-embedding-2', DIMS);
    const vec = goodVec();
    stubFetch(() => fakeRes({ json: { embedding: { values: vec } } }));
    const out = await p.embed('hello', { title: 'T' });
    assert.deepEqual(out, vec);
  });

  test('wire contract: api key in x-goog-api-key header, NOT the URL', async () => {
    const p = new GeminiEmbeddingProvider('SECRET_KEY', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: goodVec() } } }));
    await p.embed('hi');
    const { url, init } = fetchCalls[0];
    assert.ok(!String(url).includes('SECRET_KEY'), 'API key must NOT appear in the URL');
    assert.equal(init.headers['x-goog-api-key'], 'SECRET_KEY');
    assert.equal(init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(init.body);
    assert.equal(body.outputDimensionality, DIMS, 'outputDimensionality must be sent');
    assert.match(body.content.parts[0].text, /^title: .* \| text: /, 'document prompt prefix');
  });

  test('document prompt uses "none" title when none provided', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: goodVec() } } }));
    await p.embed('body text');
    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.content.parts[0].text, 'title: none | text: body text');
  });

  test('non-OK HTTP throws and returns NO vector', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ ok: false, status: 429, statusText: 'Too Many Requests', text: 'quota' }));
    await assert.rejects(() => p.embed('x'), /429|Too Many Requests/);
  });

  test('VALIDATION: wrong-length array throws (e.g. 512 dims when 768 expected)', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: new Array(512).fill(0) } } }));
    await assert.rejects(() => p.embed('x'), /expected 768-dim array, got 512/);
  });

  test('VALIDATION: non-array values throws', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: 'not-an-array' } } }));
    await assert.rejects(() => p.embed('x'), /expected 768-dim array, got string/);
  });

  test('VALIDATION: null values throws', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: null } } }));
    await assert.rejects(() => p.embed('x'), /expected 768-dim array, got object/);
  });

  test('VALIDATION: missing embedding object entirely throws (data?.embedding?.values undefined)', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: {} }));
    await assert.rejects(() => p.embed('x'), /expected 768-dim array, got undefined/);
  });

  test('DOCUMENTED GAP: a correct-LENGTH array containing NaN is ACCEPTED (validateVector checks shape/length only, not finiteness)', async () => {
    // O doc-comment para validateVector says "finite-number aarray mas o
    // implementation apenas verifica Array.isArray + length. A NaN/Infinity slips tatravés
    // This é low-severity (Gemini won't retorna NaN), mas it contradicts o comment;
    // asserting current behavior então a future finiteness verifica é a deliberate change.
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    const withNaN = goodVec(); withNaN[0] = NaN; withNaN[1] = Infinity;
    stubFetch(() => fakeRes({ json: { embedding: { values: withNaN } } }));
    const out = await p.embed('x');
    assert.ok(Number.isNaN(out[0]), 'NaN passed through (documented gap vs "finite-number" doc)');
    assert.equal(out[1], Infinity);
  });
});

describe('embedQuery() — asymmetric retrieval', () => {
  test('default query prompt uses "search result" task prefix', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: goodVec() } } }));
    await p.embedQuery('what is X?');
    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.content.parts[0].text, 'task: search result | query: what is X?');
  });

  test('code taskHint switches to "code retrieval" prefix', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: goodVec() } } }));
    await p.embedQuery('def foo', { taskHint: 'code' });
    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.content.parts[0].text, 'task: code retrieval | query: def foo');
  });

  test('embedQuery validates length too (short array throws)', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: [1, 2, 3] } } }));
    await assert.rejects(() => p.embedQuery('x'), /expected 768-dim array, got 3/);
  });
});

describe('embedBatch() — batchEmbedContents + fallbacks', () => {
  test('empty input returns [] without any fetch', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => { throw new Error('should not be called'); });
    assert.deepEqual(await p.embedBatch([]), []);
    assert.equal(fetchCalls.length, 0);
  });

  test('happy path: N inputs → N validated vectors, order preserved, ONE batch call', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    const v0 = goodVec().map(x => x + 0.0); const v1 = goodVec().map(x => x + 0.5);
    stubFetch((url) => {
      assert.match(String(url), /batchEmbedContents$/);
      return fakeRes({ json: { embeddings: [{ values: v0 }, { values: v1 }] } });
    });
    const out = await p.embedBatch(['a', 'b']);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], v0);
    assert.deepEqual(out[1], v1);
    assert.equal(fetchCalls.length, 1, 'one batch request, not serial');
  });

  test('NETWORK error on batch → falls back to SERIAL embedContent (N+1 fetches: 1 failed batch + N serial)', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) throw new Error('ECONNRESET'); // o batch tentar
      return fakeRes({ json: { embedding: { values: goodVec() } } }); // serial embeds
    });
    const out = await p.embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3, 'serial fallback produced exactly 3 vectors');
    assert.equal(fetchCalls.length, 4, '1 failed batch + 3 serial embedContent');
    assert.match(String(fetchCalls[1].url), /embedContent$/);
  });

  test('non-OK batch status → falls back to SERIAL', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) return fakeRes({ ok: false, status: 400, statusText: 'Bad Request', text: 'schema err' });
      return fakeRes({ json: { embedding: { values: goodVec() } } });
    });
    const out = await p.embedBatch(['a', 'b']);
    assert.equal(out.length, 2);
    assert.equal(fetchCalls.length, 3, '1 failed batch + 2 serial');
  });

  test('LENGTH MISMATCH (batch returns fewer vectors than inputs) → falls back to SERIAL (never positional-misalign)', async () => {
    // This é o silent-corruption gproteger a curto batch resposta iria caso contrário mapa
    // vector[i] to o WRONG chunk id. Provedor precisa reject o batch and re-embed serially.
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) return fakeRes({ json: { embeddings: [{ values: goodVec() }] } }); // 1 vec para 3 inputs
      return fakeRes({ json: { embedding: { values: goodVec() } } });
    });
    const out = await p.embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3, 'serial fallback recovered exactly 3 vectors');
    assert.equal(fetchCalls.length, 4, '1 misaligned batch + 3 serial');
  });

  test('batch returns non-array embeddings → falls back to SERIAL', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) return fakeRes({ json: { embeddings: null } });
      return fakeRes({ json: { embedding: { values: goodVec() } } });
    });
    const out = await p.embedBatch(['a']);
    assert.equal(out.length, 1);
    assert.equal(fetchCalls.length, 2);
  });

  test('batch with CORRECT length but a per-element malformed vector THROWS (never stores a misshaped vector)', async () => {
    // Length matches (2 para 2) então it faz Não fall bvoltar em vez disso cada elemento é
    // validated and a wrong-length elemento precisa throw — o positional armazenamento iria
    // caso contrário persist a 3-dim vector contra a chunk expecting 768.
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embeddings: [{ values: goodVec() }, { values: [1, 2, 3] }] } }));
    await assert.rejects(() => p.embedBatch(['a', 'b']), /embedBatch\[1\]: expected 768-dim array, got 3/);
  });

  test('batch element with null values THROWS with the element index', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embeddings: [{ values: null }, { values: goodVec() }] } }));
    await assert.rejects(() => p.embedBatch(['a', 'b']), /embedBatch\[0\]/);
  });

  test('serial fallback that ALSO fails propagates the error (no silent empty result)', async () => {
    // If o batch fails AND a serial embed fails, o error precisa surface então o
    // fila marks o item para tentar novamente — it precisa Não resolve com a short/empty aarray
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) throw new Error('batch down');
      return fakeRes({ ok: false, status: 500, statusText: 'ISE' }); // serial também fails
    });
    await assert.rejects(() => p.embedBatch(['a', 'b']), /500|ISE/);
  });
});
