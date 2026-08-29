/**
 * =============================================================================
 * DonationManager.ts — GERENCIADOR DE PEDIDO DE DOAÇÃO
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Controla quando e como o app exibe um pedido de doação para o usuário.
 * Segue uma estratégia anti-assédio:
 * - Máximo 5 exibições na vida do app
 * - Intervalo mínimo de 21 dias entre exibições
 * - Espera 10 segundos após iniciar o app antes da primeira exibição
 * - Após doação confirmada: NUNCA mais exibe
 * 
 * SEGURANÇA:
 * - Estado persistido com criptografia (electron-store)
 * - Arquivo separado da configuração principal (refract-preferences-secure)
 * =============================================================================
 */
import Store from 'electron-store';
import crypto from 'crypto';

interface DonationState {
    hasDonated: boolean;
    lastShownAt: number | null;
    lifetimeShows: number;
}


export class DonationManager {
    private static instance: DonationManager;
    private store: Store<DonationState>;

    // Constantes
    private readonly MAX_LIFETIME_SHOWS = 5;
    private readonly DAYS_INTERVAL = 21;
    private readonly SHOW_DELAY_MS = 10000; // 10 segundos após o app iniciar

    private constructor() {
        this.store = new Store<DonationState>({
            name: 'refract-preferences-secure', // Arquivo diferente da configuração principal
            defaults: {
                hasDonated: false,
                lastShownAt: null,
                lifetimeShows: 0
            },
            // Criptografia no v8 funcionou bem, mantida para proteção contra adulteração óbvia
            encryptionKey: 'refract-secure-storage-key'
        });
    }

    public static getInstance(): DonationManager {
        if (!DonationManager.instance) {
            DonationManager.instance = new DonationManager();
        }
        return DonationManager.instance;
    }

    public getDonationState(): DonationState {
        return {
            hasDonated: this.store.get('hasDonated'),
            lastShownAt: this.store.get('lastShownAt'),
            lifetimeShows: this.store.get('lifetimeShows')
        };
    }

    public shouldShowToaster(): boolean {
        const state = this.getDonationState();

        // 1. Se já doou, nunca mostrar
        if (state.hasDonated) return false;

        // 2. Se excedeu o máximo de exibições, nunca mostrar
        if (state.lifetimeShows >= this.MAX_LIFETIME_SHOWS) return false;

        // 3. Verificar intervalo de tempo
        if (state.lastShownAt === null) {
            // Primeira vez, já pode mostrar
            return true;
        }

        const now = Date.now();
        const daysSinceLastShow = (now - state.lastShownAt) / (1000 * 60 * 60 * 24);

        return daysSinceLastShow >= this.DAYS_INTERVAL;
    }

    public markAsShown(): void {
        const state = this.getDonationState();
        this.store.set({
            hasDonated: state.hasDonated, // Preservar existente
            lastShownAt: Date.now(),
            lifetimeShows: state.lifetimeShows + 1
        });
        console.log('[DonationManager] Toaster shown. Count:', state.lifetimeShows + 1);
    }

    public setHasDonated(status: boolean): void {
        this.store.set('hasDonated', status);
    }
}
