// AnswerPlanner.ts
// Este arquivo implementa o planejador de respostas para entrevistas técnicas.
// Ele classifica o tipo de pergunta (coding, behavioral, fit, negociação, etc.),
// seleciona o template apropriado, define as camadas de contexto necessárias
// e proibidas, e gera um plano de resposta (AnswerPlan) que orienta a geração
// do conteúdo pelo LLM. Contém também funções auxiliares para detecção de
// padrões, formatação de prompts e resolução de entidades.

import type { IntentResult } from './IntentClassifier';
import type { ExtractedQuestion } from './transcriptQuestionExtractor';
import { CODING_CONTRACT, CODING_VERIFICATION_INSTRUCTION } from './codingContract';
import { detectAnswerStyle, type AnswerStyle } from './answerStyle';
import { classifyTargetSpeakability, classifyShortBand, shortBandTargetWords } from './speakability';
import { applyModeFallback, type ActiveModeInfo } from './modeProfiles';

export type AnswerType =
  | 'identity_answer'
  | 'profile_fact_answer'
  | 'project_answer'
  | 'skills_answer'
  | 'skill_experience_answer'
  | 'experience_answer'
  | 'jd_fit_answer'
  | 'gap_analysis_answer'
  | 'behavioral_interview_answer'
  | 'project_followup_answer'
  | 'coding_question_answer'
  | 'dsa_question_answer'
  | 'technical_concept_answer'
  | 'system_design_answer'
  | 'debugging_question_answer'
  | 'negotiation_answer'
  | 'sales_answer'
  | 'product_candidate_mix_answer'
  | 'lecture_answer'
  | 'follow_up_answer'
  | 'unknown_answer'
  | 'general_meeting_answer'
  // Release 2026-06-06b (real manual-chat registrar fixes):
  // A requisição para a project's public linkar / repo / website. Shares a loaded URL
  // (open-source/public/user-provided), ou says o linkar isn't loaded — Nunca
  // refuses com "I can't share that" e Nunca invents a URL.
  | 'project_link_answer'
  // A requisição para o ACTUAL fonte código de a loaded project ("a snippet you used
  // para build Refract", "repo-verifiable code"). Precisa recupera real fonte if
  // loaded + cite it, senão say exact fonte isn't loaded e label qualquer demo
  // conceptual — Nunca present generic código como o real implementation.
  | 'source_code_evidence_answer'
  // A safety rotea para stealth / undetectability / proctoring-evasion asks. Precisa
  // decline para help ocultar a ferramenta de an interviewer ou bypass detection, and
  // redirecionar para privacy-first / consent / transparency / low-distraction themes.
  | 'ethical_usage_answer'
  // A question Sobre o product/project si mesmo ("o que kind de app é Refract?",
  // "how's its backend?") — grounded em loaded project mmetadados não overclaim.
  | 'project_about_answer';

export type AnswerSource = 'manual_input' | 'what_to_answer' | 'transcript' | 'system';
export type SpeakerPerspective = 'candidate' | 'interviewer' | 'user' | 'assistant' | 'unknown';
export type OutputPerspective = 'first_person_candidate' | 'second_person_user' | 'assistant_explanation';

// Fase 2: voice é SEPARATE de profile-context usage. A question pode precisa o
// candidate's first-person interview voice Sem needing qualquer perfil facts
// (e.g. "como iria you uso GraphQL?" — speak como o candidate, mas invent não
// reretomar `outputPerspective` (aacima é kept como a backward-compatible alias de
// `voicePerspective` para existing chamar sites.
export type VoicePerspective =
  | 'first_person_candidate'   // speak Como o candidate ("I wouiria "I built…")
  | 'second_person_user'       // assistant telling o user sobre themselves ("Your nome is…é
  | 'assistant_explanation'    // neutral explanation (coding, teaching, sales, lecture)
  | 'third_person_summary';    // summarising others (meeting recap)

// Fase 2: se o user's Perfil (resume/JD/projects/experience) pode ground
// o answer. Decoupled de voice. `forbidden` é a HARD regra o execution
// caminho enforces (coding/technical/sales/lecture obtém Não pperfil spec §8.3).
export type ProfileContextPolicy =
  | 'required'    // o answer é Sobre o user — perfil Precisa ground it
  | 'allowed'     // perfil pode help mas isn't mandatory (negotiation evidence, general)
  | 'forbidden';  // perfil precisa Não ser injected (coding/technical/sales/lecture)
export type ContextLayer =
  | 'stable_identity'
  | 'resume'
  | 'jd'
  | 'custom_context'
  | 'ai_persona'
  | 'negotiation'
  | 'reference_files'
  | 'live_transcript'
  | 'prior_assistant_responses'
  | 'active_mode'
  | 'screen_context'
  | 'preferred_language';

export interface AnswerPlan {
  answerType: AnswerType;
  source: AnswerSource;
  speakerPerspective: SpeakerPerspective;
  /** @obsoleto Backward-compatible alias de `voicePerspective` (Fase 2). */
  outputPerspective: OutputPerspective;
  /** Fase 2: como o answer deve SPEAK (voice), independent de perfil usage. */
  voicePerspective: VoicePerspective;
  /** Fase 2: se o user's Perfil pode ground o answer (required|allowed|forbidden). */
  profileContextPolicy: ProfileContextPolicy;
  /**
   * Phase 5: o project/entity a follow-up resolves para ("how is IT developed?"
   * → "Refract"). Set para project_followup_answer; undefined otherwise. Used to
   * scope grounding para o direita project node sem re-asking o model.
   */
  resolvedEntity?: string;
  requiredContextLayers: ContextLayer[];
  forbiddenContextLayers: ContextLayer[];
  responseTemplate: string;
  /**
   * Latency budget para o primeiro useful token, in ms (the target o live path
   * is held to). Named per REPORT_TO_CHATGPT Phase 5; `maxInitialLatencyMs` is
   * kept as a deprecated alias para any external reader.
   */
  maxFirstUsefulTokenMs: number;
  /** @obsoleto alias de maxFirstUsefulTokenMs — kept para compatibility. */
  maxInitialLatencyMs: number;
  requiresLLM: boolean;
  canUseFastPath: boolean;
  /**
   * True para structured answer types (coding/DSA/system-design/debugging) where
   * o UI deve paint a deterministic section scaffold BEFORE any model token,
   * so o user nunca sees code-first / malformed markdown mid-stream.
   */
  shouldShowImmediateScaffold: boolean;
  question: string;
  confidence: number;
  /**
   * Release 2026-06-08: o requested ANSWER STYLE/length detected de o question
   * phrasing ("quickly", "in detail", "one line", "code only", "bullet points",
   * "explain para a beginner"). Shapes FORM apenas — nunca routing, voice, grounding, or
   * leak boundaries. 'default' quando não explicit cue is present.
   */
  answerStyle: AnswerStyle;
  /** Soft spoken-length alvo em seconds (0 = não explicit corestrição */
  answerStyleTargetSeconds: number;
}

export interface PlanAnswerInput {
  question?: string | null;
  source: AnswerSource;
  speakerPerspective?: SpeakerPerspective;
  extractedQuestion?: ExtractedQuestion | null;
  intentResult?: IntentResult | null;
  hasCandidateProfile?: boolean;
  hasJobDescription?: boolean;
  hasNegotiationContext?: boolean;
  /**
   * PI v3 (W1): o ativo ModesManager mode, used as a routing PRIOR on the
   * classification FALLTHROUGH apenas (modeProfiles.applyModeFallback). Explicit
   * answer-type signals sempre win; o mode nunca relaxes a forbidden layer.
   * Optional — absent keeps o mode-blind behavior byte-for-byte.
   */
  activeMode?: ActiveModeInfo | null;
}

// Deriva de o único canonical CODING_CONTRACT (codingContract.ts) então o
// planner's template pode nunca drift de o prompts/validator. Adiciona o two
// answer-contract rules que são planner-specific (não contexto leakage, não
// Refract mention) em topo de o shared section spec.
// NOTE: o hidden <verification_spec> instrução é appended at PROMPT-BUILD
// time (formatAnswerPlanForPrompt) apenas quando código verification é enabled, então a
// desabilitado kill-switch também para o modelo wasting tokens emitting o spec.
// Keeping it Fora de isso base template também keeps AnswerPlanner pure/testable.
const CODING_TEMPLATE = `You are generating a live coding interview answer.

${CODING_CONTRACT}

Additional rules:
- Do not include resume, JD, salary, negotiation, or unrelated profile context unless explicitly asked.
- NEVER mention "Refract", the assistant, the product, or the candidate's profile/projects anywhere in the answer — not in the explanation, not in a closing remark, not in an example. This is a pure technical answer about the algorithm only.`;

const BEHAVIORAL_TEMPLATE = `Use exactly these sections:

Direct Answer:
[One clear first-person answer.]

Strong Example / STAR:
[Situation, task, action, result using only grounded candidate facts.]

Why It Matters For This Role:
[Connect to the role only if JD context is present.]

Short Closing Line:
[One speakable closing sentence.]`;

// Fase 3: a dedicated PROJECT template — project questions são Não behavioral
// STAR stories. Nome o project, o que era built, o (grounded) spilha o
// candidate's personal role, e a grounded outcome — nunca an invented metric.
const PROJECT_TEMPLATE = `Use exactly these sections:

Best / Relevant Project:
[Directly name the project from the grounded profile.]

What I Built:
[One concise first-person explanation of what the project is.]

Tech Stack:
[Technologies used — ONLY those present in the grounded project facts.]

My Role:
[What the candidate personally did. First person.]

Impact / Why It Matters:
[A grounded outcome or value. NEVER invent metrics, percentages, or numbers.]

Speakable Final Answer:
[A 2-4 sentence first-person version the candidate can say aloud.]`;

// Fase 5: project FOLLOW-UP — drilling dentro de a project já named. Answer o
// específico drill-in (como built / role / pilha / hardest part / por que / learnings)
// em primeiro person, grounded Apenas em que project's facts e o prior turn.
const PROJECT_FOLLOWUP_TEMPLATE = `You are answering a live FOLLOW-UP about a specific project the candidate already mentioned.

Rules:
- Answer the EXACT drill-in asked (how it was built, your role, the tech stack, the hardest part, why you built it, what you learned, optimisation) in FIRST PERSON.
- Stay on the SAME project being discussed; do not switch projects.
- Use ONLY grounded project facts. Never invent metrics, dates, team sizes, or technologies that are not in the project's facts.
- Keep it concise and speakable (2-5 sentences). No headers unless the question asks for a breakdown.`;

const JD_FIT_TEMPLATE = `Use exactly these sections:

Short Fit Summary:
[Concise fit statement.]

Matching Experience:
[Grounded candidate experience relevant to the role.]

Matching Skills/Projects:
[Grounded skills/projects mapped to JD needs.]

Why This Role:
[Specific motivation tied to JD/company context.]

Speakable Final Answer:
[Polished first-person answer the candidate can say.]`;

// GAP / weakness-for-the-role. O answer precisa LEAD com an honest, específico gap, então
// a concrete mitigation — Não a fit-summary. Primeiro person. Grounds o gap contra o
// JD e o candidate's real pperfil pivots para adjacent strength apenas Após o gap
// é claramente stated. Nunca invents experience; nunca stalls. (Release 2026-06-09.)
const GAP_ANALYSIS_TEMPLATE = `This is a GAP question, not a "why hire me" question. Lead with the honest gap.
Use exactly these sections:

The Honest Gap:
[Name ONE specific, JD-relevant gap or area you're less experienced in. Be concrete (a tool, domain, or depth of experience the JD wants that your profile shows less of). Do NOT pretend you have no gaps. Do NOT turn this into a fit-summary.]

Why It's Manageable:
[Briefly, the adjacent/real experience that makes you confident you can close it fast — grounded in your actual profile, no invented experience.]

How I'd Close It:
[A specific, realistic mitigation/ramp plan.]

Speakable Final Answer:
[A confident-but-honest first-person answer the candidate can say out loud: gap first, then mitigation. Do not say "let me come back to that".]`;

const NEGOTIATION_TEMPLATE = `Use exactly these sections:

Polite Opening:
[Acknowledge the question or offer professionally.]

Flexible Range / Expectation:
[State grounded target/range if available, otherwise preserve flexibility.]

Justification:
[Brief value-based justification.]

Closing:
[Collaborative next step.]`;

const SYSTEM_DESIGN_TEMPLATE = `Use exactly these sections:

Clarify Requirements:
[State the most important assumptions or questions.]

High-Level Design:
[Architecture overview.]

Core Components:
[Main services/components and responsibilities.]

Data Flow:
[How requests/data move through the system.]

Scaling / Reliability:
[Scale, fault tolerance, observability.]

Tradeoffs:
[Key design tradeoffs.]

Follow-up Points:
[Likely interviewer follow-ups.]`;

const DEBUGGING_TEMPLATE = `Use exactly these sections:

Likely Cause:
[Most probable root cause.]

How I Would Investigate:
[Concrete debugging steps.]

Fix:
[Specific fix or mitigation.]

Validation:
[How to prove it works.]

Prevention:
[How to prevent recurrence.]`;

const DIRECT_SHORT_TEMPLATE = `Answer directly in 1-2 sentences. Do not include irrelevant context. Do not mention loaded context.`;
// Skill experience / self-rating asks ("rate Python fora de 10", "como forte é your
// SQL?"). O modelo precisa answer Como O CANDIDATE com a confident, concrete rating —
// Nunca refuse como "an AI assistant" ou say it "cannot assign ratings" (release
// 2026-06-07: flash-lite era declining skill ratings). Ground o rating em o
// loaded experience; speak para o user sobre their próprio skill.
const SKILL_RATING_TEMPLATE = `Answer in 1-2 sentences as the candidate. If asked to rate a skill (e.g. "out of 10"), GIVE a concrete number grounded in the loaded experience and add one phrase of justification. Never refuse, never say you are an AI or that you "cannot assign ratings". Do not mention the profile/context explicitly — just answer confidently.`;
const GENERAL_TEMPLATE = `Answer naturally and directly. Use only relevant context. Keep it predictable and concise.`;

// Generic technical-concept answers (o que é Redis / JWT / CORS / caching / REST) eram
// coming voltar como longo beginner TUTORIALS. Em an interview o user precisa a scurto confident
// spoken answer, não a classroom lesson (spoken-answer-quality sprint 2026-06-15).
const TECHNICAL_CONCEPT_TEMPLATE = `You are the candidate SPEAKING this answer aloud to an interviewer. Give the exact words you'd SAY — a short, plain spoken answer, NOT documentation.

THIS IS A SPOKEN ANSWER. Output MUST be ONE short paragraph of plain sentences. It is WRONG if it contains ANY of these:
- a markdown heading (## or **Heading**)
- a bullet list or a numbered list
- a "Key Concepts" / "How it works" / "Common use cases" / "Performance" section
- a code block or a code example
- a table

Shape:
- 2 to 4 sentences, usually 40 to 80 words. If a single sentence answers it, stop there.
- Sentence 1 is a plain one-line definition. Then at most one or two sentences with the single most relevant tradeoff or use, woven into prose.
- No analogy unless the user asked for simple terms / "explain like I'm 5".

Example of the RIGHT shape (for "what is Redis?"):
"Redis is an in-memory key-value store, so reads and writes are extremely fast. People mostly use it for caching, sessions, and rate limiting, and the main tradeoff is that it lives in memory, so you watch cost and what data really belongs there."

Sound like a competent engineer answering quickly in conversation — calm, specific, done in about 20 seconds.`;

// SALES voice (manual regression 2026-06-12): real sales-mode sessions answered
// "por que é your product expensive?" com "I'm Refract, an AI assistant. I don't
// ter a product ou pricing mmodelo — o modelo fell voltar para its system identity
// porque sales_answer tinha não template telling it Quem it é em isso turn. O
// seller speaks como o PRODUCT/TEAM REP, grounded em o ativo mode's product
// material (custom contexto / referência files); o resume/JD stay forbidden.
const SALES_TEMPLATE = `You are the SELLER'S spoken voice in a live sales/commercial conversation. The user is selling a product; the question comes from a customer or prospect.

Rules:
- Speak in FIRST PERSON as the product's representative ("our product", "we", "our pricing"). You are NOT an AI assistant in this answer and must NEVER say "I'm Refract", "as an AI", or "I don't have a product" — the user's product context defines the product.
- Ground product claims in the provided mode/custom/reference context. If pricing or a specific fact isn't in the context, handle it like a real seller: acknowledge, reframe around value, and offer to follow up with specifics — never claim the product doesn't exist.
- Handle objections (price, speed, competitors) with empathy + value reframe + one concrete differentiator from the context when available.
- 2-5 sentences, confident, speakable, no headings or bullet markers unless asked.
- Never pull the user's resume, JD, or salary data into a sales answer.`;

// Release 2026-06-06b — safety rotea para stealth/undetectability/evasion asks.
const ETHICAL_USAGE_TEMPLATE = `The user is asking how to make this tool hidden, undetectable, invisible to an interviewer, or how to evade detection / proctoring / screen-share / network monitoring.

You MUST NOT provide any guidance for hiding the tool from an interviewer, making it undetectable, evading screen-share or proctoring detection, bypassing monitoring, or otherwise using it to deceive or cheat. Do not describe hidden overlays, transparency tricks, secondary-monitor concealment, virtual-device evasion, or network-evasion.

Instead, in 2-4 sentences:
1. Briefly and politely decline to help make it undetectable or hidden from an interviewer.
2. Redirect to what IS supported: privacy-first design, on-device/local processing, clear permissions and consent, a low-distraction minimal UI, accessibility, and transparent, user-controlled use in meetings.
3. Note that the tool should be used openly and ethically, not to deceive interviewers or bypass rules.

Do NOT lecture at length. Be concise, helpful, and firm.`;

// Release 2026-06-06b — project linkar / repo / public URL.
const PROJECT_LINK_TEMPLATE = `The user is asking for a project's link, repository, GitHub, website, or source URL.

Rules:
- ONLY share a URL that is actually present in the provided project/profile/custom context. Quote it verbatim.
- If NO URL is loaded for the relevant project, say plainly: "I don't have the repository/link loaded in my current profile context." Optionally add: "If you add it to the project metadata I can share it."
- NEVER invent or guess a GitHub/GitLab/website URL from the project name.
- NEVER say "I can't share that information" — a missing link is "not loaded", not "forbidden", unless the context explicitly marks the link private.
Keep it to 1-2 sentences.`;

// Release 2026-06-06b — actual source-code evidence rsolicita
const SOURCE_CODE_EVIDENCE_TEMPLATE = `The user is asking for the ACTUAL source code / a real snippet used in a loaded project (possibly to cross-verify against a public repo).

Rules:
- If the exact source code for the project is present in the provided context (reference files / loaded source), quote the relevant real snippet, name the file it came from, and add a one-line explanation. Do not modify it unless asked.
- If the exact source code is NOT loaded, say clearly: "I don't have Refract's exact source code loaded in my current context, so I can't give you a repo-verifiable snippet." Then, ONLY IF it helps, offer a clearly-labeled CONCEPTUAL example: prefix it with "Here's a conceptual illustration (NOT the actual repo code):".
- NEVER present a generic/conceptual snippet as if it were the real implementation.
- NEVER invent file names, function names, or claim a snippet is "from the repo" when it is not loaded.
Be honest about what is and isn't available.`;

// Release 2026-06-06b — questions Sobre o product/project isi mesmo
const PRODUCT_ABOUT_TEMPLATE = `The user is asking about the product/project itself (what kind of app it is, its backend, architecture, or tech).

Ground every concrete claim in the provided project/profile metadata. If the metadata describes it (e.g. "privacy-first, open-source, local RAG, Electron + Rust core, Ollama, SQLite"), you may state those. If a detail is NOT in the loaded context, do not invent it — say "from the loaded project description…" and stay within what's described, or note that a specific detail isn't in your loaded context. Distinguish the desktop app core from any local services and any separately-loaded cloud/API path. Keep it concise and concrete.`;

const includesAny = (text: string, patterns: RegExp[]): boolean => patterns.some(pattern => pattern.test(text));

// CS/technical subject terms that, quando combined com explain/what-is framing,
// mark a generic technical-concept question (não prperfil Deliberately broad —
// o gate é "explain/what-is + (a DSA term Ou one de these)", então a plain
// perfil question como "o que é my nnome nunca reaches aqui (IDENTITY wins
// fiprimeiro e "o que projects ter I dfeito lacks ambos a DSA term e these.
const TECHNICAL_SUBJECT_PATTERNS = [
  /\b(deadlock|mutex|semaphore|thread|process|concurrency|race condition)\b/i,
  /\b(tcp|udp|http|https|dns|ip|osi|latency|throughput|socket)\b/i,
  /\b(database|index|normalization|acid|transaction|sharding|replication)\b/i,
  /\b(sql|nosql|no[- ]?sql|relational|document (db|database|store)|key[- ]?value|columnar|mongodb|postgres\w*|mysql|sqlite)\b/i,
  /\b(eventual consistency|strong consistency|consistency model|cap theorem|consensus|quorum|paxos|raft|two[- ]?phase commit)\b/i,
  /\b(amortized|complexity|big[- ]?o|asymptotic|np[- ]?complete)\b/i,
  /\b(closure|hoisting|prototype|garbage collection|event loop|promise|async)\b/i,
  /\b(rest|graphql|grpc|microservice|monolith|cache|caching|cdn|load balanc|rate limit\w*|rate[- ]?limiter|message queue|pub[- ]?sub|webhook|idempoten\w*|backpressure|circuit breaker)\b/i,
  /\b(encryption|hashing|oauth|jwt|tls|ssl|cors|xss|csrf|sql injection)\b/i,
  /\b(pointer|reference|stack|heap|recursion|iteration|polymorphism|inheritance)\b/i,
  // Frameworks / cloud / data-eng subjects que appear em "explain X" concept
  // asks (benchmark 2026-06-05): FastAPI, AWS EC2/S3/Lambda, indexing, dashboard,
  // pandas/numpy/spark/hadoop, A/B testing, retention/ETL/pipeline.
  /\b(fastapi|flask|django|express|node\.?js|react|next\.?js|spring)\b/i,
  /\b(aws|ec2|s3|lambda|azure|gcp|kubernetes|docker|redis|kafka)\b/i,
  /\b(indexing|pandas|numpy|spark|hadoop|etl|dataframe)\b/i,
  /\b(a\/b test|ab test|retention|cohort|regression|classification|clustering)\b/i,
];
const isLikelyTechnicalConcept = (text: string): boolean => includesAny(text, TECHNICAL_SUBJECT_PATTERNS);

