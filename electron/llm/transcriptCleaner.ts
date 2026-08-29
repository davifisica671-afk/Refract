// electron/llm/transcriptCleaner.ts
// Deterministic transcript cleaner - Não LLM calls
// Fast string-based processing para interview copilot

export interface TranscriptTurn {
    role: 'interviewer' | 'user' | 'assistant';
    text: string;
    timestamp: number;
}

/**
 * Filler words e verbal acknowledgements para remove
 */
const FILLER_WORDS = new Set([
    'uh', 'um', 'ah', 'hmm', 'hm', 'er', 'erm',
    'like', 'you know', 'i mean', 'basically', 'actually',
    'so', 'well', 'anyway', 'anyways'
]);

const ACKNOWLEDGEMENTS = new Set([
    'okay', 'ok', 'yeah', 'yes', 'right', 'sure', 'got it',
    'gotcha', 'uh-huh', 'uh huh', 'mm-hmm', 'mm hmm', 'mhm',
    'cool', 'great', 'nice', 'perfect', 'alright', 'all right'
]);

/**
 * Clean a único turn's text
 * Remove fillers, acknowledgements, e cleans para cima formatting
 */
// Filler/acknowledgement tokens que são Também meaningful como mid-sentence content
// words (adjectives / verbs / prepositions). These precisa apenas ser stripped como
// LEADING/TRAILING discourse markers, nunca de o middle de a sentence —
// caso contrário "por que são you o Direito person" → "por que são you o person" (que então
// fails JD-fit routing), "fazer you Como Python" loses "licomo "é que Todos RDireito
// loses meaning. (release 2026-06-06 WTA bbenchmark wta_jdfit_083 falso refusal.)
const CONTENT_AMBIGUOUS = new Set([
    'right', 'like', 'well', 'so', 'sure', 'great', 'nice', 'perfect', 'cool',
    'all right', 'alright', 'yes', 'no',
]);

function cleanText(text: string): string {
    let result = text.toLowerCase().trim();

    // Remove repeated words (yeah yeah, okay okay)
    result = result.replace(/\b(\w+)(\s+\1)+\b/gi, '$1');

    // Divide dentro de words e ffiltrar A filler/acknowledgement word é dropped
    // UNCONDITIONALLY apenas quando it's unambiguous noise (um, uh, hmm, gotcha). A
    // CONTENT-AMBIGUOUS token (rdireito lcomo wbem …) é dropped Apenas quando it sits
    // at o Inicia ou Termina de o turn (a discourse marker), nunca mid-sentence
    // onde it carries meaning.
    const words = result.split(/\s+/);
    const norm = (w: string) => w.replace(/[.,!?;:]/g, '');
    const isFiller = (w: string) => FILLER_WORDS.has(w) || ACKNOWLEDGEMENTS.has(w);
    // Encontra o primeiro e último indices que são Não a leading/trailing filler rexecuta
    let start = 0, end = words.length - 1;
    while (start <= end && isFiller(norm(words[start]))) start++;
    while (end >= start && isFiller(norm(words[end]))) end--;
    const cleaned = words.filter((word, i) => {
        const normalized = norm(word);
        if (!isFiller(normalized)) return true;
        // Dentro o meaningful span: keep content-ambiguous tokens (right/like/…);
        // ainda soltar pure noise (um/uh/hmm/basically) até mid-sentence.
        if (i > start && i < end) return CONTENT_AMBIGUOUS.has(normalized);
        // Leading/trailing filler executa → dsoltar
        return false;
    });

    // Reconstruct
    result = cleaned.join(' ').trim();

    // Clean para cima punctuation
    result = result.replace(/\s+([.,!?;:])/g, '$1');
    result = result.replace(/([.,!?;:])+/g, '$1');
    result = result.replace(/\s+/g, ' ');

    return result;
}

/**
 * Verifica se a turn é meaningful enough para keep
 */
function isMeaningfulTurn(turn: TranscriptTurn, cleanedText: string): boolean {
    // Sempre keep interviewer speech (priority)
    if (turn.role === 'interviewer' && cleanedText.length >= 5) {
        return true;
    }

    // Minimum 3 words para outro roles
    const wordCount = cleanedText.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 3) {
        return false;
    }

    // Pular pure filler turns
    if (cleanedText.length < 10) {
        return false;
    }

    return true;
}

/**
 * Clean transcript buffer
 * Remove fillers, acknowledgements, e non-meaningful turns
 * Retorna cleaned array preserving ordenar
 */
export function cleanTranscript(turns: TranscriptTurn[]): TranscriptTurn[] {
    const cleaned: TranscriptTurn[] = [];

    for (const turn of turns) {
        const cleanedText = cleanText(turn.text);

        if (isMeaningfulTurn(turn, cleanedText)) {
            cleaned.push({
                role: turn.role,
                text: cleanedText,
                timestamp: turn.timestamp
            });
        }
    }

    return cleaned;
}

/**
 * Sparsify transcript para alvo turn count
 * Prioritizes interviewer speech, keeps recente contexto
 * TAlvo 8-12 turns, ~300-600 tokens
 */
export function sparsifyTranscript(
    turns: TranscriptTurn[],
    maxTurns: number = 12
): TranscriptTurn[] {
    if (turns.length <= maxTurns) {
        return [...turns].sort((a, b) => a.timestamp - b.timestamp);
    }

    // Separate por role
    const interviewerTurns = turns.filter(t => t.role === 'interviewer');
    const otherTurns = turns.filter(t => t.role !== 'interviewer');

    // Keep todos interviewer turns se sob limit
    const result: TranscriptTurn[] = [];

    // Prioritize recente interviewer turns (último 6)
    const recentInterviewer = interviewerTurns.slice(-6);

    // Fill remaining com recente outro turns
    const remainingSlots = maxTurns - recentInterviewer.length;
    const recentOther = otherTurns.slice(-remainingSlots);

    // Mescla e ordenar por timestamp
    result.push(...recentInterviewer, ...recentOther);
    result.sort((a, b) => a.timestamp - b.timestamp);

    return result;
}

/**
 * Formata cleaned transcript para LLM entrada
 */
export function formatTranscriptForLLM(turns: TranscriptTurn[]): string {
    return turns.map(turn => {
        const label = turn.role === 'interviewer' ? 'INTERVIEWER' :
            turn.role === 'user' ? 'ME' : 'ASSISTANT';
        return `[${label}]: ${turn.text}`;
    }).join('\n');
}

/**
 * Completo pipeline: clean, sparsify, formata
 */
export function prepareTranscriptForWhatToAnswer(
    turns: TranscriptTurn[],
    maxTurns: number = 12
): string {
    const cleaned = cleanTranscript(turns);
    const sparsified = sparsifyTranscript(cleaned, maxTurns);
    return formatTranscriptForLLM(sparsified);
}
