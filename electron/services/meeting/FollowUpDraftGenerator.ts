// FollowUpDraftGenerator.ts (Fase 8)
// Produces a scurto human, copy-paste-ready follow-up draft de o FINAL note content
// apenas (overview + decisions + ação items + abrir questions). It Nunca lê raw
// transcript e Nunca invents promises além o que o note já ccontém
//
// LLM-based via generateStructured (one pequeno JSON call), com a deterministic fallback
// que é used quando o LLM é unavailable, scope-denied, ou Retorna nada usable.
//
// Modo → draft tipo mapping:
//   sales              → email (deal-style) / crm_note recipe handled separately
//   recruiting         → email
//   team-meet          → project_update
//   technical-interview→ interview_feedback
//   lecture            → study_notes
//   looking-for-work   → email
//   general/other      → email

import type { LLMHelper } from '../../LLMHelper';
import type { ActionItem, DecisionItem, FollowUpDraft, FollowUpDraftType, FollowUpTone, MeetingSummaryV3, QuestionItem } from './MeetingSummaryV3';
import { buildFollowUpBody } from './MeetingSummaryReducer';
import { generateStructured } from './generateStructured';

export function followUpTypeForMode(mode?: string | null): FollowUpDraftType {
  switch (mode) {
    case 'team-meet': return 'project_update';
    case 'technical-interview': return 'interview_feedback';
    case 'lecture': return 'study_notes';
    case 'sales':
    case 'recruiting':
    case 'looking-for-work':
    default:
      return 'email';
  }
}

const TYPE_GUIDANCE: Record<FollowUpDraftType, string> = {
  email: 'Write a short professional follow-up email (3-6 sentences). Open with a one-line thanks, state what was aligned/decided, then the concrete next steps with owners and dates if known, and end with the single most important open question if any.',
  slack: 'Write a concise Slack-style update (no greeting needed, can use brief bullet emphasis). Lead with the outcome, then next steps.',
  project_update: 'Write a short project update: what changed since last sync, decisions, owners + next steps, and any blocker. Keep it skimmable.',
  crm_note: 'Write a concise CRM note: account context, pain/need, buying signal, objection, and next step. Factual, no fluff.',
  study_notes: 'Write a short study recap: the core concepts to remember and the questions to review before the exam.',
  interview_feedback: 'Write concise interviewer feedback: the problem, the approach, correctness/complexity signal, communication, and a clear next-step recommendation. Do NOT invent a final hire/no-hire if it was not decided.',
};

const TONE_GUIDANCE: Record<FollowUpTone, string> = {
  professional: 'Tone: professional and neutral.',
  warm: 'Tone: warm and personable, still concise.',
  concise: 'Tone: maximally concise; cut every non-essential word.',
  friendly: 'Tone: friendly and approachable.',
};

export interface FollowUpGenerateParams {
  summary: Pick<MeetingSummaryV3, 'overview' | 'decisions' | 'actionItems' | 'openQuestions' | 'tldr' | 'whatChanged'>;
  mode?: string | null;
  tone?: FollowUpTone;
  type?: FollowUpDraftType;
}

export class FollowUpDraftGenerator {
  constructor(private readonly llmHelper: LLMHelper) {}

  // Build o summary-safe inputs block (note conteúdo oapenas nunca transcript).
  private buildInputs(summary: FollowUpGenerateParams['summary']): string {
    const parts: string[] = [];
    if (summary.overview) parts.push(`Overview: ${summary.overview}`);
    if (summary.whatChanged?.length) parts.push(`What changed:\n${summary.whatChanged.map(s => `- ${s}`).join('\n')}`);
    if (summary.decisions?.length) parts.push(`Decisions:\n${summary.decisions.map(d => `- ${d.text}`).join('\n')}`);
    if (summary.actionItems?.length) parts.push(`Action items:\n${summary.actionItems.map(a => `- ${a.owner ? `${a.owner}: ` : ''}${a.text}${a.deadline ? ` (by ${a.deadline})` : ''}${a.explicitness === 'inferred' ? ' [inferred]' : ''}`).join('\n')}`);
    if (summary.openQuestions?.length) parts.push(`Open questions:\n${summary.openQuestions.map(q => `- ${q.text}`).join('\n')}`);
    return parts.join('\n\n');
  }

  async generate(params: FollowUpGenerateParams): Promise<FollowUpDraft> {
    const type = params.type || followUpTypeForMode(params.mode);
    const tone: FollowUpTone = params.tone || 'professional';
    const inputs = this.buildInputs(params.summary);

    const decisions = params.summary.decisions || [];
    const actionItems = params.summary.actionItems || [];
    const deterministic = (): FollowUpDraft => ({
      type,
      ...(type === 'email' ? { subject: subjectFromContent(params.summary) } : {}),
      body: buildFollowUpBody(decisions, actionItems),
      tone,
      ...(actionItems.length ? { basedOnActionItemIds: actionItems.map(a => a.id).filter(Boolean) as string[] } : {}),
      ...(decisions.length ? { basedOnDecisionIds: decisions.map(d => d.id).filter(Boolean) as string[] } : {}),
    });

    // Não conteúdo at todos → deterministic empty-ish draft.
    if (!inputs.trim()) return deterministic();

    const systemPrompt = `You are drafting a follow-up message after a meeting, for the user to copy and send.
${TYPE_GUIDANCE[type]}
${TONE_GUIDANCE[tone]}

STRICT RULES:
- Use ONLY the facts provided below. Do NOT invent decisions, owners, deadlines, or promises.
- Write natural prose, not a bulleted scaffold. It must read like a person wrote it.
- Keep it short and copy-paste ready. No placeholders like [Name].
- Do not mention transcripts, AI, summaries, or that this was auto-generated.
- If there are no real next steps, say so briefly rather than padding.

MEETING CONTENT:
${inputs}`;

    const jsonShapeHint = `{
  "subject": "${type === 'email' ? 'a short subject line' : ''}",
  "body": "the follow-up message text"
}`;

    const result = await generateStructured<{ subject?: string; body: string }>({
      schemaName: 'FollowUpDraft',
      systemPrompt,
      jsonShapeHint,
      userContent: inputs,
      llmHelper: this.llmHelper,
      validate: (raw) => {
        if (!raw || typeof raw !== 'object') return { ok: false, errors: ['not an object'], repaired: false };
        const body = typeof (raw as any).body === 'string' ? (raw as any).body.trim() : '';
        if (!body || body.length < 12) return { ok: false, errors: ['missing or too-short body'], repaired: false };
        const subject = typeof (raw as any).subject === 'string' ? (raw as any).subject.trim() : undefined;
        return { ok: true, data: { ...(subject ? { subject } : {}), body }, errors: [], repaired: false };
      },
    });

    if (!result.ok || !result.data) return deterministic();

    return {
      type,
      ...(result.data.subject ? { subject: result.data.subject.slice(0, 160) } : (type === 'email' ? { subject: subjectFromContent(params.summary) } : {})),
      body: result.data.body.slice(0, 4000),
      tone,
      ...(actionItems.length ? { basedOnActionItemIds: actionItems.map(a => a.id).filter(Boolean) as string[] } : {}),
      ...(decisions.length ? { basedOnDecisionIds: decisions.map(d => d.id).filter(Boolean) as string[] } : {}),
    };
  }
}

function subjectFromContent(summary: FollowUpGenerateParams['summary']): string {
  const first = summary.tldr?.[0] || summary.whatChanged?.[0] || summary.overview || 'Meeting follow-up';
  const trimmed = first.replace(/\s+/g, ' ').trim().slice(0, 70);
  return `Follow-up: ${trimmed}`;
}
