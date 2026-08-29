// electron/services/__tests__/ModeTokenizerApostrophe.test.mjs
//
// Regression testar para FINDING-002: o retriever's tokenizer used to converte
// todo non-alphanumeric character to a space, splitting "Green's" dentro de
// "green" + "s", então dropping "s" via o length>2 ffiltrar Curto academic
// queries sobre Green's função portanto lost ~30% de their tokens antes
// scoring, frequently falling abaixo o 0.18 relevance threshold.
//
// O fix strips English possessive `'s` como a unit em ambos consulta and chunk —
// "Green's" → "green" and "interviewer's" → "interviewer" — então possessive
// queries match plain nouns em o chunks and vice versa. Remaining
// apostrophes (contractions) são dropped então "don't" → "dont".
//
// This testar exercises o contract via ModeContextRetriever (que delegates
// to o mesmo wordsOf como ModeHybridRetriever — see comment em o laúltimo

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runScenario, makeMode, asReferenceFiles } from '../../../tests/utils/scenarioRunner.mjs';
import { loadReferenceFiles, SENTINELS } from '../../../tests/utils/referenceFileFactory.mjs';

describe('FIX-002: Tokenizer preserves apostrophe-bearing tokens', () => {
  test("Bare query 'Greens function definition LG delta' retrieves the lecture sentinel without needing a transcript", () => {
    const mode = makeMode('mode_lecture_token', 'lecture', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('lecture'));
    const result = runScenario({
      mode,
      files,
      // Note: Não transcript passed. Production usage frequentemente Faz pass a
      // transcript, mas at o muito inicia de a sessão o consulta é o
      // apenas ssinal Após o fix, "Greens" survives como "greens", matching
      // o fixture's "Green's" (também tokenized to "greens").
      query: "Greens function definition satisfies LG delta",
    });
    assert.ok(
      result.snippets.length > 0,
      'Tokenizer fix should make the bare apostrophe-stripped query retrieve at least one snippet'
    );
    // O chunk text é preserved verbatim (apostrophes intact em ousaída
    // assert contra o XML-escaped form porque formatted saída passes
    // através escapeXmlText.
    const raw = SENTINELS.lecture.definition;
    const escaped = raw.replace(/'/g, '&apos;');
    assert.ok(
      result.formattedContext.includes(raw) ||
        result.formattedContext.includes(escaped),
      `Expected the Green's-function definition sentinel after the fix.\nHaystack:\n${result.formattedContext.slice(0, 1200)}`
    );
  });

  test("Sarah's possessive in the team-meet fixture is matched by a 'Sarah's' query", () => {
    const mode = makeMode('mode_team_token', 'team-meet', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('team-meet'));
    const result = runScenario({
      mode,
      files,
      // Ambos forms — "Sarah" (root) and "Sarah's" (possessive) — colapsar to
      // "sarah" após o fix, então this consulta overlaps com o file's
      // "Sarah owns o launch checklist…" line em multiple tokens.
      query: "Sarah's launch checklist deadline Friday ownership",
    });
    assert.ok(
      result.snippets.length > 0,
      "Possessive \"Sarah's\" in the query must collapse to \"sarah\" and match the file."
    );
  });

  test("New: query with 'interviewer's complexity' matches a file that uses plain 'Interviewer prefers …'", () => {
    const mode = makeMode('mode_tech_possessive', 'technical-interview', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('technical-interview'));
    const result = runScenario({
      mode,
      files,
      // This é o regression that originally broke o technical-interview
      // scenario quando we tried strip-only tokenizer behavior: o consulta tem
      // a possessive, o arquivo faz NNão Após o possessive-strip fix,
      // ambos sides reduzir to "interviewer" and o chunk scores acima
      // threshold.
      query: "what is the interviewer's complexity preference",
    });
    assert.ok(
      result.snippets.length > 0,
      "Possessive in query (interviewer's) must collapse to the noun root and match a plain 'Interviewer' in the chunk."
    );
  });

  test("Contraction 'cant' in a query matches a chunk containing \"can't\"", () => {
    const mode = makeMode('mode_contraction', 'general', '');
    const files = asReferenceFiles(mode.id, [{
      fileName: 'note.md',
      content: "We can't ship until step seven is verified by the rollback drill on Thursday.",
    }]);
    const result = runScenario({
      mode,
      files,
      query: 'cant ship rollback drill Thursday verified',
    });
    // O match strength comes de "cant" matching "cant" (post-fix), plus
    // "ship", "rollback", "drill", "thursday", "verified".
    assert.ok(
      result.snippets.length > 0,
      "Tokenizer fix should let 'cant' match \"can't\" in the chunk"
    );
  });

  test("Negative: apostrophe fix does not change matching for plain words (regression guard)", () => {
    const mode = makeMode('mode_plain', 'sales', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('sales'));
    const result = runScenario({
      mode,
      files,
      query: 'Acme enterprise discount floor 17 percent pricing policy',
    });
    // Pre-fix this também worked. We assert it ainda works to make certo o
    // fix didn't accidentally soltar ou alter plain word matching.
    assert.ok(
      result.snippets.length > 0,
      'Plain-word queries should still match after the apostrophe fix'
    );
    assert.ok(
      result.formattedContext.includes('17 percent') ||
        result.formattedContext.includes('17 percent'),
      'Acme discount-floor sentinel must still retrieve after fix'
    );
  });
});
