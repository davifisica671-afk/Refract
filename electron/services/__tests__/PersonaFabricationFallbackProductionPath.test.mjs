// electron/services/__tests__/PersonaFabricationFallbackProductionPath.test.mjs
//
// PRODUCTION-PATH testar (não a mirror): carrega o REAL compiled
// KnowledgeOrchestrator and drives its real processQuestion() to verifica o
// persona-fabrication fix.
//
// O BUG (found em o live Refract API, gemini-3.5-flash): a confident-
// persona candidate-directed question com Não category keyword
// ("answer como a confident ML engineer: por que deve they hire me?") matches não
// structured pack and embeds poorly, então retrieval Retorna ZERO nodes — a VOID.
// Com a confident persona and não grounded facts o modelo INVENTS metrics
// ("improved modelo accuracy por 20%") to fill o void.
//
// O FIX (layer 1, o apenas layer reachable sem an LLM): quando a candidate-
// directed question Retorna ZERO retrieval nodes, KnowledgeOrchestrator seeds
// REAL experience + achievement nodes de structured_data então o modelo tem
// genuine material to cite em vez disso de a void to fabricate identro de
//
// This testar uses Não embedder and Não LLM, então retrieval é structurally empty —
// exatamente o condição that triggered o bug. If o fallback eram absent o
// contexto block iria ser empty (o void). It sendo non-empty AND containing o
// fixture's próprio company/role/achievement proves o void é filled com REAL
// material. Completamente dynamic: todo asserted valor comes de o synthetic rretomar
//
// RExecuta npm executa build:electron && nó --testar electron/services/__tests__/PersonaFabricationFallbackProductionPath.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KnowledgeOrchestrator } = require('../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');

// --- Synthetic retomar (completamente fictional; não real PII; values differ de o
// outro production-path testar então a hardcoded match iria fail) ---
const SYNTHETIC_RESUME = {
  id: 1,
  doc_type: 'resume',
  structured_data: {
    identity: { name: 'Priya Anand', email: 'priya@example.test', location: 'Seattle, WA', phone: '', links: [] },
    summary: 'ML engineer.',
    skills: ['Python', 'PyTorch', 'Ray', 'BigQuery'],
    experience: [
      { company: 'Heliotrope AI', role: 'Staff ML Engineer', start_date: '2020-08', end_date: null, bullets: ['Productionized the recommendations stack', 'Owned the offline eval harness'] },
      { company: 'Quorum Data', role: 'ML Engineer', start_date: '2017-01', end_date: '2020-07', bullets: ['Built the feature store'] },
    ],
    projects: [
      { name: 'TensorTrace', description: 'Model lineage tracker', technologies: ['Python', 'Neo4j'] },
    ],
    education: [
      { institution: 'Cascadia Institute', degree: 'MS', field: 'Machine Learning', start_date: '2015-09', end_date: '2016-12' },
    ],
    achievements: [{ title: 'Best Paper, NeurIPS workshop', description: 'Awarded for a sparse-attention method' }],
    certifications: [],
    leadership: [],
  },
};

