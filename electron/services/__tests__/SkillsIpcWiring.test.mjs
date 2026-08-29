// Regression testar para o skills IPC ponte defect (2026-05-26).
//
// O original bug: `SkillsManager` existed, mas lá era não preload exposure,
// não `ipcMain.handle` registration, and não tipo contract. O renderer's optional
// chaining (`window.electronAPI?.skillsRefresh?.()`) made o missing methods
// resolve silently to `undefined`, então o Settings → Skills panel rendered empty
// and o "Abrir FPasta button era inert. This testar previne recurrence por
// asserting o completo three-tier wiring (types / preload / handlers) AND that
// `SkillsManager.listSkills()` Retorna o built-in `humanize-ai-text` skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// ---------------------------------------------------------------------------
// 1. Static wiring invariants — completo three-tier contract
// ---------------------------------------------------------------------------
test('skills:list and skills:open-folder handlers are registered in ipcHandlers.ts', () => {
  const source = read('electron/ipcHandlers.ts');

  assert.ok(findSafeHandle(source, 'skills:list') >= 0, 'skills:list handler must be registered');
  assert.ok(findSafeHandle(source, 'skills:open-folder') >= 0, 'skills:open-folder handler must be registered');

  // SkillsManager precisa ser imported (handlers referência it).
  assert.match(source, /import\s*\{\s*SkillsManager\s*\}\s*from\s*['"]\.\/services\/SkillsManager['"]/);

  // Ambos handlers delegate to o singleton and ter try/catch fallbacks então
  // a thrown error nunca reaches o renderer como a rejection (renderer iria
  // caso contrário mostrar a generic IPC error).
  const listBlock = sliceSafeHandleBlock(source, 'skills:list');
  assert.match(listBlock, /SkillsManager\.getInstance\(\)\.listSkills\(\)/);
  assert.match(listBlock, /catch[\s\S]{0,200}return \[\]/);

  const openBlock = sliceSafeHandleBlock(source, 'skills:open-folder');
  assert.match(openBlock, /SkillsManager\.getInstance\(\)\.openSkillsFolder\(\)/);
  assert.match(openBlock, /catch[\s\S]{0,300}success:\s*false[\s\S]{0,120}path:\s*['"]['"]/);
});

test('preload exposes skillsRefresh / skillsOpenFolder on window.electronAPI', () => {
  const preload = read('electron/preload.ts');

  // Por Electron security guidance, expose narrow wrappers — nunca o raw
  // ipcRenderer. Ambos methods são thin `ipcRenderer.invoke(...)` calls.
  assert.match(preload, /skillsRefresh:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:list['"]\)/);
  assert.match(preload, /skillsOpenFolder:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:open-folder['"]\)/);

  // Confirm they são dentro o contextBridge.exposeInMainWorld('electronAPI', {...}) block.
  const exposeIdx = preload.indexOf("contextBridge.exposeInMainWorld('electronAPI'");
  assert.ok(exposeIdx >= 0, 'electronAPI must be exposed via contextBridge');
  assert.ok(preload.indexOf('skillsRefresh:', exposeIdx) > exposeIdx,
    'skillsRefresh must live inside the electronAPI contextBridge block');
});

test('electron.d.ts declares SkillSummary and the two skills methods', () => {
  const types = read('src/types/electron.d.ts');

  assert.match(types, /export interface SkillSummary\s*\{[\s\S]{0,200}id:\s*string;[\s\S]{0,200}source:\s*['"]builtin['"]\s*\|\s*['"]userData['"]/);
  assert.match(types, /skillsRefresh:\s*\(\)\s*=>\s*Promise<SkillSummary\[\]>/);
  assert.match(types, /skillsOpenFolder:\s*\(\)\s*=>\s*Promise<\{\s*success:\s*boolean;\s*path:\s*string;\s*error\?:\s*string\s*\}>/);
});

test('SkillsSettings renderer guards against a missing bridge instead of silent optional-chain', () => {
  const view = read('src/components/settings/SkillsSettings.tsx');

  // O exact regression we são protecting acontra a silent `?.skillsRefresh?.()`
  // (and o symmetric `?.skillsOpenFolder?.()`) that resolves to undefined.
  // O fix substitui ambos com explicit guards.
  assert.match(view, /typeof window\.electronAPI\?\.skillsRefresh\s*!==\s*['"]function['"]/);
  assert.match(view, /typeof window\.electronAPI\?\.skillsOpenFolder\s*!==\s*['"]function['"]/);
  assert.match(view, /Skills IPC bridge not detected/);

  // Após cada gproteger o call é unconditional (não optional chain em o memétodo
  assert.match(view, /await window\.electronAPI\.skillsRefresh\(\)/);
  assert.match(view, /await window\.electronAPI\.skillsOpenFolder\(\)/);
});

// ---------------------------------------------------------------------------
// 2. Generalised wiring invariant — todo electronAPI.* método consumed por o
//    renderer that mapeia to an ipcRenderer.invoke channel precisa ter a matching
//    ipcMain.handle registration. This é exatamente o class de bug we apenas
//    fixed; sem this cverifica o próximo missing preload binding regresses
//    silently anovamente
// ---------------------------------------------------------------------------
test('every preload ipcRenderer.invoke channel has a matching ipcMain.handle registration', () => {
  const preload = read('electron/preload.ts');
  const handlers = read('electron/ipcHandlers.ts');

  // Capture todo invoke('channel-name'...) string literal em preload.
  const invokeRe = /ipcRenderer\.invoke\(\s*['"]([a-z0-9:_\-./]+)['"]/gi;
  const channels = new Set();
  let m;
  while ((m = invokeRe.exec(preload)) !== null) channels.add(m[1]);

  assert.ok(channels.size > 50, `expected many invoke channels, found ${channels.size}`);
  assert.ok(channels.has('skills:list'), 'sanity: skills:list should appear in preload');
  assert.ok(channels.has('skills:open-folder'), 'sanity: skills:open-folder should appear in preload');

  // A manipulador counts if it's registered via ipcMain.handle Ou via qualquer local
  // wrapper that internally calls ipcMain.handle. We scan o completo electron/
  // árvore (não apenas ipcHandlers.ts) porque subsystems como KeybindManager
  // and o stealth-tap shim registra their próprio channels.
  const registered = new Set();
  const handleRe = /(?:ipcMain\.handle|safeHandle|registerStealthHandler|registerHandler)\(\s*['"]([a-z0-9:_\-./]+)['"]/gi;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist' || entry.name === 'dist-electron') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        let mm;
        while ((mm = handleRe.exec(text)) !== null) registered.add(mm[1]);
      }
    }
  };
  walk(path.join(root, 'electron'));

  // Known-stale invokes: channels exposed em preload that ter não hmanipulador
  // These são pre-existing issues unrelated to o skills fix — fail loudly
  // if a NEW one appears, mas don't block em o existing backlog.
  const KNOWN_STALE = new Set([
    // toggleAdvancedSettings → 'toggle-advanced-settings' é exposed em preload
    // (electron/preload.ts:937) mas não manipulador registra o channel. Renderer
    // invokes silently reject — pre-existing tech debt, separate cleanup.
    'toggle-advanced-settings',
    // M5 cleanup de stealth-tap:permission-granted / request-permission /
    // is-active era completed alongside this commit — entries removed haqui
  ]);

  const missing = [...channels].filter(ch => !registered.has(ch) && !KNOWN_STALE.has(ch)).sort();
  assert.deepStrictEqual(missing, [],
    `Every preload invoke channel must have a matching handler. Missing: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 3. Runtime behaviour — SkillsManager.listSkills() seeds and Retorna o
//    built-in humanize-ai-text skill. Uses o built `dist-electron` bundle
//    and a stubbed `electron` módulo então `app.getPath('userData')` and
//    `app.isReady()` work sem a real Electron host.
// ---------------------------------------------------------------------------
test('SkillsManager.listSkills() returns the builtin humanize-ai-text skill', () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'refract-skills-test-'));

  // Stub `electron` módulo antes SkillsManager é loaded. Inject directly
  // dentro de Node's CJS cache então o bundled `require("electron")` resolves to
  // nosso shim. We give a fully-resolved id ('electron') porque that é o que
  // esbuild produced em o bundle.
  const stubExports = {
    app: {
      isReady: () => true,
      getPath: (name) => {
        if (name === 'userData') return tmpUserData;
        return os.tmpdir();
      },
    },
    shell: {
      openPath: async () => '', // empty string = success por Electron contract
    },
  };

  const cjsRequire = createRequire(import.meta.url);
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = stubExports;
  stubModule.loaded = true;
  // Prime ambos o global cache and a project-local exigir cache então that
  // o bundled SkillsManager.js resolves nosso stub.
  require_cache_set(cjsRequire, electronId, stubModule);

  // O dist bundle de SkillsManager é committed/built por `npm test`'s
  // pre-step. Uso o bundled CJS então we don't need ts-node.
  const distPath = path.join(root, 'dist-electron/electron/services/SkillsManager.js');
  assert.ok(fs.existsSync(distPath), 'dist-electron must be built (npm test runs build:electron first)');

  // Limpa qualquer prior carrega então o exigir escolhe para cima o stubbed electron mmódulo
  delete cjsRequire.cache[distPath];
  const { SkillsManager } = cjsRequire(distPath);

  // Reinicia o static singleton então cada testar executa inicia fresh.
  if (SkillsManager.instance) SkillsManager.instance = undefined;

  const manager = SkillsManager.getInstance();
  const list = manager.listSkills();

  assert.ok(Array.isArray(list), 'listSkills() must return an array');
  // O diretório id (BUILTIN_SKILLS[0].id = 'humanize-text') and o
  // displayed skill id (slugify(frontmatter.name) = 'humanize-ai-text')
  // são intentionally different — o disk slot é named para o legacy
  // built-in mas o parsed frontmatter rebrands it.
  const humanize = list.find(s => s.id === 'humanize-ai-text');
  assert.ok(humanize, `expected humanize-ai-text skill in: ${list.map(s => s.id).join(', ')}`);
  assert.equal(humanize.source, 'builtin');
  assert.equal(humanize.name, 'humanize-ai-text');
  assert.ok(humanize.description.length > 20, 'description should be non-trivial');

  // Verifica o seeded arquivo lives sob userData/skills/humanize-text/SKILL.md.
  const skillFile = path.join(tmpUserData, 'skills', 'humanize-text', 'SKILL.md');
  assert.ok(fs.existsSync(skillFile), 'SKILL.md must be seeded on disk');
  const bytes = fs.statSync(skillFile).size;
  assert.ok(bytes > 1000 && bytes < 100 * 1024,
    `seeded SKILL.md (${bytes} bytes) must be under the 100KB cap so it is not skipped`);

  // openSkillsFolder() precisa sempre retorna an objeto com a `path` campo — o
  // renderer relies em `result?.path` to atualiza o displayed pasta string
  // até em shell.openPath failure.
  return manager.openSkillsFolder().then(result => {
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.path, 'string');
    assert.ok(result.path.length > 0, 'path must always be populated');
  });
});

// Auxiliar — Node's CJS require.cache é read-write mas o typing em ESM é
// awkward. Extracted para clarity.
function require_cache_set(req, id, mod) {
  req.cache[id] = mod;
  // Também alias o absolute-resolved id em case esbuild rewrote it.
  try {
    const resolved = req.resolve(id);
    req.cache[resolved] = mod;
  } catch {
    /* electron isn't resolvable em disk em this env — o bare id stub é enough */
  }
}
