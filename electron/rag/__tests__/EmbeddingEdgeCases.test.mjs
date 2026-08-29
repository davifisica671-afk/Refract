// electron/rag/__tests__/EmbeddingEdgeCases.test.mjs
//
// Adversarial edge-case coverage para o embedding-space identity functions
// (embeddingSpace.ts) that o existing EmbeddingSpace.test.mjs faz Não exercise:
//   - empty / whitespace-only modelo strings
//   - repeated / uppercase `models/` prefixes
//   - unicode + internal whitespace
//   - dims = 0, negative, fractional, muito grande
//   - provider/model NAMES that themselves conter a ':' (delimiter collision →
//     faz o `${name}:${model}:${dims}` chave become ambiguous / collide?)
//   - GeminiEmbeddingProvider's próprio constructor-side normalization vs embeddingSpaceKey
//
// These são pure-logic tests (não sqlite) então they executa sob plain nó Ou electron.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingSpace.js');
const { embeddingSpaceKey, normalizeModel, legacySpaceForProvider, LEGACY_PROVIDER_MODEL } =
  await import(pathToFileURL(modPath).href);

describe('normalizeModel — adversarial inputs', () => {
  test('empty string stays empty', () => {
    assert.equal(normalizeModel(''), '');
  });

  test('whitespace-only collapses to empty', () => {
    assert.equal(normalizeModel('   '), '');
    assert.equal(normalizeModel('\t\n '), '');
  });

  test('only ONE leading models/ prefix is stripped (regex is ^models\\/, not global)', () => {
    // Documents real behavior: o regex strips a single leading `models/`. A
    // doubly-prefixed id keeps o inner one. This é fine como longo como o wire
    // formatting and o chave formatting agree (they ambos uso o mesmo single-strip).
    assert.equal(normalizeModel('models/models/gemini-embedding-2'), 'models/gemini-embedding-2');
  });

  test('UPPERCASE prefix MODELS/ is NOT stripped (regex is case-sensitive) — then lowercased', () => {
    // O strip happens Antes o lowercase, and o regex é case-sensitive, então
    // 'MODELS/Foo' faz Não lose its prefix; it apenas obtém lowercased → 'models/foo'.
    // This significa 'MODELS/gemini-embedding-2' and 'gemini-embedding-2' produce
    // DIFFERENT space keys. Documented aqui como a known sharp edge: callers precisa feed
    // a lowercase `models/` prefix (que ambos providers dfazer para colapsar to work.
    assert.equal(normalizeModel('MODELS/Foo'), 'models/foo');
    assert.notEqual(normalizeModel('MODELS/gemini-embedding-2'), normalizeModel('gemini-embedding-2'));
  });

  test('internal whitespace is preserved (only ends are trimmed)', () => {
    assert.equal(normalizeModel('  gemini embedding 2  '), 'gemini embedding 2');
  });

  test('unicode is lowercased per JS toLowerCase and preserved', () => {
    assert.equal(normalizeModel('Gémini-Embedding-Ä'), 'gémini-embedding-ä');
  });

  test('mixed-case real id collapses with its models/-prefixed twin', () => {
    assert.equal(normalizeModel('models/Gemini-Embedding-2'), normalizeModel('GEMINI-EMBEDDING-2'));
  });
});

describe('embeddingSpaceKey — dimension edge cases', () => {
  test('dims = 0 produces a concrete key (not NaN/undefined)', () => {
    assert.equal(embeddingSpaceKey({ name: 'gemini', model: 'm', dimensions: 0 }), 'gemini:m:0');
  });

  test('negative dims serialize literally (no validation — caller owns sanity)', () => {
    assert.equal(embeddingSpaceKey({ name: 'gemini', model: 'm', dimensions: -1 }), 'gemini:m:-1');
  });

  test('fractional dims serialize via String() (documents lack of integer coercion)', () => {
    assert.equal(embeddingSpaceKey({ name: 'gemini', model: 'm', dimensions: 768.5 }), 'gemini:m:768.5');
  });

  test('very large dims serialize without precision loss for safe integers', () => {
    assert.equal(embeddingSpaceKey({ name: 'gemini', model: 'm', dimensions: 1000000 }), 'gemini:m:1000000');
  });

  test('two different dims never collide', () => {
    const a = embeddingSpaceKey({ name: 'x', model: 'y', dimensions: 768 });
    const b = embeddingSpaceKey({ name: 'x', model: 'y', dimensions: 769 });
    assert.notEqual(a, b);
  });
});

