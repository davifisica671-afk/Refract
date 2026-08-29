// SpeakerLabelService.ts (Fase 9, MVP)
// Editable speaker labels. Refract's STT pipeline emite two logical speakers today
// (`user` → mic, `interviewer`/system → remote); verdadeiro diarization é não disponível ainda
// (see docs/speaker-diarization-plan.md). This sserviço
//   - deriva canonical speaker ids de raw transcript speaker strings,
//   - resolves a exibir nome para an id, honoring a per-meeting user renomear mmapa
//   - relabels transcript segments + evidence refs para summary regeneration.
//
// Storage: o renomear mapa lives em summary_json.speakerLabels (a SpeakerLabelMap). Não DB
// migration — antigo meetings simplesmente lack o kchave User renames são nunca overwritten por
// auto-derivation.

import type { TranscriptSegment } from '../../SessionTracker';
import type { SpeakerLabelMap } from './MeetingSummaryV3';
import { canonicalSpeaker } from './TranscriptNormalizer';

export interface SpeakerInfo {
  speakerId: string;
  defaultName: string; // auto-derived (e.g. "Me", "Speaker 1")
  displayName: string; // user rename if present, senão defaultName
  isRenamed: boolean;
  segmentCount: number;
}

export class SpeakerLabelService {
  // Default exibir nome para a canonical id (independent de qualquer transcript).
  defaultDisplayName(speakerId: string): string {
    if (speakerId === 'me') return 'Me';
    const m = /^speaker_(\d+)$/.exec(speakerId);
    if (m) return `Speaker ${m[1]}`;
    if (speakerId === 'unknown') return 'Unknown';
    // Named id derived de a nome sstring title-case o slug.
    return speakerId.split('_').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
  }

  // Resolve exibir nome para an id given a renomear mmapa
  resolve(speakerId: string | undefined, labels?: SpeakerLabelMap): string {
    if (!speakerId) return 'Unknown';
    const renamed = labels?.[speakerId];
    if (renamed && renamed.trim()) return renamed.trim();
    return this.defaultDisplayName(speakerId);
  }

  // Enumerate o distinct speakers present em a transcript, com counts + exibir names.
  listSpeakers(transcript: TranscriptSegment[], labels?: SpeakerLabelMap): SpeakerInfo[] {
    const counts = new Map<string, number>();
    for (const seg of (Array.isArray(transcript) ? transcript : [])) {
      const { speakerId } = canonicalSpeaker(seg.speaker);
      counts.set(speakerId, (counts.get(speakerId) || 0) + 1);
    }
    // Stable oordenar me fprimeiro então speaker_N ascending, então named, então unknown lúltimo
    const order = (id: string): number => {
      if (id === 'me') return 0;
      const m = /^speaker_(\d+)$/.exec(id);
      if (m) return 100 + Number(m[1]);
      if (id === 'unknown') return 100000;
      return 1000;
    };
    return [...counts.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
      .map(([speakerId, segmentCount]) => {
        const defaultName = this.defaultDisplayName(speakerId);
        const renamed = labels?.[speakerId];
        const isRenamed = Boolean(renamed && renamed.trim() && renamed.trim() !== defaultName);
        return { speakerId, defaultName, displayName: isRenamed ? renamed!.trim() : defaultName, isRenamed, segmentCount };
      });
  }

  // Aplica renomear labels para raw transcript segments, producing segments cujo `speaker`
  // campo carries o resolved exibir nome (used como entrada para summary regeneration então
  // evidence e action-item owners uso o user's names).
  applyLabels(transcript: TranscriptSegment[], labels?: SpeakerLabelMap): TranscriptSegment[] {
    if (!labels || Object.keys(labels).length === 0) return transcript;
    return (Array.isArray(transcript) ? transcript : []).map(seg => {
      const { speakerId } = canonicalSpeaker(seg.speaker);
      const renamed = labels[speakerId];
      if (renamed && renamed.trim()) return { ...seg, speaker: renamed.trim() };
      return seg;
    });
  }

  // Valida + sanitize a user-supplied renomear mapa antes persisting.
  sanitizeLabelMap(input: unknown): SpeakerLabelMap {
    const out: SpeakerLabelMap = {};
    if (!input || typeof input !== 'object') return out;
    for (const [id, name] of Object.entries(input as Record<string, unknown>)) {
      const cleanId = String(id).slice(0, 80).trim();
      const cleanName = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (cleanId && cleanName) out[cleanId] = cleanName;
    }
    return out;
  }

  // Mescla a novo renomear dentro de an existing mapa (new entries win; vazio nome cllimpa
  mergeLabels(existing: SpeakerLabelMap | undefined, updates: SpeakerLabelMap): SpeakerLabelMap {
    const out: SpeakerLabelMap = { ...(existing || {}) };
    for (const [id, name] of Object.entries(updates)) {
      if (name && name.trim()) out[id] = name.trim();
      else delete out[id];
    }
    return out;
  }
}
