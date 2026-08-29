# Local Verification Report — Refract Backend Telemetry + STT Relay + Durable Billing

**Date:** 2026-06-14
**Verifier:** automated QA gate (rigorous, live-where-possible)
**Working dir:** `/path/to/refract/refract-api` (nested git repo)
**Node:** v25.9.0
**Scope:** unified backend telemetry (Axiom/PostHog/Sentry), client telemetry sinks, STT external-relay master switch, durable billing + quota lease (migrations 003/004), observability verify script.

---

## OVERALL VERDICT: ✅ YES — everything is working and tracking as designed.

All five sections (A–E) pass. One real defect was found **in the new (untracked) integration tests** — they were not lease-aware and leaked `held` quota reservations into the live DB, which then 402'd subsequent runs. This was **not a production bug**: the F7 quota lease was behaving exactly as designed (refusing to double-grant against an unreleased reservation). I fixed the tests (made the routing suites lease-independent and the lease suite self-cleaning), re-verified, and confirmed zero live-DB residue. Production server code (`server.js`, `lib/telemetry.js`) required no changes.

---

## A. FULL AUTOMATED TEST SUITE — ✅ PASS (all must-pass suites green)

| Suite | Expected | Result | Verdict |
|---|---|---|---|
| `tests/telemetry.test.mjs` | 8 | **8 pass / 0 fail** | ✅ |
| `packages/stt-relay-core/tests/*.test.mjs` | 277 | **277 pass / 0 fail** | ✅ |
| `services/stt-relay/tests/*.test.mjs` | 106 | **106 pass / 0 fail** | ✅ |
| STT endpoint group (session-endpoint, relays-routes, quota-lease, reaper-health, external-relay-bypass) | — | **75 pass / 0 fail** | ✅ (after test fix — see below) |
| `migrations/__tests__/*.test.mjs` | 25 | **25 pass / 0 fail** | ✅ |
| offline regression (`unit-fixes`, `flash-model-picker`) | 56 | **56 pass / 0 fail** | ✅ |
| `node --check server.js / lib/telemetry.js / scripts/verify-observability.mjs` | — | **all OK** | ✅ |
| CLIENT `npm run build:electron` | — | **Done in 1476ms** | ✅ |
| CLIENT `TelemetryRemoteSinks` (7) + `TelemetryService` (8) | 15 | **15 pass / 0 fail** | ✅ |
| CLIENT `npm run typecheck:electron` | 0 errors | **clean, 0 errors** | ✅ |

**Total backend must-pass: 547 tests green (8+277+106+75+25+56) + 15 client tests + typecheck clean.**

### Defect found + fixed (test-only, NOT production)
On the FIRST run the STT endpoint group showed **9 failures, all HTTP 402 (`transcription_quota_exceeded`) where 200 was expected** — every failing case was a **relay-path** integration test.

**Root cause (proven against the live DB, not guessed):**
- The test key the suites select (`standard`, `transcription_minutes_used=0`, remaining 200 min) has plenty of quota — so the 402 was **not** key exhaustion.
- The 402 came from the **F7 quota lease** (`stt_reserve_session`, migration 004). The relay path reserves the credential's FULL remaining budget (12000s) from a **shared per-identity counter**, held until the session finalizes.
- The integration tests **SIGKILL the spawned server** without finalizing, so each relay session-create leaks a `held` reservation. The first leftover orphan (`st_757dadd6-…`, created `00:01:31`, `currently_held=12000`, `available=0`) exhausted the counter; every subsequent relay create on that key correctly returned `granted:false` → 402.
- I confirmed the mechanism by calling `stt_reserve_session` directly: it returned `{"reason":"quota_exhausted","granted":false,"currently_held":12000,"available_seconds":0}` with a matching orphan row and **no corresponding `stt_sessions` row** (pure test residue).
- Disabling the lease for one run (`STT_QUOTA_LEASE_ENABLED=false`) made the relays-routes suite pass 20/20 — confirming the lease/test interaction was the sole cause.

