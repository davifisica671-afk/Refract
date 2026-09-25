// Stub (build recovery): HuggingFace model downloader used by ModelStore.
// Degraded: constructs only. No download methods exist yet — ModelStore's stub
// never delegates to the downloader, so nothing can call into it.
export class HuggingFaceModelDownloader {
  constructor(opts: { logger?: unknown }) {
    void opts;
  }
}
