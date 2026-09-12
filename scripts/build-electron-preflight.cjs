#!/usr/bin/env node
/**
 * Preflight do esbuild para CI/release Linux.
 *
 * Roda DEPOIS de `npm rebuild esbuild` e ANTES de `npm run build:electron`.
 * Verifica, com o MESMO Node que vai rodar o build:
 *   1. require('esbuild') resolve e expõe .version (pacote presente);
 *   2. o binário nativo executa de verdade (transformSync força spawn do
 *      binário — falha cedo aqui com mensagem clara em vez de quebrar
 *      1s depois dentro do build:electron);
 *   3. lista o pacote opcional (@esbuild/<platform>-<arch>) resolvido, para
 *      diagnóstico quando o binário estiver ausente.
 */
const path = require('path');

function fail(msg) {
  console.error(`[esbuild-preflight] FAIL: ${msg}`);
  process.exit(1);
}

let esbuild;
try {
  esbuild = require('esbuild');
} catch (err) {
  fail(`require('esbuild') falhou: ${err && err.message}`);
}

console.log(`[esbuild-preflight] esbuild JS v${esbuild.version} em ${require.resolve('esbuild')}`);

// Pacote opcional de plataforma resolvido (diagnóstico).
try {
  const platformPkg = `@esbuild/${process.platform}-${process.arch}`;
  console.log(`[esbuild-preflight] binário esperado: ${platformPkg} -> ${require.resolve(platformPkg)}`);
} catch (err) {
  fail(`pacote de plataforma @esbuild/${process.platform}-${process.arch} não resolvido: ${err && err.message}`);
}

// Prova de vida do binário nativo com o Node atual.
try {
  const out = esbuild.transformSync('const x: number = 1', { loader: 'ts' });
  if (!out || typeof out.code !== 'string' || !out.code.includes('const x = 1')) {
    fail('transformSync retornou saída inesperada — binário nativo suspeito.');
  }
} catch (err) {
  fail(`transformSync falhou (binário nativo não executa neste Node/OS?): ${err && err.message}`);
}

console.log(`[esbuild-preflight] OK: binário nativo executa (node ${process.version} em ${process.platform}-${process.arch}, dir ${path.basename(process.cwd())}).`);
