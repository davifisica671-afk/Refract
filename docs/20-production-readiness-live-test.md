# Production-Readiness Live Test — Refract API v2.6.0

**Date:** 2026-06-14
**Tester:** QA / production-readiness engineer (live, real providers)
**Target:** Local boot of `refract-api/server.js` on `PORT=8200`, hitting REAL providers (Gemini, Groq, MiniMax, Deepgram, ElevenLabs, Tavily, embeddings) + live observability (Axiom / PostHog / Sentry).
**Method:** Real HTTP/WS requests with real customer API keys pulled read-only from the live Supabase `api_keys` table. All AI/STT/search calls hit live upstreams. No mocking, no faked results.

---

## VERDICT: **READY WITH CAVEATS**

The core AI chat path, streaming, multi-tier AI fallback, embeddings, search, rate limiting, concurrency, error logging, and telemetry are all **production-grade and verified working** with excellent latency. The server is stable (zero crashes across the full test, 869 log lines).

The caveats are **all in the STT fallback chain and are environment/credential issues, not code defects**: in this `.env`, Google STT is hard-disabled (malformed credential value) and ElevenLabs is out of quota, which collapses the 3-tier STT fallback (Deepgram → Google → ElevenLabs) down to **Deepgram-only with no working backup**. Deepgram itself works perfectly. These must be fixed before relying on STT failover in production.

---

## LATENCY SUMMARY TABLE

| Route | p50 | p95 | Verdict |
|---|---|---|---|
| `GET /health` | 1 ms | 34 ms | Excellent |
| `POST /v1/chat` simple (non-stream, Gemini Flash-lite) | 832 ms | 2987 ms | Good (p95 inflated by 1 cold call) |
| `POST /v1/chat` complex (non-stream) | 1176 ms | 1216 ms | Excellent |
| `POST /v1/chat` coding (non-stream) | 2579 ms | 2683 ms | Good |
| `POST /v1/chat` stream simple `fast_mode` (Groq Llama-3.3) — **TFFT** | 241 ms | 245 ms | Outstanding |
| `POST /v1/chat` stream complex — **TFFT** | 620 ms | 915 ms | Excellent |
| `POST /v1/chat` stream coding — **TFFT** | 607 ms | 743 ms | Excellent |
| `POST /v1/embed` (gemini-embedding-2, 768-dim) | 625 ms | 1687 ms | Good |
| `POST /v1/search` (Tavily) | ~2.7–3.7 s | — | Acceptable (search is inherently slow) |
| STT WS connect time | 4–9 ms | — | Excellent |
| STT time-to-first-transcript (Deepgram) | ~2.2 s | — | Good (includes audio buffering) |

**No request exceeded ~8 s TFFT.** The single 2987 ms p95 on simple non-stream chat was one cold provider call; the median is 832 ms and warm calls are ~620 ms.

---

## FALLBACK MATRIX (AI) — deterministic via `/admin/fail-provider`

| Forced down | Who served | Latency | Answer correct? | Pass/Fail |
|---|---|---|---|---|
| (none — baseline) | gemini-3.1-flash-lite | 1807 ms | Yes ("Paris") | PASS |
| geminiFlash | **MiniMax-M2.7** | 4729 ms | Yes ("Paris") | PASS |
| geminiFlash + minimaxM3 + minimaxM27 | **gemini-3.1-pro-preview** | 2449 ms | Yes ("Paris") | PASS |
| + geminiPro (only Groq Scout left) | **meta-llama/llama-4-scout-17b** | 496 ms | Yes ("Paris") | PASS |
| (all restored) | gemini-3.1-flash-lite | 689 ms | Yes ("Paris") | PASS |
| 3 providers down (no-hang check) | gemini-3.1-pro-preview | 3705 ms (<15 s) | Yes | PASS |

**Every AI fallback level produced a valid, correct answer.** Server logs confirm the exact routing decisions (`[AI] cycle 1 → MiniMax`, `→ Gemini Pro`, `→ Groq Scout (last resort)`). Provider health restored cleanly after reset. No fallback ever hung.

### FALLBACK MATRIX (STT) — forced Deepgram down

| Forced down | Who was selected | Outcome | Pass/Fail |
|---|---|---|---|
| deepgram | googleSTT → **SKIPPED** (disabled, bad creds) | — | — |
| deepgram | elevenlabs (selected) | **Connected but rejected: "You have exceeded your quota"** → no transcript | **FAIL (credential/quota)** |

The *routing logic* correctly walked the chain (it did select ElevenLabs — `provider=elevenlabs` in close logs), but **no working backup provider exists** in this environment: Google is disabled and ElevenLabs is out of quota. This is a config/billing failure, not a routing-code failure.

---

## SECTION-BY-SECTION RESULTS

