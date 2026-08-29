import { useState, useEffect, useCallback } from 'react';
import { acceleratorToKeys, keysToAccelerator } from '../utils/keyboardUtils';
import { getPlatformShortcut, isMac } from '../utils/platformUtils';

// Definir a estrutura da nossa configuração de atalhos
export interface ShortcutConfig {
    whatToAnswer: string[];
    autoAnswerMode: string[];
    clarify: string[];
    followUp: string[];
    dynamicAction4: string[];
    answer: string[];
    codeHint: string[];
    brainstorm: string[];
    shorten: string[];
    recap: string[];
    scrollUp: string[];
    scrollDown: string[];
    scrollLeft: string[];
    scrollRight: string[];
    focusInput: string[];
    // Movimento de Janela
    moveWindowUp: string[];
    moveWindowDown: string[];
    moveWindowLeft: string[];
    moveWindowRight: string[];
    // General
    toggleVisibility: string[];
    toggleMousePassthrough: string[];
    processScreenshots: string[];
    captureAndProcess: string[];
    capturePage: string[];
    resetCancel: string[];
    takeScreenshot: string[];
    selectiveScreenshot: string[];
}

function buildDefaultShortcuts(): ShortcutConfig {
    const mod = isMac ? '⌘' : 'Ctrl';
    const shift = isMac ? '⇧' : 'Shift';
    return {
        whatToAnswer: [mod, '1'],
        autoAnswerMode: [mod, 'f'],
        clarify: [mod, '2'],
        dynamicAction4: [mod, '3'],
        followUp: [mod, '4'],
        answer: [mod, '5'],
        codeHint: [mod, '6'],
        brainstorm: [mod, '7'],
        shorten: [],
        recap: [],
        scrollUp: [mod, '↑'],
        scrollDown: [mod, '↓'],
        scrollLeft: [mod, isMac ? '⌥' : 'Alt', '←'],
        scrollRight: [mod, isMac ? '⌥' : 'Alt', '→'],
        focusInput: [mod, shift, 'Space'],
        moveWindowUp: [mod, shift, '↑'],
        moveWindowDown: [mod, shift, '↓'],
        moveWindowLeft: [mod, shift, '←'],
        moveWindowRight: [mod, shift, '→'],
        toggleVisibility: [mod, 'B'],
        toggleMousePassthrough: [mod, shift, 'B'],
        processScreenshots: [mod, 'Enter'],
        captureAndProcess: [mod, shift, 'Enter'],
        capturePage: [mod, shift, 'Y'],
        resetCancel: [mod, 'R'],
        takeScreenshot: [mod, 'H'],
        selectiveScreenshot: [mod, shift, 'H']
    };
}

/**
 * Atalhos padrão conscientes da plataforma. Calculados uma vez quando o módulo carrega usando a
 * plataforma do processo atual — mesma fonte de verdade como `buildDefaultShortcuts()`
 * abaixo que é o inicializador real do hook. Mantido como exportação nomeada para que
 * consumidores que precisam dos padrões sincronicamente (sem invocar o hook)
 * não vejam glifos de Mac não Windows.
 *
 * Nota histórica: esta exportação era anteriormente codificada com literais '⌘'/'⌥'/'⇧',
 * o que apresentaria símbolos de Mac em qualquer superfície Windows que
 * a consumisse diretamente. Substituir o literal por `buildDefaultShortcuts()`
 * mantém os dois caminhos de código consistentes.
 */
export const DEFAULT_SHORTCUTS: ShortcutConfig = buildDefaultShortcuts();