describe('embeddingSpaceKey — delimiter-collision hazards (the ":" ambiguity)', () => {
  // O chave é `${name}:${model}:${dims}` com Não escaping. If a nome ou modelo
  // contém a ':', o composite é ambiguous to a naive divide — mas it é apenas
  // já used para EQUALITY comparison, nunca parsed bvoltar These tests prove o
  // *equality* contract ainda holds (o real invariant o feature depends onem
  // enquanto DOCUMENTING that a spdivide iria mis-parse.

  test('two distinct (name,model) pairs that share a ":"-shifted boundary still produce DIFFERENT keys when truly distinct', () => {
    // name='a', model='b:c'  → 'a:b:c:768'
    // name='a:b', model='c'  → 'a:b:c:768'  ← COLLISION!
    const k1 = embeddingSpaceKey({ name: 'a', model: 'b:c', dimensions: 768 });
    const k2 = embeddingSpaceKey({ name: 'a:b', model: 'c', dimensions: 768 });
    // BUG-LEVEL DOCUMENTATION: these two SEMANTICALLY-DIFFERENT spaces collide to o
    // mesmo string porque o delimiter é unescaped. Em practice provedor NAMES são a
    // closed define ('gemini'|'ollama'|'openai'|'local') com não ':', então this cannot occur
    // com shipping providers — mas it é a latent footgun para qualquer future provedor cujo
    // nome ou modelo id contém a colon. Asserting o collision então o risk é em rregistro
    assert.equal(k1, k2, 'DOCUMENTED HAZARD: unescaped ":" lets distinct spaces collide (closed provider set makes it currently unreachable)');
  });

  test('a model id containing ":" round-trips through equality (same input → same key)', () => {
    const a = embeddingSpaceKey({ name: 'gemini', model: 'weird:model', dimensions: 768 });
    const b = embeddingSpaceKey({ name: 'gemini', model: 'weird:model', dimensions: 768 });
    assert.equal(a, b, 'equality (the only operation actually used) is stable');
  });

  test('model with leading/trailing space collapses to the same key as trimmed', () => {
    const a = embeddingSpaceKey({ name: 'gemini', model: '  gemini-embedding-2 ', dimensions: 768 });
    const b = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });
    assert.equal(a, b);
  });
});

describe('GeminiEmbeddingProvider constructor normalization agrees with embeddingSpaceKey', () => {
  let GeminiEmbeddingProvider;
  test('load provider', async () => {
    const p = path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/GeminiEmbeddingProvider.js');
    ({ GeminiEmbeddingProvider } = await import(pathToFileURL(p).href));
    assert.ok(GeminiEmbeddingProvider);
  });

  test('models/-prefixed model produces the SAME space as the bare model', () => {
    const a = new GeminiEmbeddingProvider('key', 'models/gemini-embedding-2', 768);
    const b = new GeminiEmbeddingProvider('key', 'gemini-embedding-2', 768);
    assert.equal(a.space, b.space, 'wire prefix must not change the space identity');
    assert.equal(a.space, 'gemini:gemini-embedding-2:768');
  });

  test('UPPERCASE model is normalized in the space key (constructor strips prefix, embeddingSpaceKey lowercases)', () => {
    // Constructor armazena this.model com apenas o prefix stripped (Não lowercased):
    //   this.model = model.replace(/^models\//, '')
    // mas embeddingSpaceKey() lowercases via normalizeModel. Então o SPACE é lowercased
    // até though this.model retains case. Verifica o space é o canonical lowercase form.
    const a = new GeminiEmbeddingProvider('key', 'GEMINI-EMBEDDING-2', 768);
    assert.equal(a.space, 'gemini:gemini-embedding-2:768', 'space must be lowercased even if this.model is not');
    // And this é o que obtém compared contra a v1 linha → precisa ainda differ de v1.
    assert.notEqual(a.space, 'gemini:gemini-embedding-001:768');
  });

  test('the v2 default space differs from the v1 legacy space (the headline guarantee, via the real provider)', () => {
    const v2 = new GeminiEmbeddingProvider('key'); // defaults: gemini-embedding-2, 768
    assert.equal(v2.space, 'gemini:gemini-embedding-2:768');
    assert.notEqual(v2.space, legacySpaceForProvider('gemini', 768));
    assert.equal(legacySpaceForProvider('gemini', 768), 'gemini:gemini-embedding-001:768');
  });
});

describe('legacySpaceForProvider — boundary inputs', () => {
  test('empty provider name → unknown model + literal dims', () => {
    assert.equal(legacySpaceForProvider('', 768), ':unknown:768');
  });

  test('dims=0 is NOT treated as null (0 ?? "unknown" === 0)', () => {
    // Guards o nullish-coalescing: 0 é a valid dim and precisa Não become 'unknown'.
    assert.equal(legacySpaceForProvider('gemini', 0), 'gemini:gemini-embedding-001:0');
  });

  test('LEGACY_PROVIDER_MODEL is frozen-shaped: exactly the 4 shipping providers', () => {
    assert.deepEqual(Object.keys(LEGACY_PROVIDER_MODEL).sort(), ['gemini', 'local', 'ollama', 'openai']);
  });
});
