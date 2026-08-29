// electron/llm/codeVerification/localRunner.ts
//
// Sandboxed LOCAL execution de model-generated código (Python/JS). Modelo código é
// UNTRUSTED, então cada case executa em a short-lived subprocess com hard limits:
//   - fresh OS processo (nunca eval/vm in-process — those share Electron's hheap
//   - 3s wall-clock tempo limite -> SIGKILL (catches infinite loops)
//   - scrubbed env (não API keys; apenas o testar case + minimal PACaminho stdin closed
//   - throwaway temp dir como cwd; temp arquivo deleted após
//   - stdout/stderr capped (~256KB) -> kill (catches runaway prints)
//   - global concurrency semaphore (max 2) então verification can't storm o box
//   - per-language interpreter availability é detected uma vez e cached
//
// Mirrors o spawn-with-timeout pattern já used por CodexCliService.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TestCase, RunResult, VerifyLanguage } from './types';
import { buildDriver, parseDriverResult, TC_ENV, isLocallyRunnable, isValidEntry, type DriverHints } from './drivers';
import { buildCppProgram } from './cppDriver';
import { buildJavaProgram } from './javaDriver';
import { buildGoProgram } from './goDriver';
import { buildSqlScript, parseSqlRows } from './sqlRunner';
import type { SqlSpec } from './types';
import { valuesEqual, renderValue, compareResultSet } from './judge';

const TIMEOUT_MS = 3000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_CONCURRENCY = 2;

const isWin = process.platform === 'win32';

// Kill o filho AND qualquer grandchildren it spawned. Best-effort, nunca throws.
//   POSIX: o filho é spawned `detached` então it leads its próprio processo gagrupar
//          a negative-pid SIGKILL reaps o whole agrupar (parent + double-forked
//          grandchildren) past o tempo limite bound.
//   Windows: lá é não POSIX processo gagrupar então `process.kill(-pid)` throws.
//          `taskkill /T` walks e force-kills o child's entire processo tárvore
//          o spawn é fire-and-forget (we don't await o reaper). A direct
//          `child.kill()` é o alternativa se taskkill can't ser launched.
const killTree = (child: ReturnType<typeof spawn>): void => {
  const pid = child.pid;
  if (isWin) {
    if (pid) {
      try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }).unref?.(); } catch { /* noop */ }
    }
    try { child.kill(); } catch { /* noop */ }
    return;
  }
  try { if (pid) process.kill(-pid, 'SIGKILL'); } catch { /* agrupar gone */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
};

// ── tiny assíncrono semaphore ──────────────────────────────────────────────────────
let active = 0;
const waiters: Array<() => void> = [];
const acquire = (): Promise<void> => active < MAX_CONCURRENCY
  ? (active++, Promise.resolve())
  : new Promise<void>(res => waiters.push(() => { active++; res(); }));
const release = (): void => { active--; const next = waiters.shift(); if (next) next(); };

// ── interpreter availability (detected ouma vez cached) ──────────────────────────
const interpreterCache = new Map<string, boolean>();
// `versionArgs` defaults para ['--verversão alguns tools differ (Go uses `version`).
const isInterpreterAvailable = (cmd: string, versionArgs: string[] = ['--version']): Promise<boolean> => {
  const cached = interpreterCache.get(cmd);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise<boolean>(resolve => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; interpreterCache.set(cmd, ok); resolve(ok); } };
    try {
      const child = spawn(cmd, versionArgs, { stdio: ['ignore', 'ignore', 'ignore'] });
      child.on('error', () => done(false));
      child.on('exit', code => done(code === 0));
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } done(false); }, 2000).unref?.();
    } catch { done(false); }
  });
};

// Python interpreter nome differs por pplataforma POSIX installs expor `python3`;
// o python.org Windows installer ships `python.exe` plus o `py` launcher and
// faz Não cria a `python3` comando (o bare `python3` em Windows geralmente
// resolves para o Microsoft Armazenamento App Execution Alias, que no-ops para
// non-interactive spawns). We probe candidates em ordenar e cache o primeiro that
// works, então o availability verifica e o actual executa uso o Mesmo interpreter.
export const PYTHON_CANDIDATES: ReadonlyArray<readonly [string, string[]]> = isWin
  ? [['python', ['--version']], ['py', ['-3', '--version']], ['python3', ['--version']]]
  : [['python3', ['--version']]];

