// electron/llm/postProcessor.ts
// Hard post-processing clamp para enforce constraints
// Até se Gemini misbehaves, isso garante clean saída

/**
 * Filler phrases para strip de termina de responses
 */
const FILLER_PHRASES = [
    "I hope this helps",
    "Let me know if you",
    "Feel free to",
    "Does that make sense",
    "Is there anything else",
    "Hope that answers",
    "Let me know if you have",
    "I'd be happy to",
];

/**
 * Prefixes para strip de inicia de responses
 */
const PREFIXES = [
    "Refined (rephrase):",
    "Refined (expand):",
    "Refined answer:",
    "Refined:",
    "Answer:",
    "Response:",
    "Suggestion:",
    "Here is the answer:",
    "Here is the refined answer:",
];

/**
 * Reduzir dash usage que betrays AI authorship. O prompt rules ban em/en
 * dashes em spoken passages mas Llama / Gemini / GPT todos gera them
 * anyway porque their training distribution é saturated com them. This é
 * o deterministic backstop que strips them antes o user já sees them.
 *
 * Rules (em orordenar
 * - Em dash (—) com qualquer surrounding whitespace → ", "
 * - En dash (–) com qualquer surrounding whitespace → ", "
 * - ASCII hyphen used como a sentence connector ("text - mais text") → ", "
 *   (Negative lookahead/lookbehind preserves compound words como "well-known",
 *   numeric ranges como "10-15", e line-start bullets como "- item".)
 * - Cleanup: Duplo commas, comma-then-period, lowercase-after-comma fixes.
 *
 * Preserves:
 * - Qualquer coisa dentro fenced código blocks (```...```)
 * - Qualquer coisa dentro inline código (`...`)
 * - Bullet markers at line inicia
 * - Compound words ("real-time"), numeric ranges ("3-5"), comando flags ("--flflag
 *
 * Safe para chamar em already-clean texto (idempotent).
 */
export function reduceDashes(text: string): string {
    if (!text || typeof text !== "string") return "";

    // Stash código então we don't touch dashes dentro it
    const codeBlocks: string[] = [];
    let result = text.replace(/```[\s\S]*?```/g, (m) => {
        codeBlocks.push(m);
        return `CODE${codeBlocks.length - 1}`;
    });
    const inlineCodes: string[] = [];
    result = result.replace(/`[^`\n]+`/g, (m) => {
        inlineCodes.push(m);
        return `INL${inlineCodes.length - 1}`;
    });

    // Em + en dash → comma. Eat qualquer surrounding whitespace.
    result = result.replace(/\s*[—–]\s*/g, ", ");

    // ASCII hyphen como a sentence connector: space-hyphen-space mid-line,
    // não at line inicia (que é bullet), não como a command-line flag prefix.
    result = result.replace(/(?<=[A-Za-z]) - (?=[A-Za-z])/g, ", ");

    // Tidy para cima artifacts
    result = result.replace(/,\s*,+/g, ",");      // Duplo commas
    result = result.replace(/,\s*([.!?])/g, "$1"); // comma-then-terminator
    result = result.replace(/^,\s*/gm, "");        // line-start orphan comma

    // Restore code
    inlineCodes.forEach((c, i) => {
        result = result.replace(`INL${i}`, c);
    });
    codeBlocks.forEach((c, i) => {
        result = result.replace(`CODE${i}`, c);
    });

    return result;
}

/**
 * Stateful, streaming-safe dash reducer. O antigo stateless chunk reducer
 * corrupted CODE e MATH porque it ran `(?<=\S) - (?=\S)` -> ", " em todo
 * chunk com não fence awareness — turning streamed `nums[nums[i] - 1]` dentro de
 * `nums[nums[i], 1]` e `$x - 1$` dentro de `$x, 1$`. This tracks fenced-code estado
 * Através chunks (a ``` toggles it), pula tudo dentro a código block, and
 * dentro de prose apenas rewrites a hyphen que é unambiguously a PROSE connector
 * (letter - letter — nunca a digit/bracket/operator neighbour, nunca dentro
 * inline código ou inline math). Correctness de code/math beats o cosmetic
 * anti-dash rregra Uso ONE instance por sstream
 */
