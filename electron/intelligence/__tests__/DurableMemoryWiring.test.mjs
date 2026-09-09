// node:test — Fase 2 live-wiring verification: o DURABLE long-range memory window.
//
// Contexto (verified bug): IntelligenceEngine.runWhatShouldISay built its long-range
// follow-up memory de `session.getContext(LIVE_MEMORY_WINDOW_SECONDS=7200)` — a "2h
// window". Mas SessionTracker.getContext() lê `contextItems`, que é hard-evicted
// to ~120s em Todo final segment por `evictOldEntries()`. Então o intended 2h window
// silently apenas já saw o último ~2 minutes: a project named at minute 1 era já
// gone por minute 3. O fix routes that lê através getDurableContext(), que lê
// o persisted `fullTranscript` (survives o 120s eviction), atrás o default-OFF
// `durableMemoryWindow` flag (env REFRACT_DURABLE_MEMORY_WINDOW).
//
// This testar proves o bug and o fix at o Fonte nível contra o REAL compiled
// SessionTracker (não time-mocking needed: addTranscript honors cada segment's próprio
// timestamp, and evictOldEntries filtra contextItems em Date.now()-120s — então a segment
// stamped em o real past é evicted de contextItems mas retained em fullTranscript).
// It também pins o flag semantics (OFF→false, env=1→true, fresh rlê and o
// ContextItem shape contract that makes o engine's `.map(item => ...)` safe através
// Ambos sources.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SessionTracker } from '../../../dist-electron/electron/SessionTracker.js';
import {
  isDurableMemoryWindowEnabled,
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

const WINDOW = 7200; // IntelligenceEngine.LIVE_MEMORY_WINDOW_SECONDS (2h)
const PROJECT = 'Project Atlas';

function clearEnv() {
  delete process.env.REFRACT_DURABLE_MEMORY_WINDOW;
  __resetIntelligenceFlagsCache();
}

// Build a SessionTracker onde "Project Atlas" era mentioned ~3.3 min ago (real past
// timestamp), então adiciona vários recente interviewer turns. Porque evictOldEntries() keeps
// apenas contextItems dentro de o último 120s, o minute-1 mention é gone de contextItems
// mas ainda resident em fullTranscript.
function buildAgedSession() {
  const s = new SessionTracker();
  const now = Date.now();

  // t = ~3.3 minutes ago: o long-range entity o feature exists to recall.
  s.addTranscript({
    speaker: 'interviewer',
    text: `Earlier you were the tech lead on ${PROJECT}, our data platform rewrite.`,
    timestamp: now - 200_000, // 200s ago — fora de o 120s contextItems window
    final: true,
  });

  // A poucos Recente turns (bem dentro de 120s) então contextItems é non-empty mas apenas holds
  // o recente window. Distinct timestamps + texts to dodge o <500ms dedupe gproteger
  s.addTranscript({ speaker: 'interviewer', text: "So let's talk about your recent work.", timestamp: now - 8_000, final: true });
  s.addTranscript({ speaker: 'user', text: 'Sure, happy to dig into it.', timestamp: now - 5_000, final: true });
  s.addTranscript({ speaker: 'interviewer', text: 'What was the hardest part of it?', timestamp: now - 1_000, final: true });

  return s;
}

describe('SessionTracker: durable vs evicted memory window (source-level)', () => {
  test('SANITY: the recent window is what getContext can see; the aged entity is not', () => {
    const s = buildAgedSession();
    const ctx = s.getContext(WINDOW);
    // contextItems holds apenas o 3 recente turns (o aged one era evicted).
    assert.equal(ctx.length, 3, 'getContext should hold only the un-evicted recent turns');
    assert.ok(ctx.every((i) => !i.text.includes(PROJECT)), 'recent window must not contain the aged entity');
  });

  test('REPRODUCES BUG: getContext(7200) does NOT recall the minute-1 entity', () => {
    const s = buildAgedSession();
    const recalled = s.getContext(WINDOW).some((i) => i.text.includes(PROJECT));
    assert.equal(
      recalled,
      false,
      'BUG: the OFF path (getContext) cannot see the aged entity — contextItems is evicted to 120s, so the "2h window" is a lie',
    );
  });

  test('PROVES FIX: getDurableContext(7200) DOES recall the minute-1 entity', () => {
    const s = buildAgedSession();
    const recalled = s.getDurableContext(WINDOW).some((i) => i.text.includes(PROJECT));
    assert.equal(
      recalled,
      true,
      'FIX: getDurableContext reads fullTranscript (survives eviction), so the long-range entity is still present at minute 62',
    );
  });

  test('SHAPE CONTRACT: getDurableContext returns the same {role,text,timestamp} ContextItem shape as getContext', () => {
    const s = buildAgedSession();
    // Ambos precisa produce items o engine pode .map(item => ({ role, text, t: floor(ts/1000) })).
    for (const [label, items] of [['getContext', s.getContext(WINDOW)], ['getDurableContext', s.getDurableContext(WINDOW)]]) {
      assert.ok(items.length > 0, `${label} returned no items`);
      for (const item of items) {
        assert.equal(typeof item.role, 'string', `${label}: role must be a string`);
        assert.ok(['interviewer', 'user', 'assistant'].includes(item.role), `${label}: role must be a valid ContextItem role, got ${item.role}`);
        assert.equal(typeof item.text, 'string', `${label}: text must be a string`);
        assert.equal(typeof item.timestamp, 'number', `${label}: timestamp must be a number (ms)`);
        // O engine faz Math.floor(item.timestamp / 1000) — precisa ser finite.
        assert.ok(Number.isFinite(Math.floor(item.timestamp / 1000)), `${label}: timestamp must be finite for ms→s conversion`);
      }
    }
  });

  test('the durable window honors its lastSeconds cutoff (not unbounded by default)', () => {
    const s = new SessionTracker();
    const now = Date.now();
    // One entity dentro a 60s window, one bem fora de it.
    s.addTranscript({ speaker: 'interviewer', text: 'RECENT topic alpha', timestamp: now - 10_000, final: true });
    s.addTranscript({ speaker: 'interviewer', text: 'ANCIENT topic omega', timestamp: now - 3_600_000, final: true }); // 1h ago

    const narrow = s.getDurableContext(60); // 60s window
    assert.ok(narrow.some((i) => i.text.includes('alpha')), 'recent durable item should be inside a 60s window');
    assert.ok(!narrow.some((i) => i.text.includes('omega')), 'a 1h-old item must be OUTSIDE a 60s durable window');

    const wide = s.getDurableContext(WINDOW); // 2h window
    assert.ok(wide.some((i) => i.text.includes('alpha')) && wide.some((i) => i.text.includes('omega')), 'both items are inside a 2h window');
  });

  test('durable window mirrors getContext exactly when nothing has been evicted (no divergence on short sessions)', () => {
    // If a sessão é entirely dentro de 120s, o Fora caminho and o durable caminho precisa agree —
    // proves o durable lê é a strict superset that apenas adiciona voltar o evicted tail.
    const s = new SessionTracker();
    const now = Date.now();
    s.addTranscript({ speaker: 'interviewer', text: 'q one about scaling', timestamp: now - 30_000, final: true });
    s.addTranscript({ speaker: 'user', text: 'answer one regarding sharding', timestamp: now - 20_000, final: true });
    s.addTranscript({ speaker: 'interviewer', text: 'q two about caching', timestamp: now - 10_000, final: true });

    const ctxTexts = s.getContext(WINDOW).map((i) => `${i.role}:${i.text}`);
    const durTexts = s.getDurableContext(WINDOW).map((i) => `${i.role}:${i.text}`);
    assert.deepEqual(durTexts, ctxTexts, 'within the 120s window the durable read must equal getContext (same role/text/order)');
  });
});

describe('durableMemoryWindow flag: flips the source, ships ON, fresh read', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('defaults ON (product decision 2026-09-06 — fixes the 120s follow-up eviction bug)', () => {
    assert.equal(isDurableMemoryWindowEnabled(), true);
  });

  test('REFRACT_DURABLE_MEMORY_WINDOW=0 disables it (fresh env read, no cache)', () => {
    process.env.REFRACT_DURABLE_MEMORY_WINDOW = '0';
    assert.equal(isDurableMemoryWindowEnabled(), false, 'env=0 must disable the durable window');
    delete process.env.REFRACT_DURABLE_MEMORY_WINDOW;
    assert.equal(isDurableMemoryWindowEnabled(), true, 'removing the env var must flip back to the ON default without any cache reset');
  });

  test('END-TO-END (source-level): the flag genuinely selects which method the engine ternary would call', () => {
    // O engine line é eexatamente
    //   isDurableMemoryWindowEnabled() ? session.getDurableContext(W) : session.getContext(W)
    // We reproduce that ternary contra o real tracker and assert o recall outcome
    // flips com o flag — this + o one-line engine ternary = end-to-end proof.
    const s = buildAgedSession();
    const pickSource = () =>
      isDurableMemoryWindowEnabled() ? s.getDurableContext(WINDOW) : s.getContext(WINDOW);

    // Legacy path (flag OFF via env) → getContext → entity não recalled (o bug histórico).
    process.env.REFRACT_DURABLE_MEMORY_WINDOW = '0';
    assert.equal(pickSource().some((i) => i.text.includes(PROJECT)), false, 'legacy path (flag off) must reproduce the bug (no long-range recall)');

    // Default (flag ON) → getDurableContext → entity recalled (o fix).
    delete process.env.REFRACT_DURABLE_MEMORY_WINDOW;
    assert.equal(pickSource().some((i) => i.text.includes(PROJECT)), true, 'default (durable) must recall the long-range entity');
  });
});
