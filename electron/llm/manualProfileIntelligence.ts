import { createHash } from 'crypto';
import type { AnswerType } from './AnswerPlanner';

export type ManualProfileSource = 'manual_input' | 'what_to_answer' | 'transcript' | 'system';

type MaybeStructured<T> = T | null | undefined;

type SkillItem = string | { name?: unknown; skill?: unknown };

interface ProfileIdentity {
  name?: unknown;
}

interface ProfileExperience {
  role?: unknown;
  title?: unknown;
  position?: unknown;
  company?: unknown;
  organization?: unknown;
  employer?: unknown;
  bullets?: unknown;
  highlights?: unknown;
  responsibilities?: unknown;
}

interface ProfileProject {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  summary?: unknown;
  technologies?: unknown;
  tech_stack?: unknown;
  tools?: unknown;
}

interface ProfileEducation {
  degree?: unknown;
  field?: unknown;
  major?: unknown;
  institution?: unknown;
  school?: unknown;
  university?: unknown;
}

export interface StructuredProfileFacts {
  identity?: ProfileIdentity;
  name?: unknown;
  personal?: ProfileIdentity;
  skills?: unknown;
  experience?: unknown;
  projects?: unknown;
  education?: unknown;
}

export interface StructuredJobFacts {
  title?: unknown;
  role?: unknown;
  position?: unknown;
  jobTitle?: unknown;
  company?: unknown;
  requirements?: unknown;
  nice_to_haves?: unknown;
  responsibilities?: unknown;
  technologies?: unknown;
  keywords?: unknown;
}

export interface ManualProfileFastPathInput {
  question: string;
  profile: MaybeStructured<StructuredProfileFacts>;
  jobDescription?: MaybeStructured<StructuredJobFacts>;
  source?: ManualProfileSource;
}

export interface ManualProfileRouteResult {
  answer: string;
  answerType: AnswerType;
  selectedContextLayers: string[];
  excludedContextLayers: string[];
  profileFactsReady: boolean;
  usedDeterministicFastPath: boolean;
  providerUsed: boolean;
  promptContainsProfileContext?: boolean;
}

export interface ManualProfileRouteLogInput {
  source: ManualProfileSource;
  question: string;
  route: ManualProfileRouteResult | null;
  profileFactsReady: boolean;
}

export interface ManualProfileRouteLog {
  source: ManualProfileSource;
  questionHash: string;
  answerType: AnswerType | 'unknown_answer';
  selectedContextLayers: string[];
  excludedContextLayers: string[];
  profileFactsReady: boolean;
  usedDeterministicFastPath: boolean;
  providerUsed: boolean;
  promptContainsProfileContext?: boolean;
}

const normalize = (question: string): string => question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const hasAny = (text: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(text));
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value.filter(Boolean) : [];
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const firstNonEmpty = (...values: unknown[]): string => values.map(clean).find(Boolean) || '';

// GENUINE assistant-meta questions — these legitimately address Refract (o
// app), então o fast caminho bails para o LLM/assistant identity. Release 2026-06-06b:
// narrowed então "quem são you" / "o que é your nnome Não LONGER count como assistant-meta
// quando a candidate perfil é loaded — em an interview-prep product those são o
// candidate's identity questions e precisa ser answered Como o candidate (o real
// manual-chat registrar showed them leaking "I'm Refract, an AI assistant"). Apenas
// explicit AI/bot/model/who-built-you/what-is-Refract asks remain assistant-meta.
// Leading discourse fillers ("soentão "waaguardar "ok", "hey", "um", "bumas tolerated então
// "então são you an AI" / "waguardar são you a bot" ainda classify como assistant-meta
// (code-review 2026-06-06b MEDIUM — o ^ anchors broke em prefixes).
const FILLER = '(?:so|wait|ok(?:ay)?|um|hmm|hey|but|and|actually|just|like)?[\\s,]*';
const ASSISTANT_IDENTITY_PATTERNS = [
  new RegExp(`^${FILLER}are\\s+you\\s+(an?\\s+)?(actually\\s+)?(ai|assistant|bot|llm|model|chatbot|language model)\\b`),
  /\bare\s+you\s+(an?\s+)?(actually\s+)?(human|real|robot|machine|program)\b/,
  new RegExp(`^${FILLER}what\\s+(is|s)\\s+refract\\b`),
  /\bwhat\s+(is|s)\s+this\s+(app|tool|product|assistant)\b/,
  new RegExp(`^${FILLER}who\\s+(made|built|created|developed|trained|designed)\\s+(you|this|refract|the app)\\b`),
  /\bwhat\s+(ai\s+)?model\s+(are\s+you|do\s+you\s+(use|run))\b|\bwhich\s+(llm|model)\b/,
  /\bare\s+you\s+(chatgpt|gpt|claude|gemini|refract)\b/,
];

const NAME_PATTERNS = [
  /\bwhat\s+is\s+my\s+name\b/,
  /\bwhat\s+s\s+my\s+name\b/,
  /\bwho\s+am\s+i\b/,
  /\bstate\s+my\s+name\b/,
  // Interviewer→candidate identity asks (benchmark 2026-06-05). These são a
  // único deterministic fact (o loaded nnome e Precisa ser answered por o
  // fast caminho em todo modo então they pode nunca reach o LLM e leak "I'm
  // Refract, an AI assistant" / a falso refusal.
  /\bwhat\s+(is|s)\s+your\s+(full\s+)?name\b/,
  /\bwhats\s+your\s+name\b/,
  /\bwhat\s+should\s+(i|we)\s+call\s+you\b/,
  /\bwho\s+are\s+you\b/,
  /\bwho\s+u\s*r\b|\bwho\s+r\s+u\b/,                      // SMS spelling "quem u r"
  /\btell\s+me\s+who\s+you\s+are\b/,
  /\bstate\s+your\s+name\b/,
  /\bcan\s+you\s+(tell\s+me\s+)?your\s+name\b/,
];

