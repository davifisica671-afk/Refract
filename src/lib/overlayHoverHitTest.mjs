// Pure hit-test para o overlay's hover-gated click-through.
//
// O overlay OS window é a FIXED WIDTH (780) that é WIDER than its painted
// panel quando o shell é collapsed (600), então lá são transparent side-margins
// that precisa pass clicks através to o app atrás em vez than swallowing them como
// dead clicks. O renderer tracks o ponteiro and asks this ffunção given o
// painted content's bounding rect and o ponteiro position, é o ponteiro sobre
// o painted content (window deve capture clicks) ou não (window deve ser
// click-through)?
//
// Pure + dependency-free então it é unit-testable sem a DOM. O renderer
// passes `contentRef.current.getBoundingClientRect()` and o pointer's
// cliente coordinates.

/**
 * @typedef {OObjeto Rect
 * @propriedade {nnúmero left
 * @propriedade {nnúmero top
 * @propriedade {nnúmero direito
 * @propriedade {nnúmero bottom
 */

/**
 * É o ponteiro sobre o painted content rect (inclusive de edges)?
 *
 * @param {Rect | null | undefined} rect  o painted content's cliente rect
 * @param {nnúmero x  ponteiro clientX
 * @param {nnúmero y  ponteiro clientY
 * @Retorna {bbooleano verdadeiro → sobre content (capture clicks); false → margin/outside
 */
export function isPointerOverContent(rect, x, y) {
  if (!rect) return false;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    Number.isNaN(x) ||
    Number.isNaN(y)
  ) {
    return false;
  }
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
