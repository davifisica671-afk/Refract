// electron/llm/nvidiaNimModels.ts
//
// Build-recovery stub (Task 2): NVIDIA NIM model ladder + probe classifier.
// Degraded defaults: empty ladder (the Test-Connection loop probes zero
// candidates and falls through to the honest "request failed" path), nothing
// retired, probe errors classified per existing call-site literals.
// No importer is modified.
//
// ADAPTATION vs plan sketch: isNvidiaNimRetiredModelId accepts
// `string | undefined | null` — ipcHandlers.ts:11742 passes
// creds.nvidia_nimPreferredModel, which may be unset. Falsy ids are never
// retired (withholding only applies to known retired ids).

export const NVIDIA_NIM_TEST_MODEL_LADDER: string[] = [];

export function isNvidiaNimRetiredModelId(id: string | undefined | null): boolean {
  if (!id) return false;
  void id;
  return false;
}

export function classifyNvidiaNimProbeError(e: unknown): string {
  void e;
  return 'key-ok';
}

export function nvidiaNimErrorDetail(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? '');
}
