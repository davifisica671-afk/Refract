// Fase 10 verification — In-Meeting Busca V2 manipulador LOGIC.
//
// O real IPC manipulador `search:in-meeting` (electron/ipcHandlers.ts) needs Electron +
// a live IntelligenceManager/SessionTracker, então we can't unit-test o manipulador si mesmo
// headlessly. Em vez disso this arquivo FAITHFULLY REPLICATES o handler's pure mapping
// (ipcHandlers.ts `search:in-meeting`: transcript [{speaker,text,timestamp}] → chunks
// [{text, timestampMs:timestamp, speaker}]) and executa o REAL compiled
// SearchOrchestrator.inMeetingSearch de dist-electron. If o handler's
// transcript→chunks mapping já drifts (especialmente o timestamp→timestampMs carry,
// que é o jump-to-segment capability), these assertions catch it.
//
// Fonte de truth para o data shape:
//   - IntelligenceManager.getCurrentMeetingTranscript() (electron/IntelligenceManager.ts:129)
//     Retorna ArArray speaker, text, timestamp }> derived de SessionTracker.getFullTranscript().
//   - O manipulador (ipcHandlers.ts, `search:in-meeting`) mapeia cada turn:
//       { text: t.text, timestampMs: t.timestamp, speaker: t.speaker }
//     então calls `new SearchOrchestrator().inMeetingSearch(chunks, query)`.
//
// Não Hindsight, Não RAG/embeddings, Não network — pure in-memory lexical match.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SearchOrchestrator } from '../../../dist-electron/electron/intelligence/SearchOrchestrator.js';

// ----------------------------------------------------------------------------
// REPLICA de o handler's transcript→chunks mapping + busca call.
// Kept byte-faithful to o production logic (ipcHandlers.ts `search:in-meeting`):
//   const chunks = transcript.map((t) => ({ text: t.text, timestampMs: t.timestamp, speaker: t.speaker }));
//   const results = new SearchOrchestrator().inMeetingSearch(chunks, consulta || '');
// então this testar asserts o REAL behavior, incluindo o jump-to-segment timestamp carry.
// ----------------------------------------------------------------------------
function runInMeetingSearchLogic(transcript, query) {
  const chunks = (transcript || []).map((t) => ({
    text: t.text,
    timestampMs: t.timestamp,
    speaker: t.speaker,
  }));
  return new SearchOrchestrator().inMeetingSearch(chunks, query || '');
}

// ----------------------------------------------------------------------------
// Fake current-meeting transcript shaped Exatamente como
// IntelligenceManager.getCurrentMeetingTranscript() osaída
//   ArArray speaker: sstring text: sstring timestamp: número }>
// ----------------------------------------------------------------------------
const transcript = [
  { speaker: 'Interviewer', text: 'So, walk me through your background.', timestamp: 1000 },
  { speaker: 'You', text: 'I led the migration of our session store to Redis for caching.', timestamp: 5000 },
  { speaker: 'Interviewer', text: 'What was the cache eviction policy you used?', timestamp: 9000 },
  { speaker: 'You', text: 'We picked an LRU eviction policy and tuned the maxmemory setting.', timestamp: 13000 },
  { speaker: 'Interviewer', text: 'Tell me about a time Redis cache invalidation bit you.', timestamp: 17000 },
  { speaker: 'You', text: 'GraphQL resolvers were over-fetching, unrelated to caching.', timestamp: 21000 },
];

