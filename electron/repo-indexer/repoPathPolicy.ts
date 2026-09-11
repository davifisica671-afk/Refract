/**
 * repoPathPolicy.ts — política de confinamento do repo-index:scan (F-08).
 *
 * Módulo propositalmente SEM dependências internas: o repoPath chega via IPC
 * (input do renderer) e precisa ser validável/testável sem subir VectorStore,
 * embeddings ou Electron.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Tetos anti-DoS da varredura. */
export const REPO_SCAN_MAX_FILES = 5000;
export const REPO_SCAN_MAX_FILE_BYTES = 512 * 1024;
export const REPO_SCAN_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** true se `candidate` é igual a `base` ou está contido nela. */
export function isWithinOrEqual(candidate: string, base: string): boolean {
  const rel = path.relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Valida um caminho de repositório vindo do renderer e devolve o caminho
 * real resolvido (symlinks resolvidos). Lança Error quando inválido.
 * Regras: absoluto, diretório existente, fora de locais sensíveis do SO e
 * nunca a própria home/raiz (varredura ampla demais).
 */
export function validateRepoPath(repoPath: unknown): string {
  if (typeof repoPath !== 'string' || !repoPath || repoPath.length > 4096 || repoPath.includes('\0')) {
    throw new Error('Invalid repository path');
  }
  if (!path.isAbsolute(repoPath)) {
    throw new Error('Repository path must be absolute');
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync(repoPath);
  } catch {
    throw new Error('Repository path does not exist');
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error('Repository path is not accessible');
  }
  if (!stat.isDirectory()) {
    throw new Error('Repository path must be a directory');
  }
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const resolvedN = norm(resolved);
  const denied: string[] = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    const windir = norm(process.env.SystemRoot || process.env.windir || 'C:\\Windows');
    denied.push(
      windir,
      path.join(windir, 'System32'),
      norm(process.env.ProgramFiles || 'C:\\Program Files'),
      norm(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'),
    );
    // Perfis de OUTROS usuários (a home do próprio usuário é permitida abaixo).
    try {
      const usersDir = norm(path.dirname(home));
      for (const entry of fs.readdirSync(usersDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const profile = norm(path.join(usersDir, entry.name));
          if (profile !== norm(home)) denied.push(profile);
        }
      }
    } catch {
      /* sem leitura do dir de usuários — segue sem essa trava */
    }
  } else {
    denied.push('/etc', '/proc', '/sys', '/dev', '/bin', '/sbin', '/usr', '/var', '/boot', '/root');
    try {
      for (const entry of fs.readdirSync('/home', { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const profile = `/home/${entry.name}`;
          if (norm(profile) !== norm(home)) denied.push(profile);
        }
      }
    } catch {
      /* sem /home legível — segue sem essa trava */
    }
  }
  // A própria home/raiz do usuário — ou a raiz do drive — é ampla demais
  // para indexar por inteiro.
  if (resolvedN === norm(home) || resolvedN === norm(path.parse(resolved).root)) {
    throw new Error('Repository path is too broad (home directory)');
  }
  for (const base of denied) {
    if (base && isWithinOrEqual(resolved, base)) {
      throw new Error('Repository path is in a protected system location');
    }
  }
  return resolved;
}
