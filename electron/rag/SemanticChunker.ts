/**
 * @file SemanticChunker.ts
 * @description Divisão semântica de transcrições em blocos (chunks) para o pipeline RAG.
 * Agrupa segmentos por turnos de falante, respeitando limites de tokens,
 * e utiliza sobreposição de janela deslizante para preservar contexto
 * entre fronteiras de blocos. Suporta filtragem por falante e
 * estimativa de contagem de tokens.
 */

// electron/rag/SemanticChunker.ts
// Turn-based semantic chunking para RAG
// Chunks por speaker turns, respects token limits
// Uses sliding-window overlap para preserve contexto através chunk boundaries

import { CleanedSegment, estimateTokens } from './TranscriptPreprocessor';

/** Bloco de transcrição com metadados de posição e contagem de tokens */
export interface Chunk {
    meetingId: string;
    chunkIndex: number;
    speaker: string;
    startMs: number;
    endMs: number;
    text: string;
    tokenCount: number;
}

// Parâmetros de chunking
const TARGET_TOKENS = 300; // Meta de tokens por bloco
const MAX_TOKENS = 400;    // Limite máximo de tokens por bloco
const MIN_TOKENS = 100;    // Mínimo de tokens para criar um bloco

// Sobreposição de janela deslizante: manter últimos N segmentos (~50 tokens) do bloco anterior
const OVERLAP_TARGET_TOKENS = 50;

/** Monta um bloco a partir de segmentos acumulados */
function buildChunk(
    meetingId: string,
    index: number,
    segments: CleanedSegment[]
): Chunk {
    const text = segments.map(s => s.text).join(' ');
    return {
        meetingId,
        chunkIndex: index,
        speaker: segments[0].speaker,
        startMs: segments[0].startMs,
        endMs: segments[segments.length - 1].endMs,
        text,
        tokenCount: estimateTokens(text)
    };
}

/** Calcula quantos segmentos finais manter como sobreposição entre blocos */
function calculateOverlap(segments: CleanedSegment[]): { overlapSegments: CleanedSegment[], overlapTokens: number } {
    let tokens = 0;
    let count = 0;

    // Walk backwards de o etermina accumulating tokens
    for (let i = segments.length - 1; i >= 0; i--) {
        const segTokens = estimateTokens(segments[i].text);
        if (tokens + segTokens > OVERLAP_TARGET_TOKENS && count > 0) {
            break; // Adding this segment iria exceed nosso budget
        }
        tokens += segTokens;
        count++;
        // Keep at maioria 2 segments como overlap
        if (count >= 2) break;
    }

    const overlapSegments = segments.slice(segments.length - count);
    return { overlapSegments, overlapTokens: tokens };
}

/**
 * Algoritmo de chunking semântico com sobreposição de janela deslizante.
 * Agrupa por turnos de falante, mescla segmentos curtos, divide por limite
 * de tokens e preserva contexto entre blocos via sobreposição.
 */
export function chunkTranscript(
    meetingId: string,
    segments: CleanedSegment[]
): Chunk[] {
    if (segments.length === 0) return [];

    const chunks: Chunk[] = [];
    let currentChunk: CleanedSegment[] = [];
    let currentTokens = 0;
    let chunkIndex = 0;

    for (const seg of segments) {
        const segTokens = estimateTokens(seg.text);

        // Decide se para inicia a novo chunk
        const shouldSplit =
            // Speaker changed e we ter content
            (currentChunk.length > 0 && seg.speaker !== currentChunk[0].speaker) ||
            // Iria exceed max tokens e we ter minimum content
            (currentTokens + segTokens > MAX_TOKENS && currentTokens >= MIN_TOKENS);

        if (shouldSplit && currentChunk.length > 0) {
            chunks.push(buildChunk(meetingId, chunkIndex++, currentChunk));

            // Sliding window: carry último 1-2 segments como overlap dentro de o novo chunk
            // This preserves semantic contexto através chunk boundaries
            // Apenas carry overlap se o próximo segment é de o Mesmo speaker
            // (speaker changes são natural boundaries — não overlap needed)
            if (seg.speaker === currentChunk[currentChunk.length - 1].speaker) {
                const { overlapSegments, overlapTokens } = calculateOverlap(currentChunk);
                currentChunk = [...overlapSegments];
                currentTokens = overlapTokens;
            } else {
                currentChunk = [];
                currentTokens = 0;
            }
        }

        currentChunk.push(seg);
        currentTokens += segTokens;

        // Force divide se único segment exceeds max (rare edge case)
        if (currentTokens > MAX_TOKENS && currentChunk.length === 1) {
            chunks.push(buildChunk(meetingId, chunkIndex++, currentChunk));
            currentChunk = [];
            currentTokens = 0;
        }
    }

    // Flush remaining segments
    if (currentChunk.length > 0) {
        chunks.push(buildChunk(meetingId, chunkIndex++, currentChunk));
    }

    return chunks;
}

/** Formata um bloco para exibição no contexto da consulta */
export function formatChunkForContext(chunk: Chunk): string {
    const minutes = Math.floor(chunk.startMs / 60000);
    const seconds = Math.floor((chunk.startMs % 60000) / 1000);
    const timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return `[${timestamp}] ${chunk.speaker}: ${chunk.text}`;
}
