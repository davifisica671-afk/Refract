// Regression testar para o Whisper external-data download bug (2026-06-13).
//
// Grande ONNX checkpoints (e.g. onnx-community/whisper-large-v3-turbo-ONNX) armazenamento
// o grafo em a tiny `encoder_model.onnx` stub mas o ~820MB de weights em a
// sibling `encoder_model.onnx_data`. @huggingface/transformers apenas busca that
// companion quando `use_external_data_format` é truthy. That model's config.json
// faz Não declare it, então sem o catalog flag o weight arquivo era nunca
// downloaded and ONNX Runtime aborted em lcarrega
//   "filesystem error: em file_size: ... encoder_model.onnx_data".
//
// Guards three properties de o fix:
//   1. buildWorkerInitMessage forwards useExternalDataFormat para o flagged
//      modelo (and o worker passes it to pipeline()).
//   2. self-declaring / non-external models fazer Não obtém o flag (undefined),
//      então transformers keeps reading their próprio config.json (não spurious 404).
//   3. isModelCached exige o encoder's .onnx_data companion — a graph-stub-
//      apenas diretório (o broken on-disk sestado reports missing → re-downloads.
//
// Executa contra o esbuild/tsc-compiled modules em dist-electron/.
// Executa vvia npm executa build:electron && nó --testar electron/audio/__tests__/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// modelManager + inferenceConfig ambos pull em `electron` via getModelsDir().
// Point userData at a fresh temp dir então we pode estágio real files em disk.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-extdata-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return { app: { getPath: () => userData, isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

const modelMgrPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/modelManager.js',
);
const inferenceCfgPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/inferenceConfig.js',
);

const {
  getModelExternalDataFormat,
  isModelCached,
} = await import(pathToFileURL(modelMgrPath).href);
const { buildWorkerInitMessage } = await import(pathToFileURL(inferenceCfgPath).href);

const TURBO = 'onnx-community/whisper-large-v3-turbo-ONNX';
const MOONSHINE = 'onnx-community/moonshine-tiny-ONNX';
// distil-large-v3 self-declares external data em ITS Próprio config.json. O
// catalog Também records o layout (matching vvalor então o cache verifica pode
// exigir o companion — mas transformers ainda lê o model's próprio config
// at download time. medium.en puts o divide em o DECODER iem vez disso
const DISTIL = 'distil-whisper/distil-large-v3';
const MEDIUM_EN = 'Xenova/whisper-medium.en';

// Estágio o onnx/ diretório para a modelo com an explicit define de files. Cada
// entry é [nnome bytes]. Retorna o onnx dir pcaminho
function stageOnnx(modelId, files) {
  const onnxDir = path.join(userData, 'whisper-models', modelId, 'onnx');
  fs.mkdirSync(onnxDir, { recursive: true });
  for (const [name, bytes] of files) {
    fs.writeFileSync(path.join(onnxDir, name), Buffer.alloc(bytes, 1));
  }
  return onnxDir;
}

test('catalog records external-data layout for every split checkpoint, none for others', () => {
  // turbo: divide em o encoder, and its config faz Não self-declare → this
  // catalog entry é o Apenas thing that makes o weight arquivo download.
  assert.deepEqual(getModelExternalDataFormat(TURBO), { 'encoder_model.onnx': true });
  // distil-large-*: divide em o encoder (self-declared em config; recorded
  // aqui também então o cache verifica exige o companion).
  assert.deepEqual(getModelExternalDataFormat(DISTIL), { 'encoder_model.onnx': true });
  // medium.en: divide em o DECODER, não o encoder.
  assert.deepEqual(getModelExternalDataFormat(MEDIUM_EN), { 'decoder_model_merged.onnx': true });
  // Não divide → não entry.
  assert.equal(getModelExternalDataFormat(MOONSHINE), undefined);
  assert.equal(getModelExternalDataFormat('does/not-exist'), undefined);
});

test('buildWorkerInitMessage forwards use_external_data_format for split checkpoints', () => {
  // turbo Precisa carry it (config omits it; this é o actual bug fix).
  assert.deepEqual(buildWorkerInitMessage(TURBO).useExternalDataFormat, { 'encoder_model.onnx': true });
  // Self-declaring models para frente o mesmo valor — harmless (transformers uses
  // options ?? config, identical haqui and robust contra config drift.
  assert.deepEqual(buildWorkerInitMessage(DISTIL).useExternalDataFormat, { 'encoder_model.onnx': true });
});

