// BrainstormLLM.ts
// Este arquivo implementa a classe BrainstormLLM, responsável por gerar scripts
// de "pensamento em voz alta" para sessões de brainstorming. O LLM recebe o
// contexto da conversa e gera abordagens de raciocínio em streaming, simulando
// um processo de brainstorming iterativo.

import { LLMHelper } from "../LLMHelper";
import { BRAINSTORM_MODE_PROMPT } from "./prompts";
import { TINY_BRAINSTORM_PROMPT } from "./tinyPrompts";

// Classe que gera scripts de brainstorming via streaming usando LLM
export class BrainstormLLM {
    // Instância do helper para interagir com o modelo de linguagem
    private llmHelper: LLMHelper;

    // Construtor que recebe o helper do LLM para injeção de dependência
    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Gera um script de "pensamento em voz alta" (via streaming)
     * O contexto é passado diretamente como mensagem do usuário para que o LLM veja o problema.
     * @param context - Contexto/descrição do problema para brainstorm
     * @param imagePaths - Caminhos de imagens opcionais para análise visual
     * @returns AsyncGenerator<string> - Generator que yields chunks da resposta
     */
    async *generateStream(context: string, imagePaths?: string[]): AsyncGenerator<string> {
        if (!context.trim() && !imagePaths?.length) return;
        try {
            // Seleciona o prompt baseado no tier do modelo configurado
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_BRAINSTORM_PROMPT : BRAINSTORM_MODE_PROMPT;
            // Ajusta o contexto para caber no limite de tokens do modelo atual
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
            // Faz yield direto dos chunks do streaming
            yield* this.llmHelper.streamChat(fittedContext, imagePaths, undefined, promptOverride);
        } catch (error) {
            console.error("[BrainstormLLM] Stream failed:", error);
            yield "I couldn't generate brainstorm approaches. Make sure your question is visible and try again.";
        }
    }
}
