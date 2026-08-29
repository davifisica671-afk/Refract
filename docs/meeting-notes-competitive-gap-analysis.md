# Meeting Notes — Competitive Gap Analysis (Phase 2)

Date: 2026-06-20
Compares **Refract** (current working tree, V3 path enabled) against **Granola**,
**Otter.ai**, **Fireflies**, and **Refract-style** assistants on *user-visible output*,
not internal architecture.

Scoring: ✅ strong · ◐ partial · ❌ missing/weak. "After" = target post-implementation.

| # | Dimension | Granola | Otter | Fireflies | Refract | Refract (now) | Refract (after) |
|---|---|---|---|---|---|---|---|
| 1 | Note readability | ✅ | ◐ | ◐ | ✅ | ◐ | ✅ |
| 2 | 15-second skim value | ✅ | ❌ | ◐ | ✅ | ◐ (TLDR) | ✅ (TLDR + What changed) |
| 3 | Decisions | ◐ | ❌ | ◐ | ◐ | ✅ | ✅ |
| 4 | Action items | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ |
| 5 | Owners | ◐ | ❌ | ✅ | ❌ | ✅ | ✅ |
| 6 | Deadlines | ◐ | ❌ | ◐ | ❌ | ✅ | ✅ |
| 7 | Open questions | ❌ | ❌ | ❌ | ◐ | ✅ | ✅ |
| 8 | Risks / blockers | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (**differentiator**) |
| 9 | Follow-up draft quality | ✅ | ❌ | ✅ | ◐ | ❌ rigid | ✅ LLM prose |
| 10 | Speaker attribution | ◐ | ✅ | ✅ | ❌ | ❌ | ◐ editable labels |
| 11 | Searchability | ✅ | ✅ | ✅ | ◐ | ◐ | ◐→✅ |
| 12 | Meeting memory | ◐ | ◐ | ✅ | ◐ | ◐ | ✅ |
| 13 | Cross-meeting recall | ◐ | ❌ | ✅ | ❌ | ❌ | ◐ ("still open from last time") |
| 14 | Regeneration / editing | ✅ | ◐ | ◐ | ◐ | ❌ | ✅ regenerate + mode |
| 15 | Export / copy readiness | ✅ | ✅ | ✅ | ◐ | ◐ (recipes hidden) | ✅ surfaced |
| 16 | Mode-specific usefulness | ◐ templates | ❌ | ◐ | ◐ | ✅ 7 modes | ✅ + auto-detect |
| 17 | Privacy / bot-free capture | ◐ | ❌ bot | ❌ bot | ✅ | ✅ on-device + scopes | ✅ |
| 18 | Long meeting handling | ✅ | ✅ | ✅ | ◐ | ✅ chunk/reduce | ✅ + strategy selector |
| 19 | Trust / evidence / timestamps | ◐ | ◐ | ◐ | ❌ | ✅ evidence | ✅ + transcript jump |
| 20 | UI presentation | ✅ | ◐ | ◐ | ✅ | ◐ | ✅ |

## Where Refract already wins
- **Risks/blockers + open questions as first-class sections** — none of the four do this
  well. This is the headline differentiator: a Refract note tells you *what is still
  unresolved and what could go wrong*, not just what was said.
- **Decision vs discussion separation** with confidence + evidence.
- **Privacy posture** — on-device capture, no meeting bot joining the call, provider data
  scopes that can keep transcripts off the cloud entirely.
- **7 purpose-built modes** vs generic one-size notes.

## Where Refract must close gaps (this round)
1. **Follow-up draft** — the single most visible quality gap. Competitors send a clean,
   human paragraph; Refract sends bullet scaffolding. → Phase 8 LLM generator.
2. **Speaker attribution** — Otter/Fireflies brand on "who said what". Refract has no
   diarization and no rename. → Phase 9 editable labels MVP + plan.
3. **Regenerate / edit** — table stakes. → Phase 12 + IPC.
4. **Skim layout** — surface `whatChanged` + a tight top block. → Phase 5/12.
5. **Export surfaced** — recipes exist but are hidden. → Phase 12.
6. **Mode auto-detect** — reduce the "wrong template" failure mode. → Phase 10.

## Target product standard

A great Refract meeting note must answer, in order, in under 15 seconds of skimming:

1. **What changed?** → `whatChanged[]` + `tldr[]` at the very top.
2. **What was decided?** → Decisions (confirmed only, evidence-backed).
3. **Who owns what (by when)?** → Action items with owner + deadline + explicit/inferred.
4. **What is still unresolved?** → Open questions.
5. **What could go wrong?** → Risks / blockers with severity.
6. **What should I send now?** → A copy-ready follow-up draft in human prose.
7. **What should I remember next time?** → Cross-meeting carryover + memory.
8. **How do I know it's true?** → Evidence (speaker + timestamp + quote) that jumps to the
   transcript.

Every claim is **inspectable** (evidence), **mode-appropriate** (template sections),
**trustworthy** (confidence + source-quality warnings), and **actionable**
(copy/regenerate/export). Empty sections never render. Old saved meetings still open.
