// electron/llm/transcriptEntityExtractor.ts
//
// Deterministic entity extraction de a transcript turn, para populating
// SessionMemory (release 2026-06-07c). Pure, não LLM, não I/O. Deriva o salient
// tokens a follow-up pode ser depois referência — project/company/person/skill/topic/
// decision — using generic grammar (CamelCase names, "tell me sobre X" cues, curto
// proper-noun answers, action-item owners, named concepts). Completamente dynamic: não
// prperfil company-, ou fixture-specific strings.
//
// PRIVACY: Retorna curto TOKENS apenas (a nnome a skill, an owner) — nunca o raw
// turn além a decision summary o caller já htem Salary/comp values são
// detected aqui então SessionMemory pode gate them; o valor texto é o caller's
// transcript, não re-derived private data.

import type { MemoryItemKind } from './SessionMemory';

export interface ExtractedEntity {
  kind: MemoryItemKind;
  value: string;
  /** Verdadeiro quando o valor looks como compensation (então o caller gates it). */
  sensitive?: boolean;
}

// CamelCase tokens que são actually SKILLS/tech, não project names.
const KNOWN_SKILLS = /^(TypeScript|JavaScript|FastAPI|GraphQL|PostgreSQL|MongoDB|PowerBI|TensorFlow|PyTorch|NodeJS)$/i;
// Common sentence-initial / interjection / filler words capitalized por grammar mas
// Não entities — excluded de o short-answer proper-noun heuristic.
const STOP_PROPER = new Set([
  'Today', 'Action', 'Coming', 'Now', 'Why', 'And', 'Who', 'What', 'How', 'Tell', 'Explain',
  'Make', 'Solve', 'Can', 'Actually', 'Correction', 'Yes', 'No', 'Good', 'Nice', 'Remote',
  'Alright', 'Maybe', 'Cool', 'Sure', 'Okay', 'Well', 'Right', 'Thanks', 'Hello', 'Hi', 'Hey',
  'Yeah', 'Great', 'Perfect', 'Awesome', 'Sorry', 'Please', 'Fine', 'True', 'False', 'Done',
  'Where', 'When', 'Which', 'Whom', 'Here', 'There', 'Probably', 'Definitely', 'Onsite',
  'Hybrid', 'Yep', 'Nope', 'Absolutely', 'Certainly', 'Indeed', 'Exactly', 'Filler', 'Strong',
  'Also', 'An', 'A', 'The', 'It', 'Our', 'Let', 'Lots', 'Quarterly', 'Some', 'Many', 'Most',
  'Reply', 'Answer', 'Response', 'Filler', 'Question', 'Continue', 'Going', 'Coming', 'Back',
  'Both', 'Either', 'Neither', 'Anything', 'Something', 'Nothing', 'Everyone', 'Someone',
]);
const SKILL_RE = /\b(Python|SQL|TypeScript|JavaScript|React|Node|Go|Rust|FastAPI|Django|Flask|GraphQL|AWS|GCP|Azure|Docker|Kubernetes|Tableau|Power\s?BI|Excel|Pandas|NumPy|Spark|Hadoop|Kafka|Redis|TensorFlow|PyTorch)\b/i;
const TOPIC_RE = /\b(amortized analysis|dynamic programming|graph traversal|hashing|BFS|DFS|recursion|big[- ]?o|complexity|rate limiting|caching|consistency|sharding|normalization|oauth|jwt)\b/i;
// Salary / comp valor detector — used para flag sensitive notes então SessionMemory
// auto-promotes them para `comp` (gated para negotiation).
const SALARY_VALUE_RE = /\b\d{2,3}\s?k\b|\b\d{1,3}\s?(?:lpa|lakh|lakhs)\b|[$£€]\s?\d|\b\d{3,}\s?(?:per|\/)\s?(?:year|yr|annum|month)\b|\b(?:base salary|expected (?:salary|comp|ctc|package)|total comp(?:ensation)?|equity grant|rsus?|signing bonus|ctc)\b/i;

