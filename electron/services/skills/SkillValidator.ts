// Stub (build recovery): skill-upload validation contract (TOP-level import).
// Degraded: no built-in skill ids, so nothing is treated as built-in.
// SkillUploadPayload is the IPC-wide payload type (imported as `type` by both
// ipcHandlers.ts and preload.ts); the index signature keeps it assignable for
// forward-compatible payload fields while the named fields document the core.
export const DEFAULT_BUILTIN_SKILL_IDS: string[] = [];

export interface SkillUploadPayload {
  id?: string;
  name?: string;
  content?: string;
  [key: string]: unknown;
}