### 1. Startup & Health — PASS
- Clean startup, no ReferenceError / crash. Listening in ~3 s.
- Boot log provider pool counts:
  - Groq: 8/10 keys · Tavily: 11 keys (11k credits) · Deepgram: 4/6 keys · ElevenLabs: 6/6 keys · Gemini: 6/6 keys · MiniMax: 1/6 keys
- Telemetry status line: `[Telemetry] axiom=true posthog=true sentry=true release=2.6.0 env=development`
- **`GET /health` p50=1 ms, p95=34 ms** (10 samples). Returns structured provider + embedding telemetry snapshot.
- **Finding (HIGH):** boot log shows `[GoogleSTT] ⚠️ Failed to parse GCP credentials JSON — Google STT fallback DISABLED` and `Provider permanently disabled at startup`.

### 2. AI Chat (real calls) — PASS
- **Routing verified correct.** Non-`fast_mode` requests use the standard chain starting at Gemini Flash-lite. `fast_mode:true` + simple query correctly routes to the **Groq fast pool (llama-3.3-70b-versatile)** — TFFT 241 ms. (The header chain "Groq → Gemini Flash → …" is the fast-mode path; standard path begins at Flash. Working as designed.)
- Simple / complex / coding all returned non-empty, coherent answers (e.g. "The capital of France is Paris.", correct TCP congestion-control summary, correct linked-list reversal).
- Streaming SSE works; TFFT excellent across all tiers (241–620 ms p50).
- `/v1/chat/completions` (OpenAI-compat) → 200, correct `object:"chat.completion"`, `choices[0].message.content`, `finish_reason:"stop"`.
- Vision: tiny 1×1 PNG correctly routed to **gemini-3.5-flash** (full flash for images), returned a plausible color, 1570 ms.
- **Edge cases all correct:** empty messages → 400 `messages array required`; no auth → 401 `auth_required`; bad key → 401 `invalid_key_format`; prompt-injection language → 400 `invalid_language_code`; 3900-char prompt → 200 in 863 ms.
- **No secrets** in any response body (scanned for sk-/AIza/gsk_/JWT/Supabase/private-key — CLEAN).

### 3. Fallback Mechanism — PASS (AI) / FAIL-by-config (STT)
- See AI Fallback Matrix above — **all 4 AI tiers proven deterministically**, every level returned the correct answer, restore verified.
- STT forced-failover routing is correct but lands on dead providers (see STT matrix + Issues).

### 4. STT — Real Transcription — PASS (Deepgram primary)
- WS `/v1/transcribe` connects in 4–9 ms.
- **German (de.pcm)**: accurate full transcript — *"Willkommen zurück. In diesem Tutorial zeige ich euch, wie man effektiv programmieren lernt, Schritt für Schritt mit vielen Beispielen."* — 3 finals, confidences 0.97–1.0, `{text, is_final, confidence, full_text}` all present.
- **English (en.wav, 3.7 s)**: interim transcripts received; clip too short for a final before client close (Deepgram needs ~2 s trailing silence). Transcription confirmed working via interims + server logs.
- **Billing verified at close**: `[WS] Billing OK ... seconds=10.2 trial=false`.
- **Edge cases:** bad auth frame → error `invalid_key_format` + close; non-JSON first frame → error `auth_must_be_json` + close. Both correct.

### 5. Embeddings & Search — PASS
- `/v1/embed`: 768-dim numeric vector from primary `gemini-embedding-2`, p50 625 ms. `shipEmbedMetric` telemetry fires (server log `[Embed] provider=primary ... success=true`), and `/health` embedding telemetry snapshot updated to `requests:3 success:3` with per-model breakdown. Empty text → 400.
- `/v1/search`: Tavily returns 5 results (e.g. "Did TCP just CHANGE??? - YouTube"), 2.7–3.7 s. Empty query → 400.

### 6. Telemetry & Error Logging — PASS
- **Telemetry destinations live**: boot status `axiom=true posthog=true sentry=true`. **Live Axiom ingest probe → HTTP 200 ACCEPTED** into dataset `refract-api`. Wiring: `sttEvent → telemetry.axiomEvent('stt_*')`, `shipEmbedMetric` → Axiom, embed metrics also visible in `/health`.
- **Sentry wiring confirmed**: `process.on('unhandledRejection')` and `process.on('uncaughtException')` both call `telemetry.captureException(...)` before any exit — uncaught-exception-class errors will reach Sentry. (Not force-triggered, to avoid killing the process.)
- **Error logging is clear + contextual**: every error path logs with request-id + status + reason (`[Chat] auth failed req=... status=401 error=auth_required`, `[WS] Auth failed: invalid_key_format`, `[ElevenLabs] Quota exceeded`, `[Admin] Force-failed provider: ...`). Malformed JSON body → clean 400, no crash.
- **Secret scan of the entire 869-line server log**: **NO provider secrets** (Gemini/Groq/Deepgram keys, Sentry DSN, JWTs, private keys) found. **However:** full customer API keys (`refract_sk_...`) appear 105× as WS session identifiers (`session=refract_sk_...:default`). See Issues (MEDIUM).

