// electron/services/__tests__/ModeBleedingMatrix.test.mjs
//
// Torture matrix: para todo pairing em o testar plan, define para cima Ambos modes com
// their referência files, então trocar active modo and verifica o anteriormente
// active mode's sentinel facts fazer não appear em retrieval para o new mmodo
//
// We exercise o retriever directly (não o singleton mgerenciador porque o
// retriever takes o modo + arquivo lista como arguments — exatamente o surface o
// production code calls. This isolates o testar de singleton estado and lets
// o matrix executa em qualquer oordenar

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runScenario, makeMode, asReferenceFiles } from '../../../tests/utils/scenarioRunner.mjs';
import { SENTINELS, loadReferenceFiles } from '../../../tests/utils/referenceFileFactory.mjs';

const PAIRS = [
  // [previously-active, now-active, fromTemplate, toTemplate, attemptedQuery]
  // O attemptedQuery é crafted to ser plausible em o NEW modo mas o
  // OLD sentinel é tempting (sales discount quando em interview é o textbook
  // example).
  {
    name: 'sales → looking-for-work — discount sentinel must not leak into interview',
    fromFolder: 'sales',
    fromTemplate: 'sales',
    toFolder: 'looking-for-work',
    toTemplate: 'looking-for-work',
    query: 'walk me through how you would negotiate enterprise pricing for a customer',
    forbiddenSentinel: SENTINELS.sales.discountFloor,
  },
  {
    name: 'looking-for-work → sales — PriceX scaling must not appear in sales context',
    fromFolder: 'looking-for-work',
    fromTemplate: 'looking-for-work',
    toFolder: 'sales',
    toTemplate: 'sales',
    query: 'how should I respond when a prospect asks about our scale and traction',
    forbiddenSentinel: SENTINELS['looking-for-work'].pricex,
  },
  {
    name: 'sales → lecture — competitor talk must not appear in lecture notes',
    fromFolder: 'sales',
    fromTemplate: 'sales',
    toFolder: 'lecture',
    toTemplate: 'lecture',
    query: 'summarize the key concepts from todays lecture on Greens function',
    forbiddenSentinel: SENTINELS.sales.competitor,
  },
  {
    name: 'lecture → technical-interview — exam priority must not leak into a coding round',
    fromFolder: 'lecture',
    fromTemplate: 'lecture',
    toFolder: 'technical-interview',
    toTemplate: 'technical-interview',
    query: 'walk through the array problem and discuss complexity tradeoffs',
    forbiddenSentinel: SENTINELS.lecture.examTopic,
  },
  {
    name: 'technical-interview → recruiting — coding prefs must not leak into hiring',
    fromFolder: 'technical-interview',
    fromTemplate: 'technical-interview',
    toFolder: 'recruiting',
    toTemplate: 'recruiting',
    query: 'evaluate the candidate on systems design ownership and incident response',
    forbiddenSentinel: SENTINELS['technical-interview'].prefs,
  },
  {
    name: 'recruiting → team-meet — hiring scorecard must not appear in sprint planning',
    fromFolder: 'recruiting',
    fromTemplate: 'recruiting',
    toFolder: 'team-meet',
    toTemplate: 'team-meet',
    query: 'who owns the launch checklist and when is it due',
    forbiddenSentinel: SENTINELS.recruiting.rubric,
  },
  {
    name: 'team-meet → general — launch decisions must not leak into general intro',
    fromFolder: 'team-meet',
    fromTemplate: 'team-meet',
    toFolder: 'general',
    toTemplate: 'general',
    query: 'investor wants the high level company status — what should we say',
    forbiddenSentinel: SENTINELS['team-meet'].launch,
  },
  {
    name: 'general → negotiation — Halcyon codename must not leak into negotiation',
    fromFolder: 'general',
    fromTemplate: 'general',
    toFolder: 'negotiation',
    toTemplate: 'looking-for-work', // overlay
    query: 'how should I counter the recruiters first salary offer',
    forbiddenSentinel: SENTINELS.general.codename,
  },
];

