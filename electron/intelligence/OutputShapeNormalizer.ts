// electron/intelligence/OutputShapeNormalizer.ts
//
// Spec Fase 5 — AnswerContractService / AnswerDiversityGuard / OutputShapeNormalizer.
//
// HONEST SStatus o answer-shape machinery o spec asks para Já EXISTS e é
// wired live dentro de o manual stream caminho (electron/ipcHandlers.ts ~line 1223):
//   • cleanAnswerArtifacts()  — remover vazio "*"/"-" bullets, dangling markers.
//   • SCAFFOLD_LABEL_RE        — detects robotic "O Honest Gap:/Speakable Final
//                                Answer:/…" label blocks.
//   • compressToSpeakable()    — strips labels → natural prose quando structure wasn't asked.
//   • AnswerDiversityGuard     — flags repeated opening sentence / scaffold / near-dup.
// (todos em electron/llm/answerPolish.ts, com AnswerPlanner.answerStyle deciding quando
// structure era requested.)
//
// Então isso módulo faz Não re-implement qualquer de that. It é a thin FACADE que bundles
// o existing pieces dentro de o único named API o spec expects, então Todo surface
// (manual today; WTA / future phases) pode aplica o mesmo contract em vez disso de o
// manual caminho sendo o apenas place o polish lives. It é pure, deterministic, nunca
// throws, e changes nada a menos que a caller invokes it.

import {
  cleanAnswerArtifacts,
  compressToSpeakable,
  SCAFFOLD_LABEL_RE,
  AnswerDiversityGuard,
  varySpokenOpening,
  type RepetitionVerdict,
} from '../llm/answerPolish';
import { humanizeForAnswerType } from '../llm/humanLikeness';
import type { AnswerType } from '../llm/AnswerPlanner';

/** Answer styles (de AnswerPlanner) sob que visible scaffold labels são OK. */
const STRUCTURE_STYLES = new Set(['detailed', 'bullets', 'star', 'exam', 'notes']);

export interface NormalizeInput {
  /** O raw answer text. */
  answer: string;
  /** O plan's requested estilo — 'default' significa "não structure asked fopara */
  answerStyle?: string;
  /** Verdadeiro para coding answers (their fenced/sectioned shape é intentional — skpular */
  isCoding?: boolean;
  /** O answer tipo (habilita o speakability budget + humanizer final pass). */
  answerType?: AnswerType;
  /** O user's question (habilita detail-request exception detection). */
  question?: string;
}

export interface NormalizeResult {
  text: string;
  /** O que era applied, em ordenar (markers apenas — para o IntelligenceTrace). */
  applied: string[];
  changed: boolean;
}

/**
 * Aplica o output-shape contract para a finished answer:
 *   1. strip empty-bullet / dangling-marker artifacts (alsempre
 *   2. se a visible scaffold é present AND structure era Não requested, comprimir
 *      para speakable prose.
 * Coding answers são esquerda untouched. Pure + deterministic + nunca throws.
 */
export function normalizeOutputShape(input: NormalizeInput): NormalizeResult {
  const applied: string[] = [];
  let text = input.answer ?? '';
  const original = text;
  if (!text || input.isCoding) return { text, applied, changed: false };

  try {
    const cleaned = cleanAnswerArtifacts(text);
    if (cleaned !== text && cleaned.length >= 10) {
      text = cleaned;
      applied.push('cleaned_artifacts');
    }

    SCAFFOLD_LABEL_RE.lastIndex = 0;
    const hasVisibleScaffold = SCAFFOLD_LABEL_RE.test(text);
    const structureRequested = STRUCTURE_STYLES.has((input.answerStyle ?? 'default'));
    if (hasVisibleScaffold && !structureRequested) {
      const speakable = compressToSpeakable(text);
      if (speakable.length >= 40) {
        text = speakable;
        applied.push('compressed_to_speakable');
      }
    }

    // Humanizer final pass (spoken-answer-quality sprint 2026-06-15) — strips residual
    // corporate filler / fonte narration. Gates internally em answer ttipo então a coding /
    // lecture / technical answer é a no-op. NOTE: o speakability TRIM era removed
    // 2026-06-16 (it cropped o conclusion fora longo answers); length é o model's job via
    // o prompt, então o WTA caminho não longer trims equalquer um
    if (input.answerType) {
      const human = humanizeForAnswerType(input.answerType, text);
      if (human.changed && human.text.trim().length >= 10) {
        text = human.text;
        applied.push('humanized_spoken_answer');
      }
    }
  } catch {
    return { text: original, applied: [], changed: false };
  }

  return { text, applied, changed: text !== original };
}

/**
 * O completo answer contract para a delivered answer: normalizar shape, então verifica o
 * sessão diversity proteger and, se repeated através a DIFFERENT ask, tentar a
 * deterministic speakable rewrite. Records o (final) answer dentro de o gproteger
 *
 * `guard` é o caller's per-session AnswerDiversityGuard (o manual caminho keeps one
 * aljá Pure aside de mutating o passed guard's history. Nunca throws.
 */
export function applyAnswerContract(
  input: NormalizeInput & { answerType: string; question: string; guard: AnswerDiversityGuard },
): NormalizeResult & { repetition?: RepetitionVerdict } {
  const norm = normalizeOutputShape(input);
  let text = norm.text;
  const applied = [...norm.applied];
  let repetition: RepetitionVerdict | undefined;

  try {
    repetition = input.guard.check(text, input.answerType, input.question);
    if (repetition.repeated && !input.isCoding) {
      const speakable = compressToSpeakable(text);
      if (
        speakable.length >= 40 &&
        speakable !== text &&
        !input.guard.check(speakable, input.answerType, input.question).repeated
      ) {
        text = speakable;
        applied.push('diversity_repair');
      }
    }
    input.guard.record(text, input.answerType, input.question);
  } catch {
    /* nunca lançar — retorna best effort então longe */
  }

  return { text, applied, changed: text !== (input.answer ?? ''), repetition };
}

export { AnswerDiversityGuard } from '../llm/answerPolish';
