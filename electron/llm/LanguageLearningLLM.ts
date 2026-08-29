import { LLMHelper } from "../LLMHelper";
import { MODE_LANGUAGE_LEARNING_PROMPT } from "./prompts";

export interface TranslationResult {
    translation: string;
    suggestedReply: string;
}

export class LanguageLearningLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async *generateStream(
        transcript: string,
        targetLanguage: string,
        sourceLanguage: string,
        conversationHistory: Array<{ role: string; content: string }> = [],
    ): AsyncGenerator<string> {
        const historySnippet = conversationHistory
            .slice(-6)
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n");

        const message = [
            `Target language: ${targetLanguage}`,
            `Source language: ${sourceLanguage}`,
            historySnippet ? `Recent conversation:\n${historySnippet}` : "",
            "",
            `Transcript segment (what the other person just said):`,
            transcript,
        ]
            .filter(Boolean)
            .join("\n");

        const fittedMessage = this.llmHelper.fitContextForCurrentModel(message);
        yield* this.llmHelper.streamChat(
            fittedMessage,
            undefined,
            undefined,
            MODE_LANGUAGE_LEARNING_PROMPT,
            true,   // ignoreKnowledgeMode
            true,   // skipModeInjection — we provide our own prompt
        );
    }

    static parseResponse(raw: string): TranslationResult | null {
        const translationMatch = raw.match(
            /\[TRANSLATION\]\s*([\s\S]*?)\s*\[\/TRANSLATION\]/,
        );
        const suggestionMatch = raw.match(
            /\[SUGGESTION\]\s*([\s\S]*?)\s*\[\/SUGGESTION\]/,
        );

        if (translationMatch && suggestionMatch) {
            return {
                translation: translationMatch[1].trim(),
                suggestedReply: suggestionMatch[1].trim(),
            };
        }
        return null;
    }
}
