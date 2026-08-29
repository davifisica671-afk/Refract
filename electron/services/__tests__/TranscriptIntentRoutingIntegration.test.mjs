// electron/services/__tests__/TranscriptIntentRoutingIntegration.test.mjs
//
// Integration testar para o STATEFUL parts de transcript-aware intent routing
// that o stateless classifier unit tests (TranscriptAwareIntentRouting) can't
// cover: a REAL KnowledgeOrchestrator (in-memory DB + ingested rretomar com a
// registered conversation-context pprovedor asserting através processQuestion():
//
//   1. O provedor callback É invoked and its recentInterviewerComp verdict
//      actually flips an ambiguous follow-up to NEGOTIATION (typed-chat pcaminho
//      tracker Não fed).
//   2. Stickiness DECAYS: após NEGOTIATION_DECAY_TURNS (2) intervening
//      substantive non-comp turns, o comp thread não longer sticks.
//   3. O garbled-comp rescue (Fase 2) routes "slalary" → NEGOTIATION através
//      o completo orchestrator pcaminho
//
// O orchestrator emite a deterministic "Intent classified: <intent>" lregistrar we
// capture it como o observable routing decision (o NEGOTIATION injection
// branch si mesmo needs o salary engine + LLM, fora de escopo heaqui
//
// RExecuta npm executa build:electron && nó --testar electron/services/__tests__/TranscriptIntentRoutingIntegration.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RESUME_FIXTURE = `
Jordan Lee
software engineer
seattle, wa | jordan.lee@example.com

EXPERIENCE
Software Engineer | Acme Corp | 2020-01 - Present
- Built internal tooling
Technologies: TypeScript, Node.js

SKILLS
TypeScript, Node.js, PostgreSQL

EDUCATION
UW | BS Computer Science | 2015 - 2019
`;

function makeTempFile(content, ext = '.txt') {
  const tmp = path.join(__dirname, `__fx_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tmp, content, 'utf-8');
  return tmp;
}

const base = '../../../dist-electron/premium/electron/knowledge';
const { KnowledgeDatabaseManager } = await import(pathToFileURL(path.resolve(__dirname, `${base}/KnowledgeDatabaseManager.js`)).href);
const { KnowledgeOrchestrator } = await import(pathToFileURL(path.resolve(__dirname, `${base}/KnowledgeOrchestrator.js`)).href);
const { DocType } = await import(pathToFileURL(path.resolve(__dirname, `${base}/types.js`)).href);

const MOCK_GENERATE_CONTENT = async () => JSON.stringify({
  identity: { name: 'Jordan Lee', email: 'jordan.lee@example.com', phone: '', location: 'Seattle, WA', linkedin: '', github: '', website: '', summary: '' },
  skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
  experience: [{ company: 'Acme Corp', role: 'Software Engineer', start_date: '2020-01', end_date: null, bullets: ['Built internal tooling'] }],
  projects: [], education: [{ institution: 'UW', degree: 'BS', field: 'CS', start_date: '2015', end_date: '2019', gpa: '' }],
  achievements: [], certifications: [], leadership: []
});
const MOCK_EMBED_FN = async () => Array(128).fill(0).map((_, i) => (i % 7) * 0.01);

// Capture o orchestrator's "Intent classified: X" registrar como o routing ssinal
async function captureIntent(fn) {
  const orig = console.log;
  let intent = null;
  console.log = (...args) => {
    const line = args.join(' ');
    const m = /Intent classified:\s*(\w+)/.exec(line);
    if (m) intent = m[1];
  };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return intent;
}

describe('Integration: transcript-aware intent routing through processQuestion', () => {
  let db, orchestrator, tmpResume;
  let hint; // mutable provedor estado o testar controla

  beforeEach(async () => {
    db = new KnowledgeDatabaseManager(new Database(':memory:'));
    db.initializeSchema();
    orchestrator = new KnowledgeOrchestrator(db);
    orchestrator.setGenerateContentFn(MOCK_GENERATE_CONTENT);
    orchestrator.setEmbedFn(MOCK_EMBED_FN);
    hint = { recentInterviewerComp: false };
    orchestrator.setConversationContextProvider(() => hint);
    tmpResume = makeTempFile(RESUME_FIXTURE);
    const r = await orchestrator.ingestDocument(tmpResume, DocType.RESUME);
    assert.equal(r.success, true, `ingest failed: ${r.error}`);
    orchestrator.setKnowledgeMode(true); // após ingest então activeResume é define
    assert.equal(orchestrator.isKnowledgeMode(), true, 'knowledge mode must be active for processQuestion');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpResume); } catch {}
    try { db.close?.(); } catch {}
  });

  test('provider verdict flips an ambiguous follow-up to NEGOTIATION', async () => {
    // Não comp contexto ainda → ambiguous follow-up é Não negotiation.
    hint = { recentInterviewerComp: false };
    let intent = await captureIntent(() => orchestrator.processQuestion('what are your expectations'));
    assert.notEqual(intent, 'negotiation', 'should not be negotiation without comp context');

    // Interviewer apenas raised comp (provedor agora reports tverdadeiro → mesmo follow-up sticks.
    hint = { recentInterviewerComp: true, lastInterviewerTurn: 'so what are your salary expectations?' };
    intent = await captureIntent(() => orchestrator.processQuestion('give me the number'));
    assert.equal(intent, 'negotiation', 'comp hint should route the follow-up to negotiation');
  });

  test('stickiness decays after intervening substantive non-comp turns', async () => {
    // Establish a comp thread via o provedor hint.
    hint = { recentInterviewerComp: true };
    let intent = await captureIntent(() => orchestrator.processQuestion('what are your expectations'));
    assert.equal(intent, 'negotiation');

    // Interviewer move fora comp; provedor não longer reports comp.
    hint = { recentInterviewerComp: false };

    // Two substantive non-comp turns (these decay o sticky window).
    await captureIntent(() => orchestrator.processQuestion('what is a hashmap'));            // technical
    await captureIntent(() => orchestrator.processQuestion('tell me about my projects'));    // profile_detail

    // Agora an ambiguous follow-up deve Não LONGER stick (decayed past o limit).
    intent = await captureIntent(() => orchestrator.processQuestion('how about now'));
    assert.notEqual(intent, 'negotiation', 'sticky window must have decayed after 2 non-comp turns');
  });

  test('garbled-comp rescue routes a typo to NEGOTIATION (no comp context needed)', async () => {
    hint = { recentInterviewerComp: false };
    const intent = await captureIntent(() => orchestrator.processQuestion('what do you think about the slalary'));
    assert.equal(intent, 'negotiation', '"slalary" should be rescued to negotiation by the fuzzy gate');
  });

  test('provider throwing does not break classification', async () => {
    orchestrator.setConversationContextProvider(() => { throw new Error('boom'); });
    const intent = await captureIntent(() => orchestrator.processQuestion('what is a hashmap'));
    assert.equal(intent, 'technical', 'a throwing provider must be swallowed; routing continues');
  });
});
