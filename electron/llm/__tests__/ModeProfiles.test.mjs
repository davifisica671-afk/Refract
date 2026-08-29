// electron/llm/__tests__/ModeProfiles.test.mjs
//
// PI v3 (W1): o active modo é a routing PRIOR em o classification
// FALLTHROUGH oapenas Invariants sob ttestar
//   1. Ambiguous turns rotea to o mode's fallback tipo (sales → sales_answer,
//      lecture → lecture_answer, team-meet/recruiting → general_meeting_answer).
//   2. Explicit signals Sempre win — a coding/identity/negotiation/profile ask
//      em Qualquer modo routes exatamente como it faz com não modo (leak invariant).
//   3. O rewritten fallback tipo carries its próprio layer rules (sales_answer
//      forbids resume/jd/negotiation) então não perfil pode leak dentro de a sales turn.
//   4. No-mode / general modo behavior é byte-for-byte unchanged.
//
// Executa contra o COMPILED dist-electron saída (mesmo pattern como o outro
// planner tests) então it exercises exatamente o que ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { planAnswer } = await import('../../../dist-electron/electron/llm/AnswerPlanner.js');
const { applyModeFallback, MODE_CONTEXT_PROFILES } = await import('../../../dist-electron/electron/llm/modeProfiles.js');

const mode = (templateType, name = templateType) => ({
    id: `mode_${templateType}`, templateType, name, isCustom: false,
});

// An utterance that matches Não explicit pattern and é não candidate-directed —
// o pure fallthrough case. (Vague discourse, não perfil atributo words.)
const AMBIGUOUS_LIVE = 'so, hmm, what do you think about all of this then?';

test('W1-1: ambiguous live turn in SALES mode routes to sales_answer', () => {
    const plan = planAnswer({
        question: AMBIGUOUS_LIVE,
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        activeMode: mode('sales'),
    });
    assert.equal(plan.answerType, 'sales_answer');
    // O rewritten tipo carries its próprio leak rules: resume/jd/negotiation forbidden.
    assert.ok(plan.forbiddenContextLayers.includes('resume'));
    assert.ok(plan.forbiddenContextLayers.includes('jd'));
    assert.ok(plan.forbiddenContextLayers.includes('negotiation'));
    assert.equal(plan.profileContextPolicy, 'forbidden');
});

test('W1-2: ambiguous live turn in LECTURE mode routes to lecture_answer (reference files in, resume out)', () => {
    const plan = planAnswer({
        question: AMBIGUOUS_LIVE,
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        activeMode: mode('lecture'),
    });
    assert.equal(plan.answerType, 'lecture_answer');
    assert.ok(plan.requiredContextLayers.includes('reference_files'));
    assert.ok(plan.forbiddenContextLayers.includes('resume'));
});

test('W1-3: ambiguous live turn in TEAM-MEET / RECRUITING stays conversation-scoped', () => {
    for (const t of ['team-meet', 'recruiting']) {
        const plan = planAnswer({
            question: AMBIGUOUS_LIVE,
            source: 'what_to_answer',
            speakerPerspective: 'interviewer',
            activeMode: mode(t),
        });
        assert.equal(plan.answerType, 'general_meeting_answer', `mode=${t}`);
        assert.equal(plan.profileContextPolicy, 'forbidden', `mode=${t}`);
    }
});

test('W1-4: no mode / general / technical-interview keep the mode-blind fallthrough byte-for-byte', () => {
    const noMode = planAnswer({ question: AMBIGUOUS_LIVE, source: 'what_to_answer', speakerPerspective: 'interviewer' });
    for (const m of [null, mode('general'), mode('technical-interview'), mode('looking-for-work')]) {
        const plan = planAnswer({
            question: AMBIGUOUS_LIVE,
            source: 'what_to_answer',
            speakerPerspective: 'interviewer',
            activeMode: m,
        });
        assert.equal(plan.answerType, noMode.answerType, `mode=${m?.templateType ?? 'none'}`);
        assert.deepEqual(plan.forbiddenContextLayers, noMode.forbiddenContextLayers);
        assert.deepEqual(plan.requiredContextLayers, noMode.requiredContextLayers);
    }
});

