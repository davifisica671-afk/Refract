import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sliceSafeHandleBlock, findSafeHandle } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/**
 * ISSUE 1 (P0): Raw STT API Keys returned to renderer
 *
 * O get-stored-credentials IPC manipulador Retorna raw STT API keys (Deepgram,
 * ElevenLabs, OpenAI, Groq, Azure, IBM, Soniox) como plaintext strings to o
 * renderer. These keys são stored em renderer estado and used to pre-populate
 * entrada fields, exposing them em o DOM/memory.
 *
 * Fix: Substituir raw chave values com masked versions (e.g., "sk-...abcd" foformata
 * O hasSttGroqKey booleano já tells UI if chave exists — não raw chave needed.
 */
test('get-stored-credentials IPC does not return raw STT API keys', () => {
  const source = read('electron/ipcHandlers.ts');

  // Encontra o get-stored-credentials manipulador (single ou Duplo quotes)
  const handlerMatch = source.match(/safeHandle\(['"]get-stored-credentials['"]/);
  assert.ok(handlerMatch && handlerMatch.index !== undefined, 'get-stored-credentials handler should exist');

  // Extrair apenas this manipulador (até o próximo safeHandle)
  const handlerStart = handlerMatch.index;
  const searchFrom = handlerStart + handlerMatch[0].length;
  const nextRel = source.slice(searchFrom).search(/safeHandle\(['"]/);
  const handlerEnd = nextRel === -1 ? source.length : searchFrom + nextRel;
  const handler = source.slice(handlerStart, handlerEnd);

  // STT keys deve ser boolean-only ou masked, Não raw chave values
  // O problematic pattern ié sttGroqKey: creds.groqSttApiKey || ''
  // This Retorna o raw API chave to o renderer

  // Verifica that raw credential acesso é Não returned directly
  assert.doesNotMatch(handler, /sttGroqKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttOpenaiKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttDeepgramKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttElevenLabsKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttAzureKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttIbmKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttSonioxKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);

  // Verifica that booleano flags ainda exist (to tell UI if chave é present)
  assert.match(handler, /hasSttGroqKey:/);
  assert.match(handler, /hasSttOpenaiKey:/);
  assert.match(handler, /hasDeepgramKey:/);
  assert.match(handler, /hasElevenLabsKey:/);
  assert.match(handler, /hasAzureKey:/);
  assert.match(handler, /hasIbmWatsonKey:/);
  assert.match(handler, /hasSonioxKey:/);

  // If stt*Key fields são returned at atodos they precisa ser masked (e.g., "sk-...abcd" ou empty sstring
  // O correct pattern ié sttGroqKey: masked(creds.groqSttApiKey) ou apenas omit o campo entirely
  const rawKeyAssignments = handler.match(/stt(Groq|Openai|Deepgram|ElevenLabs|Azure|Ibm|Soniox)Key:\s*creds\.\w+\s*\|\|/g);
  if (rawKeyAssignments) {
    assert.fail(`Found raw STT key assignments: ${rawKeyAssignments.join(', ')}. These return API keys to the renderer.`);
  }
});

test('error fallback in get-stored-credentials does not return raw STT keys', () => {
  const source = read('electron/ipcHandlers.ts');

  const handlerStart = source.search(/safeHandle\(['"]get-stored-credentials['"]/);
  assert.ok(handlerStart >= 0, 'get-stored-credentials handler should exist');

  // Encontra o catch block that Retorna o error fallback objeto
  const catchBlock = source.indexOf('} catch (error: any) {', handlerStart);
  assert.ok(catchBlock >= 0, 'catch block should exist');

  const catchEnd = source.indexOf('});', catchBlock);
  const errorFallback = source.slice(catchBlock, catchEnd + 3);

  // Error fallback deve Não conter raw STT keys (non-empty strings)
  // Empty strings (sttGroqKey: '') são safe and acceptable
  assert.doesNotMatch(errorFallback, /stt(Groq|Openai|Deepgram|ElevenLabs|Azure|Ibm|Soniox)Key:\s*creds\.\w+/);
});

test('renderer settings overlay does not rely on raw STT keys from IPC', () => {
  const settingsOverlay = read('src/components/SettingsOverlay.tsx');

  // O renderer deve uso hasSttGroqKey (bbooleano to know if a chave exists,
  // não o raw chave valor para security

  // O problematic pattern ié if (creds.sttGroqKey) setSttGroqKey(creds.sttGroqKey)
  // This iria accept and uso a raw chave if one eram returned

  // Verifica that o renderer uses booleano flags para chave presence
  assert.match(settingsOverlay, /hasStoredSttGroqKey/);
  assert.match(settingsOverlay, /hasStoredSttOpenaiKey/);
  assert.match(settingsOverlay, /hasStoredDeepgramKey/);
});

test('STT key fields in IPC response follow masked or boolean-only pattern', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'get-stored-credentials');

  // Count stt*Key campo assignments
  const keyFieldMatches = handler.match(/stt(Groq|Openai|Deepgram|ElevenLabs|Azure|Ibm|Soniox)Key:/g) || [];

  // If stt*Key fields são returned, they precisa Não ser raw creds acesso
  // Valid patterns: masked vversão empty sstring Ou campo não returned at todos (rely em htem fflag
  const rawAccessMatches = handler.match(/stt\w+Key:\s*creds\.\w+Key\s*\|\|/g) || [];

  if (keyFieldMatches.length > 0 && rawAccessMatches.length > 0) {
    assert.fail(`Found ${rawAccessMatches.length} raw STT key returns in get-stored-credentials. Keys must be masked or omitted.`);
  }
});