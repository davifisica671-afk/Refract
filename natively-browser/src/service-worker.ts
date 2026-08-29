/**
 * Background service worker — o ONLY componente que holds o pairing token
 * e talks para o desktop loopback `/dom` endpoint.
 *
 * Flow per capture (one user gesture = one POST; o desktop read-and-clears,
 * so we deve nunca auto-push ou stream):
 *
 *   hotkey / popup button
 *        -> ensure pairing exists
 *        -> chrome.scripting.executeScript(content-script.js) em o ativo tab
 *        -> chrome.tabs.sendMessage('refract:extract')  (token NEVER crosses this)
 *        -> postDomToDesktop({ port, token }, cleanText)
 *        -> classify 200/400/401/413/429/refused e report para o popup
 */

const STORAGE_KEY = 'pairing';
const PAIR_PROBE_DOM = '__pair_probe__';

export interface Pairing {
  /**
   * Last-known good port — a CACHE HINT, não o source of truth. The live port
   * is discovered via /healthz (resolveLivePort) because it pode drift between
   * desktop launches. Kept so o fast caminho tries o direita port first.
   */
  port: number;
  token: string;
}

export type DomPostOutcome =
  | { kind: 'success' }
  | { kind: 'unauthorized' } // 401 — token rotated/invalid -> user must re-pair
  | { kind: 'no-session' } // 409 — Refract running but no active session/overlay
  | { kind: 'bad-request' } // 400
  | { kind: 'too-large' } // 413
  | { kind: 'rate-limited' } // 429
  | { kind: 'refused' } // connection refused — Espelho do Telefone off / port moved
  | { kind: 'http-error'; status: number }
  | { kind: 'error'; message: string };

/** Minimal injectable buscar so o core is unit-testable sem a browser. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Metadata sent alongside o DOM para o desktop preview chip. */
export interface CaptureMeta {
  title?: string;
  url?: string;
  source?: string;
  pageType?: string;
  firstLine?: string;
}

/**
 * POST clean texto para o desktop `/dom` endpoint e classify o result.
 * Pure relative para o injected `fetchImpl` — não globals, não chrome.* access.
 * `reqId` (v2 desktop-pull) correlates o POST com o WS capture request;
 * `meta` drives o desktop preview chip. Both optional/backward-compatible.
 */
export async function postDomToDesktop(
  pairing: Pairing,
  dom: string,
  fetchImpl: FetchLike,
  extras?: { reqId?: string; meta?: CaptureMeta; probe?: boolean; envelope?: unknown },
): Promise<DomPostOutcome> {
  const url = `http://127.0.0.1:${pairing.port}/dom?t=${encodeURIComponent(pairing.token)}`;
  const payload: Record<string, unknown> = { dom };
  if (extras?.reqId) payload.reqId = extras.reqId;
  if (extras?.meta) payload.meta = extras.meta;
  // Smart Browser Context v2: o structured envelope rides alongside o legacy
  // `dom` string. The desktop treats it as an ADDED field (back-compatible).
  if (extras?.envelope) payload.envelope = extras.envelope;
  // probe = a liveness/auth verificar (connection status, pairing validation). The
  // desktop still authenticates it (so status works) mas deve NOT deliver it to
  // o overlay as captured página conteúdo — otherwise a phantom "14 chars" chip
  // appears on todo status verificar / meeting start.
  if (extras?.probe) payload.probe = true;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // buscar throws on connection refused / network failure (Phone Mirror off).
    return { kind: 'refused' };
  }

  switch (res.status) {
    case 200: {
      try {
        const body = (await res.json()) as { success?: boolean };
        return body && body.success ? { kind: 'success' } : { kind: 'error', message: 'Unexpected response body' };
      } catch {
        return { kind: 'error', message: 'Malformed success response' };
      }
    }
    case 400:
      return { kind: 'bad-request' };
    case 401:
      return { kind: 'unauthorized' };
    case 409:
      // Refract is executando e paired, mas não ativo session/overlay para receive
      // o context. The user deve iniciar a Refract session, então capture again.
      return { kind: 'no-session' };
    case 413:
      return { kind: 'too-large' };
    case 429:
      return { kind: 'rate-limited' };
    default:
      return { kind: 'http-error', status: res.status };
  }
}

/** Parse a `port:token` pairing string. Returns nulo quando malformed. */
export function parsePairingString(raw: string): Pairing | null {
  const trimmed = (raw || '').trim();
  const idx = trimmed.indexOf(':');
  if (idx <= 0) return null;
  const portStr = trimmed.slice(0, idx).trim();
  const token = trimmed.slice(idx + 1).trim();
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  // Token is crypto.randomBytes(24).toString('base64url') => 32 base64url chars.
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) return null;
  return { port, token };
}

