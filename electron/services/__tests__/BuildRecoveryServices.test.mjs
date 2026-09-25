import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AntigravityService,
  initializeAntigravityLifecycle,
} from '../../../dist-electron/electron/services/AntigravityService.js';
import { readCodexModelCatalog } from '../../../dist-electron/electron/services/CodexModelCatalog.js';
import { CodexOAuthService } from '../../../dist-electron/electron/services/CodexOAuthService.js';
import { describeServiceAccountRejection } from '../../../dist-electron/electron/services/googleServiceAccount.js';
import { KnowledgeManager } from '../../../dist-electron/electron/services/knowledge/KnowledgeManager.js';
import { queryOkfCards } from '../../../dist-electron/electron/services/knowledge/OkfRetriever.js';
import { classifyQuestion } from '../../../dist-electron/electron/services/knowledge/QuestionClassifier.js';
import {
  getLatestLocalFallbackPreflight,
  runLocalFallbackPreflight,
} from '../../../dist-electron/electron/services/LocalFallbackPreflight.js';
import {
  RERANK_CANDIDATE_POOL,
  resolveRerankPoolSize,
} from '../../../dist-electron/electron/services/modes/rerankPool.js';
import { ProviderStatusRegistry } from '../../../dist-electron/electron/services/ProviderStatusRegistry.js';
import { lookupKnownModelSupport } from '../../../dist-electron/electron/services/reranking/knownModelSupport.js';
import { buildRerankProbe } from '../../../dist-electron/electron/services/reranking/rerankProbe.js';
import {
  statusOf,
  listCatalogStatus,
  installCatalogModel,
  removeCatalogModel,
} from '../../../dist-electron/electron/services/reranking/localModelInstaller.js';
import { OpenRouterReranker } from '../../../dist-electron/electron/services/reranking/OpenRouterReranker.js';
import {
  DEFAULT_RERANKER_SETTINGS,
  evaluateHostedEligibility,
  describeIneligibility,
  isLocalOnlyMode,
  referenceFilesScopeAllowed,
  readHostedApiKey,
  readHostedModel,
  customRerankPrivacyBlock,
  resetLocalGgufPort,
  buildLocalGgufPort,
} from '../../../dist-electron/electron/services/reranking/rerankerConfig.js';
import { SAFE_DOCUMENT_EXTENSIONS } from '../../../dist-electron/electron/services/SafeDocumentTextExtractor.js';
import {
  hashImageSet,
  getScreenshotDescription,
  getDescriptionForImageSet,
} from '../../../dist-electron/electron/services/screen/ScreenshotDescriptionStore.js';
import { DEFAULT_BUILTIN_SKILL_IDS } from '../../../dist-electron/electron/services/skills/SkillValidator.js';
import {
  PAGE_CAPTURE_FALLBACK_CHANNEL,
  PAGE_CAPTURE_STARTED_CHANNEL,
} from '../../../dist-electron/electron/services/pageCaptureFallback.js';

test('AntigravityService: signed out, no models, login throws, lifecycle noop', async () => {
  assert.equal(typeof initializeAntigravityLifecycle, 'function');
  const a = AntigravityService.getInstance();
  assert.equal(AntigravityService.getInstance(), a);
  assert.deepEqual(a.getStatus(), { signedIn: false });
  assert.deepEqual(await a.getModels(), []);
  assert.deepEqual(await a.getModels(true), []);
  await assert.rejects(() => a.startLogin(), /unavailable/i);
  await a.cancelLogin();
  assert.deepEqual(await a.signOut(), { success: false, error: 'not-available' });
  assert.doesNotThrow(() => initializeAntigravityLifecycle({}, () => undefined, () => undefined));
});

test('CodexModelCatalog: unavailable with empty models (degraded)', async () => {
  assert.deepEqual(await readCodexModelCatalog(), { available: false, models: [] });
});

test('CodexOAuthService: singleton, silent on(), login throws, signOut noop', async () => {
  const oauth = CodexOAuthService.getInstance();
  assert.equal(CodexOAuthService.getInstance(), oauth);
  let fired = 0;
  assert.doesNotThrow(() => {
    oauth.on('login:complete', () => { fired += 1; });
    oauth.on('login:failed', () => { fired += 1; });
  });
  assert.equal(fired, 0);
  await assert.rejects(() => oauth.startLogin(), /unavailable/i);
  assert.doesNotThrow(() => oauth.signOut());
  assert.deepEqual(oauth.getStatus(), { configured: false });
});

test('googleServiceAccount: rejection message names the reason (pass-through)', () => {
  const msg = describeServiceAccountRejection('missing-file');
  assert.ok(msg.includes('missing-file'));
  assert.ok(describeServiceAccountRejection('').length > 0);
});

test('KnowledgeManager: null pack, no packs, ungenerated file (degraded)', () => {
  const km = KnowledgeManager.getInstance();
  assert.equal(KnowledgeManager.getInstance(), km);
  assert.equal(km.getPackForFile('file-1'), null);
  assert.deepEqual(km.getPacksForMode('mode-1'), []);
  const result = km.generateForFile({ id: 'file-1' }, true);
  assert.equal(result.pack, null);
  assert.notEqual(result.status, 'generated');
});

