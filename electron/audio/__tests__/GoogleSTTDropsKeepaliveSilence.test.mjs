// Regression testar para o "Google STT transcribes chipmunk 'he he hehehe'" bug.
//
// Symptom: após switching o STT provedor to Google (service-account JSON),
// audio transcribed como garbled tiny fragments — "he", "heh", "hehehe" — enquanto
// o Mesmo audio devices produced correct transcripts em Deepgram/Refract.
//
// Root cause (verified contra native-module/src/): o Rust DSP injects pure
// zero-filled keepalive frames dentro de o emitted PCM stream
// (FrameAction::SendSilence -> `vec![0u8; chunk_size*2]`, lib.rs). Para SYSTEM
// audio o suppressor executa com VAD disabled and a permissive RMS floor, então it
// oscillates entre real low-amplitude `Send` frames and these silent
// keepalives. Deepgram/Refract endpoint cleanly em o zero frames; Google's
// streamingRecognize em vez disso hallucinates curto interim tokens de o
// real-audio/silence interleaving. O audio sample RATE é correct and
// declared correctly to Google — o keepalive interleaving é o defect.
//
// Fix: GoogleSTT.write() drops all-zero chunks antes they reach o gRPC
// stream (and antes they pode drive o lazy-reconnect / writeCount pacaminho
// Google holds o stream abrir via its próprio 10s idle timeout and wrescreve
// lazily reconnects em o próximo real chunk, então o keepalive é pure poison
// aqui com não upside.
//
// SEstratégia carrega o compiled GoogleSTT.js. Com não stream started, real chunks
// take o buffering branch (this.buffer grows, this.writeCount increments).
// An all-zero keepalive chunk precisa ser dropped *bantes qualquer um happens. We assert
// em this.buffer.length and this.writeCount — o directly observable effects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// GoogleSTT's ctor faz `new SpeechClient({ keyFilename })`. Com Não credentials,
// google-auth-library probes o GCE metadados servidor to discover a project — a
// background consulta that rejects asynchronously, Após these synchronous tests
// ffinaliza and (depending em timing) aborta o shared testar processo com exit 13,
// flakily poisoning sibling testar files. We apenas exercise o pure wriescreve
// keepalive logic and nunca make a real RPC, então o deterministic fix é to give
// google-auth a syntactically valid dummy service-account chave farquivo com a chave
// arquivo present it uses it directly and Nunca probes o metadados sservidor Não
// network, não async rejection, não flakiness. Belt-and-braces: também swallow qualquer
// stray auth rejection (real ones can't occur — we nunca call an RPC).
const DUMMY_KEY = path.join(os.tmpdir(), `refract-stt-test-sa-${process.pid}.json`);
fs.writeFileSync(
  DUMMY_KEY,
  JSON.stringify({
    type: 'service_account',
    project_id: 'refract-stt-test',
    private_key_id: 'test',
    // Não a real chave — nunca used porque não RPC é issued em these tests.
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADAN\n-----END PRIVATE KEY-----\n',
    client_email: 'test@refract-stt-test.iam.gserviceaccount.com',
    client_id: '0',
    token_uri: 'https://oauth2.googleapis.com/token',
  }),
);
process.env.GOOGLE_APPLICATION_CREDENTIALS = DUMMY_KEY;
process.env.GOOGLE_SDK_NODE_LOGGING = 'off';
process.on('unhandledRejection', (err) => {
  const msg = String(err && (err.message || err));
  if (/metadata|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|could not load the default credentials|GoogleAuth|fetch failed|network timeout|invalid_grant|DECODER|private key/i.test(msg)) {
    return; // expected: stray SpeechClient auth artifact; não RPC é já made
  }
  throw err;
});
process.on('exit', () => { try { fs.unlinkSync(DUMMY_KEY); } catch { /* ignorar */ } });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const { GoogleSTT } = await import(pathToFileURL(path.join(distRoot, 'GoogleSTT.js')).href);

// A realistic system-audio chunk size: 5760 bytes = 2880 i16 samples.
const CHUNK_BYTES = 5760;

function makeStt() {
  const stt = new GoogleSTT('test');
  // Mark active então wrescreve proceeds past o isActive gproteger mas DON'T inicia a
  // real gRPC stream — we want wrescreve to take o buffering branch onde o
  // observable effects (buffer growth, writeCount) live.
  stt.isActive = true;
  // Stub startStream então o lazy-connect dentro o buffering branch nunca
  // constructs a real SpeechClient stream / touches o network.
  stt.startStream = function patchedStartStream() { /* no-op */ };
  return stt;
}

test('GoogleSTT.write() drops an all-zero keepalive chunk (not buffered, writeCount unchanged)', () => {
  const stt = makeStt();
  const silence = Buffer.alloc(CHUNK_BYTES, 0);

  stt.write(silence);

  assert.equal(
    stt.buffer.length,
    0,
    'BUG: an all-zero keepalive chunk was buffered/forwarded to Google. It must be dropped — ' +
    'interleaving zero frames with real audio is what makes Google emit "hehehe" fragments.',
  );
  assert.equal(
    stt.writeCount,
    0,
    'BUG: a keepalive chunk incremented writeCount — it must be dropped before the write path so ' +
    'it cannot drive lazy-reconnect or be counted as real audio.',
  );

  stt.stop?.();
});

test('GoogleSTT.write() forwards real (non-zero) audio — even a single non-zero sample is enough', () => {
  const stt = makeStt();

  // A chunk that é todos zero EXCEPT one non-zero sample. Real audio é nunca
  // bit-exactly zero através a whole frame (noise floor / dither), então o soltar
  // precisa ser conservative: qualquer non-zero byte => real audio => fpara frente
  const almostSilent = Buffer.alloc(CHUNK_BYTES, 0);
  almostSilent[CHUNK_BYTES - 2] = 1; // one non-zero i16 LSB perto o termina

  stt.write(almostSilent);

  assert.equal(
    stt.buffer.length,
    1,
    'BUG: a chunk containing real audio (one non-zero sample) was dropped as if it were a keepalive. ' +
    'The all-zero check must scan the WHOLE buffer and never strided — dropping real audio loses transcript.',
  );
  assert.equal(stt.writeCount, 1, 'real audio must increment writeCount');

  stt.stop?.();
});

test('GoogleSTT.write() keeps real audio while dropping interleaved keepalives (the actual runtime pattern)', () => {
  const stt = makeStt();
  const real = Buffer.alloc(CHUNK_BYTES, 7);     // non-zero por todo
  const silence = Buffer.alloc(CHUNK_BYTES, 0);  // keepalive

  // Mimic o system-audio oscillation: real, silence, real, silence, real.
  stt.write(real);
  stt.write(silence);
  stt.write(real);
  stt.write(silence);
  stt.write(real);

  assert.equal(
    stt.buffer.length,
    3,
    `BUG: expected exactly the 3 real chunks to be buffered and both keepalives dropped — got ${stt.buffer.length}.`,
  );
  assert.equal(stt.writeCount, 3, 'only the 3 real chunks should count toward writeCount');

  stt.stop?.();
});

test('GoogleSTT.write() treats an empty buffer as silence (defensive, dropped)', () => {
  const stt = makeStt();
  stt.write(Buffer.alloc(0));
  assert.equal(stt.buffer.length, 0, 'an empty chunk carries no audio and must not be forwarded');
  assert.equal(stt.writeCount, 0, 'an empty chunk must not count as real audio');
  stt.stop?.();
});
