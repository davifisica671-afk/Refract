// electron/services/meeting/__tests__/ClinicalTemplate.test.mjs
//
// Primeiro template vertical: atendimento clínico presencial (SOAP).
//
// Cobre as quatro partes que precisam concordar entre si para o template
// funcionar de ponta a ponta: detecção do modo, seções da nota, receita
// entregável e o invariante de prompt.
//
// Determinístico, sem rede, sem LLM. Roda contra dist-electron:
//   npm run build:electron && node --test electron/services/meeting/__tests__/ClinicalTemplate.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../../dist-electron/electron/services/meeting');
const load = (name) => import(pathToFileURL(path.join(base, name)).href);

const { MeetingModeDetector } = await load('MeetingModeDetector.js');
const { generateBuiltInRecipes, generateRecipe, BUILT_IN_RECIPES } = await load('MeetingRecipes.js');

const seg = (speaker, text, timestamp) => ({ speaker, text, timestamp, final: true });

const detector = new MeetingModeDetector();

describe('detecção — atendimento clínico', () => {
  test('consulta médica é detectada como clinical', () => {
    const res = detector.detect({
      transcript: [
        seg('me', 'What brings you in today?', 0),
        seg('speaker_1', "I've had a headache for four days and some nausea.", 4000),
        seg('me', 'Any medication you are taking?', 9000),
        seg('speaker_1', 'Just ibuprofen, and I have an allergy to penicillin.', 12000),
        seg('me', 'Blood pressure was 128 over 82, let me check your history.', 18000),
      ],
    });
    assert.equal(res.templateType, 'clinical');
    assert.ok(res.confidence > 0, 'clinical detectado sem confiança');
  });

  test('sessão de terapia é detectada como clinical', () => {
    const res = detector.detect({
      transcript: [
        seg('me', 'How has your sleep been since we last spoke?', 0),
        seg('speaker_1', 'Not great — the anxiety comes back at night and my mood dips.', 5000),
        seg('me', 'Are you still taking the medication we discussed?', 11000),
      ],
    });
    assert.equal(res.templateType, 'clinical');
  });

  test('título de agenda com "patient" leva a clinical', () => {
    const res = detector.detect({
      transcript: [seg('me', 'Let us get started.', 0)],
      calendarTitle: 'Patient consultation — follow-up',
    });
    assert.equal(res.templateType, 'clinical');
  });

  test('NÃO rouba detecção de vendas (transcrição comercial continua sales)', () => {
    // "client" e "follow-up" aparecem em vendas também; os sinais clínicos
    // precisam ser específicos o suficiente para não sequestrar esse caso.
    const res = detector.detect({
      transcript: [
        seg('me', 'What is your budget for this?', 0),
        seg('speaker_1', 'Around 40k, but procurement needs a contract and a quote.', 5000),
        seg('me', 'Any objection from the stakeholder side?', 10000),
        seg('speaker_1', 'They want to see a pilot before we close the deal.', 15000),
      ],
    });
    assert.equal(res.templateType, 'sales');
  });

  test('conversa genérica permanece general', () => {
    const res = detector.detect({
      transcript: [
        seg('me', 'Did you see the game last night?', 0),
        seg('speaker_1', 'Yes, what a finish.', 4000),
      ],
    });
    assert.equal(res.templateType, 'general');
  });
});

describe('seções da nota clínica', () => {
  test('o template clinical define as seções SOAP', async () => {
    const { TEMPLATE_NOTE_SECTIONS } = await import(
      pathToFileURL(path.resolve(__dirname, '../../../../dist-electron/electron/services/ModesManager.js')).href
    );
    const titles = TEMPLATE_NOTE_SECTIONS.clinical.map((s) => s.title);
    assert.deepEqual(titles, ['Subjective', 'Objective', 'Assessment', 'Plan', 'Not documented']);
  });

  test('as descrições proíbem inventar achado clínico', async () => {
    const { TEMPLATE_NOTE_SECTIONS } = await import(
      pathToFileURL(path.resolve(__dirname, '../../../../dist-electron/electron/services/ModesManager.js')).href
    );
    const objective = TEMPLATE_NOTE_SECTIONS.clinical.find((s) => s.title === 'Objective');
    // Num prontuário, um número inventado é um dado falso em documento legal.
    assert.match(objective.description, /ONLY if it was actually spoken/i);
    const assessment = TEMPLATE_NOTE_SECTIONS.clinical.find((s) => s.title === 'Assessment');
    assert.match(assessment.description, /never state a diagnosis as established fact/i);
  });
});

