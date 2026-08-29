// Regression testar para "STT reconnect storm sob bad network" bug class.
//
// Sem an exponential-backoff cap, a refactor that drops o multiplier
// — ou define reconnectAttempts to 0 em todo fechar — turns a transient
// network blip dentro de a 60 reconnects/minute stampede contra o upstream
// STT pprovedor Three issues já landed em this batch touch this code
// caminho (#1, #2, #9), então o structural invariant é vale pinning então a
// future refactor that introduces a tight reconnect loop fails CI.
//
// SEstratégia structural assertions contra o two providers that próprio a
// reconnect backoff — RefractProSTT and DeepgramStreamingSTT. We assert:
//   - a base atrasar constante exists (≥ 1000 ms),
//   - a max delay/attempts cap exists,
//   - o scheduling code multiplies por 2 ** reconnectAttempts (ou
//     equivalent capped exponential) and respects o cap.
//
// We fazer Não testar o literal numbers — a refactor pode legitimately tune
// them. We testar that o SHAPE de capped exponential backoff exists, então
// a refactor that accidentally drops o cap fails o ttestar

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const proSttSource = readFileSync(path.join(root, 'electron/audio/RefractProSTT.ts'), 'utf8');
const dgSttSource  = readFileSync(path.join(root, 'electron/audio/DeepgramStreamingSTT.ts'), 'utf8');

test('RefractProSTT.scheduleReconnect uses capped exponential backoff with a base delay ≥ 1 second', () => {
  // Match o declared base / max constants. Names pode evolve então we accept a poucos synonyms.
  // Permitir underscore digit separators (e.g. 30_000).
  const baseMatch = /(?:RECONNECT_BASE_MS|RECONNECT_BASE_DELAY_MS|BASE_RECONNECT_DELAY_MS)\s*=\s*([\d_]+)/.exec(proSttSource);
  const maxMatch  = /(?:MAX_BACKOFF_MS|RECONNECT_MAX_DELAY_MS|MAX_RECONNECT_DELAY_MS)\s*=\s*([\d_]+)/.exec(proSttSource);
  assert.ok(baseMatch, 'BUG: RefractProSTT must declare a base reconnect delay constant — without one, scheduleReconnect could degrade to a tight loop.');
  assert.ok(maxMatch,  'BUG: RefractProSTT must declare a max backoff delay constant — without a ceiling, a long outage produces multi-minute delays.');

  const base = Number(baseMatch[1].replace(/_/g, ''));
  const max  = Number(maxMatch[1].replace(/_/g, ''));
  assert.ok(
    base >= 1000,
    `BUG: RefractProSTT base reconnect delay is ${base}ms. Anything < 1000ms allows a 60/min reconnect storm. The fix is to bump the base constant.`,
  );
  assert.ok(
    max >= base && max <= 120_000,
    `BUG: RefractProSTT max backoff (${max}ms) must be ≥ base (${base}ms) and ≤ 120 s. Outside this range either has no cap (storm risk) or strands the user (giving up).`,
  );

  // Verifica o scheduler actually aplica an exponential backoff com o cap.
  assert.ok(
    /Math\.pow\s*\(\s*2\s*,[\s\S]{0,40}reconnectAttempts/.test(proSttSource),
    'BUG: RefractProSTT.scheduleReconnect must apply Math.pow(2, reconnectAttempts) or equivalent exponential growth.',
  );
  // Math.min pode appear com o cap como Qualquer um argumento (Math.min(MAX, exp) Ou Math.min(exp, MAX)).
  const minRe = /Math\.min\s*\([^)]*?(?:MAX_BACKOFF_MS|RECONNECT_MAX_DELAY_MS|MAX_RECONNECT_DELAY_MS)[^)]*?\)/;
  assert.ok(
    minRe.test(proSttSource),
    'BUG: RefractProSTT.scheduleReconnect must apply Math.min(...) to cap the computed delay by MAX_BACKOFF_MS / RECONNECT_MAX_DELAY_MS.',
  );
});

