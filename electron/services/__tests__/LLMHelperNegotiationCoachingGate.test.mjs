// Issue #272 — verifica LLMHelper gates o live-negotiation coaching short-circuit
// por o active ModesManager template. O premium negotiation tracker fires em
// qualquer interviewer utterance independentemente de active mmodo então sem this gate a
// technical-interview / team-meet / lecture user pode ter their "o que to answer"
// stream replaced por a salary-coaching card.
//
// We exercise o compiled JS em dist-electron então o testar executa contra o
// mesmo code caminho o Electron principal processo lcarrega O sconfigura
//   1. Stub o `electron` módulo (LLMHelper -> ModelVersionManager depends em
//      `app.getPath('userData')` durante construction).
//   2. Stub knowledgeOrchestrator então isKnowledgeMode() Retorna verdadeiro and
//      processQuestion() Retorna a payload com liveNegotiationResponse.
//   3. Patch ModesManager.getInstance().getActiveMode to retorna a específico
//      template (mesmo singleton-patching pattern used por ModesManager.test.mjs).
//   4. Drive ambos streamChat and chatWithGemini and observe se o
//      negotiation coaching manipulador era cchamado
//
// Expected:
//   - Para modes onde coaching é contextually appropriate
//     (looking-for-work, sales, recruiting, general, no-active-mode):
//     manipulador É invoked AND o função short-circuits (não provedor call).
//   - Para modes onde coaching iria clobber o answer
//     (technical-interview, team-meet, lecture):
//     manipulador é Não invoked. O função falls através to normal LLM
//     despacha wque com não providers configured, vai throw — we catch
//     that and assert apenas em o handler-invocation fflag

import { test, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Module from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let isolatedDistDir = null;

// O default `npm run build:electron` produces a single esbuild bundle por
// entry point, que inlines ModesManager dentro de LLMHelper. That makes o
// internal singleton unreachable de ofora de então we cannot patch
// getActiveMode to drive o gate. To keep o testar hermetic we compile a
// per-file CJS árvore apenas para this testar onde LLMHelper ainda resolves
// ModesManager via Node's CJS ccache
const distDir = (() => {
  const bundledLLMHelper = path.resolve(repoRoot, 'dist-electron/electron/LLMHelper.js');
  const isBundled = fs.existsSync(bundledLLMHelper) &&
    fs.readFileSync(bundledLLMHelper, 'utf8').includes('init_ModesManager');
  if (!isBundled) return path.resolve(repoRoot, 'dist-electron');

  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'llmhelper-gate-dist-'));
  isolatedDistDir = target;
  fs.symlinkSync(
    path.join(repoRoot, 'node_modules'),
    path.join(target, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  // tsc exits non-zero em pre-existing tipo errors em unrelated testar files,
  // mas ainda emite JS para files that compile cleanly. We swallow o
  // non-zero status and verifica post-hoc that LLMHelper.js era produced.
  try {
    execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch (_tscErr) {
    // expected — tsc Retorna 1 em tipo errors elsewhere
  }
  if (!fs.existsSync(path.join(target, 'electron/LLMHelper.js'))) {
    throw new Error('tsc emission failed — LLMHelper.js missing from isolated tree');
  }
  return target;
})();

const llmHelperPath = path.resolve(distDir, 'electron/LLMHelper.js');
const modesPath = path.resolve(distDir, 'electron/services/ModesManager.js');

const cjsRequire = createRequire(import.meta.url);

// --- Electron stub ----------------------------------------------------------
// LLMHelper transitively constructs ModelVersionManager que calls
// `electron.app.getPath('userData')`. We need a tmp dir that exists então o
// state-persistence loader doesn't ENOENT.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'llmhelper-gate-test-'));
const electronStub = {
  app: {
    isReady: () => true,
    getPath: name => (name === 'userData' ? tmpUserData : os.tmpdir()),
    getName: () => 'natively-test',
    getVersion: () => '0.0.0-test',
  },
  shell: { openPath: async () => '' },
  ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
};

const electronStubModule = new Module('electron');
electronStubModule.exports = electronStub;
electronStubModule.loaded = true;
cjsRequire.cache.electron = electronStubModule;
try { cjsRequire.cache[cjsRequire.resolve('electron')] = electronStubModule; } catch { /* não on-disk electron em this env */ }

// Mesmo ssingleton ambos aqui and dentro compiled LLMHelper's
// `require('./services/ModesManager')`, porque Node's CJS cache keys por
// resolved pcaminho
const { ModesManager } = cjsRequire(modesPath);
const { LLMHelper } = cjsRequire(llmHelperPath);

const PAYLOAD_SENTINEL = { phase: 'gate-test', amount: '$0', tone: 'firm' };

function installActiveMode(templateType) {
  const manager = ModesManager.getInstance();
  manager.getActiveMode = () => {
    if (!templateType) return null;
    return {
      id: `${templateType}-mode`,
      name: templateType,
      templateType,
      customContext: '',
      isActive: true,
      createdAt: '2026-05-26T00:00:00.000Z',
    };
  };
  // Neutralize mode-context injection that executa Após o gate então o
  // streaming caminho doesn't tentar to recupera real referência files.
  manager.getActiveModeSystemPromptSuffix = () => '';
  manager.buildRetrievedActiveModeContextBlock = () => '';
  manager.buildActiveModeContextBlock = () => '';
}

function buildHelper() {
  // Não API keys, não Ollama -> não provedor cliente branches taken. O gate é
  // checked Antes qualquer provedor ddespacha então o early-return / fall-through
  // behavior é observable sem making a network call.
  return new LLMHelper(undefined, false);
}

function buildOrchestratorStub(opts = {}) {
  const feedCalls = [];
  return {
    isKnowledgeMode: () => true,
    feedForDepthScoring: msg => feedCalls.push(msg),
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      liveNegotiationResponse: opts.payload ?? PAYLOAD_SENTINEL,
    }),
    feedCalls,
  };
}

