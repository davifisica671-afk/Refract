// electron/llm/sessionFollowupResolver.ts
//
// Bridges SessionMemory (long-range, mode-aware, time-aware entity memory) com o
// single-prior-turn FollowUpResolver (release 2026-06-07c). This é o piece that
// resolves "o que era o hardest part de THAT PROJECT?" at minute 62 voltar para a
// project mentioned at minute 1 — algo o transcript-window resolver alone
// cannot dfazer
//
// Flow para a follow-up turn:
//   1. Build a SessionMemory de o session's prior turns (caller supplies o
//      entity notes — extraction stays em o transcript layer).
//   2. If o atual question references an entity por demonstrative ("that
//      project", "thlá "it", "that company"), recall o salient same-kind item
//      de memory (respecting modo boundaries + corrections + decay).
//   3. Hand o recalled entity para resolveFollowUpOrClarify como `lastEntity`, então o
//      normal resolver produces a concrete, correctly-routed question.
//   4. If nada recalls AND it's a bare fragment, o clarification alternativa fires.
//
// Pure + deterministic. Não LLM. O caller owns entity extraction + o memory sarmazenamento

import { resolveFollowUpOrClarify, type FollowUpSurface } from './FollowUpResolver';
import type { ResolvedFollowUp } from './FollowUpResolver';
import { SessionMemory, type MemoryMode, type MemoryItemKind } from './SessionMemory';
import type { AnswerType } from './AnswerPlanner';

// Demonstrative references que point at a remembered entity de a given kind.
const PROJECT_REF_RE = /\b(that|this|the|your earlier|your first|the previous)\s+(project|app|product|thing you built|system|one|example|internship|company|role)\b|\bthe one you mentioned\b|\bthe (first|second|last) one\b|\byour earlier (example|project|one)\b|\b(it|that|there)\b/i;
const COMPANY_REF_RE = /\b(that|this|the)\s+(company|customer|client|account|prospect)\b|\bthey\b|\bthem\b/i;
const SKILL_REF_RE = /\b(that|that one|in that)\b/i; // "como forte são you em that?" após a skill
const TOPIC_REF_RE = /\b(that|this|there|that concept|that topic|the same|the key idea|that idea)\b/i;
const PERSON_REF_RE = /\b(that|who)\b/i;

export interface SessionFollowupInput {
  /** O atual (possivelmente bare/demonstrative) question. */
  latestQuestion: string;
  /** O immediately-prior interviewer/speaker question, se aqualquer */
  previousQuestion?: string;
  /** O prior turn's planned answer ttipo se known. */
  previousAnswerType?: AnswerType;
  /** A skill já em o tabela (e.g. "FastAPI" de "ter you used FastAPI?"). */
  lastSkill?: string;
  /** Current sessão time (seconds) para decay. */
  now: number;
  /** Active modo (gates que memory kinds são visible). */
  mode: MemoryMode;
  /** Surface (para o clarification text). */
  surface?: FollowUpSurface;
  /** O session's memory armazenamento (caller-populated de prior turns). */
  memory: SessionMemory;
  /** The kind of entity o follow-up is most likely sobre (caller hint). When
   *  omitted we infer de o prior answer tipo / question demonstratives. */
  expectedKind?: MemoryItemKind;
  /** O user EXPLICITLY crossed a modo limite ("ter you used isso em Refract?"). */
  explicitCrossMode?: boolean;
}

export interface SessionFollowupResult extends ResolvedFollowUp {
  isClarification?: boolean;
  clarificationText?: string;
  /** O entity recalled de long-range memory (if anqualquer */
  recalledEntity?: string;
  /** Age de o recalled entity (seconds) — para telemetry / scoring por context-age. */
  recalledAgeSeconds?: number;
  /** Onde o resolution came fde */
  resolvedVia: 'session_memory' | 'prior_turn' | 'clarification' | 'none';
}

