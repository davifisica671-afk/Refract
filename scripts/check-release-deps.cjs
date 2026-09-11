/**
 * check-release-deps.cjs — Gate de reprodutibilidade do caminho de release.
 *
 * PROBLEMA QUE ESTE SCRIPT ELIMINA (engenharia de release #3/#4):
 * O caminho oficial de build assinado (`npm run app:build:signed`) depende de
 * arquivos que, no passado, existiam apenas localmente e estavam gitignored
 * (ex.: electron-builder.signed.cjs). Um clone novo falhava só no meio do
 * release. Regra agora formal: TODO arquivo referenciado por um caminho de
 * release DEVE estar versionado (ou declarado como dependência externa
 * explícita, ex.: o submodule premium).
 *
 * Uso: `npm run check:release` (local e CI — passo BLOCKING).
 *
 * Exit codes:
 *   0 — todos os arquivos do caminho de release presentes no repositório.
 *   1 — pelo menos um arquivo obrigatório ausente → release NÃO reprodutível.
 * Avisos sobre premium são informativos (o core DEVE buildar sem premium).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let failures = 0;

const fileExists = (rel) => fs.existsSync(path.join(root, rel));
const fail = (msg) => { console.error(`[check-release-deps] FAIL: ${msg}`); failures++; };
const warn = (msg) => console.warn(`[check-release-deps] WARN: ${msg}`);

// ── 1) Todo `--config <arquivo>` em scripts npm deve existir no repo ─────────
// STRICT (FAIL) para scripts do caminho de release (nomes contendo build/dist)
// — é exatamente o caso do problema #3 (app:build:signed → signed.cjs ausente).
// Outros scripts (tooling de eval/dev, ex.: playwright configs de eval) recebem
// WARN: drift informativo, não bloqueia o caminho de release.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
  const re = /--config[= ]([^\s"]+)/g;
  let m;
  const isReleaseScript = /(^|:)(app:)?(build|dist)/.test(name) || /^(build|dist)/.test(name);
  while ((m = re.exec(String(cmd))) !== null) {
    if (!fileExists(m[1])) {
      if (isReleaseScript) {
        fail(`script "npm run ${name}" referencia config inexistente: ${m[1]}`);
      } else {
        warn(`script "npm run ${name}" (dev/eval) referencia config ausente: ${m[1]}`);
      }
    }
  }
}

// ── 2) Arquivos de suporte do caminho de release (default + assinado) ────────
const required = [
  'scripts/ad-hoc-sign.js',             // package.json build.afterPack
  'scripts/notarize.js',                // afterSign do electron-builder.signed.cjs
  'scripts/afterAllArtifactBuild.cjs',  // afterAllArtifactBuild do signed config
  'build/entitlements.mac.plist',       // mac.entitlements (assinado)
  'build/entitlements.mac.inherit.plist', // mac.entitlementsInherit (assinado)
];
for (const rel of required) {
  if (!fileExists(rel)) fail(`arquivo obrigatório do release ausente: ${rel}`);
}

// Hooks declarados no package.json build (qualquer ./caminho deve existir)
for (const hook of ['afterPack', 'afterSign', 'afterAllArtifactBuild']) {
  const v = (pkg.build || {})[hook];
  if (typeof v === 'string' && v.startsWith('./') && !fileExists(v)) {
    fail(`build.${hook} aponta para arquivo ausente: ${v}`);
  }
}

// ── 3) Premium: submodule declarado → estado deve ser explícito ──────────────
// O core CONTRAI o compromisso de buildar/typar sem premium (nunca falha aqui
// por premium). Mas o estado DEVE ser visível, não silencioso.
const expectedPremiumFiles = [
  // Arquivos que testes do core escaneiam (ausentes => falhas ENOENT nos tiers)
  'premium/electron/knowledge/KnowledgeOrchestrator.ts',
];
if (fs.existsSync(path.join(root, '.gitmodules'))) {
  if (!fileExists('premium')) {
    warn('premium/ ausente — restaurar com: git submodule update --init premium');
    warn('        (sem premium, testes que escaneiam premium/ falham com ENOENT; o core builda normalmente)');
  } else {
    const missing = expectedPremiumFiles.filter((rel) => !fileExists(rel));
    if (missing.length > 0) {
      warn(`premium/ DESATUALIZADO — faltam arquivos que os testes do core escaneiam:`);
      for (const rel of missing) warn(`  - ${rel}`);
      warn('        atualize o checkout premium para o commit pinado pelo time (os testes premium-scanning vão falhar até lá)');
    } else {
      console.log('[check-release-deps] premium: presente e com arquivos esperados.');
    }
  }
}

if (failures > 0) {
  console.error(`[check-release-deps] ${failures} falha(s) — o caminho de release NÃO é reprodutível a partir deste checkout.`);
  process.exit(1);
}
console.log('[check-release-deps] OK — caminho de release autossuficiente no repositório.');