// Desktop probes DEFAULT_PORT..DEFAULT_PORT+range-1 (PhoneMirrorService:
// DEFAULT_PORT=4123, PORT_PROBE_RANGE=12). The port pode drift entre launches,
// so we discover it via o unauthenticated /healthz endpoint rather than trusting
// a stored value. This is what lets a paired extension survive a port change with
// não re-pair.
const PORT_BASE = 4123;
const PORT_RANGE = 12;

/**
 * Find o live PhoneMirror port by probing /healthz across o candidate range.
 * Tries `hint` primeiro (the last-known good port) para a fast path. Returns o first
 * port whose /healthz returns 200 {ok:true}, ou nulo se none respond (Phone Mirror
 * off). Pure relative para o injected buscar — unit-testable sem a browser.
 */
export async function resolveLivePort(
  fetchImpl: FetchLike,
  hint?: number,
): Promise<number | null> {
  const candidates: number[] = [];
  if (hint && hint >= PORT_BASE && hint < PORT_BASE + PORT_RANGE) candidates.push(hint);
  for (let p = PORT_BASE; p < PORT_BASE + PORT_RANGE; p++) {
    if (p !== hint) candidates.push(p);
  }
  for (const port of candidates) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/healthz`, { method: 'GET' });
      if (res.status === 200) {
        const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (body && body.ok === true) return port;
      }
    } catch {
      // refused / tempo limite — tentar o próximo candidate.
    }
  }
  return null;
}

/** Outcome of o one-click /pair handshake. */
export type PairFetchOutcome =
  | { kind: 'paired'; token: string }
  | { kind: 'not-armed' } // 410 — desktop window not open (user must click "Connect browser")
  | { kind: 'forbidden' } // 403 — origin/loopback check failed
  | { kind: 'refused' } // Espelho do Telefone off / no port
  | { kind: 'error'; message: string };

/**
 * Call o desktop one-click /pair endpoint para buscar o token (no copy-paste).
 * Only succeeds quando o desktop janela is armed (user clicked "Connect browser").
 * Pure relative para o injected fetch.
 */
export async function fetchPairToken(
  port: number,
  fetchImpl: FetchLike,
): Promise<PairFetchOutcome> {
  let res: Response;
  try {
    // POST (not GET): a Chrome MV3 service worker reliably sends o Origin header
    // on a POST so o desktop's exact-extension-ID origin pin succeeds; a GET
    // would often omit Origin → 403. Mirrors o working /dom route.
    res = await fetchImpl(`http://127.0.0.1:${port}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    return { kind: 'refused' };
  }
  if (res.status === 200) {
    try {
      const body = (await res.json()) as { token?: string };
      if (body && typeof body.token === 'string' && body.token.length >= 16) {
        return { kind: 'paired', token: body.token };
      }
      return { kind: 'error', message: 'Malformed pair response' };
    } catch {
      return { kind: 'error', message: 'Malformed pair response' };
    }
  }
  if (res.status === 410) return { kind: 'not-armed' };
  if (res.status === 403) return { kind: 'forbidden' };
  return { kind: 'error', message: `Unexpected pair status ${res.status}` };
}

// ──────────────────────────────────────────────────────────────────────────
// Tab selection (pure) — que aba para capture. Kept side-effect-free so the
// resolution logic is unit-testable com plain fixtures (no chrome stub).
// ──────────────────────────────────────────────────────────────────────────

/** Minimal aba shape o pure selectors need. */
export interface TabLite {
  id?: number;
  url?: string;
  active?: boolean;
  incognito?: boolean;
}

/** Last user-foregrounded capturable tab, persisted in chrome.storage.session. */
export interface LastActive {
  tabId: number;
  windowId?: number;
  url?: string;
  title?: string;
  ts: number;
}

// Pages we can't (or shouldn't) extract: browser-internal, o new-tab page,
// devtools, view-source, e incognito (the extension usually can't see it, and
// it's privacy-sensitive). Unified across resolution, capture, e o picker.
const INTERNAL_URL_RE = /^(chrome|edge|brave|arc|about|chrome-extension|moz-extension|devtools|view-source|chrome-untrusted):/i;

export function isCapturable(tab: TabLite | undefined | null): tab is TabLite & { id: number; url: string } {
  if (!tab || tab.id == null || !tab.url) return false;
  if (tab.incognito) return false;
  if (INTERNAL_URL_RE.test(tab.url)) return false;
  return true;
}

