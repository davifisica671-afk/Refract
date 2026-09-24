/**
 * FONTE ÚNICA dos temas válidos do overlay (interface da reunião).
 *
 * Este módulo é puro (sem DOM/Electron) para que possa ser testado com
 * `node --test` direto. `meetingInterfaceTheme.ts` importa daqui — a union
 * `MeetingInterfaceTheme` e o conjunto `VALID_THEMES` derivam desta lista,
 * então adicionar um tema aqui + no CSS basta para estender o sistema.
 */

export const OVERLAY_THEMES = Object.freeze([
  'default',
  'liquid-glass',
  'modern',
  'aurora',
  'mono',
]);

/**
 * Retorna true apenas para os temas conhecidos.
 * Rejeita legados ('', null, 'glass') e qualquer outro valor.
 */
export function isValidOverlayTheme(v) {
  return typeof v === 'string' && OVERLAY_THEMES.includes(v);
}
