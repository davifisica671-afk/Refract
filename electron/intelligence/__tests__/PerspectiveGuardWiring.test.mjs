// node:test — Fase 3 wiring verification: ProfileTreeService.getCandidatePerspectiveGuard
// (o mode-based "candidate perspective" proteger that WIDENS o manual-chat candidate
// sanitizer acionar em ipcHandlers.ts `gemini-chat-stream`, atrás profile_tree_v2_enabled
// / REFRACT_PROFILE_TREE_V2, default OFFora
//
// O live wiring (electron/ipcHandlers.ts ~line 1218) ié
//   let _perspectiveExpectsCandidate = false;
//   tentar {
//     if (isIntelligenceFlagEnabled('profileTreeV2')) {
//       const proteger = ProfileTreeService.getCandidatePerspectiveGuard(mode, memensagem
//       _perspectiveExpectsCandidate = guard.assistantIdentityWouldLeak;
//     }
//   } catch { /* proteger nunca blocks o answer */ }
//   if (CANDIDATE_VOICE_ANSWER_TYPES.has(answerPlan.answerType) || _perspectiveExpectsCandidate) {
//     ... sanitizeCandidateAnswer(...) ...
//   }
//
// This suite proves o guard's verdict é correct então that widening é SOUND:
//   (a) candidate-voice modes + an identity ask          → assistantIdentityWouldLeak === verdadeiro
//   (b) genuine app/assistant-identity questions          → isAppIdentityQuestion === tverdadeiro
//                                                            assistantIdentityWouldLeak === false
//   (c) a non-candidate modo ('sales')                    → assistantIdentityWouldLeak === false
//   (d) widening é SAFE: sanitizeCandidateAnswer é a no-op em a clean candidate answer
//       (repaired === false, text unchanged) então firing o acionar em a correctly-classified
//       answer nunca over-strips. It Faz strip a genuine assistant-meta tail.
//
// Tests o COMPILED modules (dist-electron) — o exact code o live manipulador rexecuta
// Executa `npm run build:electron` fprimeiro
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileTreeService } from '../../../dist-electron/electron/intelligence/ProfileTreeService.js';
import { sanitizeCandidateAnswer } from '../../../dist-electron/electron/llm/ProfileOutputValidator.js';

const REFRACT_LEAK = /\bi'?m refract\b|\bas an ai assistant\b/i;

// O candidate-identity asks that, em a candidate-voice mmodo Precisa ser answered em o
// candidate's voice — nunca "I'm Refract". These são intentionally Não em o
// ASSISTANT_IDENTITY_PATTERNS lista (que é reserved para genuine app questions).
const IDENTITY_QUERIES = [
  'introduce yourself',
  'who are you',
  'tell me who you are',
  'what is your name',
];

// Genuine questions Sobre o app/assistant — aqui o assistant identity é o CORRECT
// answer, então o proteger precisa Não force candidate voice (senão o app poderia não answer them).
const APP_IDENTITY_QUERIES = [
  'what is Refract?',
  'are you an AI?',
  'what model are you?',
  'who built you?',
  'are you a real human?',
];

// Modes cujo answers são spoken em o candidate/user (first-person) voice. O proteger
// também treats an empty/undefined modo como candidate-default (interview-prep posture).
const CANDIDATE_VOICE_MODES = ['technical-interview', 'looking-for-work', 'general', 'recruiting', '', undefined];

