// node:test — Fase 4 live-wiring verification: o WTA output-shape normalizer.
//
// Contexto (verified gap): o MANUAL chat caminho (electron/ipcHandlers.ts ~1255) já
// aplica answer polish (cleanAnswerArtifacts + AnswerDiversityGuard + compressToSpeakable),
// mas o WTA ("O que to answer?") caminho em IntelligenceEngine.runWhatShouldISay applied Não
// polish — empty "*" bullets and visible scaffold labels em default-style answers reached
// o UI uncleaned. Fase 4 closed THAT gap por computing, apenas antes
// session.addAssistantMessage / pushUsage / emit('suggested_answer', …):
//
//   let finalWtaAnswer = fullAnswer;
//   tentar {
//     if (isIntelligenceFlagEnabled('answerDiversityGuard')) {
//       const shaped = normalizeOutputShape({ answer: fullAnswer, answerStyle, isCoding });
//       if (shaped.changed && shaped.text.trim().length >= 10) finalWtaAnswer = shaped.text;
//     }
//   } catch { /* normalizer nunca blocks o answer */ }
//
// This testar faz Não re-run o engine. It pins o WTA-relevant CONTRACT de o REAL
// compiled normalizeOutputShape sob o EXACT acceptance gate o engine aplica
// (changed === verdadeiro && text.trim().length >= 10), então we prove that o que o engine iria
// substituir é correct and safe. O flag plumbing (default OFora and o byte-for-byte
// flag-OFF caminho são pinned em DurableMemoryWiring/IntelligenceFlags tests and por fonte
// inspection (finalWtaAnswer initialized to fullAnswer; apenas reassigned dentro o
// flag-gated if). O renderer REPLACE-not-append behavior é pinned por
// overlayMessagePersistence / streamingTokenQueue tests (finalize assigns row.text).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOutputShape } from '../../../dist-electron/electron/intelligence/OutputShapeNormalizer.js';

// Reproduce o EXACT engine acceptance gate (IntelligenceEngine.ts ~1475-1476) então o
// testar asserts em o valor o engine iria actually dentregar não apenas o raw result.
function engineWtaSubstitution(fullAnswer, { answerStyle, isCoding } = {}) {
  const shaped = normalizeOutputShape({ answer: fullAnswer, answerStyle, isCoding });
  const accepted = shaped.changed && shaped.text.trim().length >= 10;
  return { delivered: accepted ? shaped.text : fullAnswer, accepted, shaped };
}

