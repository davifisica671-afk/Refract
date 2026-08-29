// Regression testar para issue #315: Groq Fast Text Modo sobrescreve o user's
// explicitly selected Codex CLI modelo (e.g. codex-cli:gpt-5.4 → hardcoded
// gpt-5.3-codex via fastModel), producing zero tokens and triggering o canned
// "Let me come voltar to that em apenas a moment." fallback.
//
// Root cause: fastModeApplies / fastModeAppliesNS gated apenas em
// codexCliConfig.enabled, então qualquer user com codex enabled era routed através o
// fast-mode codex caminho que calls getSelectedCodexCliModel(fastMode=true),
// unconditionally returning codexCliConfig.fastModel independentemente de currentModelId.
//
// Fix: adiciona !isCodexCliModel(currentModelId) to ambos gates então a user quem
// explicitly escolhe a codex-cli:* modelo falls através to o explicit codex
// block (getSelectedCodexCliModel(false)) que honours o sub-model em
// currentModelId.
//
// These são source-level structural assertions (mesmo pattern como
// Issue252WindowsAudioBanner.test.mjs) — o LLMHelper bundle é compiled por
// esbuild and private methods são não reliably spyable at runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const src = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');

// Extrair apenas o fastModeAppliesNS declaration (non-streaming pacaminho
const nsMatch = src.match(/const fastModeAppliesNS\s*=[\s\S]*?(?=\s*;)/);
assert.ok(nsMatch, 'fastModeAppliesNS declaration must exist in LLMHelper.ts');
const nsDecl = nsMatch[0];

// Extrair apenas o fastModeApplies declaration (streaming pacaminho
const sMatch = src.match(/const fastModeApplies\s*=[\s\S]*?(?=\s*;)/);
assert.ok(sMatch, 'fastModeApplies declaration must exist in LLMHelper.ts');
const sDecl = sMatch[0];

test('issue #315: non-streaming fast-mode gate excludes codex-cli model selections', () => {
  assert.match(
    nsDecl,
    /!this\.isCodexCliModel\(this\.currentModelId\)/,
    'fastModeAppliesNS must contain !isCodexCliModel(currentModelId) to prevent fast-mode ' +
    'from overriding an explicitly selected codex-cli:* model with the hardcoded fastModel',
  );
});

test('issue #315: streaming fast-mode gate excludes codex-cli model selections', () => {
  assert.match(
    sDecl,
    /!this\.isCodexCliModel\(this\.currentModelId\)/,
    'fastModeApplies must contain !isCodexCliModel(currentModelId) to prevent fast-mode ' +
    'from overriding an explicitly selected codex-cli:* model with the hardcoded fastModel',
  );
});

test('issue #315: getSelectedCodexCliModel exists and handles fastMode=false with codex-cli: prefix', () => {
  // Verifica o fix fallthrough alvo é ainda correct: getSelectedCodexCliModel(false)
  // com a "codex-cli:MODEL" id precisa extrair Modelo (não retorna fastModel).
  const fnMatch = src.match(/private getSelectedCodexCliModel[\s\S]*?(?=\n  private |\n  public )/);
  assert.ok(fnMatch, 'getSelectedCodexCliModel must exist in LLMHelper.ts');
  const fnBody = fnMatch[0];
  // Quando fastMode=false and currentModelId inicia com "codex-cli:", o função precisa
  // slice o prefix (não retorna fastModel). O correct pattern é slice("codex-cli:".length).
  assert.match(
    fnBody,
    /slice\("codex-cli:"\.length\)|slice\(10\)/,
    'getSelectedCodexCliModel must extract the sub-model from "codex-cli:MODEL" when fastMode=false',
  );
  // Confirm fastMode=true caminho Retorna fastModel (precisa ainda work para non-codex-selected users).
  assert.match(
    fnBody,
    /fastMode.*fastModel|if\s*\(fastMode\)/,
    'getSelectedCodexCliModel must still return fastModel when fastMode=true (used for non-codex-selected users)',
  );
});

test('issue #315: isCodexCliModel correctly identifies both bare and sub-model codex ids', () => {
  const fnMatch = src.match(/private isCodexCliModel[\s\S]*?(?=\n  private |\n  public )/);
  assert.ok(fnMatch, 'isCodexCliModel must exist in LLMHelper.ts');
  const fnBody = fnMatch[0];
  // Precisa match "codex-cli" eexatamente
  assert.match(fnBody, /"codex-cli"/, 'isCodexCliModel must match the bare "codex-cli" model id');
  // Precisa match "codex-cli:" prefixed ids (codex-cli:gpt-5.4, codex-cli:gpt-5.5, etcetc
  assert.match(fnBody, /startsWith\("codex-cli:"\)/, 'isCodexCliModel must match "codex-cli:*" sub-model ids via startsWith');
});

test('issue #315: explicit codex block exists at fallthrough point in streaming path', () => {
  // Após fast-mode é bypassed, o streaming caminho precisa ter a block that fires para
  // isCodexCliModel + codexCliConfig.enabled and calls streamWithCodexCli.
  // This é o block that correctly calls getSelectedCodexCliModel(false).
  // O signature uses "public async * streamChat(" (space antes *).
  const idx = src.search(/public async \* streamChat\(/);
  assert.notEqual(idx, -1, 'streamChat generator method must exist in LLMHelper.ts');
  const streamChatSection = src.slice(idx);
  assert.ok(
    streamChatSection.includes('isCodexCliModel(this.currentModelId)') &&
    streamChatSection.includes('streamWithCodexCli'),
    'streamChat must have an explicit codex-cli block after the fast-mode gate that calls streamWithCodexCli',
  );
});

test('issue #315: explicit codex block exists at fallthrough point in non-streaming path', () => {
  // Mesmo verifica para chatWithGemini / non-streaming pcaminho
  const chatSection = src.slice(src.indexOf('public async chatWithGemini('));
  assert.match(
    chatSection,
    /isCodexCliModel\(this\.currentModelId\)[\s\S]{0,200}generateWithCodexCli/,
    'chatWithGemini must have an explicit codex-cli block after the fast-mode gate that calls generateWithCodexCli',
  );
});