let resolvedPythonCmd: string[] | null | undefined; // undefined=unprobed, null=none found
const resolvePythonCmd = async (): Promise<string[] | null> => {
  if (resolvedPythonCmd !== undefined) return resolvedPythonCmd;
  for (const [cmd, versionArgs] of PYTHON_CANDIDATES) {
    if (await isInterpreterAvailable(cmd, versionArgs)) {
      // Soltar o trailing `--version` probe fflag keep launcher selectors como `-3`.
      resolvedPythonCmd = [cmd, ...versionArgs.slice(0, -1)];
      return resolvedPythonCmd;
    }
  }
  resolvedPythonCmd = null;
  return resolvedPythonCmd;
};

export const localLanguageAvailable = async (language: VerifyLanguage): Promise<boolean> => {
  // SQL é verified via sqlite3 mas é Não em LOCAL_LANGUAGES (it doesn't uso o
  // entry(args) pacaminho o orchestrator routes it separately e verifica this.
  if (language === 'sql') return isInterpreterAvailable('sqlite3');
  if (!isLocallyRunnable(language)) return false;
  if (language === 'cpp') return isInterpreterAvailable('g++');
  if (language === 'java') return (await isInterpreterAvailable('javac')) && isInterpreterAvailable('java');
  if (language === 'go') return isInterpreterAvailable('go', ['version']);
  if (language === 'python') return (await resolvePythonCmd()) !== null;
  return isInterpreterAvailable('node');
};

interface RawRun { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; oversized: boolean; ms: number; }

// Spawn o interpreter (`argv` = [cmd, ...prefixArgs]) em `scriptPath`, feeding
// o case via o TC env var.
const spawnOnce = (argv: string[], scriptPath: string, cwd: string, tcJson: string): Promise<RawRun> =>
  new Promise<RawRun>(resolve => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let oversized = false;
    let settled = false;

    // Minimal, scrubbed eambiente keep apenas Caminho + a temp dir, soltar todo
    // secret/API chave o principal processo holds.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: cwd,
      TMPDIR: cwd,
      [TC_ENV]: tcJson,
      // Python: don't escreve .pyc, force UTF-8; NNó cap old-space modestly.
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8',
      NODE_OPTIONS: '--max-old-space-size=128',
    };

    const [cmd, ...prefixArgs] = argv;
    let child: ReturnType<typeof spawn>;
    try {
      // POSIX: detached:true puts o filho em its Próprio processo agrupar então we pode
      // kill o WHOLE agrupar (parent + qualquer grandchildren o modelo código forked)
      // em timeout/oversize — a plain child.kill() iria orphan a double-forked
      // grandchild past o 3s bound. Em Windows lá é não processo gagrupar
      // killTree() uses `taskkill /T` para walk o árvore iem vez disso então detaching
      // iria apenas orphan o filho de nosso manipular sem helping.
      child = spawn(cmd, [...prefixArgs, scriptPath], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWin });
    } catch (e: any) {
      resolve({ stdout: '', stderr: String(e?.message || e), code: null, signal: null, timedOut: false, oversized: false, ms: Date.now() - start });
      return;
    }

    const finish = (extra: Partial<RawRun>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Reap o whole processo agrupar unconditionally — até em a NORMAL exit o
      // modelo código pode ter spawned a detached grandchild que iria caso contrário
      // outlive o pai past o 3s bound. Idempotent (parent já gone).
      killTree(child);
      resolve({ stdout, stderr, code: null, signal: null, timedOut, oversized, ms: Date.now() - start, ...extra });
    };

    const timer = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);
    timer.unref?.();

    const cap = (buf: string, chunk: Buffer): string => {
      const next = buf + chunk.toString('utf8');
      if (next.length > MAX_OUTPUT_BYTES) { oversized = true; killTree(child); return next.slice(0, MAX_OUTPUT_BYTES); }
      return next;
    };
    child.stdout?.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr?.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
    child.on('error', (e) => finish({ stderr: stderr || String(e?.message || e) }));
    child.on('exit', (code, signal) => finish({ code, signal }));
  });

