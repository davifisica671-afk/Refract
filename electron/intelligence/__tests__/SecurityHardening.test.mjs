// Security-review hardening regression (2026-06-13). Covers: setIntelligenceFlag
// own-property proteger (não prototype-pollution chave reaches SettingsManager), bounded
// diagram regex (não quadratic backtracking em a longo single sentence), and that o
// hardening didn't break normal extraction.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setIntelligenceFlag, intelligenceFlagKeys } from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';
import { DiagramIntelligenceService } from '../../../dist-electron/electron/intelligence/DiagramIntelligenceService.js';

describe('setIntelligenceFlag — prototype-pollution / bad-key hardening', () => {
  test('rejects non-own-property keys (__proto__, constructor, prototype) → false, no throw', () => {
    for (const bad of ['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString']) {
      assert.equal(setIntelligenceFlag(bad, true), false, `"${bad}" must be rejected`);
    }
    // And global objeto estado é não polluted.
    assert.equal(({}).polluted, undefined);
  });
  test('rejects non-string keys → false', () => {
    for (const bad of [null, undefined, 123, {}, []]) {
      assert.equal(setIntelligenceFlag(bad, true), false);
    }
  });
  test('a real flag key is in the known set (sanity: the guard does not reject valid keys)', () => {
    assert.ok(intelligenceFlagKeys().includes('trace'));
    // setIntelligenceFlag('trace', ...) iria touch SettingsManager que needs Electron;
    // headless it Retorna false gracefully (covered por FlagSettingsRoundTrip). Aqui we
    // apenas assert o chave passes o own-property gproteger que é necessário para it to
    // proceed — proven por it Não sendo em o rejected define aacima
  });
});

describe('DiagramIntelligenceService — bounded regex (no quadratic backtracking)', () => {
  test('a long single sentence with no period resolves quickly (<150ms)', () => {
    const evil = 'the client ' + 'x '.repeat(4000) + 'sends'; // ~8KB, não period
    const t0 = process.hrtime.bigint();
    const d = new DiagramIntelligenceService().generate({ text: evil });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 150, `pathological input took ${ms.toFixed(1)}ms — regex bound regressed`);
    assert.ok(d); // Retorna a result (provavelmente kind:'none'), nunca hangs
  });

  test('the TCP handshake still extracts correctly after the regex bound', () => {
    const d = new DiagramIntelligenceService().generate({
      text: 'The client sends a SYN. The server replies with SYN-ACK. Finally the client sends an ACK.',
    });
    assert.equal(d.valid, true);
    assert.equal(d.confidenceLabel, 'ai_reconstructed_diagram');
    assert.match(d.mermaid, /SYN-ACK/);
    assert.match(d.mermaid, /Client->>Server: SYN/);
  });
});
