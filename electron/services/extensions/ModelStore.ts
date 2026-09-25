// Stub (build recovery): per-extension model store.
// Degraded: every model unavailable, downloads refuse. status() takes
// (extensionId, model); download() takes (extensionId, model, onProgress,
// signal) and resolves a status-shaped result (call sites read .state;
// tests read .ok).
export interface ExtensionModelStatus {
  state: string;
  bytes?: number;
  reason?: string;
}

export interface ExtensionModelDownloadResult extends ExtensionModelStatus {
  ok: boolean;
  error?: string;
}

export class ModelStore {
  constructor(opts: { downloader?: unknown }) {
    void opts;
  }

  status(extensionId: string, model: unknown): ExtensionModelStatus {
    void extensionId;
    void model;
    return { state: 'unavailable' };
  }

  async download(
    extensionId: string,
    model: unknown,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
  ): Promise<ExtensionModelDownloadResult> {
    void extensionId;
    void model;
    void onProgress;
    void signal;
    return { state: 'unavailable', ok: false, error: 'not-available' };
  }
}
