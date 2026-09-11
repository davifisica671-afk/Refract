# 18 — Making the Server Fully Functional (Railway-only mode)

**TL;DR:** Your Railway server is **already a live, fully-configured production backend** — `.env`
already has Supabase, Gemini, Groq, Deepgram, ElevenLabs, MiniMax, Dodo, Tavily, Resend, Telegram,
Google OAuth, and `TRIAL_JWT_SECRET`. In Railway-only mode the **active STT path is the existing
`/v1/transcribe` WebSocket**, which needs **none** of the new relay env vars. So "fully functional"
is a *short* list of additions, not a from-scratch setup.

---

## What's the active flow right now

```
Desktop App  →  Railway /v1/transcribe (WS)  →  Deepgram → Google STT → ElevenLabs
```

- The client defaults to `regionalSttRelayEnabled = false`, so it **does not call** the new
  `/v1/stt/session` endpoint — it connects straight to `/v1/transcribe` exactly as it always has.
- `STT_EXTERNAL_RELAY_ENABLED` defaults **false**, so even if a client *did* call session-create, the
  server hands back the Railway URL.

**Net: the server is functional for STT today with the existing `.env`.** Nothing is required to keep
it working. The lists below are about making the *new* code paths real + adding the optional polish.

---

## Tier 1 — REQUIRED for the server to be fully functional

These are the only things the existing deployment is **missing**. Two of them are already covered.

### 1.1 Apply the two new database migrations  ⬅ **the one true must-do**
The new durable-billing + quota-lease tables/RPCs don't exist in Supabase yet. They're harmless to
apply now (additive, idempotent) and are needed the moment any relay/session-billing path runs.

In the **Supabase SQL editor**, run, in order:
```
refract-api/migrations/003_stt_durable_billing.sql
refract-api/migrations/004_stt_quota_lease.sql
```
Verify:
```sql
select tablename from pg_tables where tablename like 'stt_%';
-- expect: stt_sessions, stt_usage_events, relay_health_events, stt_quota_reservations
select proname from pg_proc where proname like 'stt_%';
-- expect: stt_flush_usage, stt_finalize_session, stt_reconcile_abandoned,
--         stt_reserve_session, stt_release_reservation (+ trigger fn)
```
> Why now even in Railway-only mode? The `/v1/transcribe` path bills via the **old** RPCs
> (`increment_transcription_minutes` / `increment_trial_stt_seconds`) which are untouched and already
> live — so STT billing keeps working without these. But applying 003+004 now means the instant you
> ever flip relays on, billing is durable. Zero downside to applying early.

### 1.2 `TRIAL_JWT_SECRET` — ✅ already set
Confirmed present in `.env` with a real value. No action.

