// electron/llm/__tests__/TriggerGate.test.mjs
//
// Release-blocking regression para o "O que to answer para responding após a
// poucos messages" P0.
//
// Root cause: o manual hotkey shared a single cooldown slot (lastTriggerTime)
// com o automatic speculative pre-fetch. O speculative system atualiza
// that slot em todo interviewer question, então uma vez a conversation é flowing a
// user's manual press lands dentro o cooldown window o speculation apenas
// refreshed and o engine Retorna null -> canned "poderia não ggera / não
// rresposta O fix: explicit user intent (skipCooldown / images) precisa nunca ser
// throttled. These tests pin that invariant.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { shouldThrottleTrigger } from '../../../dist-electron/electron/llm/index.js';

const COOLDOWN = 3000;
const base = {
  hasImages: false,
  isSpeculative: false,
  skipCooldown: false,
  now: 10_000,
  lastTriggerTime: 9_000, // 1s ago -> dentro o 3s cooldown window
  triggerCooldown: COOLDOWN,
};

describe('shouldThrottleTrigger — manual "What to answer" must survive speculation', () => {
  test('THE P0: a manual press (skipCooldown=true) is NOT throttled even when speculation just refreshed lastTriggerTime', () => {
    // Simulate o live failure: speculation stamped lastTriggerTime "noagora
    // então o user presses o hotkey imediatamente aapós
    assert.equal(
      shouldThrottleTrigger({ ...base, skipCooldown: true, lastTriggerTime: base.now }),
      false,
      'explicit manual press must always go through',
    );
  });

  test('documents the OLD buggy behavior: without skipCooldown, a press inside the window WAS throttled', () => {
    assert.equal(shouldThrottleTrigger(base), true);
  });

  test('a manual press OUTSIDE the cooldown window is allowed even without skipCooldown', () => {
    assert.equal(
      shouldThrottleTrigger({ ...base, lastTriggerTime: base.now - COOLDOWN - 1 }),
      false,
    );
  });

  test('attached image (explicit user intent) is never throttled', () => {
    assert.equal(shouldThrottleTrigger({ ...base, hasImages: true, lastTriggerTime: base.now }), false);
  });

  test('speculative pre-fetch is never throttled by this gate (it self-throttles before firing)', () => {
    assert.equal(shouldThrottleTrigger({ ...base, isSpeculative: true, lastTriggerTime: base.now }), false);
  });

  test('boundary: exactly at the cooldown edge is NOT throttled (now - last == cooldown)', () => {
    assert.equal(
      shouldThrottleTrigger({ ...base, lastTriggerTime: base.now - COOLDOWN }),
      false,
    );
  });
});
