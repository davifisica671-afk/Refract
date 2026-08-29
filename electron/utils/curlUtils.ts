/**
 * =============================================================================
 * curlUtils.ts — UTILITÁRIOS PARA COMANDOS cURL E PROVEDORES PERSONALIZADOS
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Fornece utilitários para validar e processar comandos cURL que o usuário
 * configura como provedor de API personalizado. Permite usar QUALQUER API
 * de LLM que seja compatível com o formato OpenAI (chat completions).
 * 
 * FLUXO DO USUÁRIO:
 * 1. Usuário cola um comando cURL do Swagger/Postman de uma API
 * 2. validateCurl() verifica se é válido e contém {{TEXT}}
 * 3. deepVariableReplacer() substitui placeholders {{KEY}} pelos valores reais
 * 4. imageMimeTypeFromPath() detecta tipo de imagem para envio multimodal
 * 
 * SEGURANÇA:
 * - Validação de URL contra SSRF (Server-Side Request Forgery)
 * - Validação segura de caminhos de imagem (só permite acessar userData)
 * - Substituição de variáveis é recursiva e segura
 * =============================================================================
 */

import curl2Json from "@bany/curl-to-json";
import fs from "node:fs";
import path from "node:path";

export interface CurlValidationResult {
    isValid: boolean;
    message?: string;
    json?: any;
}

/**
 * Valida se o comando cURL é analisável e contém as variáveis obrigatórias
 */
export const validateCurl = (curl: string): CurlValidationResult => {
    if (!curl || !curl.trim()) {
        return { isValid: false, message: "Command cannot be empty." };
    }

    if (!curl.trim().toLowerCase().startsWith("curl")) {
        return { isValid: false, message: "Command must start with 'curl'." };
    }

    try {
        const json = curl2Json(curl);

        // Garantir que {{TEXT}} está presente para que possamos injetar o prompt
        // Verificamos a string bruta porque o placeholder pode estar na URL, cabeçalho ou corpo
        if (!curl.includes("{{TEXT}}")) {
            return {
                isValid: false,
                message: "Your cURL must contain {{TEXT}} placeholder for the prompt."
            };
        }

        return { isValid: true, json };
    } catch (error) {
        return { isValid: false, message: "Invalid cURL syntax." };
    }
};

/**
 * Substitui os placeholders {{KEY}} pelos valores reais
 */
export function deepVariableReplacer(
    node: any,
    variables: Record<string, string>
): any {
    if (typeof node === "string") {
        let result = node;
        for (const [key, value] of Object.entries(variables)) {
            // Global replace of {{KEY}}
            result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
        }
        return result;
    }
    if (Array.isArray(node)) {
        return node.map((item) => deepVariableReplacer(item, variables));
    }
    if (node && typeof node === "object") {
        const newNode: { [key: string]: any } = {};
        for (const key in node) {
            newNode[key] = deepVariableReplacer(node[key], variables);
        }
        return newNode;
    }
    return node;
}

/**
 * Detecta o tipo MIME a partir da extensão do caminho do arquivo.
 * Retorna "image/png" por padrão porque o ScreenshotHelper do app produz exclusivamente arquivos .png.
 */
export function imageMimeTypeFromPath(filePath: string): string {
    // Extrair apenas o componente da extensão final, protegendo contra caminhos sem ponto
    const basename = filePath.split(/[/\\]/).pop() ?? "";
    const dotIdx = basename.lastIndexOf(".");
    const ext = dotIdx !== -1 ? basename.slice(dotIdx + 1).toLowerCase() : "";
    const map: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
    };
    return map[ext] ?? "image/png";
}

/**
 * Atualiza automaticamente a última mensagem do usuário em um array `messages`
 * compatível com OpenAI de uma string simples para um array multimodal quando
 * uma imagem base64 está presente.
 *
 * - Se `body.messages` não for um array, retorna `body` inalterado (no-op para formatos não-OpenAI).
 * - Se a última mensagem do usuário já contiver uma parte image_url, não é duplicada.
 * - Se o conteúdo já for um array multimodal (ex: o usuário incluiu manualmente {{IMAGE_BASE64}}
 *   em um campo image_url), a imagem é anexada apenas se ainda não estiver presente.
 * - Todas as outras mensagens e campos do body permanecem inalterados (totalmente retrocompatível).
 */
