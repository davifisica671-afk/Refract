// electron/llm/IntentClassifier.ts
// Lightweight intent classification para "O que deve I say?"
// Micro step que executa antes answer generation
//
// Two-tier classification:
//   1. Regex fast-path (< 1ms) para comum patterns
//   2. Local SLM alternativa (zero-shot, ~10-50ms) para messy/ambiguous speech

import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { app } from 'electron';

export type ConversationIntent =
    | 'clarification'      // "Pode you explain that?"
    | 'follow_up'          // "O que happened nepróximo
    | 'deep_dive'          // "Tell me mais sobre X"
    | 'behavioral'         // "Give me an example of..de
    | 'example_request'    // "Pode you give a concrete example?"
    | 'summary_probe'      // "Então to summresumir
    | 'coding'             // "Escreve code para X" ou implementation questions
    | 'general';           // Default fallback

export interface IntentResult {
    intent: ConversationIntent;
    confidence: number;
    answerShape: string;
}

/**
 * Answer shapes mapped para intents
 * This controla Como o answer é structured, não apenas O que it says
 */
const INTENT_ANSWER_SHAPES: Record<ConversationIntent, string> = {
    clarification: 'Give a direct, focused 1-2 sentence clarification. No setup, no context-setting.',
    follow_up: 'Continue the narrative naturally. 1-2 sentences. No recap of what was already said.',
    deep_dive: 'Provide a structured but concise explanation. Use concrete specifics, not abstract concepts.',
    behavioral: 'Use a specific story only when grounded candidate/profile context exists. Without grounding, use the required no-context admission opener and keep any example illustrative, unnamed, modest, and qualitative.',
    example_request: 'Provide one concrete example from grounded context when available. Without grounding, label it as illustrative and avoid invented names, companies, dates, metrics, or first-person claims.',
    summary_probe: 'Confirm the summary briefly and add one clarifying point if needed.',
    coding: 'Provide a FULL, complete, working and production-ready code implementation (including necessary boilerplate like Java imports/classes). Start with a brief approach description, then the fully runnable code block, then a concise explanation of why this approach works.',
    general: 'Respond naturally based on context. Keep it conversational and direct.'
};

// ========================
// Zero-Shot SLM Classifier
// ========================

/**
 * Candidate labels para zero-shot classification.
 * These mapa para ConversationIntent types.
 */
const ZERO_SHOT_LABELS: Record<string, ConversationIntent> = {
    'asking for clarification or explanation': 'clarification',
    'asking about what happened next or follow-up': 'follow_up',
    'requesting more detail or deeper explanation': 'deep_dive',
    'asking for a personal experience or behavioral example': 'behavioral',
    'requesting a concrete example or instance': 'example_request',
    'summarizing or confirming understanding': 'summary_probe',
    'asking about code, programming, or implementation': 'coding',
    'general conversation or question': 'general',
};

const ZERO_SHOT_LABEL_KEYS = Object.keys(ZERO_SHOT_LABELS);

/** Minimum confidence de o SLM para trust its classification */
const SLM_CONFIDENCE_THRESHOLD = 0.35;

/**
 * Singleton lazy-loaded zero-shot classifier hosted em a worker tthread
 * O transformers.js/ONNX pipeline é intentionally kept fora o Electron
 * principal processo então startup warmup e live classification cannot stall window
 * animação ou IPC handling.
 */
class ZeroShotClassifier {
    private static instance: ZeroShotClassifier | null = null;
    private worker: Worker | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();
    private loadingPromise: Promise<void> | null = null;
    private loadFailed = false;
    private loaded = false;

    private static readonly WORKER_TIMEOUT_MS = 30_000;

    private constructor() {}

    static getInstance(): ZeroShotClassifier {
        if (!ZeroShotClassifier.instance) {
            ZeroShotClassifier.instance = new ZeroShotClassifier();
        }
        return ZeroShotClassifier.instance;
    }

    private getWorkerPath(): string {
        const candidates = [
            path.join(__dirname, 'intentClassifierWorker.js'),
            path.join(__dirname, 'llm', 'intentClassifierWorker.js'),
            path.join(__dirname, 'electron', 'llm', 'intentClassifierWorker.js'),
        ];

        let resolvedPath = candidates.find(p => fs.existsSync(p)) ?? candidates[0];
        if (resolvedPath.includes('app.asar') && !resolvedPath.includes('app.asar.unpacked')) {
            resolvedPath = resolvedPath.replace('app.asar', 'app.asar.unpacked');
        }
        return resolvedPath;
    }