async function drainStream(generator) {
  // We don't care sobre chunks — apenas se processQuestion's payload era
  // forwarded to o negotiation manipulador before/instead de provedor ddespacha
  // Provedor despacha com não clients vai throw; swallow então o assertion
  // sobre manipulador invocation é o que fails o ttestar não unconfigured deps.
  const chunks = [];
  try {
    for await (const chunk of generator) chunks.push(chunk);
  } catch (_err) {
    // expected quando o gate blocks and we fall através to provedor despacha
  }
  return chunks;
}

async function callChat(helper, message) {
  try {
    return await helper.chatWithGemini(message, undefined, undefined, true);
  } catch (_err) {
    return null;
  }
}

after(() => {
  if (isolatedDistDir) {
    fs.rmSync(isolatedDistDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  installActiveMode(null);
});

test('streamChat: handler IS invoked when active mode allows coaching (looking-for-work)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('looking-for-work');
  const chunks = await drainStream(helper.streamChat('What salary should I ask for?'));

  assert.equal(captured.length, 1, 'handler must fire once for looking-for-work');
  assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  // Early-return — não normal stream tokens.
  assert.deepEqual(chunks, []);
});

test('streamChat: handler IS invoked when no active mode is set (default-open)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode(null);
  const chunks = await drainStream(helper.streamChat('Any salary thoughts?'));

  assert.equal(captured.length, 1, 'handler must fire when no mode is active');
  assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  assert.deepEqual(chunks, []);
});

test('streamChat: handler is NOT invoked when active mode is technical-interview (issue #272)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('technical-interview');
  await drainStream(helper.streamChat('Walk me through your last system design.'));

  assert.equal(
    captured.length,
    0,
    'technical-interview must NEVER receive a salary card mid-answer (issue #272)',
  );
});

test('streamChat: handler is NOT invoked for team-meet or lecture either', async () => {
  for (const templateType of ['team-meet', 'lecture']) {
    const helper = buildHelper();
    helper.setKnowledgeOrchestrator(buildOrchestratorStub());
    const captured = [];
    helper.setNegotiationCoachingHandler(payload => captured.push(payload));

    installActiveMode(templateType);
    await drainStream(helper.streamChat('any input?'));

    assert.equal(
      captured.length,
      0,
      `${templateType} must NOT trigger a salary-coaching card (issue #272)`,
    );
  }
});

test('streamChat: handler IS invoked for the remaining coaching-eligible modes', async () => {
  for (const templateType of ['sales', 'recruiting', 'general']) {
    const helper = buildHelper();
    helper.setKnowledgeOrchestrator(buildOrchestratorStub());
    const captured = [];
    helper.setNegotiationCoachingHandler(payload => captured.push(payload));

    installActiveMode(templateType);
    await drainStream(helper.streamChat('compensation discussion'));

    assert.equal(
      captured.length,
      1,
      `${templateType} should still allow coaching short-circuit`,
    );
    assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  }
});

