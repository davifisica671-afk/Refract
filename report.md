# Browser Capture Feature Report

## Executive summary

The browser capture feature lets Refract receive useful page context from the user's active browser tab and attach it to the next AI answer. The feature is designed for coding interviews first: when the user is on pages like LeetCode, HackerRank, CodeSignal, CoderPad-style sites, online judges, or web editors, Refract should capture the coding problem statement, examples, constraints, and visible starter code so the answer can be grounded in the exact problem instead of relying on screenshots or vague transcript context.

The current implementation already supports a secure companion Chrome extension, desktop-pushed capture, page-context chips in the overlay, manual tab selection, secure pairing, and screenshot fallback. The next recommended layer is an automatic coding-platform detector that auto-attaches context when the active page is a known coding/interview site while preserving a manual override.

---

## Main product goal

The highest-value use case is **coding interviews**.

In that flow, the user may be looking at:

- LeetCode
- HackerRank
- CodeSignal
- CoderPad
- Codility
- HackerEarth
- Codeforces
- AtCoder
- TopCoder
- CodeChef
- Replit
- OnlineGDB
- GeeksForGeeks
- interview-specific coding pads

The intended behavior is:

1. User starts a Refract session.
2. Browser extension is connected.
3. User opens a coding challenge page.
4. Refract automatically detects the coding/interview platform.
5. Refract captures the relevant page context.
6. Overlay shows a visible chip, for example:

   ```txt
   Coding problem attached · LeetCode · Two Sum
   ```

7. The next “What to say”, coding hint, answer, or follow-up uses the attached problem context.
8. User can still manually choose another tab or clear the context.

---

## Current implemented feature set

### 1. Companion browser extension

Source: `refract-browser/`

The extension is a Manifest V3 companion extension. It is intentionally minimal and privacy-scoped.

Current properties:

- Uses `activeTab`, not persistent `<all_urls>` content scripts.
- Injects `content-script.js` only when capture is requested.
- The content script never receives the desktop pairing token.
- The service worker is the only extension component that stores the token and talks to desktop loopback.
- The extension talks only to local Refract desktop endpoints on `127.0.0.1` / `localhost`.
- It supports both desktop-triggered capture and popup-triggered manual capture.

Core files:

- `refract-browser/src/service-worker.ts`
- `refract-browser/src/content-script.ts`
- `refract-browser/src/extract.ts`
- `refract-browser/src/popup.ts`
- `refract-browser/CONTRACT.md`
- `refract-browser/README.md`

---

### 2. Secure pairing

The browser extension pairs with the desktop app through Phone Mirror.

Pairing flow:

1. User opens Refract settings.
2. User enables Phone Mirror.
3. User clicks **Connect browser extension**.
4. Desktop arms `/pair` for 60 seconds.
5. Extension calls `/pair` from a pinned Chrome extension origin.
6. Desktop returns an extension token.
7. Extension stores the token in Chrome storage.
8. Extension reuses the token across desktop restarts.

Important security details:

- Phone token and browser-extension token are separate.
- The extension token is loopback-scoped.
- `/dom` accepts only the extension token.
- `/ws` accepts the extension token for extension clients.
- `/pair` is loopback-only and exact-origin pinned.
- Store extension ID and unpacked dev extension ID are both supported.
- Token rotation intentionally forces re-pairing.

Relevant desktop implementation:

- `electron/services/PhoneMirrorService.ts`
- `electron/ipcHandlers.ts`
- `src/components/settings/PhoneMirrorSettings.tsx`

---

### 3. Desktop-pushed capture over WebSocket

The extension opens a WebSocket to the desktop:

```txt
ws://127.0.0.1:<port>/ws?t=<extension-token>
```

The desktop can push capture commands to the extension:

```json
{ "type": "capture-dom", "reqId": "...", "tabId": 123 }
```

The extension then:

1. Selects the correct tab.
2. Injects the content script into that tab.
3. Extracts clean text/code context.
4. POSTs the content to desktop `/dom`.
5. Sends capture status acknowledgements back over WebSocket.

This is better than relying on a Chrome-only hotkey because the desktop global hotkey works even when Chrome is not focused.

---

### 4. Global capture hotkey

Current keybind:

```txt
CommandOrControl+Shift+Y
```

Behavior:

1. Desktop receives global hotkey.
2. Desktop checks if the extension is connected.
3. If extension is ready, desktop asks extension to capture the active browser tab.
4. If extension is not ready or capture fails, desktop falls back to screenshot capture.

This gives the user one gesture:

```txt
Capture page if possible, otherwise capture screen.
```

Relevant files:

- `electron/services/KeybindManager.ts`
- `electron/main.ts`
- `electron/services/PhoneMirrorService.ts`

---

### 5. Active tab resolution

