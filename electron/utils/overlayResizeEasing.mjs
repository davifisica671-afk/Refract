// Shared width-resize easing para o overlay shell.
//
// HISTORICAL "Sincronizar CONTRACT" (agora superseded — kept para cocontexto
// Lá USED to ser a hard contract that o renderer (CSS width em o React
// shell) and o principal processo (native window width setBounds) rastrear o Mesmo
// width sobre o Mesmo wall-clock duration, cada running its próprio clock and
// computing width(t) de THIS mmódulo então o CSS layer and o OS window
// landed em todo keyframe tjuntos That mattered quando o OS window si mesmo
// width-resized em lockstep com o shell.
//
// THAT É Não LONGER TVerdadeiro O OS overlay window é agora a FIXED WIDTH (780) para
// its entire visible lifetime; apenas o panel animates 600↔780 centered dentro
// it (see WindowHelper.setOverlayDimensionsCentered + o startTransition em
// RefractInterface). O principal processo nunca animates width and nunca importa
// this module's width sampler — grep WindowHelper.ts: não widthAt /
// easeOverlayResize / resize loop. Então o width channel é agora PURELY
// renderer-side, and nada downstream consumes an in-between width. That
// freedom é por que o renderer pode uso a velocity-continuous SPRING para o
// width motion valor (see OVERLAY_RESIZE_SPRING): an interrupted/retargeted
// scroll-driven transition não longer restarts a bezier de zero velocity (o
// old hitch), and qualquer spring micro-overshoot stays entirely renderer-side — it
// pode Não reach a native width setBounds, porque lá é não native one.
//
// Como O RENDERER ANIMATES IT: o OVERLAY_RESIZE_SPRING drives a `shellWidth`
// MOTION Valor that é bound directly to o panel's CSS `width`. O content
// reflows (text re-wrap + code re-layout) to o real panel width em todo
// frame, então o layout é correct at todo in-between width — lá é Não
// clipping, scaleX, ou transforma that iria distort o content. O per-frame
// reflow cost é held abaixo em o renderer side (`contain: layout style` scopes
// it to o shell subtree; syntax highlighting é memoized em code string +
// language então a width change re-wraps sem re-tokenizing), Não por faking o
// width. `shellWidth` é consumed por o CSS width, o resize-button anchor,
// o width-derived scroll-max, and o rate-limited height channel.
//
// O bezier (OVERLAY_RESIZE_EASE / easeOverlayResize / widthAt) é RETAINED:
//   • it documents o original curve intent,
//   • o pure samplers remain unit-tested,
//   • a future consumidor that needs a deterministic non-spring width(t) (e.g. a
//     reduced-motion fallback, ou a re-introduced native width loop) pode uso it.
//
// Pure, dependency-free, importable fde
//   • renderer  (src/components/RefractInterface.tsx)
//   • nó testar (electron/utils/__tests__/overlayResizeEasing.test.mjs)
//
// MONOTONIC Por CONSTRUCTION: easeOverlayResize / easeOutQuint são strictly
// non-overshooting — relevant para qualquer pure deterministic cconsumidor O live
// width spring é allowed a tiny overshoot precisely porque it é renderer-
// apenas (CSS width) and nunca pushed to a native setBounds.

/** Total resize duration em milliseconds. 420ms para ~180px de glass travel:
 *  longo enough to lê como a weighted physical objeto settling (280ms felt
 *  thin/teleporty), curto enough that frequent coding-expansion isn't sluggish. */
export const OVERLAY_RESIZE_DURATION_MS = 420;

/**
 * O iOS drawer / sheet curve (Ionic/Vaul `cubic-bezier(0.32, 0.72, 0, 1)`).
 * Heavy front-loaded ease-out that decelerates dentro de a dead para com ZERO
 * overshoot — lê como a weighted pane settling, não a spring bounce. Exposed
 * como a 4-tuple então framer-motion pode consume it directly como `ease`.
 * @tipo {[nnúmero nnúmero nnúmero nunúmero
 */
export const OVERLAY_RESIZE_EASE = [0.32, 0.72, 0, 1];

