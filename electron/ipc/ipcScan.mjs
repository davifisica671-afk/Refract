/**
 * ipcScan.mjs — shared IPC surface scanner.
 *
 * Extracts the live IPC channel usage from the Electron sources so that both
 * scripts/gen-ipc-registry.mjs (generator) and
 * electron/services/__tests__/IpcChannelRegistry.test.mjs (drift test) agree on
 * what "reality" is. Keeping the extraction in one place means the generator
 * and the test can never drift apart over a regex tweak.
 *
 * Channels are collected from:
 *   - electron/preload.ts            (renderer side: invoke / send / on)
 *   - every other electron/**\/*.ts|.mjs (main side: handle / on / send)
 *
 * Comments are stripped before scanning so example code in doc blocks
 * (e.g. ipcMain.handle('canal', handler)) is never mistaken for a real channel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const CHANNEL = '[a-zA-Z0-9:./_-]+';

/** Strip // line comments and block comments while respecting string literals. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (ch === quote) {
          out += ch;
          i += 1;
          break;
        }
        out += ch;
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Collect unique channel names matched by a global regex over one source string. */
export function collect(src, re) {
  const set = new Set();
  let m;
  while ((m = re.exec(src)) !== null) set.add(m[1]);
  return set;
}

/** List every electron TS/MJS source file (excluding tests, dist, node_modules). */
export function listElectronFiles() {
  const out = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (['node_modules', '__tests__', 'dist', 'dist-electron'].includes(entry.name)) continue;
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|mjs)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(root, 'electron'));
  return out.sort();
}

/** Scan the whole electron surface and return the channel inventory. */
export function scanIpcSurface() {
  const preloadSrc = stripComments(fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8'));

  const preloadInvoke = collect(preloadSrc, new RegExp(`ipcRenderer\\.invoke\\(\\s*['"](${CHANNEL})['"]`, 'g'));
  const preloadSend = collect(preloadSrc, new RegExp(`ipcRenderer\\.send\\(\\s*['"](${CHANNEL})['"]`, 'g'));
  const preloadOn = collect(preloadSrc, new RegExp(`ipcRenderer\\.(?:on|once)\\(\\s*['"](${CHANNEL})['"]`, 'g'));

  const mainHandle = new Map();
  const mainOn = new Map();
  const mainSend = new Map();

  const handleRe = new RegExp(
    `(?:safeHandle|ipcMain\\.handle|registerStealthHandler)\\s*\\(\\s*['"](${CHANNEL})['"]`,
    'g',
  );
  const onRe = new RegExp(`(?:safeOn|ipcMain\\.on)\\s*\\(\\s*['"](${CHANNEL})['"]`, 'g');
  const sendRe = new RegExp(`\\.send\\(\\s*['"](${CHANNEL})['"]`, 'g');

  for (const file of listElectronFiles()) {
    if (path.basename(file) === 'preload.ts') continue; // renderer side, scanned above
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const src = stripComments(fs.readFileSync(file, 'utf8'));

    for (const ch of collect(src, handleRe)) {
      if (!mainHandle.has(ch)) mainHandle.set(ch, []);
      mainHandle.get(ch).push(rel);
    }
    for (const ch of collect(src, onRe)) {
      if (!mainOn.has(ch)) mainOn.set(ch, []);
      mainOn.get(ch).push(rel);
    }
    for (const ch of collect(src, sendRe)) {
      if (!mainSend.has(ch)) mainSend.set(ch, []);
      mainSend.get(ch).push(rel);
    }
  }

  return { preloadInvoke, preloadSend, preloadOn, mainHandle, mainOn, mainSend };
}

/**
 * Build the core registry records from a scan. This is the single definition
 * of "what the committed registry must contain" — both the generator and the
 * drift test use it, so they can never disagree. `category` is intentionally
 * not part of these records (it is informational metadata added only by the
 * generator).
 */
export function buildRegistryRecords(surface) {
  const { preloadInvoke, preloadSend, preloadOn, mainHandle, mainOn, mainSend } = surface;
  const records = [];
  const seen = new Set();

  const add = (name, kind, handlers, senders, orphan = false) => {
    if (seen.has(`${kind}:${name}`)) return;
    seen.add(`${kind}:${name}`);
    const rec = { name, kind, handlers: [...handlers].sort(), senders: [...senders].sort() };
    if (orphan) rec.orphan = true;
    records.push(rec);
  };

  for (const ch of [...preloadInvoke].sort()) add(ch, 'invoke', mainHandle.get(ch) ?? [], []);
  for (const ch of [...preloadSend].sort()) add(ch, 'send', mainOn.get(ch) ?? [], []);
  for (const ch of [...preloadOn].sort()) add(ch, 'event', [], mainSend.get(ch) ?? []);

  // Orphan registrations (main-side only, no renderer caller) — catalogued, not asserted.
  for (const [ch, files] of mainHandle) {
    if (!preloadInvoke.has(ch)) add(ch, 'invoke', files, [], true);
  }
  for (const [ch, files] of mainOn) {
    if (!preloadSend.has(ch)) add(ch, 'send', files, [], true);
  }

  records.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)));
  return records;
}
