// Stub (build recovery): extension staging + remote registry fetch.
// Degraded: staging refuses, registry fetch fails. stageFromDirectory is SYNC
// (its call site does not await it); fetchRemoteRegistry is async.
// ALIGNMENT (Task 5): stageFromDirectory returns errors: ['not-available']
// + warnings: [] — the install handler reads staged.errors into its
// stage_failed response (:9606) and spreads staged.warnings ?? [] (:9620),
// so the envelope must carry both lists even in refusal.
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
  return {
    ok: false,
    error: 'not-available',
    errors: ['not-available'],
    manifestJson: null,
    payloadDir: null,
    warnings: [],
  };
}

export async function fetchRemoteRegistry(
  url: string,
): Promise<{ ok: boolean; error?: string; entries: unknown[] }> {
  void url;
  return { ok: false, error: 'not-available', entries: [] };
}
