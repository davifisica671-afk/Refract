import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isBundledLocalModelId } from '../../../dist-electron/electron/rag/bundledLocalEmbedding.js';
import {
  listCustomEmbeddingModels,
  probeCustomEmbeddingDimensions,
} from '../../../dist-electron/electron/rag/customEmbeddingModels.js';
import { listCustomRerankModels } from '../../../dist-electron/electron/rag/customRerankModels.js';
import { buildEmbeddingCatalog } from '../../../dist-electron/electron/rag/embeddingCatalog.js';
import { buildEmbeddingConfig } from '../../../dist-electron/electron/rag/embeddingConfigIdentity.js';
import {
  BUNDLED_CATALOG_ID,
  findEmbeddingCatalogModel,
} from '../../../dist-electron/electron/rag/embeddingModelCatalog.js';
import { fetchEmbeddingModels } from '../../../dist-electron/electron/rag/embeddingModelFetch.js';
import { validateEmbeddingSelection } from '../../../dist-electron/electron/rag/embeddingSelection.js';
import { shouldWarnAboutLightweightEmbeddings } from '../../../dist-electron/electron/rag/embeddingStatus.js';
import {
  HOSTED_RERANK_PROVIDERS,
  hostedRerankProvider,
} from '../../../dist-electron/electron/rag/hostedRerankProviders.js';
import {
  getLocalReranker,
  reloadLocalReranker,
  clearLocalRerankerPoison,
} from '../../../dist-electron/electron/rag/LocalReranker.js';
import { listNinerouterEmbeddingModels } from '../../../dist-electron/electron/rag/ninerouterEmbeddingModels.js';
import {
  listOllamaEmbeddingModels,
  probeOllamaEmbeddingDimensions,
} from '../../../dist-electron/electron/rag/ollamaEmbeddingModels.js';
import {
  listOpenRouterEmbeddingModels,
  probeOpenRouterEmbeddingDimensions,
} from '../../../dist-electron/electron/rag/openrouterEmbeddingModels.js';
import {
  listOpenRouterRerankModels,
  CATALOG_TTL_MS,
} from '../../../dist-electron/electron/rag/openrouterRerankModels.js';
import { normalizeCustomBaseUrl } from '../../../dist-electron/electron/rag/providers/CustomEmbeddingProvider.js';
import {
  BUILT_IN_RERANKER,
  findCatalogModel,
} from '../../../dist-electron/electron/rag/rerankerModelCatalog.js';
import { probeVoyageEmbeddingDimensions } from '../../../dist-electron/electron/rag/voyageEmbeddingModels.js';
import {
  listEmbeddingCatalogStatus,
  installEmbeddingCatalogModel,
  removeEmbeddingCatalogModel,
  statusOf,
  revealLocalEmbeddingModelsDirectory,
} from '../../../dist-electron/electron/services/embeddings/localEmbeddingModelInstaller.js';
import { getExtensionManager } from '../../../dist-electron/electron/services/extensions/appWiring.js';
import {
  stageFromDirectory,
  fetchRemoteRegistry,
} from '../../../dist-electron/electron/services/extensions/ExtensionInstaller.js';
import { HuggingFaceModelDownloader } from '../../../dist-electron/electron/services/extensions/HuggingFaceModelDownloader.js';
import { getLicenseLedger } from '../../../dist-electron/electron/services/extensions/LicenseLedger.js';
import { ModelStore } from '../../../dist-electron/electron/services/extensions/ModelStore.js';

test('bundledLocalEmbedding: unknown id is not a bundled model', () => {
  assert.equal(isBundledLocalModelId('anything-at-all'), false);
});

test('customEmbeddingModels: empty list + null dimensions (degraded)', async () => {
  assert.deepEqual(await listCustomEmbeddingModels('http://localhost:1234', 'key'), []);
  assert.equal(await probeCustomEmbeddingDimensions('http://localhost:1234', 'model', 'key'), null);
});

test('customRerankModels: empty list (degraded)', async () => {
  assert.deepEqual(await listCustomRerankModels('http://localhost:1234', 'key'), []);
});

test('embeddingCatalog: builds an empty provider list (degraded)', () => {
  const providers = buildEmbeddingCatalog({
    ollamaReachable: false,
    ollamaModels: [],
    customEndpoint: '',
    customModels: [],
    hasOpenrouterKey: false,
    hasVoyageKey: false,
    openrouterModels: [],
    ninerouterModels: [],
    fetchedModels: {},
  });
  assert.ok(Array.isArray(providers));
  assert.equal(providers.length, 0);
});

test('embeddingConfigIdentity: returns overrides as config', () => {
  assert.deepEqual(buildEmbeddingConfig(), {});
  assert.deepEqual(buildEmbeddingConfig({ ollamaUrl: 'http://x:11434' }), { ollamaUrl: 'http://x:11434' });
});

test('embeddingModelCatalog: bundled id const + unknown model is null', () => {
  assert.equal(BUNDLED_CATALOG_ID, 'bundled-local');
  assert.equal(findEmbeddingCatalogModel('nope'), null);
});