The extension chooses the capture tab using multiple signals:

1. Last active capturable tab from `chrome.storage.session`.
2. Active tab in the last-focused browser window.
3. Active tab from any normal browser window.
4. Explicit `tabId` from manual tab picker.

The extension skips pages that should not or cannot be captured:

- `chrome://`
- `edge://`
- `brave://`
- `about:`
- extension pages
- devtools pages
- view-source pages
- incognito tabs

This matters because during an interview the user may be focused on the Refract overlay, not Chrome. The extension still remembers the last real browser tab the user was looking at.

---

### 6. Page extraction

Current extractor: `refract-browser/src/extract.ts`

The extractor converts the active page into clean text. It does not send raw HTML.

Extraction order and logic:

1. Capture page title.
2. Capture user selection if present.
3. Capture visible headings.
4. Capture code blocks and editor content.
5. Use Mozilla Readability for article-like pages.
6. Fall back to cleaned `body.innerText` for app-like pages.
7. Cap final payload at 25,000 characters.

Special coding support already exists:

- Detects common coding hosts.
- Detects code editors.
- Preserves code from `<pre>` and `<code>` blocks.
- Extracts visible Monaco editor lines.
- Extracts visible CodeMirror editor lines.
- Marks code as verbatim so the model should use the exact signature and structure.
- Caps coding-page prose so starter code/signatures are not drowned out.

Currently recognized coding hosts include:

- `leetcode.com`
- `hackerrank.com`
- `codeforces.com`
- `codechef.com`
- `spoj.com`
- `codesignal.com`
- `codewars.com`
- `hackerearth.com`
- `atcoder.jp`
- `topcoder.com`
- `geeksforgeeks.org`
- `onlinegdb.com`
- `replit.com`

The recommended next step is to expand this into a larger top-100 platform registry with platform-specific extractors.

---

### 7. `/dom` desktop endpoint

The extension POSTs captured content to:

```txt
POST http://127.0.0.1:<port>/dom?t=<extension-token>
```

Payload shape:

```json
{
  "dom": "captured page text",
  "reqId": "optional desktop capture request id",
  "meta": {
    "title": "page title",
    "url": "page url",
    "source": "readability | innertext | selection",
    "pageType": "coding | article | app",
    "firstLine": "first meaningful line"
  }
}
```

Desktop behavior:

- Validates extension token.
- Enforces request size limit.
- Caps DOM text at 25,000 characters.
- Sanitizes metadata before IPC.
- Sends content to the overlay window only.
- Returns `409 no_active_session` if no active overlay/session exists.
- Uses `reqId` anti-clobbering so duplicate browser captures cannot overwrite the winning page context.

Important responses:

| Status | Meaning |
|---|---|
| `200` | Page context accepted. |
| `400` | Bad body. |
| `401` | Invalid token. |
| `409` | Refract is running, but no active session/overlay exists. |
| `413` | Payload too large. |
| `429` | Rate limited. |

---

### 8. Overlay delivery and visible chip

Captured content is delivered to the overlay through IPC:

```txt
dom-context-received
```

Renderer behavior:

1. Stores text in `window.lastCapturedDOM`.
2. Shows a visible page-context status pill.
3. Uses the context on the next answer request.
4. Clears the context after use, dismiss, or timeout.

Example chip:

```txt
leetcode.com · page ready
```

The chip has:

- source/host label
- tooltip with URL and character count
- manual tab picker button
- clear button

Relevant file:

- `src/components/RefractInterface.tsx`

---

### 9. Manual tab picker

If the automatic tab choice is wrong, the user can pick another browser tab.

Flow:

1. User clicks the list icon on the page-context chip.
2. Renderer calls `phone-mirror:list-tabs`.
3. Desktop asks extension for open capturable tabs.
4. Extension returns tab IDs, titles, and URLs.
5. User selects a tab.
6. Renderer calls `phone-mirror:capture-tab`.
7. Desktop asks extension to capture that exact tab.
8. New page context replaces the old one.

Relevant files:

- `src/components/RefractInterface.tsx`
- `electron/ipcHandlers.ts`
- `electron/preload.ts`
- `src/types/electron.d.ts`
- `electron/services/PhoneMirrorService.ts`
- `refract-browser/src/service-worker.ts`

---

### 10. Session gate

Capture is accepted only when an active Refract session/overlay exists.

If the user captures without a session:

- Desktop returns `409 { "error": "no_active_session" }`.
- Extension popup shows a warning like:

```txt
Start a Refract session, then capture again.
```

This prevents captures from silently disappearing into the wrong Electron window.

---

## Current working flow

### Desktop hotkey flow

