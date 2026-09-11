#!/usr/bin/env node
/**
 * check-no-secrets.mjs — CI gate (blocking) contra segredos commitados.
 *
 * Varre arquivos TRACKEADOS (git ls-files) procurando padrões de segredo
 * REAL, ignorando placeholders (your_*, changeme, ...) e fixtures de teste
 * conhecidas (allowlist abaixo). Falha (exit 1) se achar algo.
 *
 * Uso: node scripts/check-no-secrets.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Arquivos que contêm canários/máscaras de propósito (não são segredos).
const ALLOW_FILES = new Set([
    'scripts/check-no-secrets.mjs',
    '.env.example',
    'docs/SECRETS.md',
    'docs/security-audit/gerar_relatorio.py',
    'electron/audio/__tests__/GoogleSTTDropsKeepaliveSilence.test.mjs',
    'electron/services/__tests__/RedactForLog.test.mjs',
    'electron/services/__tests__/OpenAIRealtimeGAProtocol.test.mjs',
    'electron/services/__tests__/TelemetryService.test.mjs',
    'src/components/settings/HelpSettings.tsx',
    'src/components/settings/AIProvidersSettings.tsx',
    'lemonsqueezy-server/server.test.mjs',
]);

// Diretórios jamais varridos (vendored/build).
const SKIP_DIRS = ['node_modules', 'dist', 'dist-electron', 'release', 'build', '.git', 'artifacts'];

const PATTERNS = [
    { name: 'openai-project-key', re: /sk-proj-[A-Za-z0-9_-]{20,}/ },
    { name: 'groq-key', re: /gsk_[A-Za-z0-9]{20,}/ },
    { name: 'google-oauth-secret', re: /GOCSPX-[A-Za-z0-9_-]{10,}/ },
    { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{20,}/ },
    { name: 'elevenlabs-key', re: /sk_[a-f0-9]{32,}/ },
    { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'service-account', re: /"type"\s*:\s*"service_account"/ },
];

// Trecho que descaracteriza placeholder/máscara/canário.
const PLACEHOLDER_RE = /your_|change-?me|example|placeholder|xxx+|here\b|test-|a8B2c|sk-…|\.\.\.|…/i;

function trackedFiles() {
    try {
        const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
        return out.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
        // Fallback sem git (dev local atípico): varre a árvore exceto
        // segredos locais conhecidos (não-trackeados por design).
        console.warn('[check-no-secrets] git indisponível — fallback para varredura da árvore.');
        const found = [];
        const skipFiles = [/^\.env(\.|$)/, /\.pem$/, /tonal-history-.*\.json$/];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const rel = path.relative(ROOT, path.join(dir, e.name)).replace(/\\/g, '/');
                if (SKIP_DIRS.some((d) => rel === d || rel.startsWith(d + '/'))) continue;
                if (skipFiles.some((re) => re.test(rel))) continue;
                if (e.isDirectory()) walk(path.join(dir, e.name));
                else found.push(rel);
            }
        };
        walk(ROOT);
        return found;
    }
}

let failures = 0;
for (const rel of trackedFiles()) {
    const norm = rel.replace(/\\/g, '/');
    if (SKIP_DIRS.some((d) => norm === d || norm.startsWith(d + '/'))) continue;
    if (ALLOW_FILES.has(norm)) continue;
    let text;
    try {
        const st = fs.statSync(path.join(ROOT, rel));
        if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
        text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
        continue; // binário/removido
    }
    for (const { name, re } of PATTERNS) {
        const m = text.match(re);
        if (!m) continue;
        // Contexto ±80 chars: se parece placeholder, ignora.
        const i = Math.max(0, (m.index ?? 0) - 80);
        const ctx = text.slice(i, (m.index ?? 0) + m[0].length + 80);
        if (PLACEHOLDER_RE.test(ctx)) continue;
        console.error(`[check-no-secrets] ${name} em ${rel}: …${ctx.replace(/\n/g, ' ').slice(0, 140)}…`);
        failures++;
        break;
    }
}
if (failures) {
    console.error(`[check-no-secrets] FALHOU: ${failures} arquivo(s) com possível segredo real.`);
    process.exit(1);
}
console.log('[check-no-secrets] OK: nenhum segredo real em arquivos trackeados.');