describe('receita SOAP', () => {
  const summary = {
    title: 'Follow-up consultation',
    // generateBuiltInRecipes inclui SEMPRE follow-up-email e slack-update, que
    // leem decisions/actionItems/risks/openQuestions — o fixture precisa tê-los
    // mesmo vazios. (Resumos reais passam por validateMeetingSummaryV3, que
    // preenche esses blocos; aqui o objeto é montado à mão.)
    decisions: [],
    actionItems: [],
    risks: [],
    openQuestions: [],
    tldr: [],
    overview: '',
    sections: [
      { title: 'Subjective', bullets: [{ text: 'Headache for four days, some nausea.' }] },
      { title: 'Objective', bullets: [{ text: 'BP 128/82 as recorded in room.' }] },
      { title: 'Assessment', bullets: [{ text: 'Clinician impression: tension-type headache.' }] },
      { title: 'Plan', bullets: [{ text: 'Review in two weeks if unresolved.' }] },
      { title: 'Not documented', bullets: [{ text: 'No allergy history captured.' }] },
    ],
  };

  test('é oferecida apenas no modo clinical', () => {
    const recipe = BUILT_IN_RECIPES.find((r) => r.id === 'soap-note');
    assert.ok(recipe, 'receita soap-note não registrada');
    assert.deepEqual(recipe.modes, ['clinical']);

    const forClinical = generateBuiltInRecipes(summary, 'clinical');
    assert.ok(forClinical['soap-note'], 'soap-note ausente no modo clinical');

    const forSales = generateBuiltInRecipes(summary, 'sales');
    assert.equal(forSales['soap-note'], undefined, 'soap-note vazou para outro modo');
  });

  test('renderiza S/O/A/P com o conteúdo real das seções', () => {
    const out = generateRecipe(summary, 'soap-note');
    assert.match(out, /^# SOAP Note/);
    assert.match(out, /## S — Subjective/);
    assert.match(out, /Headache for four days/);
    assert.match(out, /## O — Objective/);
    assert.match(out, /BP 128\/82/);
    assert.match(out, /## A — Assessment/);
    assert.match(out, /## P — Plan/);
  });

  test('mantém a seção "Not documented" mesmo quando vazia', () => {
    // É o que impede o profissional de assinar um registro com lacuna invisível.
    const sparse = { title: 'x', decisions: [], actionItems: [], sections: [{ title: 'Subjective', bullets: [{ text: 'Cough.' }] }] };
    const out = generateRecipe(sparse, 'soap-note');
    assert.match(out, /## Not documented/);
    assert.match(out, /Nothing flagged as missing/);
  });

  test('seções ausentes viram lacuna declarada, nunca conteúdo inventado', () => {
    const empty = { title: 'x', decisions: [], actionItems: [], sections: [] };
    const out = generateRecipe(empty, 'soap-note');
    assert.match(out, /Not reported/);
    assert.match(out, /Not measured/);
    assert.doesNotMatch(out, /BP \d+\/\d+/);
  });

  test('marca o resultado como rascunho que exige revisão profissional', () => {
    const out = generateRecipe(summary, 'soap-note');
    assert.match(out, /Requires review and sign-off/i);
  });
});

describe('invariante de prompt', () => {
  test('MODE_CLINICAL_PROMPT começa com um prefixo compartilhado', async () => {
    // O ModesManager deduplica tokens por startsWith(); se o prompt divergir, o
    // app avisa no boot e volta a enviar o bloco completo (custo em tokens).
    const { MODE_CLINICAL_PROMPT } = await import(
      pathToFileURL(path.resolve(__dirname, '../../../../dist-electron/electron/llm/prompts.js')).href
    );
    const { SHARED_MODE_PREFIX, SHARED_MODE_PREFIX_SHORT } = await import(
      pathToFileURL(path.resolve(__dirname, '../../../../dist-electron/electron/llm/prompts.js')).href
    );
    assert.ok(
      MODE_CLINICAL_PROMPT.startsWith(SHARED_MODE_PREFIX) ||
        MODE_CLINICAL_PROMPT.startsWith(SHARED_MODE_PREFIX_SHORT),
      'MODE_CLINICAL_PROMPT não começa com nenhum prefixo compartilhado',
    );
  });

  test('o prompt clínico proíbe fabricar achados', async () => {
    const { MODE_CLINICAL_PROMPT } = await import(
      pathToFileURL(path.resolve(__dirname, '../../../../dist-electron/electron/llm/prompts.js')).href
    );
    assert.match(MODE_CLINICAL_PROMPT, /NEVER invent a clinical finding/i);
    assert.match(MODE_CLINICAL_PROMPT, /not reported/i);
  });
});