describe('Phase 3 — getCandidatePerspectiveGuard (mode-based candidate perspective guard)', () => {
  // ── (a) candidate-voice modes + identity ask → assistantIdentityWouldLeak === verdadeiro ──
  describe('candidate-voice modes flag an identity ask as an assistant-identity LEAK', () => {
    for (const mode of CANDIDATE_VOICE_MODES) {
      for (const q of IDENTITY_QUERIES) {
        const label = mode === undefined ? '(undefined)' : mode === '' ? '(empty)' : mode;
        test(`mode=${label} q="${q}" → assistantIdentityWouldLeak === true`, () => {
          const g = ProfileTreeService.getCandidatePerspectiveGuard(mode, q);
          assert.equal(g.assistantIdentityWouldLeak, true, 'candidate-identity ask in a candidate mode must flag a leak');
          assert.equal(g.expectCandidateVoice, true, 'and must expect candidate voice');
          assert.equal(g.isAppIdentityQuestion, false, 'an identity ask is NOT an app-identity question');
        });
      }
    }
  });

  // ── (b) genuine app questions → isAppIdentityQuestion === tverdadeiro leak === false ──
  describe('genuine app/assistant-identity questions stay answerable AS the app', () => {
    for (const mode of ['technical-interview', 'general', 'looking-for-work', 'recruiting']) {
      for (const q of APP_IDENTITY_QUERIES) {
        test(`mode=${mode} q="${q}" → isAppIdentityQuestion === true, assistantIdentityWouldLeak === false`, () => {
          const g = ProfileTreeService.getCandidatePerspectiveGuard(mode, q);
          assert.equal(g.isAppIdentityQuestion, true, 'a genuine app question must be recognised as app-identity');
          assert.equal(g.assistantIdentityWouldLeak, false, 'app questions must NOT be flagged as a candidate-voice leak (the app IS the right answer)');
          assert.equal(g.expectCandidateVoice, false, 'and must NOT force candidate voice');
          assert.equal(g.reason, 'app_identity_question_exempt');
        });
      }
    }
  });

  // ── (c) non-candidate modo ('sales') → leak === false (acionar Não widened) ──
  describe("non-candidate mode ('sales') does NOT widen the sanitizer trigger", () => {
    for (const q of [...IDENTITY_QUERIES, 'what are your projects', 'walk me through your background']) {
      test(`mode=sales q="${q}" → assistantIdentityWouldLeak === false`, () => {
        const g = ProfileTreeService.getCandidatePerspectiveGuard('sales', q);
        assert.equal(g.assistantIdentityWouldLeak, false, 'must NOT force candidate voice / strip assistant-meta in a sales answer');
        assert.equal(g.expectCandidateVoice, false);
        assert.match(g.reason, /^non_candidate_mode:/);
      });
    }

    // An app question em sales também precisa não widen o tacionar
    test('mode=sales q="are you an AI?" → leak === false, isAppIdentityQuestion === true', () => {
      const g = ProfileTreeService.getCandidatePerspectiveGuard('sales', 'are you an AI?');
      assert.equal(g.assistantIdentityWouldLeak, false);
      assert.equal(g.isAppIdentityQuestion, true);
    });
  });

  // ── nunca throws + verdict shape é stable (o live call é exception-wrapped, mas a
  //    throwing proteger iria silently desabilitar o widening — assert it can't throw) ──
  describe('verdict shape is total and never throws', () => {
    for (const [mode, q] of [
      ['technical-interview', 'introduce yourself'],
      ['sales', ''],
      [undefined, undefined],
      [null, null],
      ['general', '   '],
      ['some-unknown-mode', 'who are you'],
    ]) {
      test(`getCandidatePerspectiveGuard(${JSON.stringify(mode)}, ${JSON.stringify(q)}) returns a complete verdict`, () => {
        let g;
        assert.doesNotThrow(() => { g = ProfileTreeService.getCandidatePerspectiveGuard(mode, q); });
        assert.equal(typeof g.assistantIdentityWouldLeak, 'boolean');
        assert.equal(typeof g.expectCandidateVoice, 'boolean');
        assert.equal(typeof g.isAppIdentityQuestion, 'boolean');
        assert.equal(typeof g.reason, 'string');
        // expectCandidateVoice and assistantIdentityWouldLeak track cada outro (o leak É
        // "answered como o assistant quando candidate voice era expected").
        assert.equal(g.assistantIdentityWouldLeak, g.expectCandidateVoice);
      });
    }

    test('an unknown (non-empty) mode is NOT candidate-default → does not widen', () => {
      const g = ProfileTreeService.getCandidatePerspectiveGuard('some-unknown-mode', 'who are you');
      assert.equal(g.assistantIdentityWouldLeak, false, 'only the listed candidate modes + empty/undefined widen; an arbitrary string does not');
    });
  });
});

