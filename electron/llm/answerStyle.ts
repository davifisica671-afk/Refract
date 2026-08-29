// electron/llm/answerStyle.ts
//
// Adaptive answer-style engine (release 2026-06-08). Detects the REQUESTED
// style/length from the question's own phrasing ("briefly", "in one line",
// "code only", "as bullet points"…) and shapes FORM only — never routing,
// voice, grounding, or leak boundaries. Consumed by AnswerPlanner (threads
// style + target seconds into the plan and appends the STYLE directive to the
// prompt contract) and by the scaffold gate (code_only/one_liner suppress the
// six-section coding scaffold).
//
// Pure data + pure function. No I/O, no LLM — trivially testable, hot-path safe.

export type AnswerStyle =
    | 'default'
    | 'short'
    | 'detailed'
    | 'one_liner'
    | 'star'
    | 'code_only'
    | 'beginner'
    | 'bullets'
    | 'approach_first'
    | 'exam'
    | 'notes';

export interface AnswerStyleResult {
    style: AnswerStyle;
    /** Speakability budget the style implies (seconds of spoken answer). */
    targetSeconds: number;
    /** Prompt-contract directive. Empty for 'default' — no directive is added. */
    directive: string;
}

interface StyleRule {
    style: AnswerStyle;
    pattern: RegExp;
    targetSeconds: number;
    directive: string;
}

// Ordered by SPECIFICITY — the first match wins. Explicit format asks
// (code_only, one_liner) outrank length cues (short/detailed) so that
// "just give me the code, briefly" resolves to code_only, not short.
const STYLE_RULES: readonly StyleRule[] = [
    {
        style: 'code_only',
        pattern: /\bcode\s+only\b|\bonly\s+(?:the\s+)?code\b|\bjust\s+(?:give\s+me\s+|show\s+me\s+)?the\s+code\b|\bno\s+explanation,?\s+just\s+(?:the\s+)?code\b/i,
        targetSeconds: 20,
        directive: 'STYLE: Output ONLY the code in a single fenced block. No prose, no headings, no explanation.',
    },
    {
        style: 'one_liner',
        pattern: /\bin\s+(?:just\s+)?one\s+(?:line|sentence)\b|\bone[- ]liner\b|\btl;?dr\b|\bin\s+a\s+single\s+(?:line|sentence)\b/i,
        targetSeconds: 8,
        directive: 'STYLE: Answer in ONE short sentence. No preamble, no follow-up.',
    },
    {
        style: 'star',
        pattern: /\btell\s+me\s+about\s+a\s+time\b|\bdescribe\s+a\s+time\b|\ba\s+time\s+(?:you|when)\b|\bgive\s+(?:me\s+)?an\s+example\s+of\s+a\s+time\b|\b(?:use\s+(?:the\s+)?)?star\s+(?:format|method|structure)\b/i,
        targetSeconds: 60,
        directive: 'STYLE: Use the STAR structure (Situation, Task, Action, Result) told as a natural first-person story with a concrete outcome.',
    },
    {
        // "write a 6 marks answer on TCP" — exam-style sizing cue.
        style: 'exam',
        pattern: /\b\d+\s*marks?\b|\bexam\s+(?:style\s+)?answer\b/i,
        targetSeconds: 120,
        directive: 'STYLE: Write an exam-style answer sized to the marks requested — structured, complete, with definitions and key points an examiner awards marks for.',
    },
    {
        style: 'notes',
        pattern: /\b(?:make|take|prepare)\s+notes\b|\bstudy\s+notes\b|\brevision\s+notes\b/i,
        targetSeconds: 120,
        directive: 'STYLE: Produce structured study notes — headings, short bullet lines, definitions and formulas worth memorizing.',
    },
    {
        style: 'bullets',
        pattern: /\bbullet\s*points?\b|\bas\s+bullets\b|\bbulleted\s+list\b/i,
        targetSeconds: 30,
        directive: 'STYLE: Answer as concise bullet points — one idea per bullet, no long paragraphs.',
    },
    {
        style: 'beginner',
        pattern: /\bbeginner\b|\bsimple\s+terms\b|\beli5\b|\blike\s+i'?m\s+(?:5|five)\b|\blayman'?s?\b|\bnon[- ]technical\b/i,
        targetSeconds: 45,
        directive: 'STYLE: Explain in simple, beginner-friendly language. Use one concrete analogy. Avoid jargon — define any term you must use.',
    },
    {
        style: 'approach_first',
        pattern: /\bapproach\s+first\b|\bhow\s+would\s+you\s+approach\b|\bexplain\s+(?:your|the)\s+approach\b|\bbefore\s+(?:writing\s+|the\s+)?code,?\s+explain\b/i,
        targetSeconds: 45,
        directive: 'STYLE: Explain the approach and reasoning BEFORE any code or detail. Lead with the idea, not the implementation.',
    },
    {
        style: 'detailed',
        pattern: /\bin\s+detail\b|\bdetailed\b|\bin\s+depth\b|\bwalk\s+me\s+through\b|\bstep\s+by\s+step\b|\bthoroughly\b/i,
        targetSeconds: 90,
        directive: 'STYLE: Give a detailed, structured answer with concrete specifics and examples. Depth over brevity here.',
    },
    {
        style: 'short',
        pattern: /\bquickly\b|\bbriefly\b|\bbrief\b|\bthe\s+gist\b|\bin\s+short\b|\bshort\s+(?:version|answer)\b|\bkeep\s+it\s+short\b|\bsummar(?:y|ize|ise)\s+in\b/i,
        targetSeconds: 20,
        directive: 'STYLE: Keep it short — 2-3 spoken sentences maximum. Core message only.',
    },
];

const DEFAULT_RESULT: AnswerStyleResult = {
    style: 'default',
    targetSeconds: 30,
    directive: '',
};

/**
 * Detect the answer style the user EXPLICITLY asked for in the question.
 * Returns 'default' (empty directive) when no style cue is present — normal
 * questions must never be reshaped by a false positive, since the style
 * directive overrides length/format instructions downstream.
 */
export function detectAnswerStyle(question: string | null | undefined): AnswerStyleResult {
    const q = (question || '').trim();
    if (!q) return DEFAULT_RESULT;
    for (const rule of STYLE_RULES) {
        if (rule.pattern.test(q)) {
            return { style: rule.style, targetSeconds: rule.targetSeconds, directive: rule.directive };
        }
    }
    return DEFAULT_RESULT;
}

/**
 * Styles whose explicit format request REPLACES the six-section coding
 * scaffold ("code only", "in one line") — painting the full template and then
 * streaming a one-line answer into it would contradict the user's ask.
 */
export const styleSuppressesScaffold = (style: AnswerStyle): boolean =>
    style === 'code_only' || style === 'one_liner';
