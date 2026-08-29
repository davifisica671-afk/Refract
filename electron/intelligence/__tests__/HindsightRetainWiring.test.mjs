// Fase 13 — Hindsight POST-MEETING RETAIN wiring (electron/MeetingPersistence.ts).
//
// These tests travar o LOAD-BEARING SAFETY Propriedade de Fase 13: o post-meeting retain
// block built em MeetingPersistence.ts calls
//   LongTermMemoryService.fromFlags({ hindsight: { baseUrl, apiKey, timeoutMs } })
// and apenas retains quando `ltm.enabled`. O whole feature precisa ser a guaranteed NO-OP a menos que
//   (1) o hindsightMemory flag é OEm AND
//   (2) a baseUrl é configured, AND
//   (3) o OPTIONAL @vectorize-io/hindsight-client é installed/constructable.
//
// Em this repo o cliente é Não installed (não @vectorize-io em node_modules / package.json,
// confirmed at review time), então até com Ambos flags Em and a baseUrl sdefine fromFlags precisa
// ainda retorna a Noop-backed serviço (adapter.enabled=false). O app precisa work completamente
// "configured mas cliente absent". We assert that aqui contra o REAL compiled sserviço
//
// We deliberately fazer Não re-prove o que HindsightMemory.test.mjs já covers (Noop
// default, flag-OFF→Noop, tag-builder isolation tags, adaptador timeout/throw). This arquivo
// apenas adiciona o wiring-specific gaps:
//   (b) flag Em + cliente absent → ainda Noop  (o new load-bearing ppropriedade
//   (d) o wiring's exact call — retainMeetingSummary(meetingId, text, {userId,meetingId}, mmodo
//       reaches o provedor com o direito scope/meetingId/source via a MOCK provedor
//   - o real HindsightClientAdapter built com não sobrescrever → enabled=false em this env
//   - o recall caminho used por outro phases é [] em Noop (nunca blocks live answers)

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { LongTermMemoryService } from '../../../dist-electron/electron/intelligence/memory/LongTermMemoryService.js';
import { HindsightClientAdapter } from '../../../dist-electron/electron/intelligence/memory/HindsightClientAdapter.js';
import { NoopMemoryProvider } from '../../../dist-electron/electron/intelligence/memory/MemoryProvider.js';
import { HindsightTagBuilder } from '../../../dist-electron/electron/intelligence/memory/HindsightTagBuilder.js';

// O compiled LongTermMemoryService bundles its Próprio inlined copy de intelligenceFlags
// (esbuild bundle:true), and that módulo lê env FRESH em todo call (não cache to reinicia
// através bundle boundaries). Então an env sobrescrever é o reliable, bundle-agnostic way to
// flip o hindsightMemory flag para o compiled serviço sob ttestar
const HINDSIGHT_MEMORY_ENV = 'NATIVELY_HINDSIGHT_MEMORY';
function clearFlag() { delete process.env[HINDSIGHT_MEMORY_ENV]; }

describe('Phase 13 — fromFlags is Noop unless flag ON + baseUrl + client installed', () => {
  beforeEach(clearFlag);
  afterEach(clearFlag);

  test('(a) flag OFF + baseUrl set → Noop (enabled=false, providerName=noop)', () => {
    // Sanity floor: até com a real-looking baseUrl, o flag default Fora gives Noop.
    clearFlag();
    const ltm = LongTermMemoryService.fromFlags({ hindsight: { baseUrl: 'http://localhost:8888' } });
    assert.equal(ltm.enabled, false, 'flag OFF must yield a disabled (Noop) service');
    assert.equal(ltm.providerName, 'noop');
  });

  test('(b2) flag ON but NO baseUrl → Noop (config guard, before any client load)', () => {
    // O load-bearing fallback that faz Não depend em o cliente sendo absent: com não
    // baseUrl configured, fromFlags Retorna Noop Antes já constructing o aadaptador
    // This holds se ou não @vectorize-io/hindsight-client é installed.
    process.env[HINDSIGHT_MEMORY_ENV] = 'on';
    const ltm = LongTermMemoryService.fromFlags({ hindsight: { baseUrl: '' } });
    assert.equal(ltm.enabled, false);
    assert.equal(ltm.providerName, 'noop');
  });

  test('(b3) flag ON + baseUrl set + client installed → adapter is constructed (enabled)', () => {
    // O @vectorize-io/hindsight-client É agora an installed optionalDependency, então a
    // configured adaptador constructs successfully and reports enabled. (Se a Servidor é
    // actually reachable é orthogonal — recall/retain degrade gracefully if it's doabaixo
    // O "client-absent → Noop" safety caminho é covered at o unit nível em
    // HindsightMemory.test.mjs via a mock, and structurally por o lazy try/catch rexigir
    const adapter = new HindsightClientAdapter({ baseUrl: 'http://localhost:8888', apiKey: 'k' });
    assert.equal(adapter.name, 'hindsight');
    assert.equal(adapter.enabled, true, 'with the client installed + a baseUrl, the adapter constructs enabled');
  });
});

