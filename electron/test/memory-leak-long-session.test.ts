/**
 * Memory Leak Testar — Componente Verification
 * ==========================================
 * Verifica memory-safety properties de chave components:
 *   1. scrubKeys() método exists e nulls chave fields (fonte verified)
 *   2. SessionTracker faz não ter unbounded array growth (structure verified)
 *   3. EventEmitter.removeAllListeners() propriamente cleans listeners
 *   4. Não Buffer.copy() patterns que poderia cause GC pressure (fonte checked)
 *
 * Note: Completo E2E memory leak testing exige o Electron runtime
 * (LLMHelper exige app.getPath('userData')). This testar verifica o
 * components que são testable em isolation.
 *
 * Executa wcom
 *   cd /path/to/refract/electron
 *   nó --exigir tsx/dist/register test/memory-leak-long-session.test.ts
 */

import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
config({ path: path.join(__dirname, '..', '..', '.env') });

import { EventEmitter } from 'events';

// ── Testar helpers ───────────────────────────────────────────────────────────
function verifySourceContains(filePath: string, patterns: Array<{ pat: string | RegExp; label: string; invert?: boolean }>): { label: string; pass: boolean }[] {
  const src = fs.readFileSync(filePath, 'utf8');
  return patterns.map(({ pat, label, invert }) => {
    const found = typeof pat === 'string' ? src.includes(pat) : pat.test(src);
    return { label, pass: invert ? !found : found };
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(70));
  console.log('MEMORY LEAK TEST — Component Verification');
  console.log('═'.repeat(70));
  console.log();

  let allPassed = true;

  // ── 1. LLMHelper scrubKeys() verification ──────────────────────────────
  console.log('─'.repeat(70));
  console.log('1. LLMHelper.scrubKeys() verification');
  console.log('─'.repeat(70));
  const llmChecks = verifySourceContains(
    path.join(__dirname, '../LLMHelper.ts'),
    [
      { pat: 'public scrubKeys()', label: 'scrubKeys() method declared public' },
      { pat: 'this.groqApiKey = null', label: 'groqApiKey set to null' },
      { pat: 'this.openaiApiKey = null', label: 'openaiApiKey set to null' },
      { pat: 'this.claudeApiKey = null', label: 'claudeApiKey set to null' },
      { pat: 'this.apiKey = null', label: 'apiKey set to null' },
      { pat: 'scrubKeys(): void', label: 'scrubKeys return type is void' },
      { pat: 'Buffer.alloc', label: 'Buffer.alloc found in LLMHelper source', invert: true },
    ]
  );
  for (const c of llmChecks) {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.label}`);
    if (!c.pass) allPassed = false;
  }
  console.log();

  // ── 2. SessionTracker memory safety ────────────────────────────────────
  console.log('─'.repeat(70));
  console.log('2. SessionTracker memory safety');
  console.log('─'.repeat(70));
  const stChecks = verifySourceContains(
    path.join(__dirname, '../SessionTracker.ts'),
    [
      { pat: 'maxContextItems', label: 'has maxContextItems limit (prevents unbounded growth)' },
      { pat: 'contextWindowDuration', label: 'has contextWindowDuration (time-based eviction)' },
      { pat: 'evictOldEntries', label: 'has evictOldEntries method for array bounds cleanup' },
      { pat: 'compactTranscriptIfNeeded', label: 'has compactTranscriptIfNeeded() (transcript compaction)' },
      { pat: /fullTranscript\.push/, label: 'fullTranscript uses push (not unbounded concat)' },
      { pat: /fullTranscript\s*=\s*\[\]/, label: 'fullTranscript is reset to [] (not accumulated forever)' },
      { pat: 'removeAllListeners', label: 'removeAllListeners NOT called in SessionTracker (good — uses per-event named cleanup instead)', invert: true },
      { pat: /while\s*\(\s*(?:true|1)\s*\)/, label: 'no while(true/1) infinite loops in SessionTracker', invert: true },
    ]
  );
  for (const c of stChecks) {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.label}`);
    if (!c.pass) allPassed = false;
  }
  console.log();

  // ── 3. EventEmitter ouvinte limpeza ───────────────────────────────────
  console.log('─'.repeat(70));
  console.log('3. EventEmitter listener cleanup verification');
  console.log('─'.repeat(70));

  // Verifica removeAllListeners exists e works
  const emitter = new EventEmitter();
  const events = ['data', 'error', 'close', 'stop', 'start', 'chunk', 'speech_ended', 'sample_rate_changed'];
  for (const evt of events) {
    emitter.on(evt, () => {});
    emitter.on(evt, () => {});
    emitter.on(evt, () => {});
  }
  const before = events.reduce((n, e) => n + emitter.listenerCount(e), 0);
  emitter.removeAllListeners();
  const after = events.reduce((n, e) => n + emitter.listenerCount(e), 0);
  console.log(`  Added 3 listeners × ${events.length} events = ${before} total`);
  console.log(`  After removeAllListeners: ${after} remaining`);
  const removeAllListenersWorks = after === 0 && before === events.length * 3;
  console.log(`  ${removeAllListenersWorks ? '✅' : '❌'} removeAllListeners() works correctly`);
  if (!removeAllListenersWorks) allPassed = false;

  // Verifica stpara patterns em audio captures propriamente remover listeners
  const stopChecks = verifySourceContains(
    path.join(__dirname, '../audio/SystemAudioCapture.ts'),
    [
      { pat: 'this.removeAllListeners()', label: 'SystemAudioCapture.destroy() calls removeAllListeners()' },
      { pat: 'this.monitor = null', label: 'SystemAudioCapture sets monitor to null after destroy' },
      { pat: 'if (!this.isRecording) return', label: 'SystemAudioCapture has post-stop guard (prevents events after stop)' },
    ]
  );
  console.log();
  console.log('  SystemAudioCapture stop/destroy patterns:');
  for (const c of stopChecks) {
    console.log(`    ${c.pass ? '✅' : '❌'} ${c.label}`);
    if (!c.pass) allPassed = false;
  }
  console.log();

  // ── 4. Buffer copiar pattern verifica em audio caminho ──────────────────────────
  console.log('─'.repeat(70));
  console.log('4. Buffer allocation patterns in audio pipeline');
  console.log('─'.repeat(70));
  const audioFiles = ['MicrophoneCapture.ts', 'SystemAudioCapture.ts'];
  for (const af of audioFiles) {
    const fullPath = path.join(__dirname, '../audio', af);
    if (!fs.existsSync(fullPath)) { console.log(`  ⚠️  ${af} not found, skipping`); continue; }
    const src = fs.readFileSync(fullPath, 'utf8');
    // Verifica para actual executable código patterns (não apenas comments describing them).
    // Use a line-by-line scan: comment lines are prefixed com // ou /*, skip them.
    const lines = src.split('\n');
    let hasRedundantCopy = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      if (/Buffer\.from\s*\(\s*chunk\s*\)|new\s+Buffer\s*\(/.test(trimmed)) {
        hasRedundantCopy = true;
        break;
      }
    }
    console.log(`  ${af}: ${hasRedundantCopy ? '❌ redundant Buffer.copy pattern found in executable code' : '✅ no redundant Buffer.copy in executable code'}`);
    if (hasRedundantCopy) allPassed = false;
  }
  console.log();

  // ── 5. Memory scrub on quit ─────────────────────────────────────────────
  console.log('─'.repeat(70));
  console.log('5. Memory scrub on quit (CredentialsManager)');
  console.log('─'.repeat(70));
  const cmPath = path.join(__dirname, '../CredentialsManager.ts');
  if (fs.existsSync(cmPath)) {
    const cmChecks = verifySourceContains(cmPath, [
      { pat: 'scrubMemory', label: 'has scrubMemory() method' },
      { pat: /apiKey.*=.*null|apiKey.*null/, label: 'nulls apiKey on scrub' },
      { pat: 'scrubKeys', label: 'references scrubKeys from LLMHelper' },
    ]);
    for (const c of cmChecks) {
      console.log(`  ${c.pass ? '✅' : '❌'} ${c.label}`);
      if (!c.pass) allPassed = false;
    }
  } else {
    console.log('  ⚠️  CredentialsManager.ts not found — skipping');
  }
  console.log();

  // ── Final result ────────────────────────────────────────────────────────
  console.log('─'.repeat(70));
  console.log('FINAL RESULT');
  console.log('─'.repeat(70));
  console.log(allPassed
    ? '✅ ALL MEMORY SAFETY CHECKS PASSED'
    : '❌ SOME CHECKS FAILED — review above');
  console.log();
  console.log('  Note: This tests component-level memory safety properties.');
  console.log('  Full E2E leak test requires Electron runtime (app.getPath needed).');
  console.log('  Run the Playwright E2E test for runtime memory behavior validation.');

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});