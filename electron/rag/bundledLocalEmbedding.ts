// Stub (build recovery): no bundled-embedding catalogue is wired yet, so no
// legacy id can be recognised. Returns false; callers fall back to the raw id.
export function isBundledLocalModelId(id: string): boolean {
  void id;
  return false;
}