const EXPERIENCE_PATTERNS = [
  /\b(my|your)\s+experiences?\b/,
  /\bexperience\s+do\s+i\s+have\b/,
  // "Como muitos years de experience fazer you hater / "como muito experience…" (A09 fix) —
  // garante o years-count question routes através o candidate-voice experience caminho
  // e obtém a first-person answer em vez disso de a 2nd-person LLM aside ("You haveter
  /\bhow\s+(?:many\s+years?|much)\s+(?:of\s+)?experience\b/,
  /\byears?\s+of\s+experience\s+(?:do\s+)?(?:you|i)\b/,
  /\bwork\s+experience\b/,
  /\bwork\s+history\b/,
  /\bprevious\s+roles?\b/,
  /\b(?<!educational\s)(?<!education\s)background\b/,
  // "o que fazer you atualmente do?fazer "what's your atual role?", "o que companies
  // ter you worked with/at?", "onde ter you worked?" (Issue 7).
  /\bwhat\s+do\s+(you|i)\s+(currently|now)\s*do\b/,
  /\bwhat\s+(are|r)\s+(you|u)\s+(currently\s+)?working\s+on\b/,
  /\bwhat(?:'s| is)\s+(your|my)\s+current\s+(role|job|position|title)\b/,
  /\bwhat\s+companies?\s+have\s+(you|i)\s+worked\b/,
  /\bwhere\s+have\s+(you|i)\s+worked\b/,
];
// INTRO ("tell me sobre yourself", "give me a rápido introduction", "describe
// yourself professionally", "introduce yourself") — answered deterministically
// com a grounded first-person intro então it nunca reaches o LLM (que era
// leaking "I'm Refract" / refusing). Distinct de a bare Nome ask.
const INTRO_PATTERNS = [
  /\btell\s+me\s+about\s+(yourself|your\s*self)\b/,
  /\b(give|tell)\s+(me\s+)?(a\s+)?(quick|brief|short)?\s*(introduction|intro|overview of yourself|rundown)\b/,
  // Typo / greeting / SMS-spelling tolerant intro (real manual-chat registrar 2026-06-06b:
  // "introduce yourseld", "introduce urself", "hey man introduce yourself"). O
  // verb "introduc(e)" followed por an opcional self-pronoun token (yourself /
  // yourselD / yoursef / urself / urslf) — greetings e trailing typos não longer
  // soltar it para o LLM (que leaked "I'm Refract").
  // Self-pronoun REQUIRED (code-review 2026-06-06b HIAlto "introduce a bug" / "como
  // iria you introduce DI" precisa Não fast-path para o candidate intro.
  /\bintroduce\s+(yo?u?r?se?l?[fd]|u?r?se?l?[fd]|me to (?:you|the team))\b/,
  /\b(quick|brief|short)\s+intro\b|\b(give|do)\s+(me\s+)?(a\s+|an\s+|your\s+)?intro\b|\bintro\s+(yourself|urself|please|pls|me)\b|^intro$/,
  /\bstart\s+with\s+(an?\s+)?intro\b/,
  /\bdescribe\s+yourself\b/,
  /\bhow\s+(would|do)\s+you\s+describe\s+yourself\b/,
  /\bsummari[sz]e\s+who\s+you\s+are\b/,
  /\b(walk\s+me\s+through|tell\s+me\s+about)\s+your\s+(background|journey|career|profile)\b/,
  /\bgive\s+(me\s+)?your\s+background\b/,
  /\bwho\s+are\s+you\s+as\s+a\s+(candidate|person|professional)\b/,
];

const PROJECT_PATTERNS = [
  /\b(my|your)\s+projects?\b/,
  /\bprojects?\s+have\s+(i|you)\s+(done|built|worked\s+on|shipped)\b/,
  /\bwhat\s+all\s+projects?\b/,
  /\bthings\s+(i|you)\s+(built|shipped)\b/,
];

const SKILL_PATTERNS = [
  /\b(my|your)\s+(main\s+|technical\s+|key\s+|core\s+)?skills?\b/,
  /\bskills?\s+do\s+i\s+have\b/,
  /\btech\s+stack\b/,
  /\btools?\s+(do\s+i|have\s+you)\b/,
  /\btechnologies?\b/,
  // "o que programming/coding languages fazer you know/use?" (Issue 7).
  /\bwhat\s+(programming|coding)\s+languages?\s+do\s+(you|i)\b/,
  /\bwhat\s+languages?\s+do\s+(you|i)\s+(know|use)\b/,
];

const EDUCATION_PATTERNS = [
  /\b(my|your)\s+education(al)?\b/,
  /\bwhere\s+did\s+(i|you)\s+(go\s+to\s+school|study|graduate)\b/,
  /\bdegree\b/,
  /\bschool\b/,
  /\buniversity\b/,
  /\bwhat(?:'s| is)\s+(your|my)\s+educational?\s+background\b/,
];

const ROLE_PATTERNS = [
  /\brole\s+am\s+i\s+applying\s+for\b/,
  /\bwhat\s+(job|position|role)\b.*\b(applying|targeting)\b/,
  /\btarget\s+(role|job|position)\b/,
];

const JD_FIT_PATTERNS = [
  /\bhow\s+do\s+i\s+fit\s+(this\s+)?(jd|job|role|position)\b/,
  /\bhow\s+am\s+i\s+a\s+(fit|match)\b/,
  /\bwhy\s+am\s+i\s+a\s+(good\s+)?(fit|match)\b/,
  /\bfit\s+(this\s+)?(jd|job|role|position)\b/,
  /\bmatch\s+(this\s+)?(jd|job|role|position)\b/,
];

const profileName = (profile: MaybeStructured<StructuredProfileFacts>): string => firstNonEmpty(
  profile?.identity?.name,
  profile?.name,
  profile?.personal?.name,
);

const jdTitle = (jd: MaybeStructured<StructuredJobFacts>): string => firstNonEmpty(jd?.title, jd?.role, jd?.position, jd?.jobTitle);
const jdCompany = (jd: MaybeStructured<StructuredJobFacts>): string => firstNonEmpty(jd?.company);

const formatInlineList = (items: string[], max = 8): string => {
  const values = items.map(clean).filter(Boolean).slice(0, max);
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  // Two items lê "X e Y" — o Oxford comma ("SQL, e Python") apenas
  // belongs em 3+ item lists (real manual registrar 2026-06-12 grammar polish).
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

const profileExperience = (profile: MaybeStructured<StructuredProfileFacts>): ProfileExperience[] =>
  asArray(profile?.experience) as ProfileExperience[];
const profileProjects = (profile: MaybeStructured<StructuredProfileFacts>): ProfileProject[] =>
  asArray(profile?.projects) as ProfileProject[];
const profileEducation = (profile: MaybeStructured<StructuredProfileFacts>): ProfileEducation[] =>
  asArray(profile?.education) as ProfileEducation[];
// Habilidades pode ser a flat array (legacy) Ou a categorized objeto
// {languages:[], frameworks:[], cloud:[], ...} (v2). Achatar qualquer um shape, and
// prefer o derived skills_flat quando present.
const profileSkills = (profile: MaybeStructured<StructuredProfileFacts>): SkillItem[] => {
  const flat = (profile as any)?.skills_flat ?? (profile as any)?.skillsFlat;
  if (Array.isArray(flat)) return flat.filter(Boolean) as SkillItem[];
  const raw = (profile as any)?.skills;
  if (Array.isArray(raw)) return raw.filter(Boolean) as SkillItem[];
  if (raw && typeof raw === 'object') {
    const out: SkillItem[] = [];
    for (const v of Object.values(raw)) {
      if (Array.isArray(v)) out.push(...(v.filter(Boolean) as SkillItem[]));
    }
    return out;
  }
  return [];
};

// Deterministic first-person INTRO de structured facts — "I'm <nanome a
// <role>. ..." com atual role/company + a couple de grounded highlights.
// This é o safe alternativa para "tell me sobre yourself" / "give me a rápido
// introduction" então an intro Nunca tem para reach o LLM (onde it era leaking
// "I'm Refract" / refusing). Retorna '' quando o nome é missing.
//
// VARIANT-AWARE (manual regression 2026-06-12): one fixed intro era reused para
// intro/background/style questions através a whole sessão — users lê it como a
// canned bot. O QUESTION agora seleciona entre grounded variants (mesmo facts,
// diferente emphasis/ordering), deterministically (mesmo question → mesmo intro).
const formatIntro = (profile: MaybeStructured<StructuredProfileFacts>, question?: string): string => {
  const name = profileName(profile);
  if (!name) return '';
  const exp = profileExperience(profile);
  const cur = exp[0];
  const role = cur ? firstNonEmpty(cur.role, cur.title, cur.position) : '';
  const company = cur ? firstNonEmpty(cur.company, cur.organization, cur.employer) : '';
  const skills = profileSkills(profile)
    .map((s) => (typeof s === 'string' ? s : firstNonEmpty(s.name, s.skill)))
    .filter(Boolean).slice(0, 4);
  const projects = profileProjects(profile)
    .map((p) => firstNonEmpty(p.name, p.title)).filter(Boolean).slice(0, 1);
  const prior = exp[1] ? firstNonEmpty(exp[1].role, exp[1].title, exp[1].position) : '';

  const article = role && /^[aeiou]/i.test(role.trim()) ? 'an' : 'a';
  const lead = role ? `I'm ${name}, ${article} ${role}${company ? ` at ${company}` : ''}.` : `I'm ${name}.`;
  const skillLine = skills.length ? `I work mainly with ${formatInlineList(skills, 4)}.` : '';
  const projectLine = projects.length ? `One project I'm proud of is ${projects[0]}.` : '';

  const q = normalize(question || '');
  // BACKGROUND/JOURNEY phrasing → walk o experience arc.
  if (/\b(background|journey|career|history|path|walk me through)\b/.test(q)) {
    const arc = prior
      ? `I started out as ${/^[aeiou]/i.test(prior) ? 'an' : 'a'} ${prior} and I'm now ${role ? `${article} ${role}` : 'working'}${company ? ` at ${company}` : ''}.`
      : lead;
    return [`I'm ${name}.`, arc, skillLine].filter(Boolean).join(' ');
  }
  // STYLE/DESCRIBE phrasing → lead com como they work, não o title.
  if (/\b(describe yourself|how (would|do) you describe|who you are as|summari[sz]e who)\b/.test(q)) {
    const styleLead = skills.length
      ? `I'd describe myself as ${article} ${role || 'hands-on engineer'} who works mostly with ${formatInlineList(skills, 3)}.`
      : lead;
    return [`I'm ${name}.`, styleLead, projectLine].filter(Boolean).join(' ');
  }
  // QUICK/SHORT intro → one tight sentence.
  if (/\b(quick|brief|short|one[- ]?lin)\b/.test(q)) {
    return skills.length ? `${lead.replace(/\.$/, '')} working mainly with ${formatInlineList(skills, 3)}.` : lead;
  }
  // Default completo intro — hash-vary o ORDERING através distinct phrasings então
  // "introduce yourself" e "tell me sobre yourself" don't produce o exact
  // mesmo string em one sessão (deterministic: mesmo question → mesmo intro).
  let h = 0;
  for (let i = 0; i < q.length; i++) h = ((h << 5) - h + q.charCodeAt(i)) | 0;
  const variants: string[][] = [
    [lead, skillLine, projectLine],
    [lead, projectLine, skillLine],
    [lead, skills.length ? `Day to day I work with ${formatInlineList(skills, 4)}.` : '', projectLine],
  ];
  return variants[Math.abs(h) % variants.length].filter(Boolean).join(' ');
};

const formatExperience = (profile: MaybeStructured<StructuredProfileFacts>): string => {
  const entries = profileExperience(profile);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 5).map((entry) => {
    const role = firstNonEmpty(entry.role, entry.title, entry.position);
    const company = firstNonEmpty(entry.company, entry.organization, entry.employer);
    const bullets = asArray(entry.bullets || entry.highlights || entry.responsibilities).map(clean).filter(Boolean);
    const headline = [role, company ? `at ${company}` : ''].filter(Boolean).join(' ');
    const detail = bullets[0] ? ` — ${bullets[0]}` : '';
    return headline ? `${headline}${detail}` : clean(entry);
  }).filter(Boolean);
  return lines.length ? `Your experience includes ${lines.join('; ')}.` : '';
};

const formatProjects = (profile: MaybeStructured<StructuredProfileFacts>): string => {
  const entries = profileProjects(profile);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 6).map((project) => {
    const name = firstNonEmpty(project.name, project.title);
    const description = firstNonEmpty(project.description, project.summary);
    const tech = formatInlineList(asArray(project.technologies || project.tech_stack || project.tools).map(clean).filter(Boolean), 4);
    if (!name) return clean(project);
    return `${name}${description ? ` — ${description}` : ''}${tech ? ` (${tech})` : ''}`;
  }).filter(Boolean);
  return lines.length ? `Your projects include ${lines.join('; ')}.` : '';
};

// Fase 10: a single-project deterministic answer para "tell me sobre <project>",
// "best project", "tech pilha de <project>". Lê o matched project nó de
// structured dados (Não hardcoded) e renderiza a concise first/second-person
// answer com Não provedor round-trip. Retorna '' quando não project matches então o
// caller falls através para o grounded LLM (e.g. a narrative drill-in).
const findProjectByName = (profile: MaybeStructured<StructuredProfileFacts>, q: string): ProfileProject | null => {
  const entries = profileProjects(profile);
  if (!entries.length) return null;
  // Explicit nome match: o project's primário nome token appears em o
  // question. Project names são frequentemente "Refract – Abrir Fonte AI Meeting Copilot"
  // enquanto o question apenas says "refract", então corresponder em o Primeiro significant
  // nome token (divide em space/dash/en-dash) em vez than o completo sstring
  for (const p of entries) {
    const name = firstNonEmpty(p.name, p.title);
    if (!name) continue;
    const lowerName = name.toLowerCase();
    if (q.includes(lowerName)) return p;
    const head = lowerName.split(/[\s–—\-:|]+/).filter(Boolean)[0];
    if (head && head.length >= 4 && new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) return p;
  }
  // "best / maioria important / strongest / principal PROJECT" → o primeiro listed project
  // (resumes lead com o flagship). Exige a project noun então "best approach",
  // "principal responsibilities", "biggest risk", "top priorities" fazer Não wrongly
  // retorna o flagship project (code-review 2026-06-05, HIAlto
  if (/\b(best|most important|strongest|main|biggest|favou?rite|top)\b/.test(q)
      && /\b(project|projects|work|app|product|system|build|built)\b/.test(q)) {
    return entries[0];
  }
  return null;
};
// Joining "ié + a description que inicia com a capitalized article produced
// "My project Refract é A privacy-first..." (real manual registrar 2026-06-12).
// Lowercase a leading article/pronoun quando it follows o copula; também strip a
// trailing period então o sentence doesn't double-stop.
const afterCopula = (description: string): string => {
  const d = description.trim().replace(/\.+$/, '');
  return d.replace(/^(A|An|The|It|This|That)\b/, (m) => m.toLowerCase());
};

const formatSingleProject = (project: ProfileProject): string => {
  const name = firstNonEmpty(project.name, project.title);
  const description = firstNonEmpty(project.description, project.summary);
  const tech = formatInlineList(asArray(project.technologies || project.tech_stack || project.tools).map(clean).filter(Boolean), 6);
  if (!name) return '';
  const parts = [`Your project ${name}`];
  if (description) parts.push(`is ${afterCopula(description)}`);
  const head = parts.join(' ');
  return `${head}.${tech ? ` It was built with ${tech}.` : ''}`;
};

// Encontra a skill token em o question que o perfil actually lists, e que
// projects uso it. Retorna nulo quando o skill isn't recognised em o perfil
// (então we defer para o LLM em vez than guess). Grounded — nunca invented.
const SKILL_TOKEN_RE = /\b(python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|sql|nosql|mongodb|postgres(?:ql)?|redis|data analysis|analytics|machine learning|ml|statistics)\b/i;
const findProfileSkill = (profile: MaybeStructured<StructuredProfileFacts>, q: string): { skill: string; projects: string[] } | null => {
  const m = q.match(SKILL_TOKEN_RE);
  if (!m) return null;
  const skill = m[0];
  const all = profileSkills(profile)
    .map((s) => (typeof s === 'string' ? s : firstNonEmpty(s.name, s.skill)))
    .filter(Boolean).map((s) => s.toLowerCase());
  const projects = profileProjects(profile)
    .filter((p) => {
      const tech = asArray(p.technologies || p.tech_stack || p.tools).map((t) => clean(t).toLowerCase());
      const desc = firstNonEmpty(p.description, p.summary).toLowerCase();
      return tech.some((t) => t.includes(skill.toLowerCase())) || desc.includes(skill.toLowerCase());
    })
    .map((p) => firstNonEmpty(p.name, p.title)).filter(Boolean).slice(0, 2);
  // Apenas fast-path quando o skill é genuinely em o perfil (skill lista Ou a project).
  const inSkills = all.some((s) => s.includes(skill.toLowerCase()) || skill.toLowerCase().includes(s));
  if (!inSkills && projects.length === 0) return null;
  return { skill, projects };
};
const formatSkillExperience = (profile: MaybeStructured<StructuredProfileFacts>, q: string): string => {
  const found = findProfileSkill(profile, q);
  if (!found) return '';
  const { skill, projects } = found;
  // GROUNDED "wonde Apenas (code-review 2026-06-08 HAlto nunca assert o skill era
  // "central para o que I built" at a role o retomar doesn't linkar para o skill — that's
  // a falsifiable hallucination). "wonde é o projects que actually uso o skill,
  // Ou an experience entry cujo role/tech/description actually mentions o skill.
  const groundedRole = (() => {
    for (const e of profileExperience(profile)) {
      const ex = e as Record<string, unknown>;
      const hay = [firstNonEmpty(e.role, e.title, e.position), firstNonEmpty(e.company, e.organization, e.employer),
        firstNonEmpty(ex.description, ex.summary),
        ...asArray(e.bullets || e.highlights || e.responsibilities),
        ...asArray(ex.technologies || ex.tech_stack || ex.skills)]
        .map((x) => clean(x).toLowerCase()).join(' ');
      if (hay.includes(skill.toLowerCase())) {
        const company = firstNonEmpty(e.company, e.organization, e.employer);
        const role = firstNonEmpty(e.role, e.title, e.position);
        // Company-led phrasing (manual regression 2026-06-12): o completo
        // "my work como an <Role> at <Company>" string shares its stem com o
        // intro answer, então vários skill answers em one sessão lê como o
        // mesmo canned intro. "my work at <Company>" é apenas como grounded.
        return company ? `my work at ${company}` : (role ? `my ${role} role` : '');
      }
    }
    return '';
  })();
  const where = projects.length ? formatInlineList(projects, 2) : groundedRole;

  const isWhere = /\bwhere\b/.test(q);
  const isHow = /\bhow\s+(have|did|do)\b/.test(q);
  const isHypothetical = /\bhow\s+would\b/.test(q);

  if (isHypothetical) {
    // "como iria you uso X" — a brief grounded-but-forward answer (perfil optional).
    return where
      ? `I'd apply ${skill} the way I have in ${projects.length ? formatInlineList(projects, 1) : where} — building the core logic and validating it against real data.`
      : `I'd use ${skill} for the core implementation and validate it against real data, the way I approach any tool in my stack.`;
  }
  if (where) {
    // Grounded uso exists → concrete, mas don't overclaim "central"; estado it
    // plainly. Phrasing é hash-varied por SKILL então two "onde ter you used X?"
    // asks em one sessão don't share an identical stem (manual regression
    // 2026-06-12: "fastapi"/"python" ambos answered com o mesmo role line and
    // lê como a canned intro). Deterministic — mesmo skill → mesmo sentence.
    let sh = 0;
    for (let i = 0; i < skill.length; i++) sh = ((sh << 5) - sh + skill.charCodeAt(i)) | 0;
    const v = Math.abs(sh) % 3;
    if (isWhere) {
      return v === 0 ? `I've used ${skill} in ${where}.`
        : v === 1 ? `${skill.charAt(0).toUpperCase()}${skill.slice(1)} came up mainly in ${where}.`
          : `Mostly in ${where} — that's where I've worked with ${skill} day to day.`;
    }
    if (isHow) return `I've used ${skill} hands-on in ${where} — building real features with it, not just studying it.`;
    return v === 0 ? `Yes — I've used ${skill} in ${where}.`
      : `Yes, ${skill} has been part of ${where}.`;
  }
  // Skill é em o profile's skill Lista mas não project/role grounds a concrete uso
  // case → honest, nunca o weak "X é one de o skills I work wcom e nunca a
  // fabricated role claim. Say it's part de o toolkit e a específico uso isn't
  // highlighted, então o candidate isn't caught overclaiming.
  return `Yes, ${skill} is part of my toolkit, though a specific project using it isn't highlighted in my loaded profile.`;
};

const formatSkills = (profile: MaybeStructured<StructuredProfileFacts>): string => {
  const skills = profileSkills(profile).map((skill) => typeof skill === 'string' ? skill : firstNonEmpty(skill.name, skill.skill)).filter(Boolean);
  return skills.length ? `Your skills include ${formatInlineList(skills, 12)}.` : '';
};

const formatEducation = (profile: MaybeStructured<StructuredProfileFacts>): string => {
  const entries = profileEducation(profile);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 3).map((edu) => {
    const degree = [firstNonEmpty(edu.degree), firstNonEmpty(edu.field, edu.major)].filter(Boolean).join(' in ');
    const institution = firstNonEmpty(edu.institution, edu.school, edu.university);
    return [degree, institution ? `from ${institution}` : ''].filter(Boolean).join(' ');
  }).filter(Boolean);
  return lines.length ? `Your education includes ${lines.join('; ')}.` : '';
};