**Fix (the new test files were untracked — never committed):**
- Added `STT_QUOTA_LEASE_ENABLED: 'false'` to the **routing** suites' relay env blocks (`stt-session-endpoint.test.mjs`, `stt-relays-routes.test.mjs`, `stt-external-relay-bypass.test.mjs`). These suites assert region/URL/clamp/admin-control behavior, **not** the lease (which has its own dedicated suite), so they should be lease-independent and idempotent.
- Added a `test.after` cleanup hook to `stt-quota-lease.test.mjs` (which intentionally runs the lease ON) that releases + deletes any `held` reservations it created for the test key. Verified the hook fires (`[Cleanup] released 1 test lease reservation(s)`).
- Re-ran: **75/75 pass, 0 fail**, and a final DB sweep shows **0 held reservations**.

> Note: the task's mention of `tests/stt-comprehensive/fixes/health-system.test.mjs` is moot — that path does not exist in this repo, so there was nothing to run/exclude.

---

## B. OBSERVABILITY — LIVE END-TO-END — ✅ PASS

### B1. `node scripts/verify-observability.mjs` — all three HTTP 200
```
✅ Axiom    — ✓ OK   (HTTP 200) dataset=refract-api
✅ PostHog  — ✓ OK   (HTTP 200) host=https://us.i.posthog.com
✅ Sentry   — ✓ OK   (HTTP 200) project=4511560783036416
```

### B2. Real server boot log
`PORT=8130 node server.js` (real `.env`) → boot log shows:
`[Telemetry] axiom=true posthog=true sentry=true release=2.6.0 env=development` and `/health` → 200. Server killed; port confirmed clear.

### B3. ACTUAL CODE PATH proven (recording fetch) — ✅
Imported `lib/telemetry.js` **exactly as server.js does** (`createTelemetry()`), replicated `sttEvent()` verbatim (`telemetry.axiomEvent('stt_'+event, fields)`), and drove it through the real `.env` with a **recording fetchImpl**. Captured 3 outbound requests and asserted URL + method + auth + shape:
- **Axiom** → `POST https://api.axiom.co/v1/datasets/refract-api/ingest`, header `Authorization: Bearer xaat-…`, body `[{ _time, kind:"stt_session_issued", service:"refract-api", env, …fields }]`. ✅
- **PostHog** → `POST https://us.i.posthog.com/capture/`, body `{ api_key, event, distinct_id:<hash>, properties:{service,env,…} }`. ✅
- **Sentry** → `POST …/api/4511560783036416/envelope/`, header `X-Sentry-Auth: Sentry sentry_version=7,…`, valid 3-line envelope. ✅

### B4. REDACTION on the live path — ✅ (with corrected threat model)
A first naive assertion flagged the PostHog `api_key` and Sentry DSN as "leaks" — that was a **false positive in my harness**, not the code. Corrected threat model + re-verified:
- **Axiom INGEST token** appears ONLY in its `Authorization` header — **never in any request body**. ✅
- **Supabase SERVICE key / URL** appear **nowhere** (no body, no header). ✅
- **Raw identity** (`user-uuid-…`) is shipped as a sha256 hash (`user_hash`); the raw id and a synthetic raw transcript string appear **nowhere**. ✅
- PostHog project `api_key` (in body) and Sentry DSN public key (in envelope header) are **protocol-required and public-by-design** (they ship in every browser SDK) — their presence in those exact locations is correct, not a leak.

Result: `PASS — real code path correct; no Axiom-token/service-key/raw-id/transcript leak`.

### B5. NO-OP guarantee — ✅
- With empty env, all four senders fire **zero fetches** and `status()` returns `{axiom:false,posthog:false,sentry:false}`.
- Booted the real server with observability vars explicitly blanked → `[Telemetry] axiom=false posthog=false sentry=false`, `/health` 200, `/v1/stt/relays` 401 (auth required, functioning normally). The server boots and functions identically with observability off.

---

## C. STT RELAY MASTER SWITCH — LIVE BEHAVIOR — ✅ PASS (real spawned server)

