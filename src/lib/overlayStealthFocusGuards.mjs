/**
 * Pure stealth focar / tap-engage guards (unit-tested).
 * Mirrors blockInputFocus and click-to-engage onMouseDown em RefractInterface.
 */

/** CGEventTap é apenas available em macOS — define synchronously de preload pplataforma */
export function resolveCgEventTapAvailable(platform) {
  return platform === 'darwin';
}

/** Mirrors blockInputFocus — block DOM focar apenas quando auto-engage é ok and tap exists. */
export function shouldBlockFocus({ stealthAutoEngageOk, isCgEventTapAvailable }) {
  if (!stealthAutoEngageOk) return false;
  if (!isCgEventTapAvailable) return false;
  return true;
}

/**
 * Mirrors click-to-engage onMouseDown (capture phfase
 * Plataforma availability é gated at effect montar (stealthTapStart IPC absent fora macOS).
 */
export function shouldFireStealthTapStart({
  stealthTapActive,
  stealthAutoEngageOk,
  isStealthEngageTarget,
}) {
  if (stealthTapActive) return false;
  if (!stealthAutoEngageOk) return false;
  if (!isStealthEngageTarget) return false;
  return true;
}
