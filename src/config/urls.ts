/**
 * ============================================================
 * CONSTANTES CENTRALIZADAS DE CHECKOUT E URLs EXTERNAS
 * ============================================================
 * 
 * Este arquivo contém todas as URLs de pagamento/checkout e links
 * externos importantes do aplicativo. Centralizar aqui permite:
 * 
 * 1. MUDANÇA ÚNICA: Se uma URL de checkout mudar, basta alterar aqui
 *    e todos os arquivos que importam este módulo receberão a atualização
 * 
 * 2. SEGURANÇA: Evita URLs "hardcoded" espalhadas pelo código-fonte
 *    que seriam difíceis de atualizar e auditadas
 * 
 * 3. MANUTENÇÃO: Fácil de localizar e gerenciar todas as URLs externas
 * 
 * USO:
 * import { CHECKOUT_URLS } from '../config/urls';
 * window.open(CHECKOUT_URLS.apiPro);
 * 
 * ESTRUTURA:
 * Cada URL aponta para uma página de checkout da DodoPayments,
 * que é o processador de pagamentos utilizado pelo Refract.
 * ============================================================
 */

export const CHECKOUT_URLS = {
    /** URL de checkout para Refract Pro (planos lifetime e yearly) */
    pro: 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA',
    
    /** URL de checkout para Refract API — Plano Standard (básico) */
    apiStandard: 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl',
    
    /** URL de checkout para Refract API — Plano Pro (intermediário) */
    apiPro: 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA',
    
    /** URL de checkout para Refract API — Plano Max (avançado) */
    apiMax: 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf',
    
    /** URL de checkout para Refract API — Plano Ultra (premium) */
    apiUltra: 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU',
} as const; // 'as const' torna o objeto readonly e os valores são literais de string