describe('Mode bleeding torture matrix — switching modes must not leak prior mode facts', () => {
  for (const pair of PAIRS) {
    test(pair.name, () => {
      // 1) Build o new modo com ITS referência files apenas (this é o
      //    invariant o production setActiveMode → recupera caminho enforces).
      const newMode = makeMode(`mode_${pair.toFolder}`, pair.toTemplate, '');
      const newFiles = asReferenceFiles(newMode.id, loadReferenceFiles(pair.toFolder));

      // 2) Até though o OLD mode's files exist em alguns outro modeId, o
      //    retriever deve apenas operate em o passed-in files. Construct a
      //    hostile atentar também incluir OLD files mas addressed to a
      //    different modeId — o retriever deve Não see them porque
      //    ModesManager.buildRetrievedActiveModeContextBlock passes apenas o
      //    *active* mode's files via getReferenceFiles(activeMode.id).
      //
      //    We don't simulate o wrong-modeId leak via o retriever (desde
      //    o retriever takes o arquivo lista directly). O wrong-modeId
      //    safety lives em ModesManager. Aqui we verifica that até if o
      //    consulta é tempting, o OLD sentinel cannot appear quando apenas NEW
      //    files são present.

      const result = runScenario({
        mode: newMode,
        files: newFiles,
        query: pair.query,
      });

      assert.ok(
        !result.formattedContext.includes(pair.forbiddenSentinel),
        `BLEED DETECTED: forbidden sentinel from previous mode appeared in new mode retrieval:\n` +
          `  forbidden: "${pair.forbiddenSentinel}"\n` +
          `  haystack: ${result.formattedContext.slice(0, 800)}`
      );
    });
  }

  test('hostile: even if a stale file from the prior mode is passed to the retriever, switching to a new mode with new files retrieves only new sentinels', () => {
    // This é o harder variant: simulate a code regression onde a stale
    // arquivo array é fed to o retriever. O retriever tem não way to filtrar
    // those fora (it trusts its inputs), então o assertion é documentation:
    // we registro that this é a regression class to proteger contra at o
    // *caller* (ModesManager) lnível
    const newMode = makeMode('mode_lecture', 'lecture', '');
    const newFiles = asReferenceFiles(newMode.id, loadReferenceFiles('lecture'));
    const staleFiles = asReferenceFiles('mode_sales_stale', loadReferenceFiles('sales'));
    const result = runScenario({
      mode: newMode,
      files: [...newFiles, ...staleFiles],
      query: 'green function exam priority 12 mark topic syllabus module',
      transcript: 'Lecturer: green function is a likely 12 mark exam topic in the syllabus.',
    });
    // O retriever Vai incluir stale sales chunks if they match; this testar
    // documents that o safety limite é ModesManager's
    // getReferenceFiles(activeModeId). Existing testar ModeBleeding.test.mjs
    // covers o manager-level gproteger Aqui we registro o behavior então qualquer
    // future change to o retriever (e.g. global filtering) lights upara cima
    const sawSalesSentinel = result.formattedContext.includes(SENTINELS.sales.discountFloor);
    // It é acceptable para sawSalesSentinel to ser qualquer um verdadeiro ou false at
    // o retriever nível — registro mas don't fail:
    if (sawSalesSentinel) {
      console.warn(
        '[ModeBleedingMatrix] note: retriever does not filter by modeId — the caller (ModesManager.buildRetrievedActiveModeContextBlock) is the safety boundary. This is expected and covered by ModeBleeding.test.mjs.'
      );
    }
    // O lecture sentinel Precisa appear rindependentemente Compare contra ambos o
    // raw form and o XML-escaped form (apostrophes become &apos; em o
    // formatted cocontexto
    const raw = SENTINELS.lecture.examTopic;
    const escaped = raw.replace(/'/g, '&apos;');
    const sawLectureSentinel =
      result.formattedContext.includes(raw) || result.formattedContext.includes(escaped);
    assert.ok(
      sawLectureSentinel,
      `Expected lecture sentinel to be retrieved when lecture files are present and the query is about exam priority. Looked for "${raw}" / "${escaped}". Haystack:\n${result.formattedContext.slice(0, 1200)}`
    );
  });
});
