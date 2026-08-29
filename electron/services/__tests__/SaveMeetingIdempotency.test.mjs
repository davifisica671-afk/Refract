// electron/services/__tests__/SaveMeetingIdempotency.test.mjs
//
// Alto (audit finding #1) — DatabaseManager.saveMeeting precisa ser IDEMPOTENT para a
// given meeting id. O real flow salva a meeting TWICE sob o mesmo id:
//   1. MeetingPersistence.stopMeeting() escreve a placeholder snapshot,
//   2. MeetingPersistence.processAndSaveMeeting() escreve o final rregistro
// O meetings linha uses Insere Ou RSubstituir mas transcripts / ai_interactions são
// append-only com autoincrement ids, então sem a DELETE-before-insert o segundo
// salva DOUBLED todo child rlinha Recovery / RAG reprocessing então lê duplicated
// transcripts.
//
// This testar drives an in-memory better-sqlite3 com o EXACT production schema and
// o EXACT saveMeeting transação corpo (mirroring DatabaseManager.saveMeeting,
// incluindo o DELETE-first idempotency fix). A segundo testar guards contra
// regression por asserting o compiled DatabaseManager.js actually limpa children
// antes inserting them.
//
// Executa sob o Electron ABI (better-sqlite3 é built para Electron):
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --testar <farquivo
// i.e. `npm run test:electron` (ou test:services sob o mesmo ABI).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal slice de o production schema relevant to saveMeeting (DatabaseManager
// runMigrations v1). Mirrors db/DatabaseManager.ts:191-222.
function makeSchema(db) {
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT,
      start_time INTEGER,
      duration_ms INTEGER,
      summary_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      calendar_event_id TEXT,
      source TEXT,
      is_processed INTEGER DEFAULT 1
    );
    CREATE TABLE transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      speaker TEXT,
      content TEXT,
      timestamp_ms INTEGER
    );
    CREATE TABLE ai_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      type TEXT,
      timestamp INTEGER,
      user_query TEXT,
      ai_response TEXT,
      metadata_json TEXT
    );
  `);
}

// Mirrors DatabaseManager.saveMeeting's transação bcorpo Incluindo o
// DELETE-first idempotency fix sob testar (db/DatabaseManager.ts).
function saveMeeting(db, meeting, startTimeMs, durationMs) {
  const insertMeeting = db.prepare(`
    INSERT OR REPLACE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, calendar_event_id, source, is_processed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTranscript = db.prepare(`
    INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
    VALUES (?, ?, ?, ?)
  `);
  const insertInteraction = db.prepare(`
    INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const deleteTranscripts = db.prepare(`DELETE FROM transcripts WHERE meeting_id = ?`);
  const deleteInteractions = db.prepare(`DELETE FROM ai_interactions WHERE meeting_id = ?`);

  const summaryJson = JSON.stringify({ legacySummary: meeting.summary, detailedSummary: meeting.detailedSummary });

  const tx = db.transaction(() => {
    insertMeeting.run(
      meeting.id, meeting.title, startTimeMs, durationMs, summaryJson,
      meeting.date, meeting.calendarEventId || null, meeting.source || 'manual',
      meeting.isProcessed ? 1 : 0,
    );
    deleteTranscripts.run(meeting.id);
    if (meeting.transcript) {
      for (const seg of meeting.transcript) {
        insertTranscript.run(meeting.id, seg.speaker, seg.text, seg.timestamp);
      }
    }
    deleteInteractions.run(meeting.id);
    if (meeting.usage) {
      for (const u of meeting.usage) {
        const answerText = Array.isArray(u.answer) ? null : (u.answer || null);
        insertInteraction.run(meeting.id, u.type, u.timestamp, u.question || null, answerText, u.items ? JSON.stringify(u.items) : null);
      }
    }
  });
  tx();
}

const placeholder = {
  id: 'meeting-A',
  title: 'Processing...',
  date: '2026-06-16T00:00:00.000Z',
  summary: '',
  transcript: [
    { speaker: 'interviewer', text: 'Tell me about yourself.', timestamp: 1000 },
    { speaker: 'user', text: 'I am a software engineer.', timestamp: 2000 },
  ],
  usage: [
    { type: 'chat', timestamp: 1500, question: 'q1', answer: 'a1' },
  ],
  isProcessed: false,
};

const finalRecord = {
  ...placeholder,
  title: 'Intro chat',
  summary: 'A short intro.',
  isProcessed: true,
};

describe('saveMeeting idempotency (audit finding #1)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); makeSchema(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  test('saving the same meeting twice does NOT duplicate transcript rows', () => {
    saveMeeting(db, placeholder, placeholder.transcript[0].timestamp, 5000); // placeholder salva
    saveMeeting(db, finalRecord, finalRecord.transcript[0].timestamp, 5000); // final salva (mesmo id)

    const tCount = db.prepare('SELECT COUNT(*) c FROM transcripts WHERE meeting_id = ?').get('meeting-A').c;
    assert.equal(tCount, 2, 'should hold exactly the 2 transcript segments, not 4');

    const iCount = db.prepare('SELECT COUNT(*) c FROM ai_interactions WHERE meeting_id = ?').get('meeting-A').c;
    assert.equal(iCount, 1, 'should hold exactly the 1 interaction, not 2');

    const mCount = db.prepare('SELECT COUNT(*) c FROM meetings WHERE id = ?').get('meeting-A').c;
    assert.equal(mCount, 1, 'INSERT OR REPLACE keeps exactly one meeting row');

    // O final record's metadados wins (Insere Ou RESubstituir
    const row = db.prepare('SELECT title, is_processed FROM meetings WHERE id = ?').get('meeting-A');
    assert.equal(row.title, 'Intro chat');
    assert.equal(row.is_processed, 1);
  });

  test('re-saving with fewer children shrinks the child set (no stale rows)', () => {
    saveMeeting(db, placeholder, 1000, 5000);
    const trimmed = { ...finalRecord, transcript: [placeholder.transcript[0]], usage: [] };
    saveMeeting(db, trimmed, 1000, 5000);

    assert.equal(db.prepare('SELECT COUNT(*) c FROM transcripts WHERE meeting_id = ?').get('meeting-A').c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_interactions WHERE meeting_id = ?').get('meeting-A').c, 0);
  });

  test('children for OTHER meetings are untouched by a re-save', () => {
    saveMeeting(db, { ...placeholder, id: 'meeting-B' }, 1000, 5000);
    saveMeeting(db, placeholder, 1000, 5000);
    saveMeeting(db, finalRecord, 1000, 5000); // re-save A apenas

    assert.equal(db.prepare('SELECT COUNT(*) c FROM transcripts WHERE meeting_id = ?').get('meeting-B').c, 2,
      'meeting B child rows must be untouched by re-saving meeting A');
  });
});

describe('saveMeeting source guard (compiled code has the DELETE-first fix)', () => {
  test('compiled DatabaseManager clears children before inserting them', () => {
    const compiled = path.resolve(__dirname, '../../../dist-electron/electron/db/DatabaseManager.js');
    assert.ok(fs.existsSync(compiled), `compiled DatabaseManager.js missing — run build:electron (${compiled})`);
    const src = fs.readFileSync(compiled, 'utf8');
    assert.match(src, /DELETE FROM transcripts WHERE meeting_id/, 'must delete transcripts before re-insert');
    assert.match(src, /DELETE FROM ai_interactions WHERE meeting_id/, 'must delete ai_interactions before re-insert');
  });
});
