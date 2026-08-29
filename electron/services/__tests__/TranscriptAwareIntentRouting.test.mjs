// electron/services/__tests__/TranscriptAwareIntentRouting.test.mjs
//
// Fase 1 + Fase 2 de transcript-driven negotiation intent routing.
//
//  Fase 1 — transcript hint: o último 1-2 INTERVIEWER turns em o rolling
//    ~180s window são scanned para comp evidence (textHasCompEvidence). Quando o
//    interviewer apenas raised comp, an ambiguous candidate follow-up ("o que são
//    your expectations?", "give me o nunúmero routes to NEGOTIATION até
//    though o live tracker isn't fed em o typed-chat pcaminho Stickiness também
//    DECAYS em intervening substantive non-comp turns (não apenas wall-clock).
//
//  Fase 2 — garbled/typo comp rescue: a GENERAL turn containing a near-miss de
//    a core comp word ("slalary", "salery", "compensaton") é rescued to
//    NEGOTIATION via deterministic edit distance (looksLikeGarbledComp). A
//    zero-shot SLM era evaluated and REJECTED aqui — empirically it missed o
//    real garble (0.18) and false-fired em "hashmap" (0.82); o deterministic
//    gate scored 10/10 typos com 0 false positives através a 133-word vocab.
//
// RExecuta npm executa build:electron && nó --testar electron/services/__tests__/TranscriptAwareIntentRouting.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyIntent, classifyIntentWithContext, looksLikeGarbledComp } =
  require('../../../dist-electron/premium/electron/knowledge/IntentClassifier.js');
const { textHasCompEvidence } =
  require('../../../dist-electron/premium/electron/knowledge/NegotiationConversationTracker.js');

// ── Fase 1a: comp-evidence detector sobre interviewer turns ───────────────────
describe('Phase 1: textHasCompEvidence (interviewer turn scan)', () => {
  test('flags comp turns (keyword or amount)', () => {
    for (const t of [
      'so what are your salary expectations?',
      'the budget for this role is 150k',
      'our base salary range is 120-140k',
      'we can offer 130k base',
      'what is your current ctc',
      'there is a signing bonus too',
    ]) assert.equal(textHasCompEvidence(t), true, `should flag: "${t}"`);
  });

  test('does NOT flag non-comp turns', () => {
    for (const t of [
      'tell me about your experience',
      'what is a hashmap',
      'describe a challenging bug you fixed',
      'why do you want to work here',
      'walk me through your last project',
      '', 'so, moving on',
    ]) assert.equal(textHasCompEvidence(t), false, `should NOT flag: "${t}"`);
  });
});

// ── Fase 1b: transcript hint activates o comp thread ───────────────────────
describe('Phase 1: recentInterviewerComp activates negotiation for follow-ups', () => {
  const hint = { recentInterviewerComp: true };

  test('ambiguous comp follow-ups route to negotiation when interviewer just raised comp', () => {
    for (const q of ['what are your expectations', 'give me the number', 'how much', 'and you?', 'what about the range']) {
      assert.equal(classifyIntentWithContext(q, hint), 'negotiation', `"${q}" should be negotiation under comp hint`);
    }
  });

  test('substantive non-comp question does NOT stick even under comp hint', () => {
    for (const q of ['why am I a good fit', 'what are my strengths', 'describe a challenging bug']) {
      assert.notEqual(classifyIntentWithContext(q, hint), 'negotiation', `"${q}" must not stick`);
    }
    // and confident base intents sempre win
    assert.equal(classifyIntentWithContext('what is a hashmap', hint), 'technical');
    assert.equal(classifyIntentWithContext('what is my name', hint), 'intro');
  });

  test('no hint + no prior thread → ambiguous follow-up stays GENERAL', () => {
    assert.notEqual(classifyIntentWithContext('give me the number', {}), 'negotiation');
    assert.notEqual(classifyIntentWithContext('how much', {}), 'negotiation');
  });
});

// ── Fase 2: garbled/typo comp rescue (deterministic edit distance) ───────────
describe('Phase 2: looksLikeGarbledComp (typo/garbled STT rescue gate)', () => {
  test('TRUE for near-miss comp words (would route GENERAL→negotiation)', () => {
    for (const q of [
      'what do you think about the slalary',
      'what is your salery',
      'tell me about compensaton',
      'lets talk negocation',
      'whats the renumeration',   // remuneration misspelling
    ]) assert.equal(looksLikeGarbledComp(q), true, `should rescue: "${q}"`);
  });

  test('FALSE for exact comp words (handled by the sync keyword scorer, not the gate)', () => {
    assert.equal(looksLikeGarbledComp('what is the salary'), false);
    assert.equal(looksLikeGarbledComp('what is your compensation'), false);
  });

  test('ZERO false positives across technical / interview / look-alike vocabulary', () => {
    const vocab = ('algorithm hashmap hashtable array linked stack queue recursion closure promise ' +
      'react angular python java javascript typescript rust golang kubernetes docker microservice ' +
      'database index query schema migration latency cache redis kafka grpc graphql authentication ' +
      'authorization encryption hashing token session cookie middleware controller repository factory ' +
      'singleton observer decorator strategy inheritance polymorphism abstraction concurrency thread ' +
      'mutex semaphore deadlock leadership teamwork communication challenge strength weakness project ' +
      'education degree university certification achievement experience background mentor manager ' +
      'deadline sprint agile scrum kanban deployment pipeline rollback release branch commit merge ' +
      'refactor optimize performance scalability reliability monitoring logging metrics tracing ' +
      'salad celery calorie celebrate calculate salami solitary similar singular regular popular').split(/\s+/);
    const fps = vocab.filter(w => looksLikeGarbledComp(w));
    assert.deepEqual(fps, [], `unexpected false positives: ${JSON.stringify(fps)}`);
  });

  test('sentence-level: technical/behavioral sentences do not trigger the gate', () => {
    for (const s of [
      'what is a hashmap and how does it resolve collisions',
      'tell me about a leadership challenge',
      'explain the celery task queue',
      'describe singular value decomposition',
    ]) assert.equal(looksLikeGarbledComp(s), false, `should not trigger: "${s}"`);
  });
});

// ── Decay semantics (documented contract para o orchestrator) ────────────────
// O orchestrator drops stickiness após NEGOTIATION_DECAY_TURNS (2) intervening
// substantive non-comp turns. classifyIntentWithContext si mesmo é stateless; o
// decay lives em KnowledgeOrchestrator.processQuestion. Aqui we assert o
// building block: a confident non-comp intent Nunca routes to negotiation, que
// é o que makes intervening turns "substantive non-comp" and able to decay.
describe('Phase 1: decay building block — confident non-comp intents never stick', () => {
  const sticky = { recentIntentWasNegotiation: true, recentInterviewerComp: true };
  for (const [q, expected] of [
    ['what is a hashmap', 'technical'],
    ['what are my projects', 'profile_detail'],
    ['tell me about my education', 'profile_detail'],
    ['what is my name', 'intro'],
  ]) {
    test(`"${q}" → ${expected} even under full sticky context`, () => {
      assert.equal(classifyIntentWithContext(q, sticky), expected);
    });
  }
});