### 7. Resilience / Real-World — PASS
- **Concurrency**: 10 parallel `fast_mode` chats — all 200, wall 1102 ms, p95 1074 ms, all served by Groq pool (key rotation healthy, no single-key exhaustion leaked to user).
- **Rate limiting**: 135 rapid requests from one IP → 120 passed, **15 × 429 `rate_limited`**, **0 × 500** (graceful, no crash). Limit is `RATE_LIMIT_MAX=120/min`.
- **Graceful degradation / no hang**: with 3 AI providers forced down, fallback to Gemini Pro completed in 3705 ms (well under the 15 s hang threshold).
- **Server stayed healthy** end-to-end: final `/health` = 200, all providers up. **Zero FATAL/ReferenceError/TypeError/uncaughtException** in the full log.

---

## PRIORITIZED ISSUES

### HIGH — STT fallback chain is collapsed to Deepgram-only (no working backup)
- **Impact:** If Deepgram has an outage, STT has no functioning failover. Google STT is hard-disabled and ElevenLabs is out of quota — a single Deepgram incident takes ALL transcription down.
- **Evidence:**
  1. Boot: `[GoogleSTT] Failed to parse GCP credentials JSON ... position 1` → `Provider permanently disabled at startup`. Root cause: the `.env` value `GCP_SERVICE_ACCOUNT_JSON` is **double-escaped** — it begins `{\"type\":\"ser...` (literal backslash-quote) instead of `{"type":"ser...`, so `JSON.parse` fails at char 1. (Server correctly reads `GOOGLE_CREDENTIALS_JSON` OR `GCP_SERVICE_ACCOUNT_JSON`; the value itself is malformed.)
  2. Forced Deepgram down → ElevenLabs selected → `[ElevenLabs] Quota exceeded: You have exceeded your quota` (4× before giving up).
- **Fix:** (a) Re-store the GCP service-account JSON in `.env`/Railway as a single-line, *unescaped* JSON string (or base64) so it parses; set `GCP_PROJECT_ID`. (b) Top up / rotate the ElevenLabs account. Verify both with a forced-Deepgram-down WS run after fixing — expect a real transcript from the backup.

### MEDIUM — Customer API keys logged in plaintext (and shipped to log drains)
- **Impact:** WS STT sessions log the full `refract_sk_...` key as the session identifier (105 occurrences in this run). If Railway logs drain to Axiom/anywhere, customer secrets land in a log store. A log leak becomes a key-compromise.
- **Evidence:** `[WS] Session closed — session=refract_sk_8dOX...full_key...:default`, `[WS/Deepgram] Transcript [FINAL] session=refract_sk_...`. Note the *relay* path already does this right (`hashIdentity(identity)`); only the direct WS path logs raw keys.
- **Fix:** Hash the API key for the `sk` session identifier in the direct WS path (reuse `hashIdentity`/`hashForTelemetry`) as is already done on the relay path. Pure logging change, no behavior impact.

### LOW — `env=development` in telemetry
- **Impact:** Sentry/PostHog events from production would be tagged `development` if `NODE_ENV`/release env isn't set in Railway, muddying dashboards/alerting.
- **Evidence:** boot `[Telemetry] ... env=development`. (Expected locally; verify Railway sets the production env.)
- **Fix:** Ensure the Railway environment sets `NODE_ENV=production` (or whatever `telemetry.status().environment` reads) so prod telemetry is tagged correctly.

### LOW — MiniMax pool thin (1/6 keys) and is the slowest fallback tier
- **Impact:** MiniMax is the primary post-Flash fallback; with 1 key it has the least headroom, and it was the slowest level (4729 ms) when it served. Functionally fine, but the least-resilient AI tier.
- **Fix:** Add MiniMax keys if available; otherwise acceptable since Gemini Pro + Groq Scout sit behind it.

---

## QUOTA CONSUMED (live customer keys)

| Key (plan) | AI requests | Searches | STT |
|---|---|---|---|
| `refract_sk_NZYhPN…` (ultra) | 34 (of 3000) | 0 | 0 |
| `refract_sk_kcGci1…` (pro) | 9 (of 1000) | 2 (of 100) | 0 |
| `refract_sk_8dOXEe…` (standard) | 0 | 0 | 2 short sessions (~10 s + interims) |

**Totals: ~43 AI requests, 2 searches, 2 short STT sessions.** Well under the ~30–50 AI cap budgeted; spread across 3 keys; no key came near its quota.

---

## CLEANUP
- All forced-down providers reset to healthy (verified via `/admin/provider-health`).
- Server killed at end of test.
- All temp QA scripts removed (`_qa_*.mjs`, `/tmp/qa_*.json`, `/tmp/test_keys.json`).
- No keys/trials/billing mutated beyond the unavoidable usage increments above.
</content>
</invoke>
