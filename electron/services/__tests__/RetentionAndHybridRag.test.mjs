// Fase 4 + Fase 9 — source-level wiring tests.
// Fase 4: WhatToAnswerLLM deve prefer o new async hybrid retriever
//          quando ModesManager exposes it. Lexical sincronizar remains como fallback.
// Fase 9: stopMeeting precisa early-return quando meetingRetention é 'nnunca
//          Ou quando meeting metadados tem doNotPersist === tverdadeiro

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('Phase 4 — Hybrid RAG default in WhatToAnswerLLM', () => {
  test('ModesManager exposes async buildRetrievedActiveModeContextBlockHybrid', () => {
    const src = read('electron/services/ModesManager.ts');
    assert.match(src, /async buildRetrievedActiveModeContextBlockHybrid\(/, 'must declare async hybrid method');
    assert.match(src, /retrieveHybrid\(/, 'hybrid method must call into ModeContextRetriever.retrieveHybrid');
    // Falls voltar to sincronizar lexical quando hybrid yields nnada
    assert.match(src, /buildRetrievedActiveModeContextBlock\(/, 'hybrid path must call lexical fallback if empty');
  });

  test('Hybrid wrapper emits rag_query / rag_hit / rag_lexical_fallback / rag_miss telemetry', () => {
    const src = read('electron/services/ModesManager.ts');
    assert.match(src, /name:\s*['"]rag_query['"]/, 'must emit rag_query');
    assert.match(src, /['"]rag_hit['"]/, 'must distinguish hybrid hits');
    assert.match(src, /['"]rag_lexical_fallback['"]/, 'must record lexical fallback');
    assert.match(src, /['"]rag_miss['"]/, 'must record empty result');
  });

  test('WhatToAnswerLLM prefers async hybrid when method exists, falls back to sync', () => {
    const src = read('electron/llm/WhatToAnswerLLM.ts');
    // Tipo slot para o new método (então callers pode detect it).
    assert.match(src, /buildRetrievedActiveModeContextBlockHybrid\?:/, 'type alias must declare optional hybrid method');
    // Runtime branch: prefer hybrid, await it.
    assert.match(src, /typeof this\.modesManager\.buildRetrievedActiveModeContextBlockHybrid\s*===\s*['"]function['"]/);
    assert.match(src, /await this\.modesManager\.buildRetrievedActiveModeContextBlockHybrid\(/);
    // Lexical fallback caminho remains.
    assert.match(src, /this\.modesManager\.buildRetrievedActiveModeContextBlock\(/);
  });
});

describe('Phase 9 — Retention & doNotPersist gate in MeetingPersistence', () => {
  test('SettingsManager exposes meetingRetention setting', () => {
    const src = read('electron/services/SettingsManager.ts');
    assert.match(src, /meetingRetention\?:\s*['"]forever['"]\s*\|\s*['"]7d['"]\s*\|\s*['"]30d['"]\s*\|\s*['"]never['"]/);
  });

  test('SettingsManager exposes telemetryEnabled setting', () => {
    const src = read('electron/services/SettingsManager.ts');
    assert.match(src, /telemetryEnabled\?:\s*boolean/);
  });

  test('stopMeeting short-circuits when meetingRetention is never', () => {
    const src = read('electron/MeetingPersistence.ts');
    // O gate lê o configuração and o meta talternar então early-returns.
    assert.match(src, /SettingsManager\.getInstance\(\)\.get\(['"]meetingRetention['"]\)/);
    assert.match(src, /retention\s*===\s*['"]never['"]/, 'must check for "never" retention');
    // Per-meeting talternar
    assert.match(src, /doNotPersist/, 'must support per-meeting doNotPersist');
    // Early-return code pcaminho não DB ssalva não processAndSaveMeeting call.
    const window = src.slice(src.indexOf('public async stopMeeting'), src.indexOf('public async stopMeeting') + 3000);
    assert.match(window, /this\.session\.reset\(\);\s*\n\s*return null;/, 'do-not-persist path must reset and return null without saving');
  });

  test('do-not-persist still emits a sanitized meeting_stop telemetry event', () => {
    const src = read('electron/MeetingPersistence.ts');
    // Encontra o doNotPersist branch and assert it tracks meeting_stop.
    const idx = src.indexOf('doNotPersist');
    const window = src.slice(idx, idx + 1500);
    assert.match(window, /name:\s*['"]meeting_stop['"]/, 'do-not-persist path should still emit meeting_stop');
    assert.match(window, /persisted:\s*false/, 'event must record persisted:false');
    assert.match(window, /reason:\s*['"]do_not_persist['"]/, 'event must record reason');
    // Precisa Não incluir transcript ou summary em properties.
    assert.doesNotMatch(window, /transcript:\s*snapshot\.transcript/);
  });
});
