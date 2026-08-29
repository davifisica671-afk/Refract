// electron/llm/__tests__/LiveAnswerPromptShape2026_06_15.test.mjs
//
// Regression tests para o "Live Moment Router / Refract-prompt" audit (2026-06-15):
//
//   Fix A — o LIVE answer prompts precisa Não mandate a Refract "headline + bullets"
//           card. CUSTOM_ANSWER_PROMPT (live, via LLMHelper.mapToCustomPrompt) and
//           ANSWER_MODE_PROMPT (exported) anteriormente ordered a "Curto headline (<=6
//           words) / 1-2 principal bullets" block, que contradicted
//           HUMAN_SPOKEN_ANSWER_CONTRACT and compressToSpeakable (strips scaffolds).
//           They precisa agora FORBID a headline line / bullet lista / headers a menos que o user
//           explicitly asks para structure.
//
//   Bold refinement (2026-06-15) — SPARING key-term **bold** é agora ALLOWED (and
//           encouraged) em a spoken answer como an on-screen scanning aid então o user pode
//           recreate o line at a glance. O deterministic bold-stripper em
//           humanizeSpokenAnswer era removed. O prompts precisa POSITIVELY permit bold de
//           a poucos chave terms enquanto ainda forbidding headline/bullets.
//
//   Fix B — technical_concept_answer precisa rotea correctly AND obtém o dedicated
//           TECHNICAL_CONCEPT_TEMPLATE (a curto spoken interview answer), Não o bare
//           GENERAL_TEMPLATE. Coding / behavioral / identity routing é unchanged.
//
// STRUCTURAL propriedade assertions sobre compiled saída — não fixed answers, não LLM, não
// network. Anti-hardcoding compliant.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import * as prompts from '../../../dist-electron/electron/llm/prompts.js';
import { planAnswer, formatAnswerPlanForPrompt } from '../../../dist-electron/electron/llm/AnswerPlanner.js';

// ── Fix A: live answer prompts forbid o headline/bullets card ───────────────
describe('Fix A — live answer prompts drop the Refract headline+bullets mandate', () => {
  // O OLD positive instructions that precisa não longer appear como a mandate.
  const FORBIDDEN_MANDATES = ['Short headline', '1-2 main bullets', '1–2 main bullets', '≤6 words', 'main bullets'];
  const LIVE_AND_EXPORTED = ['CUSTOM_ANSWER_PROMPT', 'ANSWER_MODE_PROMPT'];

  for (const name of LIVE_AND_EXPORTED) {
    test(`${name} exists`, () => {
      assert.equal(typeof prompts[name], 'string');
      assert.ok(prompts[name].length > 100);
    });

    test(`${name} no longer mandates a headline / bullets card`, () => {
      const p = prompts[name];
      for (const bad of FORBIDDEN_MANDATES) {
        assert.ok(!p.includes(bad), `${name} must not contain the positive mandate "${bad}"`);
      }
    });

    test(`${name} now carries the speakable-prose negative instruction`, () => {
      const p = prompts[name];
      // "Não headline line" / "Não headline line" + "não bullet llista / "Não bullet lilista
      assert.match(p, /no\s+headline\s+line/i, `${name} must forbid a headline line`);
      assert.match(p, /no\s+bullet\s+list/i, `${name} must forbid a bullet list`);
      // And it precisa escopo o exception to an EXPLICIT user requisição para structure.
      assert.match(p, /unless\s+the\s+user\s+(?:explicitly\s+)?asks/i, `${name} must allow structure only on explicit request`);
    });

    test(`${name} permits SPARING key-term bold (scanning aid), not forbids it`, () => {
      const p = prompts[name];
      // It precisa Não carry o old blanket ban "não mid-sentence **bold**".
      assert.doesNotMatch(p, /no\s+mid-sentence\s+\*\*bold\*\*/i, `${name} must not blanket-ban mid-sentence bold anymore`);
      // It precisa POSITIVELY permitir bolding a poucos chave terms.
      assert.match(p, /\*\*bold\*\*/i, `${name} must mention **bold**`);
      assert.match(p, /key\s+terms?/i, `${name} must reference key terms`);
      assert.match(p, /(?:sparing|spar\w*|1-3|few terms|never\s+whole\s+phrases)/i, `${name} must cap bold to a sparing few terms`);
      assert.match(p, /recreate the line|at a glance|off-screen/i, `${name} must state the scanning-aid rationale`);
    });
  }

  test('CUSTOM_ANSWER_PROMPT is the LIVE custom-provider answer prompt (mapped)', () => {
    // Sanity: it identifies como o live meeting copilot answer prompt, não a notes card.
    assert.match(prompts.CUSTOM_ANSWER_PROMPT, /first[- ]person\s+prose/i);
  });
});

// ── Fix B: technical_concept routing + dedicated template ─────────────────────
const plan = (question, source = 'manual_input') => planAnswer({ question, source });
const GENERAL_BARE = 'Answer naturally and directly. Use only relevant context. Keep it predictable and concise.';

describe('Fix B — technical_concept_answer routing', () => {
  const CONCEPT_QS = [
    'What is Redis?',
    'Explain JWT.',
    'What is CORS?',
    'Explain caching.',
    'What is REST?',
    'What is a deadlock?',
  ];
  for (const q of CONCEPT_QS) {
    test(`${JSON.stringify(q)} → technical_concept_answer`, () => {
      assert.equal(plan(q).answerType, 'technical_concept_answer');
    });
  }
});

describe('Fix B — technical_concept gets the dedicated template (not bare GENERAL)', () => {
  const p = plan('What is Redis?');

  test('responseTemplate is the TECHNICAL_CONCEPT_TEMPLATE, not bare GENERAL_TEMPLATE', () => {
    assert.notEqual(p.responseTemplate, GENERAL_BARE);
    assert.match(p.responseTemplate, /SPOKEN ANSWER|spoken answer/i);
  });

  test('template leads with a plain one-line definition, woven into prose', () => {
    assert.match(p.responseTemplate, /one-line definition/i);
    assert.match(p.responseTemplate, /woven into prose|one short paragraph/i);
  });

  test('template bluntly forbids doc structure (headings / bullets / code blocks)', () => {
    assert.match(p.responseTemplate, /heading/i);
    assert.match(p.responseTemplate, /bullet/i);
    assert.match(p.responseTemplate, /code block/i);
    assert.match(p.responseTemplate, /WRONG/);
  });

  test('formatAnswerPlanForPrompt embeds the technical-concept template text', () => {
    const formatted = formatAnswerPlanForPrompt(p);
    assert.match(formatted, /SPOKEN ANSWER|spoken answer/i);
    assert.match(formatted, /answerType: technical_concept_answer/);
  });
});

describe('Fix B — no routing regression for coding / behavioral / identity', () => {
  const UNCHANGED = [
    ['Write a function to reverse a linked list', 'dsa_question_answer'],
    ['Solve two sum', 'dsa_question_answer'],
    ['Tell me about a time you led a team', 'behavioral_interview_answer'],
    ['Who are you?', 'identity_answer'],
    ['Why should we hire you?', 'jd_fit_answer'],
  ];
  for (const [q, expected] of UNCHANGED) {
    test(`${JSON.stringify(q)} → ${expected} (unchanged)`, () => {
      assert.equal(plan(q).answerType, expected);
    });
  }

  test('coding answer types still get a coding template (not technical-concept)', () => {
    const cp = plan('Write a function to reverse a linked list');
    assert.doesNotMatch(cp.responseTemplate, /THIS IS A SPOKEN ANSWER/);
  });
});