### 1.3 Supabase + all AI/STT/payment keys — ✅ already set
Confirmed in `.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY*`,
`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `MINIMAX_API_KEY`, `GCP_SERVICE_ACCOUNT_JSON`, `DODO_*`,
`TAVILY_API_KEY`, `RESEND_API_KEY`, `TG_*`, `GOOGLE_CLIENT_*`. No action.

**So Tier 1 = "apply migrations 003 + 004." That's it.**

---

## Tier 2 — RECOMMENDED (make the new code paths first-class + safe)

Add these to the **Railway env** (and mirror to local `.env` if you test locally).

### 2.1 `STT_SESSION_TOKEN_SECRET` — set it even in Railway-only mode
```
STT_SESSION_TOKEN_SECRET=<openssl rand -hex 48>
```
Why: without it, `POST /v1/stt/session` returns `503 feature_unavailable`. In Railway-only mode the
client doesn't call that endpoint by default, so 503 is harmless — **but** setting it now means the
endpoint is ready, the value is already in place for any future relay enablement, and you avoid a
"why is this 503" surprise. Generate once, store in your secret manager. (The relays would later need
the byte-identical value.)

### 2.2 The relay master switch + safe defaults (explicit is better than implicit)
All of these have correct defaults already; setting them explicitly documents intent in the Railway
dashboard:
```
STT_EXTERNAL_RELAY_ENABLED=false     # Railway-only mode (the default)
STT_QUOTA_LEASE_ENABLED=true         # default; only matters when relays are on
STT_REAPER_INTERVAL_MS=0             # default off; pg_cron not needed in Railway-only mode
```

---

## Tier 3 — OPTIONAL (observability — wired, silent until set)

Add to **Railway env** (control plane) and/or the **packaged desktop build** (client). Same names.
Full detail + verification in `docs/17-observability-setup.md`.
```
AXIOM_TOKEN=<token>      AXIOM_DATASET=refract-api
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
POSTHOG_API_KEY=<key>    POSTHOG_HOST=https://app.posthog.com
```
Leave blank → silent no-op (the server logs `[Telemetry] axiom=false posthog=false sentry=false`).

---

## Step-by-step: bring it fully up

1. **Apply migrations** (Tier 1.1) — Supabase SQL editor, run 003 then 004, verify with the queries above.
2. **Set `STT_SESSION_TOKEN_SECRET`** in Railway (Tier 2.1): `openssl rand -hex 48` → paste into Railway → Variables.
3. **(Optional) add the explicit relay defaults** (Tier 2.2) and **observability keys** (Tier 3) in Railway.
4. **Redeploy** Railway (it auto-deploys on env change, or push to the connected branch — `node server.js`).
5. **Verify** (below).

---

## Verify it's fully functional

### Health + boot
```
curl https://api.refract.software/health
# → { ok: true, version: "2.6.0", ... }
```
Railway deploy logs should show:
```
[Telemetry] axiom=… posthog=… sentry=…
[STTRelay] STT_EXTERNAL_RELAY_ENABLED=false — external US/Asia relays BYPASSED; all STT stays on Railway …
```

### STT works (the active path)
- Open the desktop app, start a meeting → live transcription flows (Deepgram primary). This exercises
  `/v1/transcribe` end-to-end — the path that needs no new env.

### New endpoints respond correctly
```
# session-create: 503 if you DIDN'T set the secret, or a railway-targeted session if you DID
curl -X POST https://api.refract.software/v1/stt/session \
  -H "Content-Type: application/json" -d '{"key":"<a valid refract_sk_ key>","channel":"system"}'
# with the secret set → { selected_region: "railway", relay_ws_url: "wss://api.refract.software/v1/transcribe", ... }

# relay status (shows the master switch off)
curl https://api.refract.software/v1/stt/relays -H "Authorization: Bearer <key>"
# → { external_relay_enabled: false, relays: [], railway_fallback_ws_url: "...", ... }
```

### Billing still works
A completed meeting increments `api_keys.transcription_minutes_used` (paid) or
`free_trials.stt_seconds_used` (trial) via the **existing** RPCs — unchanged by any of this.

---

## What you do NOT need for Railway-only mode

- ❌ **No VPS** (US/Asia relays stay off)
- ❌ **No Cloudflare DNS / Load Balancer** (no relay hostnames needed)
- ❌ **No Fly.io**
- ❌ **No `STT_RELAY_US_URL` / `STT_RELAY_ASIA_URL`** (leave unset)
- ❌ **No reaper / pg_cron** (relays off → nothing to reconcile; `STT_REAPER_INTERVAL_MS=0`)
- ❌ **No new payment/AI/email provider** — all already configured

When you later decide relays are worth it, follow `docs/16-external-relay-disabled.md` §G (re-enable)
and `docs/13-rollout-checklist.md` (provision VPS, DNS, ramp).

---

## One-glance checklist

| Item | Status | Action |
|------|--------|--------|
| Supabase + all AI/STT/payment keys | ✅ in `.env` | none |
| `TRIAL_JWT_SECRET` | ✅ set | none |
| **Migrations 003 + 004** | ⬜ **not applied** | **apply in Supabase SQL editor** |
| `STT_SESSION_TOKEN_SECRET` | ⬜ unset | `openssl rand -hex 48` → Railway (recommended) |
| `STT_EXTERNAL_RELAY_ENABLED=false` | ✅ default | optionally set explicitly |
| Axiom / Sentry / PostHog | ⬜ unset | optional — add keys anytime |
| VPS / DNS / Fly / reaper | n/a | **not needed in Railway-only mode** |
