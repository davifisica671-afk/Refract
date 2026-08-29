import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT } from "./prompts";
import { TINY_FOLLOW_UP_QUESTIONS_PROMPT } from "./tinyPrompts";

export class FollowUpQuestionsLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    private resolvePrompt(): string {
        return this.llmHelper.getPromptTier() === 'tiny' ? TINY_FOLLOW_UP_QUESTIONS_PROMPT : UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT;
    }

    async generate(context: string): Promise<string> {
        try {
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            const stream = this.llmHelper.streamChat(fittedContext, undefined, undefined, this.resolvePrompt());
            let full = "";
            for await (const chunk of stream) full += chunk;
            return full;
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Failed:", e);
            return "";
        }
    }

    async *generateStream(context: string): AsyncGenerator<string> {
        try {
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            yield* this.llmHelper.streamChat(fittedContext, undefined, undefined, this.resolvePrompt());
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Stream Failed:", e);
        }
    }
}