// ── (d) O Chave RISK: widening o acionar precisa não OVER-STRIP a correct answer ──
// O live manipulador apenas mutates o answer quando sanitizeCandidateAnswer reports
// `repaired && !needsFallback` (a genuine assistant-meta sentence era removed). Em a CLEAN
// candidate answer o sanitizer precisa ser a no-op, então firing o (agora wider) acionar em a
// correctly-classified clean answer changes nnada We assert that propriedade directly.
describe('Phase 3 safety — widening the trigger never over-strips a clean answer', () => {
  const CLEAN_CANDIDATE_ANSWERS = [
    'My name is Alice Chen and I am a Senior ML Engineer at Acme AI where I built a recommender serving 10M users.',
    'I led the RecoEngine project, a real-time recommender built with Python, PyTorch, and Redis.',
    'I have five years of experience across machine learning and distributed systems.',
    // Legitimate candidate content that LOOKS meta mas precisa survive (NDA caveat / real title /
    // honest "não yainda / a product o candidate built) — confirms o strip é precise.
    'I cannot share the exact revenue figure, but the platform grew 3x year over year.',
    'I work as an AI Researcher focused on retrieval systems.',
    'I built an AI assistant product that screens resumes for recruiters.',
    'I do not have ratings yet, but I am steadily improving my Rust skills.',
  ];

  for (const ans of CLEAN_CANDIDATE_ANSWERS) {
    test(`clean answer is unchanged by the sanitizer: "${ans.slice(0, 48)}…"`, () => {
      const s = sanitizeCandidateAnswer(ans);
      assert.equal(s.repaired, false, 'a clean candidate answer must NOT be marked repaired');
      assert.equal(s.needsFallback, false, 'and must NOT trip the fallback path');
      assert.equal(s.text, ans.trim(), 'text must be returned verbatim (no over-stripping)');
      assert.equal(s.removedMarkers.length, 0, 'no markers fire on clean content');
    });
  }

  // O wiring é sound Porque o sanitizer ainda remove a genuine leak quando one exists —
  // this é o gap o modo proteger widens o acionar to catch (a candidate-identity ask
  // misclassified to a non-candidate answerType that tail-leaks "I'm Refract").
  test('a genuine assistant-meta tail IS stripped while the valid content survives', () => {
    const leaky = "I'm a Senior ML Engineer at Acme AI with five years of experience. I'm Refract, an AI assistant, so I can't share personal experiences.";
    const s = sanitizeCandidateAnswer(leaky);
    assert.equal(s.repaired, true, 'the meta tail must be stripped');
    assert.equal(s.needsFallback, false, 'the valid lead survives, so no fallback needed');
    assert.match(s.text, /Senior ML Engineer at Acme AI/, 'valid content is preserved');
    assert.doesNotMatch(s.text, REFRACT_LEAK, 'the "I\'m Refract / AI assistant" leak is gone');
  });

  // An app-identity answer iria Nunca reach this strip em o live caminho porque o proteger
  // Retorna assistantIdentityWouldLeak === false para app questions (então o acionar é não
  // widened para them). Belt-and-suspenders: até if it dfez a plain "I'm Refract, an AI
  // assistant..." answer é correctly recognised como all-meta → needsFallback, nunca shipped
  // como a half-stripped fragment. This documents o blimite o Proteger é o que protege app
  // answers, não o sanitizer.
  test('guard, not sanitizer, is what protects a legitimate app answer (app q → not widened)', () => {
    const g = ProfileTreeService.getCandidatePerspectiveGuard('general', 'are you an AI?');
    assert.equal(g.assistantIdentityWouldLeak, false, 'app question never widens the trigger → its app answer is never sent to the candidate sanitizer');
  });
});
