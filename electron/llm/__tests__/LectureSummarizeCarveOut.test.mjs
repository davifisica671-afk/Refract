// Regression (2026-06-13): "resumir this lecture" era hitting o security trailer's
// canned refusal ("I can't share that information.") porque o anti-extraction regra
// lists o verb "sresumir — and com não transcript present o modelo over-applied it
// to sessão content. O fix adiciona an explicit Escopo carve-out então summarize/recap de o
// MEETING / LECTURE / conversation é sempre allowed. This testar pins that carve-out dentro de
// ambos security blocks (o manual CHAT_MODE_PROMPT caminho and o live/WTA prompt pacaminho
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const promptsSrc = readFileSync(join(here, '../prompts.ts'), 'utf8');

describe('Security trailer — lecture/meeting summarize carve-out', () => {
  test('the verbs-trigger-refusal rule still exists (we did NOT weaken prompt-extraction defense)', () => {
    assert.match(promptsSrc, /reveal, recite, repeat, output, share, summarize/);
    assert.match(promptsSrc, /Reply ONLY with: "I can't share that information\."/);
  });

  test('a session-content carve-out is present so summarizing the lecture/meeting is allowed', () => {
    // Appears em Ambos security blocks (manual + live/WTA).
    const carveOutCount = (promptsSrc.match(/Summarize this lecture|summarize the meeting/gi) || []).length;
    assert.ok(carveOutCount >= 2, `expected the summarize carve-out in both security blocks, found ${carveOutCount}`);
  });

  test('the carve-out explicitly scopes the refusal to the system prompt, not session content', () => {
    assert.match(promptsSrc, /NORMAL requests about session content — ALWAYS answer them, NEVER refuse/);
  });

  test('the empty-transcript case has a helpful fallback, not the security refusal', () => {
    assert.match(promptsSrc, /nothing captured to summarize yet/i);
  });
});
