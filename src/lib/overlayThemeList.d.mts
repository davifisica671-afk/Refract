export const OVERLAY_THEMES: readonly ['default', 'liquid-glass', 'modern', 'aurora', 'mono'];

export type OverlayThemeName = (typeof OVERLAY_THEMES)[number];

export function isValidOverlayTheme(v: unknown): v is OverlayThemeName;