test('embeddingModelFetch: empty list (degraded)', async () => {
  assert.deepEqual(await fetchEmbeddingModels('openai', 'key'), []);
});

test('embeddingSelection: default allow (graceful open)', () => {
  assert.deepEqual(validateEmbeddingSelection('openai', []), { ok: true });
});

test('embeddingStatus: never warns (degraded)', () => {
  assert.equal(
    shouldWarnAboutLightweightEmbeddings({ embeddingSpace: 'x', generationProviders: ['openai'], acknowledged: false }),
    false,
  );
});

test('hostedRerankProviders: empty catalog + null lookup (degraded)', () => {
  assert.deepEqual(HOSTED_RERANK_PROVIDERS, {});
  assert.equal(hostedRerankProvider('openrouter'), null);
});

test('LocalReranker: degraded handle with async methods + no-op reload/clear', async () => {
  const local = getLocalReranker();
  assert.equal(await local.isCached(), false);
  assert.equal(local.isLoaded(), false);
  assert.deepEqual(await local.rerank('q', ['a', 'b']), []);
  assert.doesNotThrow(() => reloadLocalReranker('test'));
  assert.doesNotThrow(() => clearLocalRerankerPoison());
});

test('ninerouterEmbeddingModels: empty list (degraded)', async () => {
  assert.deepEqual(await listNinerouterEmbeddingModels({ baseUrl: 'http://x', apiKey: 'k' }), []);
});

test('ollamaEmbeddingModels: empty list + null dimensions (degraded)', async () => {
  assert.deepEqual(await listOllamaEmbeddingModels('http://localhost:11434'), []);
  assert.equal(await probeOllamaEmbeddingDimensions('http://localhost:11434', 'model'), null);
});

test('openrouterEmbeddingModels: empty list + null dimensions (degraded)', async () => {
  assert.deepEqual(await listOpenRouterEmbeddingModels({ apiKey: 'k' }), []);
  assert.equal(await probeOpenRouterEmbeddingDimensions('model', 'k'), null);
});

test('openrouterRerankModels: empty list + ttl const (degraded)', async () => {
  assert.deepEqual(await listOpenRouterRerankModels({ apiKey: 'k' }), []);
  assert.equal(CATALOG_TTL_MS, 5 * 60 * 1000);
});

test('CustomEmbeddingProvider: trims + strips trailing slashes (pass-through)', () => {
  assert.equal(normalizeCustomBaseUrl('http://localhost:1234/v1///'), 'http://localhost:1234/v1');
  assert.equal(normalizeCustomBaseUrl('  http://x  '), 'http://x');
});

test('rerankerModelCatalog: built-in const + unknown model is null', () => {
  assert.equal(BUILT_IN_RERANKER.id, 'built-in');
  assert.equal(BUILT_IN_RERANKER.name, 'Built-in');
  assert.equal(findCatalogModel('nope'), null);
});

test('voyageEmbeddingModels: null dimensions (degraded)', async () => {
  assert.equal(await probeVoyageEmbeddingDimensions('model', 'k'), null);
});

test('localEmbeddingModelInstaller: sync list/status/remove + failing install + closed folder', async () => {
  assert.deepEqual(listEmbeddingCatalogStatus(), []);
  assert.deepEqual(statusOf({ id: 'x' }), { state: 'unavailable', missing: [] });
  assert.deepEqual(removeEmbeddingCatalogModel('x'), { ok: false });
  const installed = await installEmbeddingCatalogModel('x', () => undefined, new AbortController().signal);
  assert.equal(installed.ok, false);
  assert.equal(await revealLocalEmbeddingModelsDirectory(), false);
});

test('appWiring: no extension manager (degraded)', () => {
  assert.equal(getExtensionManager(), null);
});

test('ExtensionInstaller: refused stage (sync) + failed registry fetch', async () => {
  const staged = stageFromDirectory('/nonexistent');
  assert.equal(staged.ok, false);
  assert.equal(staged.manifestJson, null);
  assert.equal(staged.payloadDir, null);
  const remote = await fetchRemoteRegistry('https://example.invalid/registry.json');
  assert.equal(remote.ok, false);
  assert.deepEqual(remote.entries, []);
});

test('HuggingFaceModelDownloader: constructs (degraded)', () => {
  const dl = new HuggingFaceModelDownloader({ logger: console });
  assert.ok(dl instanceof HuggingFaceModelDownloader);
});

test('LicenseLedger: nothing acknowledged (degraded)', () => {
  const ledger = getLicenseLedger();
  assert.equal(ledger.hasAcknowledged('ext', 'model', 'MIT'), false);
  assert.doesNotThrow(() => ledger.acknowledge('ext', 'model', 'MIT'));
});

test('ModelStore: unavailable status + failed download (degraded)', async () => {
  const store = new ModelStore({});
  assert.equal(store.status('ext', { key: 'm' }).state, 'unavailable');
  const dl = new HuggingFaceModelDownloader({ logger: console });
  const store2 = new ModelStore({ downloader: dl });
  const result = await store2.download('ext', { key: 'm' }, () => undefined, new AbortController().signal);
  assert.equal(result.ok, false);
});