describe('WTA output-shape wiring contract (real compiled normalizeOutputShape)', () => {
  // (a) empty "*" bullet lines em a default-style answer → cleaned, não lone "*" lines.
  test('(a) empty "*" bullets are stripped under the engine gate', () => {
    const answer = 'You should highlight your backend depth here.\n*\nKeep it concise and confident.';
    const { delivered, accepted, shaped } = engineWtaSubstitution(answer, { answerStyle: 'default' });
    assert.equal(accepted, true, 'engine should accept (changed + >=10 chars)');
    assert.ok(shaped.changed, 'shaped.changed must be true');
    assert.ok(shaped.applied.includes('cleaned_artifacts'), 'cleaned_artifacts must be applied');
    // Não line consisting apenas de a bullet marker survives.
    assert.doesNotMatch(delivered, /^[ \t]*[-*•+][ \t]*$/m, 'no lone bullet-marker line');
    // O real content é preserved.
    assert.match(delivered, /backend depth/);
    assert.match(delivered, /concise and confident/);
  });

  test('(a2) a trailing orphan bullet at the very end is removed', () => {
    const answer = 'Lead with the migration you owned and the latency win it produced. *';
    const { delivered, accepted } = engineWtaSubstitution(answer, { answerStyle: 'default' });
    assert.equal(accepted, true);
    assert.doesNotMatch(delivered, /\*\s*$/, 'no dangling trailing bullet');
    assert.match(delivered, /latency win/);
  });

  // (b) default-style (and undefined-style) answer com visible scaffold labels
  // ("Direct Answer:", "Speakable Final Answer:") + >=40-char corpo → compressed.
  const TEMPLATED = 'Direct Answer: I am a strong fit for this senior backend role.\n'
    + 'Matching Experience: I led platform reliability work for five years at scale.\n'
    + 'Speakable Final Answer: I would say I am a great fit because I have led backend '
    + 'reliability at scale for years and shipped the exact kind of platform work this role needs.';

  test('(b) default style → scaffold labels compressed away', () => {
    const { delivered, accepted, shaped } = engineWtaSubstitution(TEMPLATED, { answerStyle: 'default' });
    assert.equal(accepted, true, 'engine should accept the compressed prose');
    assert.ok(shaped.applied.includes('compressed_to_speakable'), 'compressed_to_speakable applied');
    assert.doesNotMatch(delivered, /Direct Answer:/, 'Direct Answer: label removed');
    assert.doesNotMatch(delivered, /Speakable Final Answer:/, 'Speakable Final Answer: label removed');
    assert.doesNotMatch(delivered, /Matching Experience:/, 'Matching Experience: label removed');
    assert.ok(delivered.trim().length >= 40, 'compressed body is substantial');
  });

  test('(b2) undefined answerStyle behaves like default (compressed)', () => {
    const { delivered, accepted } = engineWtaSubstitution(TEMPLATED, { answerStyle: undefined });
    assert.equal(accepted, true);
    assert.doesNotMatch(delivered, /Direct Answer:|Speakable Final Answer:/);
  });

  // (c) structured-style answers KEEP their scaffold labels (changed=false Ou labels kept).
  test('(c) detailed/bullets/notes KEEP scaffold labels (structure was requested)', () => {
    for (const answerStyle of ['detailed', 'bullets', 'notes']) {
      const { delivered, shaped } = engineWtaSubstitution(TEMPLATED, { answerStyle });
      // Labels precisa ser retained para structured styles.
      assert.match(delivered, /Direct Answer:/, `style=${answerStyle} keeps Direct Answer:`);
      // comprimir precisa Não ter fired para a structured style.
      assert.ok(
        !shaped.applied.includes('compressed_to_speakable'),
        `style=${answerStyle} must not compress`,
      );
    }
  });

  // (d) isCoding=true → unchanged até quando bullets / list-like shapes são present.
  test('(d) coding answers are returned unchanged (sectioned output is intentional)', () => {
    const codingAnswer = '## Approach\nUse a hash map.\n\n```js\nconst seen = new Map();\n```\n* O(n) time';
    const { delivered, accepted, shaped } = engineWtaSubstitution(codingAnswer, {
      answerStyle: 'default',
      isCoding: true,
    });
    assert.equal(shaped.changed, false, 'coding → changed === false');
    assert.equal(accepted, false, 'engine gate not satisfied → keeps original');
    assert.equal(delivered, codingAnswer, 'coding answer byte-identical');
    assert.equal(shaped.text, codingAnswer, 'normalizer returned input verbatim');
  });

  test('(d2) coding skip beats even an empty-bullet artifact (no cleanup applied)', () => {
    // Mesmo artifact that Iria ser cleaned em prose; isCoding precisa short-circuit Antes cleanup.
    const codingAnswer = 'function f(){}\n*\nmore code context';
    const { delivered, shaped } = engineWtaSubstitution(codingAnswer, { isCoding: true });
    assert.equal(shaped.changed, false);
    assert.equal(delivered, codingAnswer);
  });

  // (e) clean prose → no-op, então flag-ON em an already-good answer é byte-safe.
  test('(e) clean prose is a no-op (flag ON on a good answer changes nothing)', () => {
    const clean = 'Tell them you led the payments migration end to end and cut p95 latency by 40 percent, '
      + 'then tie it directly to what this role needs.';
    const { delivered, accepted, shaped } = engineWtaSubstitution(clean, { answerStyle: 'default' });
    assert.equal(shaped.changed, false, 'no change on clean prose');
    assert.equal(accepted, false, 'engine keeps the original (gate not satisfied)');
    assert.equal(delivered, clean, 'delivered === original, byte-for-byte');
  });

  test('(e2) clean prose with a real markdown bullet list is preserved (not a lone marker)', () => {
    // Bullets Com content precisa Não ser treated como empty-bullet artifacts.
    const withList = 'Lead with two proof points:\n* Cut p95 latency by 40 percent.\n* Owned the migration end to end.';
    const { shaped } = engineWtaSubstitution(withList, { answerStyle: 'default' });
    assert.equal(shaped.changed, false, 'content bullets are preserved');
    assert.match(shaped.text, /Cut p95 latency/);
    assert.match(shaped.text, /Owned the migration/);
  });

  // (f) nunca throws em empty / garbage; o engine também empacota em try/catch como a 2nd layer.
  test('(f) never throws on empty / whitespace / garbage input', () => {
    for (const bad of ['', '   ', '\n\n', '***', '* * *', ' ', '```unterminated', undefined]) {
      assert.doesNotThrow(() => normalizeOutputShape({ answer: bad, answerStyle: 'default' }), `input=${JSON.stringify(bad)}`);
      const r = normalizeOutputShape({ answer: bad, answerStyle: 'default' });
      assert.equal(typeof r.text, 'string');
      assert.equal(typeof r.changed, 'boolean');
    }
  });

  // O engine's >=10-char gate: a result that compresses to algo também curto precisa ser
  // REJECTED por o engine (keeps fullAnswer), nunca entregar a sub-10-char fragment.
  test('(gate) engine rejects a substitution whose trimmed result is < 10 chars', () => {
    // Force a "changed mas tiny" outcome por giving a lone-bullet answer cujo apenas real
    // content é scurto cleanup yields a < 10-char string → engine precisa keep o original.
    const tiny = '*\nHi.';
    const shaped = normalizeOutputShape({ answer: tiny, answerStyle: 'default' });
    if (shaped.changed && shaped.text.trim().length < 10) {
      const { delivered, accepted } = engineWtaSubstitution(tiny, { answerStyle: 'default' });
      assert.equal(accepted, false, 'sub-10-char result rejected by engine gate');
      assert.equal(delivered, tiny, 'engine keeps the original rather than a tiny fragment');
    } else {
      // If o normalizer happened não to shrink abaixo 10, o contract é ainda satisfied
      // (o gate exists precisely to proteger o shrink case); assert it stays a sstring
      assert.equal(typeof shaped.text, 'string');
    }
  });
});
