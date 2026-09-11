/** SmartMeetingService — Smart Meeting Desk local (sem LLM, sem rede).
 * Cinco camadas sobre reunioes salvas: preMeeting, decisionDrift,
 * commitments, health, followUp. Nunca lanca: DB indisponivel => nulos/vazios.
 */
import type { DatabaseManager, Meeting } from '../db/DatabaseManager';
import type { CalendarEvent } from './CalendarManager';
export interface SmartMeetingWorkspaceParams { meetingId?: string; event?: Partial<CalendarEvent> | null; }
export interface SmartMeetingWorkspace { preMeeting: any | null; decisionDrift: any | null; commitments: any[]; health: any | null; followUp: any | null; }
export const EMPTY_SMART_MEETING_WORKSPACE: SmartMeetingWorkspace = { preMeeting: null, decisionDrift: null, commitments: [], health: null, followUp: null };
function str(v: unknown, n: number): string | undefined { if (typeof v !== 'string') return undefined; const t = v.trim(); if (!t) return undefined; return t.length > n ? t.slice(0, n) : t; }
function list(items: unknown[], max: number, len: number): string[] { const o: string[] = []; for (const i of items || []) { const c = str(typeof i === 'string' ? i : (i as any)?.text ?? (i as any)?.question ?? '', len); if (c) o.push(c); if (o.length >= max) break; } return o; }
export class SmartMeetingService {
  constructor(private readonly db: Pick<DatabaseManager, 'getRecentMeetings' | 'getMeetingDetails' | 'getRecentDecisions'> | null | undefined) {}
  buildWorkspace(params?: SmartMeetingWorkspaceParams): SmartMeetingWorkspace {
    try {
      const meetingId = typeof params?.meetingId === 'string' ? params.meetingId : undefined;
      const event = params?.event && typeof params.event === 'object' ? params.event : undefined;
      let target: Meeting | null = null;
      try { target = meetingId && this.db ? this.db.getMeetingDetails(meetingId) : null; } catch { target = null; }
      let recent: Meeting[] = [];
      try { recent = this.db ? this.db.getRecentMeetings(5) || [] : []; } catch { recent = []; }
      if (!Array.isArray(recent)) recent = [];
      const ref: Meeting | null = target ?? recent[0] ?? null;
      const prev: Meeting | null = target ? (recent.find((m) => m.id !== target!.id) ?? null) : (recent[1] ?? null);
      return { preMeeting: this.pre(event ?? null, ref, prev), decisionDrift: this.drift(ref), commitments: this.commits(ref), health: this.health(ref), followUp: this.follow(ref) };
    } catch (e) { console.error('[SmartMeetingService] failed:', (e as Error)?.message || e); return { preMeeting: null, decisionDrift: null, commitments: [], health: null, followUp: null }; }
  }
  private pre(event: any, ref: Meeting | null, prev: Meeting | null): any | null {
    const src: any = prev ?? ref;
    const carried: string[] = []; const risks: string[] = []; const notes: string[] = [];
    try {
      const d: any = src?.detailedSummary;
      const cq: any[] = d?.crossMeeting?.carriedOpenQuestions || [];
      for (const i of cq.slice(0, 5)) { const t = str(i?.text ?? i, 240); if (t) carried.push(t); }
      const oq: any[] = d?.openQuestions || [];
      for (const i of oq.slice(0, 5)) { const t = str(i?.text ?? i?.question ?? i, 240); if (t && !carried.includes(t)) carried.push(t); if (carried.length >= 5) break; }
      const rr: any[] = d?.crossMeeting?.recurringRisks || [];
      for (const i of rr.slice(0, 5)) { const t = str(i?.text ?? i, 240); if (t) risks.push(t); }
      const so: any[] = d?.crossMeeting?.stillOpen || [];
      for (const i of so.slice(0, 5)) { const t = str(i, 240); if (t) notes.push(t); }
    } catch { /* legado */ }
    if (!event && !src) return null;
    return { eventTitle: str(event?.title, 240), eventStartTime: str(event?.startTime, 80), attendeeCount: Array.isArray(event?.attendees) ? event.attendees.length : 0, lastMeetingTitle: str(src?.title, 240), lastMeetingDate: str(src?.date, 80), openQuestionsCarried: carried, risksCarried: risks, notes };
  }
  private drift(ref: Meeting | null): any | null {
    let rec = '';
    try { rec = this.db ? this.db.getRecentDecisions(10) || '' : ''; } catch { rec = ''; }
    const recorded = list(String(rec || '').split('\n').map((l) => l.replace(/^[•\-\*]\s*/, '')).filter(Boolean), 10, 240);
    let topics: string[] = []; const notes: string[] = [];
    try {
      const d: any = (ref as any)?.detailedSummary;
      if (Array.isArray(d?.topics)) topics = list(d.topics.map(String), 8, 120);
      else if (Array.isArray(d?.keyPoints)) topics = list(d.keyPoints.map(String), 8, 120);
      const decs: any[] = Array.isArray(d?.decisions) ? d.decisions : [];
      if (recorded.length > 0 && decs.length === 0 && topics.length > 0) notes.push('Ha decisoes no historico mas nenhuma nesta reuniao — revisar.');
    } catch { /* ignora */ }
    if (!ref && recorded.length === 0) return null;
    if (recorded.length === 0 && topics.length === 0) return null;
    return { recordedDecisions: recorded, recentTopics: topics, driftNotes: notes };
  }
  private commits(ref: Meeting | null): any[] {
    if (!ref) return [];
    try {
      const d: any = (ref as any)?.detailedSummary;
      const v3: any[] = Array.isArray(d?.actionItemsV3) ? d.actionItemsV3 : [];
      const out: any[] = [];
      for (const i of v3.slice(0, 20)) { const t = str(i?.text, 280); if (t) out.push({ text: t, owner: str(i?.owner, 120), deadline: str(i?.deadline, 80), source: 'actionItemsV3' }); }
      if (out.length === 0 && Array.isArray(d?.actionItems)) for (const i of (d.actionItems as unknown[]).slice(0, 20)) { const t = str(typeof i === 'string' ? i : (i as any)?.text, 280); if (t) out.push({ text: t, source: 'actionItems' }); }
      if (out.length === 0) { const draft: any = d?.followUpDraft; const t = str(typeof draft === 'string' ? draft : draft?.body ?? draft?.text, 280); if (t) out.push({ text: t, source: 'followUpDraft' }); }
      return out;
    } catch { return []; }
  }
  private health(ref: Meeting | null): any | null {
    if (!ref) return null;
    let speakers = 0; let segs = 0; let qs = 0; let risks = 0; const notes: string[] = [];
    try {
      const tr: any[] = Array.isArray((ref as any)?.transcript) ? (ref as any).transcript : [];
      segs = tr.length;
      const set = new Set<string>();
      for (const s of tr.slice(0, 500)) { const l = str(s?.speaker, 80); if (l) set.add(l); if (/\?\s*$/.test(String(s?.text || '').trim())) qs += 1; }
      speakers = set.size;
      const d: any = (ref as any)?.detailedSummary;
      if (Array.isArray(d?.openQuestions)) qs = Math.max(qs, d.openQuestions.length);
      if (Array.isArray(d?.risks)) risks = d.risks.length;
      if (segs === 0) notes.push('Transcricao indisponivel nesta visao.');
    } catch { /* ignora */ }
    return { meetingId: ref.id, title: str(ref.title, 240), durationLabel: str(ref.duration, 40), speakerCount: speakers, segmentCount: segs, questionCount: qs, risksCount: risks, notes };
  }
  private follow(ref: Meeting | null): any | null {
    if (!ref) return null;
    try {
      const bullets: string[] = [];
      for (const c of this.commits(ref).slice(0, 5)) bullets.push(c.owner ? `${c.text} - ${c.owner}` : c.text);
      const d: any = (ref as any)?.detailedSummary;
      if (bullets.length === 0 && Array.isArray(d?.keyPoints)) for (const k of (d.keyPoints as unknown[]).slice(0, 5)) { const t = str(typeof k === 'string' ? k : (k as any)?.text, 240); if (t) bullets.push(t); }
      if (bullets.length === 0) { const s = str((ref as any)?.summary, 240); if (s) bullets.push(s); }
      if (bullets.length === 0) return null;
      return { subject: `Follow-up: ${(ref.title || 'reuniao').slice(0, 100)}`, bullets };
    } catch { return null; }
  }
}