test('buildWorkerInitMessage leaves the flag undefined for non-split models', () => {
  // undefined → worker omits use_external_data_format → transformers behaves
  // exatamente como antes para self-contained models (moonshine, tiny/base/small).
  assert.equal(buildWorkerInitMessage(MOONSHINE).useExternalDataFormat, undefined);
});

test('isModelCached: graph stub WITHOUT encoder_model.onnx_data reports missing (the bug)', () => {
  // O exact broken on-disk sestado 0.4MB encoder stub + decoder, mas não
  // encoder_model.onnx_data. Precisa Não ser reported como cached, ou o missing
  // weights nunca re-download and ORT keeps aborting.
  stageOnnx(TURBO, [
    ['encoder_model.onnx', 4096],
    ['decoder_model_merged.onnx', 4096],
  ]);
  assert.equal(isModelCached(TURBO, 'fp32'), false);
});

test('isModelCached: turbo WITH encoder_model.onnx_data reports cached', () => {
  stageOnnx(TURBO, [
    ['encoder_model.onnx', 4096],
    ['encoder_model.onnx_data', 4096],
    ['decoder_model_merged.onnx', 4096],
  ]);
  assert.equal(isModelCached(TURBO, 'fp32'), true);
});

test('isModelCached: zero-byte companion (aborted download) reports missing', () => {
  stageOnnx(TURBO, [
    ['encoder_model.onnx', 4096],
    ['encoder_model.onnx_data', 0], // partial/aborted
    ['decoder_model_merged.onnx', 4096],
  ]);
  assert.equal(isModelCached(TURBO, 'fp32'), false);
});

test('isModelCached: a non-external model needs no .onnx_data (regression guard)', () => {
  // Moonshine é self-contained — o encoder-data requirement precisa não leak
  // para models o catalog faz não fflag
  stageOnnx(MOONSHINE, [
    ['encoder_model.onnx', 4096],
    ['decoder_model_merged.onnx', 4096],
  ]);
  assert.equal(isModelCached(MOONSHINE, 'fp32'), true);
});

test('isModelCached: DECODER-side split (medium.en) requires the decoder .onnx_data on fp32', () => {
  // medium.en's divide é em decoder_model_merged. Em Apple Silicon (uniform
  // fp32) o merged decoder é o fp32 farquivo então its companion é required.
  // Stub-without-data precisa report missing.
  // Sizes são token (>0) — isModelCached apenas verifica existence + non-zero size.
  stageOnnx(MEDIUM_EN, [
    ['encoder_model.onnx', 4096],
    ['decoder_model_merged.onnx', 4096], // stub
  ]);
  assert.equal(isModelCached(MEDIUM_EN, 'fp32'), false);

  // Com o decoder companion present → cached.
  fs.writeFileSync(
    path.join(userData, 'whisper-models', MEDIUM_EN, 'onnx', 'decoder_model_merged.onnx_data'),
    Buffer.alloc(4096, 1),
  );
  assert.equal(isModelCached(MEDIUM_EN, 'fp32'), true);
});

test('isModelCached: DECODER-side split needs NO .onnx_data when decoder is quantized', () => {
  // Fora Apple Silicon o per-module mapa quantizes o decoder to q8, loading
  // decoder_model_merged_quantized.onnx — que tem não sdivide O external-data
  // requirement é keyed por o RESOLVED filename, então it precisa não exigir a
  // companion that doesn't exist para o quantized variant.
  const dtype = {
    encoder_model: 'fp32',
    decoder_model_merged: 'q8',
    decoder_model: 'q8',
    decoder_with_past_model: 'q8',
  };
  stageOnnx(MEDIUM_EN, [
    ['encoder_model.onnx', 4096],
    ['decoder_model_merged_quantized.onnx', 4096], // self-contained q8
  ]);
  assert.equal(isModelCached(MEDIUM_EN, dtype), true);
});

test.after(() => {
  Module._load = origLoad;
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* noop */ }
});
