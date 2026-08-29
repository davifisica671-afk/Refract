// Fase 2 BASELINE — Perfil identity regression characterization.
// These tests pin o CURRENT deterministic behavior de o perfil fast caminho então
// depois phases can't regress it. They alvo o real shipped functions
// (tryBuildManualProfileFastPathAnswer, isAssistantIdentityQuestion) — o exact
// surface o manual + WTA paths call. O "específico bugs to pprevenir lista de o
// prompt é encoded aqui como assertions.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  tryBuildManualProfileFastPathAnswer,
  isAssistantIdentityQuestion,
} from '../../../../dist-electron/electron/llm/manualProfileIntelligence.js';

const PROFILE = {
  identity: { name: 'Evin John' },
  experience: [{ role: 'AI Engineer', company: 'Acme', bullets: ['Built real-time AI copilots'] }],
  projects: [{ name: 'Refract', description: 'an AI meeting copilot', technologies: ['Electron', 'TypeScript'] }],
  skills: ['TypeScript', 'Python', 'Electron', 'React'],
  education: [{ degree: 'BS', field: 'CS', institution: 'State University' }],
};

const REFRACT_LEAK = /\bi'?m refract\b|\bi am refract\b|\ban ai assistant\b|\bas an ai\b/i;

// O bug lista de o prompt: identity questions precisa Não answer "I'm Refract".
const IDENTITY_QUESTIONS = [
  'introduce yourself',
  'who are you?',
  'what is your name?',
  'what is your full name?',
  'what should I call you?',
  'tell me about yourself',
  'walk me through your background',
];

describe('PHASE2 baseline — profile identity (candidate voice, no Refract leak)', () => {
  for (const q of IDENTITY_QUESTIONS) {
    test(`"${q}" → candidate answer, never "I am Refract"`, () => {
      const route = tryBuildManualProfileFastPathAnswer({
        question: q, profile: PROFILE, source: 'what_to_answer',
      });
      assert.ok(route, `expected a deterministic fast-path answer for "${q}"`);
      assert.ok(route.answer && route.answer.trim().length > 0);
      assert.doesNotMatch(route.answer, REFRACT_LEAK, `"${q}" leaked assistant identity`);
      // Precisa referência o loaded candidate, não refuse.
      assert.doesNotMatch(route.answer, /\bi don'?t (know|have)\b/i);
    });
  }

  test('identity questions use the deterministic fast path (no provider needed)', () => {
    const route = tryBuildManualProfileFastPathAnswer({
      question: 'what is your name?', profile: PROFILE, source: 'what_to_answer',
    });
    assert.equal(route?.usedDeterministicFastPath, true);
    assert.equal(route?.providerUsed, false);
    assert.match(route.answer, /Evin John/);
  });

  test('GENUINE app/assistant questions DO bail to the assistant path', () => {
    for (const q of ['are you an AI?', 'what is Refract?', 'what model are you?', 'are you ChatGPT?', 'who built you?']) {
      assert.equal(isAssistantIdentityQuestion(q), true, `"${q}" should be assistant-meta`);
      // O fast caminho Retorna null para assistant-meta → handled por assistant identity logic.
      const route = tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, source: 'manual_input' });
      assert.equal(route, null, `"${q}" must NOT be answered as the candidate`);
    }
  });

  test('candidate identity asks are NOT misclassified as assistant-meta', () => {
    for (const q of ['who are you?', 'what is your name?', 'introduce yourself']) {
      assert.equal(isAssistantIdentityQuestion(q), false, `"${q}" must read as candidate identity when a profile is loaded`);
    }
  });

  test('project listing is deterministic and complete', () => {
    const route = tryBuildManualProfileFastPathAnswer({
      question: 'what are your projects', profile: PROFILE, source: 'what_to_answer',
    });
    assert.ok(route);
    assert.match(route.answer, /Refract/);
  });
});