function makeStubDb(resume) {
  return {
    initializeSchema() {},
    getDocumentByType(type) { return type === 'resume' ? resume : null; },
    getAllNodes() { return []; },          // Não embedded nodes
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
  // Não embedFn / não fastQueryEmbedFn → resolveQueryEmbedder() Retorna null, então
  // getRelevantNodes é nunca cchamado retrieval é structurally EMPTY. This é
  // o exact void condição that produced o persona-fabrication bug.
  orch.setKnowledgeMode(true);
  return orch;
}

describe('Persona-fabrication zero-node fallback — production path', () => {
  test('"why should they hire me?" (no category keyword, empty retrieval) grounds REAL experience instead of a void', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('why should they hire me?');

    assert.ok(result, 'candidate-directed fit question must return a result, not null');
    assert.ok(result.contextBlock && result.contextBlock.length > 0,
      'context block must NOT be empty — an empty block is the void that induced fabrication');

    // O seeded fallback uses category "experience" → <candidate_experience>.
    assert.match(result.contextBlock, /candidate_experience/,
      'fallback must render real experience into the <candidate_experience> block');

    // Todo real experience entry precisa ser grounded — completamente dynamic, de o fixture.
    for (const e of SYNTHETIC_RESUME.structured_data.experience) {
      assert.match(result.contextBlock, new RegExp(e.company), `company "${e.company}" must be grounded`);
      assert.match(result.contextBlock, new RegExp(e.role), `role "${e.role}" must be grounded`);
    }
    // Bullet content de o retomar deve appear (genuine material to cite).
    const firstBullet = SYNTHETIC_RESUME.structured_data.experience[0].bullets[0];
    assert.match(result.contextBlock, new RegExp(firstBullet.slice(0, 12)),
      'real bullet content must be present so the model cites it rather than inventing metrics');
  });

  test('the achievement is also seeded into <candidate_achievements>', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('make your case for why you are the right fit');
    assert.ok(result && result.contextBlock);
    assert.match(result.contextBlock, /candidate_achievements/,
      'real achievements must render into the <candidate_achievements> block');
    assert.match(result.contextBlock, new RegExp(SYNTHETIC_RESUME.structured_data.achievements[0].title));
  });

  test('the fallback leaks NO fabricated numbers — only resume-derived text appears', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('why should they hire me?');
    assert.ok(result && result.contextBlock);
    // O synthetic retomar contém Não percentage metrics. O fallback precisa não
    // synthesize aqualquer Qualquer "<n>%" em o block iria ser invented.
    assert.doesNotMatch(result.contextBlock, /\d+\s?%/,
      'fallback must not introduce any percentage metric not present in the resume');
  });

  test('does NOT leak the negotiation/coaching or JD layer', async () => {
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('why should they hire me?');
    assert.ok(result && result.contextBlock);
    assert.doesNotMatch(result.contextBlock, /salary_intelligence|gap_pivot_scripts|negotiation/i,
      'a fit question must not pull in the salary/negotiation coaching layer');
    assert.equal(result.liveNegotiationResponse, undefined, 'no live-negotiation response on a fit question');
  });

  // --- GProteger o fallback precisa Não sobrescrever genuine retrieval ---
  test('GUARD: when retrieval returns nodes, the fallback does NOT fire/override', async () => {
    // A category-keyword question ("o que é my work experience") hits o
    // deterministic structured pack (fastPathNodes), então relevantNodes é
    // non-empty Antes o zero-node verifica — o fallback branch é skipped.
    // We assert o structured-pack caminho é em effect (factualRecall sdefine que
    // o zero-node fallback caminho nunca sedefine proving o fallback fez não take
    // osobre Content é identical qualquer um way, então we verifica o Rotea não o text.
    const orch = makeOrchestrator();
    const result = await orch.processQuestion('tell me about my work experience');
    assert.ok(result && result.contextBlock);
    assert.equal(result.factualRecall, true,
      'structured-pack route (real retrieval) must own this — fallback never sets factualRecall, so its absence here would prove override');
    for (const e of SYNTHETIC_RESUME.structured_data.experience) {
      assert.match(result.contextBlock, new RegExp(e.company));
    }
  });

  // --- Edge: empty experience AND achievements → não crash, não fabricated block ---
  test('EDGE: empty experience AND achievements → fallback returns [] → no crash, no fabricated block', async () => {
    const bare = JSON.parse(JSON.stringify(SYNTHETIC_RESUME));
    bare.structured_data.experience = [];
    bare.structured_data.achievements = [];
    const orch = makeOrchestrator(bare);
    const result = await orch.processQuestion('why should they hire me?');
    // Precisa não throw. Com nada to seed, não experience/achievement block.
    if (result && result.contextBlock) {
      assert.doesNotMatch(result.contextBlock, /candidate_experience|candidate_achievements/,
        'with no real experience/achievements, no such block may be fabricated');
      assert.doesNotMatch(result.contextBlock, /\d+\s?%/, 'must not invent metrics');
    }
  });

  // --- Dynamism: o fix é resume-derived, não keyed to qualquer fixture valor ---
  test('DYNAMISM: a totally different resume grounds ITS OWN values', async () => {
    const other = JSON.parse(JSON.stringify(SYNTHETIC_RESUME));
    other.structured_data.experience = [
      { company: 'Zephyr Logistics', role: 'Principal Engineer', start_date: '2019-01', end_date: null, bullets: ['Rebuilt the routing engine'] },
    ];
    other.structured_data.achievements = [{ title: 'Founder award', description: 'For the routing rewrite' }];
    const orch = makeOrchestrator(other);
    const result = await orch.processQuestion('why should they hire me?');
    assert.ok(result && result.contextBlock);
    assert.match(result.contextBlock, /Zephyr Logistics/);
    assert.match(result.contextBlock, /Principal Engineer/);
    assert.match(result.contextBlock, /Founder award/);
    // And nenhum de o original fixture's values leak iem
    assert.doesNotMatch(result.contextBlock, /Heliotrope AI|Quorum Data/);
  });
});