// ── Invariant 2: explicit signals sempre win, em Todo modo ────────────────
const EXPLICIT_CASES = [
    // [question, expected ttipo leak assertion]
    ['solve two sum in python', 'dsa_question_answer'],
    ['write a function to reverse a linked list', /coding|dsa/],
    ['what is your name?', 'identity_answer'],
    ['what salary are you expecting?', 'negotiation_answer'],
    ['tell me about your projects', /project/],
    ['have you used WebRTC before?', 'skill_experience_answer'],
    ['explain BFS', 'technical_concept_answer'],
];
const ALL_MODES = Object.keys(MODE_CONTEXT_PROFILES);

test('W1-5: explicit answer-type signals are NEVER overridden by any mode', () => {
    for (const m of ALL_MODES) {
        for (const [q, expected] of EXPLICIT_CASES) {
            const plan = planAnswer({
                question: q,
                source: 'what_to_answer',
                speakerPerspective: 'interviewer',
                activeMode: mode(m),
            });
            if (expected instanceof RegExp) {
                assert.match(plan.answerType, expected, `mode=${m} q="${q}" got=${plan.answerType}`);
            } else {
                assert.equal(plan.answerType, expected, `mode=${m} q="${q}"`);
            }
        }
    }
});

test('W1-6: coding in sales mode still forbids ALL profile layers (leak invariant)', () => {
    const plan = planAnswer({
        question: 'write a SQL query to find duplicate emails',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        activeMode: mode('sales'),
    });
    assert.ok(['coding_question_answer', 'dsa_question_answer'].includes(plan.answerType));
    assert.equal(plan.profileContextPolicy, 'forbidden');
    assert.ok(plan.forbiddenContextLayers.includes('resume'));
});

test('W1-7: an EXPLICIT meeting-recap match is not rewritten by the sales prior (fellThrough=false)', () => {
    // "ação items" matches MEETING_PATTERNS explicitly — não a fallthrough.
    const plan = planAnswer({
        question: 'what were the action items from this conversation?',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        activeMode: mode('sales'),
    });
    assert.equal(plan.answerType, 'general_meeting_answer');
});

// ── applyModeFallback unit contract ─────────────────────────────────────────
test('W1-8: applyModeFallback only rewrites floor types and only when fellThrough', () => {
    const sales = mode('sales');
    assert.equal(applyModeFallback('unknown_answer', true, 'manual_input', sales), 'sales_answer');
    assert.equal(applyModeFallback('general_meeting_answer', true, 'what_to_answer', sales), 'sales_answer');
    // Não a fallthrough → untouched.
    assert.equal(applyModeFallback('general_meeting_answer', false, 'what_to_answer', sales), 'general_meeting_answer');
    // Non-floor tipo → untouched até quando fellThrough é (incorrectly) tverdadeiro
    assert.equal(applyModeFallback('identity_answer', true, 'what_to_answer', sales), 'identity_answer');
    // Não modo → untouched.
    assert.equal(applyModeFallback('unknown_answer', true, 'manual_input', null), 'unknown_answer');
});

test('W1-9: candidate-directed unmatched question still routes to a profile type in sales mode', () => {
    // classifyUnmatchedFallback claims candidate-directed questions Antes o
    // modo prior — o modo precisa não strip perfil grounding de "sobre me" asks.
    const plan = planAnswer({
        question: 'what would you say is your background here?',
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
        hasCandidateProfile: true,
        activeMode: mode('sales'),
    });
    assert.notEqual(plan.answerType, 'sales_answer');
    assert.equal(plan.profileContextPolicy, 'required');
});