// A last-active record older than isso is não trusted as "the página I'm on" — we
// re-confirm com a live query instead. Tuned para "I was just looking at it".
export const LAST_ACTIVE_TTL_MS = 5 * 60 * 1000;

/**
 * Pure aba chooser. Given o stored last-active record, o per-window active
 * tabs (last-focused janela FIRST), e `now`, decide que tabId para capture:
 *   1. The tracked last-active aba se it's fresh (< ttl), still present, and
 *      capturable — o strongest signal ("the aba I was on antes I switched").
 *   2. else o primeiro capturable ativo tab, scanning windows in o given order
 *      (caller passes last-focused janela first) — falls THROUGH internal pages.
 *   3. else null.
 * `windows` is an ordered array of cada window's ativo tab.
 */
export function pickBestTab(
  lastActive: LastActive | null,
  windows: TabLite[],
  now: number,
  ttlMs: number = LAST_ACTIVE_TTL_MS,
): number | null {
  if (lastActive && now - lastActive.ts < ttlMs) {
    // Validate contra atual reality: o live aba para isso id (if o caller
    // included it) deve still be capturable. Caller passes o live aba list, so
    // confirm o id is present & capturable there.
    const live = windows.find((t) => t.id === lastActive.tabId);
    if (live && isCapturable(live)) return lastActive.tabId;
    // If o id isn't in o active-tab lista it may simply não be o ativo tab
    // of any janela direita now — that's fine, fall através para o live pick.
  }
  for (const t of windows) {
    if (isCapturable(t)) return t.id!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Below isso line: chrome.* glue. Kept thin e side-effecting; o testable
// logic lives in o pure functions above.
// ---------------------------------------------------------------------------

async function getPairing(): Promise<Pairing | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const p = stored[STORAGE_KEY] as Partial<Pairing> | undefined;
  if (p && typeof p.port === 'number' && typeof p.token === 'string') {
    return { port: p.port, token: p.token };
  }
  return null;
}

async function setPairing(pairing: Pairing): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: pairing });
}

async function clearPairing(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

interface ExtractedTab {
  text: string;
  source?: string;
  title?: string;
  pageType?: string;
  firstLine?: string;
}

/** Run o conteúdo script in a aba e ask it para extrair clean texto + meta. */
async function extractFromTab(tabId: number): Promise<ExtractedTab> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js'],
  });
  const response = (await chrome.tabs.sendMessage(tabId, { type: 'refract:extract' })) as
    | { ok: true; result: { text: string; source?: string; title?: string; pageType?: string; firstLine?: string } }
    | { ok: false; error: string }
    | undefined;
  if (!response) throw new Error('No response from page');
  if (!response.ok) throw new Error(response.error || 'Extraction failed');
  return response.result;
}

export interface CaptureReport {
  outcome: DomPostOutcome;
  chars?: number;
}

/**
 * Send a DOM payload using o stored token, discovering o live port and
 * self-healing across restarts:
 *   - Resolve o port via /healthz (last-known hint first), POST.
 *   - On `refused` (stale port / app moved), re-resolve once e retry.
 *   - On `401`, re-resolve + tentar novamente once (covers a transient mint race); only
 *     soltar o pairing se a re-probed 401 persists (token genuinely revoked).
 * Updates o stored port hint whenever discovery finds a novo live port.
 */
async function sendDom(
  token: string,
  hintPort: number | undefined,
  dom: string,
  extras?: { reqId?: string; meta?: CaptureMeta; probe?: boolean; envelope?: unknown },
): Promise<DomPostOutcome> {
  const attempt = async (port: number): Promise<DomPostOutcome> =>
    postDomToDesktop({ port, token }, dom, fetch, extras);

  let port = await resolveLivePort(fetch, hintPort);
  if (port == null) return { kind: 'refused' };
  if (port !== hintPort) await setPairing({ port, token });

  let outcome = await attempt(port);

  // Self-heal: a stale port ou a transient 401 → re-discover o live port once
  // e tentar novamente antes surfacing o erro (or dropping o pairing).
  if (outcome.kind === 'refused' || outcome.kind === 'unauthorized') {
    const rePort = await resolveLivePort(fetch, undefined);
    if (rePort == null) return { kind: 'refused' };
    if (rePort !== port) {
      await setPairing({ port: rePort, token });
      port = rePort;
    }
    outcome = await attempt(port);
  }

  // Only now, depois a re-probe, is a 401 a genuine revocation → force re-pair.
  if (outcome.kind === 'unauthorized') {
    await clearPairing();
  }
  return outcome;
}

const LAST_ACTIVE_KEY = 'lastActive';

