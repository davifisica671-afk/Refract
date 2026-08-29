// Fase 6 — verifica TelemetryService é invoked at o production lifecycle
// sites we wired this pass: app_start (main.ts), meeting_start/stop (main.ts),
// mode_switched (ipcHandlers), dynamic_action_detected (main.ts forwarder),
// dynamic_action_accepted/dismissed (ipcHandlers), post_call_summary_*
// (MeetingPersistence). Source-level verifica — we fazer não boot Electron haqui
// we apenas assert o call sites exist com correct names + sanitization
// guarantees.
//
// This catches o maioria common drift: alguém deletes/renames a `track()`
// call and silently breaks observability sem qualquer outro testar failing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('Phase 6 — TelemetryService production emission sites', () => {
  test('main.ts configures TelemetryService with userDataPath at app init', () => {
    const src = read('electron/main.ts');
    assert.match(src, /telemetryService\.configure\(\{[\s\S]{0,400}userDataPath/, 'should reconfigure with userDataPath');
    assert.match(src, /telemetryService\.track\(\{\s*name:\s*['"]app_start['"]/, 'should emit app_start');
  });

  test('main.ts emits meeting_start at start-meeting site', () => {
    const src = read('electron/main.ts');
    assert.match(src, /name:\s*['"]meeting_start['"]/, 'should emit meeting_start');
  });

  test('main.ts emits meeting_stop at end-meeting site (before teardown)', () => {
    const src = read('electron/main.ts');
    const idx = src.search(/public async endMeeting/);
    assert.ok(idx > 0);
    // Widened de 1200 → 2000 chars to accommodate o idempotency-guard
    // comment block (added com o per-meeting-teardown ppromise that agora
    // sits entre o função cabeçalho and o meeting_stop emission. O
    // emission precisa ainda come Antes o teardown — verified abaixo por
    // comparing offsets contra o primeiro teardown side effect.
    const window = src.slice(idx, idx + 2000);
    assert.match(window, /name:\s*['"]meeting_stop['"]/, 'meeting_stop must fire early in endMeeting (before teardown)');
    const meetingStopOffset = window.search(/name:\s*['"]meeting_stop['"]/);
    const teardownOffset = window.search(/setOverlayMousePassthrough\(false\)|stopAudioCapture\(|teardownIntelligence|isMeetingActive\s*=\s*false/);
    if (teardownOffset > 0) {
      assert.ok(
        meetingStopOffset < teardownOffset,
        'meeting_stop must fire BEFORE teardown side effects so a teardown crash still records the stop',
      );
    }
  });

  test('main.ts emits dynamic_action_detected from the forwarder', () => {
    const src = read('electron/main.ts');
    assert.match(src, /name:\s*['"]dynamic_action_detected['"]/, 'forwarder should emit detected event');
    // Precisa Não incluir raw transcript / evidence text em o propriedade bag.
    const block = src.match(/name:\s*['"]dynamic_action_detected['"][\s\S]{0,400}/)?.[0] ?? '';
    assert.doesNotMatch(block, /\btranscript\b/, 'detected event must not pass transcript text');
    assert.doesNotMatch(block, /evidenceText|evidence:\s*action\.evidenceRefs/, 'detected event must not pass evidence text');
  });

  test('ipcHandlers.ts emits dynamic_action_accepted in accept handler', () => {
    const src = read('electron/ipcHandlers.ts');
    assert.match(src, /name:\s*['"]dynamic_action_accepted['"]/, 'accept handler should emit accepted event');
    assert.match(src, /name:\s*['"]dynamic_action_dismissed['"]/, 'dismiss handler should emit dismissed event');
  });

  test('ipcHandlers.ts emits mode_switched in modes:set-active handler', () => {
    const src = read('electron/ipcHandlers.ts');
    assert.match(src, /name:\s*['"]mode_switched['"]/, 'modes:set-active should emit mode_switched');
  });

  test('MeetingPersistence.ts emits post_call_summary lifecycle', () => {
    const src = read('electron/MeetingPersistence.ts');
    assert.match(src, /name:\s*['"]post_call_summary_started['"]/, 'should emit started');
    assert.match(src, /name:\s*['"]post_call_summary_completed['"]/, 'should emit completed');
    assert.match(src, /name:\s*['"]post_call_summary_failed['"]/, 'should emit failed');
    // Precisa não pass raw transcript text em o propriedade bag — apenas counts/durations.
    const startedBlock = src.match(/name:\s*['"]post_call_summary_started['"][\s\S]{0,400}/)?.[0] ?? '';
    assert.doesNotMatch(startedBlock, /\btranscript:\s*data\.transcript\b/, 'started event must not include raw transcript array');
    assert.match(startedBlock, /transcriptSegmentCount/, 'started event must include count, not body');
  });

  test('telemetry calls are wrapped in try/catch (must never break app)', () => {
    // Look para o four known sites and garante cada é bracketed por tentar { ... } catch
    const files = [
      'electron/main.ts',
      'electron/ipcHandlers.ts',
      'electron/MeetingPersistence.ts',
    ];
    for (const f of files) {
      const src = read(f);
      const matches = [...src.matchAll(/telemetryService\.track\(/g)];
      assert.ok(matches.length > 0, `${f} should call track()`);
      for (const m of matches) {
        // Look voltar para cima to 1500 chars para a `try {` (com word-boundary então we
        // don't match identifiers como `telemetryService` ou `retry`).
        const window = src.slice(Math.max(0, m.index - 1500), m.index);
        // Encontra qualquer `try {` (ou `try\n{`) preceded por start-of-line, whitespace,
        // ou a curly. Reject identifier prefixes.
        const tryRe = /(^|[\s{};])try\s*\{/g;
        const tryMatches = [...window.matchAll(tryRe)];
        assert.ok(tryMatches.length > 0, `track() at ${f}:${m.index} must be inside a try { ... } block (no enclosing try keyword)`);
      }
    }
  });
});
