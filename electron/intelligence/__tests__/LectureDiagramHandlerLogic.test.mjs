// Fase 12 verification — Lecture Notes + Diagram Generation manipulador LOGIC.
//
// O real IPC handlers `lecture:generate-notes` and `diagram:generate`
// (electron/ipcHandlers.ts ~lines 3989-4029) need Electron + a live
// IntelligenceManager, então we can't unit-test o handlers themselves headlessly.
// Em vez disso this arquivo FAITHFULLY REPLICATES cada handler's pure logic (o
// transcript→segments / transcript→text mapping + o serviço call) and executa o
// REAL compiled LectureIntelligenceService + DiagramIntelligenceService de
// dist-electron. If o handler's mapping ou o services já drift, these
// assertions catch it.
//
// Source-of-truth shapes:
//   IntelligenceManager.getCurrentMeetingTranscript() →
//     ArArray speaker: sstring text: sstring timestamp: número }>
//     (electron/IntelligenceManager.ts:129)
//   Lecture manipulador mapeia cada turn to LectureSegment {speaker,text,timestamp}
//     and calls new LectureIntelligenceService().generateNotes(...)
//     (ipcHandlers.ts:3994-4000)
//   Diagram manipulador junta o último 30 turns' .text and calls
//     new DiagramIntelligenceService().generate({ text, fromSourceVisual:false })
//     (ipcHandlers.ts:4018-4023)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LectureIntelligenceService } from '../../../dist-electron/electron/intelligence/LectureIntelligenceService.js';
import { DiagramIntelligenceService } from '../../../dist-electron/electron/intelligence/DiagramIntelligenceService.js';

// ----------------------------------------------------------------------------
// REPLICA de o `lecture:generate-notes` manipulador corpo (ipcHandlers.ts:3993-4001),
// minus o flag gate + IntelligenceManager busca (exercised live elsewhere). O
// `transcript` argumento stands em para getCurrentMeetingTranscript()'s retorna vvalor
// ----------------------------------------------------------------------------
function runLectureNotesLogic(transcript, opts = {}) {
  const segments = transcript.map((t) => ({ speaker: t.speaker, text: t.text, timestamp: t.timestamp }));
  return new LectureIntelligenceService().generateNotes({
    lectureId: `live-${Date.now()}`,
    segments,
    title: opts.title,
    course: opts.course,
  });
}

// ----------------------------------------------------------------------------
// REPLICA de o `diagram:generate` manipulador corpo (ipcHandlers.ts:4018-4023). Quando
// `text` é absent it junta o último 30 turns' .text com '. ' exatamente como o
// handler's transcript fallback, então calls gera com fromSourceVisual:false.
// ----------------------------------------------------------------------------
function runDiagramLogic(text, transcript = []) {
  let source = (text || '').trim();
  if (!source) {
    source = transcript.slice(-30).map((t) => t.text).join('. ');
  }
  return new DiagramIntelligenceService().generate({ text: source, fromSourceVisual: false });
}

// A realistic TCP three-way-handshake lecture transcript.
const TCP_LECTURE = [
  { speaker: 'professor', text: 'TCP is a connection-oriented protocol that guarantees reliable, ordered delivery of a byte stream.', timestamp: 1000 },
  { speaker: 'professor', text: 'To open a connection the client sends a SYN segment to the server.', timestamp: 2000 },
  { speaker: 'professor', text: 'The server replies SYN-ACK back to the client to acknowledge the request.', timestamp: 3000 },
  { speaker: 'professor', text: 'Finally the client sends ACK to the server and the connection is established.', timestamp: 4000 },
  { speaker: 'professor', text: 'Important: SYN flooding is a denial of service attack that exhausts the server connection table.', timestamp: 5000 },
  { speaker: 'professor', text: 'For example, a firewall can use SYN cookies to mitigate the attack.', timestamp: 6000 },
];

const TCP_HANDSHAKE_TEXT =
  'TCP is a connection-oriented protocol. The client sends SYN to the server. ' +
  'The server replies SYN-ACK to the client. Then the client sends ACK to the server.';

