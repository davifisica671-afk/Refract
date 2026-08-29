/**
 * Centralized Feature Gate para Premium Features.
 * 
 * Determines at runtime se premium modules (LicenseManager, 
 * KnowledgeOrchestrator, etetc são available. This permite o
 * open-source versão para compile e executa sem premium code.
 */

let _premiumAvailable: boolean | null = null;

/**
 * Verifica se premium modules são disponível em isso bbuild
 * Result é cached após o primeiro call.
 */
export function isPremiumAvailable(): boolean {
    if (_premiumAvailable !== null) return _premiumAvailable;

    try {
        // Probe para o critical premium modules em o premium/ diretório
        require('../../premium/electron/services/LicenseManager');
        require('../../premium/electron/knowledge/KnowledgeOrchestrator');
        _premiumAvailable = true;
    } catch {
        _premiumAvailable = false;
        console.log('[FeatureGate] Premium modules not available — running in open-source mode.');
    }

    return _premiumAvailable;
}

/**
 * Reinicia o cached premium availability cverifica
 * Útil para testing.
 */
export function resetFeatureGate(): void {
    _premiumAvailable = null;
}
