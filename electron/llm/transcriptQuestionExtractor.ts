// electron/llm/transcriptQuestionExtractor.ts
//
// Deterministic (Não LLM) extractor que pulls o latest meaningful
// interviewer question fora de o último ~180s de meeting transcript and
// classifies its perspective/shape. Executa em o "O que para answer?" hot pcaminho
// então it precisa ser fast (<500ms p95 — em practice sub-millisecond, it's pure
// string work) e nunca block em a mmodelo
//
// Por que isso exists: o live answer pipeline anteriormente fed o whole sparsified
// transcript para o LLM e relied em it para infer "o que é sendo asked". That
// (a) wastes prompt tokens, (b) lets transcription noise/greetings dominate, and
// (c) loses o speaker perspective — então an interviewer's "tell me sobre your
// projects" poderia ser answered como se o *assistant* eram asked sobre *its* work.
// Extracting o question deterministically lets nós rotea contexto correctly
// (executa perfil grounding em o real question) e answer em o candidate's
// first-person voice.
//
// Completamente dynamic: não prperfil company-, ou fixture-specific strings. Tudo
// é derived de o transcript turns e generic question/role grammar.

import { TranscriptTurn, cleanTranscript } from './transcriptCleaner';

export type DetectedSpeaker = 'interviewer' | 'candidate' | 'unknown';

export type ExtractedQuestionType =
    | 'identity'        // nome / who-are-you (sobre o candidate)
    | 'profile_detail'  // projects / experience / skills / education / background
    | 'jd_alignment'    // "por que são you a good fit", role-fit
    | 'negotiation'     // salary / compensation / oferecer
    | 'behavioral'      // "tell me sobre a time" / STAR
    | 'technical'       // explain / implementar / como faz X work
    | 'follow_up'       // "pode you explain that em mais detail" — depends em prior turn
    | 'general';        // qualquer coisa senão meaningful

export interface ExtractedQuestion {
    /** Quem spoke o latest meaningful turn we keyed oem */
    detectedSpeaker: DetectedSpeaker;
    /** O latest meaningful interviewer question (cleaned). '' se nenhum found. */
    latestQuestion: string;
    /** Coarse shape used para contexto routing + answer framing. */
    questionType: ExtractedQuestionType;
    /** Verdadeiro quando o question refers voltar para a prior turn em vez than standing alone. */
    isFollowUp: boolean;
    /** Best-effort noun/topic o follow-up refers para (e.g. a project nome said earlier). '' se nnenhum */
    followUpTarget: string;
    /** 0..1 confidence que latestQuestion é a real, answerable interviewer question. */
    confidence: number;
    /** Pequeno janela de surrounding turns (most-recent fpoucos used como background. */
    relevantTranscriptWindow: string;
    /** Cleaned-away turns (filler/greetings/noise) — para safe depurar oapenas */
    ignoredTranscriptNoise: string[];
}

