import * as crypto from 'crypto';
import { DatabaseManager } from '../db/DatabaseManager';
import { ModeContextRetriever } from './ModeContextRetriever';
import type { AnswerType } from '../llm/AnswerPlanner';
import type { ActiveModeInfo } from '../llm/modeProfiles';
import { classifyCustomContext, selectCustomContextForAnswer } from '../llm/customContextClassifier';

/**
 * Soltar sensitive (salary/pricing/strategy) chunks de a raw customContext blob
 * para a non-negotiation ccontexto Used por o summary caminho então sensitive notes
 * don't termina para cima em a stored meeting summary. Retorna o original blob unchanged
 * quando lá é nada sensitive.
 */
function dropSensitiveCustomContext(raw: string, answerType: AnswerType = 'general_meeting_answer'): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const classified = classifyCustomContext(trimmed);
    if (classified.sensitive.length === 0) return trimmed;
    return selectCustomContextForAnswer(classified, answerType).included.map(c => c.text).join('\n');
}
import {
    MODE_GENERAL_PROMPT,
    MODE_LOOKING_FOR_WORK_PROMPT,
    MODE_SALES_PROMPT,
    MODE_RECRUITING_PROMPT,
    MODE_TEAM_MEET_PROMPT,
    MODE_LECTURE_PROMPT,
    MODE_TECHNICAL_INTERVIEW_PROMPT,
    MODE_LANGUAGE_LEARNING_PROMPT,
    MODE_LEETCODE_PROMPT,
    MODE_COMPETITIVE_PROMPT,
    MODE_CODING_PROMPT,
    MODE_WORK_DAILY_PROMPT,
    SHARED_MODE_PREFIX,
    SHARED_MODE_PREFIX_SHORT,
    MODE_CLINICAL_PROMPT,
} from '../llm/prompts';

export type ModeTemplateType =
    | 'general'
    | 'looking-for-work'
    | 'sales'
    | 'recruiting'
    | 'team-meet'
    | 'lecture'
    | 'technical-interview'
    | 'language-learning'
    | 'leetcode'
    | 'competitive'
    | 'coding'
    | 'work-daily'
    // Atendimento clínico presencial (médico, psicólogo, enfermagem).
    // Primeiro template vertical — o que transforma a transcrição em um
    // documento que o profissional é obrigado a arquivar (no caso, SOAP).
    | 'clinical';

export interface Mode {
    id: string;
    name: string;
    templateType: ModeTemplateType;
    customContext: string;
    isActive: boolean;
    createdAt: string;
}

export interface ModeReferenceFile {
    id: string;
    modeId: string;
    fileName: string;
    content: string;
    createdAt: string;
}

export interface ModeNoteSection {
    id: string;
    modeId: string;
    title: string;
    description: string;
    sortOrder: number;
    createdAt: string;
    /** AI-compiled extraction instrução para isso section (cached). Empty = uso title+description. */
    compiledPrompt?: string;
}

export const MODE_TEMPLATES: Array<{
    type: ModeTemplateType;
    label: string;
    description: string;
}> = [
    { type: 'general',              label: 'General',              description: 'Universal adaptive copilot for any meeting or conversation.' },
    { type: 'sales',                label: 'Sales',                description: 'Close deals with strategic discovery and objection handling.' },
    { type: 'recruiting',           label: 'Recruiting',           description: 'Evaluate candidates with structured interview insights.' },
    { type: 'team-meet',            label: 'Team Meet',            description: 'Track action items and key decisions from meetings.' },
    { type: 'looking-for-work',     label: 'Looking for work',     description: 'Answer interview questions with confidence and clarity.' },
    { type: 'technical-interview',  label: 'Technical Interview',  description: 'Whiteboard-style coding and system design support.' },
    { type: 'lecture',              label: 'Lecture',              description: 'Capture key concepts and content from lectures.' },
    { type: 'language-learning',    label: 'Language Learning',    description: 'Real-time conversation translation with AI-suggested responses.' },
    { type: 'leetcode',             label: 'LeetCode',             description: 'Solve coding problems with step-by-step explanations and optimal solutions.' },
    { type: 'competitive',          label: 'Competitive',          description: 'Contest-speed solving for Codeforces, ICPC, and timed competitions.' },
    { type: 'coding',               label: 'Coding',               description: 'Pair programming on real code — debugging, reviews, and implementation.' },
    { type: 'work-daily',           label: 'Work Day',             description: 'Always-on companion tracking commitments and follow-ups across your workday.' },
    { type: 'clinical',             label: 'Clinical',             description: 'In-person encounters (consultation, therapy, nursing). Produces a SOAP note with explicit gaps — never invents findings.' },
];

// ── Split free/premium dos modos ──────────────────────────────────
// Fonte ÚNICA de verdade consumida pelos gates de IPC (modes:create/
// update/set-active) e pela UI (badge Pro no picker).
// Estratégia: modos de APRENDIZADO são free (isca de aquisição);
// modos que geram dinheiro pro usuário (entrevista, vendas, trabalho)
// são Pro — é onde mora a disposição a pagar.
export const FREE_MODE_TEMPLATES: ReadonlySet<ModeTemplateType> = new Set<ModeTemplateType>([
    'general',
    'lecture',
    'language-learning',
]);

/** True quando o template dispensa licença Pro (free tier). */
export function isFreeModeTemplate(templateType: string): boolean {
    return FREE_MODE_TEMPLATES.has(templateType as ModeTemplateType);
}

