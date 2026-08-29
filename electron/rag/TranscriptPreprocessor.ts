/**
 * @file TranscriptPreprocessor.ts
 * @description Pré-processador de transcrições para o pipeline RAG.
 * Realiza limpeza avançada de texto, remoção de palavras de preenchimento (fillers),
 * normalização de rótulos de falante e detecção semântica de marcadores
 * como perguntas, decisões e itens de ação. Mescla segmentos consecutivos
 * do mesmo falante e estima contagem de tokens.
 */

// electron/rag/TranscriptPreprocessor.ts
// Enhanced transcript cleaning para RAG - estende existing transcriptCleaner.ts patterns
// Adiciona semantic detection (questions, decisions, ação items)

/** Segmento bruto de transcrição com texto, falante e timestamp */
export interface RawSegment {
    speaker: string;
    text: string;
    timestamp: number;  // ms
}

/** Segmento processado com texto limpo, timestamps e marcadores semânticos */
export interface CleanedSegment {
    speaker: string;
    text: string;
    startMs: number;
    endMs: number;
    isQuestion: boolean;
    isDecision: boolean;
    isActionItem: boolean;
}

// Palavras de preenchimento para remoção (estendido de transcriptCleaner.ts)
const FILLERS = new Set([
    'uh', 'um', 'ah', 'hmm', 'hm', 'er', 'erm',
    'like', 'you know', 'i mean', 'basically', 'actually',
    'so', 'well', 'anyway', 'anyways'
]);

// Confirmações (acknowledgements) para remoção
const ACKNOWLEDGEMENTS = new Set([
    'okay', 'ok', 'yeah', 'yes', 'right', 'sure', 'got it',
    'gotcha', 'uh-huh', 'uh huh', 'mm-hmm', 'mm hmm', 'mhm',
    'cool', 'great', 'nice', 'perfect', 'alright', 'all right'
]);

// Padrões de detecção para marcadores semânticos
const QUESTION_PATTERNS = [
    /\?$/,
    /^(what|who|when|where|why|how|can|could|would|should|is|are|do|does|did)\b/i
];

// Padrões para detecção de decisões
const DECISION_PATTERNS = [
    /\b(decided|agreed|confirmed|approved|let's go with|we'll do|going with)\b/i
];

// Padrões para detecção de itens de ação
const ACTION_PATTERNS = [
    /\b(will|going to|need to|should|must|action item|todo|follow up|follow-up)\b/i,
    /\b(by|before|deadline|next week|tomorrow|end of day|eod)\b/i
];

/** Limpa um segmento de texto: remove fillers e normaliza pontuação */
function cleanText(text: string): string {
    let result = text.trim();

    // Remove repeated words (yeah yeah, okay okay)
    result = result.replace(/\b(\w+)(\s+\1)+\b/gi, '$1');

    // Divide dentro de words e filtrar fillers
    const words = result.split(/\s+/);
    const cleaned = words.filter(word => {
        const normalized = word.toLowerCase().replace(/[.,!?;:]/g, '');
        return !FILLERS.has(normalized) && !ACKNOWLEDGEMENTS.has(normalized);
    });

    // Reconstruct
    result = cleaned.join(' ').trim();

    // Clean para cima punctuation
    result = result.replace(/\s+([.,!?;:])/g, '$1');
    result = result.replace(/([.,!?;:])+/g, '$1');
    result = result.replace(/\s+/g, ' ');

    return result;
}

/** Normaliza rótulos de falante para consistência */
function normalizeSpeaker(speaker: string): string {
    const lower = speaker.toLowerCase();
    if (lower === 'interviewer' || lower === 'speaker') {
        return 'Speaker';
    }
    if (lower === 'user' || lower === 'me') {
        return 'You';
    }
    if (lower === 'assistant' || lower === 'refract') {
        return 'Refract';
    }
    // Keep original se it looks como a nome
    return speaker;
}

/** Verifica se o texto contém uma pergunta */
function detectQuestion(text: string): boolean {
    return QUESTION_PATTERNS.some(pattern => pattern.test(text));
}

/** Verifica se o texto contém um marcador de decisão */
function detectDecision(text: string): boolean {
    return DECISION_PATTERNS.some(pattern => pattern.test(text));
}

/** Verifica se o texto contém um marcador de item de ação */
function detectActionItem(text: string): boolean {
    return ACTION_PATTERNS.some(pattern => pattern.test(text));
}

/** Mescla segmentos consecutivos do mesmo falante para reduzir fragmentação */
function mergeConsecutiveSpeakerSegments(
    segments: RawSegment[]
): { speaker: string; text: string; startMs: number; endMs: number }[] {
    if (segments.length === 0) return [];

    const merged: { speaker: string; text: string; startMs: number; endMs: number }[] = [];
    let current = {
        speaker: segments[0].speaker,
        text: segments[0].text,
        startMs: segments[0].timestamp,
        endMs: segments[0].timestamp
    };

    for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        const gap = seg.timestamp - current.endMs;

        // Mescla se mesmo speaker e gap < 5 seconds
        if (seg.speaker === current.speaker && gap < 5000) {
            current.text += ' ' + seg.text;
            current.endMs = seg.timestamp;
        } else {
            merged.push(current);
            current = {
                speaker: seg.speaker,
                text: seg.text,
                startMs: seg.timestamp,
                endMs: seg.timestamp
            };
        }
    }

    merged.push(current);
    return merged;
}

/** Pipeline principal de pré-processamento: limpa, mescla e anota segmentos brutos */
export function preprocessTranscript(segments: RawSegment[]): CleanedSegment[] {
    if (segments.length === 0) return [];

    // 1. Mescla consecutive segments de mesmo speaker
    const merged = mergeConsecutiveSpeakerSegments(segments);

    // 2. Clean e annotate cada segment
    const cleaned: CleanedSegment[] = [];

    for (const seg of merged) {
        const text = cleanText(seg.text);

        // Pular se também curto após cleaning (menos than 3 words)
        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
        if (wordCount < 3) continue;

        cleaned.push({
            speaker: normalizeSpeaker(seg.speaker),
            text,
            startMs: seg.startMs,
            endMs: seg.endMs,
            isQuestion: detectQuestion(text),
            isDecision: detectDecision(text),
            isActionItem: detectActionItem(text)
        });
    }

    return cleaned;
}

/** Estima contagem de tokens para uma string de texto (~4 caracteres por token) */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}
