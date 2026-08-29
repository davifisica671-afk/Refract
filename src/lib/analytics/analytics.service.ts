/**
 * =============================================================================
 * analytics.service.ts — SERVIÇO DE ANALYTICS (GA4)
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Serviço singleton que gerencia analytics via Google Analytics 4 (GA4).
 * Injeta dinamicamente o script gtag.js no DOM do renderer do Electron.
 * 
 * POR QUE INJEÇÃO DINÂMICA?
 * O Electron não permite carregar scripts externos normalmente.
 * Em vez disso, criamos o elemento <script> programaticamente e o
 * injetamos no <head> do documento.
 * 
 * EVENTOS RASTREADOS:
 * - app_opened / app_closed: Ciclo de vida do app
 * - assistant_started / assistant_stopped: Uso do assistente
 * - meeting_started / meeting_ended: Ciclo de reuniões
 * - model_used: Qual modelo de IA foi utilizado
 * - copy_answer_clicked: Usuário copiou uma resposta
 * - calendar_connected: Calendário conectado
 * - pdf_exported: PDF exportado
 * 
 * PRIVACIDADE:
 * - anonymize_ip: true (anonimiza endereço IP)
 * - send_page_view: false (não rastreia visualizações de página)
 * - Apenas ID de medição público é necessário (sem chaves de API)
 * =============================================================================
 */

// GA4 Analytics via injeção manual de gtag.js
// Funciona não Electron carregando dinamicamente o script gtag dentro do DOM do renderer
// Apenas requer o ID de Medição público — nenhuma chave de API necessária

// --- Types ---

export type ModelProviderType = 'cloud' | 'local';

export type AssistantMode = 'launcher' | 'overlay' | 'undetectable' | string;

export type AnalyticsEventName =
    // Ciclo de vida do App
    | 'app_opened'
    | 'app_closed'
    | 'first_launch'
    // Uso de Recursos
    | 'assistant_started'
    | 'assistant_stopped'
    | 'mode_selected'
    | 'copy_answer_clicked'
    | 'calendar_connected'
    | 'pdf_exported'
    // Ciclo de vida da Reunião
    | 'meeting_started'
    | 'meeting_ended'
    // Uso de Modelo
    | 'model_used'
    // Sessão
    | 'session_duration'
    // Engajamento
    | 'command_executed'
    | 'conversation_started';

interface ModelUsedPayload {
    model_name: string;
    provider_type: ModelProviderType;
    latency_ms: number;
    tokens_used?: number;
}

interface SessionDurationPayload {
    duration_seconds: number;
    assistant_active_seconds?: number;
    idle_seconds?: number;
}

// --- Configuração ---

const GA4_MEASUREMENT_ID = "G-494RMJ2G6E";
const APP_VERSION = "1.1.3";

// Estender janela para incluir gtag/dataLayer
declare global {
    interface Window {
        dataLayer: any[];
        gtag: (...args: any[]) => void;
    }
}

// --- Detecção de Provedor ---

/** Detectar se um modelo está sendo executado localmente (Ollama) ou na nuvem */
export function detectProviderType(modelName: string): ModelProviderType {
    const lower = modelName.toLowerCase();
    // Padrões de modelos Ollama / locais
    if (
        lower.startsWith('ollama:') ||
        lower.includes('llama') ||
        lower.includes('mistral') ||
        lower.includes('codellama') ||
        lower.includes('phi') ||
        lower.includes('deepseek') ||
        lower.includes('qwen') ||
        lower.includes('vicuna') ||
        lower.includes('orca')
    ) {
        return 'local';
    }
    // Modelos na nuvem (Gemini, GPT, Claude, Groq)
    return 'cloud';
}

// --- Serviço ---

class AnalyticsService {
    private static instance: AnalyticsService;
    private initialized = false;
    private sessionStartTime: number = Date.now();
    private assistantStartTime: number | null = null;
    private totalAssistantDuration: number = 0;

    private constructor() { }

    public static getInstance(): AnalyticsService {
        if (!AnalyticsService.instance) {
            AnalyticsService.instance = new AnalyticsService();
        }
        return AnalyticsService.instance;
    }

