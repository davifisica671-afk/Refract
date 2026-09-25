// Stub (build recovery): extension staging + remote registry fetch.
// Degraded: staging refuses, registry fetch fails. stageFromDirectory is SYNC
// (its call site does not await it); fetchRemoteRegistry is async.
export interface ExtensionStageResult {
  ok: boolean;
  error?: string;
  errors?: string[];
  manifestJson: null;
  payloadDir: null;
  warnings?: string[];
}

export function stageFromDirectory(dir: string): ExtensionStageResult {
  void dir;
  return { ok: false, error: 'not-available', manifestJson: null, payloadDir: null };
}

export async function fetchRemoteRegistry(
  url: string,
): Promise<{ ok: boolean; error?: string; entries: unknown[] }> {
  void url;
  return { ok: false, error: 'not-available', entries: [] };
}