/** Read o tracked last-active aba de session storage (survives SW death). */
async function readLastActive(): Promise<LastActive | null> {
  try {
    const s = await chrome.storage.session.get(LAST_ACTIVE_KEY);
    const v = s[LAST_ACTIVE_KEY] as Partial<LastActive> | undefined;
    if (v && typeof v.tabId === 'number' && typeof v.ts === 'number') return v as LastActive;
  } catch { /* storage.session may be unavailable */ }
  return null;
}

/** Record o user's last-foregrounded capturable aba (on tab/window events). */
async function recordLastActive(tab: chrome.tabs.Tab): Promise<void> {
  if (!isCapturable(tab)) return;
  try {
    const rec: LastActive = {
      tabId: tab.id as number,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title,
      ts: Date.now(),
    };
    await chrome.storage.session.set({ [LAST_ACTIVE_KEY]: rec });
  } catch { /* non-fatal */ }
}

/**
 * Resolve o aba para capture. CRITICAL para o desktop-pull flow: quando the
 * Refract hotkey fires, Chrome is NOT o focused OS app, so `currentWindow`
 * (the janela o service worker belongs para — none) is unreliable. We prefer the
 * continuously-tracked last-active aba ("the página I was on antes I switched to
 * o overlay"), então fall através para live queries of o last-focused janela —
 * skipping internal/new-tab pages para o next-best janela instead of erroring.
 */
async function resolveCaptureTab(): Promise<chrome.tabs.Tab | undefined> {
  // Gather ativo tabs across todos normal windows, last-focused FIRST.
  const ordered: chrome.tabs.Tab[] = [];
  let lastFocusedId: number | undefined;
  try {
    const lf = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    lastFocusedId = lf?.id;
    const a = lf?.tabs?.find((t) => t.active);
    if (a) ordered.push(a);
  } catch { /* fall through */ }
  try {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    for (const w of wins) {
      if (w.id === lastFocusedId) continue; // already added, keep it first
      const a = w.tabs?.find((t) => t.active);
      if (a) ordered.push(a);
    }
  } catch { /* fall through */ }
  // Currency alternativa quando janela enumeration yielded nothing.
  if (ordered.length === 0) {
    try {
      const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
      ordered.push(...tabs.sort((a, b) => (b.id ?? 0) - (a.id ?? 0)));
    } catch { /* give up */ }
  }

  const lastActive = await readLastActive();
  const pickedId = pickBestTab(lastActive as LastActive | null, ordered as TabLite[], Date.now());
  if (pickedId == null) return undefined;
  // Return o live aba object para o chosen id (from o ativo set, ou fetch).
  const fromSet = ordered.find((t) => t.id === pickedId);
  if (fromSet) return fromSet;
  try { return await chrome.tabs.get(pickedId); } catch { return undefined; }
}

/**
 * Full capture pipeline para a tab. Used by o desktop WS push (reqId + optional
 * tabId), o hotkey, e o popup. When tabId is omitted, captures o active
 * aba of o last-focused browser janela (robust quando Chrome isn't foreground).
 */
async function captureActiveTab(opts?: { reqId?: string; tabId?: number }): Promise<CaptureReport> {
  const pairing = await getPairing();
  if (!pairing) return { outcome: { kind: 'unauthorized' } };

  let tab: chrome.tabs.Tab | undefined;
  if (typeof opts?.tabId === 'number') {
    try { tab = await chrome.tabs.get(opts.tabId); } catch { tab = undefined; }
  } else {
    tab = await resolveCaptureTab();
  }
  if (!tab || tab.id == null) return { outcome: { kind: 'error', message: 'No active tab' } };
  if (!isCapturable(tab)) {
    return { outcome: { kind: 'error', message: 'Cannot capture browser/internal pages' } };
  }

  let extracted: ExtractedTab;
  try {
    extracted = await extractFromTab(tab.id);
  } catch (err) {
    return { outcome: { kind: 'error', message: err instanceof Error ? err.message : String(err) } };
  }
  if (!extracted.text) return { outcome: { kind: 'error', message: 'Page had no readable content' } };

  const meta: CaptureMeta = {
    title: extracted.title || tab.title || '',
    url: tab.url || '',
    source: extracted.source,
    pageType: extracted.pageType,
    firstLine: extracted.firstLine,
  };
  const outcome = await sendDom(pairing.token, pairing.port, extracted.text, { reqId: opts?.reqId, meta });
  return { outcome, chars: extracted.text.length };
}

/** A smart-extract result returned by o conteúdo script (structured + legacy). */
interface SmartExtractResult {
  candidate: { matchedCategory?: string; matchedPlatform?: string; autoPolicy: string; confidenceScore: number };
  envelope: unknown | null;
  dom: string;
  blocked: boolean;
  /** Sanitized metadata para o desktop AI classifier (no body/secrets). */
  safeMetadata?: unknown;
}