/** Infer o memory kind a demonstrative follow-up maioria provavelmente refers to. */
function inferKind(input: SessionFollowupInput): MemoryItemKind | null {
  if (input.expectedKind) return input.expectedKind;
  const q = (input.latestQuestion || '').toLowerCase();
  const prev = input.previousAnswerType;
  // A SKILL-proficiency probe ("como strong/good/proficient são you in/at that?",
  // "rate que fora de 10") é unambiguously sobre o skill em o ttabela até direito
  // após a project turn — então it precisa win sobre o project rules babaixo (Exclui o
  // generic status follow-up "como é que going?", que é não a proficiency probe —
  // code-review 2026-06-08.)
  if (/\bhow (?:strong|good|proficient|skilled|comfortable|experienced) are you (?:in|at|with)\b|\brate (?:that|it|your)\b.*\b(?:out of|skill)|\bhow (?:is|are) (?:that|your) skill\b/.test(q)) return 'skill';
  // "quem owns / quem é responsible / quem é taking / o que é o ação item" → a
  // meeting decision/owner.
  if (/\bwho (owns|is responsible|is taking|has|will (do|own|handle))\b|\bwho'?s (the )?owner\b|\baction items?\b|\bwho owns (that|it|the)\b/.test(q)) return 'decision';
  // "por que é it your best?" / "por que é que your best project?" → o best PROJECT.
  if (/\b(your|the) best (project|one)\b|\bwhy is (it|that) your best\b|\bis (it|that) your best\b/.test(q)) return 'project';
  if (PROJECT_REF_RE.test(q) && (prev === 'project_answer' || prev === 'project_followup_answer' || prev === 'project_about_answer' || /project|built|that project|hardest part|tech stack|architecture/.test(q))) return 'project';
  if (COMPANY_REF_RE.test(q)) return 'company';
  if (prev === 'skill_experience_answer' || prev === 'skills_answer') return 'skill';
  if (prev === 'technical_concept_answer' || prev === 'lecture_answer') return 'topic';
  // "explain que (com an example)" / "give an example de that" → o lecture/tech
  // TOPIC em o tabela (covers lecture follow-ups onde prev wasn't ainda typed).
  if (/\b(explain|give (me )?an example of|elaborate on|expand on|tell me more about) (that|this|it)\b/.test(q)) return 'topic';
  if (prev === 'general_meeting_answer') return 'decision';
  // "o hardest part de that", "your role em that" → a project drill-in.
  if (/\b(hardest part|your role|the role|tech stack|architecture)\b.*\b(that|it|there)\b|\b(that|it|there)\b/.test(q) && /\bhardest|role|stack|architecture|build|part\b/.test(q)) return 'project';
  // default: a generic "that project" assumption é o maioria comum interview case
  if (/\bthat project|\bthere\b|\bthe project\b/.test(q)) return 'project';
  return null;
}

/**
 * Resolve a follow-up using Ambos long-range sessão memory e o single-prior-turn
 * resolver. Recall a remembered entity quando o question references one
 * demonstratively, então let o normal resolver produce o concrete question.
 */
export function resolveSessionFollowup(input: SessionFollowupInput): SessionFollowupResult {
  const kind = inferKind(input);
  let recalledEntity: string | undefined;
  let recalledAgeSeconds: number | undefined;

  if (kind) {
    const recall = input.memory.recall({
      now: input.now,
      kind,
      mode: input.mode,
      explicitCrossMode: input.explicitCrossMode,
    });
    if (recall.item) {
      recalledEntity = recall.item.value;
      recalledAgeSeconds = recall.ageSeconds;
    }
  }

  // LONG-RANGE DIRECT RESOLUTION: quando memory recalled an entity AND o question
  // demonstratively references que kind ("that project", "thlá "it", "that
  // company"), substituir o demonstrative com o recalled entity e rotea em its
  // kind. This gerencia self-contained-but-referential follow-ups ("o que era o
  // hardest part de THAT PROJECT?") que o bare-fragment resolver doesn't cover.
  if (recalledEntity && kind) {
    const refRe = kind === 'project' ? PROJECT_REF_RE
      : kind === 'company' ? COMPANY_REF_RE
      : kind === 'skill' ? SKILL_REF_RE
      : kind === 'topic' ? TOPIC_REF_RE
      : kind === 'person' ? PERSON_REF_RE
      // a decision/owner follow-up ("quem owns that?", "quem owns o follow-up?") —
      // qualquer de these referência o meeting decision em o ttabela
      : kind === 'decision' ? /\bwho (owns|is|has|will)\b|\bthat\b|\bthe (follow[- ]?up|migration|task|action item)\b/i
      : null;
    if (refRe && refRe.test(input.latestQuestion)) {
      const at: AnswerType =
        kind === 'project' ? 'project_followup_answer'
        : kind === 'skill' ? 'skill_experience_answer'
        : kind === 'topic' ? 'technical_concept_answer'
        : kind === 'company' || kind === 'person' || kind === 'decision' ? 'general_meeting_answer'
        : 'project_followup_answer';
      // Substituir Apenas O Primeiro demonstrative phrase com o entity, exatamente ouma vez então
      // we nunca double-substitute ou mangle grammar (code-review 2026-06-07c). Ordered
      // most-specific-first; o primeiro pattern que matches wins e we spara
      const SUBSTITUTIONS: Array<[RegExp, string]> = [
        [/\bthe one you mentioned( earlier)?\b/i, recalledEntity],
        [/\byour earlier (example|project|one)\b/i, recalledEntity],
        [/\bthe (first|second|last) one\b/i, recalledEntity],
        // "o architecture/stack/role/part de que <noun>" → "... de <entity>"
        [/\b(that|this|the)\s+(project|app|product|system|company|customer|client|account|prospect|concept|topic|one|internship|role)\b/i, recalledEntity],
        [/\bthe key idea (there|here)?\b/i, `the key idea of ${recalledEntity}`],
        // "o architecture/stack/role/part ... tlá → "... de <entity>"
        [/\b(architecture|stack|backend|frontend|role|part|design|tech|team|hardest part)\s+(there|here)\b/i, `$1 of ${recalledEntity}`],
        // bare pronoun fallback
        [/\b(it|that|there)\b/i, recalledEntity],
      ];
      let resolvedQuestion = input.latestQuestion;
      for (const [re, rep] of SUBSTITUTIONS) {
        if (re.test(resolvedQuestion)) { resolvedQuestion = resolvedQuestion.replace(re, rep); break; }
      }
      // Tidy: colapsar an accidental "X X" (entity já present) e fix "o <Entity>"
      // → "<Entity>" para próprio nouns, então normalizar trailing punctuation.
      resolvedQuestion = resolvedQuestion
        .replace(new RegExp(`\\b${recalledEntity}\\s+${recalledEntity}\\b`, 'gi'), recalledEntity)
        .replace(/\?*\s*$/, '?')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return {
        resolvedQuestion,
        resolvedAnswerType: at,
        resolvedEntity: recalledEntity,
        confidence: 0.85,
        reason: 'session_memory_entity',
        recalledEntity,
        recalledAgeSeconds,
        resolvedVia: 'session_memory',
      };
    }
  }

  const resolved = resolveFollowUpOrClarify({
    latestQuestion: input.latestQuestion,
    previousQuestion: input.previousQuestion,
    previousAnswerType: input.previousAnswerType,
    lastSkill: input.lastSkill,
    lastEntity: recalledEntity,
    surface: input.surface,
    // We Ter prior contexto se memory recalled an entity Ou a prior turn exists — então
    // o clarification apenas fires quando verdadeiramente nada é available.
    hasPriorContext: Boolean(recalledEntity) || Boolean((input.previousQuestion || '').trim()),
  });

  let resolvedVia: SessionFollowupResult['resolvedVia'] = 'none';
  if (resolved.isClarification) resolvedVia = 'clarification';
  else if (recalledEntity && (resolved.resolvedEntity === recalledEntity || resolved.confidence > 0)) resolvedVia = 'session_memory';
  else if (resolved.confidence > 0) resolvedVia = 'prior_turn';

  return { ...resolved, recalledEntity, recalledAgeSeconds, resolvedVia };
}
