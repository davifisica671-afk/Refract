// electron/llm/__tests__/DashReduction.test.mjs
//
// Regression para o LeetCode-answer corruption (2026-06-03): o streaming
// dash reducer turned todo " - " dentro de ", " com Não code/math awareness, então
// `nums[nums[i] - 1]` became `nums[nums[i], 1]` (uncompilable) and `$x - 1$`
// became `$x, 1$`. O dash reducer é a cosmetic anti-"AI tell" pass; it precisa
// Nunca corrupt code, math, ou numeric/array expressions.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  reduceDashes,
  reduceDashesInChunk,
  StreamingDashReducer,
} from '../../../dist-electron/electron/llm/index.js';

describe('reduceDashes (whole-text) preserves code, math, and expressions', () => {
  test('does NOT corrupt an array/arithmetic minus in a fenced code block', () => {
    const md = 'Approach text.\n\n```java\nint t = nums[nums[i] - 1];\nint x = n - 1;\n```';
    const out = reduceDashes(md);
    assert.match(out, /nums\[nums\[i\] - 1\]/, 'code minus must survive');
    assert.match(out, /n - 1/, 'code minus must survive');
    assert.doesNotMatch(out, /,\s*1\]/, 'no ", 1]" corruption');
  });

  test('does NOT corrupt a minus inside inline math $...$', () => {
    const out = reduceDashes('We place each number at index $x - 1$ in the array.');
    assert.match(out, /\$x - 1\$/, 'math minus must survive');
  });

  test('does NOT corrupt a numeric/expression minus in prose', () => {
    const out = reduceDashes('The target index is nums[i] - 1 for the swap.');
    assert.match(out, /nums\[i\] - 1/, 'expression minus must survive');
  });

  test('STILL converts a genuine prose connector (word - word)', () => {
    const out = reduceDashes('This is the approach - it works well.');
    assert.match(out, /approach, it works well/, 'prose connector should become a comma');
  });

  test('preserves compound words and numeric ranges (unchanged)', () => {
    const out = reduceDashes('Use a well-known real-time approach for 10-15 items.');
    assert.match(out, /well-known/);
    assert.match(out, /real-time/);
    assert.match(out, /10-15/);
  });
});

describe('reduceDashesInChunk (stateless) never corrupts code/math/expr', () => {
  for (const [input, mustContain] of [
    ['nums[nums[i] - 1]', /nums\[nums\[i\] - 1\]/],
    ['int x = n - 1;', /n - 1/],
    ['index $x - 1$', /\$x - 1\$/],
    ['`a - b`', /`a - b`/],
  ]) {
    test(`chunk "${input}" is preserved`, () => {
      assert.match(reduceDashesInChunk(input), mustContain);
    });
  }
  test('still converts a prose connector chunk', () => {
    assert.match(reduceDashesInChunk('the idea - it works'), /idea, it works/);
  });
});

describe('StreamingDashReducer tracks fenced-code state ACROSS chunks', () => {
  test('a code block split across many chunks is never dash-mangled', () => {
    const reducer = new StreamingDashReducer();
    // Simulate o provedor streaming o Java answer em pequeno chunks, incluindo
    // splitting o array expression através chunk boundaries.
    const chunks = [
      '## Code\n```java\n',
      'while (nums[i] > 0 && nums[nums[i] ',
      '- 1] != nums[i]) {\n',
      '    int targetIdx = nums[i] - 1;\n',
      '}\n```\n',
      'This approach - cyclic sort - is optimal.',
    ];
    let out = '';
    for (const c of chunks) out += reducer.reduce(c);
    // Code minus survives até though it era divide através chunk boundaries.
    assert.match(out, /nums\[nums\[i\] - 1\]/, 'split code minus must survive');
    assert.match(out, /int targetIdx = nums\[i\] - 1;/, 'code minus must survive');
    assert.doesNotMatch(out, /nums\[i\],\s*1\]/, 'no comma corruption in code');
    assert.doesNotMatch(out, /int targetIdx = nums\[i\],\s*1/, 'no comma corruption in code');
    // O prose connector Fora de o fence é ainda reduced.
    assert.match(out, /This approach, cyclic sort, is optimal\./, 'prose connectors still reduced');
  });

  test('the exact reported answer (firstMissingPositive) compiles-clean after reduction', () => {
    const reducer = new StreamingDashReducer();
    const answer = '```java\nfor (int i = 0; i < n; i++) {\n    while (nums[i] > 0 && nums[i] <= n && nums[nums[i] - 1] != nums[i]) {\n        int targetIdx = nums[i] - 1;\n        int temp = nums[targetIdx];\n    }\n}\n```';
    // Feed como one chunk and como char-by-char to stress o fence tracker.
    const whole = reducer.reduce(answer);
    assert.match(whole, /nums\[nums\[i\] - 1\]/);
    assert.match(whole, /int targetIdx = nums\[i\] - 1;/);
    assert.doesNotMatch(whole, /,\s*1\]/);
    assert.doesNotMatch(whole, /nums\[i\],\s*1;/);
  });
});