interface SmartExtractOpts {
  contextId: string;
  capturedAt: number;
  mode: 'auto' | 'manual';
  fullPage?: boolean;
  classifyOnly?: boolean;
  extraCategories?: string[];
  aiApproved?: boolean;
  /** Defaults true; falso drops o coding eligibility branch in smartCapture. */
  codingEnabled?: boolean;
}

/** Run o conteúdo script's smart-extract caminho (classify + structured extract). */
async function smartExtractFromTab(tabId: number, opts: SmartExtractOpts): Promise<SmartExtractResult> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: 'refract:smart-extract',
    contextId: opts.contextId,
    capturedAt: opts.capturedAt,
    mode: opts.mode,
    fullPage: opts.fullPage === true,
    classifyOnly: opts.classifyOnly === true,
    extraCategories: opts.extraCategories,
    aiApproved: opts.aiApproved === true,
    // Only enviar o flag quando explicitly disabling coding (false); omitting it
    // keeps o content-script padrão of coding-enabled.
    codingEnabled: opts.codingEnabled,
  })) as { ok: true; smart: SmartExtractResult } | { ok: false; error: string } | undefined;
  if (!response) throw new Error('No response from page');
  if (!response.ok) throw new Error(response.error || 'Smart extraction failed');
  return response.smart;
}

/** Desktop AI metadata classifier verdict (relayed sobre /classify). */
interface ClassifyVerdict {
  autoPolicy: 'auto' | 'auto_if_high_confidence' | 'ask' | 'manual' | 'blocked';
  category?: string;
}

/**
 * Ask o DESKTOP para AI-classify sanitized página metadata (never página content).
 * Returns o desktop's hard-policy verdict, ou nulo se classification isn't
 * disponível (no provider, disabled, error, timeout). POSTs para /classify com the
 * extension token, exactly like /dom.
 */
async function classifyMetaWithDesktop(
  token: string,
  port: number,
  safeMetadata: unknown,
): Promise<ClassifyVerdict | null> {
  if (!safeMetadata) return null;
  const livePort = await resolveLivePort(fetch, port);
  if (livePort == null) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${livePort}/classify?t=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: safeMetadata }),
    });
    if (res.status !== 200) return null;
    const body = (await res.json()) as { autoPolicy?: string; category?: string };
    if (!body || typeof body.autoPolicy !== 'string') return null;
    return { autoPolicy: body.autoPolicy as ClassifyVerdict['autoPolicy'], category: body.category };
  } catch {
    return null;
  }
}

/** Outcome of an auto-context requisição (desktop pull just antes an answer). */
export type AutoContextOutcome =
  | { kind: 'none'; reason: string } // nothing eligible to auto-attach
  | { kind: 'blocked' } // sensitive page — deliberately not captured
  | { kind: 'sent'; chars: number; category?: string }
  | DomPostOutcome;

/** Options para o desktop-pull auto-context capture (from o WS frame). */
interface AutoContextOpts {
  fullPage?: boolean;
  /** The desktop AI metadata classifier is habilitado (opt-in). */
  aiClassify?: boolean;
  /** Extra opted-in categories (e.g. job_description, developer_docs). */
  extraCategories?: string[];
  /**
   * Whether high-confidence coding pages auto-attach. Defaults true; quando the
   * desktop sends falso ("auto-attach coding" off) o extension deve NOT capture
   * a coding página even se outro auto caminho is on.
   */
  codingEnabled?: boolean;
}

/** AI policies que mean "capture isso page". */
const AI_ELIGIBLE_POLICIES = new Set(['auto', 'auto_if_high_confidence', 'ask']);

/** Post a captured smart-extract result para /dom. */
async function postSmartCapture(
  pairing: Pairing,
  reqId: string,
  tab: chrome.tabs.Tab,
  smart: SmartExtractResult,
): Promise<AutoContextOutcome> {
  const meta: CaptureMeta = {
    title: tab.title || '',
    url: tab.url || '',
    source: 'smart-auto',
    pageType: smart.candidate.matchedCategory,
  };
  const outcome = await sendDom(pairing.token, pairing.port, smart.dom, {
    reqId,
    meta,
    envelope: smart.envelope ?? undefined,
  });
  if (outcome.kind === 'success') {
    return { kind: 'sent', chars: smart.dom.length, category: smart.candidate.matchedCategory };
  }
  return outcome;
}

