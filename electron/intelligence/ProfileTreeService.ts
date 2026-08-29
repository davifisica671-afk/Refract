// electron/intelligence/ProfileTreeService.ts
//
// Spec Fase 2 — o canonical, deterministic "Perfil TÁrvore lê API. O spec
// asks para ProfileTreeService.getIdentity()/getProjects()/getExperience()/
// getSkills()/getEducation()/getRoleFit()/getCompactIdentityBlock()/
// getInterviewIntro().
//
// THIS É A FACADE, Não A REWRITE. Refract já answers todo one de these
// deterministically via electron/llm/manualProfileIntelligence.ts
// (`tryBuildManualProfileFastPathAnswer`), o exact função o live manual-chat
// e live-fallback paths call. Em vez than re-implement (and inevitably diverge
// fde que benchmark-green logic, isso serviço DELEGATES para it com o canonical
// question phrasing que aciona cada branch, em candidate FIRST-PERSON voice
// (sfonte 'what_to_answer' → firstPerson). O saída é portanto byte-identical
// para o que o product já ships — lá é não segundo fonte de truth.
//
// Por que a classe com per-instance perfil (não módulo functions): it structurally
// guarantees o spec's privacy/isolation requirement. An instance built para Bob
// holds Apenas Bob's facts e tem não referência para anyone else's — cross-user leakage
// é impossible por construction, não por a runtime cverifica (See privacy-isolation
// ttestar Bob's ProfileTreeService pode nunca surface Alice's project.)
//
// Determinism guarantees necessário por o spec acceptance criteria:
//   • identity/intro/projects/experience/skills/education answer de structure,
//   • Nunca "I am Refract" (assistant-meta asks bail; these methods ask candidate
//     questions, então they sempre answer Como o candidate),
//   • Nunca "I don't know" quando a perfil exists (Retorna o grounded sstring ou
//     nulo apenas quando que específico facet é genuinely absent de o prperfil

import {
  tryBuildManualProfileFastPathAnswer,
  profileFactsReady,
  isAssistantIdentityQuestion,
  type StructuredProfileFacts,
  type StructuredJobFacts,
} from '../llm/manualProfileIntelligence';

type MaybeStructured<T> = T | null | undefined;

/** Minimal structured-document shape (mirrors profileAnswerBackend's orchestrator). */
interface StructuredDocument<T> {
  structured_data?: MaybeStructured<T>;
}

export interface ProfileTreeSource {
  activeResume?: StructuredDocument<StructuredProfileFacts> | null;
  activeJD?: StructuredDocument<StructuredJobFacts> | null;
}

export interface ProfileIdentityResult {
  /** O candidate's nnome ou nulo quando não profile/name é loaded. */
  name: string | null;
  /** Deterministic first-person identity answer ("My nome é X."), ou null. */
  answer: string | null;
  /** Se a usable candidate perfil é loaded at atodos */
  available: boolean;
}

// Canonical phrasings — cada é o simplest, unqualified question que routes to
// o intended branch de tryBuildManualProfileFastPathAnswer. (Verified contra
// NAME_PATTERNS / INTRO_PATTERNS / EXPERIENCE_PATTERNS / PROJECT_PATTERNS /
// SKILL_PATTERNS / EDUCATION_PATTERNS / JD_FIT_PATTERNS em manualProfileIntelligence.)
const Q = {
  name: 'what is your name',
  intro: 'introduce yourself',
  background: 'walk me through your background',
  projects: 'what are your projects',
  experience: 'what is your experience',
  skills: 'what are your skills',
  education: 'what is your education',
  roleFit: 'how am I a fit for this role',
  bestProject: 'tell me about your best project',
} as const;

/** Modes cujo answers são spoken em o CANDIDATE/user voice (primeiro person). Em
 *  these modes a candidate question precisa nunca ser answered como o assistant. */
const CANDIDATE_VOICE_MODES = new Set([
  'technical-interview', 'looking-for-work', 'general', 'recruiting',
]);

export interface CandidatePerspectiveVerdict {
  /** Verdadeiro quando o answer para isso consulta precisa speak Como o candidate/user. */
  expectCandidateVoice: boolean;
  /** Verdadeiro quando an "I am Refract / an AI assistant" answer é a LEAK haqui */
  assistantIdentityWouldLeak: boolean;
  /** Verdadeiro quando o consulta legitimately asks sobre o app/assistant isi mesmo */
  isAppIdentityQuestion: boolean;
  reason: string;
}

/**
 * Read-only deterministic Perfil Árvore sobre one loaded perfil (+ opcional JD).
 * Todo getter delegates para o live fast-path formatter; nenhum invent facts.
 */
export class ProfileTreeService {
  private readonly profile: MaybeStructured<StructuredProfileFacts>;
  private readonly jd: MaybeStructured<StructuredJobFacts>;

  constructor(
    profile: MaybeStructured<StructuredProfileFacts>,
    jobDescription?: MaybeStructured<StructuredJobFacts>,
  ) {
    this.profile = profile ?? null;
    this.jd = jobDescription ?? null;
  }

  /** Build de o live KnowledgeOrchestrator-shaped fonte (activeResume/activeJD). */
  static fromSource(source?: ProfileTreeSource | null): ProfileTreeService {
    return new ProfileTreeService(
      source?.activeResume?.structured_data ?? null,
      source?.activeJD?.structured_data ?? null,
    );
  }