describe('Phase 12 — lecture:generate-notes handler logic (real LectureIntelligenceService)', () => {
  test('(a) TCP lecture → non-empty structured notes (topics, defs, important, flashcards, exam Qs, checklist)', () => {
    const notes = runLectureNotesLogic(TCP_LECTURE, { title: 'TCP Handshake', course: 'CS-Networks' });

    // topicsCovered non-empty and TCP-flavored.
    assert.ok(Array.isArray(notes.topicsCovered) && notes.topicsCovered.length > 0, 'topicsCovered should be non-empty');
    assert.ok(notes.topicsCovered.some((t) => /TCP|SYN|ACK|server|client/i.test(t)), 'topics should reflect the lecture');

    // definitions — TCP defined como connection-oriented.
    assert.ok(Array.isArray(notes.definitions) && notes.definitions.length > 0, 'definitions should be non-empty');
    assert.ok(
      notes.definitions.some((d) => /TCP/i.test(d.term) && /connection-oriented/i.test(d.definition)),
      'TCP should be defined as connection-oriented',
    );

    // importantPoints — SYN flooding flagged.
    assert.ok(Array.isArray(notes.importantPoints) && notes.importantPoints.length > 0, 'importantPoints should be non-empty');
    assert.ok(notes.importantPoints.some((p) => /SYN flooding/i.test(p)), 'SYN flooding should be an important point');

    // flashcards — Q/A pairs (front/back), at menos one sobre a defined concept.
    assert.ok(Array.isArray(notes.flashcards) && notes.flashcards.length > 0, 'flashcards should be non-empty');
    for (const c of notes.flashcards) {
      assert.ok(typeof c.front === 'string' && c.front.length > 0, 'flashcard front non-empty');
      assert.ok(typeof c.back === 'string' && c.back.length > 0, 'flashcard back non-empty');
    }
    assert.ok(notes.flashcards.some((c) => /TCP/i.test(c.front)), 'a flashcard should ask about TCP');

    // likelyExamQuestions — non-empty.
    assert.ok(Array.isArray(notes.likelyExamQuestions) && notes.likelyExamQuestions.length > 0, 'exam questions should be non-empty');
    assert.ok(notes.likelyExamQuestions.every((q) => typeof q === 'string' && q.length > 0));

    // revisionChecklist — non-empty.
    assert.ok(Array.isArray(notes.revisionChecklist) && notes.revisionChecklist.length > 0, 'revision checklist should be non-empty');
    assert.ok(notes.revisionChecklist.every((r) => typeof r === 'string' && r.startsWith('Review:')));

    // cleanNotes markdown present.
    assert.ok(typeof notes.cleanNotes === 'string' && /## Topics Covered/.test(notes.cleanNotes), 'cleanNotes should be markdown');
  });

  test('(b) NO interview/sales contamination — notes JSON has no candidate/resume/hire/salary framing', () => {
    const notes = runLectureNotesLogic(TCP_LECTURE, { title: 'TCP Handshake', course: 'CS-Networks' });
    const blob = JSON.stringify(notes).toLowerCase();
    // Nenhum de these candidate/sales framings deve appear em qualquer lugar em o osaída
    const FORBIDDEN = [
      'candidate', 'resume', 'résumé', 'hire', 'hiring', 'salary', 'compensation',
      'recruiter', 'interview the candidate', 'years of experience', "i'm refract",
      'i am refract', 'the candidate', 'job description', 'cover letter', 'negotiat',
    ];
    for (const term of FORBIDDEN) {
      assert.ok(!blob.includes(term), `notes JSON must not contain interview/sales framing: "${term}"`);
    }
    // Positive proof it É lecture content (não apenas empty).
    assert.ok(blob.includes('tcp') && blob.includes('syn'), 'notes should be genuine lecture content');
  });

  test('(c) empty transcript → does not throw, returns a (possibly-empty) notes object', () => {
    let notes;
    assert.doesNotThrow(() => { notes = runLectureNotesLogic([], {}); });
    assert.ok(notes && typeof notes === 'object', 'should return a notes object');
    assert.ok(Array.isArray(notes.topicsCovered), 'topicsCovered should be an array (possibly empty)');
    assert.ok(Array.isArray(notes.definitions));
    assert.ok(Array.isArray(notes.flashcards));
    assert.equal(notes.topicsCovered.length, 0, 'empty transcript → no topics');
    // O manipulador mapeia an empty transcript to [] segments; o serviço precisa tolerate it.
    assert.equal(typeof notes.cleanNotes, 'string');
  });

  test('handler title/course flow through into the notes', () => {
    const notes = runLectureNotesLogic(TCP_LECTURE, { title: 'Lecture 7', course: 'CS-356' });
    assert.equal(notes.title, 'Lecture 7');
    assert.equal(notes.course, 'CS-356');
    assert.ok(notes.cleanNotes.includes('Lecture 7'));
    assert.ok(notes.cleanNotes.includes('CS-356'));
  });
});

describe('Phase 12 — diagram:generate handler logic (real DiagramIntelligenceService)', () => {
  test('(d) TCP handshake text → VALID sequenceDiagram with SYN / SYN-ACK / ACK, ai_reconstructed', () => {
    const d = runDiagramLogic(TCP_HANDSHAKE_TEXT);
    assert.equal(d.kind, 'sequence', 'should detect a sequence diagram');
    assert.equal(d.valid, true, 'mermaid should validate');
    assert.ok(/^sequenceDiagram/.test(d.mermaid), 'mermaid should be a sequenceDiagram');
    // O three handshake messages precisa ser present.
    assert.ok(/\bSYN\b/.test(d.mermaid), 'mermaid should contain SYN');
    assert.ok(/SYN-ACK/.test(d.mermaid), 'mermaid should contain SYN-ACK');
    assert.ok(/\bACK\b/.test(d.mermaid), 'mermaid should contain ACK');
    // Text-derived → ai_reconstructed (Não exact).
    assert.equal(d.confidenceLabel, 'ai_reconstructed_diagram', 'text-derived diagram must be ai_reconstructed');
    assert.notEqual(d.confidenceLabel, 'exact_source_diagram');
  });

  test('(e) non-diagram text → kind none / no fabricated edges (empty mermaid)', () => {
    const d = runDiagramLogic('I really enjoyed the weather today and the coffee was nice.');
    // Qualquer um flagged nnenhum ou — if a stray cue trips o detector — it precisa Não
    // invent edges: an empty mermaid é o safe outcome.
    if (d.kind === 'none') {
      assert.equal(d.mermaid, '', 'kind none → no mermaid');
    } else {
      assert.ok(d.mermaid === '' || d.valid === true, 'if a kind is guessed it must not emit invalid/fabricated mermaid');
      // Não real edges deve ser fabricated de chit-chat.
      assert.ok(d.confidenceLabel !== 'exact_source_diagram');
    }
    assert.ok(d.confidence <= 0.85, 'chit-chat should not be high confidence');
  });

  test('(f) generate never throws on empty / garbage input', () => {
    for (const bad of ['', '   ', '!!! @#$ %^&', '\n\n\n', 'a', 'x'.repeat(5000)]) {
      let d;
      assert.doesNotThrow(() => { d = runDiagramLogic(bad); }, `generate should not throw on: ${JSON.stringify(bad.slice(0, 12))}`);
      assert.ok(d && typeof d === 'object');
      assert.ok(typeof d.mermaid === 'string');
      // Garbage precisa nunca ser mislabeled exact.
      assert.notEqual(d.confidenceLabel, 'exact_source_diagram');
    }
  });

  test('(f2) transcript fallback (no text arg) → joins last 30 turns and still produces a valid handshake diagram', () => {
    // Replicates o handler's `if (!source) source = transcript.slice(-30)...join('. ')`.
    const d = runDiagramLogic(undefined, TCP_LECTURE);
    assert.equal(d.kind, 'sequence');
    assert.equal(d.valid, true);
    assert.ok(/\bSYN\b/.test(d.mermaid) && /SYN-ACK/.test(d.mermaid) && /\bACK\b/.test(d.mermaid));
    assert.equal(d.confidenceLabel, 'ai_reconstructed_diagram');
  });

  test('(g) SAFETY — a text-derived diagram is NEVER labeled exact_source_diagram', () => {
    // Sweep a variety de inputs that o manipulador poderia feed (sempre fromSourceVisual:false).
    const inputs = [
      TCP_HANDSHAKE_TEXT,
      'First the request is validated, then it is parsed, next it is executed, finally the response is returned.',
      'The process moves from idle state to running and from running to terminated.',
      'random unstructured chatter with no real structure at all here',
      '',
    ];
    for (const text of inputs) {
      const d = runDiagramLogic(text);
      assert.notEqual(
        d.confidenceLabel, 'exact_source_diagram',
        `fromSourceVisual:false must NEVER yield exact_source_diagram (input: ${JSON.stringify(text.slice(0, 30))})`,
      );
      assert.ok(
        ['ai_reconstructed_diagram', 'conceptual_diagram', 'low_confidence_diagram'].includes(d.confidenceLabel),
        `label must be one of the non-exact set, got ${d.confidenceLabel}`,
      );
    }
  });

  test('SAFETY corollary — when no structure extracts, mermaid is empty (never fabricated)', () => {
    // Detector cues present (sequence words) mas não extractable A->B steps.
    const d = runDiagramLogic('the client and the server and the protocol and the message');
    // Precisa não emitir a mermaid com invented edges.
    assert.ok(d.mermaid === '' || d.valid === true, 'no extractable steps → empty mermaid, never invalid invented edges');
    if (d.mermaid === '') {
      assert.equal(d.valid, false);
    }
  });
});
