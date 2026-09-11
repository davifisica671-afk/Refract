/**
 * RoleTwinManager — Persistência e orquestração dos Role Twins.
 *
 * Um Role Twin é uma "cópia de inteligência" de uma oportunidade: a descrição
 * da vaga analisada contra o perfil do candidato, com mapa de requisitos
 * (matched/partial/gap), temas prováveis de entrevista e plano de preparação.
 *
 * Responsabilidades:
 * - Persistir twins em electron-store (arquivo dedicado refract-role-twins)
 * - Chamar RoleTwinService.analyze() com o contexto do candidato disponível
 * - Pesquisar o dossiê da empresa (CompanyResearchEngine) quando solicitado,
 *   com o mesmo gate pro-ou-trial do handler profile:research-company
 * - Garantir um único twin ativo por vez
 *
 * Contrato consumido por electron/services/RoleTwinIpc.ts:
 *   getInstance(), list(), getActive(), analyze(), setActive(), delete()
 */
import Store from 'electron-store';
import * as crypto from 'crypto';
import type { LLMHelper } from '../LLMHelper';
import type { AppState } from '../main';
import { RoleTwinService, type RoleTwin, type RoleTwinAnalysis } from './RoleTwinService';

interface RoleTwinStoreShape {
    twins: RoleTwin[];
    activeId: string | null;
}

export interface RoleTwinAnalyzeInput {
    id?: string;
    company: string;
    roleTitle: string;
    jobDescription: string;
    forceResearch?: boolean;
}

export interface RoleTwinAnalyzeResult {
    success: boolean;
    twin?: RoleTwin;
    error?: string;
}

/**
 * F-14: mesmo gate "pro ou trial ativo" dos handlers profile:* em
 * ipcHandlers.ts. Espelhado aqui (em vez de importado) porque o
 * ipcHandlers define a função localmente; duplicar a lógica curta é
 * preferível a criar dependência do módulo gigante de IPC.
 */
export function isProOrTrialActive(): boolean {
    try {
        const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
        if (LicenseManager.getInstance().isPremium()) return true;
    } catch {
        /* módulo premium não disponível */
    }
    try {
        const { CredentialsManager } = require('./CredentialsManager');
        const cm = CredentialsManager.getInstance();
        const token = cm.getTrialToken();
        if (!token) return false;
        const expiresAt = cm.getTrialExpiresAt();
        if (!expiresAt) return false;
        return new Date(expiresAt).getTime() > Date.now();
    } catch {
        return false;
    }
}

export class RoleTwinManager {
    private static _instance: RoleTwinManager | null = null;

    private store: Store<RoleTwinStoreShape>;
    private appState: AppState | null = null;

    private constructor() {
        this.store = new Store<RoleTwinStoreShape>({
            name: 'refract-role-twins',
            defaults: { twins: [], activeId: null },
        });
    }

    public static getInstance(): RoleTwinManager {
        if (!RoleTwinManager._instance) {
            RoleTwinManager._instance = new RoleTwinManager();
        }
        return RoleTwinManager._instance;
    }

    /** Injeta o AppState (chamado no registro dos handlers IPC, pós-app.ready). */
    public setAppState(appState: AppState): void {
        this.appState = appState;
    }

    // ------------------------------------------------------------- leitura

    public list(): RoleTwin[] {
        return this.store.get('twins');
    }

    public getActive(): RoleTwin | null {
        const activeId = this.store.get('activeId');
        return this.list().find((twin) => twin.id === activeId) || null;
    }

    // ------------------------------------------------------------- análise

    public async analyze(input: RoleTwinAnalyzeInput): Promise<RoleTwinAnalyzeResult> {
        const company = (input.company || '').trim();
        const roleTitle = (input.roleTitle || '').trim();
        const jobDescription = (input.jobDescription || '').trim();

        if (!company || !roleTitle) return { success: false, error: 'missing_company_or_role' };
        if (!jobDescription) return { success: false, error: 'missing_job_description' };

        const llmHelper = this.getLLMHelper();
        if (!llmHelper) return { success: false, error: 'llm_not_initialized' };

        try {
            const profile = this.getProfileContext();

            let companyDossier: RoleTwin['companyDossier'] = null;
            if (input.forceResearch) {
                companyDossier = await this.researchCompany(company, roleTitle, jobDescription);
            }

            const service = new RoleTwinService(llmHelper);
            const analysis: RoleTwinAnalysis = await service.analyze({
                company,
                roleTitle,
                jobDescription,
                candidateProfile: profile.candidateProfile,
                storyContext: profile.storyContext,
                companyDossier: companyDossier
                    ? this.dossierToPromptBlock(companyDossier)
                    : undefined,
            });

            const now = new Date().toISOString();
            const existing = input.id ? this.list().find((twin) => twin.id === input.id) : null;

            const twin: RoleTwin = {
                id: existing?.id || crypto.randomUUID(),
                company,
                roleTitle,
                jobDescription,
                analysis,
                companyDossier,
                isActive: true,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
            };

            this.persistActivated(twin);
            return { success: true, twin };
        } catch (err: any) {
            console.error('[RoleTwinManager] analyze failed:', err);
            return { success: false, error: err?.message || 'analysis_failed' };
        }
    }

    // ------------------------------------------------------------- mutação

    public setActive(id: string | null): { success: boolean; error?: string } {
        const twins = this.list();
        if (id !== null && !twins.some((twin) => twin.id === id)) {
            return { success: false, error: 'twin_not_found' };
        }
        this.store.set({
            twins,
            activeId: id,
        });
        return { success: true };
    }

