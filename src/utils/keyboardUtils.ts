/**
 * ============================================================
 * UTILITÁRIOS DE ATALHO DE TECLADO
 * ============================================================
 * 
 * Este arquivo fornece funções para converter atalhos de teclado
 * entre o formato Electron (usado no backend) e o formato do
 * frontend (usado na interface do usuário).
 * 
 * POR QUE PRECISA DESSA CONVERSÃO?
 * - Electron usa strings como "CommandOrControl+Shift+Space"
 * - A UI precisa exibir símbolos como "⌘⇧Space" (macOS) ou "Ctrl+Shift+Space" (Windows)
 * - O inverso também é verdade: quando o usuário configura um atalho na UI,
 *   precisamos converter de volta para o formato Electron
 * 
 * CONVERSÕES SUPORTADAS:
 * - Modificadores: CommandOrControl ↔ ⌘/Ctrl, Alt ↔ ⌥/Alt, Shift ↔ ⇧/Shift
 * - Setas: ArrowUp ↔ ↑, ArrowDown ↔ ↓, ArrowLeft ↔ ←, ArrowRight ↔ →
 * - Teclas especiais: Space, Enter, Tab, etc.
 * 
 * EXEMPLOS:
 * acceleratorToKeys("CommandOrControl+Shift+Space") → ["⌘", "⇧", "Space"] (macOS)
 * keysToAccelerator(["⌘", "⇧", "Space"]) → "CommandOrControl+Shift+Space"
 * ============================================================
 */

import { getModifierSymbol, isMac } from './platformUtils';

/**
 * Converte uma string de Acelerador do Electron em um array de teclas
 * conscientes da plataforma para exibição no frontend.
 * 
 * COMO FUNCIONA:
 * 1. Divide a string por "+" para obter cada tecla individual
 * 2. Para cada tecla, converte o nome para o símbolo correto da plataforma
 * 3. Retorna um array de strings prontas para exibição
 * 
 * EXEMPLOS:
 * Em macOS: acceleratorToKeys("CommandOrControl+Shift+Space") → ["⌘", "⇧", "Space"]
 * Em Windows: acceleratorToKeys("CommandOrControl+Shift+Space") → ["Ctrl", "Shift", "Space"]
 * 
 * @param accelerator - String no formato Electron (ex: "CommandOrControl+Shift+Space")
 * @returns Array de strings com símbolos visuais para cada tecla
 */
export function acceleratorToKeys(accelerator: string): string[] {
    if (!accelerator) return []; // Retornar vazio se não houver acelerador

    // Dividir por "+" para obter individualmente cada tecla
    const parts = accelerator.split('+');
    
    // Mapear cada parte para seu símbolo visual correspondente
    return parts.map(part => {
        switch (part.toLowerCase()) {
            // ============================================================
            // MODIFICADORES PRINCIPAIS
            // ============================================================
            case 'commandorcontrol':
            case 'cmd':
            case 'command':
            case 'meta':
                // CommandOrControl: ⌘ no macOS, Ctrl no Windows/Linux
                return getModifierSymbol('commandorcontrol');
            
            case 'control':
            case 'ctrl':
                // Control explícito: ⌃ no macOS (Control separado do Command),
                // Ctrl no Windows/Linux
                return getModifierSymbol('ctrl');
            
            case 'alt':
            case 'option':
                // Alt/Option: ⌥ no macOS, Alt no Windows/Linux
                return getModifierSymbol('alt');
            
            case 'shift':
                // Shift: ⇧ no macOS, Shift no Windows/Linux
                return getModifierSymbol('shift');
            
            // ============================================================
            // SETAS DIRECIONAIS
            // ============================================================
            case 'up':
            case 'arrowup':
                return '↑'; // Seta para cima
            case 'down':
            case 'arrowdown':
                return '↓'; // Seta para baixo
            case 'left':
            case 'arrowleft':
                return '←'; // Seta para esquerda
            case 'right':
            case 'arrowright':
                return '→'; // Seta para direita
            
            // ============================================================
            // OUTRAS TECLAS
            // ============================================================
            default:
                // Para teclas normais (letras, números, etc.):
                // - Se tiver 1 caractere, retorna em maiúscula (ex: "a" → "A")
                // - Se tiver mais de 1 caractere, retorna como está (ex: "Space", "Enter")
                return part.length === 1 ? part.toUpperCase() : part;
        }
    });
}

