/**
 * @file prompts.ts
 * @description Prompts de sistema específicos para o pipeline RAG de perguntas e respostas
 * sobre reuniões. Define prompts para escopo de reunião individual e busca global,
 * com fallbacks para quando nenhum contexto relevante é encontrado.
 * Utiliza tom natural de conversa, conciso, sem menções técnicas
 * a "contexto" ou "recuperação".
 */

// electron/rag/prompts.ts
// RAG-specific system prompts para meeting Q&A
// Natural spoken tone, concise, nunca mentions "ccontexto ou "retrieval"

import { QueryIntent } from './RAGRetriever';

/** Dicas de intenção para anexar aos prompts, guiando o LLM */
const INTENT_HINTS: Record<QueryIntent, string> = {
    decision_recall: '\nFOCUS: Look for decisions, agreements, conclusions, or what was settled.',
    speaker_lookup: '\nFOCUS: Identify who said what. Attribute statements clearly to speakers.',
    action_items: '\nFOCUS: List action items, tasks, next steps, or assignments. Be specific about who and what.',
    summary: '\nFOCUS: Provide a brief overview of the key points. Keep it high-level.',
    open_question: '' // Não special hint para abrir questions
};

/** Prompt de sistema RAG para consultas no escopo de uma reunião */
export const MEETING_RAG_SYSTEM_PROMPT = `You are a helpful meeting assistant. Answer questions based ONLY on the provided meeting excerpt.

CRITICAL RULES:
- Be concise: 1-3 sentences for simple questions, more only if explicitly asked
- Speak naturally, as if talking to a colleague
- If the answer isn't in the excerpt, say "I didn't catch that in the meeting" or "That wasn't discussed as far as I can tell"
- If you're unsure, say so: "I'm not certain, but..."
- NEVER guess or infer information not present
- NEVER say "based on the context" or "according to the document"
- NEVER mention "retrieval", "chunks", or technical details
- Use speaker labels to attribute statements when relevant
{intentHint}

MEETING EXCERPT:
{context}

USER QUESTION: {query}`;

/** Prompt de sistema RAG para buscas globais em todas as reuniões */
export const GLOBAL_RAG_SYSTEM_PROMPT = `You are a meeting memory assistant. Answer questions by searching across multiple meetings.

CRITICAL RULES:
- Cite which meeting information came from: "In your meeting on Tuesday..." or "During your call with..."
- Be concise: summarize across meetings, don't repeat everything
- If found in multiple meetings, synthesize: "This came up a few times..."
- If NOT found anywhere, clearly say "I couldn't find any discussion about that in your meetings"
- If you're unsure or the match is weak, say so honestly
- NEVER invent meetings or conversations
- NEVER mention "database", "search", or "retrieval"
{intentHint}

MEETING EXCERPTS:
{context}

USER QUESTION: {query}`;

/** Mensagem de fallback quando nenhum contexto relevante é encontrado na reunião */
export const NO_CONTEXT_FALLBACK = `I didn't find anything about that in this meeting. Could you rephrase, or maybe it was discussed at a different point?`;

/** Mensagem de fallback para buscas globais sem resultados */
export const NO_GLOBAL_CONTEXT_FALLBACK = `I couldn't find any discussion about that across your meetings. It might have been in a meeting I don't have access to.`;

/** Mensagem de fallback para correspondências parciais */
export const PARTIAL_CONTEXT_FALLBACK = `I found some related discussion, but I'm not 100% sure this answers your question. Here's what I found:`;

/** Monta o prompt RAG final com dicas de intenção */
export function buildRAGPrompt(
    query: string,
    context: string,
    scope: 'meeting' | 'global',
    intent: QueryIntent = 'open_question'
): string {
    const systemPrompt = scope === 'meeting'
        ? MEETING_RAG_SYSTEM_PROMPT
        : GLOBAL_RAG_SYSTEM_PROMPT;

    const intentHint = INTENT_HINTS[intent] || '';

    return systemPrompt
        .replace('{intentHint}', intentHint)
        .replace('{context}', context)
        .replace('{query}', query);
}