Spawned `server.js` with relay URLs + `STT_RELAY_ENABLE_PERCENT=100` + `STT_RELAY_FORCE_REGION=us` configured, `STT_QUOTA_LEASE_ENABLED=false` (routing test, doesn't touch the live counter), and a valid live key.

**C1 — switch OFF (default, env unset):**
- `POST /v1/stt/session` → **200**, `selected_region:"railway"`, `relay_ws_url:<Railway URL>`, `fallback_relay_ws_url:null` — relays fully bypassed **despite being configured**. ✅
- Boot log: `background checks NOT started — external relays disabled`. ✅
- `GET /v1/stt/relays` → `external_relay_enabled:false`. ✅
- `GET /admin/stt-relays` → `runtime.external_relay_enabled:false`, `background_checks_running:false`. ✅ (admin secret from `.env` validated)

**C2 — switch ON (`STT_EXTERNAL_RELAY_ENABLED=true`):**
- `POST /v1/stt/session` → **200**, `selected_region:"us"`, `relay_ws_url:<US relay URL>` — relay routing reactivated. ✅
- Boot log: `background /healthz checks every 30000ms`. ✅
- `GET /v1/stt/relays` → `external_relay_enabled:true`. ✅

This is the core deliverable, proven against a **real spawned server** (not just the unit test). Verified **0 held reservations leaked** (lease off).

---

## D. DURABLE BILLING / QUOTA LEASE — LIVE DB — ✅ PASS

### D1. Full lease lifecycle (session prefix `qa_probe_`, real Supabase service key)
| Step | Call | Result |
|---|---|---|
| reserve | `stt_reserve_session(limit 600, request 30)` | `granted:true, granted_seconds:30, available_seconds:600` ✅ |
| idempotent | same `session_id` again | `granted:true, idempotent:true, granted_seconds:30`; **exactly 1 reservation row** (not double-counted) ✅ |
| flush | `stt_flush_usage(session, seq 1, metrics{billable_seconds:12})` | `applied:true, billable_seconds:12` ✅ |
| finalize | `stt_finalize_session(session, metrics, close_code 1000)` | `applied:true`; **reservation released by trigger** (status `released`); session status `finalized` ✅ |
| reconcile | `stt_reconcile_abandoned(999999999)` | runs, returns count `0`, no error ✅ |
| cleanup | DELETE all `qa_probe_%` from 3 tables | **0 residue** re-verified across `stt_sessions`, `stt_usage_events`, `stt_quota_reservations` ✅ |

(Used correct migration signatures: `stt_flush_usage(p_session_id, p_seq, p_metrics jsonb)`, `stt_finalize_session(p_session_id, p_metrics jsonb, p_close_code, p_close_reason, p_error_code)`, `stt_reconcile_abandoned(p_older_than_seconds)`.)

### D2. Existing /v1/transcribe billing RPCs present + untouched — ✅
- `increment_transcription_minutes({key_id, minutes})` — EXISTS (0-delta probe returned ok, no mutation). Server calls it with `{key_id, minutes}` (server.js:1991). ✅
- `increment_trial_stt_seconds({trial_id, secs})` — EXISTS (DB confirmed signature `increment_trial_stt_seconds(secs, trial_id)`; my first probe used the wrong param name `seconds`, the function is present). Server calls it with `{trial_id, secs}` (server.js:1944) — signature matches. ✅
- Confirmed **no billing mutation** from the probes (api_key `transcription_minutes_used` unchanged 0→0).

---

## E. INTEGRITY / NO-REGRESSION — ✅ PASS

### E1. server.js is ADDITIVE; /v1/transcribe untouched — ✅
- `git diff HEAD --numstat server.js` → **`743  0`** (743 additions, **0 deletions**).
- Deletion-line count across the whole server.js diff: **0**.
- The only `transcribe` mentions in the diff are **added** lines (a comment "`/v1/transcribe below is byte-for-byte untouched`" + the Railway fallback URL default). No `-` line touches the transcribe WS handler → the active STT path is byte-for-byte unchanged.
- The 743 additions are exactly: telemetry import + instantiation + crash-guard `captureException`, the master switch, the quota lease, and the `/v1/stt/session` + `/v1/stt/relays` + `/admin/stt-relays*` endpoints.

### E2. No secrets committed; `.env` gitignored — ✅
- `git check-ignore .env` → `.env` (gitignored). ✅
- Scanned `lib/telemetry.js`, `scripts/`, the new tests, `server.js`, migrations 003/004, and the **full inner+outer git diffs** for the real credential fingerprints (`xaat-d844b7a8`, `phc_ChDiAyHpkbvG`, `0ea3140009e44e`, the Supabase JWT prefix, the Supabase URL host) → **0 hits everywhere**.
- All credential access in the new/changed code is via `process.env.*` reads only (verified in `lib/telemetry.js` and `scripts/verify-observability.mjs`). No hardcoded secrets in the client `TelemetryService.ts`.

### E3. Server boots cleanly in BOTH modes — ✅
- Railway-only default: `/health` 200, **0** ReferenceError/TypeError/FATAL/unhandled lines.
- Relays enabled: `/health` 200, background `/healthz` checks started, **0** error lines.

---

## LIVE vs MOCK BREAKDOWN

**Proven LIVE (real endpoints / real spawned server / real Supabase):**
- Observability ingest to Axiom + PostHog + Sentry (all HTTP 200, live).
- Real server boot with real `.env` (telemetry status line; both modes).
- The actual `sttEvent → telemetry.axiomEvent` code path (recording-fetch on the real module + real env: URL, auth header, payload shape, redaction).
- No-op guarantee on a real booted server with observability unset.
- STT master switch OFF/ON against a real spawned `server.js` + live key (session-create, `/v1/stt/relays`, `/admin/stt-relays`, boot-log gating of background probes).
- Full quota-lease lifecycle (reserve / idempotent / flush / finalize / trigger-release / reconcile) against the **live Supabase** via the real migration-003/004 RPCs.
- Existence + signature match of the active `/v1/transcribe` billing RPCs against live Supabase (non-mutating probes).

**Unit/source-test only (not exercised against a live relay backend):**
- The relay WS data-plane (`services/stt-relay`, `packages/stt-relay-core`) is covered by 383 unit tests but not a live VPS relay (the external relays are intentionally dormant — that is the whole point of the master switch being OFF by default).
- `/v1/transcribe` live STT streaming itself was not exercised end-to-end (would need a live audio session); its **infrastructure** is proven intact via the 56 offline regression tests + the additive/0-deletion diff.

---

## ISSUES FOUND

| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | **Low (test-only)** | The new STT relay integration tests were not lease-aware: relay-path tests SIGKILL the server without finalizing, leaking `held` quota reservations into the **live DB**, which then 402'd subsequent runs (and other relay suites). Production code was correct (lease working as designed). | **FIXED** — routing suites now run lease-off; the lease suite self-cleans via a `test.after` hook. Re-verified 75/75 green + 0 DB residue. |
| 2 | **Informational** | My first redaction assertion false-positived on the PostHog publishable key and Sentry DSN (both public-by-design / protocol-required). | **N/A** — harness corrected; no code issue. The real code never leaks the Axiom ingest token, Supabase service key, raw identity, or transcript. |

No production-code defects found.

---

## TEST RESIDUE CLEANUP — ✅ CONFIRMED ZERO

- Live DB: `0` `qa_probe_%` rows across `stt_sessions` / `stt_usage_events` / `stt_quota_reservations`; `0` `held` reservations total (final sweep).
- No production billing data mutated (0-delta probes only; verified unchanged).
- No stray `node server.js` processes; ports 8130/8131/8140/8141/8200–8202 clear.
- No temp scripts left in the repo; `/tmp/qa_*.log` boot logs removed.
- The only persistent changes are the three test-file edits (additive `STT_QUOTA_LEASE_ENABLED:'false'` env flags + a self-cleaning `test.after` hook) in the previously-untracked test files.
