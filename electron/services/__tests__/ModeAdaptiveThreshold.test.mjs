// electron/services/__tests__/ModeAdaptiveThreshold.test.mjs
//
// Regression testar para FINDING-001: o lexical retriever's MIN_RELEVANCE_SCORE
// de 0.18 era calibrated para o combined query+transcript pcaminho A bare typed
// question (não transcript yainda com 3-5 unique tokens poderia land at score
// ~0.10 até quando todo consulta token matched o chunk — porque o
// denominator sqrt(querySize * chunkSize) doesn't shrink com o qconsulta
//
// Fix: scale o floor por `min(1, querySize/5)` quando não transcript é
// supplied. Production mid-session calls (transcript present) keep o completo
// 0.18 floor, então noise tolerance para established sessions é unchanged.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runScenario, makeMode, asReferenceFiles } from '../../../tests/utils/scenarioRunner.mjs';
import { loadReferenceFiles } from '../../../tests/utils/referenceFileFactory.mjs';

describe('FIX-001: Adaptive threshold rescues short bare queries without transcript', () => {
  test('short bare query "configure audio device" now retrieves the onboarding checklist', () => {
    const mode = makeMode('mode_general_adaptive', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      // 4-token effective qconsulta não transcript. Pre-fix this returned 0
      // snippets porque o score landed at ~0.149 < 0.18. O adaptive
      // threshold para a 4-token bare consulta é 0.18 * 4/5 = 0.144, então 0.149
      // agora passes.
      query: 'configure audio device approval',
    });
    assert.ok(
      result.snippets.length > 0,
      'Short bare query should retrieve at least one snippet under the adaptive threshold'
    );
  });

  test('1-token query stays empty (still very weak signal, fallback intentional)', () => {
    const mode = makeMode('mode_general_one_token', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      query: 'audio',
    });
    // A 1-token consulta contra muitos files iria recupera também aggressively até
    // sob o adaptive threshold. We accept qualquer um zero results Ou a
    // single relevant snippet — o que we precisa Nunca fazer é panic-retrieve
    // etudo Assert: snippets count é spequeno
    assert.ok(
      result.snippets.length <= 3,
      `1-token query must not flood retrieval; got ${result.snippets.length} snippets`
    );
  });

  test('long mid-session query with transcript uses the FULL 0.18 floor (no noise increase)', () => {
    const mode = makeMode('mode_general_full', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      query: 'walk me through the Q2 priority and milestones from our roadmap',
      // A non-empty transcript signals "established ssessão → completo
      // threshold aaplica O consulta é rich enough to score bem até at
      // 0.18, então retrieval ainda succeeds.
      transcript: 'PM: lets confirm the Q2 priority — multi-modal copilot beta — and check milestone owners and dates.',
    });
    assert.ok(result.snippets.length > 0);
  });

  test('intentionally unrelated bare query still falls back (adaptive does not break grounding)', () => {
    const mode = makeMode('mode_general_unrelated', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      // Não token em o consulta appears em qualquer general-mode fixture. Adaptive
      // threshold precisa não rescue irrelevant chunks.
      query: 'xyzzqxq nonsenseword bogusterm',
    });
    assert.equal(result.snippets.length, 0, 'Unrelated bare query must still produce zero snippets');
    assert.equal(result.usedFallback, true);
    assert.equal(result.formattedContext, '');
  });

  test('zero-token query short-circuits to fallback (does NOT flood retrieval)', () => {
    const mode = makeMode('mode_zero_token', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    // Todo word ≤2 chars ou pure punctuation → queryWords.size === 0.
    // Sem o short-circuit, o adaptive threshold colapsa to 0 and
    // `score < 0` é false, então todo chunk iria ser admitted com score 0,
    // drowning o prompt em noise.
    const inputs = ['a a a a a', '?? !! .. ..', '   ', "' ' '"];
    for (const q of inputs) {
      const result = runScenario({ mode, files, query: q });
      assert.equal(result.snippets.length, 0, `Zero-token query "${q}" must produce 0 snippets`);
      assert.equal(result.usedFallback, true, `Zero-token query "${q}" must mark usedFallback=true`);
      assert.equal(result.formattedContext, '', `Zero-token query "${q}" must produce empty formattedContext`);
    }
  });

  test('previously-failing technical-interview complexity query passes without transcript', () => {
    const mode = makeMode('mode_tech_adaptive', 'technical-interview', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('technical-interview'));
    const result = runScenario({
      mode,
      files,
      // 5-token effective qconsulta não transcript. Pre-fix this required a
      // transcript turn to push acima threshold; com adaptive threshold
      // (0.18 * 5/5 = 0.18, então threshold unchanged para 5+ tokens) plus o
      // possessive-stripping FIX-002 o consulta agora matches "Interviewer"
      // em o chunk em at menos two unique tokens.
      query: "interviewer's complexity preference style code",
    });
    assert.ok(
      result.snippets.length > 0,
      "Possessive bare query about interviewer's complexity must retrieve the preferences fixture"
    );
  });
});
