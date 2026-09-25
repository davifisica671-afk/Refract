// Stub (build recovery): macOS Apple Speech locale inventory + installer.
// Degraded: locales unavailable, installs/releases fail. All three call
// sites in ipcHandlers.ts (release-locale :11950, install-locale :11961,
// get-locales :11976) are darwin-guarded; non-darwin never reaches here.
//
// DEVIATION vs the brief sketch (documented, safer degraded default):
// the brief sketched `readAppleSpeechLocales(): Promise<[]> { return []; }`,
// but the get-locales handler assigns the awaited value directly into
// `appleSpeechLocalesCache: { available; supported; installed; reserved;
// maxReserved } | null` and returns it to the renderer, whose preload
// contract (`preload.ts:341`) reads those exact fields. Returning `[]`
// would mistype the cache and hand the renderer `undefined` fields, so
// this stub returns the same unavailable-inventory object the handler
// itself returns on non-darwin (:11974).
// Likewise `releaseAppleSpeechLocale` carries the optional `error` field
// the preload release contract (`preload.ts:343`) declares.
export interface AppleSpeechLocales {
  available: boolean;
  supported: string[];
  installed: string[];
  reserved: string[];
  maxReserved: number;
}

export async function releaseAppleSpeechLocale(
  _locale: string,
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'unavailable' };
}

export async function installAppleSpeechLocale(
  _locale: string,
  _progress?: (fraction: number) => void,
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'unavailable' };
}

export async function readAppleSpeechLocales(): Promise<AppleSpeechLocales> {
  return { available: false, supported: [], installed: [], reserved: [], maxReserved: 0 };
}