    private getWorker(): Worker {
        if (!this.worker) {
            this.worker = new Worker(this.getWorkerPath());

            this.worker.on('message', (msg: { type: string; requestId: number; labels?: string[]; scores?: number[]; error?: string }) => {
                const pending = this.pendingRequests.get(msg.requestId);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pendingRequests.delete(msg.requestId);

                if (msg.type === 'error') {
                    pending.reject(new Error(msg.error || 'Worker error'));
                } else {
                    pending.resolve(msg);
                }
            });

            this.worker.on('error', (err) => {
                console.warn('[IntentClassifier] Worker error, regex-only fallback until retry:', err);
                this.loaded = false;
                this.loadingPromise = null;
                this.rejectAllPending(err);
            });

            this.worker.on('exit', (code) => {
                if (code !== 0) {
                    console.warn(`[IntentClassifier] Worker exited with code ${code}`);
                }
                this.worker = null;
                this.loaded = false;
                this.loadingPromise = null;
                this.rejectAllPending(new Error(`Worker exited with code ${code}`));
            });
        }
        return this.worker;
    }

    private rejectAllPending(err: Error): void {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pendingRequests.clear();
    }

    private postToWorker<T>(message: any): Promise<T> {
        this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
        const id = this.requestId;
        message.requestId = id;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`[IntentClassifier] Worker request ${id} timed out after ${ZeroShotClassifier.WORKER_TIMEOUT_MS}ms`));
            }, ZeroShotClassifier.WORKER_TIMEOUT_MS);

            this.pendingRequests.set(id, { resolve, reject, timer });
            this.getWorker().postMessage(message);
        });
    }

    private workerConfig(): Record<string, any> {
        const isPackaged = Boolean(app?.isPackaged);
        return {
            isPackaged,
            localModelPath: path.join(process.resourcesPath || '', 'models'),
            cacheDir: path.join(__dirname, '../../resources/models'),
        };
    }

    /**
     * Lazy-load o zero-shot classification model in a worker thread.
     * Uses Xenova/mobilebert-uncased-mnli — tiny (~100MB quantized), fast (~10-50ms inference).
     */
    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        if (this.loadFailed) return;

        if (this.loadingPromise) {
            await this.loadingPromise;
            return;
        }

        this.loadingPromise = (async () => {
            try {
                await this.postToWorker({ type: 'init', ...this.workerConfig() });
                this.loaded = true;
            } catch (e) {
                console.warn('[IntentClassifier] Failed to load zero-shot worker model, regex-only fallback:', e);
                this.loadFailed = true;
                this.loaded = false;
            }
        })();

        try {
            await this.loadingPromise;
        } finally {
            this.loadingPromise = null;
        }
    }

    private mapWorkerResult(result: { labels?: string[]; scores?: number[] }, textLength: number): IntentResult | null {
        const topLabel = result.labels?.[0];
        const topScore = result.scores?.[0];

        if (!topLabel || typeof topScore !== 'number' || topScore < SLM_CONFIDENCE_THRESHOLD) {
            return null;
        }

        const intent = ZERO_SHOT_LABELS[topLabel] || 'general';
        console.log(`[IntentClassifier] SLM classified`, { intent, confidence: topScore, textLength });

        return {
            intent,
            confidence: topScore,
            answerShape: INTENT_ANSWER_SHAPES[intent],
        };
    }

    /**
     * Classify texto using o zero-shot model.
     * Returns nulo se o model isn't loaded ou classification fails.
     */
    async classify(text: string): Promise<IntentResult | null> {
        await this.ensureLoaded();
        if (!this.loaded) return null;

        try {
            const result = await this.postToWorker<{ labels?: string[]; scores?: number[] }>({
                type: 'classify',
                text,
                labels: ZERO_SHOT_LABEL_KEYS,
                ...this.workerConfig(),
            });
            return this.mapWorkerResult(result, text.length);
        } catch (e) {
            console.warn('[IntentClassifier] SLM classification error:', e);
            return null;
        }
    }

    /**
     * Warm up o model in fundo (non-blocking).
     * Call isso early in app lifecycle para avoid cold-start latency.
     */
    warmup(): void {
        this.ensureLoaded().catch(() => {});
    }
}

// ========================
// Regex Fast-Path
// ========================

/**
 * Pattern-based intent detection (fast, não modelo call)
 * Para comum patterns isso é suficiente
 */
