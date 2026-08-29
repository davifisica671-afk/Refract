import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOWUP_PROMPT } from "./prompts";
import { TINY_FOLLOWUP_PROMPT } from "./tinyPrompts";

export class FollowUpLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    private resolvePrompt(): string {
        return this.llmHelper.getPromptTier() === 'tiny' ? TINY_FOLLOWUP_PROMPT : UNIVERSAL_FOLLOWUP_PROMPT;
    }

    async generate(previousAnswer: string, refinementRequest: string, context?: string): Promise<string> {
        try {
            const message = `PREVIOUS ANSWER:\n${previousAnswer}\n\nREQUEST: ${refinementRequest}`;
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
            const stream = this.llmHelper.streamChat(message, undefined, fittedContext, this.resolvePrompt());
            let full = "";
            for await (const chunk of stream) full += chunk;
            return full;
        } catch (e) {
            console.error("[FollowUpLLM] Failed:", e);
            return "";
        }
    }

    async *generateStream(previousAnswer: string, refinementRequest: string, context?: string): AsyncGenerator<string> {
        try {
            const message = `PREVIOUS ANSWER:\n${previousAnswer}\n\nREQUEST: ${refinementRequest}`;
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
            yield* this.llmHelper.streamChat(message, undefined, fittedContext, this.resolvePrompt());
        } catch (e) {
            console.error("[FollowUpLLM] Stream Failed:", e);
        }
    }
}
