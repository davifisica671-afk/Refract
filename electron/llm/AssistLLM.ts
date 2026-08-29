// AssistLLM.ts
// Este arquivo implementa a classe AssistLLM, responsável por gerar insights
// de observação passiva para o modo Assist. Este modo fornece breves observações
// sobre o que está acontecendo na conversa, sem sugerir o que o candidato deve dizer.
// É um modo de baixa prioridade que apenas observa e resume a situação atual.

import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_ASSIST_PROMPT } from "./prompts";
import { TINY_ASSIST_PROMPT } from "./tinyPrompts";

// Classe que gera insights de observação passiva usando LLM
export class AssistLLM {
    // Instância do helper para interagir com o modelo de linguagem
    private llmHelper: LLMHelper;

    // Construtor que recebe o helper do LLM para injeção de dependência
    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Gera um insight de observação passiva
     * @param context - Contexto da conversa atual
     * @param abortSignal - Sinal de cancelamento opcional
     * @returns Promise<string> - O insight gerado (sem pós-processamento; o prompt garante brevidade)
     */
    async generate(context: string, abortSignal?: AbortSignal): Promise<string> {
        try {
            if (!context.trim()) {
                return "";
            }

            // Lógica centralizada do LLM
            // Fornece uma instrução específica como mensagem usando UNIVERSAL_ASSIST_PROMPT como system prompt
            const instruction = "Briefly summarize what is happening right now in 1-2 sentences. Do not give advice, just observation.";

            // Seleciona o prompt baseado no tier do modelo configurado
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_ASSIST_PROMPT : UNIVERSAL_ASSIST_PROMPT;
            // Ajusta o contexto para caber no limite de tokens do modelo atual
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            // Acumula os chunks recebidos do streaming
            let result = "";
            for await (const chunk of this.llmHelper.streamChat(
                instruction,
                undefined,
                fittedContext,
                promptOverride,
                false,
                true,
                [],
                abortSignal,
            )) {
                // Se o sinal de cancelamento foi acionado, retorna string vazia
                if (abortSignal?.aborted) return "";
                result += chunk;
            }
            return result;

        } catch (error) {
            console.error("[AssistLLM] Generation failed:", error);
            return "";
        }
    }
}