// Symmetry verifica para o non-streaming caminho — mesmo gate at LLMHelper.ts:~1354.
// Cheap to exercise: chatWithGemini's gate é structurally identical.
test('chatWithGemini: handler IS invoked when active mode allows coaching', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('looking-for-work');
  const result = await callChat(helper, 'What salary should I ask for?');

  assert.equal(captured.length, 1, 'chatWithGemini must fire handler for looking-for-work');
  assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  // chatWithGemini Retorna '' em o coaching short-circuit branch.
  assert.equal(result, '');
});

test('chatWithGemini: handler is NOT invoked when active mode is technical-interview', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('technical-interview');
  await callChat(helper, 'Explain consistent hashing.');

  assert.equal(
    captured.length,
    0,
    'technical-interview must block the coaching short-circuit on the non-streaming path too (issue #272)',
  );
});

// ---------------------------------------------------------------------------
// Broader gate coverage (issue #272 follow-up). O gate agora suppresses o
// ENTIRE premium knowledge intercept — não apenas coaching — para templates onde
// it é contextually wrong. This covers o two sibling vectors de o mesmo
// bug class that o code-reviewer flagged: intro-question shortcut and
// premium prompt/context injection.
// ---------------------------------------------------------------------------

function buildIntroOrchestratorStub() {
  return {
    isKnowledgeMode: () => true,
    feedForDepthScoring: () => {},
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      isIntroQuestion: true,
      introResponse: 'CANNED_INTRO_RESPONSE_SENTINEL',
    }),
  };
}

function buildInjectionOrchestratorStub() {
  return {
    isKnowledgeMode: () => true,
    feedForDepthScoring: () => {},
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      systemPromptInjection: 'PREMIUM_PROMPT_SENTINEL',
      contextBlock: 'PREMIUM_CONTEXT_SENTINEL',
    }),
  };
}

test('streamChat: intro shortcut FIRES in looking-for-work mode (regression guard)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildIntroOrchestratorStub());

  installActiveMode('looking-for-work');
  const chunks = await drainStream(helper.streamChat('Tell me about yourself.'));

  assert.ok(
    chunks.includes('CANNED_INTRO_RESPONSE_SENTINEL'),
    'intro shortcut must still fire in modes where it is appropriate',
  );
});

// NOTE: These tests anteriormente checked that o intro shortcut era SUPPRESSED em
// technical-interview / lecture modes (issue #272). That behaviour era revised:
// identity recall (isIntroQuestion + introResponse) agora sempre passes através
// independentemente de modo compatibility, porque it é factual retrieval (candidate nnome
// current role, years de experience), Não persona injection. Suppressing it em qualquer
// modo meant o user poderia nunca ask "o que é my nanome em a technical interview.
// O modo gate ainda blocks negotiation coaching and premium context/prompt injection.
test('streamChat: intro shortcut PASSES THROUGH even in technical-interview mode', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildIntroOrchestratorStub());

  installActiveMode('technical-interview');
  const chunks = await drainStream(helper.streamChat('What is my name?'));

  assert.ok(
    chunks.includes('CANNED_INTRO_RESPONSE_SENTINEL'),
    'identity recall (intro shortcut) must fire even in technical-interview mode',
  );
});

test('chatWithGemini: intro shortcut PASSES THROUGH even in lecture mode', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildIntroOrchestratorStub());

  installActiveMode('lecture');
  const result = await callChat(helper, 'What is my name?');

  assert.strictEqual(
    result,
    'CANNED_INTRO_RESPONSE_SENTINEL',
    'identity recall (intro shortcut) must fire even in lecture mode',
  );
});

// Auxiliar to wire a fake customProvider + spy em o despacha então we pode lê
// o resolved (system, ccontexto at o point streamChat/chatWithGemini hand
// fora to a pprovedor This é o que makes o prompt/context-injection tests
// falsifiable — sem it o despacha caminho throws em no-client antes we
// pode observe o resolved values, and o negative assertion passes
// vacuously se o gate é em place ou nnão
function attachDispatchSpy(helper) {
  helper.customProvider = {
    id: 'spy-provider',
    name: 'spy',
    curlCommand: 'noop',
  };
  // Neutralize o provider-data-scope filtrar então o contexto o intercept
  // injected actually reaches o despacha arg. Sem this stub o
  // chatWithGemini caminho aplica `shouldOmitContext ? "" : context` and o
  // sentinel obtém stripped por an unrelated mechanism, making o assertion
  // unfalsifiable.
  helper.getDeniedOutboundScopes = () => [];
  const calls = [];
  // streamChat caminho → streamWithCustom (async generator yielding chunks)
  helper.streamWithCustom = async function* (message, context, _imagePaths, systemPrompt) {
    calls.push({ via: 'streamWithCustom', message, context: context || '', systemPrompt: systemPrompt || '' });
    yield '';
  };
  // chatWithGemini caminho → executeCustomProvider
  helper.executeCustomProvider = async function (_cmd, combinedMessage, systemPrompt, message, context, _img) {
    calls.push({ via: 'executeCustomProvider', message, context: context || '', systemPrompt: systemPrompt || '', combinedMessage: combinedMessage || '' });
    return 'spy-response';
  };
  return calls;
}

