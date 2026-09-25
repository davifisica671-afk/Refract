// Stub (build recovery): page-capture fallback bridge contract (TOP-level
// preload import — fatal for the bridge bundle).
// Exact values READ from preload.ts usage: the two constants are subscribed
// with ipcRenderer.on(...) / removeListener(...) in onPageCaptureStarted and
// onPageCaptureFallback, and PageCaptureFallbackNotice is the notice object
// delivered to the fallback callback. No main-process sender or renderer
// string literal exists anywhere else in the repo (verified by grep), so
// these constants ARE the channel names — sender and receiver meet here.
export const PAGE_CAPTURE_FALLBACK_CHANNEL = 'page-capture-fallback';

export const PAGE_CAPTURE_STARTED_CHANNEL = 'page-capture-started';

export interface PageCaptureFallbackNotice {
  channel: string;
  [key: string]: unknown;
}
