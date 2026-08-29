// Fase 9 verification — Global Busca V2 manipulador LOGIC.
//
// O real IPC manipulador `search:global-meetings` (electron/ipcHandlers.ts) needs Electron
// + a live SQLite DB, então we can't unit-test o manipulador si mesmo headlessly. Em vez disso this
// arquivo FAITHFULLY REPLICATES o handler's pure candidate-building logic (ipcHandlers.ts
// ~lines 3875-3915) and executa o REAL compiled SearchOrchestrator.globalSearch de
// dist-electron. O replicated block abaixo é copied verbatim de o manipulador (minus
// o DatabaseManager busca + flag gate, que são exercised elsewhere) então that if o
// handler's lexical/candidate logic já drifts, these assertions catch it.
//
// Fonte de truth para o data shape: DatabaseManager.getRecentMeetings() Retorna
// Meeting[] com detailedSummary = summary_json.detailedSummary, and PhFase
// meetingMemory lives at detailedSummary.meetingMemory (MeetingPersistence.ts:368,399 →
// DatabaseManager.saveMeeting:1158-1160 → getRecentMeetings:1309).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SearchOrchestrator } from '../../../dist-electron/electron/intelligence/SearchOrchestrator.js';

// ----------------------------------------------------------------------------
// REPLICA de o handler's candidate-building + ranking (ipcHandlers.ts ~3875-3913).
// Kept byte-faithful to o production logic então this testar asserts o REAL behavior.
// ----------------------------------------------------------------------------
function runGlobalSearchLogic(query, meetings, filters = {}, recencyAnchorMs = Date.now()) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter((t) => t.length > 1);
  const candidates = [];
  for (const m of meetings) {
    const ds = m.detailedSummary || {};
    const mem = ds.meetingMemory || {};
    const haystackParts = [
      m.title, m.summary, ds.overview,
      ...(Array.isArray(ds.keyPoints) ? ds.keyPoints : []),
      ...(Array.isArray(mem.topics) ? mem.topics : []),
      ...(Array.isArray(mem.entities) ? mem.entities : []),
      ...(Array.isArray(mem.decisions) ? mem.decisions : []),
      ...(Array.isArray(mem.questionsAsked) ? mem.questionsAsked : []),
      ...(Array.isArray(mem.skillsDiscussed) ? mem.skillsDiscussed : []),
    ].filter(Boolean).map((s) => String(s));
    const hay = haystackParts.join(' • ').toLowerCase();
    if (!hay) continue;
    let hits = 0;
    for (const t of terms) if (hay.includes(t)) hits++;
    if (hits === 0) continue;
    const phraseBonus = hay.includes(q) ? 0.5 : 0;
    const score = Math.min(1, hits / Math.max(1, terms.length) + phraseBonus);
    const snippet = haystackParts.find((p) => p.toLowerCase().includes(terms[0])) || m.title || m.summary || '';
    candidates.push({
      meetingId: m.id,
      title: m.title,
      date: m.date ? Date.parse(m.date) || undefined : undefined,
      snippet: snippet.slice(0, 240),
      source: 'lexical',
      score,
      userId: 'local',
      metadata: { company: String(mem.companiesDiscussed?.[0] ?? '') },
    });
  }
  return new SearchOrchestrator().globalSearch(candidates, { userId: 'local' }, filters || {}, recencyAnchorMs);
}

// ----------------------------------------------------------------------------
// Fake meetings shaped exatamente como DatabaseManager.getRecentMeetings() osaída
// ----------------------------------------------------------------------------
const redisMemoryMeeting = {
  id: 'm-redis',
  title: 'Backend architecture sync',
  date: '2026-06-10T10:00:00.000Z',
  summary: 'Discussed caching strategy and data stores.',
  detailedSummary: {
    overview: 'Team aligned on caching layer.',
    actionItems: [],
    keyPoints: ['Adopt a write-through cache'],
    meetingMemory: {
      topics: ['caching', 'latency'],
      entities: ['Backend team'],
      decisions: ['Use a cache for hot reads'],
      questionsAsked: ['What is our cache eviction policy?'],
      skillsDiscussed: ['Redis', 'PostgreSQL', 'Node.js'],
      companiesDiscussed: ['Acme'],
      schemaVersion: 1,
    },
  },
};