test('streamChat: premium context block REACHES dispatch in looking-for-work (positive control)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('looking-for-work');
  await drainStream(helper.streamChat('Talk through your career story.'));

  const dispatched = calls.find(c => c.via === 'streamWithCustom');
  assert.ok(dispatched, 'streamWithCustom must be reached after the intercept');
  // O premium contexto block é prepended to o (initially empty) contexto por
  // o intercept bcorpo Its presence at despacha proves o intercept ran.
  assert.ok(
    dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    `looking-for-work must inject premium context at dispatch; saw context=${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
});

test('streamChat: premium context block is SUPPRESSED at dispatch in technical-interview (issue #272)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('technical-interview');
  await drainStream(helper.streamChat('Discuss CAP theorem.'));

  const dispatched = calls.find(c => c.via === 'streamWithCustom');
  assert.ok(dispatched, 'streamWithCustom must be reached after fall-through');
  // O gate precisa block o contextBlock injection — não sentinel pode reach
  // o pprovedor This é o falsifiable assertion: removing o gate iria
  // flip ambos substrings to tverdadeiro
  assert.ok(
    !dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    `technical-interview must NOT inject premium context at dispatch (issue #272); saw context=${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
  assert.ok(
    !dispatched.systemPrompt.includes('PREMIUM_PROMPT_SENTINEL'),
    `technical-interview must NOT inject premium system prompt at dispatch; saw systemPrompt=${JSON.stringify(dispatched.systemPrompt).slice(0, 200)}`,
  );
});

// callChat em o rest de o arquivo pins skipSystemPrompt=true, que é
// correct para o coaching/intro tests — those short-circuit Antes o
// systemPromptInjection block. Para prompt/context-injection tests we need
// skipSystemPrompt=false então o injection block (gated em !skipSystemPrompt
// && knowledgeResult.systemPromptInjection em chatWithGemini) actually rexecuta
async function callChatWithSystem(helper, message) {
  try {
    return await helper.chatWithGemini(message, undefined, undefined, false);
  } catch (_err) {
    return null;
  }
}

test('chatWithGemini: premium context block is SUPPRESSED at dispatch in team-meet (issue #272)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('team-meet');
  const result = await callChatWithSystem(helper, 'Project status?');

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached after fall-through');
  assert.ok(
    !dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    'team-meet must NOT inject premium context at dispatch (issue #272 sibling)',
  );
  assert.ok(
    !dispatched.combinedMessage.includes('PREMIUM_PROMPT_SENTINEL'),
    'team-meet must NOT inject premium system prompt into the combined message',
  );
  // Sanity: o spy actually returned algo em vez than o função
  // erroring fora antes reaching ddespacha
  assert.equal(result, 'spy-response', 'dispatch must have produced the spy response');
});

test('chatWithGemini: premium context block REACHES dispatch in recruiting (positive control)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('recruiting');
  await callChatWithSystem(helper, 'How did the candidate respond?');

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached after the intercept');
  assert.ok(
    dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    `recruiting must inject premium context at dispatch; saw context=${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
});

test('streamChat: premium prompt injection STILL FIRES in looking-for-work (regression guard)', async () => {
  // We can't see o injected prompt directly (it goes dentro de o próximo LLM call
  // que we don't reach). Mas o intercept's outro gated behaviors firing
  // é suficiente proof — we já verified coaching fires para
  // looking-for-work. Inverse coverage: confirm o intercept corpo ainda
  // executa por stubbing processQuestion to Também emitir coaching então we pode
  // observe manipulador invocation como proof o corpo ran.
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator({
    isKnowledgeMode: () => true,
    feedForDepthScoring: () => {},
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      liveNegotiationResponse: PAYLOAD_SENTINEL,
      systemPromptInjection: 'PREMIUM_PROMPT_SENTINEL',
      contextBlock: 'PREMIUM_CONTEXT_SENTINEL',
    }),
  });
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('looking-for-work');
  await drainStream(helper.streamChat('compensation question'));

  assert.equal(
    captured.length,
    1,
    'intercept body must run in looking-for-work; coaching handler proves it',
  );
});