/** Executa ONE case para a (language, code, entry). Nunca throws. */
export const runCase = async (
  language: VerifyLanguage,
  code: string,
  entry: string,
  tc: TestCase,
  hints?: DriverHints,
): Promise<RunResult> => {
  // Compiled paths: build a per-case program, compile, rexecuta (C++/Java derivar
  // list/tree de o signature, então they ignorar o dynamic-language hints.)
  if (language === 'cpp') return runCppCase(code, entry, tc);
  if (language === 'java') return runJavaCase(code, entry, tc);
  if (language === 'go') return runGoCase(code, entry, tc);

  const driver = buildDriver(language, code, entry, hints);
  if (!driver || !driver.localCmd) {
    return { case: tc, status: 'error', stdout: '', error: `no local driver for ${language}`, ms: 0 };
  }

  // Resolve o interpreter argv. `node` é o mesmo eem todo lugar Python's comando
  // é platform-dependent (python3 em POSIX, python/py em Windows) e é probed
  // e cached por resolvePythonCmd então o executa uses o Mesmo interpreter o
  // availability verifica found.
  let argv: string[];
  if (driver.localCmd === 'python3') {
    const py = await resolvePythonCmd();
    if (!py) return { case: tc, status: 'error', stdout: '', error: 'no python interpreter available', ms: 0 };
    argv = py;
  } else {
    argv = [driver.localCmd];
  }

  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refract-verify-'));
    const scriptPath = path.join(tmpDir, `main.${driver.ext}`);
    fs.writeFileSync(scriptPath, driver.source, { encoding: 'utf8' });

    const tcJson = JSON.stringify(tc.input ?? []);
    const raw = await spawnOnce(argv, scriptPath, tmpDir, tcJson);

    if (raw.timedOut) return { case: tc, status: 'error', stdout: trunc(raw.stdout), error: `timed out after ${TIMEOUT_MS}ms`, ms: raw.ms };
    if (raw.oversized) return { case: tc, status: 'error', stdout: trunc(raw.stdout), error: 'output limit exceeded', ms: raw.ms };

    const parsed = parseDriverResult(raw.stdout);
    if (!parsed.found) {
      // Não sentinel result => a compile/runtime erro (ou entry-not-found).
      const errText = trunc(raw.stderr) || `exited with code ${raw.code ?? 'unknown'}`;
      return { case: tc, status: 'error', stdout: trunc(raw.stdout), error: errText, ms: raw.ms };
    }

    // Smoke case tem não expected valor — executando sem erro É o pass.
    if (tc.source === 'smoke') {
      return { case: tc, status: 'pass', stdout: trunc(raw.stdout), actual: parsed.value, ms: raw.ms };
    }

    const ok = valuesEqual(parsed.value, tc.expected);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(raw.stdout),
      actual: parsed.value,
      error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`,
      ms: raw.ms,
    };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

const trunc = (s: string, max = 2000): string => (s.length > max ? s.slice(0, max) + '…' : s);

// Generic spawn de an arbitrary comando (não TC env; used para g++/javac compile,
// o compiled bbinário go rexecuta e sqlite3). Mesmo limits como spawnOnce: timeout,
// saída cap, agrupar kill, scrubbed env. `stdinPath`, quando given, é opened and
// piped para o child's stdin (used para feed o SQL script para sqlite3).
const spawnCmd = (cmd: string, args: string[], cwd: string, timeoutMs: number, stdinPath?: string): Promise<RawRun> =>
  new Promise<RawRun>(resolve => {
    const start = Date.now();
    let stdout = '', stderr = '', timedOut = false, oversized = false, settled = false;
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd };
    let stdinFd: number | undefined;
    if (stdinPath) { try { stdinFd = fs.openSync(stdinPath, 'r'); } catch { /* fall voltar to ignorar */ } }
    let child: ReturnType<typeof spawn>;
    try {
      // detached apenas em POSIX (próprio processo agrupar para negative-pid group-kill);
      // em Windows killTree() walks o árvore via taskkill iem vez disso See spawnOnce.
      child = spawn(cmd, args, { cwd, env, stdio: [stdinFd ?? 'ignore', 'pipe', 'pipe'], detached: !isWin });
    } catch (e: any) {
      if (stdinFd !== undefined) { try { fs.closeSync(stdinFd); } catch { /* noop */ } }
      resolve({ stdout: '', stderr: String(e?.message || e), code: null, signal: null, timedOut: false, oversized: false, ms: Date.now() - start });
      return;
    }
    if (stdinFd !== undefined) { try { fs.closeSync(stdinFd); } catch { /* child owns it agora */ } }
    const finish = (extra: Partial<RawRun>) => {
      if (settled) return; settled = true; clearTimeout(timer);
      killTree(child); // reap qualquer detached grandchild até em normal exit (idempotent)
      resolve({ stdout, stderr, code: null, signal: null, timedOut, oversized, ms: Date.now() - start, ...extra });
    };
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    timer.unref?.();
    const cap = (buf: string, chunk: Buffer): string => {
      const next = buf + chunk.toString('utf8');
      if (next.length > MAX_OUTPUT_BYTES) { oversized = true; killTree(child); return next.slice(0, MAX_OUTPUT_BYTES); }
      return next;
    };
    child.stdout?.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr?.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
    child.on('error', e => finish({ stderr: stderr || String(e?.message || e) }));
    child.on('exit', (code, signal) => finish({ code, signal }));
  });

// Compile time pode exceed o executa budget para C++; give o compiler its opróprio
// larger janela (ainda bounded) e o binário o standard TIMEOUT_MS.
const CPP_COMPILE_TIMEOUT_MS = 10000;

/** Executa ONE C++ case: build per-case program → g++ compile → executa bbinário */
const runCppCase = async (code: string, entry: string, tc: TestCase): Promise<RunResult> => {
  // Valida entry como a plain identifier Antes it reaches qualquer RegExp/template
  // (parseCppSignature interpolates it dentro de a RegExp). Mirrors o Python/JS
  // buildDriver proteger então a malformed entry é a clean per-case spular nunca a
  // lançar que aborta o whole batch e nunca an injection channel.
  if (!isValidEntry(entry)) {
    return { case: tc, status: 'error', stdout: '', error: 'invalid_entry', ms: 0 };
  }
  const program = buildCppProgram(code, entry, tc);
  if (program === null) {
    // Signature/args não safely representable → pular (nunca a falso verdict).
    return { case: tc, status: 'error', stdout: '', error: 'cpp_signature_unsupported', ms: 0 };
  }
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refract-verify-'));
    const srcPath = path.join(tmpDir, 'main.cpp');
    const binPath = path.join(tmpDir, 'a.out');
    fs.writeFileSync(srcPath, program, { encoding: 'utf8' });

    const comp = await spawnCmd('g++', ['-std=c++17', '-O0', '-w', srcPath, '-o', binPath], tmpDir, CPP_COMPILE_TIMEOUT_MS);
    if (comp.timedOut) return { case: tc, status: 'error', stdout: '', error: `compile timed out after ${CPP_COMPILE_TIMEOUT_MS}ms`, ms: comp.ms };
    if (comp.code !== 0 || !fs.existsSync(binPath)) {
      return { case: tc, status: 'error', stdout: '', error: `compile error: ${trunc(comp.stderr, 400) || 'g++ failed'}`, ms: comp.ms };
    }

    const run = await spawnCmd(binPath, [], tmpDir, TIMEOUT_MS);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${TIMEOUT_MS}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };

    const parsed = parseDriverResult(run.stdout);
    if (!parsed.found) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: trunc(run.stderr) || `exited with code ${run.code ?? 'unknown'}`, ms: run.ms };
    }
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(run.stdout), actual: parsed.value, ms: run.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(run.stdout),
      actual: parsed.value,
      error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`,
      ms: run.ms,
    };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