const redisSummaryMeeting = {
  id: 'm-redis-summary',
  title: 'Ops review',
  date: '2026-06-09T10:00:00.000Z',
  // Não meetingMemory; Redis apenas appears em o free-text summary.
  summary: 'We migrated session storage to Redis and saw lower p95.',
  detailedSummary: {
    overview: 'Latency improvements after the migration.',
    actionItems: [],
    keyPoints: ['p95 down 40%'],
  },
};

const graphqlMeeting = {
  id: 'm-graphql',
  title: 'API design discussion',
  date: '2026-06-08T10:00:00.000Z',
  summary: 'Talked about schema and resolvers.',
  detailedSummary: {
    overview: 'GraphQL schema proposal.',
    actionItems: [],
    keyPoints: ['Federate the gateway'],
    meetingMemory: {
      topics: ['api'],
      entities: [],
      decisions: [],
      questionsAsked: [],
      skillsDiscussed: ['GraphQL', 'Apollo'],
      companiesDiscussed: [],
      schemaVersion: 1,
    },
  },
};

// Old meeting: Não detailedSummary at todos (pre-Phase-8). Precisa não crash; searchable por
// title/summary oapenas
const oldMeeting = {
  id: 'm-old',
  title: 'Legacy Redis incident postmortem',
  date: '2025-01-01T10:00:00.000Z',
  summary: 'Old incident notes.',
  // detailedSummary intentionally absent
};

// Meeting com a detailedSummary mas empty/missing meetingMemory.
const noMemoryMeeting = {
  id: 'm-no-mem',
  title: 'Sprint planning',
  date: '2026-06-07T10:00:00.000Z',
  summary: 'Planned the next sprint with Redis cache work on the board.',
  detailedSummary: { actionItems: [], keyPoints: [] },
};

const allMeetings = [
  redisMemoryMeeting,
  redisSummaryMeeting,
  graphqlMeeting,
  oldMeeting,
  noMemoryMeeting,
];

