/**
 * ============================================================
 * HOOK: useResolvedTheme
 * ============================================================
 * 
 * Este hook React fornece o tema atualmente ativo (claro ou escuro)
 * de forma reativa - ou seja, sempre que o tema mudar, os componentes
 * que usam este hook são automaticamente re-renderizados.
 * 
 * COMO FUNCIONA:
 * 1. Lê o tema inicial do atributo data-theme no elemento <html>
 * 2. Observa mudanças nesse atributo usando MutationObserver
 * 3. Também escuta eventos IPC de mudança de tema do processo principal
 * 4. Retorna o tema atual como valor React state
 * 
 * POR QUE DOIS MECANISMOS?
 * - MutationObserver detecta mudanças no DOM (ex: quando main.tsx atualiza)
 * - IPC detecta mudanças do processo principal (fonte autoritativa)
 * - Isso garante redundância e confiabilidade
 * 
 * USO:
 * const theme = useResolvedTheme(); // 'light' ou 'dark'
 * ============================================================
 */

// ============================================================
// IMPORTAÇÕES
// ============================================================
import { useEffect, useState } from 'react'; // Hooks básicos do React

// ============================================================
// TIPOS
// ============================================================

/** Tipo que representa os temas resolvidos (após processamento) */
type ResolvedTheme = 'light' | 'dark';

/**
 * Lê o tema atual do atributo data-theme no elemento <html>.
 * 
 * LÓGICA:
 * - Se data-theme="light" → retorna 'light'
 * - Qualquer outro valor (incluindo null/undefined) → retorna 'dark'
 * 
 * @returns 'light' ou 'dark'
 */
const getResolvedTheme = (): ResolvedTheme =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

/**
 * Hook que retorna o tema atual de forma reativa.
 * 
 * @returns 'light' ou 'dark' - o tema atualmente ativo
 */
export const useResolvedTheme = (): ResolvedTheme => {
    // Estado inicial: lê o tema do DOM imediatamente
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => getResolvedTheme());

    useEffect(() => {
        // ============================================================
        // MECANISMO 1: MutationObserver
        // ============================================================
        // Observa alterações no atributo data-theme do elemento <html>.
        // Isso detecta mudanças feitas por main.tsx ou por qualquer
        // outro código que modifique o atributo diretamente.
        const observer = new MutationObserver(() => {
            setResolvedTheme(getResolvedTheme()); // Re-ler tema e atualizar state
        });
        
        // Observar apenas o atributo data-theme para otimizar performance
        observer.observe(document.documentElement, {
            attributes: true,           // Observar atributos
            attributeFilter: ['data-theme'], // Apenas este atributo específico
        });

        // ============================================================
        // MECANISMO 2: IPC (Inter-Process Communication)
        // ============================================================
        // Escuta eventos de mudança de tema vindos do processo principal.
        // Isso é uma camada adicional de redundância para garantir
        // que o tema seja atualizado mesmo se o MutationObserver falhar.
        const unsubscribe = window.electronAPI?.onThemeChanged?.(({ resolved }) => {
            setResolvedTheme(resolved);
        });

        // ============================================================
        // LIMPEZA
        // ============================================================
        // Desconectar observer e cancelar inscrição IPC quando o
        // componente for desmontado para evitar memory leaks.
        return () => {
            observer.disconnect();   // Parar de observar mudanças no DOM
            unsubscribe?.();         // Cancelar inscrição IPC
        };
    }, []); // Array vazio = executar apenas uma vez (montagem/desmontagem)

    return resolvedTheme;
};