```txt
User presses Cmd/Ctrl+Shift+Y
  ↓
Electron global shortcut fires
  ↓
PhoneMirrorService waits briefly for extension connection
  ↓
If extension ready:
  desktop sends capture-dom over WebSocket
  ↓
extension resolves active/last-active tab
  ↓
extension injects content-script.js
  ↓
content script extracts clean page context
  ↓
extension POSTs to /dom
  ↓
desktop validates token + session + reqId
  ↓
desktop sends dom-context-received IPC to overlay
  ↓
overlay stores window.lastCapturedDOM and shows page chip
  ↓
next What-to-say request includes domContext
  ↓
context clears after use
```

### Manual popup flow

```txt
User clicks extension popup → Capture this page
  ↓
extension extracts active tab
  ↓
extension POSTs to desktop /dom
  ↓
overlay shows page-context chip
  ↓
next answer consumes context
```

### Wrong tab flow

```txt
User sees page-context chip
  ↓
User clicks tab-list icon
  ↓
Refract lists capturable browser tabs
  ↓
User picks correct coding tab
  ↓
Extension captures that exact tab
  ↓
Chip updates
```

---

## Recommended automatic coding-interview upgrade

The next feature should be **coding platform auto-detection and auto-attachment**.

Instead of treating every page as generic DOM context, the extension should classify known coding/interview pages and produce structured problem context.

### Proposed behavior

When browser extension is connected and a Refract session is active:

1. Extension watches the last active browser tab metadata.
2. If URL matches a known coding/interview platform, mark it as a high-priority capture candidate.
3. On next answer request or coding action, Refract automatically requests a page capture.
4. If capture confidence is high, attach it automatically.
5. If confidence is low, show a prompt/chip asking user to select text or capture manually.
6. Manual tab picker remains available.

### Proposed structured payload

```ts
type CodingProblemContext = {
  kind: 'coding_problem';
  platform: string;
  title?: string;
  url?: string;
  problemStatement?: string;
  examples?: string;
  constraints?: string;
  inputFormat?: string;
  outputFormat?: string;
  starterCode?: string;
  visibleCode?: string;
  language?: string;
  confidence: 'high' | 'medium' | 'low';
  extractionSource: 'platform-selector' | 'script-state' | 'editor-dom' | 'selection' | 'readability' | 'innertext';
};
```

### Proposed platform registry

Add a registry like:

```ts
const CODING_PLATFORM_REGISTRY = [
  {
    id: 'leetcode',
    label: 'LeetCode',
    urlPatterns: [/leetcode\.com\/problems\//],
    extract: extractLeetCodeProblem,
  },
  {
    id: 'hackerrank',
    label: 'HackerRank',
    urlPatterns: [/hackerrank\.com\/(challenges|tests)\//],
    extract: extractHackerRankProblem,
  },
  {
    id: 'codesignal',
    label: 'CodeSignal',
    urlPatterns: [/codesignal\.com/],
    extract: extractCodeSignalProblem,
  },
];
```

### Proposed extractor priority for coding sites

For known coding/interview pages, use this order:

1. Platform-specific selectors.
2. Embedded app state, such as Next.js, Redux, Apollo, or JSON script data.
3. Problem panel text.
4. Examples and constraints sections.
5. Visible editor code from Monaco/CodeMirror.
6. Current selected text.
7. Readability fallback.
8. InnerText fallback.
9. Reject if mostly navigation/sidebar/toolbars.

---

## Top coding/interview platforms to support

Recommended initial registry:

1. LeetCode
2. HackerRank
3. CodeSignal
4. CoderPad
5. Codility
6. HackerEarth
7. CodeInterview
8. CodePair
9. Qualified
10. Karat-style interview pages
11. Interviewing.io
12. Codeforces
13. AtCoder
14. TopCoder
15. CodeChef
16. SPOJ
17. Codewars
18. GeeksForGeeks practice
19. AlgoExpert
20. NeetCode
21. Replit
22. OnlineGDB
23. CodeSandbox
24. CodePen
25. StackBlitz
26. Glitch
27. DevSkiller
28. TestGorilla coding tests
29. Mettl coding assessments
30. Coderbyte

The registry can be expanded over time.

---

## Automatic vs manual behavior

### Automatic capture should happen when

- Refract session is active.
- Extension is connected.
- Active/last-active tab matches known coding platform.
- Extracted content has enough useful signal.
- Page is not restricted/internal/incognito.
- Confidence is medium or high.

### Manual capture should remain available when

- Wrong tab was selected.
- Page is unknown.
- Google Docs / Notion / online notes are ambiguous.
- User wants to select a specific piece of text.
- Multiple coding tabs are open.
- Automatic extraction confidence is low.

### Generic pages should be conservative

For random pages, Gmail, private docs, Slack, dashboards, and personal content, Refract should not aggressively auto-attach unless the user manually requests it or highlights text.