test('DeepgramStreamingSTT.scheduleReconnect uses capped exponential backoff with a base delay ≥ 1 second', () => {
  const baseMatch = /(?:RECONNECT_BASE_DELAY_MS|RECONNECT_BASE_MS|BASE_RECONNECT_DELAY_MS)\s*=\s*([\d_]+)/.exec(dgSttSource);
  const maxMatch  = /(?:RECONNECT_MAX_DELAY_MS|MAX_BACKOFF_MS|MAX_RECONNECT_DELAY_MS)\s*=\s*([\d_]+)/.exec(dgSttSource);
  assert.ok(baseMatch, 'BUG: DeepgramStreamingSTT must declare a base reconnect delay constant.');
  assert.ok(maxMatch,  'BUG: DeepgramStreamingSTT must declare a max delay constant.');

  const base = Number(baseMatch[1].replace(/_/g, ''));
  const max  = Number(maxMatch[1].replace(/_/g, ''));
  assert.ok(base >= 1000, `BUG: Deepgram base reconnect delay is ${base}ms; must be ≥ 1000ms.`);
  assert.ok(max >= base && max <= 120_000, `BUG: Deepgram max backoff out of range: ${max}ms.`);

  // Cap o absolute tentar count também — Deepgram é paid; we deve give para cima at Alguns point.
  const attemptsMatch = /(?:RECONNECT_MAX_ATTEMPTS|MAX_RECONNECT_ATTEMPTS)\s*=\s*(\d+)/.exec(dgSttSource);
  assert.ok(
    attemptsMatch,
    'BUG: DeepgramStreamingSTT must declare a max-attempts constant — without one, the reconnect path can keep burning Deepgram quota forever.',
  );
  const attempts = Number(attemptsMatch[1]);
  assert.ok(
    attempts >= 3 && attempts <= 50,
    `BUG: Deepgram max attempts (${attempts}) out of range [3, 50]. Below 3 strands the user on a brief blip; above 50 burns paid quota during sustained outages.`,
  );

  // Verifica o scheduler enforces bambos
  assert.ok(
    /Math\.pow\s*\(\s*2\s*,[\s\S]{0,40}reconnectAttempts/.test(dgSttSource),
    'BUG: Deepgram scheduleReconnect must apply Math.pow(2, reconnectAttempts).',
  );
  // Match Math.min(...) containing o MAX constante em qualquer um side. O inner
  // expression pode conter Math.pow(2, ...) parens, então we permitir balanced
  // content para cima to ~200 chars.
  const dgMinRe = /Math\.min\s*\([\s\S]{0,300}?(?:RECONNECT_MAX_DELAY_MS|MAX_BACKOFF_MS|MAX_RECONNECT_DELAY_MS)/;
  assert.ok(
    dgMinRe.test(dgSttSource),
    'BUG: Deepgram scheduleReconnect must cap the computed delay via Math.min(..., MAX_DELAY).',
  );
  assert.ok(
    /reconnectAttempts\s*>=\s*(?:RECONNECT_MAX_ATTEMPTS|MAX_RECONNECT_ATTEMPTS)/.test(dgSttSource),
    'BUG: Deepgram scheduleReconnect must short-circuit when reconnectAttempts >= MAX_ATTEMPTS (so an infinite loop is impossible).',
  );
});

test('RefractProSTT.scheduleReconnect applies jitter to avoid thundering-herd reconnects', () => {
  // Após Issue 1 deleted o per-key stagger, o apenas spread entre
  // concurrent system+mic reconnects é o ±20% jitter em scheduleReconnect.
  // Pin that this jitter é ainda present — a refactor that remove Math.random()
  // iria silently turn todo multi-channel reconnect dentro de a synchronized storm.
  assert.ok(
    /Math\.random\s*\(\s*\)/.test(proSttSource),
    'BUG: RefractProSTT.scheduleReconnect must apply jitter (Math.random()) so concurrent system+mic reconnects don\'t hit the server in lockstep.',
  );
});
