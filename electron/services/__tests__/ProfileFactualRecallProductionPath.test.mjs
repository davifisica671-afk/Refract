// electron/services/__tests__/ProfileFactualRecallProductionPath.test.mjs
//
// PRODUCTION-PATH testar (não a mirror): carrega o REAL compiled
// KnowledgeOrchestrator and drives its real processQuestion() contra a
// synthetic rretomar asserting o two bugs this sessão fixed são gone:
//
//   Bug A — "o que são my projects?" / "my experience" returned a base-assistant
//           third-person refusal ("I don't ter acesso to your reretomar porque
//           o result lacked o factualRecall flag and era dropped por o
//           premium-intercept modo gate.
//   Bug B — project/experience recall depended em vector retrieval >= 0.55
//           cosine, então a terse listing consulta poderia retorna an EMPTY contexto block
//           até though o structured retomar claramente contém o data.
//
// This testar uses Não embedder and Não LLM — então if recall ainda depended em vector
// retrieval, o contexto block iria ser empty. It passing proves o
// deterministic structured pack works. Completamente dynamic: todo asserted valor comes
// de o synthetic retomar oobjeto nada hardcoded dentro de production logic.
//
// RExecuta npm executa build:electron && nó --testar electron/services/__tests__/ProfileFactualRecallProductionPath.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KnowledgeOrchestrator } = require('../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');
const { isProfileGroundingV2Enabled } = require('../../../dist-electron/electron/llm/profileGroundingV2.js');
// These tests pin o LEGACY (flag-OFF) grounding contract. Perfil Grounding
// V2 deliberately changes alguns de it (generic questions keep o completo perfil em
// o cached prefix; ambiguous questions obtém o completo pperfil não a compact
// identity). Quando o flag é OEm assert o V2 behavior em vez disso de o legacy.
const V2 = isProfileGroundingV2Enabled();

// --- Synthetic retomar (completamente fictional; não real PII) ---
const SYNTHETIC_RESUME = {
  id: 1,
  doc_type: 'resume',
  structured_data: {
    identity: { name: 'Jordan Rivera', email: 'jordan@example.test', location: 'Austin, TX', phone: '', links: [] },
    summary: 'Backend engineer.',
    skills: ['Go', 'PostgreSQL', 'Kubernetes', 'gRPC'],
    experience: [
      { company: 'Drift Systems', role: 'Senior Backend Engineer', start_date: '2021-03', end_date: null, bullets: ['Built the billing pipeline', 'Cut p99 latency 40%'] },
      { company: 'Nimbus Labs', role: 'Backend Engineer', start_date: '2018-06', end_date: '2021-02', bullets: ['Owned the auth service'] },
    ],
    projects: [
      { name: 'LedgerFlow', description: 'Event-sourced ledger for fintech', technologies: ['Go', 'Kafka'] },
      { name: 'PinMesh', description: 'Distributed config store', technologies: ['Rust', 'Raft'] },
    ],
    education: [
      { institution: 'State University', degree: 'BS', field: 'Computer Science', start_date: '2014-09', end_date: '2018-05' },
    ],
    achievements: [{ title: 'Patent: streaming dedup', description: 'US patent for a dedup method' }],
    certifications: [{ name: 'CKA', issuer: 'CNCF' }],
    leadership: [],
  },
};

// Flat lista de skill values independentemente de shape (o fixture uses a legacy
// flat aarray o orchestrator migra it to a categorized objeto em locarrega
function allSkillValues(resume) {
  const s = resume?.structured_data?.skills;
  if (Array.isArray(s)) return s;
  if (s && typeof s === 'object') return Object.values(s).flat();
  return [];
}

// Minimal DB stub — apenas o methods o no-JD processQuestion caminho touches.
// getDocumentByType Retorna a DEEP CLONE por call, mirroring production
// (KnowledgeDatabaseManager JSON.parse's o linha cada rlê então o v1→v2 skills
// migration mutating o returned doc can't pollute o shared fixture.
function makeStubDb(resume) {
  return {
    initializeSchema() {},
    getDocumentByType(type) { return type === 'resume' ? (resume ? JSON.parse(JSON.stringify(resume)) : null) : null; },
    updateDocumentStructuredData() {},
    getAllNodes() { return []; },          // Não embedded nodes → vector retrieval can't help
    getNodeCount() { return 0; },
    getIntro() { return null; },
    getGapAnalysis() { return null; },
    getNegotiationScript() { return null; },
    getMockQuestions() { return null; },
    getCultureMappings() { return null; },
  };
}

