import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_RECAP_PROMPT } from "./prompts";
import { TINY_RECAP_PROMPT } from "./tinyPrompts";

export class RecapLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a neutral conversation summary
     */
    async generate(context: string): Promise<string> {
        if (!context.trim()) return "";
        try {
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_RECAP_PROMPT : UNIVERSAL_RECAP_PROMPT;
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            const stream = this.llmHelper.streamChat(fittedContext, undefined, undefined, promptOverride);
            let fullResponse = "";
            for await (const chunk of stream) fullResponse += chunk;
            return this.clampRecapResponse(fullResponse);
        } catch (error) {
            console.error("[RecapLLM] Generation failed:", error);
            return "";
        }
    }

    /**
     * Generate a neutral conversation summary (Streamed)
     */
    async *generateStream(context: string): AsyncGenerator<string> {
        if (!context.trim()) return;
        try {
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_RECAP_PROMPT : UNIVERSAL_RECAP_PROMPT;
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            yield* this.llmHelper.streamChat(fittedContext, undefined, undefined, promptOverride);
        } catch (error) {
            console.error("[RecapLLM] Streaming generation failed:", error);
        }
    }

    private clampRecapResponse(text: string): string {
        if (!text) return "";
        const lines = text.split('\n');
        const isBulletStart = (s: string) => /^\s*([-*•]|\d+\.)\s+/.test(s);
        const groups: string[][] = [];
        let cur: string[] | null = null;
        let anyBullet = false;
        for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            if (isBulletStart(raw)) {
                anyBullet = true;
                cur = [line];
                groups.push(cur);
            } else if (cur) {
                cur.push(line);
            } else {
                // Pre-bullet leading lines: treat como standalone groups (used em alternativa pacaminho
                groups.push([line]);
            }
        }
        if (!anyBullet) {
            // Fallback: original behavior — primeiro 5 non-empty lines.
            return lines.map(l => l.trim()).filter(Boolean).slice(0, 5).join('\n');
        }
        const bullets = groups.filter(g => isBulletStart(g[0])).slice(0, 5);
        return bullets.map(g => g.join(' ')).join('\n');
    }
}
