/**
 * analytics.ts — Wrapper PostHog para o Refract (renderer).
 *
 * Módulo AUTOCONTIDO: não altera nenhum arquivo existente. Para ativar,
 * basta importar e chamar `initAnalytics()` uma vez no bootstrap do app
 * (ex.: em src/main.tsx ou src/App.tsx).
 *
 * Design:
 *  - Respeita a proposta de privacidade do Refract: NÃO coleta dados pessoais.
 *    Usa um ID anônimo (UUID persistido em localStorage), nunca email/nome.
 *  - Fail-open: se o PostHog não estiver configurado (sem VITE_POSTHOG_KEY),
 *    todas as chamadas são no-ops silenciosos. Nada quebra.
 *  - Eventos de funil de conversão: instalação → trial → pagamento.
 *
 * Config (via .env / Vite):
 *   VITE_POSTHOG_KEY   chave do projeto PostHog (ex: phc_xxx)
 *   VITE_POSTHOG_HOST  host do PostHog (default https://app.posthog.com)
 *
 * Uso:
 *   import { initAnalytics, track } from '@/lib/analytics';
 *   initAnalytics();
 *   track('upgrade_clicked', { plan: 'monthly' });
 */
import posthog from 'posthog-js';

// ── config ─────────────────────────────────────────────────────────────
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://app.posthog.com';

let _initialized = false;

// ── ID anônimo (privacidade: nunca email/nome) ────────────────────────
const ANON_ID_KEY = 'refract_anon_id';

function getAnonId(): string {
    try {
        let id = localStorage.getItem(ANON_ID_KEY);
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem(ANON_ID_KEY, id);
        }
        return id;
    } catch {
        // localStorage indisponível (ex.: modo privado) — gera em memória.
        return crypto.randomUUID();
    }
}

// ── init ───────────────────────────────────────────────────────────────
export function initAnalytics(): void {
    if (_initialized) return;
    if (!POSTHOG_KEY) {
        console.log('[Analytics] PostHog não configurado (VITE_POSTHOG_KEY ausente) — analytics desativado.');
        return;
    }
    try {
        posthog.init(POSTHOG_KEY, {
            api_host: POSTHOG_HOST,
            // Privacidade: não capturar dados pessoais automaticamente.
            capture_pageview: false,
            capture_pageleave: false,
            autocapture: false,
            disable_session_recording: true,
            // ID anônimo estável.
            person_profiles: 'identified_only',
        });
        posthog.identify(getAnonId());
        _initialized = true;
        console.log('[Analytics] PostHog inicializado.');
    } catch (err) {
        console.warn('[Analytics] Falha ao inicializar PostHog:', err);
    }
}

// ── track ──────────────────────────────────────────────────────────────
export type AnalyticsEvent =
    | 'app_installed'
    | 'app_launched'
    | 'trial_started'
    | 'trial_expired'
    | 'feature_used'
    | 'upgrade_clicked'
    | 'checkout_opened'
    | 'payment_succeeded'
    | 'payment_failed'
    | 'license_activated'
    | 'license_expired'
    | 'churn';

export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
    if (!_initialized || !POSTHOG_KEY) return;
    try {
        posthog.capture(event, props);
    } catch (err) {
        console.warn(`[Analytics] Falha ao registrar evento ${event}:`, err);
    }
}

// ── helpers de funil (conveniência) ────────────────────────────────────
export const analytics = {
    appInstalled: () => track('app_installed'),
    appLaunched: () => track('app_launched'),
    trialStarted: (props?: Record<string, unknown>) => track('trial_started', props),
    trialExpired: () => track('trial_expired'),
    featureUsed: (feature: string, props?: Record<string, unknown>) =>
        track('feature_used', { feature, ...props }),
    upgradeClicked: (plan: string) => track('upgrade_clicked', { plan }),
    checkoutOpened: (provider: string) => track('checkout_opened', { provider }),
    paymentSucceeded: (plan: string) => track('payment_succeeded', { plan }),
    paymentFailed: (reason?: string) => track('payment_failed', { reason }),
    licenseActivated: (provider: string) => track('license_activated', { provider }),
    licenseExpired: () => track('license_expired'),
    churn: (reason?: string) => track('churn', { reason }),
};