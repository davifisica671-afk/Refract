// electron/intelligence/__tests__/ProfileTreeDeterministicFastPath2026_06_15.test.mjs
//
// Fase 5 (tarefa 2026-06-15): prove o ProfileTree deterministic fast caminho para direct
// profile/identity questions — and o App-identity-vs-Candidate-identity sdivide and o
// first-person experience-count answer (A09). These executa contra o compiled dist-electron
// artifact, o exact code o live manual caminho calls via buildManualProfileBackendAnswer.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { ProfileTreeService } from '../../../dist-electron/electron/intelligence/ProfileTreeService.js';
import {
  tryBuildManualProfileFastPathAnswer,
  isAssistantIdentityQuestion,
} from '../../../dist-electron/electron/llm/manualProfileIntelligence.js';

const PROFILE = {
  identity: { name: 'Evin John' },
  experience: [
    { role: 'Software Engineer', company: 'Acme', bullets: ['Built the data pipeline'] },
    { role: 'Data Intern', company: 'Beta' },
  ],
  projects: [{ name: 'Refract', description: 'AI meeting copilot', technologies: ['Electron', 'TypeScript'] }],
  skills: ['Python', 'SQL', 'React'],
  education: [{ degree: 'BSc', field: 'Computer Science', institution: 'State University' }],
};

describe('ProfileTree deterministic fast path — first-person, provider-free', () => {
  const svc = new ProfileTreeService(PROFILE, null);

  test('name → first person, never "Your name"', () => {
    const a = svc.getIdentity().answer;
    assert.match(a, /^My name is Evin John\.?$/);
  });

  test('intro → first person, grounded, never "I\'m Refract"', () => {
    const a = svc.getInterviewIntro();
    assert.match(a, /^I'm Evin John/);
    assert.doesNotMatch(a, /Refract, an AI|I am Refract/i);
  });

  test('skills/projects → first person', () => {
    assert.match(svc.getSkills(), /^My skills include/);
    assert.match(svc.getProjects(), /^My projects include/);
  });

  test('every direct fast-path answer is deterministic (providerUsed=false)', () => {
    for (const q of ['what is your name', 'introduce yourself', 'what are your skills', 'what are your projects', 'what is your experience']) {
      const r = tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, source: 'what_to_answer' });
      assert.ok(r, `"${q}" must fast-path`);
      assert.equal(r.usedDeterministicFastPath, true);
      assert.equal(r.providerUsed, false);
    }
  });
});

describe('Experience-count is FIRST PERSON (A09)', () => {
  for (const q of [
    'How many years of experience do you have?',
    'how much experience do you have',
    'what is your experience',
    'what is your work experience',
  ]) {
    test(`"${q}" → "My experience…" not "You have…"`, () => {
      const r = tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, source: 'what_to_answer' });
      assert.ok(r, 'must fast-path to experience');
      assert.equal(r.answerType, 'experience_answer');
      assert.match(r.answer, /^My experience includes/);
      assert.doesNotMatch(r.answer, /^You have|^Your experience/i);
    });
  }
});

describe('App identity vs Candidate identity', () => {
  const CANDIDATE = ['who are you', 'introduce yourself', 'what is your name', 'tell me who you are'];
  const APP = ['are you an AI', 'are you a bot', 'what is Refract', 'what model are you', 'who built you'];

  for (const q of CANDIDATE) {
    test(`candidate: "${q}" expects candidate voice (leak guard ON)`, () => {
      assert.equal(isAssistantIdentityQuestion(q), false, `"${q}" is NOT an app-identity question`);
      const guard = ProfileTreeService.getCandidatePerspectiveGuard('looking-for-work', q);
      assert.equal(guard.expectCandidateVoice, true);
      assert.equal(guard.assistantIdentityWouldLeak, true);
    });
  }

  for (const q of APP) {
    test(`app: "${q}" is an app-identity question (answer as the app)`, () => {
      assert.equal(isAssistantIdentityQuestion(q), true, `"${q}" IS an app-identity question`);
      const guard = ProfileTreeService.getCandidatePerspectiveGuard('looking-for-work', q);
      assert.equal(guard.isAppIdentityQuestion, true);
      assert.equal(guard.assistantIdentityWouldLeak, false);
      // O fast caminho bails (Retorna null) então o app/assistant identity caminho answers it.
      assert.equal(tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, source: 'manual_input' }), null);
    });
  }
});

describe('Privacy isolation — a ProfileTreeService can only see its own profile', () => {
  test("Bob's service never surfaces Alice's project", () => {
    const alice = new ProfileTreeService({ identity: { name: 'Alice' }, projects: [{ name: 'AliceSecretProj' }] }, null);
    const bob = new ProfileTreeService({ identity: { name: 'Bob' }, projects: [{ name: 'BobProj' }] }, null);
    assert.doesNotMatch(bob.getProjects() || '', /AliceSecretProj/);
    assert.match(bob.getIdentity().answer || '', /Bob/);
    assert.match(alice.getProjects() || '', /AliceSecretProj/);
  });
});
