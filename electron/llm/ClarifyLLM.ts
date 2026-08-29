// ClarifyLLM.ts
// Este arquivo implementa a classe ClarifyLLM, responsável por gerar perguntas
// de esclarecimento para entrevistas técnicas. Quando o contexto da conversa
// não é suficiente, este módulo gera perguntas de acompanhamento para obter
// mais informações antes de produzir uma resposta.

import { LLMHelper } from "../LLMHelper";
import { CLARIFY_MODE_PROMPT } from "./prompts";
import { TINY_CLARIFY_PROMPT } from "./tinyPrompts";

// Classe que gera perguntas de esclarecimento usando LLM
export class ClarifyLLM {
    // Instância do helper para interagir com o modelo de linguagem
    private llmHelper: LLMHelper;

    // Construtor que recebe o helper do LLM para injeção de dependência
    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Gera uma pergunta de esclarecimento
     * @param context - Contexto da conversa atual
     * @returns Promise<string> - A pergunta gerada pelo LLM
     */
    async generate(context: string): Promise<string> {
        if (!context.trim()) return "";
        try {
            // Seleciona o prompt baseado no tier do modelo configurado
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_CLARIFY_PROMPT : CLARIFY_MODE_PROMPT;
            // Ajusta o contexto para caber no limite de tokens do modelo atual
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            // Inicia o streaming da resposta do LLM
            const stream = this.llmHelper.streamChat(fittedContext, undefined, undefined, promptOverride);
            // Acumula os chunks recebidos do streaming
            let fullResponse = "";
            for await (const chunk of stream) fullResponse += chunk;
            return fullResponse.trim();
        } catch (error) {
            console.error("[ClarifyLLM] Generation failed:", error);
            return "";
        }
    }

    /**
     * Gera uma pergunta de esclarecimento (via streaming)
     * @param context - Contexto da conversa atual
     * @returns AsyncGenerator<string> - Generator que yields chunks da resposta
     */
    async *generateStream(context: string): AsyncGenerator<string> {
        if (!context.trim()) return;
        try {
            // Seleciona o prompt baseado no tier do modelo configurado
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_CLARIFY_PROMPT : CLARIFY_MODE_PROMPT;
            // Ajusta o contexto para caber no limite de tokens do modelo atual
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            // Faz yield direto dos chunks do streaming
            yield* this.llmHelper.streamChat(fittedContext, undefined, undefined, promptOverride);
        } catch (error) {
            console.error("[ClarifyLLM] Streaming generation failed:", error);
        }
    }
}