export function injectImageIntoMessages(
    body: any,
    base64Image: string,
    imagePath: string
): any {
    if (!base64Image || !Array.isArray(body?.messages)) return body;

    const messages: any[] = body.messages.slice();

    // Encontrar a última mensagem com papel de usuário
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === "user") {
            lastUserIdx = i;
            break;
        }
    }
    if (lastUserIdx === -1) return body;

    const lastUser = messages[lastUserIdx];
    const mimeType = imageMimeTypeFromPath(imagePath);
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    if (Array.isArray(lastUser.content)) {
        // Já é um array multimodal — anexar image_url apenas se ausente
        const alreadyHasImage = lastUser.content.some(
            (part: any) => part?.type === "image_url"
        );
        if (alreadyHasImage) return body;
        messages[lastUserIdx] = {
            ...lastUser,
            content: [
                ...lastUser.content,
                { type: "image_url", image_url: { url: imageUrl } },
            ],
        };
    } else if (typeof lastUser.content === "string") {
        // String simples → array multimodal padrão OpenAI
        messages[lastUserIdx] = {
            ...lastUser,
            content: [
                { type: "text", text: lastUser.content },
                { type: "image_url", image_url: { url: imageUrl } },
            ],
        };
    }
    // Conteúdo que não é string nem array (ex: null/undefined): permanece inalterado

    return { ...body, messages };
}

/**
 * Valida uma URL para prevenir ataques SSRF.
 * Retorna { isValid: true } se a URL for segura para buscar.
 * Retorna { isValid: false, reason: string } se a URL estiver bloqueada.
 *
 * Bloqueios:
 * - localhost, 127.0.0.1, ::1 (loopback)
 * - 0.0.0.0
 * - link-local (169.254.0.0/16)
 * - redes privadas (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - URLs relativas a protocolo (//example.com)
 * - Sequências de travessia de diretório (/../)
 */
export function validateUrlForSsrf(urlString: string): { isValid: boolean; reason?: string } {
    if (!urlString || typeof urlString !== 'string') {
        return { isValid: false, reason: 'URL must be a non-empty string' };
    }

    // Bloquear URLs relativas a protocolo
    if (urlString.startsWith('//')) {
        return { isValid: false, reason: 'Protocol-relative URLs are not allowed' };
    }

    // Bloquear URLs data:
    if (urlString.toLowerCase().startsWith('data:')) {
        return { isValid: false, reason: 'Data URLs are not allowed' };
    }

    // Bloquear URLs file:
    if (urlString.toLowerCase().startsWith('file:')) {
        return { isValid: false, reason: 'File URLs are not allowed' };
    }

    // Bloquear URLs javascript:
    if (urlString.toLowerCase().startsWith('javascript:')) {
        return { isValid: false, reason: 'JavaScript URLs are not allowed' };
    }

    let url: URL;
    try {
        url = new URL(urlString);
    } catch (e) {
        return { isValid: false, reason: 'Invalid URL format' };
    }

    const hostname = url.hostname.toLowerCase();

    // Bloquear variantes de localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
        return { isValid: false, reason: 'Loopback addresses are not allowed' };
    }

    // Bloquear link-local (169.254.x.x)
    if (hostname.startsWith('169.254.')) {
        return { isValid: false, reason: 'Link-local addresses are not allowed' };
    }

    // Bloquear faixas de redes privadas
    // 10.0.0.0/8
    if (hostname.startsWith('10.')) {
        return { isValid: false, reason: 'Private network (10.x.x.x) is not allowed' };
    }

    // 172.16.0.0/12 — 172.16.x.x até 172.31.x.x
    if (hostname.startsWith('172.')) {
        const secondOctet = parseInt(hostname.split('.')[1], 10);
        if (secondOctet >= 16 && secondOctet <= 31) {
            return { isValid: false, reason: 'Private network (172.16-31.x.x) is not allowed' };
        }
    }

    // 192.168.0.0/16
    if (hostname.startsWith('192.168.')) {
        return { isValid: false, reason: 'Private network (192.168.x.x) is not allowed' };
    }

    // Bloquear URLs com travessia de diretório
    if (urlString.includes('/../') || urlString.includes('/..\\')) {
        return { isValid: false, reason: 'Path traversal sequences are not allowed' };
    }

    // Exigir HTTPS para URLs externas (permitir http://localhost apenas para testes em dev)
    if (url.protocol !== 'https:' && !hostname.startsWith('127.')) {
        return { isValid: false, reason: 'Only HTTPS URLs are allowed (except localhost)' };
    }

    return { isValid: true };
}

/**
 * SEGURANÇA (P0): Valida se um caminho de imagem é seguro para uso.
 *
 * Usa resolução realpath para detectar escapes por symlink e fornece
 * defesa em profundidade contra ataques de travessia de diretório.
 *
 * Bloqueios:
 * - Sequências de travessia de diretório (/../ ou /..\)
 * - Caminhos absolutos fora de diretórios pertencentes ao app
 * - Caminhos sensíveis do sistema (/etc/, /home/, /var/, etc.)
 * - Caminhos de unidade Windows (C:\, D:\, etc.)
 * - Escapes por symlink para diretórios fora das raízes permitidas
 *
 * Caminhos permitidos (lista de permissão):
 * - Caminhos dentro do diretório userData
 * - Caminhos dentro de <userData>/screenshots/
 * - Caminhos dentro de <userData>/extra_screenshots/
 * - Quaisquer outros diretórios de captura de tela criados explicitamente pelo app
 *
 * @param imagePath - O caminho a ser validado
 * @param userDataPath - O caminho do diretório userData do app
 * @returns { isValid: boolean, reason?: string }
 */