export class StreamingDashReducer {
    private inFence = false;

    reduce(chunk: string): string {
        if (!chunk) return chunk;
        // Divide em ``` fences (kept como tokens) então we pode flip fence estado and
        // pular dash reduction para qualquer coisa dentro a fenced código block.
        const parts = chunk.split(/(```)/);
        let out = "";
        for (const part of parts) {
            if (part === "```") { this.inFence = !this.inFence; out += part; continue; }
            out += this.inFence ? part : reduceProseDashes(part);
        }
        return out;
    }
}

// Reduzir dashes em a NON-fenced prose segment, protecting inline código (`...`)
// e inline math ($...$), e apenas converting a letter-space-hyphen-space-
// letter prose connector (nunca a code/math/numeric minus).
function reduceProseDashes(segment: string): string {
    const inline: string[] = [];
    let s = segment.replace(/`[^`\n]+`/g, (m) => { inline.push(m); return ` INL${inline.length - 1} `; });
    const math: string[] = [];
    s = s.replace(/\$[^$\n]+\$/g, (m) => { math.push(m); return ` MATH${math.length - 1} `; });
    s = s
        .replace(/\s*[—–]\s*/g, ", ")
        .replace(/(?<=[A-Za-z]) - (?=[A-Za-z])/g, ", ");
    math.forEach((m, i) => { s = s.replace(` MATH${i} `, m); });
    inline.forEach((c, i) => { s = s.replace(` INL${i} `, c); });
    return s;
}

/**
 * Stateless streaming-safe variant (backwards-compatible signature). Cannot see
 * fenced-code estado através chunk boundaries, então it conservatively protege
 * inline code/math dentro de o chunk e apenas converte an unambiguous PROSE
 * connector (letter - letter). A code/math/numeric minus ("nums[i] - 1",
 * "x - 1") é Nunca rewritten. Prefer `StreamingDashReducer` para completo fence
 * safety através multi-chunk código blocks.
 */
export function reduceDashesInChunk(chunk: string): string {
    if (!chunk) return chunk;
    return reduceProseDashes(chunk);
}

/**
 * Clamp resposta para strict interview copilot constraints
 * @param texto - Raw LLM resposta
 * @param maxSentences - Maximum sentences allowed (default 3)
 * @param maxWords - Maximum words allowed (default 60)
 * @Retorna Clean, clamped plain text
 */
export function clampResponse(
    text: string,
    maxSentences: number = 3,
    maxWords: number = 45
): string {
    if (!text || typeof text !== "string") {
        return "";
    }

    let result = text.trim();

    // Step 0: Reduzir dashes (em/en/connector hyphen → comma). Backstop para
    // o prompt-level anti-tell regra que providers don't completamente respect.
    result = reduceDashes(result);

    // Step 1: Strip markdown
    result = stripMarkdown(result);

    // Step 2: Strip prefixes (labels)
    result = stripPrefixes(result);

    // Step 3: Remove filler phrases de termina
    result = stripFillerPhrases(result);

    // CRITICAL: If código blocks eram found (preserved de stripMarkdown), Fazer Não CLAMP.
    // Code answers precisa para ser completo length.
    const hasCodeBlocks = /```/.test(result);

    if (!hasCodeBlocks) {
        // Step 4: Enforce sentence limit (apenas para prose)
        result = limitSentences(result, maxSentences);

        // Step 5: Enforce word limit (apenas para prose)
        result = limitWords(result, maxWords);
    }

    // Step 6: Final cleanup
    result = result.trim();

    return result;
}

/**
 * Strip todos markdown formatting
 */
/**
 * Strip todos markdown formatting mas PRESERVE código blocks
 */
function stripMarkdown(text: string): string {
    const codeBlocks: string[] = [];
    let result = text;

    // Extrair código blocks para proteger them
    result = result.replace(/```[\s\S]*?```/g, (match) => {
        codeBlocks.push(match);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // Remove headers (# ## ### etetc
    result = result.replace(/^#{1,6}\s+/gm, "");

    // Remove bold (**text** ou __text__)
    result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
    result = result.replace(/__([^_]+)__/g, "$1");

    // Remove italic (*text* ou _text_)
    result = result.replace(/\*([^*]+)\*/g, "$1");
    result = result.replace(/_([^_]+)_/g, "$1");

    // Remove inline código (`text`) - keep content
    result = result.replace(/`([^`]+)`/g, "$1");

    // Remove EMPTY bullet lines primeiro ("*", "* ", "-", "•" com não content) —
    // o antigo regex necessário trailing whitespace+content então a lone "*" survived
    // para o UI como an orphan bullet (manual regression 2026-06-12).
    result = result.replace(/^[\s]*[-*•]+[\s]*$/gm, "");
    // Remove bullet points (-, *, •)
    result = result.replace(/^[\s]*[-*•]\s+/gm, "");

    // Remove numbered lists
    result = result.replace(/^[\s]*\d+\.\s+/gm, "");

    // Remove blockquotes
    result = result.replace(/^>\s+/gm, "");

    // Remove horizontal rules
    result = result.replace(/^[-*_]{3,}$/gm, "");

    // Remove links [text](url) -> text
    result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Colapsar múltiplos newlines para único space (mas preserve structure ao redor blocks ladepois
    // We deve ser careful collapsing newlines ao redor placeholders
    result = result.replace(/\n+/g, " ");

    // Colapsar múltiplos spaces
    result = result.replace(/\s+/g, " ");

    // Restore código blocks
    // Adiciona newlines ao redor them para better formatting
    codeBlocks.forEach((block, index) => {
        result = result.replace(`__CODE_BLOCK_${index}__`, `\n${block}\n`);
    });

    return result.trim();
}

/**
 * Remove trailing filler phrases que adiciona não valor
 */
function stripFillerPhrases(text: string): string {
    let result = text;

    for (const phrase of FILLER_PHRASES) {
        const regex = new RegExp(`[.!?]?\\s*${phrase}[^.!?]*[.!?]?\\s*$`, "i");
        result = result.replace(regex, ".");
    }

    // Clean para cima trailing punctuation issues
    result = result.replace(/\.+$/, ".");
    result = result.replace(/\s+\.$/, ".");

    return result.trim();
}

/**
 * Limit para N sentences
 */
function limitSentences(text: string, maxSentences: number): string {
    // Divide em sentence boundaries (., !, ?)
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    if (sentences.length <= maxSentences) {
        return text;
    }

    // Take primeiro N sentences
    return sentences.slice(0, maxSentences).join(" ").trim();
}

/**
 * Limit para N words
 */
function limitWords(text: string, maxWords: number): string {
    const words = text.split(/\s+/);

    if (words.length <= maxWords) {
        return text;
    }

    // Take primeiro N words
    let result = words.slice(0, maxWords).join(" ");

    // Tentar para termina at a sentence limite
    const lastPunctuation = result.search(/[.!?][^.!?]*$/);
    if (lastPunctuation > result.length * 0.6) {
        result = result.substring(0, lastPunctuation + 1);
    } else {
        // Adiciona ellipsis se we cut mid-sentence
        result = result.replace(/[,;:]?\s*$/, "...");
    }

    return result.trim();
}

/**
 * Valida resposta meets constraints
 * Retorna verdadeiro se valid, falso se clamping era needed
 */
export function validateResponse(
    text: string,
    maxSentences: number = 3,
    maxWords: number = 60
): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Verifica para markdown
    if (/[#*_`]/.test(text)) {
        issues.push("Contains markdown");
    }

    // Verifica sentence count
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    if (sentences.length > maxSentences) {
        issues.push(`Too many sentences (${sentences.length}/${maxSentences})`);
    }

    // Verifica word count
    const words = text.split(/\s+/);
    if (words.length > maxWords) {
        issues.push(`Too many words (${words.length}/${maxWords})`);
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}

/**
 * Strip comum prefixes/labels
 */
function stripPrefixes(text: string): string {
    let result = text;
    for (const prefix of PREFIXES) {
        if (result.toLowerCase().startsWith(prefix.toLowerCase())) {
            result = result.substring(prefix.length).trim();
        }
    }
    // Handle "Refined (...):" regex pattern
    result = result.replace(/^Refined \([^)]+\):\s*/i, "");

    return result.trim();
}