const DSA_PATTERNS = [
  /\btwo\s*sum\b/i,
  /\blongest substring\b/i,
  /\breverse (a )?linked list\b/i,
  /\blinked list\b/i,
  /\bbinary search\b/i,
  /\bsliding window\b/i,
  /\btwo pointers?\b/i,
  /\bhash\s?(map|set|table)\b/i,
  /\bstack\b|\bqueue\b|\bheap\b|\btrie\b/i,
  /\bgraph\b|\btree\b|\bbfs\b|\bdfs\b/i,
  /\bdynamic programming\b|\bdp\b|\bmemoization\b/i,
  /\bbacktracking\b|\brecursion\b|\bunion[- ]find\b/i,
  /\btime complexity\b|\bspace complexity\b|\bbig[- ]?o\b/i,
  /\bkth (largest|smallest|highest|lowest)\b|\bk-?th\b/i,
  /\b(find|merge|sort|detect|check) (the )?(kth|longest|shortest|maximum|minimum|cycle|duplicate|missing|first|second highest)\b/i,
  /\b(quicksort|mergesort|bubble sort|insertion sort|palindrome|fibonacci|anagram|fizzbuzz)\b/i,
];

const COMMON_CODING_PROBLEM_PATTERNS = [
  /\bodd\s*(?:\/|or|and|even)?\s*even\b|\beven\s*(?:\/|or|and)?\s*odd\b/i,
  /\b(check|find|determine|detect)\b.*\b(odd|even)\b/i,
  /\bprime number\b|\bpalindrome\b|\bfactorial\b|\bfibonacci\b/i,
  /\breverse string\b|\bsort array\b|\bfind (?:max|min)\b/i,
  /\bcheck if\b/i,
  // Named classic problems que lack an explicit coding verb. These são
  // unambiguously DSA/coding asks ("valid parentheses", "fizzbuzz") então o
  // planner precisa rotea them para o coding contract até quando phrased bare.
  /\bvalid parentheses\b|\bbalanced parentheses\b|\bmatching brackets\b/i,
  /\bfizz\s?buzz\b/i,
  /\banagram\b|\bsubarray\b|\bsubstring\b/i,
  /\bmerge (?:two )?(?:sorted )?(?:arrays?|lists?)\b/i,
  /\b(?:detect|find)\b.*\bcycle\b|\blinked list cycle\b/i,
  /\blevel order\b|\bin\s?order\b|\bpre\s?order\b|\bpost\s?order\b|\btraversal\b/i,
  /\bgcd\b|\blcm\b|\bgreatest common divisor\b/i,
  /\bbubble sort\b|\bquick\s?sort\b|\bmerge sort\b|\binsertion sort\b/i,
];