The automatic path should be coding-platform-first, not universal scraping.

---

## Google Docs, notes, and web editors

### Google Docs

Google Docs is partially capturable but should be treated as best-effort.

Likely reliable:

- selected text
- visible document text
- focused editor context

Not guaranteed:

- full long-document extraction
- exact entire document text without Google Docs API/OAuth

Recommended UX:

```txt
Google Docs detected · select text or capture manually
```

or, if useful visible text is captured:

```txt
Page context attached · Google Docs · visible text
```

### Notepad websites / simple web editors

These are much more reliable if they use:

- `<textarea>`
- `<input>`
- `contenteditable`
- Monaco
- CodeMirror
- ProseMirror-like block text

For these, automatic or manual capture can usually extract the current note/editor text.

---

## Security and privacy model

The feature is built around user intent and local-only communication.

Key safeguards:

- No raw page HTML is sent by default; text is cleaned and capped.
- No token is exposed to web pages.
- Content script cannot talk to desktop loopback.
- Service worker owns token and network calls.
- Desktop loopback endpoints require token auth.
- `/pair` is loopback-only and origin-pinned.
- `/dom` rate-limits requests.
- Payload size is capped.
- Captured context is consumed once and cleared.
- No active Refract session means no capture is accepted.
- Internal browser pages and incognito tabs are skipped.
- Manual clear button exists in the overlay.

---

## Known limitations

1. Google Docs full-document extraction is not guaranteed.
2. Some coding platforms virtualize content heavily, so platform-specific selectors are needed.
3. Monaco/CodeMirror extraction captures visible/editor DOM, not necessarily hidden full file state.
4. If extension service worker is asleep, first capture may need a wake-up; desktop has fallback screenshot behavior.
5. Unknown platforms may fall back to generic Readability/innerText, which can include navigation noise.
6. Current coding-host list is not yet a full top-100 platform registry.
7. Current payload is mostly plain text + metadata; a future structured `coding_problem` payload would improve downstream prompting.

---

## Suggested implementation plan for automatic coding-platform capture

### Phase 1 — Registry and classifier

Add a dedicated coding platform registry in `refract-browser/src/`.

Deliverables:

- `coding-platforms.ts`
- URL/domain matcher
- page type `coding_problem`
- confidence score
- tests for top platforms

### Phase 2 — Platform-specific extractors

Start with:

- LeetCode
- HackerRank
- CodeSignal
- CoderPad/Codility generic editor flow

Extract:

- title
- statement
- examples
- constraints
- starter code
- selected text
- current editor language

### Phase 3 — Structured metadata

Extend `CaptureMeta` to include:

```ts
{
  pageType: 'coding_problem' | 'coding' | 'article' | 'app';
  platform?: string;
  problemTitle?: string;
  confidence?: 'high' | 'medium' | 'low';
}
```

Update overlay chip labels:

```txt
Coding problem attached · LeetCode · Two Sum
```

### Phase 4 — Auto-capture trigger

Add automatic capture when:

- a session is active,
- extension is connected,
- last active tab matches a coding platform,
- user invokes answer/coding action,
- no fresh page context already exists.

This should happen just-in-time before answer generation, not continuously on every navigation.

### Phase 5 — Manual override polish

Keep and improve:

- wrong-tab picker
- clear button
- manual popup capture
- selected-text-first behavior
- low-confidence warning state

---

## Final intended user experience

### Coding interview happy path

```txt
User opens LeetCode problem
  ↓
Refract detects LeetCode problem tab
  ↓
User asks “what should I say?” or presses answer hotkey
  ↓
Refract auto-captures problem statement + starter code
  ↓
Overlay shows “Coding problem attached · LeetCode · <title>”
  ↓
AI answer uses exact prompt, examples, constraints, and code signature
```

### Manual correction path

```txt
Auto-capture picked wrong tab
  ↓
User clicks tab-picker icon on chip
  ↓
User selects HackerRank tab
  ↓
Refract captures that tab
  ↓
Next answer uses corrected problem context
```

### Non-coding page path

```txt
User is on generic website or notes app
  ↓
Refract does not aggressively auto-capture unless confidence is high
  ↓
User can manually capture page or selected text
```

---

## Bottom line

The browser capture feature already provides the secure infrastructure needed for page context:

- paired companion extension,
- desktop global hotkey,
- WebSocket capture push,
- `/dom` delivery,
- visible overlay chip,
- tab picker,
- single-use context consumption,
- screenshot fallback.

The next product improvement should be a **coding-interview automatic capture layer**: detect top coding platforms, extract structured problem context, auto-attach it just-in-time, and keep manual controls for correction. This directly targets the highest-value use case: helping users answer coding interview problems with the exact problem statement and visible code in context.
