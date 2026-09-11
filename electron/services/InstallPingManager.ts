/**
 * ================================================================================
 * InstallPingManager - Contador anônimo de instalações (opcional, desligado)
 * ================================================================================
 *
 * PROPÓSITO:
 * Envia um ping anônimo ÚNICO na primeira instalação, apenas para estimar o
 * total de instalações. Desligado por padrão: sem endpoint configurado,
 * nenhum dado sai da máquina.
 *
 * O QUE É ENVIADO (exatamente isso, e só se configurado):
 * - "app": "refract" (identificador fixo do app)
 * - "install_id": UUID aleatório gerado uma vez por instalação (sem vínculo
 *   com usuário ou hardware)
 * - "version": versão do app (package.json)
 * - "platform": "darwin" | "win32" | "linux"
 *
 * O QUE NUNCA É COLETADO:
 * - Endereços IP (não armazenados por este código)
 * - Fingerprints de hardware
 * - Contas de usuário ou login
 * - Analytics de uso ou comportamento
 * - Sessões, timestamps ou timezones
 * - Pings repetidos (dispara no máximo uma vez por instalação)
 *
 * GARANTIAS:
 * - O install_id é um UUID aleatório, sem correlação com hardware/identidade.
 * - Depois de enviado, nunca repete (flag em arquivo local).
 * - Falha é sempre silenciosa — nunca bloqueia a inicialização do app.
 * - getOrCreateInstallId() é reutilizado como id local estável (ex.: Hindsight)
 *   e funciona mesmo com o ping desligado.
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
 * Endpoint do ping anônimo de instalação.
 *
 * Desligado por padrão: o ping SÓ é enviado quando um endpoint é configurado
 * explicitamente via REFRACT_INSTALL_PING_URL. Sem isso, nenhum dado de rede
 * sai da máquina (e nenhum dado legado é enviado para infraestrutura antiga).
 */
const INSTALL_PING_URL = (process.env.REFRACT_INSTALL_PING_URL || '').trim();

// Local storage paths (dentro user dados ddiretório
const INSTALL_ID_PATH = path.join(app.getPath('userData'), 'install_id.txt');
const INSTALL_PING_SENT_PATH = path.join(app.getPath('userData'), 'install_ping_sent.txt');

// ============================================================================
// Auxiliar Functions
// ============================================================================

/**
 * Obtém ou cria o ID anônimo persistente de instalação.
 * UUID aleatório, sem vínculo com hardware ou identidade do usuário.
 * Uma vez criado, nunca muda.
 */
export function getOrCreateInstallId(): string {
    try {
        // Reaproveita o ID existente
        if (fs.existsSync(INSTALL_ID_PATH)) {
            const existingId = fs.readFileSync(INSTALL_ID_PATH, 'utf-8').trim();
            if (existingId && existingId.length > 0) {
                return existingId;
            }
        }

        // Gera um novo UUID
        const newId = uuidv4();
        fs.writeFileSync(INSTALL_ID_PATH, newId, 'utf-8');
        console.log('[InstallPingManager] Generated new install ID');
        return newId;
    } catch (error) {
        console.error('[InstallPingManager] Error managing install ID:', error);
        // ID temporário se não der para persistir (o ping pode repetir, sem problema)
        return uuidv4();
    }
}

/**
 * Verifica se o ping de instalação já foi enviado.
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
 * Marca o ping de instalação como enviado.
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
 * Envia o ping anônimo único de instalação.
 *
 * - Sai cedo se o ping já foi enviado
 * - Envia um payload mínimo e anônimo ao endpoint configurado
 * - Marca como enviado para não repetir
 * - Nunca bloqueia a inicialização do app
 * - Falha sempre em silêncio, em qualquer erro
 */
export async function sendAnonymousInstallPing(): Promise<void> {
    try {
        // Desligado por padrão — sem endpoint, sem ping, sem exceção.
        if (!INSTALL_PING_URL) {
            return;
        }
        // Early exit se ping já sent
        if (hasInstallPingBeenSent()) {
            console.log('[InstallPingManager] Install ping already sent, skipping');
            return;
        }

        const installId = getOrCreateInstallId();
        const version = app.getVersion();
        const platform = process.platform; // 'darwin' | 'win32' | 'linux'

        const payload = {
            app: 'refract',
            install_id: installId,
            version: version,
            platform: platform
        };

        console.log('[InstallPingManager] Sending anonymous install ping...');

        // Fetch não-bloqueante com timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // timeout de 5s

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
            // Não marca como enviado em falha — tenta de novo no próximo launch
            console.log(`[InstallPingManager] Install ping failed with status: ${response.status}`);
        }
    } catch (error) {
        // Falha silenciosa — funcionalidade não-crítica.
        // Causas comuns: sem rede, endpoint inexistente ou timeout.
        console.log('[InstallPingManager] Install ping failed (silent):', error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Export em namespace, por compatibilidade com o padrão require().
 */
export const InstallPingManager = {
    getOrCreateInstallId,
    sendAnonymousInstallPing
};