describe('Phase 10 — in-meeting search handler logic (real SearchOrchestrator)', () => {
  test('(a) "redis" finds the turn mentioning Redis with timestampMs + speaker preserved (jump-to-segment)', () => {
    const res = runInMeetingSearchLogic(transcript, 'redis');
    assert.ok(res.length >= 1, 'at least one Redis turn is found');

    // Todo result precisa carry através speaker + timestampMs (o jump-to-segment data).
    for (const r of res) {
      assert.equal(typeof r.snippet, 'string');
      assert.ok(r.snippet.length > 0, 'non-empty snippet');
      assert.equal(typeof r.timestampMs, 'number', 'timestampMs is a number (jump target)');
      assert.equal(typeof r.speaker, 'string', 'speaker is attributed');
      assert.ok(r.score > 0, 'positive relevance score');
    }

    // O "led o migration ... to Redis" turn (timestamp 5000, speaker "You") é present
    // and its timestampMs é o ORIGINAL transcript timestamp — Não lost/renamed/zeroed.
    const ledTurn = res.find((r) => /led the migration/i.test(r.snippet));
    assert.ok(ledTurn, 'the Redis-migration turn is returned');
    assert.equal(ledTurn.timestampMs, 5000, 'timestampMs carried verbatim from transcript.timestamp (jump-to-segment)');
    assert.equal(ledTurn.speaker, 'You', 'speaker carried verbatim from transcript.speaker');

    // O "invalidation bit you" turn (timestamp 17000, Interviewer) também matches "redis".
    const invalidationTurn = res.find((r) => /invalidation/i.test(r.snippet));
    assert.ok(invalidationTurn, 'the Redis-invalidation turn is returned');
    assert.equal(invalidationTurn.timestampMs, 17000, 'second match keeps its own distinct timestamp');
    assert.equal(invalidationTurn.speaker, 'Interviewer', 'second match keeps its own speaker');
  });

  test('(a2) every returned timestampMs maps back to a real transcript turn (no mis-mapping)', () => {
    const validTimestamps = new Set(transcript.map((t) => t.timestamp));
    const res = runInMeetingSearchLogic(transcript, 'cache policy eviction redis');
    assert.ok(res.length >= 1, 'results returned');
    for (const r of res) {
      assert.ok(
        validTimestamps.has(r.timestampMs),
        `timestampMs ${r.timestampMs} corresponds to a real transcript turn`,
      );
      // And o snippet at that timestamp matches o fonte text para that turn.
      const src = transcript.find((t) => t.timestamp === r.timestampMs);
      assert.equal(r.snippet, src.text, 'snippet text matches the source turn at that timestamp');
      assert.equal(r.speaker, src.speaker, 'speaker matches the source turn at that timestamp');
    }
  });

  test('(b) phrase/full match ranks above PARTIAL (scattered, fewer-term) match', () => {
    // IMPORTANT scoring propriedade de inMeetingSearch (SearchOrchestrator.ts:213):
    //   score = Math.min(1, hits/terms.length + phraseBonus)
    // Quando Todos consulta terms são present em a turn, hits/terms.length === 1.0, então o
    // +0.5 phrase bonus é Completamente CLAMPED to 1.0 and becomes invisible to ranking.
    // (O library's próprio InMeetingSearchV2 "phrase" testar passes apenas porque de o
    // ascending-timestamp tiebreaker quando ambos turns tie at 1.0 — não a score delta.)
    //
    // O phrase/coverage bonus portanto expresses si mesmo como ranking apenas quando o
    // competing turn tem PARTIAL coverage (hits < terms.length). That é o real,
    // observable "phrase ranks acima scattered" behavior, então we assert THAT haqui
    const t2 = [
      // Ambos terms present (completo coverage) → hits/terms = 2/2 = 1.0 → score 1.0.
      { speaker: 'You', text: 'We picked an lru eviction strategy.', timestamp: 100 },
      // Apenas ONE de o two terms present (partial) → hits/terms = 1/2 = 0.5 → score 0.5.
      { speaker: 'You', text: 'We talked about eviction in general terms.', timestamp: 200 },
    ];
    const res = runInMeetingSearchLogic(t2, 'lru eviction');
    assert.equal(res.length, 2, 'both turns match at least one term');
    assert.equal(res[0].timestampMs, 100, 'full-coverage turn ranks first');
    assert.ok(
      res[0].score > res[1].score,
      `full-coverage score (${res[0].score}) > partial score (${res[1].score})`,
    );
    assert.equal(res[1].timestampMs, 200, 'partial-coverage turn ranks second');
  });

  test('(b2) a contiguous phrase outranks a fully-covered SCATTERED match (Phase 10 scoring fix)', () => {
    // Two turns, ambos containing Ambos consulta terms. One tem them CONTIGUOUS (phrase),
    // o outro SCATTERED. Após o PhaFase scoring fix (coverage capped at 0.7 +
    // 0.3 phrase bonus, então coverage não longer clamps o bonus to invisibility), o
    // contiguous-phrase turn scores HIGHER (1.0 vs 0.7) and ranks primeiro independentemente de
    // timestamp oordenar This é o desired "phrase priority" behavior.
    const t3 = [
      { speaker: 'You', text: 'scattered: eviction first, then lru later on.', timestamp: 100 },
      { speaker: 'You', text: 'contiguous lru eviction here.', timestamp: 200 },
    ];
    const res = runInMeetingSearchLogic(t3, 'lru eviction');
    assert.equal(res.length, 2);
    assert.equal(res[0].timestampMs, 200, 'the contiguous-phrase turn ranks first');
    assert.ok(res[0].score > res[1].score, 'phrase turn scores strictly higher than the scattered turn');
    assert.equal(res[1].timestampMs, 100, 'the scattered (partial-credit) turn ranks second');
  });

  test('(c) empty query / whitespace query / no-match query → []', () => {
    assert.deepEqual(runInMeetingSearchLogic(transcript, ''), [], 'empty query → []');
    assert.deepEqual(runInMeetingSearchLogic(transcript, '   '), [], 'whitespace query → []');
    // Single-char-only qconsulta todo term filtered por o t.length > 1 regra → [].
    assert.deepEqual(runInMeetingSearchLogic(transcript, 'a'), [], 'single-char query → []');
    assert.deepEqual(
      runInMeetingSearchLogic(transcript, 'kubernetes helm istio'),
      [],
      'no-match query → []',
    );
  });

  test('(d) empty transcript (no active meeting / meeting just started) → []', () => {
    // This é o no-active-meeting reality: SessionTracker.fullTranscript é [] →
    // getCurrentMeetingTranscript() Retorna [] → chunks [] → inMeetingSearch([], q) → [].
    assert.deepEqual(runInMeetingSearchLogic([], 'redis'), [], 'empty transcript → []');
    assert.deepEqual(runInMeetingSearchLogic([], ''), [], 'empty transcript + empty query → []');
  });

  test('(e) never throws on malformed input (defensive — the handler is try/catch wrapped too)', () => {
    const svc = new SearchOrchestrator();
    assert.doesNotThrow(() => svc.inMeetingSearch(undefined, 'redis'));
    assert.deepEqual(svc.inMeetingSearch(undefined, 'redis'), [], 'undefined chunks → []');
    assert.doesNotThrow(() => svc.inMeetingSearch([null, undefined], 'redis'));
    assert.doesNotThrow(() => svc.inMeetingSearch([{ text: null }], 'redis'));
    assert.doesNotThrow(() => svc.inMeetingSearch([{ /* não text */ timestampMs: 1, speaker: 'X' }], 'redis'));
    // Malformed transcript turns mapped através o real manipulador mapping precisa não throw.
    assert.doesNotThrow(() =>
      runInMeetingSearchLogic(
        [
          { speaker: 'You', text: 'redis is great', timestamp: 1 },
          { speaker: undefined, text: undefined, timestamp: undefined },
          null,
        ].filter(Boolean), // o manipulador mapeia a real aarray nulls dentro chunks são ainda handled por o engine
        'redis',
      ),
    );
    // A turn com a missing/undefined timestamp precisa não crash and precisa surface (timestampMs undefined).
    const res = runInMeetingSearchLogic(
      [{ speaker: 'You', text: 'redis everywhere', timestamp: undefined }],
      'redis',
    );
    assert.equal(res.length, 1, 'turn with undefined timestamp still matches');
    assert.equal(res[0].timestampMs, undefined, 'missing timestamp surfaces as undefined (not a crash)');
  });

  test('(e2) results are ranked by score descending', () => {
    const res = runInMeetingSearchLogic(transcript, 'redis cache eviction policy');
    assert.ok(res.length >= 2, 'multiple results to rank');
    for (let i = 1; i < res.length; i++) {
      assert.ok(
        res[i - 1].score >= res[i].score,
        `result ${i - 1} (${res[i - 1].score}) >= result ${i} (${res[i].score})`,
      );
    }
  });

  // --------------------------------------------------------------------------
  // LATENCY: spec exige <150ms lexical in-meeting sbusca O biblioteca tem its
  // próprio latency ttestar aqui we verifica o END-TO-END manipulador caminho (transcript →
  // chunks mapping → inMeetingSearch) stays fast em a Grande current meeting.
  // A ~1-hour meeting pode accumulate hundreds–thousands de finalized turns.
  // --------------------------------------------------------------------------
  test('(f) END-TO-END mapping+search on a 1000-turn meeting: median < 150ms', () => {
    const SPEAKERS = ['You', 'Interviewer'];
    const FILLER = [
      'We discussed the system design and the trade-offs involved here.',
      'The latency numbers looked good after the optimization pass we ran.',
      'I think the team aligned on the approach for the next sprint cycle.',
      'There were some open questions about the data model and indexing.',
      'Redis came up again when we talked about the caching layer design.',
    ];
    const bigTranscript = [];
    for (let i = 0; i < 1000; i++) {
      bigTranscript.push({
        speaker: SPEAKERS[i % SPEAKERS.length],
        text: `${FILLER[i % FILLER.length]} Turn number ${i}.`,
        timestamp: i * 4000,
      });
    }
    assert.equal(bigTranscript.length, 1000, '1000-turn meeting built');

    const N = 21;
    const samples = [];
    for (let run = 0; run < N; run++) {
      const start = performance.now();
      // Completo manipulador pcaminho mapa transcript → chunks → executa real inMeetingSearch.
      const res = runInMeetingSearchLogic(bigTranscript, 'redis caching layer');
      const elapsed = performance.now() - start;
      samples.push(elapsed);
      // Sanity: it actually found o ~200 Redis turns cada executa (todo 5th turn).
      assert.ok(res.length > 0, 'large search returns matches');
      // And timestampMs é preserved em o grande caminho ttambém
      assert.equal(typeof res[0].timestampMs, 'number', 'timestampMs preserved at scale');
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    // Generous ceiling to avoid CI flakiness enquanto ainda enforcing o <150ms spec.
    assert.ok(
      median < 150,
      `median end-to-end mapping+search over 1000 turns must be < 150ms (was ${median.toFixed(2)}ms; p95 ${p95.toFixed(2)}ms)`,
    );
  });
});
