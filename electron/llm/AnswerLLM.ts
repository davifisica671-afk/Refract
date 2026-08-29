// AnswerLLM.ts
// Este arquivo implementa a classe AnswerLLM, responsável por gerar respostas
// para entrevistas técnicas usando um modelo de linguagem (LLM). A classe orquestra
// a construção do prompt, a seleção do modelo adequado e a geração da resposta
// através de streaming, retornando o texto final formatado.

import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_ANSWER_PROMPT } from "./prompts";
import { TINY_ANSWER_PROMPT } from "./tinyPrompts";
import { formatAnswerPlanForPrompt } from "./AnswerPlanner";
import type { AnswerPlan } from "./AnswerPlanner";
import { isCodeVerificationEnabled } from "./codeVerification/verificationEnabled";

// Classe principal que gera respostas para perguntas de entrevista usando LLM
export class AnswerLLM {
    // Instância do helper para interagir com o modelo de linguagem
    private llmHelper: LLMHelper;

    // Construtor que recebe o helper do LLM para injeção de dependência
    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Gera uma resposta oral para entrevista técnica
     * @param question - A pergunta feita pelo entrevistador
     * @param context - Contexto adicional (opcional)
     * @param answerPlan - Plano de resposta estruturado (opcional)
     * @returns Promise<string> - A resposta gerada pelo LLM
     */
    async generate(question: string, context?: string, answerPlan?: AnswerPlan): Promise<string> {
        try {
            // Seleciona o prompt baseado no tier do modelo configurado
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_ANSWER_PROMPT : UNIVERSAL_ANSWER_PROMPT;
            // Formata o plano de resposta se fornecido, incluindo verificação de código se habilitada
            const answerContract = answerPlan ? `\n\n${formatAnswerPlanForPrompt(answerPlan, isCodeVerificationEnabled())}` : '';
            // Ajusta o contexto para caber no limite de tokens do modelo atual
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(`${context}${answerContract}`) : answerContract.trim() || context;
            // Inicia o streaming da resposta do LLM
            const stream = this.llmHelper.streamChat(question, undefined, fittedContext, promptOverride);

            // Acumula os chunks recebidos do streaming
            let fullResponse = "";
            for await (const chunk of stream) {
                fullResponse += chunk;
            }
            // Retorna a resposta completa, removendo espaços em branco extras
            return fullResponse.trim();

        } catch (error) {
            // Em caso de erro, registra no console e retorna string vazia
            console.error("[AnswerLLM] Generation failed:", error);
            return "";
        }
    }
}
