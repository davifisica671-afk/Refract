// CodeHintLLM.ts
// Este arquivo implementa a classe CodeHintLLM, responsável por gerar dicas
// de código a partir de screenshots ou contexto de transcrição. O módulo analisa
// imagens de código-fonte capturadas do editor do usuário e fornece sugestões
// contextuais via streaming, verificando capacidades de visão do modelo.

import { LLMHelper } from "../LLMHelper";
import { CODE_HINT_PROMPT, buildCodeHintMessage } from "./prompts";
import { TINY_CODE_HINT_PROMPT } from "./tinyPrompts";

// Classe que gera dicas de código a partir de screenshots usando LLM
export class CodeHintLLM {
    // Instância do helper para interagir com o modelo de linguagem
    private llmHelper: LLMHelper;

    // Construtor que recebe o helper do LLM para injeção de dependência
    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Gera dicas de código via streaming
     * @param imagePaths - Caminhos das imagens/screenshots capturados
     * @param questionContext - Contexto da pergunta do usuário
     * @param questionSource - Fonte da pergunta ('screenshot' ou 'transcript')
     * @param transcriptContext - Contexto adicional da transcrição
     * @returns AsyncGenerator<string> - Generator que yields chunks da resposta
     */
    async *generateStream(
        imagePaths?: string[],
        questionContext?: string,
        questionSource?: 'screenshot' | 'transcript' | null,
        transcriptContext?: string
    ): AsyncGenerator<string> {
        try {
            // Se imagens são necessárias mas o modelo não suporta visão, falha com mensagem clara
            if (imagePaths?.length) {
                const caps = this.llmHelper.getCapabilities();
                if (!caps.supportsImages) {
                    yield `The current local model (${caps.name}) doesn't support image input. Switch to a vision-capable model (e.g. llava, llama3.2-vision, gemma3) or use a cloud model.`;
                    return;
                }
            }

            // Constrói a mensagem com base no contexto da pergunta e transcrição
            const message = buildCodeHintMessage(
                questionContext ?? null,
                questionSource ?? null,
                transcriptContext ?? null
            );

            // Seleciona o prompt baseado no tier do modelo configurado
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_CODE_HINT_PROMPT : CODE_HINT_PROMPT;
            // Ajusta a mensagem para caber no limite de tokens do modelo atual
            const fittedMessage = this.llmHelper.fitContextForCurrentModel(message);

            // Faz yield direto dos chunks do streaming com suporte a imagens
            yield* this.llmHelper.streamChat(
                fittedMessage,
                imagePaths,
                undefined,
                promptOverride
            );
        } catch (error) {
            console.error("[CodeHintLLM] Stream failed:", error);
            yield "I couldn't analyze the screenshot. Make sure your code is visible and try again.";
        }
    }
}