export const useShortcuts = () => {
    // Inicializar estado com padrões conscientes da plataforma
    const [shortcuts, setShortcuts] = useState<ShortcutConfig>(buildDefaultShortcuts);

    // Mapear atalhos do backend (array de objetos) para estado do frontend (ShortcutConfig)
    const mapBackendToFrontend = useCallback((backendKeybinds: any[]) => {
        setShortcuts(prev => {
            const newShortcuts: any = { ...prev };

            backendKeybinds.forEach(kb => {
                const keys = acceleratorToKeys(kb.accelerator);

                // Mapear IDs do backend para teclas do frontend
                if (kb.id === 'chat:whatToAnswer') newShortcuts.whatToAnswer = keys;
                else if (kb.id === 'chat:followUp') newShortcuts.followUp = keys;
                else if (kb.id === 'chat:followup') newShortcuts.followUp = keys; // backwards compat
                else if (kb.id === 'chat:clarify') newShortcuts.clarify = keys;
                else if (kb.id === 'chat:dynamicAction4') newShortcuts.dynamicAction4 = keys;
                else if (kb.id === 'chat:answer') newShortcuts.answer = keys;
                else if (kb.id === 'chat:codeHint') newShortcuts.codeHint = keys;
                else if (kb.id === 'chat:brainstorm') newShortcuts.brainstorm = keys;
                else if (kb.id === 'chat:shorten') newShortcuts.shorten = keys;
                else if (kb.id === 'chat:recap') newShortcuts.recap = keys;
                else if (kb.id === 'chat:scrollUp') newShortcuts.scrollUp = keys;
                else if (kb.id === 'chat:scrollDown') newShortcuts.scrollDown = keys;
                else if (kb.id === 'chat:scrollLeft') newShortcuts.scrollLeft = keys;
                else if (kb.id === 'chat:scrollRight') newShortcuts.scrollRight = keys;
                else if (kb.id === 'chat:focusInput') newShortcuts.focusInput = keys;
                else if (kb.id === 'chat:auto-answer-mode') newShortcuts.autoAnswerMode = keys;
                // Window
                else if (kb.id === 'window:move-up') newShortcuts.moveWindowUp = keys;
                else if (kb.id === 'window:move-down') newShortcuts.moveWindowDown = keys;
                else if (kb.id === 'window:move-left') newShortcuts.moveWindowLeft = keys;
                else if (kb.id === 'window:move-right') newShortcuts.moveWindowRight = keys;
    // Geral
                else if (kb.id === 'general:toggle-visibility') newShortcuts.toggleVisibility = keys;
                else if (kb.id === 'general:toggle-mouse-passthrough') newShortcuts.toggleMousePassthrough = keys;
                else if (kb.id === 'general:process-screenshots') newShortcuts.processScreenshots = keys;
                else if (kb.id === 'general:capture-and-process') newShortcuts.captureAndProcess = keys;
                else if (kb.id === 'general:capture-dom') newShortcuts.capturePage = keys;
                else if (kb.id === 'general:reset-cancel') newShortcuts.resetCancel = keys;
                else if (kb.id === 'general:take-screenshot') newShortcuts.takeScreenshot = keys;
                else if (kb.id === 'general:selective-screenshot') newShortcuts.selectiveScreenshot = keys;
            });

            return newShortcuts;
        });
    }, []);

    // Carregar do Processo Principal na montagem
    useEffect(() => {
        const api = window.electronAPI;
        if (!api?.getKeybinds || !api?.onKeybindsUpdate) return;

        const fetchKeybinds = async () => {
            try {
                const keybinds = await api.getKeybinds();
                mapBackendToFrontend(keybinds);
            } catch (error) {
                console.error('Failed to fetch keybinds:', error);
            }
        };

        fetchKeybinds();

        // Escutar para atualizações
        const unsubscribe = api.onKeybindsUpdate((keybinds) => {
            mapBackendToFrontend(keybinds);
        });

        return unsubscribe;
    }, [mapBackendToFrontend]);

    // Função para atualizar um atalho específico
    const updateShortcut = useCallback(async (actionId: keyof ShortcutConfig, keys: string[]) => {
        // Atualização otimista
        setShortcuts(prev => ({ ...prev, [actionId]: keys }));

        const accelerator = keysToAccelerator(keys);
        let backendId = '';

        // Mapear tecla do frontend de volta para ID do backend
        switch (actionId) {
            case 'whatToAnswer': backendId = 'chat:whatToAnswer'; break;
            case 'autoAnswerMode': backendId = 'chat:auto-answer-mode'; break;
            case 'clarify': backendId = 'chat:clarify'; break;
            case 'followUp': backendId = 'chat:followUp'; break;
            case 'dynamicAction4': backendId = 'chat:dynamicAction4'; break;
            case 'answer': backendId = 'chat:answer'; break;
            case 'codeHint': backendId = 'chat:codeHint'; break;
            case 'brainstorm': backendId = 'chat:brainstorm'; break;
            case 'shorten': backendId = 'chat:shorten'; break;
            case 'recap': backendId = 'chat:recap'; break;
            case 'scrollUp': backendId = 'chat:scrollUp'; break;
            case 'scrollDown': backendId = 'chat:scrollDown'; break;
            case 'scrollLeft': backendId = 'chat:scrollLeft'; break;
            case 'scrollRight': backendId = 'chat:scrollRight'; break;
            case 'focusInput': backendId = 'chat:focusInput'; break;
            // Window
            case 'moveWindowUp': backendId = 'window:move-up'; break;
            case 'moveWindowDown': backendId = 'window:move-down'; break;
            case 'moveWindowLeft': backendId = 'window:move-left'; break;
            case 'moveWindowRight': backendId = 'window:move-right'; break;
            // General
            case 'toggleVisibility': backendId = 'general:toggle-visibility'; break;
            case 'toggleMousePassthrough': backendId = 'general:toggle-mouse-passthrough'; break;
            case 'processScreenshots': backendId = 'general:process-screenshots'; break;
            case 'captureAndProcess': backendId = 'general:capture-and-process'; break;
            case 'capturePage': backendId = 'general:capture-dom'; break;
            case 'resetCancel': backendId = 'general:reset-cancel'; break;
            case 'takeScreenshot': backendId = 'general:take-screenshot'; break;
            case 'selectiveScreenshot': backendId = 'general:selective-screenshot'; break;
            default: break;
        }

        if (backendId) {
            const api = window.electronAPI;
            if (!api?.setKeybind) return;
            try {
                await api.setKeybind(backendId, accelerator);
            } catch (error) {
                console.error(`Failed to set keybind for ${actionId}:`, error);
            }
        }
    }, []);

    // Função para redefinir todos os atalhos para os padrões
    const resetShortcuts = useCallback(async () => {
        const api = window.electronAPI;
        if (!api?.resetKeybinds) {
            setShortcuts(buildDefaultShortcuts());
            return;
        }
        try {
            const defaults = await api.resetKeybinds();
            mapBackendToFrontend(defaults);
        } catch (error) {
            console.error('Failed to reset keybinds:', error);
        }
    }, [mapBackendToFrontend]);

    // Função auxiliar para verificar se um evento de teclado corresponde a um atalho configurado
    const isShortcutPressed = useCallback((event: KeyboardEvent | React.KeyboardEvent, actionId: keyof ShortcutConfig): boolean => {
        const keys = shortcuts[actionId];
        if (!keys || keys.length === 0) return false;

        // Verificar modificadores — consciente da plataforma:
        // No Mac: ⌘ = metaKey. No Win/Linux: Ctrl mapeia para ctrlKey.
        // 'CommandOrControl' (⌘/Ctrl) corresponde a metaKey não Mac, ctrlKey não Win/Linux.
        const isCommandOrControl = (k: string) =>
            ['⌘', 'Command', 'Meta', 'CommandOrControl'].includes(k);
        const isCtrl = (k: string) =>
            ['⌃', 'Control', 'Ctrl'].includes(k);

        const hasCommandOrControl = keys.some(isCommandOrControl);
        const hasCtrlOnly = !hasCommandOrControl && keys.some(isCtrl);
        const hasAlt = keys.some(k => ['⌥', 'Alt', 'Option'].includes(k));
        const hasShift = keys.some(k => ['⇧', 'Shift'].includes(k));

        if (isMac) {
            // No Mac: ⌘ = metaKey, ⌃ = ctrlKey
            if (event.metaKey !== hasCommandOrControl) return false;
            if (event.ctrlKey !== hasCtrlOnly) return false;
        } else {
            // No Win/Linux: ambos ⌘ e Ctrl mapeiam para ctrlKey
            const needsCtrl = hasCommandOrControl || hasCtrlOnly;
            if (event.ctrlKey !== needsCtrl) return false;
            if (event.metaKey) return false; // metaKey nunca deve ser pressionado no Windows
        }
        if (event.altKey !== hasAlt) return false;
        if (event.shiftKey !== hasShift) return false;

        // Encontrar a tecla principal não-modificadora
        const mainKey = keys.find(k =>
            !['⌘', 'Command', 'Meta', '⇧', 'Shift', '⌥', 'Alt', 'Option', '⌃', 'Control', 'Ctrl'].includes(k)
        );

        if (!mainKey) return false; // Apenas modificadores

        // Verificação de normalização
        const eventKey = event.key.toLowerCase();
        let configKey = mainKey.toLowerCase();

        if (configKey === '↑') configKey = 'arrowup';
        if (configKey === '↓') configKey = 'arrowdown';
        if (configKey === '←') configKey = 'arrowleft';
        if (configKey === '→') configKey = 'arrowright';

        // Tratar Espaço especificamente
        if (configKey === 'space') {
            return event.code === 'Space';
        }

        // Tratar teclas de Setas
        // O acelerador do Electron usa 'ArrowUp' (mapeado de 'Up') para cima. O event.key é 'ArrowUp',
        // então a comparação direta geralmente funciona.

        return eventKey === configKey;
    }, [shortcuts]);

    return {
        shortcuts,
        updateShortcut,
        resetShortcuts,
        isShortcutPressed
    };
};