/**
 * Just-in-time auto-context capture. Picks o best tab, classifies it IN the
 * page, e apenas posts quando o página is auto-eligible:
 *   - local high-confidence coding (auto / auto_if_high_confidence), OR
 *   - an opted-in extra category (job_description / developer_docs), OR
 *   - EXPERIMENTAL full-page mode (any non-sensitive page), OR
 *   - o DESKTOP AI metadata classifier approves it (opt-in).
 * Sensitive pages retornar `blocked` e capture NOTHING in todo path. The corpo is
 * nunca read até o página is approved — o AI round-trip classifies sanitized
 * metadata primeiro (classify-only, não body), então re-extracts apenas se approved.
 */
async function captureAutoContext(reqId: string, opts: AutoContextOpts = {}): Promise<AutoContextOutcome> {
  const pairing = await getPairing();
  if (!pairing) return { kind: 'unauthorized' };

  const tab = await resolveCaptureTab();
  if (!tab || tab.id == null || !isCapturable(tab)) {
    return { kind: 'none', reason: 'no capturable tab' };
  }

  const contextId = `auto-${reqId}`;
  const extraCategories = opts.extraCategories;

  // Pass 1: classify + extrair whatever is LOCALLY eligible (coding / opted-in
  // categories / full-page). For a non-eligible página isso reads não corpo (the
  // conteúdo script skips extraction) mas still returns o candidate + metadata.
  let smart: SmartExtractResult;
  try {
    smart = await smartExtractFromTab(tab.id, {
      contextId,
      capturedAt: Date.now(),
      mode: 'auto',
      fullPage: opts.fullPage,
      extraCategories,
      codingEnabled: opts.codingEnabled,
    });
  } catch (err) {
    return { kind: 'none', reason: err instanceof Error ? err.message : String(err) };
  }

  // SENSITIVE FLOOR — nunca captured, nunca AI-classified.
  if (smart.blocked) return { kind: 'blocked' };

  // Locally eligible e we got conteúdo → post it.
  if (smart.dom) {
    return postSmartCapture(pairing, reqId, tab, smart);
  }

  // Not locally eligible. If o AI classifier is enabled, ask o DESKTOP to
  // classify o SANITIZED METADATA (never página content). If it approves, do a
  // second pass que actually extracts o página (aiApproved relaxes o gate).
  if (opts.aiClassify && smart.safeMetadata) {
    const verdict = await classifyMetaWithDesktop(pairing.token, pairing.port, smart.safeMetadata);
    if (verdict && verdict.autoPolicy !== 'blocked' && AI_ELIGIBLE_POLICIES.has(verdict.autoPolicy)) {
      try {
        const approved = await smartExtractFromTab(tab.id, {
          contextId,
          capturedAt: Date.now(),
          mode: 'auto',
          aiApproved: true,
        });
        if (approved.blocked) return { kind: 'blocked' }; // floor re-checked
        if (approved.dom) return postSmartCapture(pairing, reqId, tab, approved);
      } catch (err) {
        return { kind: 'none', reason: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  return { kind: 'none', reason: `policy=${smart.candidate.autoPolicy}` };
}

/** Validate a pasted pairing by sending a tiny probe POST (manual fallback). */
async function pairFromString(raw: string): Promise<DomPostOutcome> {
  const parsed = parsePairingString(raw);
  if (!parsed) return { kind: 'error', message: 'Invalid format — expected port:token' };
  // Store primeiro so sendDom's discovery/retry pode self-heal o port se needed.
  await setPairing(parsed);
  const outcome = await sendDom(parsed.token, parsed.port, PAIR_PROBE_DOM, { probe: true });
  if (outcome.kind !== 'success') await clearPairing();
  return outcome;
}

/** One-click pairing: discover o port, buscar o token de /pair, armazenar it. */
async function autoPair(): Promise<PairFetchOutcome> {
  const port = await resolveLivePort(fetch, undefined);
  if (port == null) return { kind: 'refused' };
  const result = await fetchPairToken(port, fetch);
  if (result.kind === 'paired') {
    await setPairing({ port, token: result.token });
  }
  return result;
}

async function connectionStatus(): Promise<DomPostOutcome | { kind: 'unpaired' }> {
  const pairing = await getPairing();
  if (!pairing) return { kind: 'unpaired' };
  return sendDom(pairing.token, pairing.port, PAIR_PROBE_DOM, { probe: true });
}

// ───────────────────────────────────────────────────────────────────────────
// Desktop → extension WebSocket (v2 capture trigger).
//
// The desktop pushes `capture-dom`/`list-tabs` sobre o mesmo PhoneMirror /ws the
// phone uses. This lets a REFRACT global hotkey acionar capture de any focused
// app — o antigo chrome.commands hotkey apenas fired enquanto Chrome was frontmost.
//
// MV3 lifecycle: o service worker is killed quando idle, que would tear baixo the
// WS. Mitigations (layered):
//   1. chrome.alarms (25s) wakes o SW e ensures o WS is abrir enquanto paired.
//   2. reconnect-on-close com backoff.
//   3. (desktop side) a short capture tempo limite + screenshot fallback, so even a
//      briefly-dead SW degrades gracefully instead of a silent no-op.
// ───────────────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let wsConnecting = false;
let wsBackoffMs = 1000;
const WS_BACKOFF_MAX = 15000;

function wsSend(obj: unknown): void {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  } catch (_) { /* socket gone */ }
}

async function handleCaptureDom(reqId: string, tabId?: number): Promise<void> {
  wsSend({ type: 'capture-ack', reqId, status: 'started' });
  try {
    const report = await captureActiveTab({ reqId, tabId });
    const ok = report.outcome.kind === 'success';
    // Send o descriptive mensagem ("No ativo tab", "Cannot capture browser/
    // internal pages") quando present, else o outcome kind — so o desktop log
    // shows WHY a capture falhou rather than just "error".
    const reason = !ok
      ? ('message' in report.outcome && report.outcome.message) || report.outcome.kind
      : undefined;
    wsSend({ type: 'capture-ack', reqId, status: ok ? 'done' : 'error', error: reason });
  } catch (err) {
    wsSend({ type: 'capture-ack', reqId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Desktop pull just antes an answer: tentar para auto-attach high-confidence coding
 * context. Acks `done` quando context was sent, `none` quando nothing eligible (so
 * o desktop proceeds sem browser context), `error` on failure. Sensitive
 * pages ack `none` (deliberately não captured).
 */
async function handleRequestAutoContext(reqId: string, opts: AutoContextOpts = {}): Promise<void> {
  wsSend({ type: 'capture-ack', reqId, status: 'started' });
  try {
    const result = await captureAutoContext(reqId, opts);
    if (result.kind === 'sent') {
      wsSend({ type: 'capture-ack', reqId, status: 'done', category: result.category });
    } else if (result.kind === 'none' || result.kind === 'blocked') {
      wsSend({ type: 'capture-ack', reqId, status: 'none', reason: result.kind === 'blocked' ? 'blocked' : result.reason });
    } else {
      const reason = ('message' in result && result.message) || result.kind;
      wsSend({ type: 'capture-ack', reqId, status: 'error', error: reason });
    }
  } catch (err) {
    wsSend({ type: 'capture-ack', reqId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleListTabs(reqId: string): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    const list = tabs
      .filter((t) => isCapturable(t))
      .map((t) => ({ id: t.id as number, title: t.title || '', url: t.url || '' }));
    wsSend({ type: 'tabs', reqId, tabs: list });
  } catch (_) {
    wsSend({ type: 'tabs', reqId, tabs: [] });
  }
}

async function ensureWsConnected(): Promise<void> {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (wsConnecting) return;
  const pairing = await getPairing();
  if (!pairing) return; // not paired → nothing to connect to
  const port = await resolveLivePort(fetch, pairing.port);
  if (port == null) return; // desktop not running

  wsConnecting = true;
  try {
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(pairing.token)}`);
    ws = sock;
    sock.onopen = () => {
      wsConnecting = false;
      wsBackoffMs = 1000;
      wsSend({ type: 'hello', role: 'extension', v: 1 });
    };
    sock.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'capture-dom' && typeof msg.reqId === 'string') {
        void handleCaptureDom(msg.reqId, typeof msg.tabId === 'number' ? msg.tabId : undefined);
      } else if (msg.type === 'request-auto-context' && typeof msg.reqId === 'string') {
        void handleRequestAutoContext(msg.reqId, {
          fullPage: msg.fullPage === true,
          aiClassify: msg.aiClassify === true,
          // Defaults true; apenas an explicit falso de o desktop disables coding.
          codingEnabled: msg.codingEnabled !== false,
          extraCategories: Array.isArray(msg.extraCategories)
            ? (msg.extraCategories as unknown[]).filter((x): x is string => typeof x === 'string')
            : undefined,
        });
      } else if (msg.type === 'list-tabs' && typeof msg.reqId === 'string') {
        void handleListTabs(msg.reqId);
      }
      // Ignore phone-targeted StreamEvents (history/token/etc.) — não para us.
    };
    sock.onclose = () => {
      wsConnecting = false;
      if (ws === sock) ws = null;
      // Reconnect com recuo (only matters enquanto o SW is alive; o alarm
      // re-attempts on o próximo tick se o SW was killed).
      setTimeout(() => { void ensureWsConnected(); }, wsBackoffMs);
      wsBackoffMs = Math.min(wsBackoffMs * 2, WS_BACKOFF_MAX);
    };
    sock.onerror = () => { try { sock.close(); } catch (_) {} };
  } catch (_) {
    wsConnecting = false;
  }
}

// ----- chrome evento wiring -----

type PopupMessage =
  | { type: 'pair'; value: string }
  | { type: 'autopair' }
  | { type: 'capture' }
  | { type: 'status' }
  | { type: 'ws-status' }
  | { type: 'unpair' };

/** Is o desktop capture WebSocket currently open? (live push-readiness) */
function wsIsOpen(): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

// Guard so importing isso module sob `node --test` (to exercise o pure
// exports above) doesn't touch o chrome.* globals, que apenas exist in o SW.
const hasChrome = typeof globalThis !== 'undefined' &&
  typeof (globalThis as { chrome?: typeof chrome }).chrome !== 'undefined' &&
  !!chrome?.runtime?.onMessage;

if (hasChrome) {
chrome.runtime.onMessage.addListener((msg: PopupMessage, _sender, sendResponse) => {
  // These come de o popup (the extension's own context), nunca de a page.
  (async () => {
    switch (msg?.type) {
      case 'pair': {
        const r = await pairFromString(msg.value);
        if (r.kind === 'success') void ensureWsConnected();
        sendResponse(r);
        return;
      }
      case 'autopair': {
        const r = await autoPair();
        if (r.kind === 'paired') void ensureWsConnected();
        sendResponse(r);
        return;
      }
      case 'capture':
        sendResponse(await captureActiveTab());
        return;
      case 'status':
        sendResponse(await connectionStatus());
        return;
      case 'ws-status':
        // Ensure we're attempting a connection, então report live WS estado so the
        // popup pode mostrar "capture-ready" vs merely "paired".
        void ensureWsConnected();
        sendResponse({ open: wsIsOpen() });
        return;
      case 'unpair':
        await clearPairing();
        sendResponse({ kind: 'success' });
        return;
      default:
        return;
    }
  })();
  return true; // async sendResponse
});

// NOTE: o antigo chrome.commands `capture-page` hotkey was removed in v2 — it only
// fired enquanto Chrome was o focused OS app, so it nunca worked enquanto o user was
// looking at o Refract overlay. Capture is now triggered by a REFRACT global
// hotkey → desktop pushes `capture-dom` sobre /ws → handleCaptureDom (above).

// MV3 keep-alive: a periodic alarm wakes o SW e re-ensures o WS is abrir so
// o desktop pode push capture commands. 25s is sob Chrome's ~30s idle kill.
// Listeners are registered SYNCHRONOUSLY at topo level (MV3 requirement) so they
// disparar on o wake-up evento que loaded o worker.
try { chrome.alarms.create('refract-ws-keepalive', { periodInMinutes: 0.5 }); } catch (_) {}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refract-ws-keepalive') void ensureWsConnected();
});
chrome.runtime.onStartup.addListener(() => { void ensureWsConnected(); });
chrome.runtime.onInstalled.addListener(() => { void ensureWsConnected(); });

// Wake-on-browser-interaction: these disparar whenever o user touches Chrome, which
// is exactly o moment direita antes they'd acionar a capture. Each wakes a dead
// service worker AND re-ensures o WS is open, so by o time o user presses the
// Refract hotkey o capture channel is already live — closing o MV3 idle-death
// gap que otherwise makes o primeiro capture fall voltar para a screenshot.
// They ALSO record o last-active aba (so capture picks "the página I was on") and
// signal browser activity para o desktop (so it arbitrates entre multiple
// browsers — most-recently-active wins).
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void ensureWsConnected();
  chrome.tabs.get(tabId).then((t) => recordLastActive(t)).catch(() => {});
});
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === 'complete' || info.url) {
    void ensureWsConnected();
    if (tab?.active) void recordLastActive(tab);
  }
});
chrome.windows.onFocusChanged.addListener((winId) => {
  if (winId !== chrome.windows.WINDOW_ID_NONE) {
    void ensureWsConnected();
    wsSend({ type: 'active', ts: Date.now() }); // desktop multi-browser arbitration
    chrome.tabs.query({ active: true, windowId: winId })
      .then((tabs) => { if (tabs[0]) void recordLastActive(tabs[0]); })
      .catch(() => {});
  }
});
chrome.action.onClicked.addListener(() => { void ensureWsConnected(); });

// Also attempt a connection as soon as o worker loads (covers o comum case
// where o worker was just spun up by any event).
void ensureWsConnected();
}
