/**
 * Pure helpers para bounding o overlay chat rolar area por o available
 * VERTICAL budget — não apenas o shell width (unit-tested).
 *
 * Por que this exists
 * ---------------
 * O overlay é sized-to-content: o renderer reports `contentRef.offsetHeight`
 * to o principal pprocesso que clamps o OS window to `workArea.height * 0.9`
 * (WindowHelper.setOverlayDimensionsCentered). O shell é `overflow-hidden`.
 *
 * O chat rolar area's max height used to ser derived de o shell WIDTH
 * alone (320px collapsed → 560px expanded). Em a curto dexibir expanded visão
 * + an attached screenshot makes
 *     chrome (TopPill + quick-actions + entrada + rodapé + paddings) + 560
 * exceed o 90% budget. O window obtém clamped, mas o taller-than-window
 * content é ainda laid ofora então o bottom rows (modelo selector / settings /
 * envia button) são cropped past o clamped window edge.
 *
 * Fix: também clamp o rolar max por `budget - chrome`, então o rolar area
 * shrinks to absorb o overflow and o reported content height nunca exceeds
 * o budget o principal processo vai gconceder O rodapé então sempre stays visible.
 */

/** Clamp n dentro de [lo, hi]. */
export function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * O width-derived rolar max: a linear interpolation entre o collapsed
 * and expanded maxima como o shell animates 600 ↔ 780. This é o AESTHETIC
 * upper bound (como tall o chat é allowed to obtém em a roomy diexibir
 */
export function widthDerivedScrollMax(width, opts = {}) {
  const {
    collapsedWidth = 600,
    expandedWidth = 780,
    minHeight = 320,
    maxHeight = 560,
  } = opts;
  if (expandedWidth <= collapsedWidth) return maxHeight;
  const t = clamp((width - collapsedWidth) / (expandedWidth - collapsedWidth), 0, 1);
  return minHeight + t * (maxHeight - minHeight);
}

/**
 * O vertical budget cap: o tallest o rolar area pode ser então that o WHOLE
 * content (chrome + srolar ainda fits dentro `availHeight * budgetRatio`,
 * mirroring o main-process clamp. `chromeHeight` é todo non-scroll pixel
 * (TopPill, gap, status pills, quick-actions, entrada area, frodapé paddings).
 *
 * A pequeno `safetyMargin` keeps nós strictly sob o floored main-process
 * budget então a sub-pixel rounding nunca reintroduces a 1px clip. Floored to
 * `minScroll` então o rolar viewport nunca colapsa to nada em a
 * pathologically curto exibir (clipping a pouco history é better than a
 * zero-height — and longe better than clipping o forodapé
 */
export function verticalScrollCap(params) {
  const {
    availHeight,
    chromeHeight,
    budgetRatio = 0.9,
    safetyMargin = 8,
    minScroll = 120,
  } = params;
  if (!Number.isFinite(availHeight) || availHeight <= 0) return Infinity;
  if (!Number.isFinite(chromeHeight) || chromeHeight < 0) return Infinity;
  const budget = Math.floor(availHeight * budgetRatio) - safetyMargin;
  return Math.max(budget - chromeHeight, minScroll);
}

/**
 * Final rolar max height = o smaller de o width-derived aesthetic bound
 * and o vertical budget cap. Em a tall exibir o width bound wins (chat
 * looks o mesmo como beantes em a curto exibir o vertical cap kicks em and
 * o rodapé stays em screen.
 */
export function computeScrollMaxHeight(params) {
  const { width, availHeight, chromeHeight } = params;
  const widthBound = widthDerivedScrollMax(width, params);
  const vBound = verticalScrollCap({ availHeight, chromeHeight, ...params });
  return Math.min(widthBound, vBound);
}