    public initAnalytics(): void {
        if (this.initialized) return;

        try {
            // 1. Inicializar dataLayer
            window.dataLayer = window.dataLayer || [];
            window.gtag = function () {
                window.dataLayer.push(arguments);
            };
            window.gtag('js', new Date());

            // 2. Configurar GA4 com configurações de privacidade
            window.gtag('config', GA4_MEASUREMENT_ID, {
                anonymize_ip: true,
                send_page_view: false,
                cookie_flags: 'SameSite=None;Secure',
                app_version: APP_VERSION,
            });

            // 3. Injetar o script gtag.js
            const script = document.createElement('script');
            script.async = true;
            script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
            script.onerror = () => {
                console.warn("[Analytics] Failed to load gtag.js — analytics disabled.");
            };
            document.head.appendChild(script);

            this.initialized = true;
            console.log(`[Analytics] Initialized (v${APP_VERSION}) via gtag.js injection.`);
        } catch (error) {
            console.warn("[Analytics] Initialization failed:", error);
        }
    }

    // --- Métodos de Rastreamento ---

    public trackAppOpen(): void {
        if (!this.initialized) return;

        this.trackEvent('app_opened');

        const hasLaunched = localStorage.getItem('refract_has_launched');
        if (!hasLaunched) {
            this.trackEvent('first_launch');
            localStorage.setItem('refract_has_launched', 'true');
        }
    }

    public trackAppClose(): void {
        if (!this.initialized) return;

        this.trackSessionDuration();
        this.trackEvent('app_closed');
    }

    public trackAssistantStart(): void {
        if (!this.initialized) return;

        this.assistantStartTime = Date.now();
        this.trackEvent('assistant_started');
    }

    public trackAssistantStop(): void {
        if (!this.initialized) return;

        if (this.assistantStartTime) {
            const duration = (Date.now() - this.assistantStartTime) / 1000;
            this.totalAssistantDuration += duration;
            this.assistantStartTime = null;
        }
        this.trackEvent('assistant_stopped');
    }

    public trackModeSelected(mode: AssistantMode): void {
        if (!this.initialized) return;

        this.trackEvent('mode_selected', { mode });
    }

    public trackModelUsed(payload: ModelUsedPayload): void {
        if (!this.initialized) return;

        this.trackEvent('model_used', payload);
    }

    public trackCopyAnswer(): void {
        if (!this.initialized) return;
        this.trackEvent('copy_answer_clicked');
    }

    public trackCommandExecuted(commandType: string): void {
        if (!this.initialized) return;
        this.trackEvent('command_executed', { command_type: commandType });
    }

    public trackConversationStarted(): void {
        if (!this.initialized) return;
        this.trackEvent('conversation_started');
    }

    public trackCalendarConnected(): void {
        if (!this.initialized) return;
        this.trackEvent('calendar_connected');
    }

    public trackMeetingStarted(): void {
        if (!this.initialized) return;
        this.trackEvent('meeting_started');
    }

    public trackMeetingEnded(): void {
        if (!this.initialized) return;
        this.trackEvent('meeting_ended');
    }

    public trackPdfExported(): void {
        if (!this.initialized) return;
        this.trackEvent('pdf_exported');
    }

    private trackSessionDuration(): void {
        const totalDuration = (Date.now() - this.sessionStartTime) / 1000;

        let currentAssistantDuration = this.totalAssistantDuration;
        if (this.assistantStartTime) {
            currentAssistantDuration += (Date.now() - this.assistantStartTime) / 1000;
        }

        const payload: SessionDurationPayload = {
            duration_seconds: Math.round(totalDuration),
            assistant_active_seconds: Math.round(currentAssistantDuration),
            idle_seconds: Math.round(totalDuration - currentAssistantDuration)
        };

        this.trackEvent('session_duration', payload);
    }

    // --- Remetente Central de Eventos ---

    private trackEvent(eventName: AnalyticsEventName, payload?: Record<string, any>): void {
        if (import.meta.env.DEV) {
            console.log(`[Analytics] ${eventName}`, payload);
        }

        try {
            if (typeof window.gtag === 'function') {
                window.gtag('event', eventName, {
                    app_version: APP_VERSION,
                    ...payload
                });
            }
        } catch (error) {
            console.warn("[Analytics] Failed to send event:", error);
        }
    }
}

export const analytics = AnalyticsService.getInstance();