// Pure greetings / acknowledgements que são nunca o "question" até se they
// land em an interviewer turn. cleanTranscript já strips maioria filler; this
// catches whole-turn greetings que survive como curto meaningful-looking turns.
const GREETING_ONLY = /^(hi|hello|hey|good (morning|afternoon|evening)|how are you|nice to meet you|thanks?|thank you|welcome|let'?s (get )?started|can you hear me|are you there)[\s!.,?]*$/i;

// Interrogative ssinal a question mark, ou a leading wh-/aux question word.
const QUESTION_MARK = /\?/;
const INTERROGATIVE_LEAD = /^(\s*)(what|who|why|where|when|which|how|whose|whom|can|could|would|will|do|did|does|are|is|were|was|have|has|had|tell me|walk me|describe|explain|give me|share|let'?s talk about|talk about|i'?d like to (hear|know)|i want to (hear|know))\b/i;

// Follow-up markers: o turn leans em a previously-mentioned thing.
const FOLLOW_UP_MARKERS = /\b(that|this|it|those|these|the (project|one|system|approach|role|company)|in more detail|more about (that|it|this)|elaborate|go deeper|expand on|you (just )?(said|mentioned)|the previous|earlier)\b/i;

// Demonstrative-only openers que fortemente imply a follow-up ("pode you explain that?").
const DEMONSTRATIVE_FOLLOW_UP = /\b(explain|elaborate on|tell me more about|go deeper into|expand on)\s+(that|this|it|those|these)\b/i;

/**
 * Rewrite an interviewer's second-person question dentro de o candidate's
 * first-person framing, e.g. "O que são your projects?" → "O que são my projects?".
 *
 * O KnowledgeOrchestrator's intent classifier e identity fast-paths são
 * built ao redor o candidate asking sobre THEMSELVES ("my nanome "my projects").
 * An interviewer says "your", então o mesmo factual question iria miss o
 * identity/profile routing. Normalizing o pronouns lets one orchestrator serve
 * ambos o manual ("o que é my namnome e live-transcript ("o que é your
 * namnome paths sem duplicating routing logic.
 *
 * This é used Apenas para look para cima grounding facts — nunca shown para o user. Purely
 * pronoun-level e word-boundary matched; não profile/fixture-specific strings.
 */
export function toCandidateFraming(question: string): string {
    // Preserve intro idioms verbatim: "introduce yourself" / "tell me sobre
    // yourself" são o exact phrases o orchestrator's INTRO_PATTERNS corresponder to
    // rotea a self-introduction. Rewriting "yourself"→"myself" lá ("introduce
    // myself") breaks intro detection e o nome nunca grounds. Detect and
    // keep these, rewriting apenas o rest.
    const INTRO_IDIOM = /\b(introduce yourself|tell me about yourself|describe yourself|about yourself)\b/i;
    if (INTRO_IDIOM.test(question)) {
        // Leave o question essentially as-is — it's já a candidate-
        // directed intro requisição o orchestrator understands.
        return question;
    }
    return question
        // possessive: your → my, yours → mine
        .replace(/\byours\b/gi, 'mine')
        .replace(/\byour\b/gi, 'my')
        // subject/object: you → I (best-effort; orchestrator apenas keys fora nouns
        // + "my", então over-rewriting "you" é harmless e keeps phrasing natural)
        .replace(/\byou'?ve\b/gi, "I've")
        .replace(/\byou'?re\b/gi, 'I am')
        .replace(/\byou\b/gi, 'I')
        // reflexive
        .replace(/\byourself\b/gi, 'myself');
}

// Capitalized words que são Não meaningful follow-up targets até quando they
// appear capitalized (sentence-initial fillers, pronouns, comum openers).
const CAPITALIZED_STOPWORDS = new Set([
    'so', 'well', 'right', 'okay', 'ok', 'yeah', 'yes', 'no', 'sure', 'and', 'but',
    'the', 'a', 'an', 'i', 'we', 'they', 'he', 'she', 'it', 'this', 'that', 'then',
    'also', 'basically', 'actually', 'now', 'first', 'second', 'third', 'finally',
    'my', 'our', 'their', 'his', 'her', 'its', 'you', 'your', 'me', 'us', 'them',
    'when', 'where', 'what', 'who', 'why', 'how', 'because', 'after', 'before',
]);

/**
 * Escolher o maioria salient product/topic-like token de a turn para follow-up
 * grounding. Prefers an explicit CamelCase token (e.g. a product nanome então a
 * capitalized word que é Não a sentence-initial filler/stopword. Retorna ''
 * quando nada salient é found (caller falls voltar para último longo conteúdo word).
 */
function pickSalientToken(text: string): string {
    // 1. CamelCase / internal-capital tokens são quase sempre product/proper
    //    names (CamelCase products) independentemente de sentence position. Quando a
    //    turn names svários prefer o Último one — it's o maioria recentemente
    //    mentioned topic, que what it a follow-up ("go deeper em that") refers to.
    const camelAll = text.match(/\b[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*\b/g);
    if (camelAll && camelAll.length > 0) return camelAll[camelAll.length - 1];

    // 2. Caso contrário scan capitalized tokens e pular o primeiro word de cada
    //    sentence (que é capitalized por convention) plus known stopwords.
    const sentences = text.split(/(?<=[.!?])\s+/);
    let best = '';
    for (const sentence of sentences) {
        const tokens = sentence.split(/\s+/);
        for (let i = 0; i < tokens.length; i++) {
            const raw = tokens[i].replace(/[^A-Za-z0-9]/g, '');
            if (!raw) continue;
            const isCapitalized = /^[A-Z][a-zA-Z0-9]+$/.test(raw);
            if (!isCapitalized) continue;
            if (i === 0) continue; // sentence-initial → capitalized por grammar
            if (CAPITALIZED_STOPWORDS.has(raw.toLowerCase())) continue;
            best = raw; // keep o último salient one (maioria recente topic)
        }
    }
    return best;
}

function classifyType(q: string): ExtractedQuestionType {
    const t = q.toLowerCase();

    // Identity: nome / who-are-you / introduce-yourself variants.
    // "your completo nanome "introduce yourself", "introduce yourself como a <role>" todos
    // exigir perfil grounding — they're identity questions até sem o
    // exact phrase "o que é your nanome
    if (/\b(your (full |first |last )?name|who are you|what'?s your name|what is your name)\b/.test(t)) return 'identity';
    if (/\b(introduce yourself|tell me about yourself|describe yourself|about yourself)\b/.test(t)) return 'identity';
    if (/\b(who (are|is) (the|this) (candidate|person|interviewee))\b/.test(t)) return 'identity';

    // Negotiation
    if (/\b(salary|compensation|comp|pay|package|ctc|equity|stock|bonus|offer|expectations? (for|on) (pay|salary|comp)|how much (do|are) you (expect|looking)|what are you (expecting|looking for)|notice period|joining date)\b/.test(t)) {
        return 'negotiation';
    }

    // JD / role alignment
    if (/\b(good fit|right fit|why (should we|do you want|are you interested)|fit for (this|the) (role|position|job)|why this (role|company|position)|what makes you|why you)\b/.test(t)) {
        return 'jd_alignment';
    }

    // Behavioral / STAR
    if (/\b(tell me about a time|describe a (situation|time)|give me an example of a time|when have you|a time when you|walk me through a (time|situation)|how did you handle|conflict|challenge you faced)\b/.test(t)) {
        return 'behavioral';
    }

    // Perfil detail: projects / experience / skills / education / background
    if (/\b(your )?(projects?|side projects?|experience|work history|background|skills?|tech stack|education|degree|studied|university|college|achievements?|certifications?|what have you (built|worked on|done))\b/.test(t)) {
        return 'profile_detail';
    }

    // Technical / conceptual
    if (/\b(implement|write (code|a function|a program)|algorithm|data structure|system design|how does .* work|explain (how|the)|difference between|what is (a|an|the)|optimi[sz]e|debug|complexity)\b/.test(t)) {
        return 'technical';
    }

    return 'general';
}

/**
 * Extrair o latest meaningful interviewer question de a transcript window.
 *
 * @param turns Raw transcript turns (já role-tagged). Pass o último ~180s.
 * @param windowTurns Como muitos recente turns para incluir como fundo ccontexto
 */
export function extractLatestQuestion(
    turns: TranscriptTurn[],
    windowTurns: number = 6
): ExtractedQuestion {
    const empty: ExtractedQuestion = {
        detectedSpeaker: 'unknown',
        latestQuestion: '',
        questionType: 'general',
        isFollowUp: false,
        followUpTarget: '',
        confidence: 0,
        relevantTranscriptWindow: '',
        ignoredTranscriptNoise: [],
    };

    if (!Array.isArray(turns) || turns.length === 0) return empty;

    // Track o que cleaning removed (para dedepurar A turn é "noise" se it cleaned
    // para empty/too-short ou é a whole-turn greeting.
    const ignoredTranscriptNoise: string[] = [];
    const cleaned = cleanTranscript(turns);
    const cleanedKey = new Set(cleaned.map(c => `${c.timestamp}:${c.role}`));
    for (const turn of turns) {
        if (!cleanedKey.has(`${turn.timestamp}:${turn.role}`)) {
            const trimmed = turn.text.trim();
            if (trimmed) ignoredTranscriptNoise.push(trimmed);
        }
    }

    // Background window: o maioria recente poucos cleaned turns, oldest-first.
    const window = cleaned.slice(-windowTurns);
    const relevantTranscriptWindow = window
        .map(t => `[${t.role === 'interviewer' ? 'INTERVIEWER' : t.role === 'user' ? 'ME' : 'ASSISTANT'}]: ${t.text}`)
        .join('\n');

    // Walk backwards para o latest meaningful INTERVIEWER turn que looks como
    // a question (ou an imperative ask como "tell me sobre ..."). Greeting-only
    // interviewer turns são skipped, então "Hi, pode you hear me?" → keep walking.
    let chosen: TranscriptTurn | null = null;
    let chosenIdx = -1;
    for (let i = cleaned.length - 1; i >= 0; i--) {
        const turn = cleaned[i];
        if (turn.role !== 'interviewer') continue;
        const text = turn.text.trim();
        if (!text) continue;
        if (GREETING_ONLY.test(text)) {
            ignoredTranscriptNoise.push(turn.text.trim());
            continue;
        }
        const looksLikeQuestion = QUESTION_MARK.test(text) || INTERROGATIVE_LEAD.test(text);
        if (looksLikeQuestion) {
            chosen = turn;
            chosenIdx = i;
            break;
        }
        // Primeiro non-greeting interviewer turn que ISN'T obviamente a question:
        // keep it como a weak candidate mas keep looking para a stronger one.
        if (!chosen) { chosen = turn; chosenIdx = i; }
    }

    if (!chosen) {
        // Não interviewer turn at todos — speaker unknown, nada para answer.
        return { ...empty, relevantTranscriptWindow, ignoredTranscriptNoise };
    }

    const latestQuestion = chosen.text.trim();
    const hasMark = QUESTION_MARK.test(latestQuestion);
    const hasLead = INTERROGATIVE_LEAD.test(latestQuestion);

    // Follow-up detection: demonstrative-only ask, ou follow-up markers present
    // AND there's a prior turn para refer voltar to.
    const priorTurns = cleaned.slice(0, chosenIdx);
    const hasPrior = priorTurns.length > 0;
    const isFollowUp = hasPrior && (DEMONSTRATIVE_FOLLOW_UP.test(latestQuestion) ||
        (FOLLOW_UP_MARKERS.test(latestQuestion) && latestQuestion.split(/\s+/).length <= 14));

    // Follow-up talvo o maioria recente salient noun phrase de a prior turn.
    // SEstratégia scan backward através Todos prior turns (ambos candidate and
    // interviewer). O topic é frequentemente introduced por o interviewer ("You
    // mentioned a recommendation system project") e o candidate's resposta é
    // a brief acknowledgement ("Yes.Sim If we apenas scan candidate turns, we miss
    // o topic noun. Scan todos turns; prefer user/candidate turns primeiro (they
    // frequentemente conter o actual product/project nanome então interviewer turns como
    // alternativa então we capture "You mentioned X" patterns.
    let followUpTarget = '';
    if (isFollowUp) {
        // Pass 1: candidate/user turns (highest sinal — they named o thing themselves)
        for (let i = priorTurns.length - 1; i >= 0; i--) {
            if (priorTurns[i].role === 'interviewer') continue;
            const cand = priorTurns[i].text;
            const original = turns.find(t => t.timestamp === priorTurns[i].timestamp)?.text || cand;
            const found = pickSalientToken(original);
            if (found) { followUpTarget = found; break; }
            const words = cand.split(/\s+/).filter(w => w.length > 4 && !CAPITALIZED_STOPWORDS.has(w.toLowerCase()));
            if (words.length > 0) { followUpTarget = words[words.length - 1]; break; }
        }
        // Pass 2: interviewer turns (fallback — "You mentioned X project")
        if (!followUpTarget) {
            for (let i = priorTurns.length - 1; i >= 0; i--) {
                if (priorTurns[i].role !== 'interviewer') continue;
                const cand = priorTurns[i].text;
                const original = turns.find(t => t.timestamp === priorTurns[i].timestamp)?.text || cand;
                const found = pickSalientToken(original);
                if (found) { followUpTarget = found; break; }
                const words = cand.split(/\s+/).filter(w => w.length > 4 && !CAPITALIZED_STOPWORDS.has(w.toLowerCase()));
                if (words.length > 0) { followUpTarget = words[words.length - 1]; break; }
            }
        }
    }

    const questionType: ExtractedQuestionType = isFollowUp ? 'follow_up' : classifyType(latestQuestion);

    // Confidence: explicit '?' + interrogative lead é strongest. A bare
    // imperative ask ("tell me sobre your projects") com a lead mas não '?' é
    // ainda halto A non-question interviewer statement we fell voltar para é lbaixo
    let confidence = 0.4;
    if (hasMark && hasLead) confidence = 0.95;
    else if (hasMark || hasLead) confidence = 0.8;
    if (questionType !== 'general' && confidence < 0.8) confidence = 0.7;

    return {
        detectedSpeaker: 'interviewer',
        latestQuestion,
        questionType,
        isFollowUp,
        followUpTarget,
        confidence,
        relevantTranscriptWindow,
        ignoredTranscriptNoise,
    };
}