// Default note sections seeded quando a modo é created de a template
export const TEMPLATE_NOTE_SECTIONS: Record<ModeTemplateType, Array<{ title: string; description: string }>> = {
    general: [
        { title: 'What changed', description: 'Concrete outcomes, updates, or shifts from the meeting — not generic discussion.' },
        { title: 'Decisions', description: 'Confirmed decisions only. Do not include options that were merely discussed.' },
        { title: 'Action items', description: 'Follow-ups with owner/deadline when present. Mark unknown owner/deadline as absent.' },
        { title: 'Open questions', description: 'Questions that remain unresolved, deferred, or need follow-up.' },
        { title: 'Risks / blockers', description: 'Blockers, dependencies, privacy concerns, timeline risks, or unresolved constraints.' },
        { title: 'Notes', description: 'Useful supporting context that does not fit a stronger outcome section.' },
    ],
    'team-meet': [
        { title: 'Progress since last sync', description: 'Team member progress, shipped work, changed status, and notable updates.' },
        { title: 'Decisions', description: 'Decisions and agreements reached by the team.' },
        { title: 'Owners and next steps', description: 'Concrete next steps, owners, dependencies, and deadlines if stated.' },
        { title: 'Blockers', description: 'Anything blocked, delayed, at risk, or requiring escalation.' },
        { title: 'Dependencies', description: 'Cross-team handoffs, external dependencies, or sequencing constraints.' },
        { title: 'Follow-up needed', description: 'Follow-ups that should happen after the meeting even if not assigned.' },
    ],
    sales: [
        { title: 'Account context', description: 'Company, stakeholders, use case, team size, current workflow, and business context.' },
        { title: 'Pain points', description: 'Customer pain, needs, current gaps, and why the problem matters.' },
        { title: 'Buying signals', description: 'Positive intent, urgency, evaluation signals, pilot/trial interest, or expansion signals.' },
        { title: 'Objections', description: 'Concerns about price, competitors, timing, security, procurement, or fit.' },
        { title: 'Budget / timeline / authority', description: 'Budget, approval process, economic buyer, timeline, procurement, or decision criteria.' },
        { title: 'Next steps', description: 'Specific sales follow-ups, owners, deadlines, and promised materials.' },
        { title: 'Follow-up email', description: 'Facts that should be included in a concise customer follow-up email.' },
    ],
    recruiting: [
        { title: 'Candidate profile', description: 'Candidate background, experience, current role, motivations, and logistics.' },
        { title: 'Role fit', description: 'Evidence for or against fit with the role, team, and level.' },
        { title: 'Strengths', description: 'Concrete strengths shown in answers or experience.' },
        { title: 'Concerns', description: 'Risks, gaps, inconsistencies, or follow-up areas.' },
        { title: 'Compensation / logistics', description: 'Compensation, notice period, availability, location, visa, timeline, or constraints.' },
        { title: 'Next steps', description: 'Recruiting follow-ups, owners, deadlines, next interview stage, or materials.' },
        { title: 'Follow-up draft', description: 'Information that should appear in the recruiter or candidate follow-up.' },
    ],
    'technical-interview': [
        { title: 'Problem discussed', description: 'Problem statement, constraints, clarifications, and target outcome.' },
        { title: 'Approach', description: 'Candidate approach, algorithm, system design, alternatives, and tradeoffs.' },
        { title: 'Correctness', description: 'Correctness reasoning, edge cases, bugs found, or unresolved correctness issues.' },
        { title: 'Complexity', description: 'Time/space complexity, scaling assumptions, and performance tradeoffs.' },
        { title: 'Code quality', description: 'Implementation quality, readability, structure, testing, and maintainability.' },
        { title: 'Communication', description: 'How clearly the candidate explained reasoning and handled feedback.' },
        { title: 'Strengths', description: 'Concrete positive signals from the interview.' },
        { title: 'Weaknesses', description: 'Concrete gaps, missed cases, or areas to improve.' },
        { title: 'Hiring signal', description: 'Overall hire/no-hire signal and evidence; avoid inventing a final decision.' },
        { title: 'Follow-up', description: 'Next steps, additional questions, take-home, or interviewer follow-up.' },
    ],
    lecture: [
        { title: 'Core concepts', description: 'Main concepts, frameworks, and claims from the lecture.' },
        { title: 'Definitions', description: 'Terms, definitions, formulas, and distinctions introduced.' },
        { title: 'Examples', description: 'Concrete examples, analogies, demonstrations, or case studies.' },
        { title: 'Formulas / steps', description: 'Procedures, equations, workflows, or step-by-step methods.' },
        { title: 'Things to memorize', description: 'Facts, definitions, formulas, or lists that should be memorized.' },
        { title: 'Confusing points', description: 'Ambiguous or confusing ideas that need review.' },
        { title: 'Questions to review', description: 'Open questions, exam prep prompts, or self-study questions.' },
        { title: 'Study summary', description: 'Concise study-focused recap of what matters most.' },
    ],
    'looking-for-work': [
        { title: 'Opportunity summary', description: 'Company, role, team, interview stage, and opportunity context.' },
        { title: 'Company / role details', description: 'Role responsibilities, compensation, logistics, process, and requirements.' },
        { title: 'Fit signals', description: 'Evidence that my experience or preferences fit the opportunity.' },
        { title: 'Concerns', description: 'Risks, gaps, objections, or areas to prepare for.' },
        { title: 'Referral / follow-up', description: 'Referral requests, thank-you notes, materials to send, or networking follow-up.' },
        { title: 'Next steps', description: 'Concrete next steps, owners, dates, and preparation items.' },
    ],
    'language-learning': [
        { title: 'Vocabulary', description: 'New words and phrases encountered in the conversation.' },
        { title: 'Phrases & expressions', description: 'Useful idiomatic expressions and colloquial phrases.' },
        { title: 'Grammar patterns', description: 'Grammar structures observed and used during conversation.' },
        { title: 'Cultural notes', description: 'Cultural context, politeness norms, and situational nuances.' },
    ],
    'leetcode': [
        { title: 'Problem', description: 'Problem statement, constraints, and examples.' },
        { title: 'Approach', description: 'Algorithm choice, data structures, and reasoning.' },
        { title: 'Code', description: 'Clean, optimized solution with comments.' },
        { title: 'Complexity', description: 'Time and space complexity analysis.' },
        { title: 'Edge cases', description: 'Edge cases and potential pitfalls.' },
        { title: 'Pattern', description: 'Reusable pattern or technique identified.' },
    ],
    'competitive': [
        { title: 'Problems solved', description: 'Problems attempted and their verdicts (AC, WA, TLE) during the session.' },
        { title: 'Patterns used', description: 'Algorithmic patterns and techniques applied (binary search on answer, DSU, DP, etc.).' },
        { title: 'Mistakes / penalties', description: 'Wrong submissions, overflow bugs, off-by-ones, and what caused them.' },
        { title: 'Time sinks', description: 'Problems or bugs that consumed disproportionate contest time.' },
        { title: 'Templates to build', description: 'Reusable code templates worth preparing for future contests.' },
        { title: 'Review queue', description: 'Problems to upsolve or techniques to study after the contest.' },
    ],
    'coding': [
        { title: 'What was worked on', description: 'Features, bugs, or code areas touched during the session.' },
        { title: 'Root causes found', description: 'Bugs diagnosed and their underlying causes — not just symptoms.' },
        { title: 'Decisions & trade-offs', description: 'Technical decisions made and the alternatives considered.' },
        { title: 'Code touched', description: 'Files, functions, or modules modified or reviewed.' },
        { title: 'Follow-ups', description: 'TODOs, tests to write, refactors deferred, or tech debt noted.' },
        { title: 'Learnings', description: 'APIs, patterns, or codebase knowledge discovered worth remembering.' },
    ],
    'work-daily': [
        { title: 'Commitments I made', description: 'Promises the user made: what, to whom, by when. The highest-value section.' },
        { title: 'Commitments made to me', description: 'What others promised the user, with owner and deadline.' },
        { title: 'Decisions', description: 'Decisions made or communicated during the day, however informal.' },
        { title: 'Follow-ups', description: 'Items needing action later: replies owed, threads to close, people to ping.' },
        { title: 'People context', description: 'Personal or situational details about colleagues worth remembering (new project, PTO, preferences).' },
        { title: 'Day summary', description: 'Concise recap of the workday: what moved, what stalled, what changed.' },
    ],
    // SOAP — o registro clínico padrão. A quinta seção ("Not documented") existe
    // de propósito: num prontuário, declarar uma lacuna é infinitamente mais
    // seguro do que preenchê-la com um achado plausível porém inventado.
    clinical: [
        { title: 'Subjective', description: "What the patient reported in their own words: presenting concern, symptoms, history, and their own account. Never convert lay wording into clinical terminology and present it as the patient's statement. Omit anything not actually said rather than inferring it." },
        { title: 'Objective', description: 'What was observed or measured in the room: vitals, exam findings, observed behaviour, results mentioned. Include a number ONLY if it was actually spoken. If nothing objective was captured, say so explicitly.' },
        { title: 'Assessment', description: "The professional's clinical impression. Attribute it as impression or working hypothesis — never state a diagnosis as established fact. Preserve differential language when the encounter was inconclusive." },
        { title: 'Plan', description: 'Treatment, medication, referrals, patient education, investigations ordered, and follow-up — with intervals or dates only when stated.' },
        { title: 'Not documented', description: 'What a note of this kind would normally contain but the encounter did not capture. Flag it so the professional can complete it by hand. An honest gap is safer than an invented finding.' },
    ],
};