function detectIntentByPattern(lastInterviewerTurn: string): IntentResult | null {
    const text = lastInterviewerTurn.toLowerCase().trim();

    // Clarification patterns
    if (/(can you explain|what do you mean|clarify|could you elaborate on that specific)/i.test(text)) {
        return { intent: 'clarification', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.clarification };
    }

    // Follow-up patterns  
    if (/(what happened|then what|and after that|what.s next|how did that go)/i.test(text)) {
        return { intent: 'follow_up', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.follow_up };
    }

    // Deep dive patterns
    if (/(tell me more|dive deeper|explain further|walk me through|how does that work|how (should|would) (you|i) explain)/i.test(text)) {
        return { intent: 'deep_dive', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.deep_dive };
    }

    // DSA/coding interview patterns. Keep isso deterministic e executa it
    // Antes behavioral/example matching então prompts como "give me an example
    // React componente em TypeScript" ainda rotea para o coding contract.
    if (/(two\s*sum|longest substring|reverse (a )?linked list|detect a cycle|binary search|sliding window|two pointers?|hash\s?(map|set|table)|stack|queue|heap|trie|union[- ]find|dynamic programming|\bdp\b|backtracking|recursion|graph|tree|\bbfs\b|\bdfs\b|time complexity|space complexity|big[- ]?o)/i.test(text)) {
        return { intent: 'coding', confidence: 0.95, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    // Coding patterns (Broad detection para programming/implementation)
    if (/(write code|code for|program for|\bprogram\b|\bimplement\b|function for|algorithm for|algorithm|how to code|setup a .* project|using .* library|debug this|snippet|boilerplate|example of .* in .*|best practice for .* code|utility method|component for|logic for|\bsolve\b|solve .* in (javascript|typescript|python|java|c\+\+|sql))/i.test(text)) {
        return { intent: 'coding', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    // Simples programming interview prompts. Keep these deterministic porque
    // terse asks como "odd até code" são comum em o manual box e frequentemente
    // lack explicit words como "imimplementar
    if (/(odd\s*(?:\/|or|and)?\s*even|even\s*(?:\/|or|and)?\s*odd|prime number|palindrome|factorial|fibonacci|reverse string|sort array|find max|find min|check if|check whether|determine whether|detect whether)/i.test(text)) {
        return { intent: 'coding', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    // Behavioral patterns
    if (/(give me an example|tell me about a time|describe a situation|when have you|share an experience)/i.test(text)) {
        return { intent: 'behavioral', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.behavioral };
    }

    // Example requisição patterns
    if (/(for example|concrete example|specific instance|like what|such as)/i.test(text)) {
        return { intent: 'example_request', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.example_request };
    }

    // Summary probe patterns
    if (/(so to summarize|in summary|so basically|so you.re saying|let me make sure)/i.test(text)) {
        return { intent: 'summary_probe', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.summary_probe };
    }

    // Words como "ootimizar e "refactor" appear em normal interview answers
    // também ("otimizar latency", "refactor a proprocesso Treat them como coding
    // apenas quando a programming noun é também present.
    if (/\b(optimi[sz]e|refactor)\b/i.test(text) && /\b(code|function|algorithm|query|sql|typescript|javascript|python|java|class|method|implementation)\b/i.test(text)) {
        return { intent: 'coding', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    return null; // Não claro pattern detected
}

// ========================
// Context-Aware Fallback
// ========================

/**
 * Context-aware intent detection
 * Looks at conversation flow, não apenas o último turn
 */
function detectIntentByContext(
    recentTranscript: string,
    assistantMessageCount: number
): IntentResult {
    // If we've given múltiplos answers e interviewer é probing, provavelmente follow_up
    if (assistantMessageCount >= 2) {
        // Verifica se interviewer é drilling abaixo
        const lines = recentTranscript.split('\n');
        const interviewerLines = lines.filter(l => l.includes('[INTERVIEWER'));

        // Curto interviewer prompts após longo exchanges = follow-up probe
        const lastInterviewerLine = interviewerLines[interviewerLines.length - 1] || '';
        if (lastInterviewerLine.length < 50 && assistantMessageCount >= 2) {
            return { intent: 'follow_up', confidence: 0.7, answerShape: INTENT_ANSWER_SHAPES.follow_up };
        }
    }

    // Default para general
    return { intent: 'general', confidence: 0.5, answerShape: INTENT_ANSWER_SHAPES.general };
}

// ========================
// Public API
// ========================

/**
 * Principal intent classification função (async)
 *
 * Three-tier priority:
 *   1. Regex fast-path (< 1ms, alto confidence)
 *   2. Zero-shot SLM alternativa (~10-50ms, medium-high confidence)
 *   3. Context-based heuristic (0ms, baixo confidence)
 */
export async function classifyIntent(
    lastInterviewerTurn: string | null,
    recentTranscript: string,
    assistantMessageCount: number
): Promise<IntentResult> {
    // Tier 1: Tentar regex-based primeiro (alto confidence, instant)
    if (lastInterviewerTurn) {
        const patternResult = detectIntentByPattern(lastInterviewerTurn);
        if (patternResult) {
            return patternResult;
        }

        // Tier 2: Tentar zero-shot SLM (if regex didn't match)
        if (lastInterviewerTurn.trim().length > 5) {
            const slmResult = await ZeroShotClassifier.getInstance().classify(lastInterviewerTurn);
            if (slmResult) {
                return slmResult;
            }
        }
    }

    // Tier 3: Fall voltar para context-based heuristic
    return detectIntentByContext(recentTranscript, assistantMessageCount);
}

/**
 * Obtém answer shape guidance para prompt injection
 */
export function getAnswerShapeGuidance(intent: ConversationIntent): string {
    return INTENT_ANSWER_SHAPES[intent];
}

/**
 * Pre-warm o SLM modelo em background.
 * Call isso durante app initialization para avoid cold-start em primeiro classification.
 */
export function warmupIntentClassifier(): void {
    ZeroShotClassifier.getInstance().warmup();
}
