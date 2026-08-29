/**
 * Guarda estrutural do sistema de material do overlay.
 *
 * Não testa aparência — isso é verificado a olho no app. Testa as três
 * regressões que são invisíveis até quebrarem algo:
 *   1. !important acidental (o overlay já tem 1.300+ no index.css; a receita
 *      foi desenhada justamente para não precisar de nenhum).
 *   2. Vazamento de escopo — as classes overlay-*-surface também são usadas por
 *      SettingsOverlay/SettingsPopup/ModelSelectorWindow. Sem o escopo
 *      .overlay-workspace o material vaza para janelas que não deveriam mudar.
 *   3. Token usado com nome que não existe. É o bug de CSS mais comum e o mais
 *      silencioso: var(--mat-1-rimtop) simplesmente não pinta nada.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../../styles/overlay-material.css', import.meta.url)),
  'utf8',
);

/**
 * CSS sem comentários. Os checks negativos precisam rodar contra declarações
 * reais, não contra prosa: o cabeçalho do arquivo documenta justamente POR QUE
 * ele não usa !important, backdrop-filter e border-radius — e um regex ingênuo
 * bate na explicação.
 */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * O invariante: todo seletor precisa ser gatilhado por uma das duas classes de
 * escopo, em qualquer posição — `.overlay-workspace .x` e
 * `[data-theme='light'] .overlay-workspace` são ambos válidos. Exige que a
 * classe apareça como token completo, então `.overlay-workspace-outro` não
 * conta. ResizeToggle vive fora de .overlay-workspace, daí a segunda entrada.
 */
const SCOPE_ALLOWLIST = [
  /(?:^|[\s>+~(])\.overlay-workspace(?![\w-])/,
  /(?:^|[\s>+~(])\.overlay-resize-toggle(?![\w-])/,
];

/** Extrai seletores de regra, ignorando o conteúdo de @media/@keyframes/@property. */
function topLevelSelectors(css) {
  const withoutAtBlocks = css.replace(
    /@(?:media|keyframes|property|supports)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
    '',
  );
  const withoutComments = withoutAtBlocks.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/(^|\})\s*([^@{}]+?)\s*\{/g)]
    .map((m) => m[2].trim())
    .filter(Boolean)
    .flatMap((group) => group.split(',').map((s) => s.trim()))
    .filter(Boolean);
}

describe('overlay-material.css', () => {
  test('não introduz nenhum !important', () => {
    assert.equal(CODE.includes('!important'), false);
  });

  test('não introduz nenhum backdrop-filter', () => {
    assert.equal(/backdrop-filter\s*:/.test(CODE), false);
  });

  test('não define border-radius (achataria os elementos pill)', () => {
    assert.equal(/(^|[;{\s])border-radius\s*:/.test(CODE), false);
  });

  test('todo seletor está escopado em .overlay-workspace ou .overlay-resize-toggle', () => {
    const offenders = topLevelSelectors(CSS).filter(
      (sel) => !SCOPE_ALLOWLIST.some((re) => re.test(sel)),
    );
    assert.deepEqual(offenders, [], `seletores fora de escopo: ${offenders.join(' | ')}`);
  });

  test('todo token --mat-* usado via var() também é definido', () => {
    const defined = new Set([...CSS.matchAll(/(--mat-[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...CSS.matchAll(/var\((--mat-[\w-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((t) => !defined.has(t));
    assert.deepEqual(missing, [], `tokens usados mas não definidos: ${missing.join(', ')}`);
  });

  test('define os 7 alfas para os dois níveis', () => {
    for (const level of [1, 2]) {
      for (const suffix of [
        'sheen-hi',
        'sheen-lo',
        'rim-top',
        'rim',
        'underside',
        'contact',
        'cast',
      ]) {
        assert.match(
          CSS,
          new RegExp(`--mat-${level}-${suffix}\\s*:`),
          `falta --mat-${level}-${suffix}`,
        );
      }
    }
  });

  test('registra --mat-1-rim-top via @property para permitir interpolação', () => {
    assert.match(CSS, /@property\s+--mat-1-rim-top\s*\{[^}]*syntax:\s*['"]<number>['"]/);
  });
});