const TEMPLATE_SYSTEM_PROMPTS: Record<ModeTemplateType, string> = {
    // General = universal adaptive copilot (próprio prompt, não technical interview)
    general: MODE_GENERAL_PROMPT,
    'technical-interview': MODE_TECHNICAL_INTERVIEW_PROMPT,

    'looking-for-work': MODE_LOOKING_FOR_WORK_PROMPT,
    sales: MODE_SALES_PROMPT,
    recruiting: MODE_RECRUITING_PROMPT,
    'team-meet': MODE_TEAM_MEET_PROMPT,
    lecture: MODE_LECTURE_PROMPT,
    'language-learning': MODE_LANGUAGE_LEARNING_PROMPT,
    'leetcode': MODE_LEETCODE_PROMPT,
    'competitive': MODE_COMPETITIVE_PROMPT,
    'coding': MODE_CODING_PROMPT,
    'work-daily': MODE_WORK_DAILY_PROMPT,
    clinical: MODE_CLINICAL_PROMPT,
};

// Startup invariant: todo MODE_*_PROMPT precisa começa com one de o two shared
// prefixes então getActiveModeSystemPromptSuffix() pode strip duplicated tokens.
// If a future template diverges, we silently regress para shipping ~1.6K duplicate
// tokens por rrequisição Warn loudly aqui em vez disso então o regression é caught at
// app launch, não por a prod cost spike.
for (const [templateType, prompt] of Object.entries(TEMPLATE_SYSTEM_PROMPTS)) {
    if (!prompt.startsWith(SHARED_MODE_PREFIX) && !prompt.startsWith(SHARED_MODE_PREFIX_SHORT)) {
        console.warn(
            `[ModesManager] WARN: MODE template '${templateType}' does not start with ` +
            `SHARED_MODE_PREFIX or SHARED_MODE_PREFIX_SHORT. Token deduplication will fall ` +
            `back to sending the full template — duplicate-token regression. See prompts.ts.`
        );
    }
}

