import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const built = (p) => path.join(root, 'dist-electron', p);
const NEED_BUILD = 'rode npm run build:electron';

/**
 * Regressão da auditoria de segurança 2026-09-11 (F-03…F-14).
 * Parte source-text (sempre roda), parte funcional via dist-electron.
 */

// ── F-05: imagePaths validados nos dois canais de chat ─────────────────────
describe('F-05 chat imagePaths', () => {
  test('gemini-chat valida antes de entregar ao LLM', () => {
    const src = read('electron/ipcHandlers.ts');
    const h = sliceSafeHandleBlock(src, 'gemini-chat');
    assert.ok(h.length > 0, 'handler gemini-chat existe');
    assert.match(h, /validateChatImagePaths\(imagePaths, 'gemini-chat'\)/);
    assert.match(h, /\.chatWithGemini\(message, validatedChatImagePaths,/);
  });

  test('gemini-chat-stream valida e reporta via gemini-stream-error', () => {
    const src = read('electron/ipcHandlers.ts');
    const h = sliceSafeHandleBlock(src, 'gemini-chat-stream');
    assert.ok(h.length > 0, 'handler gemini-chat-stream existe');
    assert.match(h, /validateChatImagePaths\(imagePaths, 'gemini-chat-stream'\)/);
    assert.match(h, /gemini-stream-error/);
  });

  test('helper valida quantidade + confinamento userData', () => {
    const src = read('electron/ipcHandlers.ts');
    assert.match(src, /MAX_CHAT_IMAGE_PATHS = 5/);
    assert.match(src, /validateImagePath\(p, userDataDir\)/);
  });
});

// ── F-06: allowlist de modelos ─────────────────────────────────────────────
describe('F-06 whisper model allowlist', () => {
  test('deleteModel exige id do catálogo + contenção', () => {
    const src = read('electron/audio/whisper/modelManager.ts');
    assert.match(src, /assertKnownModelId\(modelId\)/);
    assert.match(src, /resolveCatalogModelDir/);
    assert.match(src, /MODEL_CATALOG\.some/);
  });

  test('start-download valida o id antes de baixar', () => {
    const src = read('electron/ipcHandlers.ts');
    const h = sliceSafeHandleBlock(src, 'local-whisper-start-download');
    assert.ok(h.length > 0, 'handler local-whisper-start-download existe');
    assert.match(h, /assertKnownModelId\(modelId\)/);
  });

  test('assertKnownModelId funcional', async () => {
    const f = built('electron/audio/whisper/modelManager.js');
    if (!fs.existsSync(f)) return;
    const { assertKnownModelId } = await import(pathToFileURL(f).href);
    assert.doesNotThrow(() => assertKnownModelId('Xenova/whisper-tiny.en'));
    for (const evil of ['../../userData', '..\\..\\x', '', null, 42, 'Xenova/whisper-tiny.en '] ) {
      assert.throws(() => assertKnownModelId(evil), /Unknown model id/);
    }
  });
});

// ── F-08: confinamento do repo scan ────────────────────────────────────────
describe('F-08 repo scan confinado', () => {
  test('handlers validam o path antes de indexar', () => {
    const src = read('electron/ipcHandlers.ts');
    assert.match(src, /validateRepoPath\(repoPath\)/);
    const idx = read('electron/repo-indexer/RepoIndexer.ts');
    assert.match(idx, /REPO_SCAN_MAX_FILES/);
    assert.match(idx, /isSymbolicLink/);
  });

  test('validateRepoPath funcional', async () => {
    const f = built('electron/repo-indexer/repoPathPolicy.js');
    if (!fs.existsSync(f)) return;
    const { validateRepoPath } = await import(pathToFileURL(f).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-policy-'));
    try {
      assert.equal(validateRepoPath(tmp), fs.realpathSync(tmp));
      for (const evil of ['', 'relativo/x', null, 7, os.homedir(), path.parse(tmp).root,
                          path.join(tmp, 'nao-existe'), path.join(__dirname, 'AuditFixesSep2026.test.mjs')]) {
        assert.throws(() => validateRepoPath(evil), /Invalid|must be|does not exist|too broad|protected/,
          JSON.stringify(evil));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── F-09: OAuth com state/PKCE ─────────────────────────────────────────────
describe('F-09 calendar OAuth', () => {
  test('fluxo usa state + PKCE + bind de loopback', () => {
    const src = read('electron/services/CalendarManager.ts');
    assert.match(src, /randomBytes\(32\)\.toString\('hex'\)/);
    assert.match(src, /code_challenge/);
    assert.match(src, /code_challenge_method.*S256/);
    assert.match(src, /timingSafeEqual/);
    assert.match(src, /state mismatch/);
    assert.match(src, /listen\(11111, '127\.0\.0\.1'/);
    assert.match(src, /isLoopback/);
    assert.match(src, /code_verifier/);
  });
});

// ── F-10: remetente IPC ────────────────────────────────────────────────────
describe('F-10 sender IPC', () => {
  test('safeHandle/safeOn rejeitam remetente fora do app', () => {
    const src = read('electron/ipcHandlers.ts');
    assert.match(src, /assertAppSender\(event, channel\)/);
    assert.match(src, /fromWebContents/);
    assert.match(src, /forbidden sender/);
  });

  test('delete-meeting valida o id', () => {
    const src = read('electron/ipcHandlers.ts');
    const h = sliceSafeHandleBlock(src, 'delete-meeting');
    assert.ok(h.length > 0, 'handler delete-meeting existe');
    assert.match(h, /Invalid meeting id/);
  });
});

// ── F-14: gate do RoleTwin ─────────────────────────────────────────────────
describe('F-14 RoleTwin trial', () => {
  test('researchCompany usa gate pro-ou-trial', () => {
    const src = read('electron/services/RoleTwinManager.ts');
    assert.match(src, /isProOrTrialActive\(\)/);
    assert.ok(!/getInstance\(\)\.isPremium\(\)\) return null/.test(src),
      'gate premium puro não deve restar no researchCompany');
  });
});

// ── F-03 extra: AgentManager open_file sem shell ───────────────────────────
describe('AgentManager open_file', () => {
  test('usa shell.openPath, sem interpolação', () => {
    const src = read('electron/services/AgentManager.ts');
    assert.match(src, /shell\.openPath\(action\.path\)/);
    assert.ok(!/openCmd/.test(src), 'variável openCmd removida');
  });
});
