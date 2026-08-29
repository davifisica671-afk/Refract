/**
 * ============================================================
 * GERENCIADOR DE TEMA DA INTERFACE DE REUNIÃO
 * ============================================================
 * 
 * Este arquivo gerencia os temas visuais disponíveis para a
 * interface de reunião (overlay) do Refract.
 * 
 * TEMAS DISPONÍVEIS:
 * - 'default': Tema padrão com efeito de vidro fosco
 * - 'liquid-glass': Efeito de vidro líquido (mais moderno)
 * - 'modern': Tema moderno com design atualizado
 * 
 * COMO FUNCIONA:
 * 1. O tema é armazenado no localStorage
 * 2. Ao ler, valida se o valor é válido (compatibilidade)
 * 3. Ao escrever, notifica todas as janelas via evento + IPC
 * 
 * POR QUE NOTIFICAR VIA IPC?
 * As BrowserWindows do Electron são contextos Chromium separados.
 * Um evento `storage` na janela de configurações NÃO alcança a
 * janela do overlay. Sem IPC, o overlay ficaria com tema desatualizado.
 * ============================================================
 */

/**
 * Tipo que representa os temas disponíveis para a interface de reunião.
 */
export type MeetingInterfaceTheme = 'default' | 'liquid-glass' | 'modern';

/** Chave do localStorage para armazenar o tema selecionado */
const STORAGE_KEY = 'refract_meeting_interface_theme';

/**
 * Conjunto de temas válidos para validação.
 * Usado para rejeitar valores desconhecidos ou legados.
 */
const VALID_THEMES: ReadonlySet<MeetingInterfaceTheme> = new Set([
    'default',      // Tema padrão
    'liquid-glass', // Efeito vidro líquido
    'modern',       // Tema moderno
]);

/**
 * Lê o tema atual da interface de reunião do localStorage.
 * 
 * VALIDAÇÃO:
 * - Se o valor armazenado for válido, retorna ele
 * - Se for inválido/null, retorna 'default'
 * - Isso garante compatibilidade futura e passada
 * 
 * @returns O tema atualmente selecionado
 */
export function getMeetingInterfaceTheme(): MeetingInterfaceTheme {
    const stored = localStorage.getItem(STORAGE_KEY) as MeetingInterfaceTheme | null;
    
    // Rejeitar valores desconhecidos/legados para não contaminar a UI
    if (stored && VALID_THEMES.has(stored)) {
        return stored;
    }
    return 'default'; // Fallback seguro
}

/**
 * Define o tema da interface de reunião e notifica todas as janelas.
 * 
 * FLUXO:
 * 1. Salva o tema no localStorage
 * 2. Dispara evento 'storage' para assinantes na mesma janela
 * 3. Envia IPC para notificar outras janelas (overlay, etc.)
 * 
 * @param theme - O tema a ser aplicado
 */
export function setMeetingInterfaceTheme(theme: MeetingInterfaceTheme): void {
    // Salvar no localStorage
    localStorage.setItem(STORAGE_KEY, theme);
    
    // Notificar assinantes na MESMA janela
    // (o evento `storage` não dispara na janela que escreveu,
    // então despachamos manualmente)
    window.dispatchEvent(new Event('storage'));
    
    // Transmissão entre janelas via IPC
    // As BrowserWindows do Electron são contextos Chromium separados.
    // Sem esta hop de IPC, o estado React do overlay ficaria preso
    // ao valor de tema que ele leu ao montar, causando UI desatualizada.
    try {
        window.electronAPI?.setMeetingInterfaceTheme?.(theme);
    } catch {
        // Preload não disponível (ex: executando em host não-Electron)
        // O caminho do localStorage ainda funciona dentro de uma única janela
    }
}
