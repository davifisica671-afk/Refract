import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// CJS style (like scripts/download-models.js): plain require() of node
// builtins only — ZERO new dependencies.
const require = createRequire(import.meta.url);
const path = require('path');
const fs = require('fs');
const https = require('https');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pinned engine version. Keep in sync with the size sanity table below.
const VERSION = '10.0.2';

const MIRRORS = [`https://unpkg.com/stockfish.js@${VERSION}`, `https://cdn.jsdelivr.net/npm/stockfish.js@${VERSION}`];

// NOTE: stockfish.js@10.0.2 also ships Copying.txt (GPL-3.0). We deliberately
// do NOT download it: the engine is an OPTIONAL user-side download, never
// bundled or committed, so no copyleft text needs to (or may) ship with the
// proprietary installer. Fetching only the 3 runtime files keeps the app
// bundle free of GPL-licensed content.
const FILES = [
  // name, expected size in bytes (from the published 10.0.2 package)
  { name: 'stockfish.wasm.js', expectedSize: 96597 },
  { name: 'stockfish.js', expectedSize: 1579948 },
  { name: 'stockfish.wasm', expectedSize: 558861 },
];

const SIZE_TOLERANCE = 0.05; // ±5% — warn-only on mismatch

function plausibleSize(file, size) {
  const expected = file.expectedSize;
  return size >= expected * (1 - SIZE_TOLERANCE) && size <= expected * (1 + SIZE_TOLERANCE);
}

function fetchToFile(url, destPath, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        fetchToFile(next, destPath, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch (e) { void e; }
        reject(err);
      });
      res.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch (e) { void e; }
        reject(err);
      });
    });
    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy(new Error(`timeout fetching ${url}`));
    });
  });
}

async function downloadStockfish() {
  const engineDir = path.join(__dirname, '..', 'resources', 'engine');

  try {
    if (!fs.existsSync(engineDir)) {
      fs.mkdirSync(engineDir, { recursive: true });
    }

    // Skip the download when all 3 files are already present with plausible sizes.
    const allPresent = FILES.every((file) => {
      try {
        const stat = fs.statSync(path.join(engineDir, file.name));
        return stat.isFile() && plausibleSize(file, stat.size);
      } catch (e) {
        void e;
        return false;
      }
    });
    if (allPresent) {
      console.log('[download-stockfish] Engine already present, skipping download.');
      return;
    }

    for (const file of FILES) {
      const dest = path.join(engineDir, file.name);
      let downloaded = false;
      let lastError = null;
      for (const base of MIRRORS) {
        const url = `${base}/${file.name}`;
        console.log(`[download-stockfish] Downloading ${url}...`);
        try {
          await fetchToFile(url, dest, 3);
        } catch (e) {
          console.log(`[download-stockfish] WARN mirror failed for ${file.name} via ${base}: ${e && e.message ? e.message : e}; trying next mirror`);
          lastError = e;
          continue;
        }
        let size = 0;
        try {
          size = fs.statSync(dest).size;
        } catch (e) {
          void e;
        }
        if (!plausibleSize(file, size)) {
          console.log(`[download-stockfish] WARN size mismatch for ${file.name}: got ${size} bytes, expected ~${file.expectedSize} bytes; continuing without guarantees`);
        } else {
          console.log(`[download-stockfish] ${file.name} downloaded (${size} bytes).`);
        }
        downloaded = true;
        break;
      }
      if (!downloaded) {
        throw lastError || new Error(`all mirrors failed for ${file.name}`);
      }
    }

    console.log('[download-stockfish] Stockfish engine downloaded successfully!');
  } catch (e) {
    // BEST-EFFORT contract: offline installs must not break. Log and exit 0 ALWAYS.
    console.log(`[download-stockfish] WARN ${e && e.message ? e.message : e}; continuing without engine`);
  }
}

downloadStockfish().then(
  () => process.exit(0),
  (e) => {
    console.log(`[download-stockfish] WARN ${e && e.message ? e.message : e}; continuing without engine`);
    process.exit(0);
  },
);