test('OkfRetriever: no cards (sync empty, degraded)', () => {
  assert.deepEqual(queryOkfCards(null, 'what is this?', { targetEntities: [] }, { topN: 6, fileId: 'f' }), []);
});

test('QuestionClassifier: no target entities (sync, degraded)', () => {
  assert.deepEqual(classifyQuestion('What is the capital of France?'), { targetEntities: [] });
});

test('LocalFallbackPreflight: unavailable snapshot + run (degraded)', async () => {
  const latest = getLatestLocalFallbackPreflight();
  assert.equal(latest.status, 'unavailable');
  assert.ok(typeof latest.checkedAt === 'number');
  const ran = await runLocalFallbackPreflight({ ollamaSelected: true });
  assert.equal(ran.status, 'unavailable');
  assert.ok(typeof ran.checkedAt === 'number');
});

test('rerankPool: pool const + resolver agree (degraded)', () => {
  assert.equal(RERANK_CANDIDATE_POOL, 3);
  assert.equal(resolveRerankPoolSize(), RERANK_CANDIDATE_POOL);
});

test('ProviderStatusRegistry: empty list + unknown status (degraded)', () => {
  const reg = ProviderStatusRegistry.getInstance();
  assert.equal(ProviderStatusRegistry.getInstance(), reg);
  assert.deepEqual(reg.getAll(), []);
  assert.deepEqual(reg.getStatus('openai'), { status: 'unknown' });
});

test('knownModelSupport: unknown repo is null (degraded)', () => {
  assert.equal(lookupKnownModelSupport('org/some-model'), null);
});

test('rerankProbe: canonical 3-doc probe (degraded)', () => {
  const probe = buildRerankProbe(3);
  assert.equal(probe.query, 'probe');
  assert.equal(probe.documents.length, 3);
  assert.equal(probe.expectedIndex, 0);
});

test('localModelInstaller: sync list/status/remove + failing install (degraded)', async () => {
  assert.deepEqual(listCatalogStatus(), []);
  assert.deepEqual(statusOf({ id: 'x' }), { state: 'unavailable', missing: [] });
  assert.deepEqual(removeCatalogModel('x'), { ok: false, error: 'not-available' });
  const installed = await installCatalogModel('x', () => undefined, new AbortController().signal);
  assert.equal(installed.ok, false);
});

test('OpenRouterReranker: constructs, rerank throws typed error (degraded)', async () => {
  const reranker = new OpenRouterReranker({
    baseUrl: 'https://example.invalid',
    providerId: 'openrouter',
    allowAnonymousApiKey: false,
    getApiKey: () => null,
    getModel: () => 'model',
  });
  await assert.rejects(() => reranker.rerankOrThrow('q', ['a', 'b']), /unavailable/i);
});

test('rerankerConfig: hosted ineligible, no keys, gguf port null (degraded)', () => {
  assert.equal(DEFAULT_RERANKER_SETTINGS.provider, 'local');
  assert.equal(isLocalOnlyMode(), false);
  assert.equal(referenceFilesScopeAllowed(), false);
  assert.equal(readHostedApiKey('openrouter'), null);
  assert.equal(readHostedModel({}), null);
  const eligibility = evaluateHostedEligibility({ provider: 'openrouter', hasApiKey: false });
  assert.equal(eligibility.eligible, false);
  assert.ok(describeIneligibility('not-available').length > 0);
  assert.equal(
    customRerankPrivacyBlock({ localOnly: false, referenceFilesScopeAllowed: false }),
    null,
  );
  assert.doesNotThrow(() => resetLocalGgufPort());
  assert.equal(buildLocalGgufPort(), null);
});

test('SafeDocumentTextExtractor: dot-prefixed allow-list covers dialog filters', () => {
  for (const ext of ['.txt', '.md', '.json', '.csv', '.pdf', '.docx']) {
    assert.ok(SAFE_DOCUMENT_EXTENSIONS.includes(ext), `allow-list must contain ${ext}`);
  }
  for (const ext of SAFE_DOCUMENT_EXTENSIONS) {
    assert.ok(ext.startsWith('.'), `${ext} must be dot-prefixed (call sites slice(1))`);
  }
  assert.deepEqual(
    [...SAFE_DOCUMENT_EXTENSIONS].map((extension) => extension.slice(1)).slice(0, 1),
    [SAFE_DOCUMENT_EXTENSIONS[0].slice(1)],
  );
});

test('ScreenshotDescriptionStore: always miss (cache absent, degraded)', () => {
  assert.equal(hashImageSet(['/tmp/a.png']), null);
  assert.equal(getScreenshotDescription('key'), null);
  assert.equal(getDescriptionForImageSet(['/tmp/a.png']), null);
});

test('SkillValidator: no built-in ids (degraded)', () => {
  assert.deepEqual(DEFAULT_BUILTIN_SKILL_IDS, []);
});

test('pageCaptureFallback: distinct non-empty channels', () => {
  assert.equal(PAGE_CAPTURE_FALLBACK_CHANNEL, 'page-capture-fallback');
  assert.equal(PAGE_CAPTURE_STARTED_CHANNEL, 'page-capture-started');
  assert.notEqual(PAGE_CAPTURE_FALLBACK_CHANNEL, PAGE_CAPTURE_STARTED_CHANNEL);
});