export function encodeModeContextPayload(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function rowToMode(row: any): Mode {
    return {
        id: row.id,
        name: row.name,
        templateType: row.template_type as ModeTemplateType,
        customContext: row.custom_context ?? '',
        isActive: row.is_active === 1,
        createdAt: row.created_at,
    };
}

function rowToFile(row: any): ModeReferenceFile {
    return {
        id: row.id,
        modeId: row.mode_id,
        fileName: row.file_name,
        content: row.content ?? '',
        createdAt: row.created_at,
    };
}

function rowToSection(row: any): ModeNoteSection {
    return {
        id: row.id,
        modeId: row.mode_id,
        title: row.title,
        description: row.description ?? '',
        sortOrder: row.sort_order ?? 0,
        createdAt: row.created_at,
        compiledPrompt: row.compiled_prompt || undefined,
    };
}

export class ModesManager {
    private static instance: ModesManager;
    private readonly modeContextRetriever = new ModeContextRetriever();

    private constructor() {}

    public static getInstance(): ModesManager {
        if (!ModesManager.instance) {
            ModesManager.instance = new ModesManager();
        }
        return ModesManager.instance;
    }

    // ── Modes ─────────────────────────────────────────────────────

    public getModes(): Mode[] {
        const modes = DatabaseManager.getInstance().getModes().map(rowToMode);

        // Sempre enforce 'general' at o muito topo de o llista
        // L1: id é o secundário ordenar chave para stable ordering quando two modes
        // share createdAt para o millisecond.
        modes.sort((a, b) => {
            if (a.templateType === 'general') return -1;
            if (b.templateType === 'general') return 1;
            const ta = new Date(a.createdAt).getTime();
            const tb = new Date(b.createdAt).getTime();
            if (ta !== tb) return ta - tb;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        return modes;
    }

    // Seed o un-deletable General modo uma vez at app init. Idempotent.
    public ensureSeeded(): void {
        const modes = DatabaseManager.getInstance().getModes().map(rowToMode);
        if (!modes.some(m => m.templateType === 'general')) {
            this.createMode({ name: 'General', templateType: 'general' });
        }
    }

    public getActiveMode(): Mode | null {
        const row = DatabaseManager.getInstance().getActiveMode();
        return row ? rowToMode(row) : null;
    }

    // ── Pinned-mode resolution (audit finding #6) ─────────────────
    // O live answer caminho captures o ativo modo Uma vez at t0 (o
    // WhatToAnswerRequestSnapshot) e o prompt builders abaixo take an
    // opcional `pinnedModeId` então they lê o Mesmo modo o answer contract era
    // planned de — até se `modes:set-active` flips o ativo modo enquanto o
    // requisição é parked at an await. Quando não id é pinned (todo existing
    // caller) isso Retorna o live ativo mmodo então behavior é unchanged.
    private resolveMode(pinnedModeId?: string): Mode | null {
        if (pinnedModeId) {
            const pinned = this.getModes().find(m => m.id === pinnedModeId);
            // Fall voltar para o ativo modo apenas se o pinned modo era deleted
            // mid-request (rare); caso contrário o pinned modo wins.
            if (pinned) return pinned;
        }
        return this.getActiveMode();
    }

    // ── Active-mode info cache (PI v3, W1) ────────────────────────
    // O live answer caminho consults o ativo modo em Todo turn (routing
    // prior, pinned instructions, retrieval). O modo si mesmo changes apenas via
    // setActiveMode/updateMode/deleteMode, então a tiny invalidate-on-write cache
    // remover o per-question SQLite lê sem qualquer staleness risk.
    private _activeModeInfoCache: ActiveModeInfo | null = null;
    private _activeModeInfoCacheValid = false;

    private invalidateActiveModeCache(): void {
        this._activeModeInfoCache = null;
        this._activeModeInfoCacheValid = false;
    }

    /**
     * The slice of o ativo mode o answer planner needs, cached. A mode is
     * "custom" quando o user built it de o blank template ('general'
     * templateType mas não o seeded General mode) — its name/content are
     * user-authored e surfaced para prompt builders.
     */
    public getActiveModeInfo(): ActiveModeInfo | null {
        if (this._activeModeInfoCacheValid) return this._activeModeInfoCache;
        const mode = this.getActiveMode();
        this._activeModeInfoCache = mode ? {
            id: mode.id,
            templateType: mode.templateType,
            name: mode.name,
            isCustom: mode.templateType === 'general' && mode.name !== 'General',
        } : null;
        this._activeModeInfoCacheValid = true;
        return this._activeModeInfoCache;
    }

    // Modes onde o premium knowledge intercept (negotiation coaching, intro
    // shortcut, premium-flavored systemPromptInjection/contextBlock) é Fora De
    // Escopo e iria substituir o user's expected answer com off-topic content.
    // Technical interviews são coding/system-design oapenas team meetings and
    // lectures ter não candidate/interview sescopo Issue #272: technical-
    // interview users eram getting one-line salary coaching cards em vez disso de
    // technical answers porque o premium tracker fires em qualquer interviewer
    // utterance independentemente de o ativo mmodo O fix também fecha two sibling
    // vectors de o mesmo bug classe — o intro-question shortcut e o
    // premium prompt/context injection — por gating o whole intercept haqui
    private static readonly PREMIUM_INTERCEPT_INCOMPATIBLE_TEMPLATES: ReadonlySet<ModeTemplateType> = new Set([
        'technical-interview',
        'team-meet',
        'lecture',
        // Mesma classe do issue #272: escopo puramente de código/formato fixo,
        // sem contexto candidato/negociação — o intercept seria sempre off-topic.
        'leetcode',
        'language-learning',
        'competitive',
        'coding',
        // clinical: aqui o intercept não seria apenas off-topic — conteúdo
        // externo injetado sem pedido num atendimento pode virar dado clínico
        // falso dentro de um documento legal. Bloqueado por segurança, não só
        // por relevância.
        'clinical',
    ]);

    /**
     * True quando o premium knowledge intercept (negotiation coaching, intro
     * shortcut, premium system-prompt/context injection) is contextually
     * appropriate para o ativo mode. False para technical-interview, team-
     * meet, e lecture — modes where premium-flavored interjections overwrite
     * o user's expected answer. Defaults para verdadeiro quando não mode is active.
     */
    public isPremiumKnowledgeInterceptAllowed(): boolean {
        const mode = this.getActiveMode();
        if (!mode) return true;
        return !ModesManager.PREMIUM_INTERCEPT_INCOMPATIBLE_TEMPLATES.has(mode.templateType);
    }

    public createMode(params: { name: string; templateType: ModeTemplateType }): Mode {
        const id = `mode_${crypto.randomUUID()}`;
        DatabaseManager.getInstance().createMode({
            id,
            name: params.name,
            templateType: params.templateType,
            customContext: '',
        });
        // Seed padrão note sections para isso template tipo
        const defaultSections = TEMPLATE_NOTE_SECTIONS[params.templateType] ?? [];
        defaultSections.forEach((s, i) => {
            const sectionId = `ns_${crypto.randomUUID()}`;
            DatabaseManager.getInstance().addNoteSection({
                id: sectionId,
                modeId: id,
                title: s.title,
                description: s.description,
                sortOrder: i,
            });
        });
        // Compile extraction instructions para todos seeded sections em parallel (fire-and-forget,
        // bounded concurrency). Nunca blocks modo creation / UI.
        this.compileAllSectionsAsync(id);
        return {
            id,
            name: params.name,
            templateType: params.templateType,
            customContext: '',
            isActive: false,
            createdAt: new Date().toISOString(),
        };
    }

    public updateMode(id: string, updates: { name?: string; templateType?: ModeTemplateType; customContext?: string }): void {
        DatabaseManager.getInstance().updateMode(id, updates);
        this.invalidateActiveModeCache();
    }

    public deleteMode(id: string): void {
        // PI v3 (W3): mode_reference_files rows go via FK CASCADE, mas o
        // persisted chunk vectors (mode_reference_chunks / index_state) ter não
        // FK em purpose (o tabela é owned por o retriever) — soltar them
        // explicitly Antes o cascade remover o arquivo rows we enumerate.
        try {
            for (const file of this.getReferenceFiles(id)) {
                this.modeContextRetriever.removeReferenceFileIndex(file.id);
            }
        } catch { /* non-fatal — orphans são disk bloat, não correctness */ }
        DatabaseManager.getInstance().deleteMode(id);
        this.invalidateActiveModeCache();
    }

    public setActiveMode(id: string | null): void {
        DatabaseManager.getInstance().setActiveMode(id);
        this.invalidateActiveModeCache();
    }

    // ── Referência Files ───────────────────────────────────────────

    public getReferenceFiles(modeId: string): ModeReferenceFile[] {
        return DatabaseManager.getInstance().getReferenceFiles(modeId).map(rowToFile);
    }

    public addReferenceFile(params: { modeId: string; fileName: string; content: string }): ModeReferenceFile {
        const id = `ref_${crypto.randomUUID()}`;
        DatabaseManager.getInstance().addReferenceFile({
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
        });
        return {
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
            createdAt: new Date().toISOString(),
        };
    }

    public deleteReferenceFile(id: string): void {
        DatabaseManager.getInstance().deleteReferenceFile(id);
        // PI v3 (W3): soltar o persisted chunk vectors + index estado ttambém
        try { this.modeContextRetriever.removeReferenceFileIndex(id); } catch { /* non-fatal */ }
    }

    // ── PI v3 (W3): upload-time reference-file indexing ───────────
    // Chunk + embed + persist a file's vectors então o per-question hot caminho
    // embeds Apenas o live qconsulta Fire-and-forget de upload/activation; o
    // retriever degrades para lexical para qualquer arquivo que isn't 'ready' yainda

    /** Index one referência arquivo (idempotent — re-embeds apenas em content/space change). */
    public async indexReferenceFile(file: ModeReferenceFile): Promise<void> {
        await this.modeContextRetriever.indexReferenceFile(file);
    }

    /** Kick indexing para todo not-yet-ready arquivo de a modo (modo activation prewarm). */
    public async prewarmModeReferenceIndex(modeId: string): Promise<void> {
        const files = this.getReferenceFiles(modeId);
        for (const file of files) {
            const { status } = this.modeContextRetriever.getReferenceFileIndexStatus(file.id);
            if (status !== 'ready') {
                await this.modeContextRetriever.indexReferenceFile(file).catch(() => { /* logged dentro */ });
            }
        }
    }

    /** Per-file index status para o Modes Gerenciador UI badges. */
    public getReferenceFileIndexStatuses(modeId: string): Array<{ fileId: string; fileName: string; status: string; chunkCount: number }> {
        return this.getReferenceFiles(modeId).map(file => ({
            fileId: file.id,
            fileName: file.fileName,
            ...this.modeContextRetriever.getReferenceFileIndexStatus(file.id),
        }));
    }

    // ── Note Sections ─────────────────────────────────────────────

    public getNoteSections(modeId: string): ModeNoteSection[] {
        return DatabaseManager.getInstance().getNoteSections(modeId).map(rowToSection);
    }

    public addNoteSection(params: { modeId: string; title: string; description: string }): ModeNoteSection {
        const existingSections = this.getNoteSections(params.modeId);
        const sortOrder = existingSections.length;
        const id = `ns_${crypto.randomUUID()}`;
        DatabaseManager.getInstance().addNoteSection({
            id,
            modeId: params.modeId,
            title: params.title,
            description: params.description,
            sortOrder,
        });
        // Fire-and-forget: compile a tailored extraction instrução para isso section então
        // future summaries fill it faithfully. Nunca blocks o caller / UI.
        this.compileSectionPromptAsync(id, params.modeId, params.title, params.description);
        return {
            id,
            modeId: params.modeId,
            title: params.title,
            description: params.description,
            sortOrder,
            createdAt: new Date().toISOString(),
        };
    }

    public updateNoteSection(id: string, updates: { title?: string; description?: string; compiledPrompt?: string }): void {
        DatabaseManager.getInstance().updateNoteSection(id, updates);
        // If o section's meaning changed (title/description), recompile its iinstrução
        // Pular quando we são apenas writing o compiledPrompt si mesmo (avoids a loop).
        if ((updates.title !== undefined || updates.description !== undefined) && updates.compiledPrompt === undefined) {
            const owner = DatabaseManager.getInstance().getNoteSectionOwnerMode(id);
            if (owner) {
                this.compileSectionPromptAsync(id, owner.modeId, updates.title ?? owner.title, updates.description ?? owner.description);
            }
        }
    }

    public deleteNoteSection(id: string): void {
        DatabaseManager.getInstance().deleteNoteSection(id);
    }

    /**
     * Compile + cache o AI extraction instruction para a section. Fire-and-forget;
     * resolves silently. Requires an LLMHelper (set via setLlmHelperForCompiler); se absent
     * ou scope-denied, leaves compiled_prompt vazio so o extractor uses title+description.
     */
    private compileSectionPromptAsync(sectionId: string, modeId: string, title: string, description: string): void {
        void (async () => {
            try {
                const llmHelper = ModesManager.llmHelperForCompiler;
                if (!llmHelper) return; // compiler não available em this contexto
                // Escopo gate: nunca chamar a cloud LLM para prompt compilation quando post_call_summary
                // é denied (o deterministic alternativa covers it at summary time).
                try {
                    const { SettingsManager } = require('./SettingsManager');
                    const scope = SettingsManager.getInstance().get('providerDataScopes');
                    if (scope?.post_call_summary === false) return;
                } catch { /* default permitir */ }
                const mode = this.getModes().find(m => m.id === modeId);
                const { SectionPromptCompiler } = require('./meeting/SectionPromptCompiler');
                const { instruction, compiled } = await new SectionPromptCompiler(llmHelper).compile({
                    sectionTitle: title,
                    sectionDescription: description,
                    meetingMode: mode?.templateType,
                });
                if (compiled && instruction) {
                    DatabaseManager.getInstance().updateNoteSection(sectionId, { compiledPrompt: instruction });
                }
            } catch (e) {
                console.warn('[ModesManager] section prompt compile skipped (non-fatal):', (e as any)?.message);
            }
        })();
    }

    /**
     * Compile extraction instructions para EVERY section of a mode, in parallel com bounded
     * concurrency. Used quando a custom mode is created (many sections at once). Fire-and-forget.
     */
    public compileAllSectionsAsync(modeId: string): void {
        void (async () => {
            try {
                const llmHelper = ModesManager.llmHelperForCompiler;
                if (!llmHelper) return;
                try {
                    const { SettingsManager } = require('./SettingsManager');
                    if (SettingsManager.getInstance().get('providerDataScopes')?.post_call_summary === false) return;
                } catch { /* default permitir */ }
                const mode = this.getModes().find(m => m.id === modeId);
                const sections = this.getNoteSections(modeId).filter(s => !s.compiledPrompt || !s.compiledPrompt.trim());
                if (sections.length === 0) return;
                const { SectionPromptCompiler } = require('./meeting/SectionPromptCompiler');
                const compiler = new SectionPromptCompiler(llmHelper);
                const CONCURRENCY = 3;
                let next = 0;
                await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sections.length) }, async () => {
                    while (next < sections.length) {
                        const s = sections[next++];
                        try {
                            const { instruction, compiled } = await compiler.compile({ sectionTitle: s.title, sectionDescription: s.description, meetingMode: mode?.templateType });
                            if (compiled && instruction) DatabaseManager.getInstance().updateNoteSection(s.id, { compiledPrompt: instruction });
                        } catch { /* per-section non-fatal */ }
                    }
                }));
            } catch (e) {
                console.warn('[ModesManager] compileAllSections skipped (non-fatal):', (e as any)?.message);
            }
        })();
    }

    private static llmHelperForCompiler: import('../LLMHelper').LLMHelper | null = null;

    /** Wire o LLMHelper used por o assíncrono section-prompt compiler (chamado at startup). */
    public static setLlmHelperForCompiler(llmHelper: import('../LLMHelper').LLMHelper): void {
        ModesManager.llmHelperForCompiler = llmHelper;
    }

    public removeAllNoteSections(modeId: string): void {
        DatabaseManager.getInstance().deleteAllNoteSections(modeId);
    }

    // ── LLM Contexto ───────────────────────────────────────────────

    /**
     * Returns o system prompt suffix para o ativo mode's template type.
     * Returns o template's MODE_*_PROMPT (including general's MODE_GENERAL_PROMPT
     * e technical-interview's MODE_TECHNICAL_INTERVIEW_PROMPT). Empty string
     * apenas quando não mode is active.
     */
    public getActiveModeSystemPromptSuffix(pinnedModeId?: string): string {
        const mode = this.resolveMode(pinnedModeId);
        if (!mode) return '';
        const full = TEMPLATE_SYSTEM_PROMPTS[mode.templateType] ?? '';
        // Strip o shared prefix that's já em HARD_SYSTEM_PROMPT, caso contrário
        // CORE_IDENTITY + EXECUTION_CONTRACT + CONTEXT_INTELLIGENCE_LAYER (+
        // SHARED_CODING_RULES para coding modes) ship twice por requisição — ~1.6K
        // duplicated tokens para coding modes, ~1.2K para non-coding.
        //
        // Tentar o longo (4-block) prefix primeiro para manipular coding modes, então o
        // curto (3-block) prefix para sales/recruiting/team-meet/lecture que
        // intentionally omit SHARED_CODING_RULES. Fall voltar para unchanged if
        // nenhum matches — safe padrão para future template drift.
        for (const prefix of [SHARED_MODE_PREFIX, SHARED_MODE_PREFIX_SHORT]) {
            if (full.startsWith(prefix)) {
                return full.slice(prefix.length).replace(/^\s+/, '');
            }
        }
        return full;
    }

    // Hard cap para o always-pinned "Real-time prompt" (modo customContext).
    // Roughly 300 tokens — enough para real modo instructions, pequeno enough that
    // a pasted document can't crowd fora o transcript. Qualquer coisa longer remains
    // completamente disponível para RETRIEVAL (reference-file pacaminho então nada é lost.
    private static readonly PINNED_INSTRUCTIONS_MAX_CHARS = 1_200;

    /**
     * PI v3 (W2): o ativo mode's user-authored "Real-time prompt"
     * (customContext), ALWAYS-ON. Previously isso texto apenas reached o prompt
     * quando lexical/vector retrieval happened para score it contra o live query —
     * so a custom mode's instructions silently falhou para apply on most turns.
     * This accessor returns it deterministically (subject para o same
     * answer-type sensitivity scoping as retrieval, so salary/pricing notes
     * still can't leak em a coding/identity answer) para pinning em the
     * prompt as a dedicated block.
     *
     * Returns '' quando não mode is ativo ou nothing survives scoping. For custom
     * (user-built) modes o mode NAME is prepended so o model knows whose
     * instructions these are.
     */
    public getActiveModePinnedInstructions(answerType?: AnswerType, pinnedModeId?: string): string {
        const mode = this.resolveMode(pinnedModeId);
        if (!mode) return '';
        const raw = (mode.customContext || '').trim();
        if (!raw) return '';
        const scoped = answerType
            ? selectCustomContextForAnswer(classifyCustomContext(raw), answerType).included.map(c => c.text).join('\n')
            : raw;
        if (!scoped.trim()) return '';
        let text = scoped.trim();
        if (text.length > ModesManager.PINNED_INSTRUCTIONS_MAX_CHARS) {
            text = text.slice(0, ModesManager.PINNED_INSTRUCTIONS_MAX_CHARS) + ' …[truncated]';
        }
        // isCustom é a pure função de (templateType, nnome em o resolved
        // modo — derivar it directly então a pinned modo reports correctly até quando
        // it differs de o (possivelmente switched) live ativo mmodo
        const isCustom = mode.templateType === 'general' && mode.name !== 'General';
        return isCustom ? `Mode: ${mode.name}\n${text}` : text;
    }

    /**
     * Builds a context block para inject antes o user mensagem para o ativo mode.
     * Includes custom context texto e reference file contents.
     *
     * Limits: cada file is capped at MAX_FILE_CHARS para prevent context janela overflow.
     * Total block is capped at MAX_TOTAL_CHARS across todos files.
     */
    private static readonly MAX_FILE_CHARS = 12_000;
    private static readonly MAX_TOTAL_CHARS = 40_000;

    public buildRetrievedActiveModeContextBlock(query: string, transcript?: string, tokenBudget?: number, answerType?: AnswerType, excludeCustomContext?: boolean, pinnedModeId?: string): string {
        const mode = this.resolveMode(pinnedModeId);
        if (!mode) return '';

        const result = this.modeContextRetriever.retrieve(mode, this.getReferenceFiles(mode.id), {
            query,
            transcript,
            tokenBudget,
            answerType,
            excludeCustomContext,
        });

        return result.formattedContext;
    }

    /**
     * Phase 4 — assíncrono hybrid retrieval (FTS + vector + dedupe + lexical fallback).
     * Callers in assíncrono paths (WhatToAnswerLLM, LLMHelper paths) deve prefer
     * this. If hybrid throws (DB missing, embedding provider unavailable),
     * we fall voltar para o existing sync lexical caminho so o answer flow
     * nunca breaks. Telemetry distinguishes hybrid hits de lexical fallback.
     */
    public async buildRetrievedActiveModeContextBlockHybrid(query: string, transcript?: string, tokenBudget?: number, answerType?: AnswerType, excludeCustomContext?: boolean, pinnedModeId?: string): Promise<string> {
        const mode = this.resolveMode(pinnedModeId);
        if (!mode) return '';
        const files = this.getReferenceFiles(mode.id);

        // Telemetry: rag_query / rag_hit / rag_miss / rag_lexical_fallback.
        let usedHybrid = false;
        let usedFallback = false;
        let chunkCount = 0;
        try {
            const { telemetryService } = require('./telemetry/TelemetryService');
            telemetryService.track({
                name: 'rag_query',
                modeId: mode.id,
                properties: { modeTemplateType: mode.templateType, fileCount: files.length, hasTranscript: Boolean(transcript) },
            });
        } catch { /* non-fatal */ }

        try {
            const result = await this.modeContextRetriever.retrieveHybrid(mode, files, {
                query,
                transcript,
                tokenBudget,
                answerType,
            });
            usedHybrid = result.usedHybrid;
            usedFallback = result.usedFallback;
            chunkCount = result.chunks?.length ?? 0;
            if (result.formattedContext) {
                try {
                    const { telemetryService } = require('./telemetry/TelemetryService');
                    telemetryService.track({
                        name: usedHybrid ? 'rag_hit' : 'rag_lexical_fallback',
                        modeId: mode.id,
                        properties: { chunkCount, modeTemplateType: mode.templateType },
                    });
                } catch { /* non-fatal */ }
                return result.formattedContext;
            }
            // Empty hybrid result — fall através para lexical então we ainda ttentar
        } catch (err) {
            console.warn('[ModesManager] hybrid retrieval failed, falling back to lexical:', (err as Error)?.message);
        }

        const lexical = this.buildRetrievedActiveModeContextBlock(query, transcript, tokenBudget, answerType, excludeCustomContext, pinnedModeId);
        try {
            const { telemetryService } = require('./telemetry/TelemetryService');
            telemetryService.track({
                name: lexical ? 'rag_lexical_fallback' : 'rag_miss',
                modeId: mode.id,
                properties: { modeTemplateType: mode.templateType, fileCount: files.length },
            });
        } catch { /* non-fatal */ }
        return lexical;
    }

    /**
     * Phase 6 — summary-safe context block para post-call summarization.
     *
     * Includes o mode's `customContext` (low-token, user-authored, trusted) plus
     * up para a small budget of *retrieved* reference snippets. Never returns full
     * raw reference file bodies, even quando retrieval misses — que dados caminho is
     * covered by `buildActiveModeContextBlock()` e remains legacy/supporting.
     *
     * Callers pode opt out of o retrieved-snippets portion via
     * `options.includeReferenceSnippets = false` para honor the
     * `reference_files` provider dados scope sem losing mode customContext.
     */
    public buildSummarySafeModeContextBlock(
        modeId: string,
        options?: { query?: string; transcript?: string; tokenBudget?: number; includeReferenceSnippets?: boolean }
    ): string {
        const mode = this.getModes().find(m => m.id === modeId);
        if (!mode) return '';

        const parts: string[] = [];

        // Summary caminho é non-negotiation por nature — soltar sensitive customContext
        // chunks (salary/pricing/strategy) então they can't land em a stored summary.
        const summaryCustom = dropSensitiveCustomContext(mode.customContext);
        if (summaryCustom) {
            parts.push(`<active_mode_custom_instructions format="json">\n${encodeModeContextPayload({ content: summaryCustom })}\n</active_mode_custom_instructions>`);
        }

        const includeReferenceSnippets = options?.includeReferenceSnippets !== false;
        if (includeReferenceSnippets) {
            try {
                const result = this.modeContextRetriever.retrieve(mode, this.getReferenceFiles(mode.id), {
                    query: options?.query ?? '',
                    transcript: options?.transcript ?? '',
                    tokenBudget: options?.tokenBudget ?? 1200,
                });
                if (result?.formattedContext) {
                    parts.push(result.formattedContext);
                }
            } catch (err) {
                console.warn('[ModesManager] summary-safe retrieval failed (non-fatal):', (err as Error)?.message);
            }
        }

        return parts.length > 0 ? '\n' + parts.join('\n\n') + '\n' : '';
    }

    public buildActiveModeContextBlock(): string {
        const mode = this.getActiveMode();
        if (!mode) return '';

        const parts: string[] = [];

        if (mode.customContext.trim()) {
            parts.push(`<active_mode_custom_instructions format="json">\n${encodeModeContextPayload({ content: mode.customContext.trim() })}\n</active_mode_custom_instructions>`);
        }

        const files = this.getReferenceFiles(mode.id);
        const MARKER = '[...truncated]';
        let totalChars = 0;

        for (const file of files) {
            const raw = file.content.trim();
            if (!raw) continue;

            const remaining = ModesManager.MAX_TOTAL_CHARS - totalChars;
            if (remaining <= 0) break;

            // Cap per-file. Apenas anexar o truncation marker quando there's
            // headroom para o completo marker — nunca emitir a parcial '[...truncat'.
            const fileCap = ModesManager.MAX_FILE_CHARS;
            let capped: string;
            if (raw.length > fileCap) {
                if (fileCap > MARKER.length + 1) {
                    capped = raw.slice(0, fileCap - MARKER.length - 1) + '\n' + MARKER;
                } else {
                    capped = raw.slice(0, fileCap);
                }
            } else {
                capped = raw;
            }

            // Aplica o cross-file budget. If o slice iria divide o marker, soltar it.
            let content: string;
            if (capped.length <= remaining) {
                content = capped;
            } else if (remaining >= MARKER.length + 1) {
                content = capped.slice(0, remaining - MARKER.length - 1) + '\n' + MARKER;
            } else {
                content = capped.slice(0, remaining);
            }

            const payload = encodeModeContextPayload({ fileName: file.fileName, content });
            parts.push(`<reference_file format="json">\n${payload}\n</reference_file>`);
            totalChars += content.length;
        }

        return parts.join('\n\n');
    }
}
