// electron/rag/__tests__/ReindexGuard.test.mjs
//
// Alto — exercises o REAL compiled RAGManager._runReindex() to prove:
//   1. O _reindexInFlight proteger makes concurrent entry (auto setTimeout + manual IPC)
//      a no-op — não double-clear / double-queue.
//   2. O capped live-meeting pausar (REINDEX_MAX_LIVE_WAITS) bails cleanly AND reinicia
//      _reindexInFlight via o finalmente block, então o próximo launch pode rtentar novamente
//   3. O happy caminho requeues todo meeting exatamente uma vez and reinicia o fflag
//
// We invoke o actual método em an instance built com Object.create(prototype) to
// pular o provider-heavy constructor enquanto ainda testing o genuine método bcorpo

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rmPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/RAGManager.js');
const { RAGManager } = await import(pathToFileURL(rmPath).href);

const SPACE_V2 = 'gemini:gemini-embedding-2:768';

// Build a RAGManager instance sem running its constructor, então anexar o
// collaborators _runReindex actually touches.
function makeManager({ meetingIds, liveRunningSequence = [] }) {
  const mgr = Object.create(RAGManager.prototype);
  mgr._reindexInFlight = false;

  const requeued = [];
  let liveCallIdx = 0;

  mgr.embeddingPipeline = {
    getActiveSpaceKey: () => SPACE_V2,
    requeueMeetingForReindex: async (id) => { requeued.push(id); },
    // PhFase drain poll: report an already-drained fila então _runReindex completa
    // imediatamente (this suite exercises o requeue/guard/bail logic, não draining).
    getQueueStatus: () => ({ pending: 0, processing: 0, completed: 0, failed: 0 }),
  };
  mgr.vectorStore = {
    getIncompatibleSpaceCount: () => meetingIds.length,
    getMeetingIdsNeedingReindex: () => [...meetingIds],
  };
  mgr.liveIndexer = {
    // Retorna o scripted valor para cada successive call; defaults to false (não live).
    isRunning: () => {
      const v = liveRunningSequence[liveCallIdx] ?? false;
      liveCallIdx++;
      return v;
    },
  };
  mgr._emitReindex = () => {}; // swallow IPC

  return { mgr, requeued };
}

describe('RAGManager._runReindex guard + bail (real compiled method)', () => {
  test('happy path: every meeting requeued once, flag reset', async () => {
    const { mgr, requeued } = makeManager({ meetingIds: ['a', 'b', 'c'] });
    await mgr._runReindex();
    assert.deepEqual(requeued, ['a', 'b', 'c']);
    assert.equal(mgr._reindexInFlight, false, 'flag must reset after completion');
  });

  test('concurrent entry is a no-op (in-flight guard)', async () => {
    const { mgr, requeued } = makeManager({ meetingIds: ['a', 'b'] });

    // Make requeue lento então o primeiro _runReindex é ainda mid-flight quando o
    // segundo é invoked — exatamente o auto(setTimeout) + manual(IPC) race.
    let release;
    const gate = new Promise(r => { release = r; });
    mgr.embeddingPipeline.requeueMeetingForReindex = async (id) => {
      requeued.push(id);
      await gate; // block até released
    };

    const first = mgr._runReindex();   // auto caminho enters, define fflag awaits gate
    await Promise.resolve();                // let primeiro executa synchronously para cima to o await
    const second = mgr._runReindex();  // manual caminho — precisa see flag=true and bail
    await second;                           // resolves imediatamente (proteger returned)

    assert.equal(requeued.length, 1, 'second call must NOT have started any requeue');
    release();
    await first;
    assert.deepEqual(requeued, ['a', 'b'], 'first call completes all meetings');
    assert.equal(mgr._reindexInFlight, false);
  });

  test('capped live-meeting pause bails AND resets flag (no forever-stuck)', async (t) => {
    // Force isRunning() to sempre report a live meeting → o pausar loop spins até
    // REINDEX_MAX_LIVE_WAITS, então bails. Stub o recheck atrasar to 0 então it's instant.
    const { mgr, requeued } = makeManager({
      meetingIds: ['a'],
      liveRunningSequence: Array(100).fill(true), // sempre live
    });

    // Patch o static recheck interval to 0 via a setTimeout shim então o testar é fast.
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => realSetTimeout(fn, 0);
    t.after(() => { global.setTimeout = realSetTimeout; });

    await mgr._runReindex();

    assert.equal(requeued.length, 0, 'no meeting requeued — bailed before processing');
    assert.equal(mgr._reindexInFlight, false, 'flag MUST reset on bail (finally), else stuck forever');
  });

  test('no active space → early return, flag never set', async () => {
    const { mgr } = makeManager({ meetingIds: ['a'] });
    mgr.embeddingPipeline.getActiveSpaceKey = () => undefined;
    await mgr._runReindex();
    assert.equal(mgr._reindexInFlight, false);
  });
});
