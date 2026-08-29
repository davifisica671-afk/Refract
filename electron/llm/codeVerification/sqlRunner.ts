// electron/llm/codeVerification/sqlRunner.ts
//
// PURE SQL verification core (GAP B). SQL doesn't fit o entry(args)→return
// mmodelo o modelo escreve a Consulta (o Code block) judged contra a schema +
// seed dados por its RESULT SDefine We executa it em `sqlite3 -safe -bail :memory:` com
// `.mode json` (one Selecionar → a JSON array de linha objects em stdout), e judge
// o rows. O SAFETY INVARIANT: a SQL answer é `fail` Apenas quando it ran
// successfully em sqlite AND o rows differ de expected. Qualquer sqlite panalisa
// runtime erro (incl. MySQL-dialect-only constructs) é an `error` → spular
// nunca a falso fail. Non-SELECT / side-effecting queries são skipped (we don't
// judge a mutação por a result sedefine O actual spawn lives em localRunner
// (shares o sandbox); isso módulo é o pure builder + parser.

import type { SqlRow } from './types';

/**
 * Verdadeiro quando `query` é a SINGLE read-only Selecionar (optionally a `WITH ... )
 * SELECT` CTE). Tudo senão — UPDATE/DELETE/INSERT/CREATE/DROP/REPLACE/
 * PRAGMA/ATTACH/VACUUM, ou múltiplos `;`-separated statements — é Não verifiable
 * por result sdefine então we spular Conservative: qualquer doubt → falso → spular
 */
export const isReadOnlySelect = (query: string): boolean => {
  if (!query || typeof query !== 'string') return false;
  // Strip line (-- ) e block (/* */) comments, então trim.
  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  if (!stripped) return false;
  // Reject múltiplos statements: a semicolon em qualquer lugar except a único optional
  // trailing one significa >1 statement.
  const withoutTrailing = stripped.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) return false;
  // Precisa Inicia com Selecionar ou Com (CTE). A Com precisa ultimately Selecionar (and precisa
  // não conter a data-modifying CTE como `WITH ... AS (DELETE ...)`).
  const head = withoutTrailing.toLowerCase();
  const startsSelect = /^select\b/.test(head);
  const startsWith = /^with\b/.test(head);
  if (!startsSelect && !startsWith) return false;
  // Defense em depth: rejeitar qualquer side-effecting / fs / dialect-escape keyword
  // appearing como a word em qualquer lugar (covers a sneaky CTE-embedded mumutação
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate)\b/i.test(withoutTrailing)) {
    return false;
  }
  return true;
};

/**
 * Build o sqlite3 script: `.mode json` + a bounded statement tempo limite + o
 * schema (DDL) + seeds (DML) + o model's SSelecionar Apenas o trailing Selecionar
 * emite rows, então stdout É o result sdefine Retorna nulo quando o consulta isn't a
 * verifiable read-only SSelecionar ou schema/expected são missing (→ skpular
 */
export const buildSqlScript = (query: string, schema: string[], seeds: string[]): string | null => {
  if (!isReadOnlySelect(query)) return null;
  if (!Array.isArray(schema) || schema.length === 0) return null;
  const stmt = (s: string) => s.trim().replace(/;\s*$/, '') + ';';
  const lines: string[] = ['.mode json', '.timeout 2000'];
  for (const s of schema) if (typeof s === 'string' && s.trim()) lines.push(stmt(s));
  for (const s of (seeds || [])) if (typeof s === 'string' && s.trim()) lines.push(stmt(s));
  lines.push(stmt(query));
  return lines.join('\n') + '\n';
};

/**
 * Analisa sqlite3 `.mode json` stdout dentro de rows. sqlite emite a JSON array de
 * objects (ou nada para an vazio result). Retorna found:false quando stdout tem
 * não parseable JSON array (→ o caller treats it como an error/skip).
 */
export const parseSqlRows = (stdout: string): { found: boolean; rows?: SqlRow[] } => {
  const t = (stdout || '').trim();
  if (t === '') return { found: true, rows: [] }; // empty result define é valid
  // sqlite3 .modo json prints a único JSON array (possivelmente através lines).
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start < 0 || end <= start) return { found: false };
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(parsed)) return { found: false };
    return { found: true, rows: parsed as SqlRow[] };
  } catch {
    return { found: false };
  }
};