    public delete(id: string): { success: boolean; error?: string } {
        const twins = this.list();
        const remaining = twins.filter((twin) => twin.id !== id);
        if (remaining.length === twins.length) {
            return { success: false, error: 'twin_not_found' };
        }
        const activeId = this.store.get('activeId');
        this.store.set({
            twins: remaining,
            activeId: activeId === id ? null : activeId,
        });
        return { success: true };
    }

    // ------------------------------------------------------------- helpers

    private persistActivated(twin: RoleTwin): void {
        const twins = this.list();
        const exists = twins.some((item) => item.id === twin.id);
        const next = exists
            ? twins.map((item) => (item.id === twin.id ? twin : item))
            : [twin, ...twins];
        this.store.set({ twins: next, activeId: twin.id });
    }

    private getLLMHelper(): LLMHelper | null {
        try {
            return this.appState?.processingHelper?.getLLMHelper?.() || null;
        } catch {
            return null;
        }
    }

    /**
     * Contexto do candidato a partir do Knowledge Orchestrator, quando
     * disponível (build premium). Sem orchestrator, a análise funciona
     * apenas com a JD — gaps aparecem em vez de evidência inventada.
     */
    private getProfileContext(): { candidateProfile: string; storyContext: string } {
        try {
            const orchestrator: any = this.appState?.getKnowledgeOrchestrator?.();
            if (!orchestrator) return { candidateProfile: '', storyContext: '' };

            const profileData = orchestrator.getProfileData?.();
            const candidateProfile: string = profileData?.parsedResume?.summary || '';
            const stories: any[] = profileData?.storyBank || profileData?.stories || [];
            const storyContext = Array.isArray(stories)
                ? stories
                    .slice(0, 30)
                    .map((story) => {
                        const label = story?.title || story?.name || '';
                        const text = story?.content || story?.text || story?.summary || '';
                        return [label, text].filter(Boolean).join(': ');
                    })
                    .filter(Boolean)
                    .join('\n')
                : '';
            return { candidateProfile, storyContext };
        } catch {
            return { candidateProfile: '', storyContext: '' };
        }
    }

    /**
     * Dossiê de empresa via CompanyResearchEngine com o mesmo gate premium e
     * mesma cascata de provedores de busca (Tavily BYOK → Refract API) do
     * handler profile:research-company. Fail-soft: qualquer falha vira
     * companyDossier null — a análise LLM continua sem o dossiê.
     */
    private async researchCompany(
        company: string,
        roleTitle: string,
        jobDescription: string,
    ): Promise<RoleTwin['companyDossier']> {
        try {
            // Gate pro-ou-trial — idêntico ao de profile:research-company
            // (F-14: antes era isPremium() puro, e o trial ficava de fora).
            if (!isProOrTrialActive()) return null;

            const { DatabaseManager } = require('../db/DatabaseManager');
            const sqliteDb = DatabaseManager.getInstance().getDb();
            if (!sqliteDb) return null;

            const { KnowledgeDatabaseManager } = require('../../premium/electron/knowledge/KnowledgeDatabaseManager');
            const { CompanyResearchEngine } = require('../../premium/electron/knowledge/CompanyResearchEngine');
            const knowledgeDb = new KnowledgeDatabaseManager(sqliteDb);

            const llmHelper = this.getLLMHelper();
            const engine = new CompanyResearchEngine(knowledgeDb, () =>
                llmHelper
                    ? async (contents: Array<{ text: string }>) =>
                          await llmHelper.generateContentStructured(
                              contents.map((c) => c.text).filter(Boolean).join('\n\n'),
                          )
                    : null,
            );

            // Cascata de provedores de busca: Tavily BYOK → Refract API → LLM-only.
            const { CredentialsManager } = require('./CredentialsManager');
            const cm = CredentialsManager.getInstance();
            const tavilyApiKey = cm.getTavilyApiKey();
            if (tavilyApiKey) {
                const { TavilySearchProvider } = require('../../premium/electron/knowledge/TavilySearchProvider');
                engine.setSearchProvider(new TavilySearchProvider(tavilyApiKey));
            } else {
                const refractKey = cm.getRefractApiKey();
                if (refractKey) {
                    const { RefractSearchProvider } = require('../../premium/electron/knowledge/RefractSearchProvider');
                    engine.setSearchProvider(new RefractSearchProvider(refractKey));
                }
            }

            const dossier = await engine.researchCompany(
                company,
                { title: roleTitle, requirements: jobDescription.slice(0, 4000) },
                true,
            );
            return (dossier as RoleTwin['companyDossier']) || null;
        } catch (err) {
            console.warn('[RoleTwinManager] company research skipped:', err);
            return null;
        }
    }

    /** Serializa o dossiê em bloco de prompt plano para o RoleTwinService. */
    private dossierToPromptBlock(dossier: NonNullable<RoleTwin['companyDossier']>): string {
        const lines: string[] = [];
        if (dossier.summary) lines.push(`Summary: ${dossier.summary}`);
        if (dossier.products?.length) lines.push(`Products: ${dossier.products.join(', ')}`);
        if (dossier.culture?.length) lines.push(`Culture: ${dossier.culture.join(', ')}`);
        if (dossier.recent_news?.length) lines.push(`Recent news: ${dossier.recent_news.join(' | ')}`);
        if (dossier.interview_angles?.length)
            lines.push(`Interview angles: ${dossier.interview_angles.join(' | ')}`);
        return lines.join('\n');
    }
}
