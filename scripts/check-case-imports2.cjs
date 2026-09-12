// Strict case-sensitive import resolver check (simulates Linux on Windows).
const fs = require('fs');
const path = require('path');

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'dist-electron', 'release'].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function existsExact(p) {
  const parts = path.resolve(p).split(path.sep);
  let cur = parts[0] + path.sep;
  for (let i = 1; i < parts.length; i++) {
    let entries;
    try { entries = fs.readdirSync(cur); } catch { return false; }
    if (!entries.includes(parts[i])) return false;
    cur = path.join(cur, parts[i]);
  }
  try { return fs.statSync(cur).isFile(); } catch { return false; }
}

function existsLoose(p) {
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
  for (const e of exts) { try { if (fs.statSync(p + e).isFile()) return true; } catch {} }
  for (const e of ['/index.ts', '/index.tsx', '/index.js', '/index.mjs']) {
    try { if (fs.statSync(p + e).isFile()) return true; } catch {}
  }
  return false;
}

const files = walk('electron').concat(walk('src'));
const re = /(?:import|export)\s[^;]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]|require\(\s*['"](\.[^'"]+)['"]/g;
const broken = [];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  let m; re.lastIndex = 0;
  const seen = new Set();
  while ((m = re.exec(s))) {
    const spec = m[1] || m[2] || m[3];
    if (seen.has(spec)) continue;
    seen.add(spec);
    if (spec.includes('*') || spec.includes('!')) continue;
    const base = path.resolve(path.dirname(f), spec);
    const cands = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
      '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.cjs'];
    const strictOk = cands.some(c => existsExact(base + c));
    if (!strictOk && existsLoose(base)) broken.push(f + ' :: ' + spec);
  }
}
console.log('files scanned:', files.length);
console.log('TRUE CASE FAILURES (work on Windows, break on Linux):');
console.log(broken.join('\n') || '(none)');
