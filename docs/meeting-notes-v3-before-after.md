# Meeting Notes V3 — Before / After

Date: 2026-06-20

## Input excerpt (60-min product sync, abridged)

```
[00:05] Maya: We agreed to keep PostHog as the likely analytics provider, but retention still needs privacy review.
[21:13] Ari: I’ll draft the retention proposal by Friday.
[38:40] Maya: Open question — what retention window will legal actually approve?
[45:02] Maya: The blocker is legal approval. We cannot launch analytics until that is resolved.
[58:30] Ari: Let’s revisit the dashboard scope next week.
```

## BEFORE (legacy V2 single-pass)

```
Overview: The meeting discussed analytics and next steps.

Action items:
- Follow up on analytics

Key points:
- PostHog was discussed
- Retention was mentioned
```

Problems: generic phrasing; no decision/discussion separation; no owner/deadline/evidence;
open question and blocker lost; for a long meeting the middle/end could be missing entirely
(prefix truncation); follow-up draft (if any) was a rigid bullet scaffold.

## AFTER (V3)

```
[ Regenerate notes ] [ Show evidence ]
This looks like a Team Meet meeting (notes used General).  [ Regenerate as Team Meet ]

TLDR
- PostHog is preferred, but analytics retention still needs privacy/legal review.
- Ari: draft the retention proposal by Friday.
- Legal approval blocks the analytics launch.

What changed
- PostHog selected as the likely analytics provider (pending retention review).

Decisions
- Keep PostHog as the analytics provider, pending privacy retention review.  (medium confidence)
  ↳ 00:05 · Maya · “keep PostHog as the likely analytics provider”

Action Items
- Ari — draft the retention proposal by Friday  [explicit] [high confidence]
  ↳ 21:13 · Ari · “I’ll draft the retention proposal by Friday.”
- Revisit the dashboard scope next week  [inferred] [low confidence]
  ↳ 58:30 · Ari

Open Questions
- What retention window will legal approve?  (open)
  ↳ 38:40 · Maya

Risks / Blockers
- Analytics launch is blocked until legal approval.  (high severity)
  ↳ 45:02 · Maya · “We cannot launch analytics until that is resolved.”

Follow-up draft   [ Copy ] [ Regenerate ] [ Tone ▾ ]
Subject: Follow-up: analytics retention still needs privacy review

Hi team — quick recap of today. We’re moving ahead with PostHog as our analytics
provider, with the retention policy still pending privacy and legal review. Ari will
have the retention proposal drafted by Friday. The one open question is what retention
window legal will actually approve, and we can’t launch analytics until that approval
lands. We’ll revisit dashboard scope next week.
```

Benefits: skim in 15 seconds; decisions vs discussion separated; owners + deadlines +
explicit/inferred + confidence; open question and blocker first-class; every claim has
clickable evidence (jumps to the transcript timestamp); a human, copy-ready follow-up draft;
meeting-type auto-detected with a one-click regenerate; full-transcript coverage via
chunk→reduce (no prefix truncation).

## Schema (stored)

`detailedSummary.schemaVersion === 3` with `tldr`, `whatChanged`, `decisions`, `actionItemsV3`
(+ `actionItemsStructured` bridge), `openQuestions`, `risks`, `sectionsV3`, `followUpDraft`
(object), `timeline`, `people`, `topics`, `sourceQuality`, `mode` (selected + detected),
`generation` (strategy/chunkCount/durationMs/warnings), `speakerLabels`, `crossMeeting`,
`recipes`. Old rows keep their shape and render through the V2 path.
