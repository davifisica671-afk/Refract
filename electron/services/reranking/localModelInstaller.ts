// Stub (build recovery): direct local-reranker model catalogue installer.
// Degraded: nothing installed, installs fail, removals fail.
// Signature notes (READ-first adaptations vs the plan sketch):
// - listCatalogStatus / statusOf / removeCatalogModel are SYNC — the call
//   sites consume them without await (`listCatalogStatus().map(...)`,
//   `statusOf(entry).state`, `const res = removeCatalogModel(id)`).
// - statusOf includes `missing: string[]` — the activation path renders
//   `status.missing.join(', ')` for the not-installed message.
// - installCatalogModel is async with the (fraction, currentFile) progress
//   callback the install handler forwards to `reranker:model-progress`, and
//   its result carries `digests` (read on the success path).
export interface LocalModelStatus {
  state: string;
  missing: string[];
  bytesOnDisk?: number | null;
  [key: string]: unknown;
}

export interface CatalogModelStatusEntry {
  id: string;
  status: LocalModelStatus;
  [key: string]: unknown;
}

export interface InstallProgress {
  fraction: number;
  currentFile: string;
}

export function statusOf(_entry: unknown): LocalModelStatus {
  return { state: 'unavailable', missing: [] };
}

export function listCatalogStatus(): CatalogModelStatusEntry[] {
  return [];
}

export async function installCatalogModel(
  _id: string,
  _progress?: (p: InstallProgress) => void,
  _signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string; digests?: unknown }> {
  return { ok: false, error: 'not-available' };
}

export function removeCatalogModel(_id: string): { ok: boolean; error?: string } {
  return { ok: false, error: 'not-available' };
}