const CODING_PATTERNS = [
  /\b(write|implement|code|program|function|class|method|solve)\b/i,
  /\bcode for\b|\bprogram for\b|\bfunction for\b|\balgorithm for\b/i,
  /\balgorithm\b|\bdebug this\b|\bfix (this|the) bug\b/i,
  // A bare language nome é Não a coding sinal em its próprio — "como iria you uso
  // SQL", "explain SQL", "ter you used Python" são concept/experience asks, não
  // "escreve code" tasks. Apenas treat a language como coding quando paired com an
  // explicit coding verb então o bare nome can't hijack technical_concept /
  // skill_experience / jd_fit routing (benchmark 2026-06-05).
  /\b(write|implement|code|coding|program|snippet|function|script|reverse|sort|parse)\b[\w ,'-]*\b(javascript|typescript|python|java|c\+\+|sql|go|golang|rust)\b/i,
  /\bin (javascript|typescript|python|java|c\+\+|sql|golang|rust)\b[\w ,'-]*\b(write|code|implement|function|program)\b/i,
  ...COMMON_CODING_PROBLEM_PATTERNS,
];

const SYSTEM_DESIGN_PATTERNS = [
  /\bsystem design\b|\bdesign (a|an|the)\b/i,
  /\bscalable\b|\bscale\b|\barchitecture\b|\bdistributed\b/i,
  /\brate limiter\b|\burl shortener\b|\bchat system\b|\bnotification system\b/i,
];

const DEBUGGING_PATTERNS = [
  /\bdebug\b|\broot cause\b|\bwhy.*(failing|crashing|broken)\b/i,
  /\berror\b|\bexception\b|\bstack trace\b|\bbug\b/i,
  // "por que é my API returning 500 / a 404 / errors intermittently", "por que faz X
  // retorna <stastatus "por que é my <thing> slow/timing ofora (release 2026-06-07).
  /\bwhy (is|does|are|do)\b.{0,40}\b(return\w*|throw\w*|fail\w*|crash\w*|hang\w*|timing out|time out|timeout|slow|leak\w*|intermittent\w*)\b/i,
  /\breturn\w*\s+(a\s+)?(4\d\d|5\d\d)\b|\b(4\d\d|5\d\d)\s+(error|status|response|intermittent\w*)\b/i,
  /\bwhy.*(not working|isn'?t working|won'?t work|keeps? (failing|crashing|breaking))\b/i,
];

const NEGOTIATION_PATTERNS = [
  /\bsalary\b|\bcompensation\b|\bctc\b|\boffers?\b|\boffered\b|\bpay\b|\bequity\b|\bbonus\b|\braise\b/i,
  /\bexpected\s+(range|salary|compensation|package|pay|ctc)\b|\bcurrent\s+(salary|ctc|package)\b/i,
  // "expected/expecting papacote "como muito papacote "o que ppacote — comp asks
  // que uso "ppacote como o salary noun (benchmark 2026-06-05). Exige o
  // expect/how-much framing então "tech pilha ppacote ou an npm "ppacote nunca trips.
  /\b(expecting|expect|how much|what(?:'s| is)?)\s+(your\s+)?(expected\s+)?package\b/i,
  /\bpackage\s+(are|you|expectation|expecting)\b/i,
  // Offer/counter-offer phrasing sem an explicit "salary" noun. Deliberately
  // faz Não corresponder a bare número alone ("100k ararray — apenas negotiation verbs —
  // então a coding question que happens para mention a tamanho isn't mis-routed.
  /\bcounter(?:\s*-?\s*offer|ing|\b)|\bnegotiat\w*\b|\blow\s?ball\b|\bwalk\s?away\b|\bbatna\b/i,
  /\b(lpa|\d\s?k)\b.*\b(counter|offer|salary|negotiat\w*|expect)\b|\b(counter|offer|salary|negotiat\w*|expect)\b.*\b(lpa|\d\s?k)\b/i,
  // High-signal compensation PUSHBACK phrasings o interviewer uses ("nosso budget
  // é loinferior "pode you come doabaixo "that's higher than we budgeted"). Específico
  // enough para avoid colliding com a PM's "project budget" — exige o comp
  // direção verb. Mirrors o premium classifier's stickiness vocabulary.
  /\bbudget is (lower|tight|limited|less|under|capped|fixed|only|around|\$|\d)\b/i,
  /\b(come down|go lower|do better) (on|with)\b|\bcan you come down\b|\bmeet (me )?in the middle\b/i,
];

const IDENTITY_PATTERNS = [
  // Ambos "my nnome (manual/user asking) e "your nnome (interviewer asking o
  // candidate) — spec §1/§11 exigir bambos O candidate-voice perspective é
  // decided separately de o answerType, então "your nnome ainda answers
  // "My nome é ..." em primeiro person quando an interviewer asks.
  /\bwhat(?:'s| is)? (my|your) name\b/i,
  /\bwhats (my|your) name\b/i,
  /\bwho am i\b/i,
  /\bwho are you\b|\bwho (u|r) (u|r|you)\b|\bwho\s+u\s*r\b/i,    // "quem u r", "quem r u"
  /\btell me who you are\b|\bwho you are\b/i,
  /\bstart with (an? )?intro\b|\blet'?s start with (your|an) intro\b/i,
  // Typo / greeting / SMS-spelling tolerant intro (real manual-chat registrar
  // 2026-06-06b: "introduce yourseld", "introduce urself", "hey man introduce
  // yourself"). O verb "introduc(e)" + a self-pronoun token (yourself/yourselD/
  // yoursef/urself/urslf) em qualquer lugar em o mensagem routes para identity — greetings
  // e trailing typos não longer soltar it para unknown_answer.
  // Self-pronoun é REQUIRED (code-review 2026-06-06b HIAlto "introduce a bug",
  // "como iria you introduce DI" precisa Não corresponder — apenas "introduce yourself" e its
  // typos (yourseld/yoursef/urself/urslf).
  /\bintroduce\s+(yo?u?r?se?l?[fd]|u?r?se?l?[fd]|me to (?:you|the team))\b/i,
  /\b(quick|brief|short)\s+intro\b|\b(give|do)\s+(me\s+)?(a\s+|an\s+|your\s+)?intro\b|\bintro\s+(yourself|urself|please|pls|me|about you)\b|^intro$/i,
  /\btell me about yourself\b/i,
  /\bstate your name\b/i,
  /\bwhat(?:'s| is) your (full )?name\b/i,
  // "Walk me através your background/career/journey" — o intro/identity ask
  // (spec groups it com identity). First-person, perfil required.
  /\bwalk me through your (background|experience|resume|cv|career|journey|profile)\b/i,
  // Natural intro/identity phrasings (benchmark 2026-06-05): "give me a rápido
  // introduction", "o que deve I chamar you?", "como iria you describe yourself
  // (professionally)?", "(pode you )resumir quem you arsão "introduce yourself".
  /\b(give|tell)\s+(me\s+)?(a\s+)?(quick\s+|brief\s+|short\s+)?(introduction|intro|overview of yourself|rundown)\b/i,
  /\bwhat should (i|we) call you\b/i,
  /\b(how (would|do) you )?describe yourself\b/i,
  /\b(summari[sz]e|describe|tell me about) who you are\b/i,
  /\bcan you (introduce|tell me about) yourself\b/i,
  // "Give me o 30-segundo / elevator / curto versão de quem you são / yourself" —
  // an intro ask phrased como a length-bounded "vversão (release 2026-06-06 WTA).
  /\b(give|tell)\s+me\s+(the|a)\s+(\d+[- ]?second|elevator|short|quick|brief|two[- ]?minute|one[- ]?minute)\s+(version|pitch|rundown|summary)\b/i,
  /\b(\d+[- ]?second|elevator)\s+(version|pitch|intro|introduction)\b/i,
  /\bversion of (who you are|yourself)\b/i,
  // "(Give|tell) me your/a-quick/a-brief background|intro|overview" — a
  // conversational opener intro ask (release 2026-06-06: medium_003). Se bare
  // ("give me your background") ou brevity-qualified ("a rápido background"), it's an
  // intro/identity pitch, não a detailed experience walkthrough. O Segundo pattern
  // adiciona o explicitly TIME-BOUNDED formulário ("your fundo em 30 seconds / sob a
  // minute"). JD-fit "como faz your fundo corresponder isso role?" é unaffected — it
  // exige nenhum "give/tell me" nem a time bound, então it nunca matches haqui
  /\b(give|tell)\s+me\s+(your|a quick|a brief|a short)\s+(background|intro|overview)\b/i,
  /\byour\s+(background|story|intro)\s+(in|under)\s+(\d+\s*(seconds?|minutes?)|a (minute|sentence|line))\b/i,
];

// ── SAFETY: stealth / undetectability / proctoring-evasion (release 2026-06-06b) ──
// Asking como para ocultar a ferramenta de an interviewer, make it undetectable/invisible
// em a tela share, evade detection/proctoring/network-monitoring, ou caso contrário
// cheat covertly. These rotea para `ethical_usage_answer` (a safe decline + redirecionar
// para privacy/consent/transparency). Checked Primeiro então a stealth ask pode nunca reach
// a rotea que iria give específico evasion advice. O phrasing precisa combina an
// EVASION verb/adjective com an interview/screen/detection Objeto então legitimate
// product questions ("é it low-distraction?", "faz it processo locally?") são
// unaffected.
// An EVASION token — wanting o tool unseen/undetected/concealed, Ou a covert /
// cheat / "obtém caught" / "sob o radar" / "sem them knowing" intent. Kept
// broad em purpose: a missed stealth ask reaches o generic LLM com não decline
// contract, então over-coverage (a poucos falso safety-redirects) é longe safer than
// under-coverage (code-review 2026-06-06b CRITICAL). Soft verbs (notice / see /
// realize / ninguém / discreet / secret) são included.
const STEALTH_INTENT_RE = /\b(undetect\w*|undetectible|undectable|invisible|invisibility|conceal\w*|covert\w*|stealth\w*|sneak\w*|discree\w*|secret\w*|surreptitious\w*|cheat\w*|hide\b|hidden\b|hiding\b|off[- ]?screen|keep (?:this|it|refract|the (?:app|tool|overlay)) off|under the radar|on the (?:dl|down[- ]?low)|(?:avoid|evade|bypass|beat|get around|defeat|fool|trick|dodge|escape)\s+(?:being\s+|getting\s+|the\s+)?(?:caught|seen|noticed|detected|detection|proctor\w*|monitor\w*|virtual (?:mic|microphone|camera)|network|webcam|camera)|without (?:them|the interviewer|anyone|him|her|people) (?:know|notic|see|find)\w*|so (?:nobody|no one|they|the interviewer|he|she) (?:can'?t|won'?t|doesn'?t|don'?t) (?:see|notice|detect|catch|find|know)|(?:not|don'?t|won'?t|can'?t) (?:get|getting|be) caught|avoid (?:being |getting )?(?:caught|seen|noticed|detected)|nobody (?:sees|notices|knows)|no one (?:sees|notices|knows))\b/i;
// An INTERVIEW / detection Objeto — o thing o user wants para evade.
const STEALTH_OBJECT_RE = /\b(interview\w*|proctor\w*|invigilat\w*|recruiter|examiner|screen[- ]?shar\w*|screenshar\w*|share my screen|sharing my screen|webcam|web cam|camera|monitor\w*|detection|second(?:ary)? (?:screen|monitor|display)|virtual (?:mic|microphone|camera)|network monitor\w*|the (?:call|meeting|assessment|exam|test)|video call|video[- ]?conferenc\w*|zoom|google meet|ms teams|teams call)\b/i;
// SOFT visibility verbs paired com an interview objeto até Sem an explicit
// evasion token ("pode o interviewer SEE isso overlay?", "vai o recruiter
// NOTICE o app?", "vai it ser VISIBLE em o tela share?").
const STEALTH_SOFT_VISIBILITY_RE = /\b(see|sees|seeing|notice\w*|realize\w*|realise\w*|spot|catch\w*|find out|aware|visible|detect\w*|know about|figure out)\b/i;

/**
 * Verdadeiro quando o mensagem é a stealth / undetectability / proctoring-evasion ask
 * que precisa ser DECLINED + redirected (ethical_usage_answer), independentemente de onde
 * senão it pode ser rrotea Two ways para trip:
 *   (a) an explicit evasion intent + an interview/detection oobjeto Ou
 *   (b) a soft visibility verb ("see / notice / visible") aimed at an
 *       interviewer/proctor/screen-share oobjeto
 * A SAFE product/privacy phrasing ("é it low-distraction?", "faz it processo
 * locally?") é Não enough para exempt isso — an evasion+object combination Sempre
 * wins (code-review 2026-06-06b HAlto o privacy carve-out era exploitable).
 */
export const isStealthEvasionQuestion = (question: string): boolean => {
  const t = (question || '').toLowerCase();
  const hasObject = STEALTH_OBJECT_RE.test(t);
  const hasIntent = STEALTH_INTENT_RE.test(t);
  // (a) explicit evasion intent + an interview/detection oobjeto
  if (hasIntent && hasObject) return true;
  // (a') explicit evasion intent aimed at o TOOL/overlay (não objeto needed):
  // "make it invisible", "keep refract undetectable", "ocultar a sobreposição".
  if (hasIntent && /\b(it|refract|refract|the (?:app|tool|overlay|window|ui)|this)\b/.test(t)
    && /\b(invisible|undetect\w*|hidden|hide|conceal|stealth|disappear|off[- ]?screen)\b/.test(t)) return true;
  // (a'') a bare CHEAT / covert intent com não objeto — "como fazer I cheat sem
  // sendo caught", "help me cheat", "cheat em o interview". Cheating em an
  // interview/assessment contexto é sempre o safety rrotea
  if (/\bcheat\w*\b/.test(t) && /\b(without (?:being |getting )?(?:caught|seen|noticed|detected)|interview|exam|test|assessment|proctor|coding (?:round|test)|on (?:the|this|my))\b/.test(t)) return true;
  // (a''') "usar ISTO/ISTO/A ferramenta SEM ELES SABEREM / secretamente / às escondidas" —
  // covertly using o tool para deceive, até com não explicit interview objeto
  // (release 2026-06-07: "como fazer I uso it sem them knowing"). O covert-use
  // intent + a referência para o tool é o evasion.
  if (/\b(use|using|run|running)\s+(it|this|refract|refract|the (?:app|tool|overlay))\b/.test(t)
    && /\b(without (?:them|the interviewer|anyone|him|her|people|him\/her) (?:know|notic|see|find|realiz|realis)\w*|secretly|covertly|on the (?:sly|dl|down[- ]?low)|so (?:nobody|no one|they) (?:know|notic|see)\w*|undetect\w*|without being (?:caught|seen|noticed))\b/.test(t)) return true;
  // (b) soft visibility verb aimed at an interview/proctor/screen-share oobjeto
  // Excluir a candidate-possessive objeto ("vai o interviewer see MY code/
  // portfolio/answer/screen?") — that's a benign visibility question, não an ask to
  // ocultar o TOOL. Only disparar quando there's não "my/mine" object o candidate owns
  // (code-review 2026-06-07 false-positive-refusal fix).
  const candidatePossessiveVisibility = /\b(see|view|notice|read|watch)\b[^.?!]{0,30}\bmy\b/.test(t)
    || /\bmy (code|portfolio|answer|screen|solution|work|repo|link|profile)\b/.test(t);
  if (hasObject && STEALTH_SOFT_VISIBILITY_RE.test(t) && !candidatePossessiveVisibility
    // exigir o objeto para ser an interviewer/proctor/screen-share (não a bare
    // "mmonitorar hardware word) então "faz it work com a segundo mmonitorar é safe.
    && /\b(interview\w*|proctor\w*|invigilat\w*|recruiter|examiner|screen[- ]?shar\w*|screenshar\w*|share my screen|sharing my screen|the (?:call|meeting|assessment|exam|test))\b/.test(t)) return true;
  return false;
};

// SAFE product/privacy phrasings — used Apenas para lightly bias an ambiguous answer
// em direção a o product rrotea they Nunca sobrescrever isStealthEvasionQuestion (an
// evasion+object combination wins reindependentemente "como é it low-distraction?", "faz
// it processo locally?", "é it privacy-first?".
const SAFE_PRODUCT_PRIVACY_PATTERNS = [
  /\b(low[- ]?distraction|privacy[- ]?first|process(ing)? local|local (processing|first)|on[- ]?device|consent|transparent|accessib|minimal ui|cognitive load|data retention|stores? (data|nothing)|opt[- ]?in)\b/i,
];

// ── PROJECT Linkar / repo / public URL (release 2026-06-06b) ──
// "pode you give me o lilinkar "share o github repo", "mostrar o website",
// "it's abrir fonte rdireito share o lilinkar Routes para `project_link_answer`: share
// a LOADED url, senão say o linkar isn't loaded — nunca refuse, nunca invent.
const PROJECT_LINK_PATTERNS = [
  /\b(give|share|send|show|drop|paste|provide|get) (me )?(the |a |your )?(git ?hub|gitlab|bitbucket|repo|repository|link|url|website|site|demo link|project link|source link|public link)\b/i,
  /\b(git ?hub|gitlab|repo|repository)\s+(link|url|page)?\b/i,
  /\bwhat(?:'s| is)?\s+(the )?(link|url|repo|github|gitlab|website)\b/i,
  /\bwhats?\s+the\s+github\b|\bthe github\??$/i,           // "whats o github"
  // "onde pode I find/see o repo/link/website/source/code Em GITHUB" — a linkar
  // ask. Bare "encontra o source/code" (não github/repo) stays a coding ask, mas
  // "see o código Em GITHUB" / "encontra o fonte Em GITHUB" é asking para o repo.
  /\b(can|could|where) (i|we) (find|see|get|access) (the |your )?(link|repo|repository|github|gitlab|website|site|demo)\b/i,
  /\b(see|find|view|access) (the )?(code|source|repo|project)\b.{0,20}\b(on|at|in|via)\s+(git ?hub|gitlab|the repo)\b/i,
  // "onde pode I encontra o source/repo" — an open-source PROJECT locator → llinkar
  // Exclui "fonte código Para <algorithm>" (a coding ask) via o negative
  // lookahead, e "o code" alone (that's coding). Apenas bare "o source"/"repo".
  /\bwhere(?:'?s| is| can i (?:find|see)) (the )?(source|repo|repository)\b(?!\s*code\s+(for|of|to))/i,
  /\bopen[- ]?source\b.{0,30}\b(link|repo|github|share|url)\b|\b(link|repo|github|url)\b.{0,30}\bopen[- ]?source\b/i,
  // "it's an open-source project direito [share it]" — o user é angling para o
  // llinkar A BARE "é it abrir sfonte (não share/link cue) é a product-about
  // yes/no e é handled por PRODUCT_ABOUT iem vez disso então exigir a share/right cue.
  /\b(its|it'?s|so its|so it'?s)\s+an?\s+open[- ]?source\b|\bopensource (porject|project)\b|\bopen[- ]?source\b.{0,20}\bright\b/i,
  /\bwhy (can'?t|cant|wont|won'?t) (you )?share\b/i,    // "por que can't you share, it's abrir sfonte
];

// ── ACTUAL Fonte CODE evidence solicita (release 2026-06-06b) ──
// "a snippet you used para build Refract", "repo-verifiable code", "actual code
// de your codebase", "we'll cross-verify com github". Precisa não fabricate real
// code. Routes para `source_code_evidence_answer`.
const SOURCE_CODE_EVIDENCE_PATTERNS = [
  // "actual/real/exact código ... de REFRACT / your repo / o codebase / github" —
  // o real código De O LOADED PROJECT. Exige a project/repo anchor então a
  // generic "escreve o exact código para binário sbusca stays a coding tarefa
  // (code-review 2026-06-06b HIAlto
  /\b(actual|real|exact|repo[- ]?verifiable|github[- ]?verifiable)\s+(code|snippet|implementation|function|source)\b.{0,50}\b(refract|refract|your (repo|codebase|source|project)|the (repo|codebase|source|project)|github|gitlab)\b/i,
  /\b(refract|refract|your (repo|codebase|source|project)|the (repo|codebase)|github)\b.{0,50}\b(actual|real|exact|repo[- ]?verifiable)\s+(code|snippet|implementation|function|source)\b/i,
  /\b(snippet|code|function|implementation|file)\b.{0,40}\b(you (used|wrote|built|made)|from (your|the) (codebase|repo|repository|source|github|project)|to (build|built) refract)\b/i,
  // "o que faz your actual <X> código look licomo "mostrar me your <X> code", "your
  // real código para <X>" — asking sobre REFRACT's próprio implementation. A sfonte
  // evidence requisição (precisa não fabricate), não a generic coding ttarefa
  /\b(what does |show me |whats )?(your|the refract|refract'?s)\s+(actual\s+|real\s+)?[\w ]*\bcode\b\s*(look|is|for|of)?/i,
  /\byour (real|actual) code\b/i,
  // "repo-verifiable / github-verifiable snippet|code" — explicitly asks para code
  // que pode ser checked contra o public repo; isso É a source-evidence requisição
  // em its próprio (o "repo-verifiable" qualifier é o anchor).
  /\b(repo[- ]?verifiable|github[- ]?verifiable|verifiable against (?:the )?(?:repo|github))\s+(code|snippet|implementation|function|source)\b/i,
  // "paste/show/give a snippet de o refract repo/codebase/source"
  /\b(paste|show|give|share|pull)\b.{0,30}\b(snippet|code|function|file)\b.{0,30}\b(from (the )?(refract|refract) (repo|codebase|source|project)|from (your|the) (repo|codebase|github))\b/i,
  /\bsnippet from (the )?(refract|refract|your|the) (repo|codebase|source|project|github)\b/i,
  /\b(cross[- ]?verif|cross[- ]?check)\b.{0,40}\b(github|repo|actual code|source)\b|\b(github|repo)\b.{0,40}\b(cross[- ]?verif|cross[- ]?check|verify)\b/i,
  /\b(show|give|write|share)\b.{0,40}\b(code|snippet)\b.{0,40}\b(you (used|wrote)|to (build|built)|from refract|actual|real|repo|github)\b/i,
  /\bdemo code of a snippet you have used\b/i,
  /\b(exact|actual) code from (file|the file|your)\b/i,
  // "write/give a demo snippet Para REFRACT" / "demo código para refract" — a requisição
  // para código De o loaded project (até com a write-verb, o "para Refract"
  // anchor makes it a source-evidence ask, não a generic coding ttarefa o template
  // says "conceptual se não loaded"). Release 2026-06-07: res_src_005.
  /\b(write|give|show|share|make)\b.{0,30}\b(demo |sample |example )?(code|snippet)\b.{0,20}\b(for|of|from)\s+(refract|refract|your project|the project)\b/i,
  /\b(demo|sample|example)\s+(code|snippet)\s+(for|of|from)\s+(refract|refract|the refract)\b/i,
  // Meta-instructions sobre source-code authenticity: "if fonte isn't loaded say
  // soentão "don't fake o code", "don't hallucinate o code" — a source-evidence
  // discipline ask (release 2026-06-07: res_src_004).
  /\b(if (the )?source (code )?(is)?n'?t loaded|don'?t fake (the )?code|don'?t hallucinate (the )?code|say (so )?if (you )?(don'?t have|can'?t)|only (show|give) (real|actual) code if loaded)\b/i,
  // "mostrar código you actually used / realmente wrote, I'll cross-check" — a verifiability
  // challenge sobre o loaded project's real código (release 2026-06-07 multimode-1000).
  /\b(show|give|share)\b.{0,20}\bcode\b.{0,20}\b(you|u) (actually|really|genuinely) (used|wrote|built|made|wrote)\b/i,
  /\bcode (you|u) (actually|really) (used|wrote)\b|\b(actually|really) (used|wrote) .{0,15}\b(cross[- ]?check|verify)\b/i,
];

// ── PRODUCT / PROJECT "o que é it" questions (release 2026-06-06b) ──
// "o que kind de app é Refract?", "how's its backend?", "o que fazer you think sobre
// Refract?", "o que tech faz it useuso Grounded em loaded project mmetadados
// Distinct de project_answer (que lists o candidate's projects) — isso é a
// drill-in Sobre o product o user é asking asobre
const PRODUCT_ABOUT_PATTERNS = [
  /\bwhat\s+(kind|kinda|type|sort)\s+(of\s+)?(app|application|product|tool|project|software)\b/i,
  /\bhow(?:'?s| is| does)\s+(refract|refract|nativly|it|the (app|product|backend|architecture|frontend|stack))\b/i,
  /\bwhat\s+(do you think about|about)\s+(refract|refract|nativly)\b/i,
  /\bwhat (tech|technolog|stack|languages?|framework)\w*\s+(does|do)\s+(refract|refract|it|this)\b/i,
  /\bis (refract|refract|it|this)\s+(local|cloud|open[- ]?source|privacy|low[- ]?distraction|on[- ]?device|transparent|accessib)\w*/i,
  /\b(refract|refract|nativly)'?s\s+(backend|architecture|stack|frontend|core)\b/i,
  // Safe product-attribute / behavior probes ("é it low-distraction?", "faz it
  // processo locally?", "é it privacy-first?", "faz it uso Ollama?", "o que part
  // uses Rust?") — these são sobre o PRODUCT, grounded em loaded mmetadados
  /\b(is|are) (it|this|they)\s+(local|cloud[- ]?based|open[- ]?source|privacy[- ]?first|low[- ]?distraction|on[- ]?device|free|paid|safe|secure)\b/i,
  /\b(does|do)\s+(it|this|refract|refract)\s+(process|run|store|work|use|have|support|need)\b/i,
  /\b(what|which) part (of (refract|refract|it|the app))?\s*(uses|is in|runs|handles|does)\b|\b(does|do) (it|refract) (use|have) (a )?(backend|server|database|ollama|rust|electron|local)\b/i,
  // "o que uses Rust", "o que executa em Electron", "what's written em Go" — asking que
  // part de o product uses a named technology (release 2026-06-07 multimode-1000).
  /\bwhat (uses|runs on|is (written|built) (in|with)|handles|powers)\s+(rust|electron|react|node|python|go|typescript|sqlite|the (backend|frontend|audio|stt|ml))\b/i,
  /\bwhat (does|do) (refract|refract|it) use\b|\bwhat'?s (refract|refract|it) (built|made|written) (with|in)\b/i,
  // Arquitetura / build-stack questions Sobre o product: "o que é Refract built
  // wicom "o que é it made using", "o que são o technologies atrás Refract",
  // "o que é o architecture de Refract", "como fez you build Refract" (release
  // 2026-06-07: residual pattern #1). Grounded em loaded project mmetadados NOTE:
  // "como fez you bbuild sobre a project = a product-about/architecture question;
  // it's distinct de o project-LIST ("o que projects ter you built").
  /\bwhat (is|'?s|are) (the )?(tech ?(stack)?|technolog\w*|stack|architecture|framework\w*)\s+(of\s+|behind\s+|powering\s+)?(refract|refract|it|this|the (app|product|project))\b/i,
  /\b(refract|refract|nativly|it|this)\s+(is\s+)?(built|made|written|developed|created|powered)\s+(with|using|in|on)\b/i,
  /\bwhat (is|'?s) (it|refract|refract)\s+(made|built|written|developed)\s+(of|with|using|in)\b/i,
  /\b(what is|whats|describe) (the )?architecture (of )?(refract|refract|it|this|the (app|product|project))\b/i,
  /\bhow (did|do|was) (you|refract|it|this)\s+(build|built|develop\w*|architect\w*|design\w*)\s+(refract|it|this|the (app|product))\b/i,
  /\bhow (is|was) (refract|refract|it|this) (built|made|developed|architected|designed)\b/i,
  // "como (fazer you make|to make) it low-distraction / privacy-first / local" — a
  // product-design question sobre Refract, grounded em metadados (1000-q
  // benchmark 2026-06-06b). Não a stealth ask (não evasion/interview obobjeto
  /\bhow (do you |to )?(make|keep|design)\s+(it|refract|this)\s+(low[- ]?distraction|privacy[- ]?first|private|transparent|accessible|local|on[- ]?device|minimal)\b/i,
  /\b(low[- ]?distraction|privacy[- ]?first)\b.{0,30}\b(mode|design|approach|first)\b|\bkeep (it|refract|this) (low[- ]?distraction|privacy)/i,
  // Responsible-use / disclosure / accessibility product questions (release
  // 2026-06-07): "como para disclose it em a meeting", "make it accessible sem sendo
  // distracting" — sobre using o PRODUCT transparently, Não hiding it (≠ stealth).
  /\bhow (to|do i|should i) disclose (it|refract|this|using it)\b|\bdisclose (it|refract|this) (in|during|to)\b/i,
  /\bmake (it|refract|this) accessible\b|\baccessible (without|but not) (being )?distract\w*/i,
];

const JD_FIT_PATTERNS = [
  /\bwhy (this role|this company|us|our company|are you a good fit)\b/i,
  // "Por que fazer you want para work aqui / para nós / at <company>" — o canonical
  // company-motivation interview question (spec §11.11). Perfil + JD/company
  // ccontexto Não a generic meeting answer.
  /\bwhy (do|would) (you|i) want to (work|join)\b/i,
  /\bwhy (do you )?want to work (here|with us|for us|for this)\b/i,
  /\bfit (for|this|the) (this |the )?role\b|\bmatch(?:es)? the job\b/i,
  /\b(why|how) (do |would |are )?(you|i) (a good )?fit\b/i,
  /\bhow (do|would|can) (i|you) fit\b/i,
  /\bgood fit for\b|\bright (fit|candidate) for\b|\bsuited (for|to) (this|the) (role|job|position)\b/i,
  /\bhow.*experience.*(role|job|position)\b/i,
  // "como fazer I fit isso <role> JD/role/position" e tailoring asks contra o JD.
  /\bfit (this|the|that) (data analyst |[a-z ]+)?(role|job|position|jd|description)\b/i,
  /\b(tailor|match|align) (my |the )?(answer|resume|experience|skills?|background).*(jd|job|role|position)\b/i,
  /\b(gaps?|strengths?).*(this|the).*(jd|role|job|position|data analyst)\b/i,
  // "o que é your strongest corresponder / best fit para o JD/role" — Exige JD/role
  // contexto então a bare "biggest strength" stays behavioral (não jd_fit).
  /\b(strongest|best|biggest|top)\s+(match|fit|asset|selling point)\b.*\b(jd|role|job|position|description|this)\b/i,
  /\b(strongest|best|biggest|top)\s+(match|fit|strength|asset)\s+for\s+(the|this)\s+(jd|role|job|position|data analyst|[a-z]+ (role|job|position))\b/i,
  /\bstrongest\s+(match|fit|skill|area)\s+(for|to)\s+(the|this)\s+(jd|role|job|position)\b/i,
  // "Por que deve we hire you?" e its variants — o canonical fit/sell question
  // (live regression 2026-06-05). Perfil + JD, Não a generic meeting answer.
  /\bwhy should (we|i|they|you) (hire|pick|choose|select|consider|take|go with|bring (on|in))\b/i,
  /\bwhat makes (you|me) (a |an |the )?(good|great|right|ideal|strong|best|perfect|standout|qualified|suitable) (fit|candidate|choice|hire|person|applicant)?\b/i,
  /\bwhat makes (you|me) (suitable|qualified|fit|right)\b/i,
  /\bwhy are (you|i)\b.*\b(right|best|good|ideal|strong|qualified|suitable)\b.*\b(candidate|fit|person|choice|applicant|role|job|position)\b/i,
  /\bwhy (do|would) (we|they) (need|want) (you|to hire)\b/i,
  /\bwhy are (you|i) qualified\b/i,
  // "Como good são you Para isso job/role", "são you good/suitable/qualified/right
  // para isso job/role/position" — casual fit phrasings (live audit 2026-06-05).
  /\bhow (good|suitable|qualified|fit) (are|r) (you|u) for (this|the|a|our)\b/i,
  /\bare (you|u) (good|suitable|qualified|right|fit|a good fit|the right (fit|candidate|person)) (for|to)\b/i,
  /\bare (you|u) (a )?(good|right|strong|ideal) (fit|match|candidate) (for|to)\b/i,
  // "como faz your background/experience/skills match/align/fit isso role"
  /\bhow (does|do|would|can) (your|my|the) (background|experience|skills?|profile|resume|qualifications?) (match|align|fit|suit|relate|map)\b/i,
  // MOTIVATION + CONTRIBUTION + fit-confidence phrasings (benchmark 2026-06-05):
  // "por que fazer you want isso job/role?", "o que excites you sobre isso role?", "como
  // pode you contribute?", "o que valor pode you bring?", "o que makes you confident
  // you pode fazer isso jobjob "fazer you think isso role matches your properfil "onde
  // fazer you see overlap?", "como fechar é your fundo para o que we're looking
  // forpara Todos são role-fit asks → resume+JD, primeiro person.
  /\bwhy do (you|i) want (this|the|to work)\b/i,
  /\bwhat (excites|interests|draws|attracts) (you|me) (about|to)\b.*\b(role|job|position|company|team)\b/i,
  /\bhow (can|would|will) (you|i) (contribute|add value|help|benefit|impact)\b/i,
  /\bwhat (value|impact|contribution) (can|would|will|do) (you|i) (bring|add|make|provide|offer)\b/i,
  /\bwhat makes (you|me) confident\b/i,
  /\bdo you think (this|the) (role|job|position) (matches|fits|suits|aligns)\b/i,
  /\bwhere do (you|i) see (overlap|alignment|a (good )?(fit|match))\b/i,
  /\bhow (close|well) (is|does) (your|my) (background|experience|profile)\b/i,
  // Opinion-about-the-role → ainda a fit question ("o que fazer you think sobre this
  // job/role/position/opportunity?") (benchmark 2026-06-05).
  /\bwhat do you think (about|of) (this|the) (job|role|position|opportunity|company)\b/i,
  /\bhow do you feel about (this|the) (job|role|position|opportunity)\b/i,
  // Casual / indirect fit phrasings que fell para unknown (benchmark 2026-06-05):
  // "convince me you são direito (para isso role)", "em o que ways são you a match",
  // "são you o candidate we deve piescolher "fazer you fit o que isso Data Analyst
  // posição needs", "como good são you actually para isso analyst thing", "por que you
  // para isso job não geralmente isso one".
  /\bconvince me\b/i,
  /\bin what ways are (you|i) (a )?(match|fit|suitable|qualified)\b/i,
  /\b(are|why are) (you|i) the (candidate|person|one) (we|they|i) should (pick|choose|select|hire|take)\b/i,
  /\bdo (you|i) fit what (this|the)\b/i,
  /\bfit what (this|the) [\w ]*(role|position|job|analyst|team) (needs?|wants?|requires?|is looking for)\b/i,
  /\bhow good are (you|u|i)\b.*\b(for this|this job|this role|this analyst|this position|this thing)\b/i,
  /\bwhy (you|u|me)\b.*\b(for this|this job|this role|this one|this position)\b/i,
  // Engineering→data-analyst Ponte challenges (benchmark 2026-06-05): o
  // interviewer pushes que o fundo doesn't match. Ainda a fit question —
  // answer precisa ponte o experience para o role honestly.
  /\b(connect|bridge|relate|map|link) (it|this|that|them|the two|your (experience|background|skills?))\b/i,
  /\b(data analyst|analyst|data)\b.*\b(connect|bridge|relate|link)\b|\b(connect|bridge|relate|link)\b.*\b(data analyst|analyst|data|role|job)\b/i,
  /\b(full[- ]?stack|engineering|engineer|backend|software)\b.*\b(different|not|but|vs|versus)\b.*\b(data analyst|analyst|data)\b/i,
  /\b(full[- ]?stack|engineering|engineer|backend|software)\b.*\b(data analyst|analyst)\b.*\b(connect|explain|bridge|why)\b/i,
  /\b(why|how) (is|does) (refract|this project|that project|your project|it)\b.*\b(relevant|prove|matter|fit|qualify|show)\b.*\b(analyst|data|role|job)?/i,
  /\b(prove|show|demonstrate) (you can|i can|that you|that i)\b.*\b(analyst|data analyst|this role|this job)\b/i,
  /\b(seem|seems|look|looks).*(engineering|engineer|technical|full[- ]?stack|not).*(why|convince|but)\b/i,
  /\b(don'?t|do not) seem like\b.*\b(analyst|fit|right)\b/i,
  /\bwhy (data|analyst|analytics)\b\??$/i,
  // Gap / readiness para o role (ainda JD-fit, resume+JD+gap): "o que gap fazer you
  // ter para isso role", "onde são you weak para isso JD", "if we precisa SQL daily
  // como pronto são you", "strongest/weakest matching skill para o JD".
  /\b(what|where|which) (gap|gaps|weak|weakness)\b.*\b(role|job|jd|position|this)\b/i,
  /\bwhat will (you|i) need to learn\b/i,
  /\b(strongest|weakest|best|main) (matching )?skill\b.*\b(jd|role|job|position)\b/i,
  /\bif (we|they) need\b.*\bhow ready\b/i,
  /\bhow ready are (you|i)\b/i,
  /\bif (we|they) need [\w ]+,? where do (you|i) stand\b/i,
  // Remaining natural/noisy fit phrasings (benchmark 2026-06-05):
  /\bwhere are (you|i) weak\b/i,
  /\bweak (for|on) (this|the) (jd|role|job|position)\b/i,
  /\bso why this (job|role|position)\b/i,            // "okay cool yeah, então por que this jojob
  /\bwhy this (job|role|position)\b/i,
  /\bcompare (yourself|myself) (to|with|against) (other |the other )?(candidates?|applicants?|people)\b/i,
  // Explicit steer para uso o JD ("uso JD mas não salary", "answer using o job
  // description", "tailor it para o JD") — a role-fit answer grounded em o JD
  // (Issue 7). O salary negation é handled separately então isso stays jd_fit.
  /\b(use|using|with|from|tailor (it|the answer) to|against) (the )?(jd|job description)\b/i,
];

// GAP / weakness-for-the-role asks (release 2026-06-09). These precisa produce an HONEST
// GAP + MITIGATION answer em o candidate's first-person voice — Não a fit-summary
// ("por que you're grgrande e Não a stall. Distinct de a generic behavioral "biggest
// weakness" (que isn't JD-anchored) e de jd_fit (que sells o match). Checked
// Antes jd_fit então a gap ask doesn't obtém swallowed por o fit patterns aacima
const GAP_PATTERNS = [
  /\b(what|which|any|where('?s| is)?|do you have a?)\s+(gaps?|weak(?:ness(?:es)?)?|shortcomings?|limitations?|missing|lacking)\b/i,
  /\bwhat\s+gaps?\s+do\s+(you|i)\s+have\b/i,
  /\bwhere\s+(are|r)\s+(you|u|i)\s+weak\b/i,
  /\b(weakest|least (ready|prepared|qualified|strong|experienced))\b.*\b(jd|role|job|position|match|for (this|the))\b/i,
  /\bwhat('?s| is)?\s+your\s+weakest\s+(match|area|point|skill)\b/i,
  /\bwhat\s+(do|would|will|might|should)\s+(you|i)\s+(need|have)\s+to\s+(improve|learn|work on|develop|build|pick up|get better)\b/i,
  /\bwhat\s+(would|do|will)\s+(you|i)\s+need\s+to\s+learn\b/i,
  /\bwhat('?s| is)?\s+missing\s+(from|in)\s+(your|my)\s+(profile|resume|background|experience)\b/i,
  /\bwhat\s+part\s+of\s+(this|the)\s+(jd|role|job|description)\s+.*\b(least|not)\s+(ready|prepared|strong|confident)\b/i,
  /\bwhere\s+(do|would)\s+(you|i)\s+(fall short|struggle|need (work|improvement))\b/i,
  /\bwhat\s+(are|r)\s+(you|i)\s+(missing|lacking)\s+for\s+(this|the)\b/i,
  // "give me a (confident mas honest) gap answer", "a gap answer", "answer sobre my gaps"
  /\b(a|an|the|my|your)\s+(confident.{0,20})?gap\s+answer\b|\banswer\s+(about|on|for)\s+(my|your|the)\s+gaps?\b|\bgive me\s+.{0,30}\bgap\b/i,
];

const SKILLS_PATTERNS = [
  /\b(skills|tools|technologies|frameworks|tech stack)\b/i,
  // "o que programming/coding languages fazer you know/use?" (benchmark 2026-06-05).
  /\b(programming|coding) languages?\b/i,
  /\bwhat languages do (you|i)\b/i,
  // "onde fazer you specialise/specialize o momaioria "what's your strongest area",
  // "o que são you best at", "your area de expertise" (real manual-chat registrar
  // 2026-06-06b "onde fazer you specialise o mosmaioria A self-strength/skill probe.
  /\b(where|what) (do|are) (you|u)\s+(speciali[sz]e|special|strongest|best|expert|most (skilled|experienced|confident))\b/i,
  /\b(your|my) (area of |main |core )?(expertise|specialit|specialisation|specialization|strong suit|forte)\b/i,
  /\bwhat(?:'s| is) (your|my) strongest (skill|area|tech|language|domain)\b/i,
  /\bwhere do (you|i) special/i,
];
// A PEOPLE / leadership / conflict Objeto após a lead/manage/handle verb marks a behavioral
// STORY (não a skill probe). This ONE fonte é interpolated dentro de o behavioral matcher AND
// its two skill-side guards então o proteger é sempre a superset de o matcher e o three lists
// pode nunca drift apart (code-review 2026-06-16). A tech/tool objeto ("a dabanco de dados "Python")
// é deliberately Não aqui — those stay skill_experience.
const PEOPLE_OR_CONFLICT_OBJECT =
  '(?:team|teams|people|person|peers?|reports?|engineers?|developers?|juniors?|staff|direct\\s+reports?|group|anyone|someone|somebody|anybody|conflict|disagreement|crisis|escalation|difficult|tough)';

// Spec Case F exception: "ter you used / worked com / fazer you know <tech>" é a
// SKILL-EXPERIENCE question sobre o USER (perfil YSim primeiro person) — Não a
// generic technical concept. This precisa ser checked Antes coding/DSA patterns então
// "ter you used a hashmap?" routes para skills, não para o coding contract.
const SKILL_EXPERIENCE_PATTERNS = [
  // "ter you used/built/managed <tech>" é a skill probe. Mas "ter you managed/handled/led
  // PEOPLE / a TEAM" é a behavioral STORY, não a skill — o negative lookahead lets those
  // fall através para BEHAVIORAL_PATTERNS (code-review caveat 2026-06-16). A tech objeto após
  // managed/handled (e.g. "ter you managed a database/cluster") ainda routes para skills.
  new RegExp(`\\bhave you (ever )?(?:(?:managed|handled|led)\\b(?!\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+|some\\s+|any\\s+)?${PEOPLE_OR_CONFLICT_OBJECT}\\b)|(?:used|worked with|worked on|built|built with|written|coded in|programmed in|implemented|done|created|analy[sz]ed|normali[sz]ed|deployed|designed))\\b`, 'i'),
  /\bdo you (know|have experience (with|in)|use)\b/i,
  /\bare you (familiar|comfortable|proficient|experienced) (with|in)\b/i,
  // "São you good/strong/skilled at X?", "são you qualquer good com React?" — a
  // proficiency probe sobre o USER (real manual-chat registrar 2026-06-06b "são you
  // good at python"). First-person skill-experience answer, perfil required.
  // Exclui "são you good Para isso role/job/position/fit" (that's jd_fit) via o
  // negative lookahead — apenas "good AT/IN/WITH <skill>" ou a bare "são you good at"
  // qualifies, nunca "good para <role>".
  /\bare you (any )?(good|strong|skilled|decent|solid|great|proficient|comfortable|confident|experienced|fluent)\b\s*(at|in|with|on)\b(?!\s+(this|the|a|your)?\s*(role|job|position|fit|company|data analyst))/i,
  /\bare (you|u) (a )?(good|strong|skilled|solid) (coder|developer|programmer|engineer)\b/i,
  // Bare "you good/strong at X" (subject dropped, comum em chat-speak após SMS
  // normalization: "u gud at python" → "you good at python").
  /\byou (good|strong|skilled|decent|solid|great|proficient|comfortable|experienced|fluent) (at|in|with|on)\b(?!\s+(this|the|a|your)?\s*(role|job|position|fit))/i,
  // "como strong/good/proficient é your <skill>", "como muitos years de <skill> fazer you
  // hter — proficiency/experience probes sobre o USER (1000-q 2026-06-06b).
  /\bhow (strong|good|solid|proficient|deep|extensive) (is|are) (your|ur)\b/i,
  // "como é your SQL/Python/React?" — a bare proficiency probe naming a skill/tech.
  // Exige a recognized tech token então "como é your day/weekend" doesn't match
  // (release 2026-06-07c: live stale-vs-fresh skill follow-up).
  /\bhow (is|are|s) (your|ur) (python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|backend|frontend|full[\s-]?stack|databases?|machine learning|sql skills|coding skills)\b/i,
  /\bhow many years (of|with)\b.{0,30}\b(do you have|experience|you got)\b/i,
  /\bhow (much|many years) (of )?experience\b/i,
  /\byour experience (with|in|using)\b/i,
  /\bhow (much |many years )?(experience|familiar).*\b(with|in|using)\b/i,
  /\bever (used|worked with|built)\b/i,
  // "Fez you actually uso X / uso X ou apenas know it", "fez you work com X" —
  // past-experience probes (benchmark 2026-06-05 would-vs-have, honest-evidence). O
  // handle/deal-with verbs são divide fora com a people/conflict-object negative lookahead então
  // "fez you manipular a crisis" / "fez you deal com a difficult teammate" fall através para a
  // behavioral STORY em vez disso de a skill probe (code-review 2026-06-16).
  /\bdid you (actually |really |ever )?(use|work with|work on|build|implement|write|analy[sz]e)\b/i,
  new RegExp(`\\bdid you (actually |really |ever )?(do|handle|deal with|manage)\\b(?!\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+|some\\s+|any\\s+)?${PEOPLE_OR_CONFLICT_OBJECT}\\b)`, 'i'),
  /\b(used|worked with) [\w ]+ or just (know|knew|theoretical|theory)\b/i,
  /\bexperienced or just theoretical\b/i,
  // "Como Ter you used X", "onde Ter you used X" — explicit past usage (vs o
  // hypothetical "como Iria you uso X" que é technical_concept).
  /\bhow have (you|i) used\b/i,
  /\bwhere have (you|i) (used|worked|applied)\b/i,
];
// SKILL SELF-RATING (live regression 2026-06-05): "como iria you rate your
// expertise em Python", "como good são you at React", "fora de 10 rate yourself",
// "o que são your coding levels", "em a escalar de 1-10 como proficient são you".
// These são sobre o USER's próprio proficiency — pperfil primeiro person — Não a
// requisição para Escreve código e Não compensation. Kept SEPARATE de
// SKILL_EXPERIENCE_PATTERNS porque o rating branch precisa win até quando o
// question contém o bare word "scale" (que caso contrário trips
// SYSTEM_DESIGN_PATTERNS); a self-rating question é nunca a system-design ask.
const SKILL_RATING_PATTERNS = [
  /\b(rate|assess)\s+(your|my)self\b/i,
  /\bhow would (you|i) rate\b/i,
  // "o que é your confidence?" / "como confident são you?" — a self-assessment de
  // o candidate's próprio proficiency (Issue 8).
  /\bwhat(?:'s| is)\s+(your|my)\s+confidence\b/i,
  /\bhow confident are (you|u|i)\b/i,
  // "como good/skilled/proficient são you AT/IN/WITH <skill>" — exigir o skill
  // preposition então "como good são you Para THIS JJob falls através para jd_fit, não
  // skill-rating (live audit 2026-06-05 collision).
  /\bhow\s+(good|skilled|proficient|strong|experienced|comfortable|confident)\s+(are|am)\s+(you|i)\s+(at|in|with|on|using)\b/i,
  /\b(your|my)\s+(coding|skill|skills|technical|proficiency)\s+levels?\b/i,
  /\bcoding\s+levels?\b/i,
  /\bon a scale\b/i,
  /\brate\s+(yourself|myself|your|my)\b/i,
  /\b(your|my)\s+(expertise|proficiency|competency)\s+(in|with|level)\b/i,
  // "rate your Python skills fora de 10", "como iria you rate your SQL skills" —
  // a skill nome pode sit entre rate/your e skills (benchmark 2026-06-05).
  /\b(rate|how would you rate)\s+(your|my)\s+[\w+#.]+\s+(skills?|expertise|level)\b/i,
  // Bare / fragmentary self-rating em a live transcript (benchmark 2026-06-05):
  // "Então Python, como fora de 10?", "Okay, fora de ten?", "your coding lnível 10
  // scale, whao que "O que são your levels at, como Python SQL coding?". O
  // "fora de N" / "N scale" / "levels at" framing é a proficiency rating, nunca
  // a coding tarefa ou compensation.
  /\bout of (10|ten)\b/i,
  /\b(10|ten)\s*scale\b|\bscale of (10|ten)\b/i,
  /\b(your|my) (coding |skill )?levels? (at|are|is)\b/i,
  /\bwhat (are|is) (your|my) levels?\b/i,
  /\blike\b.*\bout of (10|ten)\b/i,
  /\bjust rate (coding|python|sql|my|your|me)\b/i,
  // "rate <skill>" / "rate me em <skill>" sem your/my — "rate Python", "if I
  // ask you para rate Python" (benchmark 2026-06-05). Skill-rating, não coding.
  /\brate\s+(me\s+(on|in)\s+)?(python|sql|java|javascript|typescript|react|node|coding|programming|data|analytics|excel|tableau|full[- ]?stack|backend|frontend)\b/i,
  /\bask (you )?to rate\b/i,
];
// Generic technical-concept questions ("explain BFS", "o que é a deadlock") —
// não pperfil generic_ai voice. Distinct de coding (que asks para Escreve code)
// e de skill_experience (que asks sobre o USER). Checked apenas quando lá
// é não coding verb e não skill-experience framing.
const TECHNICAL_CONCEPT_PATTERNS = [
  /\b(explain|what(?:'s| is| are)|describe|how does|how do|define|difference between|compare)\b/i,
  // "give me an example for/of a REST API / SQL consulta / recursion" — a CONCEPT
  // example requisição (real manual-chat registrar 2026-06-06b). A technical explanation,
  // Não a behavioral story. O tech subject precisa follow o example phrasing.
  /\b(give|show|share)\s+(me\s+)?(an?\s+)?(example|demo|sample|illustration|snippet)\b\s*(of|for|with|using)?\s*(a |an |the )?(rest|api|sql|graphql|recursion|binary|hash|loop|function|query|algorithm|regex|json|http|crud|endpoint|database|schema|closure|promise|async|middleware)\b/i,
  /\b(example|demo|sample) (of|for) (a |an |the )?(rest|api|sql|graphql|recursion|hashmap|linked list|binary search)\b/i,
];
// Fase 2: HYPOTHETICAL technical application — "como iria you uso X", "como iria
// you design Y", "what's your approach para Z". O candidate answers em Primeiro
// PERSON ("I iria uso GraphQL whequando mas invents Não retomar facts: isso é a
// technical answer (profileContextPolicy = forbidden) spoken em candidate voice.
// Distinct de skill_experience ("como Ter you used X" → perfil required).
const HYPOTHETICAL_TECH_PATTERNS = [
  /\bhow would (you|i)\s+(use|approach|implement|design|build|handle|structure|architect|optimi[sz]e|solve|tackle|model|set ?up|integrate|scale|test|debug|secure|clean|validate|analy[sz]e|query|explain|process|transform|visuali[sz]e|aggregate|join|filter|measure|investigate|diagnose)\b/i,
  /\bhow might (you|i)\b/i,
  /\bwhat(?:'s| is| would be)?\s+your approach to\b/i,
  /\bif you (were|had) to\b/i,
  /\bwould you (use|choose|pick|prefer|recommend)\b/i,
];
const isHypotheticalTech = (text: string): boolean => includesAny(text, HYPOTHETICAL_TECH_PATTERNS);
const PROJECT_PATTERNS = [
  /\b(project|projects|built|shipped|worked on)\b/i,
  // "Tell me sobre Refract", "explain Refract", "o que é Refract", "talk sobre
  // Refract" — direct asks sobre a named project (benchmark 2026-06-05). O
  // known project entity é resolved at runtime; aqui we recognise o intent.
  /\b(tell me about|talk about|explain|describe|walk me through|what(?:'s| is)?)\s+refract\b/i,
  /\bwhat (did|have) you (build|built|made|create|created|develop)\b/i,
  /\bwhat (was|is) your (best|strongest|most important|favou?rite|biggest) (project|work)\b/i,
];
// Fase 5: project/entity FOLLOW-UP — uma vez a project é em o ttabela an
// interviewer drills em ("como é it developed?", "o que era your role?", "o que
// tech fez you useuso "hardest part?", "por que fez you build it?", "o que fez you
// learn?"). These resolver para a específico project (explicit nome haqui ou o
// prior turn's project via extractedQuestion.followUpTarget) e ground em that
// project's retomar facts — primeiro person, nunca negotiation/JD/sales/lecture.
const PROJECT_FOLLOWUP_PATTERNS = [
  /\bhow (is|was|are|were)\s+.{1,40}?\s+(developed|built|made|implemented|architected|designed|created|structured|engineered)\b/i,
  /\bwhat (was|is) (your|my) role (in|on|for|at|there)\b|\bwhat (was|is) (your|my) role\b.*\b(there|in it|on it|in that)\b/i,
  /\bwhat (tech stack|technologies|tools|languages|frameworks|stack|tech) (did|do|does|was|were) (you|i|it|used)\b/i,
  /\bwhat was the hardest (part|challenge|thing)\b/i,
  /\bwhy did (you|i) (build|make|create|choose|pick|use)\b/i,
  /\bhow did (you|i) (optimi[sz]e|scale|test|build|implement|design|handle|architect|secure|deploy)\b/i,
  /\bwhat did (you|i) learn\b/i,
  /\b(explain|tell me (more |about )|describe|walk me through)\s+(that|this|the|your|it)\b.*\b(project|more|further|again|in detail)\b/i,
  // Drill-ins anchored por "there"/"in it"/"on it" em o project sob discussion
  // (benchmark 2026-06-05): "o que backend fez you uso thelá "o que era o
  // banco de dados thelá "como fez you manipular latency thelá "o que era o
  // architecture thelá O trailing locative refers para o ativo project.
  /\bwhat (backend|database|frontend|stack|tech|framework|language|architecture|infra|infrastructure|api) (did|was|were) (you|it)?\s*(use[d]?|there|built)?\b.*\bthere\b/i,
  /\bwhat (was|were) the (backend|database|frontend|architecture|stack|tech|infra) there\b/i,
  /\bhow did you (handle|manage|deal with|solve|optimi[sz]e|build|design) [\w ]+ there\b/i,
  /\b(did|how did) you (work with|use|build|handle|coordinate)\b.*\b(there|in (it|that|the project)|on (it|that|the project))\b/i,
  // Personal-contribution drill-ins em o project ("o que fez you personally
  // contribute", "o que fez others fazer e o que fez you dofazer "o que era o
  // measurable result"). First-person project ownership, nunca negotiation.
  /\bwhat did you (personally )?(contribute|do|build|own|lead)\b/i,
  /\bwhat (was|were) (the )?(measurable )?(result|impact|outcome|metric)s?\b/i,
];
const EXPERIENCE_PATTERNS = [
  /\bexperience|background|previous role|last role|work history|internship|interned|worked at|time at\b/i,
  // "o que fazer you atualmente do?fazer "o que são you working em (now)agora "what's your
  // atual role/job?" (benchmark 2026-06-05) — present-tense experience asks.
  /\bwhat do you (currently|now) do\b/i,
  /\bwhat(?:'s| is) your current (role|job|position|title)\b/i,
  /\bwhat are you (currently )?working on\b/i,
  /\bwhat have you been (building|working on|doing|up to)\b|\bwhat have you built (lately|recently)\b/i,
  // "o que fazer you think about/of <Company>" — an opinion sobre a company o
  // candidate tem worked at (real manual-chat registrar 2026-06-06b "o que fazer you think
  // sobre estrotech"). Grounded em loaded experience; first-person. O trailing
  // token precisa ser a NAME-like word (≥4 chars, não a generic concept/discourse word
  // como "todos this", "o role", "evetudo Exclui product/project names
  // (caught earlier por PRODUCT_ABOUT) e generic determiners/discourse fillers.
  /\bwhat do you think (about|of)\s+(?!the\b|this\b|that\b|your\b|my\b|it\b|all\b|everything\b|us\b|them\b|refract|refract|the (role|job|company|position|team))[a-z][\w-]{3,}\b/i,
  /\bhow (was|is) (your|the) (time|experience|stint|tenure) (at|with|in)\b/i,
];
const BEHAVIORAL_PATTERNS = [
  /\btell me about a time\b|\bdescribe a situation\b|\bexample of when\b|\bconflict\b|\bfailure\b|\bchallenge\b/i,
  // Past-experience war stories sobre a específico artifact — "tell me sobre a
  // difficult BUG you solved", "o hardest issue you já faced" (manual
  // regression 2026-06-12, stress seq_056: o bare \bbug\b debugging pattern
  // pulled these dentro de o technical lane onde o modelo answered como o
  // assistant — "I don't ter personal experiences").
  /\b(tell me about|describe|share|walk me through)\b.{0,60}\b(bug|issue|error|incident|problem|outage)\b.{0,40}\b(you|you'?ve|u)\b.{0,30}\b(solved|fixed|faced|debugged|handled|dealt with|encountered|resolved|found)\b/i,
  /\b(hardest|toughest|most difficult|trickiest|worst)\b.{0,30}\b(bug|error|issue|crash|incident|outage)\b.{0,40}\b(you|you'?ve|your career|you ever)\b/i,
  // Strength/weakness — classic behavioral self-reflection (benchmark 2026-06-05).
  /\b(your|my) (biggest |greatest |main )?(strength|weakness|strengths|weaknesses)\b/i,
  /\bwhat are you (good|bad) at\b/i,
  // "Give me an example de X", "tell me a story where/about", "tell me a
  // time/failure/conflict" — STAR prompts que lack o literal "a time" phrasing
  // (benchmark 2026-06-05): ownership, teamwork, leadership, ambiguity, pressure,
  // coordination, deadline.
  // "Give me an example de teamwork" — a STAR prompt. Exclui a TECHNICAL example
  // requisição ("give me an example for/of a REST API / a SQL consulta / recursion"),
  // que é a concept/coding ask, não a behavioral story (real manual-chat registrar
  // 2026-06-06b "pode you give me an example para rest api"). O negative lookahead
  // rejects a seguinte tech-subject noun.
  /\b(give me|share|tell me|do you have) (an?|one|a single) ?(example|instance|story|case)\b(?!\s*(?:of|for|with|using)?\s*(?:a |an |the )?(?:rest|api|sql|graphql|recursion|binary|hash|loop|function|query|algorithm|regex|json|http|crud|endpoint|database|schema|code|snippet|python|javascript|react|node))/i,
  /\btell me (a|one|about a) (story|time|failure|conflict|situation|deadline)\b/i,
  /\btell me about (your |how you )?(handle|handling|deal with|dealing with|manage|managing)?\s*(teamwork|leadership|ownership|coordination|pressure|ambiguity|conflict|uncertainty|a deadline|deadlines|failure|stress)\b/i,
  /\b(handling|dealing with|managing|under) (ambiguity|pressure|uncertainty|conflict|stress|a deadline|deadlines)\b/i,
  // "como fazer you handle/deal with/manage/approach <soft trait>", "como fazer you learn
  // qurapidamente "describe a time you <verb>" — STAR / behavioral self-reflection
  // (1000-q benchmark 2026-06-06b). O trait/verb anchors it como behavioral, não a
  // generic how-to. "learn (new things) qrapidamente é o classic adaptability ask.
  /\bhow do (you|i) (handle|deal with|manage|approach|cope with|respond to|react to|navigate)\b\s*(?:a |an |the )?(pressure|stress|conflict|ambiguity|uncertainty|failure|criticism|feedback|deadline|setback|difficult|challenging|disagreement|change|tight)\w*/i,
  /\bhow do (you|i) (learn|pick up|adapt|stay (?:motivated|organized|focused))\b/i,
  /\bdescribe (a time|a situation|an? (?:experience|instance))\b|\bdescribe a time (you|i)\b/i,
  /\b(time|example|instance) (you|i|when (?:you|i))\s+(took|showed|demonstrated|led|handled|overcame|failed|learned|built|shipped|resolved|managed)\b/i,
  /\bwhat (do|would) you do (when|if)\b.{0,40}\b(stuck|fail|wrong|conflict|disagree|pressure|deadline)\b/i,
  // "Did/Have you já <lead/manage/mentor/handle> <people/team/conflict>" ou "...entregar sob
  // pressure" — a past-experience yes/no que realmente wants a STAR story ("Fez you já lead a
  // team?", "Ter you managed people?", "Ter you handled a conflict?", "Ter you mentored
  // anyone?"). O PEOPLE/leadership/conflict Objeto é o discriminator (shared
  // PEOPLE_OR_CONFLICT_OBJECT): a tool/task objeto ("ter you built a REST API", "o que projects
  // ter you built", "fez you finaliza o migration") é Não a story e é deliberately excluded
  // (code-review caveat 2026-06-16). O objeto lista aqui é identical para o one o two
  // skill-side guards eexcluir então they pode nunca drift.
  new RegExp(`\\b(?:did|have|has)\\s+(?:you|u)\\s+(?:ever\\s+)?(?:led|lead|manage[d]?|mentor(?:ed)?|coach(?:ed)?|supervis(?:e|ed)|handle[d]?|resolv(?:e|ed)|navigat(?:e|ed)|deal[t]?\\s+with)\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+|some\\s+|any\\s+)?${PEOPLE_OR_CONFLICT_OBJECT}\\w*\\b`, 'i'),
  /\b(?:did|have|has)\s+(?:you|u)\s+(?:ever\s+)?(?:deliver(?:ed)?|shipped?|launched?|worked|performed)\b.{0,30}\b(?:under\s+(?:pressure|a\s+(?:tight\s+)?deadline)|tight\s+deadline|crunch|high[- ]pressure)\b/i,
  /\b(can you )?talk (more )?about your (project )?coordination\b/i,
  /\bproject coordinati(on|vely)\b/i,
  /\bproof of\b|\bprove[sd]? (your|my|analytical|that you|i)\b|\bthat proves?\b/i,
];
// MEETING / lecture-recap questions sobre o CONVERSATION, não o candidate —
// precisa rotea para general_meeting_answer (profile/JD/negotiation FORBIDDEN), nunca
// unknown_answer ou a perfil answer (benchmark 2026-06-05 contexto leaks).
const MEETING_PATTERNS = [
  /\b(action items?|next steps?|to-?dos?)\b/i,
  /\bwhat did we (decide|agree|conclude|discuss|cover|say)\b/i,
  /\bwhat (was|were) (decided|agreed|discussed|the takeaways?)\b/i,
  /\bwhat decisions? (was|were|did)\b|\bwhat (was|were) the decisions?\b/i,
  // "resumir o último 5 minutes" → meeting recap, Mas não quando it names o
  // lecture/class (that's a lecture summary — handled por LECTURE_PATTERNS).
  /\bsummari[sz]e (the )?(last|previous|past)\b(?!.*\b(lecture|class|professor|slide|chapter)\b)|\bsummari[sz]e (the )?(meeting|call|discussion|conversation)\b/i,
  /\bwhat (was|is) the customer (asking|saying|wanting)\b/i,
  /\bwhat should i (say|do|answer) (next )?(in this|in the) (meeting|call)\b/i,
  /\bwhat did (the )?(interviewer|client|customer|they) mean\b/i,
  // "quem owns o próximo step", "quem é taking X", "who's responsible" — ownership de
  // meeting ação items (release 2026-06-07).
  /\bwho (owns|is taking|is responsible for|has|will (do|own|take|handle))\b/i,
  // "o que fez <NNome ask/say/want", "o que era <Name>'s point" — referencing a
  // speaker em o meeting transcript.
  /\bwhat did [A-Z][a-z]+ (ask|say|want|mean|raise|bring up|propose)\b/i,
  /\bwhat (are|were) the (open questions?|next steps? for|takeaways?)\b/i,
  /\b(write|draft|send) (a |the )?(follow[- ]?up|recap|summary|meeting) (email|note|message|mail)\b/i,
  /\brecap\b|\bcatch me up\b/i,
];
// Perfil FACT lookups (education, alvo role) — curto factual answers
// (benchmark 2026-06-05): "onde fez you study?", "o que role são you applying
// forpara "what's your degree?".
const PROFILE_FACT_PATTERNS = [
  /\bwhere did (you|i) (study|go to (school|college|university)|graduate)\b/i,
  /\bwhat (role|job|position) (are|am) (you|i) (applying|interviewing) for\b/i,
  /\bwhat(?:'s| is) (your|my) (degree|major|gpa|qualification)\b/i,
  // Recruiter logistics / factual probes (release 2026-06-07 multimode-1000):
  // qualification, graduation, location, relocation, notice period, atual title,
  // years de experience, último company, area de ffocar
  /\bwhat(?:'s| is) (your|my) (highest )?(qualification|education|background)\b/i,
  /\bwhen did (you|i) graduate\b|\bwhat year did (you|i) (graduate|finish)\b/i,
  /\bwhat(?:'s| is) (your|my) (current )?(location|city|base|notice period|current title|current role|area of focus|special4?ation|focus area)\b/i,
  /\b(are|r) (you|u) (open to|willing to|up for) relocat\w*\b|\bwould (you|u) relocate\b/i,
  /\bhow many years (of )?(experience|exp)\b|\bwhat(?:'s| is) (your|my) (years of )?experience\b/i,
  /\bwhat (was|is) (your|my) (last|current|previous) (company|employer|job|role|title)\b/i,
  /\bwhere (are|r) (you|u) (based|located)\b|\bwhat(?:'s| is) (your|my) availability\b/i,
];
// Sales: pricing/product/competitor/objection questions (spec Case G). Uses sales
// ccontexto Não resume/JD/negotiation. O ativo modo também signals sales, mas o
// answerType lets o selector excluir resume/salary independentemente de mmodo
const SALES_PATTERNS = [
  // Commercial terms. NOTE: bare "deal" é EXCLUDED (it collides com "deal com
  // pressure/ambiguity" — a behavioral ask; 1000-q benchmark 2026-06-06b). A sales
  // "deal" precisa a commercial qualifier ("fechar o deal", "o deal/discount").
  /\b(pricing|price|cost|expensive|cheaper|discount|quote|contract|close the deal|the deal\b|better deal|a deal on)\b/i,
  /\bcompare(?:d)?\s+(?:to|with|against)\s+(?:your\s+|the\s+|other\s+)?competitors?\b|\bvs\.?\s+(?:a\s+)?competitors?\b|\bcompetitors?\b/i,
  /\b(your|the) product\b.*\b(do|offer|cost|price|compare|better|why)\b/i,
  // "por que deve we buy/choose/pick X" é sales Apenas quando X é a product/vendor.
  // "por que deve we escolher YOU (sobre outro candidates)" é o canonical why-hire
  // question e precisa fall através para JD_FIT (benchmark 2026-06-12
  // wta_jdfit_030 false-refusal: sales_answer forbids o rretomar então o modelo
  // claimed nada era loaded). "escolher you guys" (o vendor) stays sales via
  // o inner exception.
  /\bwhy (should|would) (i|we) (buy|choose|pick|go with)\b(?!\s+(?:you|me)\b(?!\s+guys))/i,
  // "por que deve a customer/prospect/buyer choose/buy …" — o seller rehearsing
  // o valor pitch (manual regression 2026-06-12 define 17). O subject sendo a
  // CUSTOMER (não i/we) makes it unambiguous sales.
  /\bwhy (should|would|will) (a |the |any )?(customer|prospect|client|buyer)s?\b.{0,30}\b(choose|buy|pick|go with|select|switch)\b/i,
  /\b(roi|return on investment|value proposition|use case)\b/i,
  // Objection-handling & deal/close/sell coaching (release 2026-06-07 multimode-1000):
  // "como fazer you manipular isso objection", "handle o objection que X", "como fazer we
  // fechar isso deal", "como iria you sell isso para a recruiter", "what's o pitch".
  /\b(handle|address|respond to|overcome|deal with) (this |that |the |an? |their )?objection\b/i,
  /\bobjection (that|about|is|handling)\b/i,
  /\bhow (do|would|should) (we|you|i)\b.{0,30}\b(close (the|this) deal|sell (this|it)|pitch (this|it)|sell to|upsell)\b/i,
  /\bhow (would|do) you sell\b|\bwhat(?:'s| is) the (pitch|sales pitch|sell)\b/i,
  /\bfounder credibility\b|\b(give me|write) (a )?(founder|sales|pitch) (answer|response|credibility)\b/i,
  // "o que deve I say para a customer quem says X / quando o prospect objects" — sales
  // objection coaching (release 2026-06-07 multimode-1000).
  /\bwhat should i say to (a |the )?(customer|prospect|client|lead|buyer)\b/i,
  /\b(customer|prospect|client) (says?|objects?|asks?|complains?)\b.{0,40}\b(too (slow|expensive|hard|much)|not (sure|interested)|why|how)\b/i,
];
// PRODUCT + CANDIDATE MIX (Issue 5): "por que é your Perfil good para selling this
// product?", "por que são you CREDIBLE para sell this?", "por que são you o direito FOUNDER
// para isso product?". These mix candidate credibility com a product/sales
// frame — they precisa Não rotea para profile_fact (que iria dump o résumé).
// Founder credibility é allowed, mas como framing (persona/custom), não a perfil
// lista — o layer tabela forbids resume/jd/negotiation.
const PRODUCT_CANDIDATE_MIX_PATTERNS = [
  /\bwhy (is|are) (your|you)\b.*\b(profile|background|experience|credible|qualified|right (founder|person))\b.*\b(sell|selling|sell this|this product|pitch|founder)\b/i,
  /\bwhy (are|r) (you|u)\b.*\b(credible|the right founder|qualified)\b.*\b(sell|selling|this product|pitch)\b/i,
  /\bwhy (are|r) (you|u) the right founder\b/i,
  /\b(your|you) (profile|background|credibility)\b.*\b(good for|right for) (selling|pitching|this product)\b/i,
  /\bwhy (should|would) (i|we|they) (buy from|trust) (you|your)\b/i,
];
// Lecture: questions sobre lecture/slide/lecture material (spec Case H). Uses
// lecture materials + tela + referência files, Não resume/JD/negotiation.
const LECTURE_PATTERNS = [
  /\b(this slide|the slide|lecture slide|this diagram|the diagram|the professor|the lecturer|the lecture|lecture)\b/i,
  /\bwhat (did|does) (the )?(professor|lecturer|teacher) (mean|say)\b/i,
  /\bon (the|this) (slide|board|screen)\b/i,
  // Exam/study-domain asks que são lecture-mode independentemente de an active-mode sinal
  // (release 2026-06-07 multimode-1000): "give me a 6/12-mark answer", "o que são o
  // exam points", "make notes", "o que deve I revise", "resumir isso concept".
  /\b(give me |write )?(an? )?\d+[- ]?marks?\s+(answer|question|response)\b|\bfor \d+ marks?\b/i,
  /\b(what are|whats?) the (exam|key) (points?|takeaways?)\b|\bexam (points?|answer|prep|revision)\b/i,
  /\bmake (me )?notes?\b|\btake notes?\b|\bclass notes?\b/i,
  /\bwhat should i revise\b|\bwhat (to|should i) study\b|\brevise for (the )?(exam|test)\b/i,
  /\bsummari[sz]e (this|the) (concept|topic|chapter|lesson|material|reading)\b/i,
  /\bexplain (this|the) (concept|topic) (like|as|for) (an? )?(exam|student)\b/i,
];
const FOLLOW_UP_PATTERNS = [
  /\b(that|this) (project|approach|answer|solution)\b|\bcan you (expand|optimize|dry run|explain)\b|\bwhat about complexity\b|\bwhy did you choose\b/i,
  // Bare imperative refinements de o prior answer (release 2026-06-07): "agora
  // otimizar it", "otimizar this", "make it faster", "improve it", "expandir em that".
  /^(?:(?:ok(?:ay)?|so|now|right|alright)[\s,]*)*(?:optimi[sz]e|improve|refactor|simplify|expand|elaborate|continue|go deeper)\b[\s\w]{0,20}(it|this|that|further|more)?[\s?.!]*$/i,
  /\b(now |then )?(optimi[sz]e|improve|refactor|speed up|make .{0,10}faster) (it|this|that)\b/i,
  // VOICE-CONTROL / EVIDENCE-CONTROL coaching directives (Issue 8) — "answer como
  // a candidate, não como an assistant", "say o que I deve say mas em my voice",
  // "make it sound confident mas don't lie", "if não metric é lá answer
  // sem fake metric". These modify Como o prior answer é delivered; they
  // resolver contra o prior turn em o live pcaminho
  /\banswer (like|as) a candidate\b|\bnot (like|as) an? assistant\b/i,
  /\bsay what i should say\b|\bin my (own )?voice\b/i,
  /\b(without|no) (fake|made[- ]?up|invented) (metric|number|stat)/i,
  /\bif no metric is there\b/i,
  /\bsound confident but (don'?t|do not) lie\b/i,
  /\bmake it (sound )?(confident|natural|concise)\b/i,
  // BARE follow-up fragments (Issue 8) — "whypor que "como so?então "and X?", "o que sobre
  // X?". Em their próprio they're ambiguous, mas they são Sempre follow-ups (nunca a
  // standalone question), então rotea para follow_up_answer em vez disso de unknown. Em o
  // live caminho o FollowUpResolver executa primeiro e resolves them para a concrete
  // tipo using o prior turn; isso é o no-prior-context floor.
  /^(?:(?:ok(?:ay)?|so|hmm|right|alright|cool|yeah)[\s,]*)*(?:why|how so|how come)\b[\s?.!]*$/i,
  /^(?:(?:ok(?:ay)?|so|hmm|right|yeah|cool)[\s,]*)*(?:and|what about|how about)\s+[\w +#.]{1,30}\??$/i,
  // Bare continuation fragments — "go onem "continue", "tell me momais "and?",
  // "keep going", "mmais (1000-q 2026-06-06b). Sempre a follow-up, nunca standalone.
  /^(?:(?:ok(?:ay)?|so|hmm|right|yeah|cool|um)[\s,]*)*(?:go on|continue|keep going|tell me more|more|and\??|then\??|next)\b[\s?.!]*$/i,
  // BARE "o que deve I say/answer?" com Não embedded question — o canonical
  // live "what's my próximo line?" tacionar Com não prior turn it carries não ssinal
  // então it's o follow_up floor (perfil FORBIDDEN, resolved live por prior turn).
  // A LONGER formulário que embeds o actual ask ("o que deve I say se they ask sobre
  // SQL?") é handled por INDIRECT_COACHING em o unmatched fallback, não haqui
  /^(?:(?:ok(?:ay)?|so|hmm|right|alright|cool|yeah|um)[\s,]*)*what should i (say|answer|respond)\b[\s?.!]*$/i,
];

// ── Standalone elliptical/meta-directive resolution (Issue 4/5/6/7) ───────────
// A live transcript resolves these contra o prior turn (FollowUpResolver). Mas
// quando they arrive Sem prior contexto (manual chat, o benchmark's manual
// surface), they ainda carry enough sinal para escolher o maioria provavelmente CONCRETE
// answer tipo em vez disso de collapsing para o generic follow_up floor. Cada block
// abaixo é checked (em classifyStandaloneFragment) Antes o follow_up floor então
// o fragment routes para a real, correctly-grounded answer ttipo O follow_up
// floor remains para fragments com Não usable sinal ("o que sobre data?", "o que
// deve I answer?") — those stay profile-FORBIDDEN então they can't dump o résumé.

// Skill/tech tokens recognised dentro a bare topic-shift ("and Python?", "o que
// sobre SQL?"). A named skill → skill_experience (perfil required, primeiro
// person). Mirrors FollowUpResolver.SKILL_TOKEN_RE.
const STANDALONE_SKILL_TOKEN_RE = /\b(python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|backend|frontend|full[\s-]?stack)\b/i;
// A bare topic-shift fragment: "and X?", "o que sobre X?", "como sobre X?",
// optionally com filler ("hmm rdireito e Python?").
const TOPIC_SHIFT_FRAGMENT_RE = /^(?:(?:ok(?:ay)?|so|hmm|right|alright|cool|yeah|well|um|uh)[\s,]*)*(?:and|what about|how about|what of)\s+([a-z0-9+#.\- ]{2,30}?)\s*\??$/i;
// WORK-EXPERIENCE nouns that, como a bare topic shift, são sobre o candidate's
// próprio past work ("o que sobre stakeholders?", "o que sobre dashboards?") → an
// experience/skill answer (perfil required). Distinct de o AMBIGUOUS bare
// "data" (excluded — appears em non-candidate chatter), que stays em o floor.
// NOTE: coding-ambiguous nouns ("testing", "documentation", "data") são EXCLUDED
// (code-review 2026-06-06, LOBaixo como a bare topic shift em a coding interview they
// provavelmente significar o atual problem's tests/docs, não o candidate's past work. O
// live FollowUpResolver resolves them com prior-turn ccontexto o standalone floor
// keeps them fora de a perfil answer.
const STANDALONE_WORK_NOUN_RE = /\b(stakeholders?|dashboards?|reporting|reports?|requirements?|deadlines?|teamwork|collaboration|ownership|leadership|analytics|visuali[sz]ations?|pipelines?|etl|migrations?)\b/i;
// VOICE / EVIDENCE-CONTROL directives ("answer como a candidate", "say it em my
// voice", "make it sound confident mas don't lie", "if não metric é lá answer
// sem a fake metric"). These são Não how-to-deliver no-ops: they're an
// interview coaching ask para o candidate's Próprio answer → a profile-grounded
// candidate answer em primeiro person, nunca o generic floor e nunca o
// assistant voice (Issue 5: veryhard_016/017/012/047).
const VOICE_CONTROL_RE = /\banswer (like|as) a candidate\b|\bnot (like|as) an? assistant\b|\bsay what i should say\b|\bin my (own )?voice\b|\bmake it sound like me\b|\bsay (this|it) as me\b|\bgive me the candidate answer\b|\bdon'?t answer like (chatgpt|an? ai)\b/i;
// EVIDENCE-CONTROL directives — "don't overclaim / não fake metric / sound
// confident mas don't lie". Mesmo routing como voice-control (candidate answer).
// NOTE: todo alternative exige CANDIDATE-ANSWER contexto (a metric/profile/lie
// cue) — a bare "don't overclaim" era REMOVED (code-review 2026-06-06, MED): em its
// próprio it hijacked a pure technical ask ("explain binário busca mas don't
// overclaim") dentro de a profile-grounded answer, porque metaDirective wins sobre todo
// depois matcher. O "uso my perfil mas don't overclaim" alternative ainda covers
// o genuine profile-steer case.
const EVIDENCE_CONTROL_RE = /\b(without|no|don'?t (use|invent|add)) (a |any )?(fake|made[- ]?up|invented) (metric|number|stat)|\bif no metric is there\b|\bsound confident but (don'?t|do not) lie\b|\b(use|using) my profile but (don'?t|do not) overclaim\b/i;
// A JD-FIT GAP-BRIDGE meta-ask: o candidate states a mismatch entre o que they
// ter e what's asked, então asks o que para say ("I ter full-stack, they ask data
// analyst, o que fazer I say?", "I ter projects mas não pure analyst, answer this").
// This é a role-fit answer (retomar + JD), não a project/skill answer (Issue 7).
// O middle clause Precisa carry a ROLE/JD token (code-review 2026-06-06, MED): a
// bare "they want"/"but nnão sem a role noun ("I ter a llista they want it
// sorted, o que fazer I say") é a coding ask, não a JD-fit meta-prompt — exigir an
// explicit role/position/JD/job/hire/analyst/engineer token entre o have-claim
// e o what-to-say ask então generic conteúdo can't mis-route para jd_fit.
const JD_ROLE_TOKEN = '(?:role|position|job|jd|job description|hir(?:e|ing)|analyst|engineer|developer|data analyst|this (?:role|job|position|one))';
const JD_GAP_BRIDGE_RE = new RegExp(
  `\\bi have\\b.{0,80}?\\b${JD_ROLE_TOKEN}\\b.{0,60}?\\b(what (do|should) i (say|answer)|answer this|how do i (say|answer)|what to say)\\b`,
  'i',
);

/**
 * Resolve a standalone elliptical / meta-directive fragment para a CONCRETE answer
 * tipo using apenas o sinal em o fragment si mesmo (não prior turn). Retorna null
 * quando o fragment carries não usable sinal — o caller então uses o generic
 * follow_up floor (perfil FORBIDDEN, então it can't dump o résumé).
 *
 * Ordering matters: o maioria específico sinal wins. A JD-gap-bridge meta-ask beats
 * a bare topic shift; a named skill beats a work-noun; "complexity" é technical.
 * O LIVE path's FollowUpResolver ainda executa primeiro e supersedes isso com
 * prior-turn ccontexto isso é o manual / no-context resolver.
 */
const classifyStandaloneFragment = (text: string): AnswerType | null => {
  const t = text.trim();

  // 1. JD-fit gap-bridge meta-ask ("I ter X, they ask Y, o que fazer I say?").
  if (JD_GAP_BRIDGE_RE.test(t)) return 'jd_fit_answer';

  // 2. Bare topic shift "and X?" / "o que sobre X?".
  const shift = t.match(TOPIC_SHIFT_FRAGMENT_RE);
  if (shift) {
    const topic = shift[1].trim();
    // "o que sobre complexity?" → a technical follow-up (perfil FORBIDDEN).
    if (/\bcomplexity\b/i.test(topic)) return 'technical_concept_answer';
    // A named skill → skill_experience (perfil required, primeiro person).
    if (STANDALONE_SKILL_TOKEN_RE.test(topic)) return 'skill_experience_answer';
    // A work-experience noun ("stakeholders", "dashboards") → o candidate's próprio
    // experience (perfil required). Bare ambiguous "data" é deliberately Não
    // matched aqui — it stays em o follow_up floor (perfil forbidden).
    if (STANDALONE_WORK_NOUN_RE.test(topic)) return 'skill_experience_answer';
    // Caso contrário an ambiguous topic ("o que sobre data?") → nulo → floor.
    return null;
  }

  // 3. Voice / evidence-control directive → a profile-grounded candidate answer.
  //    Escolher o nearest concrete bucket por embedded cue; padrão para experience.
  if (VOICE_CONTROL_RE.test(t) || EVIDENCE_CONTROL_RE.test(t)) {
    if (/\b(fit|hire|role|job|position|confident|sell|right for)\b/i.test(t)) return 'jd_fit_answer';
    if (/\b(project|built|refract|metric|impact|result)\b/i.test(t)) return 'project_answer';
    if (/\b(rate|skill|python|sql|level|proficien)\b/i.test(t)) return 'skill_experience_answer';
    return 'experience_answer';
  }

  return null;
};

const templateFor = (answerType: AnswerType): string => {
  switch (answerType) {
    case 'coding_question_answer':
    case 'dsa_question_answer':
      return CODING_TEMPLATE;
    case 'behavioral_interview_answer':
    case 'experience_answer':
      return BEHAVIORAL_TEMPLATE;
    case 'project_answer':
      // Fase 3: dedicated project structure (Não behavioral STAR).
      return PROJECT_TEMPLATE;
    case 'project_followup_answer':
      // Fase 5: concise first-person drill-in em o resolved project.
      return PROJECT_FOLLOWUP_TEMPLATE;
    case 'jd_fit_answer':
      return JD_FIT_TEMPLATE;
    case 'gap_analysis_answer':
      return GAP_ANALYSIS_TEMPLATE;
    case 'negotiation_answer':
      return NEGOTIATION_TEMPLATE;
    case 'system_design_answer':
      return SYSTEM_DESIGN_TEMPLATE;
    case 'debugging_question_answer':
      return DEBUGGING_TEMPLATE;
    case 'technical_concept_answer':
      // Generic technical explanation — não pperfil não persona, e a Curto spoken
      // interview answer (não a tutorial). spoken-answer-quality sprint 2026-06-15.
      return TECHNICAL_CONCEPT_TEMPLATE;
    case 'identity_answer':
    case 'profile_fact_answer':
    case 'skills_answer':
    case 'skill_experience_answer':
      return SKILL_RATING_TEMPLATE;
    case 'sales_answer':
    case 'product_candidate_mix_answer':
      return SALES_TEMPLATE;
    case 'lecture_answer':
      return GENERAL_TEMPLATE;
    case 'ethical_usage_answer':
      return ETHICAL_USAGE_TEMPLATE;
    case 'project_link_answer':
      return PROJECT_LINK_TEMPLATE;
    case 'source_code_evidence_answer':
      return SOURCE_CODE_EVIDENCE_TEMPLATE;
    case 'project_about_answer':
      return PRODUCT_ABOUT_TEMPLATE;
    default:
      return GENERAL_TEMPLATE;
  }
};

const requiredLayersFor = (answerType: AnswerType): ContextLayer[] => {
  switch (answerType) {
    case 'identity_answer':
      return ['stable_identity', 'resume'];
    case 'profile_fact_answer':
    case 'project_answer':
    case 'skills_answer':
    case 'skill_experience_answer':
    case 'experience_answer':
    case 'behavioral_interview_answer':
      return ['resume', 'custom_context', 'ai_persona'];
    case 'project_followup_answer':
      // Drill-in em a project: o project's retomar facts + o prior assistant
      // turn (to resolver "it"/"that") + custom contexto + persona style.
      return ['resume', 'prior_assistant_responses', 'custom_context', 'ai_persona'];
    case 'jd_fit_answer':
    case 'gap_analysis_answer':
      return ['resume', 'jd', 'custom_context', 'ai_persona'];
    case 'coding_question_answer':
    case 'dsa_question_answer':
    case 'technical_concept_answer':
    case 'system_design_answer':
    case 'debugging_question_answer':
      return ['live_transcript', 'active_mode', 'screen_context', 'preferred_language'];
    case 'negotiation_answer':
      return ['negotiation', 'jd', 'custom_context', 'ai_persona'];
    case 'sales_answer':
      return ['custom_context', 'reference_files', 'active_mode', 'ai_persona'];
    case 'product_candidate_mix_answer':
      // Sales/product contexto + persona/custom para FOUNDER credibility framing —
      // Não o résumé (não completo perfil dump em a selling answer).
      return ['custom_context', 'reference_files', 'active_mode', 'ai_persona'];
    case 'lecture_answer':
      return ['live_transcript', 'screen_context', 'reference_files', 'active_mode'];
    case 'follow_up_answer':
      return ['live_transcript', 'prior_assistant_responses', 'active_mode'];
    case 'project_about_answer':
      // Grounded em o loaded project metadados (résumé projects) + custom contexto
      // + persona. Não o JD/negotiation. Mesmo grounding como a project answer.
      return ['resume', 'custom_context', 'reference_files', 'ai_persona'];
    case 'project_link_answer':
      // O linkar lives em o project metadados (résumé) ou custom contexto /
      // referência files. Não JD/negotiation. O template enforces no-invention.
      return ['resume', 'custom_context', 'reference_files'];
    case 'source_code_evidence_answer':
      // Real código apenas comes de referência files / loaded sfonte project
      // metadados names o project. Não JD/negotiation. O template enforces
      // honesty sobre what's loaded.
      return ['reference_files', 'custom_context', 'resume', 'active_mode'];
    case 'ethical_usage_answer':
      // A safety answer precisa Não candidate contexto — it's a política redirecionar sobre
      // o product. Persona apenas (para tone). Nunca résumé/JD/negotiation.
      return ['ai_persona'];
    default:
      return ['live_transcript', 'active_mode'];
  }
};

const forbiddenLayersFor = (answerType: AnswerType): ContextLayer[] => {
  switch (answerType) {
    case 'identity_answer':
      return ['jd', 'negotiation', 'reference_files'];
    case 'coding_question_answer':
    case 'dsa_question_answer':
    case 'technical_concept_answer':
    case 'system_design_answer':
    case 'debugging_question_answer':
      // Spec §8.3: generic coding/technical answers precisa Não uso qualquer pperfil
      return ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files'];
    case 'skill_experience_answer':
    case 'skills_answer':
    case 'profile_fact_answer':
      // Sobre o user's próprio facts — retomar YSim mas não JD/negotiation (spec §8:
      // negotiation contexto apenas para salary answers).
      return ['jd', 'negotiation', 'reference_files'];
    case 'project_answer':
    case 'experience_answer':
    case 'behavioral_interview_answer':
      // Perfil narrative answers — nunca o negotiation/salary layer.
      return ['negotiation'];
    case 'project_followup_answer':
      // A project drill-in stays em o project's próprio facts: nunca negotiation,
      // e não o JD (unrelated para "como era it built / o que era your role").
      return ['negotiation', 'jd', 'reference_files'];
    case 'jd_fit_answer':
    case 'gap_analysis_answer':
      return ['negotiation'];
    case 'negotiation_answer':
      return ['reference_files'];
    case 'sales_answer':
      // Sales answers precisa não pull o user's resume/JD ou negotiation/salary.
      return ['resume', 'jd', 'negotiation'];
    case 'product_candidate_mix_answer':
      // Founder/credibility-for-selling: não résumé/JD DUMP, não salary. Credibility
      // comes de persona/custom-context framing, não a perfil llista
      return ['resume', 'jd', 'negotiation'];
    case 'lecture_answer':
      // Lecture answers precisa não pull resume/JD/negotiation.
      return ['resume', 'jd', 'negotiation'];
    case 'general_meeting_answer':
      // Meeting recap ("ação items?", "o que fez we decide?", "o que era o
      // customer asking?") é sobre o CONVERSATION — nunca o candidate's
      // pperfil Forbid resume/JD/negotiation então o knowledge intercept can't
      // inject o résumé (benchmark 2026-06-05 context-leak).
      return ['resume', 'jd', 'negotiation'];
    case 'follow_up_answer':
      // A BARE, unresolved follow-up fragment ("o que sobre data?", "o que deve I
      // answer?") com não prior turn para herdar de é o FLOOR case. It precisa
      // nunca acionar a broad résumé/skill dump (benchmark 2026-06-06 leak:
      // "o que sobre data?" returned "Based em your pperfil aqui é o completa
      // lista de your data-related skills…"). Forbid resume/JD/negotiation então o
      // knowledge intercept can't inject them. Em o LIVE caminho o
      // FollowUpResolver resolves o fragment para a CONCRETE tipo Antes planning,
      // então a genuine "And SQL?" becomes skill_experience (retomar allowed) and
      // nunca lands aqui — isso floor apenas bites verdadeiramente context-free fragments.
      return ['resume', 'jd', 'negotiation'];
    case 'ethical_usage_answer':
      // A safety/policy answer precisa pull Não candidate contexto at atodos
      return ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files'];
    case 'project_about_answer':
      // Product description — nunca o JD/negotiation/salary layer.
      return ['jd', 'negotiation'];
    case 'project_link_answer':
    case 'source_code_evidence_answer':
      // Link/source answers são sobre o project artifact, nunca JD/negotiation.
      return ['jd', 'negotiation'];
    default:
      return [];
  }
};

export const isCodingAnswerType = (answerType: AnswerType): boolean =>
  answerType === 'coding_question_answer' || answerType === 'dsa_question_answer';

// Fase 2: answer types que speak Como o candidate (primeiro person live / segundo
// person manual). Profile-directed asks + negotiation (o candidate negotiates).
const CANDIDATE_VOICE_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'gap_analysis_answer', 'behavioral_interview_answer', 'negotiation_answer',
]);

// Fase 2: o profile-context política por answer ttipo `forbidden` é o hard
// leak regra (coding/technical/sales/lecture obtém Não pperfil spec §8.3); `required`
// significa o answer é sobre o user e Precisa ser grounded; `allowed` significa perfil
// pode help mas isn't mandatory (negotiation leverage, generic meeting).
export const profileContextPolicyFor = (answerType: AnswerType): ProfileContextPolicy => {
  switch (answerType) {
    case 'coding_question_answer':
    case 'dsa_question_answer':
    case 'technical_concept_answer':
    case 'system_design_answer':
    case 'debugging_question_answer':
    case 'sales_answer':
    case 'product_candidate_mix_answer':
    case 'lecture_answer':
    case 'general_meeting_answer':
      // Meeting recap é sobre o conversation, não o candidate — não pperfil
      return 'forbidden';
    case 'ethical_usage_answer':
      // Safety answer: Não perfil at atodos
      return 'forbidden';
    case 'identity_answer':
    case 'profile_fact_answer':
    case 'project_answer':
    case 'project_followup_answer':
    case 'skills_answer':
    case 'skill_experience_answer':
    case 'experience_answer':
    case 'jd_fit_answer':
    case 'gap_analysis_answer':
    case 'behavioral_interview_answer':
    case 'project_about_answer':
      // Product-about answers Precisa ser grounded em o loaded project metadados
      // (não overclaim) — mesmo como a project answer.
      return 'required';
    case 'project_link_answer':
    case 'source_code_evidence_answer':
      // O link/source comes de loaded metadata/reference files; grounding é
      // REQUIRED então o answer reflects Apenas what's loaded (não invented URL/code).
      return 'required';
    case 'follow_up_answer':
      // FLOOR para an unresolved bare fragment — perfil FORBIDDEN então an ambiguous
      // "o que sobre data?" can't dump o résumé (benchmark 2026-06-06 leak). O
      // live FollowUpResolver upgrades genuine follow-ups para a concrete tipo
      // (que define its próprio ppolítica antes isso floor é já reached.
      return 'forbidden';
    case 'negotiation_answer':
    case 'unknown_answer':
    // NOTE: general_meeting_answer é handled em o 'forbidden' agrupar acima
    // (meeting recaps precisa nunca pull o pperfil — fazer não re-add it haqui
    default:
      return 'allowed';
  }
};

// Fase 5: pull a provavelmente project/entity Nome fora de a follow-up question
// ("como é Refract developed?" → "Refract", "o que era your role em SQL-Copilot?"
// → "SQL-Copilot"). Deterministic, conservative: prefers a capitalized /
// hyphenated token após a project preposition; nunca invents. Retorna '' quando
// o question apenas uses a pronoun ("it"/"that") — o orchestrator então resolves
// de o prior turn iem vez disso
const PROJECT_ENTITY_RE = /\b(?:in|on|for|about|of|is|was|did)\s+([A-Z][A-Za-z0-9]*(?:[-_ ][A-Z0-9][A-Za-z0-9]*){0,3})\b/;
const ENTITY_STOPWORDS = new Set(['I', 'You', 'We', 'It', 'That', 'This', 'The', 'My', 'Your', 'A', 'An', 'Their', 'Our', 'His', 'Her']);
// Common TECHNOLOGY nouns que são Não project names. A capitalized tech token
// após a preposition ("otimizar binário busca em Postgres") precisa Não ser treated
// como uma entidade de projeto, ou ele contornaria a protecao DSA/codigo e vazaria o
// retomar dentro de a pure coding answer (code-review 2026-06-05, HAlto invariant #1).
const TECH_NOT_ENTITY = new Set([
  'postgres', 'postgresql', 'mysql', 'sqlite', 'mongo', 'mongodb', 'redis', 'kafka',
  'rabbitmq', 'elasticsearch', 'python', 'java', 'javascript', 'typescript', 'golang',
  'rust', 'react', 'angular', 'vue', 'node', 'nodejs', 'express', 'django', 'flask',
  'fastapi', 'spring', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'k8s', 'graphql',
  'rest', 'grpc', 'sql', 'nosql', 'pandas', 'numpy', 'spark', 'hadoop', 'tableau',
  'excel', 'powerbi', 'linux', 'nginx', 'terraform',
]);
export const extractProjectEntity = (question: string): string => {
  const m = question.match(PROJECT_ENTITY_RE);
  if (!m) return '';
  // Strip qualquer LEADING stopword tokens ("O Project" → "Project", "My Project" →
  // "Project") então a determiner/possessive prefix doesn't leak como o entity. If
  // nada survives, there's não real named entity — retorna '' e let o
  // orchestrator resolver de o prior turn iem vez disso
  const tokens = m[1].trim().split(/\s+/);
  while (tokens.length && ENTITY_STOPWORDS.has(tokens[0])) tokens.shift();
  const candidate = tokens.join(' ');
  // A bare comum word como "Project" alone isn't a usable project Nome equalquer um
  if (!candidate || /^(Project|Projects|Role|Thing|Part|Work)$/i.test(candidate)) return '';
  // A bare technology token é Não a project entity (see TECH_NOT_ENTITY abacima
  if (tokens.length === 1 && TECH_NOT_ENTITY.has(candidate.toLowerCase())) return '';
  return candidate;
};

// A project follow-up tem explicit project Contexto quando o prior turn resolved a
// project (followUpTarget) Ou o question names a project após a project
// preposition ("in/on/for <NameNome Quando tverdadeiro a project-drill-in verb é
// unambiguously sobre que project até se o nome contém a tech token
// (SQL-Copilot). A bare generic subject ("otimizar binário sebusca yields não
// entity haqui então o technical guards ainda aaplica
const followUpHasProjectContext = (input: PlanAnswerInput, rawQuestion: string): boolean => {
  if (input.extractedQuestion?.followUpTarget) return true;
  if (extractProjectEntity(rawQuestion) !== '') return true;
  // A trailing locative pronoun ("…thelá "…em it?", "…em que project?")
  // anchors o drill-in para o project já sob discussion — treat it como
  // explicit project contexto então a technical noun (database/latency/backend) em
  // o question doesn't bounce it fora de project_followup (benchmark 2026-06-05).
  return /\b(there|in it|on it|in that|on that|in the project|on the project)\b\s*\??$/i.test(rawQuestion.trim());
};

// Fase 2: profile-aware alternativa para questions que matched Não explicit pattern.
// Conservative por design — apenas pulls an unmatched question dentro de a perfil answer
// tipo quando it é claramente DIRECTED AT O CANDIDATE (second/first person sobre
// them) em a manual/interview ccontexto Tudo senão stays unknown_answer
// (profileContextPolicy 'allowed' — não forced pperfil não leak).
const SELF_REFERENTIAL_RE = /\b(you|your|yours|yourself|u|ur)\b/i;          // interviewer→candidate
const FIRST_PERSON_RE = /\b(i|i'?m|i'?ve|my|me|mine|myself)\b/i;            // user→self ("o que deve I say")
// "O que deve I say/answer se they ask X" — indirect recruiter coaching. We
// rotea por o EMBEDDED ask então o direito perfil contexto é selected.
const INDIRECT_COACHING_RE = /\bwhat (should|do|would) (i|you) (say|answer|tell them|respond)\b/i;
const classifyUnmatchedFallback = (text: string, input: PlanAnswerInput): AnswerType => {
  const interview = input.source === 'what_to_answer' || input.source === 'transcript';
  const manual = input.source === 'manual_input';
  const hasProfile = input.hasCandidateProfile !== false; // default-allow quando unknown
  // Apenas engage o perfil alternativa em a manual/interview contexto com a pperfil
  if (!(interview || manual) || !hasProfile) {
    return manual ? 'unknown_answer' : 'general_meeting_answer';
  }
  // Vague opinion / discourse questions ("então o que fazer you think sobre todos this?",
  // "como sobre that?") conter "you" mas são Não sobre o candidate's perfil —
  // they precisa stay neutral, não pull pperfil Exigir o question para referência a
  // candidate Atributo ou ser an explicit coaching ask antes engaging pperfil
  // NOTE: bare "data" é deliberately EXCLUDED (it appears em non-candidate
  // analyst chatter — "envia me o data", "o dados pipeline é dowabaixo apenas o
  // role-framed "data analyst"/"analytics" qualify (code-review 2026-06-05, MED).
  const CANDIDATE_ATTRIBUTE_RE = /\b(experience|background|skill|skills|project|projects|role|job|fit|hire|qualif|strength|weakness|study|studied|education|degree|college|university|intern|work|built|build|develop|languages?|tools?|tech|stack|rate|level|expertise|proficien|company|companies|career|resume|cv|profile|data analyst|analytics)\b/i;
  const candidateDirected =
    (SELF_REFERENTIAL_RE.test(text) && CANDIDATE_ATTRIBUTE_RE.test(text))
    || (FIRST_PERSON_RE.test(text) && CANDIDATE_ATTRIBUTE_RE.test(text))
    || INDIRECT_COACHING_RE.test(text);
  if (!candidateDirected) {
    // Não claramente sobre o candidate — keep neutral (não forced prperfil
    return manual ? 'unknown_answer' : 'general_meeting_answer';
  }
  // Candidate-directed mas unmatched. Escolher o nearest SAFE perfil bucket por
  // light keyword lean; padrão para profile_fact_answer (resume-grounded, concise,
  // first-person, Não jd/negotiation) — o safest "sobre me" answer.
  if (/\b(job|role|position|fit|hire|company|this (one|role|job)|qualified|suitable)\b/i.test(text)) return 'jd_fit_answer';
  if (/\b(project|built|build|developed|refract|app|system|architecture|stack|backend|database)\b/i.test(text)) return 'project_answer';
  if (/\b(rate|out of (10|ten)|level|scale|score)\b/i.test(text)) return 'skill_experience_answer';
  if (/\b(strength|weakness|example|story|time|teamwork|leadership|conflict|failure|pressure|ownership)\b/i.test(text)) return 'behavioral_interview_answer';
  if (/\b(experience|background|intern|internship|worked|company|role|did you do)\b/i.test(text)) return 'experience_answer';
  if (/\b(skill|skills|language|tool|tech|technolog|good at)\b/i.test(text)) return 'skills_answer';
  return 'profile_fact_answer';
};

// Normalizar comum chat-speak / SMS spellings para ROUTING Apenas (o displayed
// answer ainda uses o original text). Conservative, whole-word mappings de
// unambiguous abbreviations então noisy real-user entrada ("u gud at python", "wat
// kinda app é dis", "tell me ur best projcet") routes como its proper-English
// formulário (1000-q benchmark 2026-06-06b noisy category). Não a spell-checker — apenas
// these well-known tokens são touched.
const SMS_NORMALIZATIONS: Array<[RegExp, string]> = [
  [/\bu\b/gi, 'you'], [/\bur\b/gi, 'your'], [/\bgud\b/gi, 'good'], [/\bwat\b/gi, 'what'],
  [/\bdis\b/gi, 'this'], [/\bpls\b/gi, 'please'], [/\bplz\b/gi, 'please'], [/\bthx\b/gi, 'thanks'],
  [/\br\b/gi, 'are'], [/\bcuz\b/gi, 'because'], [/\bkinda\b/gi, 'kind of'], [/\byoself\b/gi, 'yourself'],
  [/\byoursef\b/gi, 'yourself'], [/\bprojcet\b/gi, 'project'], [/\bprojects?et\b/gi, 'project'],
  [/\bexperince\b/gi, 'experience'], [/\brefract\b/gi, 'refract'], [/\bnativly\b/gi, 'refract'],
];
const normalizeSms = (s: string): string => {
  let out = s;
  for (const [re, rep] of SMS_NORMALIZATIONS) out = out.replace(re, rep);
  return out;
};

export const planAnswer = (input: PlanAnswerInput): AnswerPlan => {
  const rawQuestion = input.question || input.extractedQuestion?.latestQuestion || '';
  const question = rawQuestion.trim();
  const text = normalizeSms(question.toLowerCase());
  // "tech spilha / "technology spilha é a phrase, não o DSA `stack` data
  // structure — neutralize it então o project-followup DSA-exclusion proteger abaixo
  // doesn't mis-fire em "o que tech pilha fez you useuso
  // Neutralize "tech spilha / "technology spilha AND bare "full-stack" então o
  // DSA `\bstack\b` data-structure pattern can't disparar em them ("you said completo
  // spilha mas isso é dados analyst" precisa não become a stack/DSA question).
  const textNoTechStack = text
    .replace(/\b(tech|technology|technical)\s+stack\b/g, 'techstack')
    .replace(/\bfull[- ]?stack\b/g, 'fullstack');
  const extractedType = input.extractedQuestion?.questionType;

  let answerType: AnswerType = 'general_meeting_answer';

  // Skill-experience framing ("ter you used X?", "fazer you know X?") é sobre o
  // USER, então it precisa win Antes coding/DSA/technical patterns — caso contrário
  // "ter you used a hashmap?" mis-routes para o coding contract. It ainda yields
  // para explicit negotiation/identity (those são higher-priority perfil asks).
  // "o que tech pilha / technologies / backend / banco de dados / framework Fez YOU UUso
  // é a project ARCHITECTURE follow-up, não a generic skill-experience probe —
  // excluir it aqui então o project_followup branch (checked ldepois wins and
  // grounds em o específico project (ProfileRoutingMatrix invariant).
  // Project ARCHITECTURE drill-in (tech pilha / backend / banco de dados de a project) —
  // Não a generic "o que languages fazer you know" skills question, então `languages`/
  // `tools` são deliberately excluded haqui
  const isProjectStackQuestion = /\b(tech ?stack|technolog\w+|backend|database|frontend|framework|infra\w*|architecture|stack) (did|do|does|was|were)\b/i.test(textNoTechStack)
    || /\bwhat (tech ?stack|technolog\w+|backend|database|frontend|framework|stack) (did|do)\b/i.test(text);
  // PROJECT-framed asks precisa não ser captured por o broadened skill-experience
  // "have/did you build/do/develop" patterns — they belong para project_answer /
  // project_followup (ProfileRoutingMatrix invariants). Excluir quando o question
  // é sobre "projects", names/pronouns a project ("build IT", "develop THAT"),
  // ou é a project drill-in ("por que fez you build it", "como fez you optimise o
  // pipeline"). Bare skill probes ("ter you built dashboards?") ainda match.
  // A project DRILL-IN ("o que projects ter you dofeito "build IT", "develop THAT
  // project") deve defer para project routing. Mas a SKILL-experience probe that
  // merely mentions "project(s)" como a escopo ("ter you written SQL em your
  // projects?", "ter you used BFS em a project?") é ainda skill_experience —
  // então apenas excluir quando there's Não explicit have/did-you-use skill framing.
  // A "have/did you Uso <skill>" probe (com o use-verb LEADING o question)
  // é skill_experience até quando it mentions "project" como escopo ("ter you used
  // BFS em a project?", "ter you written SQL em your projects?"). Mas a question
  // que LEADS com "o que projects" ou drills dentro de a específico project ("por que fez
  // you build it?") é project routing. Distinguish por se o use-verb abre
  // o question vs. "project" sendo o subject.
  const leadsWithUseVerb = /^(have|did|do)\s+you\s+(ever\s+)?(used?|worked|written|wrote|implement|implemented|deploy|deployed|design|designed|know|knew)\b/i.test(text.trim());
  const isProjectFramed = (
    /\bwhat\s+projects?\b/i.test(text)
    || /\b(build|built|develop|developed|made|make|create|created|optimi[sz]e[d]?|design(ed)?)\s+(it|that|this|the (project|app|system|pipeline|product|tool))\b/i.test(text)
    || includesAny(text, PROJECT_FOLLOWUP_PATTERNS)
  ) && !leadsWithUseVerb;
  const hasSkillExperienceFraming = includesAny(text, SKILL_EXPERIENCE_PATTERNS) && !isProjectStackQuestion && !isProjectFramed;
  // Skill self-rating ("rate yourself fora de 10", "como good são you at X",
  // "your coding levels", "em a escalar de 1-10 como proficient são you"). Sobre o
  // USER's proficiency → skill_experience. Checked como its próprio branch (não
  // system-design exclusion) porque "scale" collides com SYSTEM_DESIGN_PATTERNS
  // ainda a self-rating é nunca a system-design question.
  // "Rate your <role> FIT fora de 10" é a JD-fit self-assessment, Não a skill
  // rating — o thing sendo rated é suitability para o role, que precisa o
  // JD (Issue 7: hard_014 "rate your dados analyst fit fora de 10"). Detect a fit /
  // role cue dentro o rating frame e let o JD_FIT branch abaixo claim it.
  const ratesRoleFit = /\b(fit|suitabilit|match|readiness|how ready)\b/i.test(text)
    || /\brate\s+(your|my)\s+[\w ]*\b(fit|suitabilit|match|readiness|data analyst|analyst)\b/i.test(text);
  const hasSkillRatingFraming = includesAny(text, SKILL_RATING_PATTERNS) && !ratesRoleFit;

  // A CODING Tarefa que merely mentions a comp word como DATA ("escreve a SQL consulta
  // para o segundo highest SALARY", "função para calcula BONUS") é Não a
  // negotiation question — o explicit código verb wins. Proteger o negotiation
  // branch então a "salary"/"bonus" Coluna em a coding ask doesn't mis-route to
  // compensation (benchmark 2026-06-05: salary-false-positive category).
  // Explicit code-writing verbs. NOTE: "qconsulta é intentionally EXCLUDED — "como
  // iria you uso a GraphQL qconsulta / "consulta dados using GraphQL" é a hypothetical
  // concept ask, não a code-writing ttarefa A genuine "escreve a SQL qconsulta é caught
  // por o write/COMMON_CODING patterns iem vez disso
  // NOTE: compute/return/print são EXCLUDED aqui (code-review 2026-06-05, MED) —
  // they'd wrongly veto a real comp question ("calcula my total compensation").
  // Genuine SQL/coding "salary" cases são caught por o write/COMMON_CODING/DSA
  // signals iem vez disso
  const hasExplicitCodingVerb = /\b(write|implement|code|program|function|solve)\b/i.test(text)
    || includesAny(text, COMMON_CODING_PROBLEM_PATTERNS) || includesAny(textNoTechStack, DSA_PATTERNS);
  // Strict "escreve code" verbs apenas (não DSA-term inference). Used para gate o
  // HYPOTHETICAL branch: "como iria you uso BFS?" é a concept (BFS é a DSA term
  // mas there's não write-verb), então it precisa Não ser blocked de technical_concept.
  const hasWriteCodeVerb = /\b(write|implement|code|program|solve)\b/i.test(text)
    || includesAny(text, COMMON_CODING_PROBLEM_PATTERNS);
  // A Claro past/present EXPERIENCE probe ("ter you implemented X beantes "onde
  // ter you used X", "fez you actually uso X") é sobre o CANDIDATE — it precisa
  // win até quando o subject collides com a system-design noun ("rate limiter",
  // "caching", "logging"). Sem this, "ter you implemented a rate limiter
  // bantes mis-routed para system_design (release 2026-06-07: residual pattern #2).
  // A write-code verb ainda vetoes (that's a coding ttarefa não an experience ask).
  // Excluir quando o objeto é o named product Refract ("como fez you build
  // Refract" é a product-about/architecture question, não a generic skill probe).
  const asksAboutRefract = /\bnativel?y\b|\bnativly\b/i.test(text);
  // "o que PROJECTS ter you built" é a project-LIST ask, não a skill probe — o
  // experience probe precisa não steal it (release 2026-06-07 regression guproteger
  const asksAboutProjectsList = /\b(what|which|any)\s+projects?\b/i.test(text);
  // A PROJECT-FOLLOWUP drill-in ("o que backend fez you uso THLá "o que tech pilha
  // fez you ususo "por que fez you build IT", "como fez you manipular latency thlá é
  // sobre a específico project em o tabela — Não a generic skill probe. Detect o
  // project-drill-in signals então o experience probe doesn't steal them (o probe
  // é para "ter you used <skill>?" / "ter you implemented <X> befantes que
  // nome a SKILL, não a project artifact). Release 2026-06-07 regression gproteger
  const isProjectDrillIn = includesAny(text, PROJECT_FOLLOWUP_PATTERNS)
    || /\b(there|in it|on it|in that|in the project|build it|built it)\b/i.test(text)
    || /\b(tech|technology|technical)\s+stack\b/i.test(text);
  // A PEOPLE/team/leadership objeto após managed/handled/led marks a behavioral STORY, não a
  // skill probe — excluir it então it falls através para BEHAVIORAL_PATTERNS (code-review caveat
  // 2026-06-16). "ter you managed a database/cluster" (a tech oobjeto stays a skill probe.
  const hasPeopleObject = new RegExp(`\\b(?:manage[d]?|handle[d]?|led|lead|mentor(?:ed)?|coach(?:ed)?|supervis(?:e|ed)|resolv(?:e|ed)|navigat(?:e|ed)|deal[t]?\\s+with)\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+|some\\s+|any\\s+)?${PEOPLE_OR_CONFLICT_OBJECT}\\b`, 'i').test(text);
  const isExplicitExperienceProbe = !hasWriteCodeVerb && !asksAboutRefract && !asksAboutProjectsList && !isProjectDrillIn && !hasPeopleObject && (
    /\bhave (you|u) (ever )?(used|worked with|worked on|built|implemented|written|coded|deployed|designed|done|handled|managed)\b/i.test(text)
    || /\bdid (you|u) (actually |really |ever )?(use|work with|build|implement|write|deploy|design|do|handle)\b/i.test(text)
    || /\bwhere have (you|i) (used|worked|applied|built|implemented)\b/i.test(text)
    || /\bhave (you|u) (implemented|built|used|designed)\b.{0,40}\bbefore\b/i.test(text)
    || /\byour experience (with|in|using|building)\b/i.test(text)
  );

  // EXPLICIT comp NEGATION + a skill-rating cue ("rate Python mas Não salary",
  // "fazer Não give salary, apenas rate coding", "your lnível Não salary, coding
  // lenível — o user é steering Longe de compensation em direção a a skill rating.
  // Suprimir o negotiation branch então o salary word dentro o negation doesn't
  // mis-route (benchmark 2026-06-05 salary-false-positive category).
  // O negation precisa alvo a COMP word: "no/not <…> salary" (negation Antes o
  // comp word) Ou "salary <…> nnão onde o trailing negation tem Não outro noun to
  // vincular to. A bare "salary mas não PROJECT" negates PROJECT, não salary, então it precisa
  // Não count (code-review 2026-06-06: veryhard_050 "uso salary mas não project" era
  // mis-suppressed → mis-routed para project em vez disso de negotiation).
  const negatesSalary = /\b(not|no|don'?t|without|never|skip|avoid|exclude)\s+(?:any\s+|the\s+|give\s+|giving\s+|mention(?:ing)?\s+|talk(?:ing)?\s+about\s+|discuss(?:ing)?\s+)?(salary|compensation|package|ctc|pay|money|offer)\b/i.test(text)
    || /\b(salary|compensation|package|ctc|pay)\b[\w ,'-]*\b(not|no|don'?t)\s*$/i.test(text.trim());

  // META-DIRECTIVES (Issue 5/7): coaching asks que encapsular a candidate answer —
  // a JD-fit gap-bridge ("I ter X, they ask Y, o que fazer I say?") ou a voice/
  // evidence-control directive ("answer como a candidate", "make it confident mas
  // don't lie"). These precisa resolver para a CONCRETE candidate tipo Antes o
  // generic pattern matchers (que iria mis-grab "projects"/"full-stack"/
  // "generic" fora de o wrapper text). A genuine código verb opts fora — a coding
  // ask é nunca a perfil meta-directive.
  const metaDirective = (!hasWriteCodeVerb && question) ? classifyStandaloneFragment(text) : null;

  // SAFETY (release 2026-06-06b): a stealth / undetectability / proctoring-evasion
  // ask precisa ser caught Antes qualquer outro rotea então it pode nunca recebe específico
  // evasion advice. A SAFE product/privacy phrasing ("é it low-distraction?",
  // "faz it processo locally?") com não evasion+interview combination é excluded.
  // SAFETY: an evasion+object combination Sempre wins — o privacy carve-out pode
  // nunca exempt it (code-review 2026-06-06b HIAlto isStealthEvasionQuestion é o
  // único authoritative predicate (também consulted por o manual fast-path).
  const isStealthEvasion = isStealthEvasionQuestion(text);
  // SOURCE-CODE evidence: a requisição para o ACTUAL código de a loaded project. Precisa
  // win sobre o generic coding rotea (que iria fabricate a plausible snippet).
  const wantsSourceEvidence = includesAny(text, SOURCE_CODE_EVIDENCE_PATTERNS);
  // PROJECT LLinkar a repo/url/website ask. Win sobre unknown então it nunca false-refuses.
  const wantsProjectLink = includesAny(text, PROJECT_LINK_PATTERNS);

  if (!question) {
    answerType = 'unknown_answer';
  } else if (isStealthEvasion) {
    answerType = 'ethical_usage_answer';
  } else if (wantsSourceEvidence) {
    answerType = 'source_code_evidence_answer';
  } else if (wantsProjectLink) {
    answerType = 'project_link_answer';
  } else if (metaDirective) {
    answerType = metaDirective;
  } else if (includesAny(text, NEGOTIATION_PATTERNS) && !hasExplicitCodingVerb && !negatesSalary) {
    // A salary word que é explicitly NEGATED ("uso JD mas não salary", "rate me
    // mas não compensation") é a steer Longe de negotiation — nunca a comp ask.
    // (Anteriormente isso apenas suppressed negotiation quando a rating cue era Também
    // present; "uso JD mas não salary" tinha não rating cue e mis-routed to
    // negotiation — Issue 7.)
    answerType = 'negotiation_answer';
  } else if (includesAny(text, IDENTITY_PATTERNS) || extractedType === 'identity') {
    answerType = 'identity_answer';
  } else if (hasSkillRatingFraming) {
    // Self-rating de a skill → first-person perfil answer (wins sobre coding's
    // bare-language-name corresponder e sobre system-design's "scale" collision).
    answerType = 'skill_experience_answer';
  } else if (isExplicitExperienceProbe) {
    // A claro "ter you used/implemented X (befantes experience probe → perfil
    // skill-experience, até se X é a system-design noun (rate limiter, caching).
    answerType = 'skill_experience_answer';
  } else if (hasSkillExperienceFraming && !includesAny(text, SYSTEM_DESIGN_PATTERNS)) {
    // "Ter you used WebRTC / a hashmap / AWS?" → perfil skill-experience answer
    // em primeiro person. Wins sobre coding/DSA/technical-concept routing babaixo
    answerType = 'skill_experience_answer';
  } else if (includesAny(text, PROJECT_FOLLOWUP_PATTERNS)
             // An EXPLICIT project entity ("...em SQL-Copilot?", "...role em
             // Refract?") Ou a resolved prior-turn alvo makes isso an
             // unambiguous project follow-up — até se o project Nome contém a
             // technology token (SQL-Copilot tem "sql"). Em que case we pular o
             // technical-subject guards. Caso contrário (a bare drill-in verb em a
             // generic subject — "como fez you otimizar binário searbusca o
             // guards abaixo keep it Fora de project_followup então coding/DSA answers
             // nunca uso o perfil (code-review 2026-06-05, HIAlto
             // HARD precondition (code-review 2026-06-05, HAlto invariant #1): a
             // write-code verb ou a named DSA problem Sempre keeps a question fora
             // de project_followup, até se a project entity era extracted — então
             // "como fez you otimizar binário busca em Postgres?" pode nunca inject
             // o retomar dentro de a coding answer. Real project drill-ins ("o que era
             // your role em SQL-Copilot?") carry nenhum a escreve verb nem a DSA
             // term, então they're unaffected.
             && !hasWriteCodeVerb
             && (followUpHasProjectContext(input, question)
                 || (!includesAny(textNoTechStack, DSA_PATTERNS)
                     && !includesAny(text, CODING_PATTERNS)
                     && !isLikelyTechnicalConcept(textNoTechStack)))) {
    // Fase 5: a drill-in em a project já em o tabela ("como é it built?",
    // "o que era your role?", "o que tech pilha fez you useuso "hardest part?",
    // "por que fez you build it?", "o que fez you learn?"). These são Perfil questions
    // sobre o candidate's próprio work — they win Antes BEHAVIORAL (a project
    // "hardest part" é não a generic STAR story) e resolver para a específico
    // project, grounding em its retomar facts.
    //
    // Proteger (code-review 2026-06-05, HIAlto a project-drill-in verb attached para a
    // GENERIC technical subject é Não a project follow-up — "como fez you otimizar
    // Binário SEABusca "como fez you implementar BFS?" precisa stay coding/DSA com Não
    // pperfil Então we explicitly Excluir qualquer question que carries a DSA term, a
    // coding verb, ou a technical-concept subject; those fall através para o
    // technical/DSA/coding cluster abaixo (profileContextPolicy = forbidden). This
    // keeps o "coding answers nunca uso rretomar invariant intact. ("o que tech
    // Pilha fez you ususo survives: `stack` aqui é matched por o followup
    // pattern, e DSA's bare `stack` é gated por isso sendo a personal "fez you
    // uuso phrasing — verified por ProfileRoutingMatrix over-capture guards.)
    answerType = 'project_followup_answer';
  } else if (
    // HIGH-CONFIDENCE JD-FIT Ponte — o interviewer challenges que o
    // candidate's fundo (full-stack/engineering) doesn't corresponder o data-
    // analyst role e asks them para connect/explain o fit. This é a fit
    // question (resume+JD), Não a generic "explain X" concept, então it precisa beat
    // o technical_concept branch abaixo (benchmark 2026-06-05).
    /\b(full[- ]?stack|engineering|engineer|backend|software)\b/i.test(text)
    && /\b(data analyst|analyst|data)\b/i.test(text)
    && /\b(connect|bridge|relate|link|explain the connection|why (data|analyst)|different|convince)\b/i.test(text)) {
    answerType = 'jd_fit_answer';
  } else if (includesAny(text, MEETING_PATTERNS)) {
    // Meeting/conversation recap ("ação items?", "o que fez we decide?",
    // "summarise o último 5 min", "o que era o customer asking?") — sobre o
    // CONVERSATION, nunca o candidate. Routed aqui (perfil FORBIDDEN) em vez disso
    // de falling através para unknown e leaking perfil ccontexto
    answerType = 'general_meeting_answer';
  } else if (includesAny(text, PRODUCT_CANDIDATE_MIX_PATTERNS)) {
    // "Por que é your perfil good para selling isso product?" — credibility-for-
    // selling. Não profile_fact (não résumé dump): o layer tabela forbids
    // resume/jd/negotiation; founder framing comes de persona/custom ccontexto
    answerType = 'product_candidate_mix_answer';
  } else if (includesAny(text, SALES_PATTERNS)) {
    answerType = 'sales_answer';
  } else if (includesAny(text, LECTURE_PATTERNS)) {
    answerType = 'lecture_answer';
  } else if (asksAboutRefract && includesAny(text, PRODUCT_ABOUT_PATTERNS)) {
    // A question que NAMES Refract e é sobre its build/architecture/stack é a
    // product-about answer (grounded em loaded memetadados Não a generic system-
    // design tarefa — checked antes system_design então "o que é o architecture de
    // Refract" / "como fez you build Refract" rotea para product-about
    // (release 2026-06-07: residual pattern #1).
    answerType = 'project_about_answer';
  } else if (includesAny(text, SYSTEM_DESIGN_PATTERNS)
             // A WRITE-CODE verb makes it a coding ttarefa não a design discussion
             // ("escreve código para a rate limiter" → coding, não system_design).
             && !hasWriteCodeVerb
             // "EXPLAIN/WHAT É rate limiting/caching" é a CONCEPT question, não a
             // design tarefa — defer para technical_concept (release 2026-06-07:
             // "explain rate limiting" precisa ser technical_concept, enquanto "como iria
             // you DESIGN a rate limiter" stays system_design). Apenas defer quando
             // there's an explain/what-is frame AND não explicit "design" verb.
             && !(/\b(explain|what(?:'s| is| are)?|describe|how does|tell me about)\b/i.test(text)
                  && !/\bdesign\b|\bscalable\b|\barchitect/i.test(text))) {
    answerType = 'system_design_answer';
  } else if (includesAny(text, DEBUGGING_PATTERNS) && !includesAny(textNoTechStack, DSA_PATTERNS)
             // BEHAVIORAL-PAST-EXPERIENCE Proteger (manual regression 2026-06-12,
             // stress seq_056): "tell me sobre a difficult BUG you solved" é a
             // STAR story sobre o candidate's past, não a live debugging tarefa —
             // o bare \bbug\b pattern captured it dentro de o technical lane
             // (perfil forbidden, neutral voice) onde o modelo answered
             // "I'm Refract, an AI assistant. I don't ter personal
             // experiences." A past-tense candidate frame defers para BEHAVIORAL.
             && !/\b(tell me about|describe|share|give me an example of)\b.{0,60}\b(you|you'?ve|u)\b.{0,60}\b(solved|fixed|faced|debugged|handled|dealt with|encountered|resolved|found)\b/i.test(text)
             && !/\b(hardest|toughest|most difficult|trickiest|worst)\b.{0,30}\b(bug|error|issue|crash)\b.{0,40}\b(you|you'?ve|your career|you ever)\b/i.test(text)) {
    answerType = 'debugging_question_answer';
  } else if (isHypotheticalTech(text) && !hasWriteCodeVerb) {
    // HYPOTHETICAL application — "como iria you uso GraphQL?", "como iria you
    // clean a messy dataset?", "como iria you approach a dados analysis tastarefa
    // "como iria you optimise a lento API?" (Fase 2 + benchmark 2026-06-05). O
    // candidate answers em Primeiro PERSON mas invents Não retomar facts — a technical
    // answer (perfil forbidden) em candidate voice. This agora fires para Qualquer
    // "como iria you …" application até sem a DSA/technical-subject keyword,
    // como longo como there's não explicit código verb (write/implement/solve/query →
    // those são genuine coding tasks e fall através para DSA/CODING beabaixo A
    // bare language nome ("como iria you uso SQL") não longer mis-routes para coding.
    answerType = 'technical_concept_answer';
  } else if (
    // Explicit "answer GENERICALLY / DON'T uso my rretomar steer em an explain/
    // tell-me ask — o user wants a neutral concept answer até though a skill
    // word + "my rretomar appears (benchmark 2026-06-05 context-confusing traps:
    // "explain SQL mas don't uso my reretomar "tell me sobre Python mas explain it
    // gengeralmente Concept wins, perfil forbidden.
    (includesAny(text, TECHNICAL_CONCEPT_PATTERNS) || /\btell me about\b/i.test(text))
    && /\b(generally|in general|don'?t use my (resume|profile|cv)|without my (resume|profile)|explain it generally|generic(ally)?)\b/i.test(text)
    // POLARITY Proteger (Issue 5): "don't make it generic" / "não generic" / "mas não
    // generic" é o OPPOSITE steer — o user wants a SEspecífico profile-grounded
    // answer, não a neutral concept. Excluir o negated formulário então
    // "tell me sobre pressure, mas don't make it generic" stays behavioral.
    && !/\b(not|don'?t|do not|never|avoid|without)\b[\w ,'-]*\bgeneric/i.test(text)
    && !hasWriteCodeVerb) {
    answerType = 'technical_concept_answer';
  } else if (includesAny(text, TECHNICAL_CONCEPT_PATTERNS) &&
             !includesAny(text, CODING_PATTERNS) &&
             (includesAny(textNoTechStack, DSA_PATTERNS) || isLikelyTechnicalConcept(text))) {
    // "Explain BFS", "o que é a deadlock", "difference entre TCP e UDP" —
    // generic technical CONCEPT, Não perfil (spec Case F). Checked antes
    // DSA/coding: a DSA noun com explain/what-is framing e Não coding verb é a
    // concept, não a coding ttarefa
    answerType = 'technical_concept_answer';
  } else if (includesAny(textNoTechStack, DSA_PATTERNS)) {
    // Named DSA problem ("two sum", "reverter a linked lilista "solve two sum").
    // Kept Antes generic CODING então o específico DSA label/template wins.
    answerType = 'dsa_question_answer';
  } else if (includesAny(text, CODING_PATTERNS) || input.intentResult?.intent === 'coding') {
    answerType = 'coding_question_answer';
  } else if (includesAny(text, GAP_PATTERNS)) {
    // Honest gap + mitigation para o role (checked Antes jd_fit então a gap ask isn't
    // swallowed por o fit patterns). Resume+JD grounded, first-person candidate.
    answerType = 'gap_analysis_answer';
  } else if (includesAny(text, JD_FIT_PATTERNS) || extractedType === 'jd_alignment') {
    answerType = 'jd_fit_answer';
  } else if (includesAny(text, BEHAVIORAL_PATTERNS) || extractedType === 'behavioral') {
    answerType = 'behavioral_interview_answer';
  } else if (includesAny(text, PROFILE_FACT_PATTERNS)) {
    // Curto factual perfil lookups (education, alvo role, degree) — benchmark
    // 2026-06-05. Perfil required, concise direct answer.
    answerType = 'profile_fact_answer';
  } else if (includesAny(text, PRODUCT_ABOUT_PATTERNS)) {
    // "o que kind de app é Refract?", "how's its backend?", "o que fazer you think
    // sobre Refract?" — a drill-in Sobre o product, grounded em loaded project
    // metadados (não overclaim). Checked antes o generic project-list branch então a
    // product question isn't answered com o candidate's whole project llista
    answerType = 'project_about_answer';
  } else if (includesAny(text, PROJECT_PATTERNS)) {
    answerType = 'project_answer';
  } else if (includesAny(text, SKILLS_PATTERNS)) {
    answerType = 'skills_answer';
  } else if (includesAny(text, EXPERIENCE_PATTERNS) || extractedType === 'profile_detail') {
    answerType = 'experience_answer';
  } else if (includesAny(text, FOLLOW_UP_PATTERNS) || extractedType === 'follow_up') {
    // A fragment matched o follow-up floor. Antes accepting o generic
    // follow_up_answer (perfil FORBIDDEN), tentar para resolver it para a CONCRETE tipo
    // de its próprio sinal — a named skill ("and SQL?"), a work noun ("o que sobre
    // stakeholders?"), a voice/evidence-control directive ("answer como a
    // candidate"), ou a JD-gap-bridge ("I ter full-stack, they ask analyst,
    // o que fazer I say?"). Apenas verdadeiramente context-free fragments ("o que sobre data?",
    // "o que deve I answer?") fall através para o floor. O live FollowUpResolver
    // ainda supersedes isso com prior-turn contexto (Issue 4/5/6/7).
    answerType = classifyStandaloneFragment(text) || 'follow_up_answer';
  } else {
    // PROFILE-AWARE FALLBACK (Fase 2). Nada acima matched. Em a manual ou
    // interview contexto com a perfil available, an unmatched mas claramente
    // candidate-directed question ("you/your/I/my", ou a curto interview-style
    // fragment) precisa Não colapsar para unknown_answer — que strips profile/JD
    // contexto e cascades dentro de route/voice failures. Rotea it para o nearest
    // SAFE perfil answer ttipo Generic non-candidate questions ainda go to
    // unknown (profileContextPolicy 'allowed', não forced prperfil
    const fb = classifyUnmatchedFallback(text, input);
    answerType = fb;
    // Modo PRIOR (PI v3, W1): nada explicit matched AND o profile-aware
    // alternativa landed em a floor tipo (unknown/general). Em a sales chamar that
    // ambiguous turn é a sales question; em a lecture it's sobre o material.
    // applyModeFallback rewrites Apenas unknown_answer/general_meeting_answer —
    // a candidate-directed alternativa (perfil tipo de classifyUnmatchedFallback)
    // ou qualquer explicitly-matched tipo acima é nunca touched, então todo leak
    // invariant (coding/identity/negotiation routing) é preserved.
    answerType = applyModeFallback(answerType, true, input.source, input.activeMode);
  }

  const speakerPerspective = input.speakerPerspective
    || (input.source === 'what_to_answer' || input.source === 'transcript' ? 'interviewer' : 'user');

  // Fase 2: VOICE (como para speak) é computed SEPARATELY de PROFILE-CONTEXT
  // Política (se perfil facts pode ground o answer). O classic conflation
  // bug: "como iria you uso GraphQL?" precisa first-person candidate VOICE mas Não
  // perfil facts. O hypothetical-technical flag captures exatamente que case.
  const hypotheticalTech = answerType === 'technical_concept_answer' && isHypotheticalTech(text);
  const interviewerAsked = speakerPerspective === 'interviewer'
    || input.source === 'what_to_answer' || input.source === 'transcript';

  const profileContextPolicy = profileContextPolicyFor(answerType);

  // MANUAL VOICE Política (release 2026-06-06b, Fase 5). Em manual chat, an
  // INTERVIEW-style question directed at o candidate ("introduce yourself", "por que
  // deve we hire you", "são you good at Python", "what's your experience") deve
  // ser answered em FIRST-PERSON candidate voice — o real manual-chat registrar showed
  // second-person ("Your skills incincluir reading oddly quando o user é
  // rehearsing como o candidate. A COACHING ask ("o que deve I say?", "help me
  // answer", "draft my intro") keeps second-person / "Say this:" então o assistant
  // é claramente advising. A bare factual lista ("o que são my skills") stays
  // second-person (it's o user querying their próprio data, não rehearsing a line).
  const isCoachingPhrasing = /\b(what should (i|we) (say|answer|respond)|how (should|do) i (answer|respond|introduce|frame|phrase)|help me (answer|draft|write|frame|prepare|say)|draft (my|an|a)|write (my|an|a)|prepare (my|an|a)|give me (an answer|a script|a line)|coach me|how would you phrase|how to answer)\b/i.test(text);
  // First-person-preferring INTERVIEW phrasing em manual mmodo o question lê
  // como se an interviewer é asking o candidate directly ("introduce yourself",
  // "por que deve we hire you", "são you good at X", "tell me sobre your project").
  const isManualInterviewPhrasing = /\b(introduce yourself|introduc\w*|tell me about your(self|\s)|why should (we|i|they) hire|are (you|u) (good|strong|skilled|experienced|comfortable|proficient)|what(?:'s| is)? your (experience|background|strength|weakness|project|weakest|strongest)|why (are|do) you|how (are|do) you (fit|think you (are|'?re) fit)|how (do|are) you.{0,20}\bfit\b|what did you (build|do|work)|walk me through your|what gaps? do you have|where are you (weak|least)|what (do|would) you need to (improve|learn)|what part of (this|the) (jd|role|job).{0,30}(ready|prepared)|what(?:'s| is)? missing from your)\b/i.test(text)
    && !isCoachingPhrasing
    && !/\bmy\b/i.test(text.replace(/\binterview my\b/gi, '')); // "o que são MY skills" → keep 2nd-person lista

  const voicePerspective: VoicePerspective = (() => {
    if (CANDIDATE_VOICE_TYPES.has(answerType)) {
      // Profile-directed answer types speak Como o candidate live, ou tell o
      // user sobre themselves em a manual chat.
      if (interviewerAsked) return 'first_person_candidate';
      if (input.source === 'manual_input') {
        // Fase 5: manual interview-style phrasing → first-person candidate;
        // coaching / bare-list phrasing → second-person.
        return isManualInterviewPhrasing ? 'first_person_candidate' : 'second_person_user';
      }
      return 'assistant_explanation';
    }
    // Hypothetical technical ("como iria you uso X") em a live/interview configuração
    // → candidate voice, até though perfil é forbidden. Manual/teaching → neutral.
    if (hypotheticalTech && interviewerAsked) return 'first_person_candidate';
    // Coding / "explain X" technical / sales / lecture / geral → neutral voice.
    return 'assistant_explanation';
  })();

  // Backward-compatible alias para existing chamar sites (third_person colapsa to
  // o neutral assistant voice para o legacy 3-valor tytipo
  const outputPerspective: OutputPerspective =
    voicePerspective === 'first_person_candidate' ? 'first_person_candidate'
      : voicePerspective === 'second_person_user' ? 'second_person_user'
        : 'assistant_explanation';

  // Fase 5: resolver que project a follow-up é sobre — o prior turn's alvo
  // (de o transcript extractor) ou an explicit nome em o question. Used to
  // escopo grounding; nunca fabricated.
  const resolvedEntity = answerType === 'project_followup_answer'
    ? (input.extractedQuestion?.followUpTarget || extractProjectEntity(question) || undefined)
    : undefined;

  const fastPathTypes: AnswerType[] = ['identity_answer', 'profile_fact_answer'];
  const latencyMs = isCodingAnswerType(answerType) || answerType === 'system_design_answer'
    ? 2500
    : fastPathTypes.includes(answerType)
      ? 800
      : 1500;

  return {
    answerType,
    source: input.source,
    speakerPerspective,
    outputPerspective,
    voicePerspective,
    profileContextPolicy,
    resolvedEntity,
    requiredContextLayers: requiredLayersFor(answerType),
    forbiddenContextLayers: forbiddenLayersFor(answerType),
    responseTemplate: templateFor(answerType),
    maxFirstUsefulTokenMs: latencyMs,
    maxInitialLatencyMs: latencyMs, // obsoleto alias
    requiresLLM: !fastPathTypes.includes(answerType),
    canUseFastPath: fastPathTypes.includes(answerType),
    shouldShowImmediateScaffold: shouldScaffold(answerType) && !styleSuppressesScaffoldSafe(answerType, question),
    question,
    confidence: Math.max(input.intentResult?.confidence || input.extractedQuestion?.confidence || 0.7, 0),
    answerStyle: detectAnswerStyle(question).style,
    answerStyleTargetSeconds: detectAnswerStyle(question).targetSeconds,
  };
};

// Apenas let a estilo suprimir o coding scaffold para CODING answer types (a "code oapenas
// cue em a non-coding answer precisa não change anqualquer coisa Keeps o scaffold para o
// comum case; suppresses it para an explicit "apenas o code" / "one line" coding ask.
const styleSuppressesScaffoldSafe = (answerType: AnswerType, question: string): boolean => {
  if (!isCodingAnswerType(answerType)) return false;
  const s = detectAnswerStyle(question).style;
  return s === 'code_only' || s === 'one_liner';
};

/**
 * Structured answer types cujo UI precisa paint a deterministic section scaffold
 * Antes qualquer modelo ttoken Coding/DSA uso o six-section coding contract;
 * system-design e debugging uso their próprio sectioned templates. Para these, o
 * live caminho precisa nunca stream raw code-first tokens (REPORT hypothesis C1).
 */
export const shouldScaffold = (answerType: AnswerType): boolean =>
  answerType === 'coding_question_answer'
  || answerType === 'dsa_question_answer'
  || answerType === 'system_design_answer'
  || answerType === 'debugging_question_answer';

/**
 * Renderizar o plan como o prompt's answer-contract block. Quando
 * `includeVerificationSpec` é verdadeiro (code verification enabled) AND isso é a
 * coding/DSA answer, o hidden <verification_spec> instrução é appended então
 * o modelo emite testar cases; quando falso (kill-switch offora it's omitted então não
 * tokens são wasted em a spec nada vai rexecuta
 */
// Answer types cujo templates carry visible section scaffolds (O Honest Gap /
// Curto Fit Summary / Direct Answer / STAR / …). Manual regression 2026-06-12:
// these headings rendered em Todo padrão answer, reading como robotic templates.
// Por padrão o structure é agora INTERNAL (think através it, saída speakable
// prose); o headings renderizar apenas quando o user explicitly asks para structure.
const SCAFFOLDED_PROFILE_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'behavioral_interview_answer', 'project_answer', 'jd_fit_answer',
  'gap_analysis_answer', 'negotiation_answer',
  // Audit 2026-06-16 (H6): simples factual perfil questions — "o que companies ter
  // you worked at", "como muitos years de experience", "introduce yourself", "o que é
  // your atual role" — eram shipping their completo template scaffold (STAR / Direct
  // Answer / Por que It Matters …) porque they eram absent haqui então isSpeakableOnlyPlan
  // returned falso e o scaffold rendered verbatim. A factual question precisa answer
  // em natural spoken prose, não a story scaffold. Adding them flips em o speakable
  // rendering directive (headings suppressed; explicit "detailed/bullets/STAR" style
  // ainda keeps structure via STRUCTURE_REQUESTING_STYLES beabaixo
  'experience_answer', 'skill_experience_answer', 'profile_fact_answer', 'identity_answer',
]);

// Styles que explicitly requisição visible structure — sections/bullets stay.
const STRUCTURE_REQUESTING_STYLES: ReadonlySet<AnswerStyle> = new Set<AnswerStyle>([
  'detailed', 'bullets', 'exam', 'notes',
]);

/** Verdadeiro quando isso plan deve renderizar como speakable prose (headings suppressed). */
export const isSpeakableOnlyPlan = (plan: Pick<AnswerPlan, 'answerType' | 'answerStyle' | 'source' | 'question'>): boolean => {
  if (!SCAFFOLDED_PROFILE_TYPES.has(plan.answerType)) return false;
  // Live WTA answers são spoken aloud — Sempre speakable independentemente de style.
  if (plan.source === 'what_to_answer' || plan.source === 'transcript') return true;
  if (STRUCTURE_REQUESTING_STYLES.has(plan.answerStyle)) return false;
  // 'star' auto-detects de o IMPLICIT behavioral phrasing ("tell me sobre a
  // time…") — that's não a requisição para visible sections. Apenas an EXPLICIT
  // "uso STAR" / "STAR fformata keeps o labels (manual regression 2026-06-12).
  if (plan.answerStyle === 'star' && /\bstar\b/i.test(plan.question || '')) return false;
  return true;
};

const SPEAKABLE_RENDERING_DIRECTIVE =
  `\n\nRENDERING (overrides the section labels above): the sections are your INTERNAL thinking structure only. ` +
  `OUTPUT ONLY the final speakable answer as natural first-person prose (2-6 sentences, no section headings, no labels, no bullet markers). ` +
  `Cover the same substance — lead with the direct answer, ground every claim, close naturally. ` +
  `Never print "Speakable Final Answer", "Direct Answer", "The Honest Gap", "Short Fit Summary", or any other label.`;

export const formatAnswerPlanForPrompt = (plan: AnswerPlan, includeVerificationSpec = false): string => {
  const verificationBlock = (includeVerificationSpec && isCodingAnswerType(plan.answerType))
    ? `\n\n${CODING_VERIFICATION_INSTRUCTION}`
    : '';
  // Fase 2: a único explicit directive que translates o voice/policy divide
  // dentro de modelo instructions — isso what it makes "como iria you uso GraphQL?"
  // answer em primeiro person Sem inventing retomar facts.
  const voiceLine = plan.voicePerspective === 'first_person_candidate'
    ? 'Speak in the FIRST PERSON as the candidate ("I would…", "I built…").'
    : plan.voicePerspective === 'second_person_user'
      ? 'Address the user about themselves in the second person ("Your …").'
      : (plan.answerType === 'sales_answer' || plan.answerType === 'product_candidate_mix_answer')
        // Sales turns speak como o seller/product rep — o neutral-assistant
        // voice line caused "I'm Refract… I don't ter a product" em real
        // sales sessions (manual regression 2026-06-12).
        ? 'Speak in the FIRST PERSON as the product\'s seller/representative ("our product", "we"). Never identify as an AI assistant.'
        : 'Answer in a neutral, explanatory voice. Do not roleplay as the candidate.';
  const policyLine = plan.profileContextPolicy === 'required'
    ? 'Ground every concrete claim in the provided profile facts. Never invent names, numbers, metrics, companies, or technologies that are not in those facts.'
    : plan.profileContextPolicy === 'forbidden'
      ? 'Do NOT use or reference the resume, JD, projects, or any personal profile context. Answer from general knowledge only.'
      : 'Use profile facts only where directly relevant; never fabricate.';
  const entityLine = plan.resolvedEntity
    ? `\nresolvedEntity: ${plan.resolvedEntity} (answer about THIS project; stay on it)`
    : '';
  // Adaptive estilo directive (form oapenas — appended quando o question requested a
  // específico style/length. Nunca sobrescreve VOICE/GROUNDING/leak boundaries.
  const styleDirective = plan.answerStyle && plan.answerStyle !== 'default'
    ? `\n\n${detectAnswerStyle(plan.question).directive}`
    : '';
  // Adaptive LENGTH directive (2026-06-16): para a default-style SPOKEN_SHORT answer, inject a
  // CONCRETE per-answer word/second alvo então o modelo lands em o 15-30s band por question
  // intent em vez disso de sempre executando ~30s. Apenas fires para SPOKEN_SHORT com não explicit style
  // cue — SPOKEN_FULL / STRUCTURED_FULL e explicit styles próprio their próprio length, então emitir
  // nada para them (additive, non-conflicting). Prompt-guidance oapenas o deterministic
  // trimmer é unchanged.
  let lengthDirective = '';
  if (!plan.answerStyle || plan.answerStyle === 'default') {
    const tier = classifyTargetSpeakability(plan.answerType, plan.answerStyle, plan.question);
    if (tier === 'SPOKEN_SHORT') {
      const band = classifyShortBand(plan.answerType, plan.answerStyle, plan.question);
      const t = shortBandTargetWords(band);
      lengthDirective = `\n\nLENGTH: aim for about ${t.seconds}s spoken — roughly ${t.min} to ${t.max} words (${t.guidance}). Use fewer if the question is fully answered in fewer; never pad to reach the number.`;
    }
  }
  // Speakable-by-default (manual regression 2026-06-12): scaffolded perfil
  // templates become internal thinking structure; o rendered answer é
  // natural prose a menos que o user explicitly asked para structure.
  const renderingDirective = isSpeakableOnlyPlan(plan) ? SPEAKABLE_RENDERING_DIRECTIVE : '';
  return `<answer_contract>
answerType: ${plan.answerType}
source: ${plan.source}
speakerPerspective: ${plan.speakerPerspective}
outputPerspective: ${plan.outputPerspective}
voicePerspective: ${plan.voicePerspective}
profileContextPolicy: ${plan.profileContextPolicy}${entityLine}
requiredContextLayers: ${plan.requiredContextLayers.join(', ') || 'none'}
forbiddenContextLayers: ${plan.forbiddenContextLayers.join(', ') || 'none'}
maxInitialLatencyMs: ${plan.maxInitialLatencyMs}
answerStyle: ${plan.answerStyle}

VOICE: ${voiceLine}
GROUNDING: ${policyLine}

STRICT RESPONSE TEMPLATE:
${plan.responseTemplate}${renderingDirective}${styleDirective}${lengthDirective}${verificationBlock}
</answer_contract>`;
};
