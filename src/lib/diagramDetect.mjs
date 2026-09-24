/**
 * Detecção pura de blocos ```mermaid em markdown (zero deps).
 *
 * Só fences de bloco contam (nunca inline com crase simples). O fence de
 * abertura exige a lang exata `mermaid` (case-insensitive) — langs vizinhas
 * como `mmd` são ignoradas. Fence sem fechamento é ignorado.
 */

// Abertura: linha que começa (após espaços opcionais) com ``` + lang exata.
const MERMAID_OPEN_RE = /^[ \t]*```[ \t]*mermaid[ \t]*$/i;
// Fechamento: linha só com 3+ crases (padrão markdown).
const FENCE_CLOSE_RE = /^[ \t]*```+[ \t]*$/;

/**
 * Extrai o conteúdo de todos os blocos ```mermaid fechados, em ordem.
 * @param {string} md markdown completo
 * @returns {string[]} conteúdo interno de cada bloco (sem as linhas de fence)
 */
export function extractMermaidBlocks(md) {
  if (typeof md !== 'string' || md.length === 0) return [];
  const blocks = [];
  let current = null;
  for (const line of md.split('\n')) {
    if (current === null) {
      if (MERMAID_OPEN_RE.test(line)) current = [];
    } else if (FENCE_CLOSE_RE.test(line)) {
      blocks.push(current.join('\n'));
      current = null;
    } else {
      current.push(line);
    }
  }
  // Bloco sem fechamento é descartado (current !== null aqui).
  return blocks;
}

/**
 * Retorna true quando há ao menos um bloco ```mermaid fechado.
 * @param {string} md markdown completo
 * @returns {boolean}
 */
export function hasMermaid(md) {
  return extractMermaidBlocks(md).length > 0;
}