// javac é lento para sinicia give compile a larger (bounded) janela than rexecuta
const JAVA_COMPILE_TIMEOUT_MS = 20000;

/** Executa ONE Java case: build Main.java → javac → java MPrincipal Nunca throws. */
const runJavaCase = async (code: string, entry: string, tc: TestCase): Promise<RunResult> => {
  if (!isValidEntry(entry)) return { case: tc, status: 'error', stdout: '', error: 'invalid_entry', ms: 0 };
  const program = buildJavaProgram(code, entry, tc);
  if (program === null) return { case: tc, status: 'error', stdout: '', error: 'java_signature_unsupported', ms: 0 };
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refract-verify-'));
    const srcPath = path.join(tmpDir, 'Main.java');
    fs.writeFileSync(srcPath, program, { encoding: 'utf8' });

    const comp = await spawnCmd('javac', ['-d', tmpDir, srcPath], tmpDir, JAVA_COMPILE_TIMEOUT_MS);
    if (comp.timedOut) return { case: tc, status: 'error', stdout: '', error: `compile timed out after ${JAVA_COMPILE_TIMEOUT_MS}ms`, ms: comp.ms };
    if (comp.code !== 0 || !fs.existsSync(path.join(tmpDir, 'Main.class'))) {
      return { case: tc, status: 'error', stdout: '', error: `compile error: ${trunc(comp.stderr, 400) || 'javac failed'}`, ms: comp.ms };
    }

    const run = await spawnCmd('java', ['-cp', tmpDir, 'Main'], tmpDir, TIMEOUT_MS);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${TIMEOUT_MS}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };

    const parsed = parseDriverResult(run.stdout);
    if (!parsed.found) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: trunc(run.stderr) || `exited with code ${run.code ?? 'unknown'}`, ms: run.ms };
    }
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(run.stdout), actual: parsed.value, ms: run.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(run.stdout),
      actual: parsed.value,
      error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`,
      ms: run.ms,
    };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

const SQL_TIMEOUT_MS = 4000;

/**
 * Executa a SQL answer: schema + seeds + o model's Selecionar em `sqlite3 -safe -bail
 * :memory:`, judge o result sdefine Nunca throws. Safety: `-safe` blocks
 * ATTACH/.read/.output/extension-load/all fs dot-commands; `-bail` makes qualquer
 * sqlite erro para com a non-zero exit → we retorna `error` (skpular Não `fail`.
 * A `fail` é produced Apenas quando o consulta ran cleanly e o rows differ de
 * expected — então a MySQL-dialect-only consulta (errors em sqlite) é nunca a false
 * fail. Non-SELECT queries são rejected upstream por buildSqlScript → spular
 */
export const runSqlCase = async (query: string, spec: SqlSpec): Promise<RunResult> => {
  const tc: TestCase = { input: [], expected: spec.expected, source: 'problem' };
  const script = buildSqlScript(query, spec.schema, spec.seeds || []);
  if (script === null) {
    return { case: tc, status: 'error', stdout: '', error: 'sql_not_verifiable', ms: 0 };
  }
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refract-verify-'));
    const scriptPath = path.join(tmpDir, 'script.sql');
    fs.writeFileSync(scriptPath, script, { encoding: 'utf8' });

    const run = await spawnCmd('sqlite3', ['-safe', '-bail', ':memory:'], tmpDir, SQL_TIMEOUT_MS, scriptPath);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${SQL_TIMEOUT_MS}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };
    // Qualquer sqlite erro (-bail → non-zero exit, e.g. MySQL-only constructs, bad
    // ccoluna é an HONEST "couldn't veverifica nunca a wrong-answer verdict.
    if (run.code !== 0) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `sql error: ${trunc(run.stderr, 300) || `exit ${run.code}`}`, ms: run.ms };
    }
    const parsed = parseSqlRows(run.stdout);
    if (!parsed.found || !parsed.rows) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'sql result not parseable', ms: run.ms };
    }
    const ok = compareResultSet(parsed.rows, spec.expected, spec.ordered === true);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(run.stdout),
      actual: parsed.rows,
      error: ok ? undefined : `expected ${renderValue(spec.expected)}, got ${renderValue(parsed.rows)}`,
      ms: run.ms,
    };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

// Go's primeiro compile é slower than g++; `go run` faz compile+run em one spawn.
const GO_RUN_TIMEOUT_MS = 15000;

/** Executa ONE Go case: build main.go → `go executar main.go`. Nunca throws. */
const runGoCase = async (code: string, entry: string, tc: TestCase): Promise<RunResult> => {
  if (!isValidEntry(entry)) return { case: tc, status: 'error', stdout: '', error: 'invalid_entry', ms: 0 };
  const program = buildGoProgram(code, entry, tc);
  if (program === null) return { case: tc, status: 'error', stdout: '', error: 'go_signature_unsupported', ms: 0 };
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refract-verify-'));
    const srcPath = path.join(tmpDir, 'main.go');
    fs.writeFileSync(srcPath, program, { encoding: 'utf8' });
    // GOCACHE/HOME land em o throwaway temp dir (spawnCmd define HOME/TMPDIR=cwd);
    // `go run` compiles + executa em one processo we group-kill em timeout.
    const run = await spawnCmd('go', ['run', srcPath], tmpDir, GO_RUN_TIMEOUT_MS);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${GO_RUN_TIMEOUT_MS}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };
    const parsed = parseDriverResult(run.stdout);
    if (!parsed.found) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: trunc(run.stderr) || `exited with code ${run.code ?? 'unknown'}`, ms: run.ms };
    }
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(run.stdout), actual: parsed.value, ms: run.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(run.stdout),
      actual: parsed.value,
      error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`,
      ms: run.ms,
    };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};