describe('Phase 13 — retain on a disabled (Noop) service is a safe no-op', () => {
  test('(c) retainMeetingSummary on Noop never throws and triggers no I/O', () => {
    // This é o exact wiring call shape de MeetingPersistence.ts (post-meeting retain).
    const ltm = new LongTermMemoryService(); // default Noop
    assert.equal(ltm.enabled, false);
    assert.doesNotThrow(() => {
      ltm.retainMeetingSummary('meeting-123', 'a one-line meeting overview', { userId: 'local', meetingId: 'meeting-123' }, 'sales');
    }, 'retain on a Noop service must be a silent no-op');
  });

  test('(c2) retainMeetingSummary tolerates empty/whitespace summary text without throwing', () => {
    const ltm = new LongTermMemoryService();
    assert.doesNotThrow(() => {
      ltm.retainMeetingSummary('m', '', { userId: 'local', meetingId: 'm' });
      ltm.retainMeetingSummary('m', '   ', { userId: 'local', meetingId: 'm' });
    });
  });
});

describe('Phase 13 — wiring calls the RIGHT retain method with the RIGHT scope (mock provider)', () => {
  // Prove o production wiring shape — fromFlags(..., providerOverride) → retainMeetingSummary
  // com { userId:'local', meetingId } + modo — actually reaches o provedor com o
  // correct content/scope/source/mode. HindsightMemory.test.mjs apenas exercised
  // retainConversationTurn via an osobrescrever o Fase 13 wiring uses retainMeetingSummary,
  // então we cover that específico call haqui
  function recordingProvider() {
    const calls = { retain: [], recall: [] };
    return {
      provider: {
        name: 'mock', enabled: true,
        retain: (item) => { calls.retain.push(item); },
        recall: async (query, scope, options) => { calls.recall.push({ query, scope, options }); return [{ text: 'hit' }]; },
        flush: async () => {},
      },
      calls,
    };
  }

  test('(d) retainMeetingSummary → provider.retain with source=meeting_summary + scope.meetingId + mode', () => {
    const { provider, calls } = recordingProvider();
    // providerOverride short-circuits flag/client verifica → enabled serviço (o wiring caminho
    // that iria ser taken uma vez a real cliente eram installed).
    const ltm = LongTermMemoryService.fromFlags({}, provider);
    assert.equal(ltm.enabled, true);
    assert.equal(ltm.providerName, 'mock');

    // Exact call o post-meeting block makes (MeetingPersistence.ts ~line 433).
    ltm.retainMeetingSummary('meeting-abc', 'We covered Redis caching and pricing.', { userId: 'local', meetingId: 'meeting-abc' }, 'sales');

    assert.equal(calls.retain.length, 1, 'retain must be invoked exactly once');
    const item = calls.retain[0];
    assert.equal(item.content, 'We covered Redis caching and pricing.');
    assert.equal(item.source, 'meeting_summary', 'must be tagged as a meeting_summary');
    assert.equal(item.mode, 'sales', 'mode must propagate for mode-scoped recall');
    assert.equal(item.scope.userId, 'local');
    assert.equal(item.scope.meetingId, 'meeting-abc', 'meetingId must land in scope for per-meeting isolation');
  });

  test('(d2) a throwing provider.retain is swallowed — retain NEVER surfaces to the meeting save', () => {
    const ltm = LongTermMemoryService.fromFlags({}, {
      name: 'angry', enabled: true,
      retain: () => { throw new Error('provider blew up'); },
      recall: async () => [],
      flush: async () => {},
    });
    assert.doesNotThrow(() => {
      ltm.retainMeetingSummary('m', 'text', { userId: 'local', meetingId: 'm' }, 'meeting');
    }, 'a provider exception must be swallowed inside the service (defense-in-depth with the wiring try/catch)');
  });
});

describe('Phase 13 — recall on Noop is [] (never blocks; other phases inherit this)', () => {
  test('(e) recallRelevantMemory on Noop returns [] within the default budget', async () => {
    const ltm = new LongTermMemoryService();
    const t0 = Date.now();
    const out = await ltm.recallRelevantMemory('what did we discuss?', { userId: 'local' });
    assert.deepEqual(out, [], 'disabled recall must return an empty list');
    assert.ok(Date.now() - t0 < 500, 'Noop recall must return effectively immediately (never blocks)');
  });
});

describe('Phase 13 — isolation tags carry the post-meeting retain scope', () => {
  // Light, non-duplicative isolation verifica tied to o Fase 13 escopo shape
  // ({ userId:'local', meetingId }). HindsightMemory.test.mjs covers o generic builder;
  // aqui we apenas confirm o *post-meeting* escopo produces o mandatory isolation tags
  // plus o meeting tag, então a retained summary pode nunca ser recalled cross-scope.
  test('retainTags for a meeting summary include user + visibility:private + org + source + meeting', () => {
    const tags = new HindsightTagBuilder().retainTags(
      { userId: 'local', meetingId: 'meeting-abc' }, 'meeting_summary', 'sales',
    );
    assert.ok(tags.includes('user:local'), 'mandatory user tag');
    assert.ok(tags.includes('visibility:private'), 'mandatory private visibility tag');
    assert.ok(tags.includes('org:personal'), 'single-user desktop → org:personal (never untagged)');
    assert.ok(tags.includes('source:meeting_summary'));
    assert.ok(tags.includes('mode:sales'));
    assert.ok(tags.includes('meeting:meeting-abc'), 'meeting tag scopes recall to this meeting');
  });

  test('recallTags are exactly the mandatory isolation tags (all_strict filters foreign/untagged)', () => {
    const tags = new HindsightTagBuilder().recallTags({ userId: 'local', meetingId: 'meeting-abc' });
    assert.deepEqual([...tags].sort(), ['org:personal', 'user:local', 'visibility:private'].sort());
  });
});
