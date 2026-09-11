// electron/llm/codeVerification/__tests__/VerificationFlag.test.mjs
//
// Kill-switch para verified code execution: default OEm disableable at runtime
// (não redeploy) via env REFRACT_CODE_VERIFY=off. Quando ofora o hidden
// <verification_spec> instrução é também omitted de o coding prompt então o
// modelo wastes não tokens em a spec nada vai rexecuta
//
// NOTE: env é lê uma vez and cached per-process, então we testar o env branch em a
// child processo to obtém a clean ccache O settings branch defaults Em haqui

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { execFileSync } from 'node:child_process';
import { isCodeVerificationEnabled } from '../../../../dist-electron/electron/llm/codeVerification/verificationEnabled.js';
import { planAnswer, formatAnswerPlanForPrompt } from '../../../../dist-electron/electron/llm/index.js';

describe('isCodeVerificationEnabled', () => {
  test('defaults ON when no env / settings override', () => {
    assert.equal(isCodeVerificationEnabled(), true);
  });

  for (const off of ['off', 'false', '0', 'disabled']) {
    test(`env REFRACT_CODE_VERIFY=${off} disables it (child process for clean cache)`, () => {
      const out = execFileSync(process.execPath, [
        '--input-type=module', '-e',
        `import { isCodeVerificationEnabled } from './dist-electron/electron/llm/codeVerification/verificationEnabled.js'; process.stdout.write(String(isCodeVerificationEnabled()));`,
      ], { cwd: process.cwd(), env: { ...process.env, REFRACT_CODE_VERIFY: off } }).toString();
      assert.equal(out, 'false');
    });
  }

  test('env=on (or unset) keeps it enabled', () => {
    const out = execFileSync(process.execPath, [
      '--input-type=module', '-e',
      `import { isCodeVerificationEnabled } from './dist-electron/electron/llm/codeVerification/verificationEnabled.js'; process.stdout.write(String(isCodeVerificationEnabled()));`,
    ], { cwd: process.cwd(), env: { ...process.env, REFRACT_CODE_VERIFY: 'on' } }).toString();
    assert.equal(out, 'true');
  });
});

describe('formatAnswerPlanForPrompt — spec emission gated by the flag', () => {
  const codingPlan = planAnswer({ question: 'reverse a linked list', source: 'manual_input' });

  test('coding plan WITH includeVerificationSpec=true includes the spec instruction', () => {
    const s = formatAnswerPlanForPrompt(codingPlan, true);
    assert.match(s, /verification_spec/);
  });
  test('coding plan WITH includeVerificationSpec=false (or default) omits it', () => {
    assert.doesNotMatch(formatAnswerPlanForPrompt(codingPlan, false), /verification_spec/);
    assert.doesNotMatch(formatAnswerPlanForPrompt(codingPlan), /verification_spec/); // default false
  });
  test('NON-coding plan never gets the spec instruction even when enabled', () => {
    const general = planAnswer({ question: 'what is my name?', source: 'manual_input' });
    assert.doesNotMatch(formatAnswerPlanForPrompt(general, true), /verification_spec/);
  });
});