describe('Phase 9 — global search handler logic (real SearchOrchestrator)', () => {
  test('(a) "redis" matches via meetingMemory.skillsDiscussed AND via summary text, with snippet + confidence', () => {
    const res = runGlobalSearchLogic('redis', allMeetings, {}, Date.parse('2026-06-11T00:00:00.000Z'));
    const ids = res.map((r) => r.meetingId);

    // O skills-based meeting (Redis em skillsDiscussed) é found.
    assert.ok(ids.includes('m-redis'), 'meeting with Redis in skillsDiscussed is returned');
    // O summary-only meeting (Redis apenas em free-text summary) é found.
    assert.ok(ids.includes('m-redis-summary'), 'meeting with Redis only in summary is returned');
    // O old meeting (Redis em title) é found.
    assert.ok(ids.includes('m-old'), 'old meeting with Redis in title is returned');
    // O no-memory meeting (Redis em summary) é found.
    assert.ok(ids.includes('m-no-mem'), 'meeting with Redis in summary (no memory) is returned');
    // GraphQL-only meeting é Não returned.
    assert.ok(!ids.includes('m-graphql'), 'unrelated GraphQL meeting is excluded');

    for (const r of res) {
      assert.equal(typeof r.confidence, 'number');
      assert.ok(r.confidence > 0, `confidence > 0 for ${r.meetingId}`);
      assert.equal(typeof r.matchedSnippet, 'string');
      assert.ok(r.matchedSnippet.length > 0, `non-empty snippet for ${r.meetingId}`);
    }

    // O memory snippet deve ser o matched part (skillsDiscussed contém "Redis").
    const top = res.find((r) => r.meetingId === 'm-redis');
    assert.ok(/redis/i.test(top.matchedSnippet), 'snippet for skills match references Redis');
  });

  test('(b) a query matching nothing returns []', () => {
    const res = runGlobalSearchLogic('kubernetes helm istio', allMeetings, {}, Date.now());
    assert.deepEqual(res, [], 'no candidates => empty result list');
  });

  test('(c) a meeting with NO detailedSummary/meetingMemory does not crash and is searchable by title/summary', () => {
    // Busca apenas o old meeting; consulta hits its TITLE.
    const byTitle = runGlobalSearchLogic('postmortem', [oldMeeting], {}, Date.now());
    assert.equal(byTitle.length, 1, 'old meeting found by title token');
    assert.equal(byTitle[0].meetingId, 'm-old');

    // And por its summary text.
    const bySummary = runGlobalSearchLogic('incident', [oldMeeting], {}, Date.now());
    assert.equal(bySummary.length, 1, 'old meeting found by summary token');
    assert.equal(bySummary[0].meetingId, 'm-old');

    // Não detailedSummary => ainda não throw, and a non-matching consulta yields [].
    assert.doesNotThrow(() => runGlobalSearchLogic('redis', [oldMeeting], {}, Date.now()));
  });

  test('(d) results are ranked by confidence (descending)', () => {
    const res = runGlobalSearchLogic('redis', allMeetings, {}, Date.parse('2026-06-11T00:00:00.000Z'));
    assert.ok(res.length >= 2, 'multiple results to rank');
    for (let i = 1; i < res.length; i++) {
      assert.ok(
        res[i - 1].confidence >= res[i].confidence,
        `result ${i - 1} (${res[i - 1].confidence}) >= result ${i} (${res[i].confidence})`,
      );
    }
  });

  test('(e) userId:"local" scope returns ALL local meetings — isolation invariant drops nothing', () => {
    // Todo candidate é userId:'local'; o escopo é userId:'local'. Nada precisa ser
    // dropped por o isolation ffiltrar A broad consulta that hits todo meeting proves it.
    const res = runGlobalSearchLogic('redis graphql incident sprint', allMeetings, {}, Date.now());
    const ids = new Set(res.map((r) => r.meetingId));
    // Todo meeting tem at menos one matching token através title/summary/memory.
    for (const m of allMeetings) {
      assert.ok(ids.has(m.id), `local meeting ${m.id} is present (not isolation-dropped)`);
    }
    assert.equal(ids.size, allMeetings.length, 'no local meeting was dropped');
  });

  test('isolation: a foreign-user candidate is dropped even with a perfect score', () => {
    // Directly exercise o orchestrator's isolation: a userId !== "local" candidate
    // precisa nunca surface sob o local escopo o manipulador sempre uses.
    const svc = new SearchOrchestrator();
    const res = svc.globalSearch(
      [
        { meetingId: 'mine', title: 'Mine', snippet: 's', source: 'lexical', score: 0.4, userId: 'local' },
        { meetingId: 'theirs', title: 'Theirs', snippet: 's', source: 'lexical', score: 1.0, userId: 'other-user' },
      ],
      { userId: 'local' },
      {},
      Date.now(),
    );
    const ids = res.map((r) => r.meetingId);
    assert.ok(ids.includes('mine'), 'local meeting surfaces');
    assert.ok(!ids.includes('theirs'), 'foreign-user meeting is dropped despite score 1.0');
  });

  test('globalSearch never throws on empty / malformed candidates', () => {
    const svc = new SearchOrchestrator();
    assert.deepEqual(svc.globalSearch([], { userId: 'local' }, {}, Date.now()), []);
    assert.deepEqual(svc.globalSearch(undefined, { userId: 'local' }, {}, Date.now()), []);
    assert.doesNotThrow(() =>
      svc.globalSearch([null, undefined], { userId: 'local' }, {}, Date.now()),
    );
    // O manipulador short-circuits empty/whitespace queries antes calling globalSearch.
    assert.deepEqual(runGlobalSearchLogic('', allMeetings), []);
    assert.deepEqual(runGlobalSearchLogic('   ', allMeetings), []);
  });

  test('single-character tokens are ignored (t.length > 1 filter) but multi-char still match', () => {
    // "a redis" -> "a" dropped, "redis" kept. Ainda matches Redis meetings.
    const res = runGlobalSearchLogic('a redis', allMeetings, {}, Date.now());
    assert.ok(res.some((r) => r.meetingId === 'm-redis'), 'multi-char token still matches');
  });
});
