// eslint.config.mjs — ESLint 9 flat config for Refract.
//
// Strategy: this repo has ~20k lines of legacy code with zero prior linting,
// so we cannot flip every recommended rule to "error" without generating
// thousands of unavoidable failures. Instead we:
//   1. Enable the core bug-catching rules (@eslint/js recommended +
//      typescript-eslint recommended) as errors — no-unreachable, no-dupe-keys,
//      no-constant-condition, no-fallthrough, use-isnan, no-debugger, etc.
//   2. Relax only the rules the legacy codebase legitimately violates en masse
//      (explicit any, CommonJS require(), unused vars) to warn/off.
//   3. Gate CI on the *clean surface* (electron/ipc/ + the registry/stub
//      scripts) via `npm run lint:contracts`, and report the full-repo lint
//      as advisory until the baseline is paid down.
//
// Prettier is a separate formatter (see .prettierrc.json) — no
// eslint-plugin-prettier, so formatting and linting stay orthogonal.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

const RELAXED_TS_RULES = {
  // The codebase is 100% `any` at the IPC boundaries and beyond. Enforcing
  // no-explicit-any today would drown real findings in noise.
  '@typescript-eslint/no-explicit-any': 'off',
  // CommonJS require() is pervasive (dynamic service loading). Keep it.
  '@typescript-eslint/no-require-imports': 'off',
  '@typescript-eslint/no-var-requires': 'off',
  // Unused vars are the single most common (and most useful) finding here, so
  // they are warn-level for now — visible, but not a hard gate on legacy.
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
};

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'out/**',
      'coverage/**',
      'build/**',
      'premium/**', // local-only private module (gitignored)
      'native-module/target/**',
      '_external_research/**',
      '**/*.d.ts',
      '**/*.min.js',
      'assets/**',
      'landing/**',
      'renderer/**', // separate legacy CRA app
      'intelligence-eval-real-ui/**',
      'benchmarks/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...RELAXED_TS_RULES,
      // TypeScript + tsc own these; the core-JS versions produce false positives.
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
