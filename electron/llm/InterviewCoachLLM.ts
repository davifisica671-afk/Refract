// InterviewCoachLLM.ts
// LLM module for the Replica Interview Coach mode.
// Simulates an interviewer: generates adaptive questions, evaluates answers,
// provides hints, and produces a final debrief — all streamed.

import { LLMHelper } from '../LLMHelper';
import { MODE_REPLICA_COACH_PROMPT } from './prompts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CoachQuestion {
  question: string;
  difficulty: 'easy' | 'medium' | 'hard';
  category: string;
  hint?: string;
}

export interface CoachEvaluation {
  score: number;              // 0-100
  strengths: string[];
  improvements: string[];
  summary: string;
  overallGrade: string;      // e.g. "A", "B+", "C"
}

export interface QuestionHistoryItem {
  question: string;
  difficulty: string;
  category: string;
  userAnswer: string;
  feedback: string;
}

// ── Coach ─────────────────────────────────────────────────────────────────────

export class InterviewCoachLLM {
  private llmHelper: LLMHelper;

  constructor(llmHelper: LLMHelper) {
    this.llmHelper = llmHelper;
  }

  /**
   * Generate the first question of a session (no prior context).
   * Streams tokens for a smooth UX.
   */
  async *generateFirstQuestion(
    profile: string,
    jd: string,
    modeType: string,
  ): AsyncGenerator<string> {
    const context = [
      `Interview mode: ${modeType}`,
      profile ? `Candidate profile:\n${profile}` : '',
      jd ? `Job description:\n${jd}` : '',
      '',
      'Generate the FIRST interview question for this candidate.',
      'Respond using the exact output format specified in your instructions.',
    ].filter(Boolean).join('\n');

    const fitted = this.llmHelper.fitContextForCurrentModel(context);
    yield* this.llmHelper.streamChat(
      fitted,
      undefined,
      undefined,
      MODE_REPLICA_COACH_PROMPT,
      true,  // ignoreKnowledgeMode
      true,  // skipModeInjection — we provide our own prompt
    );
  }

  /**
   * Generate a follow-up question after the user answers.
   * Takes the full conversation history so the coach can adapt.
   */
  async *generateFollowUp(
    profile: string,
    jd: string,
    modeType: string,
    questionHistory: QuestionHistoryItem[],
    lastUserAnswer: string,
  ): AsyncGenerator<string> {
    const historyBlock = questionHistory
      .slice(-6)
      .map((h, i) => `Q${i + 1} [${h.difficulty}/${h.category}]: ${h.question}\nCandidate: ${h.userAnswer}`)
      .join('\n\n');

    const context = [
      `Interview mode: ${modeType}`,
      profile ? `Candidate profile:\n${profile}` : '',
      jd ? `Job description:\n${jd}` : '',
      '',
      historyBlock ? `Previous exchanges:\n${historyBlock}` : '',
      '',
      `Candidate's latest answer: ${lastUserAnswer}`,
      '',
      'Evaluate the answer briefly, then ask the NEXT question.',
      'If this was the last question (8 total), say [END_SESSION] instead of a new question.',
      'Respond using the exact output format specified in your instructions.',
    ].filter(Boolean).join('\n');

    const fitted = this.llmHelper.fitContextForCurrentModel(context);
    yield* this.llmHelper.streamChat(
      fitted,
      undefined,
      undefined,
      MODE_REPLICA_COACH_PROMPT,
      true,
      true,
    );
  }

  /**
   * Generate a final evaluation/debrief for the whole session.
   */
  async *generateEvaluation(
    profile: string,
    jd: string,
    modeType: string,
    questionHistory: QuestionHistoryItem[],
  ): AsyncGenerator<string> {
    const historyBlock = questionHistory
      .map((h, i) => `Q${i + 1} [${h.difficulty}/${h.category}]: ${h.question}\nCandidate: ${h.userAnswer}`)
      .join('\n\n');

    const context = [
      `Interview mode: ${modeType}`,
      profile ? `Candidate profile:\n${profile}` : '',
      jd ? `Job description:\n${jd}` : '',
      '',
      `All exchanges:\n${historyBlock}`,
      '',
      'The interview is over. Produce the FINAL EVALUATION.',
      'Respond using the exact output format specified in your instructions.',
    ].filter(Boolean).join('\n');

    const fitted = this.llmHelper.fitContextForCurrentModel(context);
    yield* this.llmHelper.streamChat(
      fitted,
      undefined,
      undefined,
      MODE_REPLICA_COACH_PROMPT,
      true,
      true,
    );
  }

  // ── Parsers ──────────────────────────────────────────────────────────────

  static parseQuestion(raw: string): CoachQuestion | null {
    const qMatch = raw.match(/\[QUESTION\]\s*([\s\S]*?)\s*\[\/QUESTION\]/);
    const dMatch = raw.match(/\[DIFFICULTY\]\s*(easy|medium|hard)\s*\[\/DIFFICULTY\]/);
    const cMatch = raw.match(/\[CATEGORY\]\s*([\s\S]*?)\s*\[\/CATEGORY\]/);
    const hMatch = raw.match(/\[HINT\]\s*([\s\S]*?)\s*\[\/HINT\]/);

    if (!qMatch) return null;

    return {
      question: qMatch[1].trim(),
      difficulty: (dMatch?.[1] as 'easy' | 'medium' | 'hard') || 'medium',
      category: cMatch?.[1].trim() || 'general',
      hint: hMatch?.[1].trim() || undefined,
    };
  }

  static parseFeedback(raw: string): string | null {
    const fMatch = raw.match(/\[FEEDBACK\]\s*([\s\S]*?)\s*\[\/FEEDBACK\]/);
    return fMatch ? fMatch[1].trim() : null;
  }

  static parseEvaluation(raw: string): CoachEvaluation | null {
    const sMatch = raw.match(/\[SCORE\]\s*(\d{1,3})\s*\[\/SCORE\]/);
    const gMatch = raw.match(/\[GRADE\]\s*([ABCDF][+-]?)\s*\[\/GRADE\]/);
    const sumMatch = raw.match(/\[SUMMARY\]\s*([\s\S]*?)\s*\[\/SUMMARY\]/);

    const strengths: string[] = [];
    const improvements: string[] = [];
    const strengthRegex = /\[STRENGTH\]\s*([\s\S]*?)\s*\[\/STRENGTH\]/g;
    const improvementRegex = /\[IMPROVEMENT\]\s*([\s\S]*?)\s*\[\/IMPROVEMENT\]/g;

    let m;
    while ((m = strengthRegex.exec(raw)) !== null) strengths.push(m[1].trim());
    while ((m = improvementRegex.exec(raw)) !== null) improvements.push(m[1].trim());

    if (!sMatch || !sumMatch) return null;

    return {
      score: parseInt(sMatch[1], 10),
      overallGrade: gMatch?.[1] || (parseInt(sMatch[1], 10) >= 90 ? 'A' : parseInt(sMatch[1], 10) >= 75 ? 'B' : parseInt(sMatch[1], 10) >= 60 ? 'C' : 'D'),
      summary: sumMatch[1].trim(),
      strengths,
      improvements,
    };
  }

  static isEndSession(raw: string): boolean {
    return /\[END_SESSION\]/.test(raw);
  }
}
