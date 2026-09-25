// Stub (build recovery): screenshot-description cache reads.
// Degraded: always miss (null) — every call site already treats a miss as
// "run the vision pass" (1644: `if (cacheKey)` + `?? ''`; 6919: truthy check
// with a catch comment "a cache miss is the normal case").
// Surface note: THREE functions — hashImageSet + getScreenshotDescription
// (line 1644 path) AND getDescriptionForImageSet (line 6919 path, missed by
// the plan sketch).
export function hashImageSet(_paths: string[]): string | null {
  return null;
}

export function getScreenshotDescription(_key: string): { description?: string } | null {
  return null;
}

export function getDescriptionForImageSet(_paths: string[]): string | null {
  return null;
}
