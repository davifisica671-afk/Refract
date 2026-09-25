// Stub (build recovery): downloadable local-embedding-model installer.
// Degraded: empty catalogue, nothing installed, installs refuse, the folder
// cannot be revealed. list/status/remove are SYNC (call sites invoke them
// without await); install/reveal are async (call sites await them).
export interface EmbeddingCatalogStatusEntry {
  id: string;
  name: string;
  status: { state: string; bytesOnDisk?: number };
  supported: boolean;
}

export function listEmbeddingCatalogStatus(): EmbeddingCatalogStatusEntry[] {
  return [];
}

export async function installEmbeddingCatalogModel(
  id: string,
  progress?: (p: { fraction: number; currentFile: string }) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string; digests?: unknown }> {
  void id;
  void progress;
  void signal;
  return { ok: false, error: 'not-available' };
}

export function removeEmbeddingCatalogModel(id: string): { ok: boolean; error?: string } {
  void id;
  return { ok: false };
}

export function statusOf(model: unknown): { state: string; missing: string[] } {
  void model;
  return { state: 'unavailable', missing: [] };
}

export async function revealLocalEmbeddingModelsDirectory(): Promise<boolean> {
  return false;
}