/**
 * Converte um array de teclas do frontend em uma string de Acelerador do Electron.
 * 
 * COMO FUNCIONA:
 * 1. Separa modificadores (Ctrl, Alt, Shift) da tecla principal
 * 2. Converte cada símbolo para o nome correspondente do Electron
 * 3. Junta tudo com "+" na ordem correta (modificadores primeiro)
 * 
 * EXEMPLOS:
 * ["Meta", "Shift", "Space"] → "CommandOrControl+Shift+Space"
 * ["⌘", "⇧", "Space"] → "CommandOrControl+Shift+Space"
 * ["Ctrl", "C"] → "CommandOrControl+C"
 * 
 * @param keys - Array de teclas no formato do frontend (símbolos ou nomes)
 * @returns String no formato Electron (ex: "CommandOrControl+Shift+Space")
 */
export function keysToAccelerator(keys: string[]): string {
    const modifiers: string[] = []; // Lista de modificadores encontrados
    let mainKey = '';               // Tecla principal (a última que não é modificador)

    keys.forEach(key => {
        switch (key.toLowerCase()) {
            // ============================================================
            // MODIFICADOR: COMMAND/CONTROL
            // ============================================================
            case 'meta':
            case 'command':
            case 'cmd':
            case '⌘':
                // No macOS: ⌘ é Command
                // No Windows/Linux: Ctrl é equivalente ao Command do macOS
                modifiers.push('CommandOrControl');
                break;
            
            // ============================================================
            // MODIFICADOR: CONTROL
            // ============================================================
            case 'control':
            case 'ctrl':
            case '⌃':
                // ⌃ (Control explícito) no macOS é diferente do Command
                // No Windows/Linux, não há diferença - tudo vira CommandOrControl
                // NOTA: Se você precisa de um atalho Mac-only com Ctrl,
                // use 'Ctrl' diretamente no template do acelerador
                modifiers.push(isMac ? 'Control' : 'CommandOrControl');
                break;
            
            // ============================================================
            // MODIFICADOR: ALT/OPTION
            // ============================================================
            case 'alt':
            case 'option':
            case '⌥':
                modifiers.push('Alt');
                break;
            
            // ============================================================
            // MODIFICADOR: SHIFT
            // ============================================================
            case 'shift':
            case '⇧':
                modifiers.push('Shift');
                break;
            
            // ============================================================
            // SETAS DIRECIONAIS (TECLAS PRINCIPAIS)
            // ============================================================
            case 'arrowup':
            case 'up':
            case '↑':
                mainKey = 'Up'; // Seta para cima
                break;
            case 'arrowdown':
            case 'down':
            case '↓':
                mainKey = 'Down'; // Seta para baixo
                break;
            case 'arrowleft':
            case 'left':
            case '←':
                mainKey = 'Left'; // Seta para esquerda
                break;
            case 'arrowright':
            case 'right':
            case '→':
                mainKey = 'Right'; // Seta para direita
                break;
            
            // ============================================================
            // TECLA PRINCIPAL PADRÃO (letras, números, etc.)
            // ============================================================
            default:
                // Converter para maiúscula (Electron espera "A", não "a")
                mainKey = key.toUpperCase();
        }
    });

    // Electron espera modificadores PRIMEIRO, depois a tecla principal
    // Exemplo: ["Shift", "CommandOrControl", "Space"] → "CommandOrControl+Shift+Space"
    return [...modifiers, mainKey].filter(Boolean).join('+');
}