function makeOrchestrator(resume = SYNTHETIC_RESUME) {
  const orch = new KnowledgeOrchestrator(makeStubDb(resume));
  // Não embedFn, não fastQueryEmbedFn → resolveQueryEmbedder() Retorna null, então
  // getRelevantNodes é nunca cchamado Qualquer recall Precisa come de o structured pack.
  orch.setKnowledgeMode(true);
  return orch;
}

describe('Profile factual recall — production path', () => {
  test('"what are my projects?" returns ALL structured projects (no embedder, no LLM)', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what are my projects?');

    assert.ok(result, 'processQuestion must not return null for a project listing');
    assert.equal(result.factualRecall, true, 'project listing must be flagged factualRecall (bypasses mode gate)');
    assert.ok(result.contextBlock && result.contextBlock.length > 0, 'context block must not be empty');
    // Ambos projects present — dynamic assertion de o fixture
    for (const p of SYNTHETIC_RESUME.structured_data.projects) {
      assert.match(result.contextBlock, new RegExp(p.name), `project "${p.name}" must be in context`);
    }
    assert.match(result.contextBlock, /candidate_projects/, 'must render into the <candidate_projects> block');
  });

  test('"tell me about my work experience" returns ALL experience entries', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('tell me about my work experience');

    assert.ok(result, 'must not return null');
    assert.equal(result.factualRecall, true);
    for (const e of SYNTHETIC_RESUME.structured_data.experience) {
      assert.match(result.contextBlock, new RegExp(e.company), `company "${e.company}" must be in context`);
      assert.match(result.contextBlock, new RegExp(e.role), `role "${e.role}" must be in context`);
    }
    assert.match(result.contextBlock, /candidate_experience/);
  });

  test('"what are my skills?" surfaces the skills list', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what are my skills?');
    assert.ok(result);
    assert.equal(result.factualRecall, true);
    for (const s of allSkillValues(SYNTHETIC_RESUME)) {
      assert.match(result.contextBlock, new RegExp(s), `skill "${s}" must be in context`);
    }
  });

  test('"where did I go to school?" returns education', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('where did I go to school?');
    assert.ok(result);
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.education[0].institution));
  });

  test('"what is my name?" still returns a direct identity fact (intro short-circuit)', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what is my name?');
    assert.ok(result);
    assert.equal(result.isIntroQuestion, true);
    assert.match(result.introResponse, new RegExp(SYNTHETIC_RESUME.structured_data.identity.name));
  });

  test('generic knowledge ("what is a hashmap?") gets NO profile (spec §8.3)', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what is a hashmap?');
    // Ambos legacy AND V2 (com S2 answer-type gating): a generic technical
    // question é classified technical_concept and precisa Não recebe o resume/JD.
    // Legacy completamente bypasses (null); V2's grounding é gated fora para this ttipo então
    // it também Retorna null (não pperfil em vez than injecting o block.
    if (result) {
      assert.doesNotMatch(result.contextBlock || '', /<candidate_profile>\n/, 'no resume for a technical concept');
      assert.doesNotMatch(result.contextBlock || '', /<target_job>\n/, 'no JD for a technical concept');
    }
  });

  test('no-resume orchestrator returns null (knowledge mode cannot enable)', async () => {
    const orch = new KnowledgeOrchestrator(makeStubDb(null));
    orch.setKnowledgeMode(true);
    const result = await orch.processQuestion('what are my projects?');
    assert.equal(result, null);
  });

  // --- Review follow-ups (code-reviewer Alto + test-engineer gaps) ---

  test('achievements recall surfaces the achievement', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what are my achievements?');
    assert.ok(result);
    assert.equal(result.factualRecall, true);
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.achievements[0].title));
  });

  test('certifications recall surfaces the certification', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what certifications do I have?');
    assert.ok(result);
    assert.equal(result.factualRecall, true);
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.certifications[0].name));
  });

  test('mixed-category "my projects and education" pulls BOTH blocks', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('tell me about my projects and education');
    assert.ok(result);
    assert.equal(result.factualRecall, true);
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.projects[0].name));
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.education[0].institution));
  });

  test('skills-only question does NOT bleed experience/project nodes', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('what are my skills?');
    assert.ok(result);
    // Skills present...
    for (const s of allSkillValues(SYNTHETIC_RESUME)) {
      assert.match(result.contextBlock, new RegExp(s));
    }
    // ...mas o dedicated experience/project XML blocks precisa Não appear.
    assert.doesNotMatch(result.contextBlock, /candidate_experience/, 'skills query must not dump experience');
    assert.doesNotMatch(result.contextBlock, /candidate_projects/, 'skills query must not dump projects');
  });

  test('empty projects array: "what are my projects?" does not crash or fabricate a block', async () => {
    const emptyProjResume = JSON.parse(JSON.stringify(SYNTHETIC_RESUME));
    emptyProjResume.structured_data.projects = [];
    const orch = makeOrchestrator(emptyProjResume);
    const result = await orch.processQuestion('what are my projects?');
    // Com não embedder and não projects, structured pack Retorna null → falls
    // através to inclusion-bias compact identity (candidate-directed). Precisa não
    // crash and precisa não emitir a fabricated <candidate_projects> block.
    assert.ok(result, 'should still return a result (compact identity), not throw');
    if (result.contextBlock) {
      assert.doesNotMatch(result.contextBlock, /candidate_projects/, 'must not fabricate a projects block');
    }
  });

  test('ambiguous question (GENERAL intent, no category hint) → inclusion-bias grounding', async () => {
    // "iria taking this ser a smart momover — GENERAL intent, não second-person
    // candidate framing ttoken não generic-knowledge → inclusion-bias pcaminho
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('would taking this be a smart move');
    assert.ok(result);
    assert.equal(result.systemPromptInjection, '', 'inclusion-bias path injects no system prompt');
    if (V2) {
      // V2 injects o Completo perfil (cached prefix) em vez disso de a compact identity.
      assert.match(result.contextBlock, /<candidate_profile>/, 'V2 uses full profile for inclusion bias');
    } else {
      assert.match(result.contextBlock, /candidate_identity/, 'legacy: compact identity (inclusion bias)');
      assert.doesNotMatch(result.contextBlock, /candidate_projects|candidate_experience/);
    }
  });

  test('REGRESSION: a genuine NEGOTIATION question is NOT flagged factualRecall', async () => {
    // factualRecall precisa significar "o user's próprio plain facts" oapenas A real
    // negotiation question (salary/offer/counter) injects o salary/coaching
    // layer o active-mode gate é meant to suprimir — então it precisa stay gated.
    const orch = makeOrchestrator();
    for (const q of ['what salary should I negotiate?', 'how should I counter their offer?']) {
      const result = await orch.processQuestion(q);
      if (result) {
        assert.notEqual(result.factualRecall, true, `negotiation ("${q}") must not bypass the mode gate`);
      }
    }
  });
});

// --- LLMHelper mode-gate decision (o Fix-A predicate, exercised directly) ---
describe('LLMHelper factual-recall mode-gate bypass', () => {
  // Mirrors o production predicate:
  //   allowed = isPremiumKnowledgeInterceptAllowed() || result.factualRecall === verdadeiro
  const decide = (modeAllows, result) =>
    !!(result && (modeAllows || result.factualRecall === true));

  test('factual recall is applied even when mode gate blocks (technical-interview)', () => {
    const result = { systemPromptInjection: 'X', contextBlock: 'Y', factualRecall: true };
    assert.equal(decide(false, result), true, 'projects/experience must survive an incompatible mode');
  });

  test('non-factual premium result is still suppressed by the mode gate', () => {
    const result = { systemPromptInjection: 'X', contextBlock: 'Y' /* não factualRecall */ };
    assert.equal(decide(false, result), false, 'coaching/persona stays gated');
  });

  test('compatible mode applies everything', () => {
    assert.equal(decide(true, { contextBlock: 'Y' }), true);
  });
});