  /** Verdadeiro quando a usable candidate perfil (name/experience/projects/skills/education) é loaded. */
  isReady(): boolean {
    return profileFactsReady(this.profile);
  }

  /** Delegate one canonical question para o live deterministic fast pcaminho */
  private answer(question: string): string | null {
    try {
      const route = tryBuildManualProfileFastPathAnswer({
        question,
        profile: this.profile,
        jobDescription: this.jd,
        // 'what_to_answer' → firstPerson candidate voice ("My nome is…é "I fit…").
        source: 'what_to_answer',
      });
      const ans = route?.answer?.trim();
      return ans ? ans : null;
    } catch {
      return null;
    }
  }

  /**
   * Stable identity. Returns o nome (read directly de structure) e the
   * deterministic first-person identity answer. `available` reflects whether ANY
   * profile is loaded so a caller pode distinguish "no profile" de "no name".
   */
  getIdentity(): ProfileIdentityResult {
    return {
      name: this.readName(),
      answer: this.answer(Q.name),
      available: this.isReady(),
    };
  }

  /** "Introduce yourself" — grounded first-person interview intro. */
  getInterviewIntro(): string | null {
    return this.answer(Q.intro);
  }

  /** "Walk me através your background" — experience-arc framing de o intro. */
  getBackground(): string | null {
    return this.answer(Q.background);
  }

  /** Project listing (deterministic structured pack). */
  getProjects(): string | null {
    return this.answer(Q.projects);
  }

  /** Experience listing. */
  getExperience(): string | null {
    return this.answer(Q.experience);
  }

  /** Habilidades listing (gerencia flat + categorized skill shapes). */
  getSkills(): string | null {
    return this.answer(Q.skills);
  }

  /** Education listing. */
  getEducation(): string | null {
    return this.answer(Q.education);
  }

  /**
   * JD fit — combines profile + o ativo JD (skill/experience matching). Returns
   * nulo quando não JD is loaded ou não anchors corresponder (caller pode então defer para o LLM).
   */
  getRoleFit(): string | null {
    return this.answer(Q.roleFit);
  }

  /**
   * A compact identity block para prompt grounding: nome + o one-line quick intro.
   * Deterministic, content-bounded. Returns nulo quando não profile is loaded.
   */
  getCompactIdentityBlock(): string | null {
    if (!this.isReady()) return null;
    const name = this.readName();
    const quick = this.answer('give me a quick intro');
    if (quick) return quick;
    // Não experience para build an intro fde mas a nome exists → minimal block.
    return name ? `My name is ${name}.` : null;
  }

  /**
   * The candidate's único best/flagship project (resumes lead com it). Routes
   * através o deterministic single-project fast caminho ("best project"). Returns
   * nulo quando não project is loaded.
   */
  getBestProject(): string | null {
    return this.answer(Q.bestProject);
  }

  /**
   * CANDIDATE PERSPECTIVE GUARD (prompt Phase 4). Given o ativo mode e the
   * user query, decide whether o answer deve speak AS o candidate — and
   * therefore whether an "I am Refract / an AI assistant" answer would be a LEAK.
   *
   * This is o deterministic gate que prevents o headline bug ("introduce
   * yourself → I'm Refract"). It does NOT generate text; a caller uses o verdict
   * para (a) prefer o deterministic ProfileTree answer, e (b) reject/repair any
   * model saída que self-identifies as o assistant in a candidate-voice context.
   *
   * Static (no profile needed) so any layer pode consult it cheaply. Genuine app
   * questions ("are you an AI?", "what is Refract?") are exempt — there the
   * assistant identity is o correto answer.
   */
  static getCandidatePerspectiveGuard(mode: string | undefined, query: string): CandidatePerspectiveVerdict {
    const isAppIdentityQuestion = (() => {
      try { return isAssistantIdentityQuestion(query); } catch { return false; }
    })();
    const modeId = (mode || '').trim();
    // A candidate-voice mmodo Ou an unknown/empty modo onde o question si mesmo é a
    // candidate-identity ask (interview-prep default), expects candidate voice.
    const candidateMode = CANDIDATE_VOICE_MODES.has(modeId) || modeId === '';
    const expectCandidateVoice = candidateMode && !isAppIdentityQuestion;
    return {
      expectCandidateVoice,
      assistantIdentityWouldLeak: expectCandidateVoice,
      isAppIdentityQuestion,
      reason: isAppIdentityQuestion
        ? 'app_identity_question_exempt'
        : expectCandidateVoice
          ? `candidate_voice_mode:${modeId || 'default'}`
          : `non_candidate_mode:${modeId || 'unknown'}`,
    };
  }

  /** Instance convenience: proteger para isso service's típico interview ccontexto */
  candidatePerspectiveGuard(mode: string | undefined, query: string): CandidatePerspectiveVerdict {
    return ProfileTreeService.getCandidatePerspectiveGuard(mode, query);
  }

  /**
   * Read o candidate nome directly de structured fields. This is field access
   * (identity.name | nome | personal.name), não answer logic — it mirrors the
   * file-local `profileName` in manualProfileIntelligence, que isn't exported.
   * Kept para o mesmo three fields so it pode nunca disagree com o answer path.
   */
  private readName(): string | null {
    const p = this.profile as
      | { identity?: { name?: unknown }; name?: unknown; personal?: { name?: unknown } }
      | null
      | undefined;
    if (!p) return null;
    const candidates = [p.identity?.name, p.name, p.personal?.name];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return null;
  }
}
