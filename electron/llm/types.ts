/**
 * =============================================================================
 * llm/types.ts — TIPOS COMPARTILHADOS DO SISTEMA LLM
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Tipos e configurações compartilhadas por todos os módulos LLM.
 * Define os parâmetros de geração para cada modo de operação.
 * 
 * CONFIGURAÇÕES POR MODO:
 * - answer/assist/followUp/recap: Temperatura 0.25 (respostas consistentes)
 * - followUpQuestions: Temperatura 0.4 (mais criatividade para sugestões)
 * 
 * TEMPERATURA:
 * - 0.0: Determinístico (sempre a mesma resposta)
 * - 0.25: Muito baixo (respostas muito consistentes — ideal para entrevistas)
 * - 0.5: Moderado
 * - 1.0: Criativo (respostas variadas)
 * =============================================================================
 */

import { GoogleGenAI } from "@google/genai";

/**
 * Generation configuration para Gemini calls
 */
export interface GenerationConfig {
    maxOutputTokens: number;
    temperature: number;
    topP: number;
}

/**
 * Mode-specific token limits
 */
export const MODE_CONFIGS = {
    answer: {
        maxOutputTokens: 65536,
        temperature: 0.25,
        topP: 0.85,
    } as GenerationConfig,

    assist: {
        maxOutputTokens: 65536,
        temperature: 0.25,
        topP: 0.85,
    } as GenerationConfig,

    followUp: {
        maxOutputTokens: 65536,
        temperature: 0.25,
        topP: 0.85,
    } as GenerationConfig,

    recap: {
        maxOutputTokens: 65536,
        temperature: 0.25,
        topP: 0.85,
    } as GenerationConfig,

    followUpQuestions: {
        maxOutputTokens: 65536,
        temperature: 0.4, // Ligeiramente higher creative freedom
        topP: 0.9,
    } as GenerationConfig,
} as const;

/**
 * Gemini conteúdo structure
 */
export interface GeminiContent {
    role: "user" | "model";
    parts: { text: string }[];
}

/**
 * LLM cliente interface para dependency injection
 */
export interface LLMClient {
    getGeminiClient(): GoogleGenAI | null;
}
