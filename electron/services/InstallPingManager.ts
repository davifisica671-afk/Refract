/**
 * ================================================================================
 * InstallPingManager - Anonymous Install Counter
 * ================================================================================
 *
 * PURPOSE:
 * This módulo envia a ONE-TIME anonymous ping quando o app é primeiro installed.
 * It exists solely para estimate total install counts para o open-source project.
 *
 * O que É SENT (exexatamente
 * - "app": "natively" (hardcoded app identifier)
 * - "install_id": A random UUID generated uma vez por install (Não tied para user/hardware)
 * - "veversão O app versão de package.json
 * - "plplataforma "darwin" | "win32" | "linux"
 *
 * O que É EXPLICITLY Não COLLECTED:
 * ❌ IP addresses (não stored por isso código - backend precisa também não sarmazenamento
 * ❌ Hardware fingerprints
 * ❌ User accounts ou login info
 * ❌ Usage analytics ou behavior tracking
 * ❌ Sessão information
 * ❌ Qualquer repeated pings (fires exatamente uma vez por install)
 * ❌ Timestamps ou timezone data
 *
 * PRIVACY GUARANTEES:
 * - O install_id é a random UUID com não correlation para hardware ou identity
 * - Uma vez sent, o ping é nunca repeated (controlled por local flag farquivo
 * - If o ping fails, it fails silently - não aggressive tenta novamente
 * - This código é completamente auditable e easy para remover se unwanted
 *
 * This é Não analytics. This é Não telemetry. This é a simples install counter.
 * ================================================================================
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Configuração
// ============================================================================

/**
 * Anonymous install ping endpoint.
 * Substituir isso URL com your actual Cloudflare Worker endpoint.
 */
const INSTALL_PING_URL = 'https://divine-sun-927d.natively.workers.dev';

// Local storage paths (dentro user dados ddiretório
const INSTALL_ID_PATH = path.join(app.getPath('userData'), 'install_id.txt');
const INSTALL_PING_SENT_PATH = path.join(app.getPath('userData'), 'install_ping_sent.txt');

// ============================================================================
// Auxiliar Functions
// ============================================================================

/**
 * Obtém ou cria a persistent anonymous install ID.
 * This ID é a random UUID com não conexão para hardware ou user identity.
 * Uma vez created, it nunca changes.
 */
export function getOrCreateInstallId(): string {
    try {
        // Verifica se install ID já exists
        if (fs.existsSync(INSTALL_ID_PATH)) {
            const existingId = fs.readFileSync(INSTALL_ID_PATH, 'utf-8').trim();
            if (existingId && existingId.length > 0) {
                return existingId;
            }
        }

        // Gera novo UUID
        const newId = uuidv4();
        fs.writeFileSync(INSTALL_ID_PATH, newId, 'utf-8');
        console.log('[InstallPingManager] Generated new install ID');
        return newId;
    } catch (error) {
        console.error('[InstallPingManager] Error managing install ID:', error);
        // Retorna a temporary ID se we can't persist (ping pode repeat, mas that's fine)
        return uuidv4();
    }
}

/**
 * Verifica se o install ping tem já sido sent.
 */
function hasInstallPingBeenSent(): boolean {
    try {
        if (fs.existsSync(INSTALL_PING_SENT_PATH)) {
            const value = fs.readFileSync(INSTALL_PING_SENT_PATH, 'utf-8').trim();
            return value === 'true';
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Mark o install ping como sent.
 */
function markInstallPingSent(): void {
    try {
        fs.writeFileSync(INSTALL_PING_SENT_PATH, 'true', 'utf-8');
        console.log('[InstallPingManager] Install ping marked as sent');
    } catch (error) {
        console.error('[InstallPingManager] Error marking ping as sent:', error);
    }
}

// ============================================================================
// Principal Exportar
// ============================================================================

/**
 * Envia a one-time anonymous install ping.
 *
 * This ffunção
 * - Verifica se a ping tem já sido sent (exits early se sentão
 * - Envia a minimal, anonymous payload para o configured endpoint
 * - Marks o ping como sent para prevenir future pings
 * - Nunca blocks app startup
 * - Fails silently em qualquer error
 */
export async function sendAnonymousInstallPing(): Promise<void> {
    try {
        // Early exit se ping já sent
        if (hasInstallPingBeenSent()) {
            console.log('[InstallPingManager] Install ping already sent, skipping');
            return;
        }

        const installId = getOrCreateInstallId();
        const version = app.getVersion();
        const platform = process.platform; // 'darwin' | 'win32' | 'linux'

        const payload = {
            app: 'natively',
            install_id: installId,
            version: version,
            platform: platform
        };

        console.log('[InstallPingManager] Sending anonymous install ping...');

        // Non-blocking busca com timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 segundo timeout

        const response = await fetch(INSTALL_PING_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            markInstallPingSent();
            console.log('[InstallPingManager] Install ping sent successfully');
        } else {
            // Don't mark como sent em failure - vai tentar novamente em próximo launch
            console.log(`[InstallPingManager] Install ping failed with status: ${response.status}`);
        }
    } catch (error) {
        // Silently fail - isso é non-critical functionality
        // Common reasons: não network, endpoint doesn't exist yainda timeout
        console.log('[InstallPingManager] Install ping failed (silent):', error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Namespace exportar para compatibility com reexigir pattern
 */
export const InstallPingManager = {
    getOrCreateInstallId,
    sendAnonymousInstallPing
};