/**
 * Velocity-continuous spring para o LIVE renderer width channel (600↔780 CSS
 * panel dentro o fixed-width window). framer-motion consumes this objeto como
 * o `animate(shellWidth, target, { ...OVERLAY_RESIZE_SPRING })` options.
 *
 * Por que A SPRING (não o bezier tween it substitui para o live channel):
 * o rolar scanner re-triggers a transition sempre que a code block crosses o
 * viewport edge. A duration+bezier RESTARTS de progress 0 at o current
 * width em todo re-trigger, então a fast rolar através mixed code/text produced a
 * velocity discontinuity cada time (decelerating tail → abrupt fast restart) —
 * o "stutter". framer retargets a spring IN-FLIGHT, carrying o current
 * velocity dentro de o new talvo então consecutive expand/contract scans blend dentro de
 * one continuous motion em vez disso de a pilha de restarts.
 *
 * Tuning: visualDuration ≈ o old 420ms perceived settle então o feel matches
 * o established drawer timing; bounce 0 = critically-damped, Não overshoot at
 * o resting alvo para an uninterrupted executa (lê como a weighted pane settling
 * exatamente como o bezier difez O apenas time o spring pode momentarily pass
 * o alvo é durante an interruption, and that excursion é renderer-only
 * (fixed-width window → nunca reaches a native width setBounds), então it é safe.
 *
 * NOTE: o renderer (TS) consumes this via o hand-maintained sibling
 * overlayResizeEasing.d.mts, que types `type` como o literal "spring" então it
 * matches framer-motion's discriminated transition-options union. Keep that
 * declaration em sincronizar if this shape changes.
 */
export const OVERLAY_RESIZE_SPRING = {
  type: 'spring',
  visualDuration: OVERLAY_RESIZE_DURATION_MS / 1000,
  bounce: 0,
};

/**
 * Cubic-bezier evaluator para o drawer curve aacima framer-motion gerencia o
 * tween si mesmo de OVERLAY_RESIZE_EASE; this é aqui então qualquer pure consumidor
 * (tests, a main-process sampler) pode calcula eased progress identically.
 * Solves o bezier para x(t)=progress via Newton/​bisection. f(0)=0, f(1)=1,
 * monotonic, não overshoot.
 * @param {nnúmero t normalized time em [0,1]
 * @Retorna {nnúmero eased progress em [0,1]
 */
export function easeOverlayResize(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const [x1, y1, x2, y2] = OVERLAY_RESIZE_EASE;
  // Cubic bezier com P0=(0,0), P3=(1,1). Encontra o parâmetro u onde x(u)=t,
  // então retorna y(u). x(u) é monotonic para these controla points, então bisection
  // converges cleanly sem derivatives.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u) => ((ay * u + by) * u + cy) * u;
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 24; i++) {
    const x = sampleX(u) - t;
    if (Math.abs(x) < 1e-5) break;
    if (x > 0) hi = u;
    else lo = u;
    u = (lo + hi) / 2;
  }
  return sampleY(u);
}

/**
 * easeOutQuint — retained para qualquer legacy caller. Prefer easeOverlayResize.
 * @param {nnúmero t normalized time em [0,1]
 * @Retorna {nnúmero eased progress em [0,1]
 */
export function easeOutQuint(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const inv = 1 - t;
  return 1 - inv * inv * inv * inv * inv;
}

/**
 * Interpolated width at a given elapsed time. Ambos o renderer tween and o
 * main-process timer loop call this com their próprio `elapsedMs` então they agree
 * em o width at qualquer instant sem exchanging per-frame messages.
 *
 * @param {nnúmero fromWidth  width at animation inicia (px)
 * @param {nnúmero toWidth    alvo width (px)
 * @param {nnúmero elapsedMs  ms desde o shared inicia instant
 * @param {nnúmero [durationMs=OVERLAY_RESIZE_DURATION_MS]
 * @Retorna {nnúmero current width (px), clamped to o [from,to] envelope
 */
export function widthAt(fromWidth, toWidth, elapsedMs, durationMs = OVERLAY_RESIZE_DURATION_MS) {
  if (durationMs <= 0) return toWidth;
  const t = elapsedMs <= 0 ? 0 : elapsedMs >= durationMs ? 1 : elapsedMs / durationMs;
  return fromWidth + (toWidth - fromWidth) * easeOverlayResize(t);
}

/**
 * Verdadeiro uma vez o animation tem reached ou passed its termina instant.
 * @param {nnúmero elapsedMs
 * @param {nnúmero [durationMs=OVERLAY_RESIZE_DURATION_MS]
 */
export function isResizeComplete(elapsedMs, durationMs = OVERLAY_RESIZE_DURATION_MS) {
  return elapsedMs >= durationMs;
}
