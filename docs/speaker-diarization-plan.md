# Speaker Diarization & Labeling Plan (Phase 9)

Date: 2026-06-20

## 1. Current speaker model (audit)

- Transcript unit: `TranscriptSegment` (`electron/SessionTracker.ts:8`) =
  `{ marker?, speaker: string, text, timestamp, final, confidence? }`. **No diarized
  speaker id, no audio-channel field, no segmentId.**
- `speaker` is in practice one of `'user'`, `'interviewer'`, `'assistant'` (assigned by the
  STT layer, not by a diarizer). `SessionTracker.mapSpeakerToRole` (line 611) collapses to
  `user | interviewer | assistant`.
- **Two-channel capture, not diarization:** `electron/main.ts:1574 createSTTProvider(speaker:
  'interviewer' | 'user')` spins up *two separate STT streams* — mic → `user`, system audio
  → `interviewer`. The relay uses `${key}:${channel}` (`system`/`mic`) as the session key.
  So "who" is really "which audio source," and **all remote speakers collapse into one
  `interviewer` label**.
- **STT providers emit no diarization today:** Deepgram/Google/Soniox/ElevenLabs/OpenAI/local
  Whisper adapters under `electron/audio/*STT.ts` are used as single-stream transcribers;
  none request or surface speaker ids / `multichannel` / `diarize`.
- **DB:** transcript segments persist `speaker` per row; there is room to store a per-meeting
  rename map without migration (we use `summary_json.speakerLabels`).
- **UI:** `MeetingDetails.tsx` renders the raw `speaker` string; **no rename UI** exists.

## 2. MVP shipped this round — editable speaker labels

Implemented in `electron/services/meeting/SpeakerLabelService.ts` +
`TranscriptNormalizer.canonicalSpeaker`:

- **Canonical ids:** `user/me` → `me`; `interviewer/them/system/assistant` → `speaker_1`;
  named speakers → slug id. Display defaults: `Me`, `Speaker 1`, `Speaker 2`, …
- **Rename map** stored per meeting in `summary_json.speakerLabels`
  (`SpeakerLabelMap = Record<canonicalId, displayName>`), e.g.
  `{ "speaker_1": "John from Client", "me": "Evin" }`. No DB migration.
- **Apply to all:** `applyLabels()` rewrites every matching segment's display name; renames
  are never overwritten by auto-derivation.
- **Summary integration:** when notes are regenerated, the relabeled transcript feeds the
  summarizer, so evidence refs and action-item owners use the user's names. Evidence carries
  `speakerId` + resolved `speakerName`.
- **UI (Phase 12):** rename speaker, apply to all matching segments, regenerate notes with
  labels, show names in transcript + evidence.

## 3. Provider diarization integration — Deepgram (IMPLEMENTED, opt-in 2026-06-21)

Shipped behind flag `speakerDiarizationV1` (default OFF), isolated to the STT adapter so it
can never destabilize the realtime path for users who don't enable it:

- `DeepgramStreamingSTT.setDiarization(true)` adds `diarize: true` to the live connect config.
  `dominantSpeakerIndex(words)` picks the most-frequent per-word `speaker` integer in each
  result and emits `speakerId: "speaker_<n+1>"` on the transcript event (omitted when off / no
  index present, so the default payload is byte-for-byte unchanged).
- `main.ts createSTTProvider`: enables diarization ONLY on the `interviewer` (system) channel
  — the mic channel is always `me`, so diarizing it adds cost with no benefit.
- `TranscriptSegment.speakerId` (additive optional) carries it through
  `handleTranscript → SessionTracker.fullTranscript → snapshot → V3 normalizer`.
- `TranscriptNormalizer`: a provider `speakerId` **wins** over the channel-derived id and sets
  the display name (`speaker_2` → "Speaker 2"), so multiple remote speakers are distinguished;
  user renames still override (resolved at render via `SpeakerLabelService`).
- Tests: diarized-id precedence + back-compat (no id → unchanged) in `MeetingNotesV3.test.mjs`.

Remaining for full parity: per-speaker confidence → `sourceQuality.speakerQuality`, and
mapping provider ids stably across reconnects within one meeting.

### When we enable any other diarizing STT provider:

- **Deepgram:** `diarize=true` (and/or `multichannel=true`) returns `speaker: <int>` per word.
  Map provider speaker int → canonical `speaker_<n>`; keep provider speaker confidence.
- **Soniox / others:** similar speaker-tag fields where supported.
- Rules:
  - Preserve provider speaker ids; map to local canonical ids deterministically.
  - Store speaker confidence if available (drives `sourceQuality.speakerQuality`).
  - **Never overwrite a user-renamed label.**
  - Low-confidence diarization → fall back to generic `Speaker N` labels.
- Plumbing required: add optional `speakerId`/`channel`/`confidence` to `TranscriptSegment`,
  thread it from the STT adapter through `SessionTracker` and persistence. The normalizer
  already accepts `speakerId` on raw segments, so the summarization side is ready.

## 4. Audio-channel heuristic (already half-present)

Refract already captures mic and system audio separately:
- Treat the **mic** channel as `me`.
- Treat the **system** channel as remote → currently one bucket `speaker_1`.
- If the system channel has multiple distinct speakers and diarization is unavailable, keep
  a single `speaker_remote`/`speaker_1` label rather than guessing names.
- This heuristic is the current MVP's backbone; diarization (above) refines the remote bucket
  into `speaker_1..n`.

## 5. Summary integration example

Transcript fed to the summarizer (after labels applied):
```
[00:02:15] John from Client: We’ll review the contract by Tuesday.
```
Resulting action item:
```
John from Client will review the contract by Tuesday.   (evidence: speaker "John from Client", 00:02:15)
```

## 6. Rollout

- Flag: `speakerLabelsV1` (default OFF until UI ships + verified, then ON with V3).
- Storage and service are additive and backward-compatible; meetings without labels render
  default names.

## 7. Limitations

- True per-utterance diarization within the remote channel is **not** available until a
  diarizing provider is enabled; the MVP distinguishes me-vs-remote and lets the user name
  remote speakers manually.
- Renaming is per meeting (no cross-meeting speaker identity yet).