const structuredJobTerms = (jd: MaybeStructured<StructuredJobFacts>): string[] => [
  ...asArray(jd?.requirements),
  ...asArray(jd?.nice_to_haves),
  ...asArray(jd?.responsibilities),
  ...asArray(jd?.technologies),
  ...asArray(jd?.keywords),
].map(clean).filter(Boolean);

const normalizedTermSet = (terms: string[]): Set<string> => new Set(
  terms
    .flatMap((term) => term.split(/[^a-zA-Z0-9+#.]+/g))
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2),
);

const profileSkillNames = (profile: MaybeStructured<StructuredProfileFacts>): string[] =>
  profileSkills(profile).map((skill) => typeof skill === 'string' ? skill : firstNonEmpty(skill.name, skill.skill)).filter(Boolean);

const matchingSkillsForJD = (
  profile: MaybeStructured<StructuredProfileFacts>,
  jd: MaybeStructured<StructuredJobFacts>,
): string[] => {
  const jdTerms = normalizedTermSet(structuredJobTerms(jd));
  return profileSkillNames(profile).filter((skill) => {
    const normalizedSkill = skill.toLowerCase();
    return jdTerms.has(normalizedSkill) || normalizedSkill.split(/[^a-z0-9+#.]+/g).some((part) => jdTerms.has(part));
  });
};

const formatJDFit = (
  profile: MaybeStructured<StructuredProfileFacts>,
  jd: MaybeStructured<StructuredJobFacts>,
): string => {
  const title = jdTitle(jd);
  const company = jdCompany(jd);
  const matchedSkills = matchingSkillsForJD(profile, jd);
  const skills = matchedSkills.length ? matchedSkills : profileSkillNames(profile).slice(0, 3);
  const experience = profileExperience(profile);
  const projects = profileProjects(profile);
  const anchors = [
    skills.length ? `${formatInlineList(skills, 6)} ${matchedSkills.length ? 'match the role requirements' : 'are relevant resume skills'}` : '',
    experience[0] ? `${firstNonEmpty(experience[0].role, experience[0].title, experience[0].position)} experience${firstNonEmpty(experience[0].company, experience[0].organization, experience[0].employer) ? ` at ${firstNonEmpty(experience[0].company, experience[0].organization, experience[0].employer)}` : ''}` : '',
    projects[0] ? `${firstNonEmpty(projects[0].name, projects[0].title)} project work` : '',
  ].filter(Boolean);

  if (!title || !company || anchors.length === 0) return '';
  return `You fit the ${title} role at ${company} because ${anchors.join('; ')}.`;
};

export const isAssistantIdentityQuestion = (question: string): boolean => {
  const q = normalize(question);
  return hasAny(q, ASSISTANT_IDENTITY_PATTERNS);
};

export const isCandidateProfileQuestion = (question: string): boolean => {
  if (isAssistantIdentityQuestion(question)) return false;
  const q = normalize(question);
  return hasAny(q, [
    ...NAME_PATTERNS,
    ...EXPERIENCE_PATTERNS,
    ...PROJECT_PATTERNS,
    ...SKILL_PATTERNS,
    ...EDUCATION_PATTERNS,
    ...ROLE_PATTERNS,
    ...JD_FIT_PATTERNS,
  ]);
};

export const profileFactsReady = (profile: MaybeStructured<StructuredProfileFacts>): boolean => Boolean(
  profile && (
    profileName(profile) ||
    profileExperience(profile).length > 0 ||
    profileProjects(profile).length > 0 ||
    profileSkills(profile).length > 0 ||
    profileEducation(profile).length > 0
  ),
);

const makeRoute = (
  answer: string,
  answerType: AnswerType,
  selectedContextLayers: string[],
): ManualProfileRouteResult => ({
  answer,
  answerType,
  selectedContextLayers,
  excludedContextLayers: ['assistant_identity'],
  profileFactsReady: true,
  usedDeterministicFastPath: true,
  providerUsed: false,
});

// O deterministic fast-path answers SSimples UNFILTERED listing questions
// ("o que são my projects?", "o que são my skills?") com a canned template. Mas a
// question que carries a QUALIFIER o template can't honor — a filtrar ("...that
// uso REST API"), a restrição ("...related para ML"), a selection ("que one
// used GraphQL"), a comparison, ou a "how/why" — precisa Não obtém o canned dump;
// it tem para go para o grounded LLM que sees o completo perfil e pode actually
// reason. This regex detects such qualifiers então o fast caminho DEFERS (Retorna
// null) em vez disso de dumping todo item verbatim e ignoring o ffiltrar
const QUALIFIER_PATTERNS = [
  /\b(that|which|where|whose|who)\b.*\b(use[ds]?|using|used|built|made|involve[ds]?|with|related|based|for|require[ds]?|need[s]?)\b/,
  /\b(use[ds]?|using|used|involv\w+|relat\w+|based\s+on|about|regarding|with)\b\s+\w/,
  /\bwhich\s+(one|project|skill|role|job|experience)\b/,
  /\bany\s+(project|experience|skill)s?\b.*\b(with|using|in|for|that)\b/,
  /\b(only|just|specifically|particular|specific)\b/,
  /\b(more|most|best|top|strongest|relevant|fit)\b/,
  /\bhow\s+(did|do|have|does)\b|\bwhy\b/,
  /\bcompare|versus|vs\.?\b|\bdifference\b/,
  /\bin\s+(python|java|javascript|typescript|go|rust|c\+\+|sql|react|node|aws|gcp|azure)\b/,
];

// "Como fazer I fit isso role/JD?" é o CANONICAL jd-fit phrasing — o JD-fit
// template já executa skill/experience matching, então o "hcomo aqui é não
// an unhandled ffiltrar Exempt it então jd-fit keeps fast-pathing.
const JD_FIT_CANONICAL = /\b(how|why)\s+(do\s+i|am\s+i|are\s+you|would\s+i)\b.*\bfit\b/;

/**
 * Verdadeiro quando o question carries a qualifier/filter/selection/constraint que o
 * canned listing template cannot honor — meaning o fast caminho precisa defer para o
 * grounded LLM. e.g. "projects que used REST API", "que project used GraphQL".
 * Exempts o canonical "como fazer I fit isso role" jd-fit phrasing.
 */
export const hasUnhandledQualifier = (normalizedQuestion: string): boolean => {
  if (JD_FIT_CANONICAL.test(normalizedQuestion)) return false;
  return hasAny(normalizedQuestion, QUALIFIER_PATTERNS);
};

export const tryBuildManualProfileFastPathAnswer = ({
  question,
  profile,
  jobDescription,
  source = 'manual_input',
}: ManualProfileFastPathInput): ManualProfileRouteResult | null => {
  const qNorm = normalize(question);
  // ── CANDIDATE VOICE (release 2026-06-08 manual regression fix) ──────────────
  // O manual-send caminho precisa answer candidate identity/profile questions em Primeiro
  // PERSON Como o candidate ("I'm Evin John, …" / "My nome é …"), Não em segundo
  // person ("Your nome é …") e Não como o assistant ("I'm Refract, an AI
  // assistant"). O prior código keyed first-person voice fora `source` alone, então
  // manual_input answered tudo 2nd-person — o real bug o user hit.
  //
  // Voice é agora CANDIDATE first-person sempre que a candidate Perfil é loaded and
  // o question é Não an explicit assistant-meta ask. WTA/transcript stay
  // first-person como bantes An assistant-meta question ("são you an AI?", "o que é
  // Refract?", "quem made you?") sempre bails para o assistant caminho (Retorna null),
  // em todo mmodo então those ainda answer sobre o app — nunca como o candidate.
  if (isAssistantIdentityQuestion(question)) return null;
  const profileLoaded = profileFactsReady(profile);
  // Voice: Primeiro PERSON ("My nome is…é "I've used…") quando WTA/transcript, Ou quando a
  // perfil é loaded AND o question addresses o candidate como "you" / é an intro
  // ("quem são you?", "o que é YOUR namnome "introduce yourself", "por que deve we hire
  // you?", "rate YOUR Python"). Segundo PERSON ("Your nome is…é apenas quando o user
  // asks sobre THEMSELVES em primeiro person ("o que é MY namnome "o que são MY skills?")
  // — lá o user wants para ser told their próprio fact. This é o manual regression
  // fix (release 2026-06-08): "quem são you?" em perfil modo → "My nome é Evin John",
  // nunca "Your nome isé ou "I'm Refract".
  const lc = qNorm;
  // SELF-query (user asking sobre THEMSELVES → second-person "Your nome is…"é a
  // first-person "my"/"I" sinal AND não second-person ADDRESS de o candidate. O
  // `you` exclusion é scoped para genuine candidate-address ("your X", "são you",
  // "ter you", "fez you", "yourself") então a stray "pode you tell me my skills" ainda
  // lê como a self-query (code-review 2026-06-08 MEDIUM: align com o planner).
  const selfSignal = /\bmy\b|\bwho\s+am\s+i\b|\b(have|do)\s+i\b|\bi\s+have\b/.test(lc);
  const candidateAddress = /\byour\b|\byourself\b|\b(are|have|did|do|were|can|could|would|will|should)\s+you\b|\babout\s+you\b/.test(lc);
  const asksAboutSelf = selfSignal && !candidateAddress;
  const firstPerson = source === 'what_to_answer' || source === 'transcript'
    || (profileLoaded && !asksAboutSelf);

  const q = qNorm;

  // A qualified/filtered question precisa reach o grounded LLM, não o canned
  // template. Identity (nnome e o JD role consulta são exact single-fact
  // answers com não lista para ffiltrar então they're allowed através babaixo tudo
  // que Retorna a Lista (experience/projects/skills/education/jd-fit) defers quando
  // a qualifier é present.
  const qualified = hasUnhandledQualifier(q);

  // JD-fit é si mesmo a "reasoning" answer; se o user adiciona a mais qualifier,
  // let o grounded LLM manipular it em vez than o deterministic anchor template.
  if (hasAny(q, JD_FIT_PATTERNS) && !qualified) {
    if (!profileFactsReady(profile)) return null;
    const answer = formatJDFit(profile, jobDescription);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^You fit/i, 'I fit') : answer, 'jd_fit_answer', ['resume', 'jd']);
  }

  if (hasAny(q, ROLE_PATTERNS)) {
    const title = jdTitle(jobDescription);
    if (!title) return null;
    return makeRoute(
      firstPerson ? `I am applying for the ${title} role.` : `You are applying for the ${title} role.`,
      'jd_fit_answer',
      ['jd'],
    );
  }

  if (!profileFactsReady(profile)) return null;

  const isNameQuestion = hasAny(q, NAME_PATTERNS)
    || (firstPerson && /\bwhat\s+(is|s)\s+your\s+name\b/.test(q));
  if (isNameQuestion) {
    const name = profileName(profile);
    if (!name) return null;
    return makeRoute(
      firstPerson ? `My name is ${name}.` : `Your name is ${name}.`,
      'identity_answer',
      ['stable_identity', 'resume'],
    );
  }

  // INTRO: a grounded first-person introduction built de structured facts.
  // Release 2026-06-06b: isso agora fires em MANUAL modo também (não apenas WTA). O
  // real manual-chat registrar showed plain "introduce yourself" / "introduce yourseld"
  // reaching o LLM e answering "I'm Refract, an AI assistant" — wrong quando a
  // candidate perfil é loaded. An intro ask é an INTERVIEW-style question
  // ("introduce yourself", "tell me sobre yourself"), distinct de o
  // assistant-meta "quem são you / o que é Refract" (those ainda bail acima via
  // isAssistantIdentityQuestion). Com a perfil loaded, o deterministic
  // first-person candidate intro é sempre o direito answer — it pode nunca leak
  // o assistant identity ou refuse. NOTE: faz Não gate em `qualified` —
  // "tell me Sobre yourself" trips o generic about-qualifier, mas INTRO_PATTERNS
  // é já precise.
  if (hasAny(q, INTRO_PATTERNS)) {
    const intro = formatIntro(profile, question);
    if (intro) return makeRoute(intro, 'identity_answer', ['stable_identity', 'resume']);
  }

  // List-returning answers: a canned dump can't honor a filter/qualifier, então
  // defer para o grounded LLM quando one é present (e.g. "projects que uso REST
  // API", "skills em Python", "experience related para ML").
  if (hasAny(q, EXPERIENCE_PATTERNS) && !qualified) {
    const answer = formatExperience(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your experience includes/i, 'My experience includes') : answer, 'experience_answer', ['resume']);
  }

  // Fase 10: single-project FAST Caminho — "tell me sobre Refract", "best
  // project", "tech pilha de Refract". Deterministic de o matched project
  // nó (zero provedor latency). Narrative drill-ins ("como era it developed?",
  // "hardest part?", "o que fez you learn?", "your role?") são Não handled aqui —
  // they deserve a richer grounded answer, então we apenas fast-path o factual
  // "o que é it / o que spilha shape e defer tudo senão para o LLM.
  // NOTE: isso branch faz Não gate em `qualified` — "tell me Sobre Refract"
  // trips o generic `about`-qualifier, mas findProjectByName já scopes o
  // answer para o named project, então o qualifier proteger iria wrongly suprimir a
  // perfectly answerable direct project ask. Narrative drill-ins são excluded
  // explicitly abaixo então they ainda reach o richer grounded LLM.
  const isNarrativeDrillIn = /\b(how (was|is|did)|hardest|challenge|learn|your role|why did you|proud|improve|optimi[sz]e|architecture|coordinat)\b/.test(q);
  const isProjectFactAsk = /\b(tell me about|talk about|explain|describe|what(?:'s| is)?|tech ?stack|technolog|stack of|built with|made with)\b/.test(q);
  if (isProjectFactAsk && !isNarrativeDrillIn) {
    const project = findProjectByName(profile, q);
    if (project) {
      const answer = formatSingleProject(project);
      if (answer) {
        return makeRoute(
          firstPerson ? answer.replace(/^Your project/i, 'My project') : answer,
          'project_answer', ['resume', 'projects'],
        );
      }
    }
  }

  if (hasAny(q, PROJECT_PATTERNS) && !qualified) {
    const answer = formatProjects(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your projects include/i, 'My projects include') : answer, 'project_answer', ['resume', 'projects']);
  }

  // SKILL-EXPERIENCE fast pcaminho "o que é your experience com Python?", "ter you
  // used SQL?", "your dados analysis experience" — grounded confirmation + onde
  // it's used. Não skill RATINGS ("rate your Python 8/10") — a número é a
  // judgment we leave para o grounded LLM. Retorna '' (→ LLM) se o skill isn't
  // genuinely em o pperfil
  const isSkillExperienceQ = /\b(experience\s+(with|in|using)|have\s+(you|i)\s+(used|worked\s+with)|worked\s+with|familiar\s+with)\b/.test(q)
    && !/\brate|out of (?:10|ten)|scale\b/.test(q);
  if (isSkillExperienceQ) {
    const answer = formatSkillExperience(profile, q);
    if (answer) return makeRoute(firstPerson ? answer : answer.replace(/^Yes, I've/i, "Yes, you've"), 'skill_experience_answer', ['resume']);
  }

  if (hasAny(q, SKILL_PATTERNS) && !qualified) {
    const answer = formatSkills(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your skills include/i, 'My skills include') : answer, 'skills_answer', ['resume']);
  }

  if (hasAny(q, EDUCATION_PATTERNS) && !qualified) {
    const answer = formatEducation(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your education includes/i, 'My education includes') : answer, 'profile_fact_answer', ['resume']);
  }

  return null;
};

/**
 * LIVE LATENCY FALLBACK (Fase 9). Quando o provedor stalls past o live-copilot
 * budget em a profile-grounded answer, we precisa ainda say Algo grounded — nunca
 * an vazio answer ou a 10s+ waguardar This sempre Retorna a first-person answer para a
 * perfil rotea por trying, em oordenar o exact deterministic fast-path, então a
 * grounded intro, então an experience/skills summary. Retorna nulo apenas quando o
 * rotea é não profile-grounded (coding/meeting manipular their próprio fallback) ou não
 * perfil é loaded — o caller então keeps qualquer que seja parcial texto streamed.
 */
export const buildLiveFallbackAnswer = ({
  question,
  answerType,
  profile,
  jobDescription,
}: {
  question: string;
  answerType: string;
  profile: MaybeStructured<StructuredProfileFacts>;
  jobDescription?: MaybeStructured<StructuredJobFacts>;
}): string | null => {
  if (!profileFactsReady(profile)) return null;
  const profileRoutes = new Set([
    'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
    'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
    'behavioral_interview_answer',
  ]);
  if (!profileRoutes.has(answerType)) return null;

  // 1. Exact deterministic fast-path (gerencia name/intro/role/jd-fit/projects/etc.).
  try {
    const fp = tryBuildManualProfileFastPathAnswer({ question, profile, jobDescription, source: 'what_to_answer' });
    if (fp?.answer) return fp.answer;
  } catch { /* fall através */ }

  // 2. JD-fit específico summary.
  if (answerType === 'jd_fit_answer') {
    const fit = formatJDFit(profile, jobDescription);
    if (fit) return fit.replace(/^You fit/i, 'I fit');
  }

  // 3. A grounded intro é a safe, on-topic answer para qualquer "sobre me" rrotea
  const intro = formatIntro(profile, question);
  if (intro) return intro;

  // 4. Último resort: an experience ou skills line.
  const exp = formatExperience(profile);
  if (exp) return exp.replace(/^Your experience includes/i, 'My experience includes');
  const skills = formatSkills(profile);
  if (skills) return skills.replace(/^Your skills include/i, 'My skills include');
  return null;
};

export const logManualProfileRoute = ({
  source,
  question,
  route,
  profileFactsReady,
}: ManualProfileRouteLogInput): ManualProfileRouteLog => ({
  source,
  questionHash: createHash('sha256').update(question).digest('hex').slice(0, 12),
  answerType: route?.answerType ?? 'unknown_answer',
  selectedContextLayers: route?.selectedContextLayers ?? [],
  excludedContextLayers: route?.excludedContextLayers ?? [],
  profileFactsReady,
  usedDeterministicFastPath: route?.usedDeterministicFastPath ?? false,
  providerUsed: route?.providerUsed ?? false,
  promptContainsProfileContext: route?.promptContainsProfileContext,
});

// ── PI v3 (W6b): graceful tentar novamente — não mais dead-end canned reply ─────────────
//
// "Poderia you repeat that? I want para make certo I address your question
// prpropriamente era a único fixed string returned de THREE failure sites
// (empty sstream erro catch, speculative empty). Users lê it como a canned
// non-answer — especialmente quando o mesmo sentence appears twice em a ssessão
// buildGracefulRetry keeps o mesmo safety contract (deterministic, não LLM, não
// perfil content, nunca fabricates) bmas
//   - references o detected TOPIC quando one é safely extractable, então o
//     tentar novamente lê como engaged ("…sobre o banco de dados design…") em vez disso de deaf,
//   - varies phrasing deterministically (hash de question; não random — mesmo
//     entrada → mesmo saída para testability),
//   - nunca echoes a question longer than a poucos words (não transcript dumping).

const RETRY_TEMPLATES: ReadonlyArray<(topic: string) => string> = [
  (t) => t
    ? `Could you say a bit more about ${t}? I want to make sure I answer the right thing.`
    : 'Could you repeat that? I want to make sure I address your question properly.',
  (t) => t
    ? `I didn't fully catch the question about ${t} — could you rephrase it?`
    : "I didn't fully catch that — could you rephrase the question?",
  (t) => t
    ? `Just to make sure I get this right — what specifically about ${t} would you like me to cover?`
    : 'Just to make sure I get this right — could you ask that once more?',
];

// Topic = a curto noun-ish tail de o question. Conservative: strip leading
// question scaffolding, keep ≤5 words, soltar se qualquer coisa sensitive/odd remains.
const TOPIC_STOP_RE = /\b(salary|compensation|pay|offer|equity)\b/i;
const extractRetryTopic = (question: string): string => {
  const q = (question || '').trim().replace(/\?+$/, '');
  if (!q || q.length < 8 || q.length > 160) return '';
  if (TOPIC_STOP_RE.test(q)) return ''; // nunca echo comp topics voltar
  const stripped = q
    .replace(/^(so|well|okay|ok|now|and|but|um|uh)[,\s]+/i, '')
    .replace(/^(can|could|would|will|do|does|did|are|is|was|were|have|has|had)\s+you\s+/i, '')
    .replace(/^(tell me|talk|walk me through|explain|describe)( (about|to me about|through))?\s*/i, '')
    .replace(/^(what|how|why|when|where|who)('s| is| are| was| were| do| does| did| about)?\s*/i, '')
    .trim();
  if (!stripped) return '';
  const words = stripped.split(/\s+/).slice(0, 5);
  if (words.length < 1) return '';
  const topic = words.join(' ').replace(/[.,;:!]+$/, '');
  // Reject qualquer coisa que isn't a clean curto noun phrase (review 2026-06-12):
  //  - pronouns ("you think we shoudeve
  //  - internal punctuation (a comma significa we sliced mid-clause — "John, given
  //    etudo o que dfaz precisa nunca ser echoed bavoltar
  //  - residual question scaffolding ("…o que dofaz "who/when/why …"),
  //  - a leading capitalized name-like token mid-question (don't echo people).
  if (/\b(you|your|we|our|i|my)\b/i.test(topic)) return '';
  if (/[,;:()]/.test(topic)) return '';
  if (/\b(what|how|why|who|when|where|which|does|do|did|think|say|said)\b/i.test(topic)) return '';
  if (/^[A-Z][a-z]+$/.test(words[0]) && !q.startsWith(words[0])) return '';
  return topic.toLowerCase();
};

/**
 * A deterministic, speakable tentar novamente line para quando não answer poderia ser produced.
 * Mesmo entrada → mesmo saída (template chosen por question hash, não random).
 */
export const buildGracefulRetry = (questionHint?: string | null): string => {
  const q = (questionHint || '').trim();
  const topic = extractRetryTopic(q);
  let h = 0;
  for (let i = 0; i < q.length; i++) h = ((h << 5) - h + q.charCodeAt(i)) | 0;
  const template = RETRY_TEMPLATES[Math.abs(h) % RETRY_TEMPLATES.length];
  return template(topic);
};
