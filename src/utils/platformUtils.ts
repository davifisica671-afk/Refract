/**
 * ============================================================
 * UTILITÁRIOS DE PLATAFORMA
 * ============================================================
 * 
 * Este arquivo fornece funções e constantes para detectar e adaptar
 * o comportamento da aplicação ao sistema operacional do usuário.
 * 
 * PLATAFORMAS SUPORTADAS:
 * - darwin (macOS)
 * - win32 (Windows)
 * - linux (Linux)
 * 
 * USO PRINCIPAL:
 * - Detectar a plataforma atual (isMac, isWindows, isLinux)
 * - Converter símbolos de modificadores (Command, Ctrl, Alt, Shift)
 *   para os símbolos corretos da plataforma (⌘, ⌃, ⌥, ⇧)
 * - Converter atalhos de teclado entre formatos Electron e frontend
 * 
 * EXEMPLO:
 * Em macOS: CommandOrControl → ⌘
 * Em Windows: CommandOrControl → Ctrl
 * ============================================================
 */

/**
 * Normaliza a string da plataforma para um formato padrão.
 * 
 * PROBLEMA QUE RESOLVE:
 * A string da plataforma pode vir em diferentes formatos:
 * - "darwin", "mac", "macos" → todos devem virar "darwin"
 * - "win32", "windows", "win" → todos devem virar "win32"
 * - "linux", "ubuntu", "debian" → todos devem virar "linux"
 * 
 * @param p - String bruta da plataforma (de process.platform ou navigator.platform)
 * @returns String normalizada: "darwin", "win32", ou "linux"
 */
function normalizePlatform(p: string): string {
  if (p === 'darwin' || p.startsWith('mac')) return 'darwin';      // macOS em qualquer formato
  if (p === 'win32' || p.startsWith('win')) return 'win32';        // Windows em qualquer formato
  if (p.includes('linux')) return 'linux';                          // Linux em qualquer formato
  return p; // Retorna como está se não reconhecer (fallback)
}

/**
 * Detecta a plataforma atual do usuário.
 * Tenta primeiro via window.electronAPI (injetado pelo preload do Electron),
 * depois via navigator.platform (para desenvolvimento web), e por último string vazia.
 */
const platform = normalizePlatform(
  window.electronAPI?.platform ?? navigator.platform?.toLowerCase() ?? ''
);

// Constantes booleanas para verificações rápidas de plataforma
export const isMac = platform === 'darwin';     // true se macOS
export const isWindows = platform === 'win32';  // true se Windows
export const isLinux = platform === 'linux';    // true se Linux

/**
 * Retorna o símbolo visual correto para um modificador de teclado
 * baseado na plataforma atual.
 * 
 * EXEMPLOS:
 * Em macOS: getModifierSymbol('commandorcontrol') → '⌘'
 * Em Windows: getModifierSymbol('commandorcontrol') → 'Ctrl'
 * Em macOS: getModifierSymbol('alt') → '⌥'
 * Em Windows: getModifierSymbol('alt') → 'Alt'
 * 
 * @param modifier - Nome do modificador ( CommandOrControl, ctrl, alt, shift, etc.)
 * @returns Símbolo Unicode no macOS, ou nome legível no Windows/Linux
 */
export function getModifierSymbol(modifier: 'commandorcontrol' | 'ctrl' | 'control' | 'cmd' | 'command' | 'meta' | 'alt' | 'option' | 'shift'): string {
    const m = modifier.toLowerCase();
    // CommandOrControl/Cmd/Command/Meta/Ctrl/Control → ⌘ no macOS, Ctrl no Windows/Linux
    if (m === 'commandorcontrol' || m === 'cmd' || m === 'command' || m === 'meta' || m === 'ctrl' || m === 'control') {
        return isMac ? '⌘' : 'Ctrl';
    }
    // Alt/Option → ⌥ no macOS, Alt no Windows/Linux
    if (m === 'alt' || m === 'option') {
        return isMac ? '⌥' : 'Alt';
    }
    // Shift → ⇧ no macOS, Shift no Windows/Linux
    if (m === 'shift') {
        return isMac ? '⇧' : 'Shift';
    }
    return modifier; // Retorna como está se não reconhecer
}

/**
 * Converte um array de nomes de teclas do Electron para símbolos
 * visuais conscientes da plataforma.
 * 
 * EXEMPLO:
 * Em macOS: ['CommandOrControl', 'Shift', 'Space'] → ['⌘', '⇧', 'Space']
 * Em Windows: ['CommandOrControl', 'Shift', 'Space'] → ['Ctrl', 'Shift', 'Space']
 * 
 * @param keys - Array de nomes de teclas no formato Electron
 * @returns Array de símbolos visuais adaptados à plataforma
 */
export function getPlatformShortcut(keys: string[]): string[] {
    return keys.map(key => {
        const k = key.toLowerCase();
        if (k === '⌘' || k === 'command' || k === 'meta' || k === 'cmd') {
            return isMac ? '⌘' : 'Ctrl';
        }
        if (k === '⌃' || k === 'control' || k === 'ctrl') {
            return isMac ? '⌃' : 'Ctrl';
        }
        if (k === '⌥' || k === 'option' || k === 'alt') {
            return isMac ? '⌥' : 'Alt';
        }
        if (k === '⇧' || k === 'shift') {
            return isMac ? '⇧' : 'Shift';
        }
        return key; // Retorna como está se não for um modificador
    });
}