/**
 * Extrair salient entities de one turn's text. `speakerRole` lets nós treat a curto
 * candidate answer ("Refract.") como a project nnome Retorna [] para filler/noise.
 */
export function extractTranscriptEntities(text: string, speakerRole?: 'interviewer' | 'user' | 'assistant'): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const t = String(text || '');
  if (!t.trim()) return out;

  // Compensation Primeiro — qualquer comp-looking valor é tagged sensitive (caller gates it).
  if (SALARY_VALUE_RE.test(t)) out.push({ kind: 'comp', value: t.trim().slice(0, 80), sensitive: true });

  // skills (antes CamelCase então a CamelCase skill como TypeScript isn't a "project")
  const skill = t.match(SKILL_RE);
  if (skill) out.push({ kind: 'skill', value: skill[0] });

  // PROJECT names: CamelCase tokens (excluding known skills).
  const camel = t.match(/\b[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*\b/g) || [];
  for (const c of camel) { if (!KNOWN_SKILLS.test(c) && !out.some(e => e.value === c)) out.push({ kind: 'project', value: c }); }
  // a único capitalized próprio noun introduced por a product cue.
  const cued = t.match(/\b(?:tell me about|about|project called|called|use|using|on|back to|to)\s+([A-Z][a-z][a-zA-Z0-9]{2,})\b/);
  if (cued && !STOP_PROPER.has(cued[1]) && !KNOWN_SKILLS.test(cued[1]) && !out.some(e => e.value === cued[1])) out.push({ kind: 'project', value: cued[1] });
  // a Curto candidate answer que é apenas a próprio noun ("Refract.") names a project.
  if (speakerRole !== 'interviewer') {
    const words = t.trim().replace(/[.?!,]/g, '').split(/\s+/).filter(Boolean);
    if (words.length <= 3) {
      for (const w of words) {
        if (/^[A-Z][a-z][a-zA-Z0-9]{2,}$/.test(w) && !STOP_PROPER.has(w) && !KNOWN_SKILLS.test(w) && !out.some(e => e.value === w)) {
          out.push({ kind: 'project', value: w });
        }
      }
    }
  }

  // companies / customers ("customer Acme", "talking para Globex", "cliente Initech").
  const company = t.match(/\b(?:customer|account|client|talking to|prospect)\s+([A-Z][a-z]+)\b/);
  if (company && !STOP_PROPER.has(company[1])) out.push({ kind: 'company', value: company[1] });

  // action-item OWNER (a person nnome → decision valor = o owner (então "quem owns
  // that?" recalls o owner).
  const owner = t.match(/\b(?:owner|assigned to)\s+([A-Z][a-z]+)\b/);
  if (owner && !STOP_PROPER.has(owner[1])) out.push({ kind: 'decision', value: owner[1] });

  // lecture / technical topics.
  const topic = t.match(TOPIC_RE);
  if (topic && !out.some(e => e.value.toLowerCase() === topic[0].toLowerCase())) out.push({ kind: 'topic', value: topic[0] });

  return out;
}

/** Faz o texto começa com / conter a correction cue ("actually", "correction")? */
export function isCorrectionTurn(text: string): boolean {
  return /\b(actually|correction|instead|let'?s use|moved to|scratch that|i meant)\b/i.test(String(text || ''));
}

/** Faz o question explicitly invite cross-mode perfil recall em coding/etc?
 * Anchored para a PROFILE/PROJECT objeto (code-review 2026-06-07c) então a benign "em
 * college" / "em o project structure" doesn't falsely relax o blimite */
export function isExplicitCrossModeInvite(text: string): boolean {
  const t = String(text || '');
  return /\b(use|using|with|in|from)\s+(my|your|this|that|the)\s+(refract|project|portfolio|own (project|code|app))\b/i.test(t)
    || /\bin refract\b/i.test(t)
    || /\bhave you (?:used|done|built|implemented|applied)\b[^.?!]*\bin\s+(your|my|this|that|the)\s+(refract|project|portfolio|app|product|work|experience)\b/i.test(t);
}