export function validateImagePath(imagePath: string, userDataPath: string): { isValid: boolean; reason?: string } {
    if (!imagePath || typeof imagePath !== 'string') {
        return { isValid: false, reason: 'Image path must be a non-empty string' };
    }

    // Normalizar separadores de caminho
    const normalizedPath = imagePath.replace(/\\/g, '/');

    // Bloquear travessia de diretório
    if (normalizedPath.includes('/../') || normalizedPath.includes('/..\\')) {
        return { isValid: false, reason: 'Path traversal sequences are not allowed' };
    }

    // NOTA: a verificação de caminho de unidade Windows está DEPOIS da lista de permissão abaixo, não aqui.
    // No Windows, o userData é ele próprio um caminho de unidade absoluto
    // (ex: C:\Users\<user>\AppData\Roaming\natively), então todo caminho legítimo
    // de captura de tela começa com uma letra de unidade. Rejeitar caminhos de unidade
    // antecipadamente bloqueou as próprias capturas de tela do app antes que a lista de
    // permissão pudesse aprová-las (issue #304). Isso espelha os bloqueios de caminho
    // absoluto Unix, que também são executados após a lista de permissão.

    // Normalizar userDataPath para comparação
    const normalizedUserData = userDataPath.replace(/\\/g, '/');

    // Definir raízes permitidas (apenas diretórios pertencentes ao app)
    const allowedRoots = [
        normalizedUserData,
        path.join(normalizedUserData, 'screenshots').replace(/\\/g, '/'),
        path.join(normalizedUserData, 'extra_screenshots').replace(/\\/g, '/'),
    ].filter(Boolean);

    // Resolver o caminho da imagem para seu caminho real para detectar escapes por symlink
    let resolvedPath: string;
    try {
        resolvedPath = fs.realpathSync(imagePath);
        resolvedPath = resolvedPath.replace(/\\/g, '/');
    } catch {
        // Se o realpath falhar, o arquivo não existe ou é inacessível.
        // Ainda queremos validar o caminho solicitado por segurança.
        // Verificar se o caminho solicitado é seguro (não cruzando limites).
        resolvedPath = normalizedPath;
    }

    // Normalizar userData para comparação (garantir barra final para correspondência de prefixo)
    const normalizedUserDataWithSlash = normalizedUserData ? normalizedUserData.replace(/\/?$/, '/') : '';

    // Verificar se o caminho resolvido está dentro de alguma raiz permitida
    const isAllowed = allowedRoots.some(allowedRoot => {
        const allowedWithSlash = allowedRoot.replace(/\/?$/, '/');
        return resolvedPath.startsWith(allowedWithSlash) || resolvedPath === allowedRoot;
    });

    if (isAllowed) {
        return { isValid: true };
    }

    // Também verificar o caminho original contra as raízes permitidas como fallback
    // Isso lida com casos onde o caminho resolvido é o mesmo que o normalizado
    const originalIsAllowed = allowedRoots.some(allowedRoot => {
        const allowedWithSlash = allowedRoot.replace(/\/?$/, '/');
        return normalizedPath.startsWith(allowedWithSlash) || normalizedPath === allowedRoot;
    });

    if (originalIsAllowed) {
        return { isValid: true };
    }

    // Bloquear caminhos de unidade Windows que estão fora do userData (ex: C:\Windows\System32,
    // D:\secrets, ou o perfil de outro usuário). Caminhos legítimos de captura de tela do Windows
    // ficam sob <userData> e já foram permitidos pela lista de permissão acima.
    if (/^[A-Za-z]:\\/.test(imagePath)) {
        return { isValid: false, reason: 'Windows absolute paths are not allowed' };
    }

    // Bloquear caminhos absolutos Unix que estão fora do userData
    if (normalizedPath.startsWith('/etc/') ||
        normalizedPath.startsWith('/home/') ||
        normalizedPath.startsWith('/var/') ||
        normalizedPath.startsWith('/tmp/')) {
        return { isValid: false, reason: 'Paths outside app directory are not allowed' };
    }

    // Bloquear caminhos que resolvem fora das raízes permitidas (tentativa de escape por symlink)
    if (resolvedPath !== normalizedPath && !isAllowed) {
        return { isValid: false, reason: 'Symlink escape detected: path resolves outside allowed directory' };
    }

    // Se não conseguimos determinar que o caminho é seguro, bloquear
    return { isValid: false, reason: 'Image path must be inside app directory or screenshots folder' };
}

/**
 * Auxiliar para percorrer um objeto JSON usando notação de ponto (ex: "choices[0].message.content")
 */
export function getByPath(obj: any, path: string): any {
    if (!path) return obj;
    return path
        .replace(/\[/g, ".")
        .replace(/\]/g, "")
        .split(".")
        .reduce((o, k) => (o || {})[k], obj);
}
