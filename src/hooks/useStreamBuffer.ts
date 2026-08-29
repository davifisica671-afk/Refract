/**
 * ============================================================
 * HOOK: useStreamBuffer (Buffer de Streaming)
 * ============================================================
 * 
 * PROBLEMA QUE RESOLVE:
 * Durante streaming de texto (ex: resposta de IA token por token),
 * os tokens chegam muito rápido (50-100 por segundo). Se chamarmos
 * setState() em CADA token, o React fará 50-100 re-renderizações
 * por segundo, causando:
 * - Travamentos e lentidão
 * - Alto uso de CPU/memória
 * - Interface travando durante digitação da IA
 * 
 * SOLUÇÃO:
 * Este hook agrupa (batches) os tokens dentro de um buffer e os
 * libera para o estado do React no máximo UMA VEZ por frame de
 * animação (~60fps = ~16ms entre cada atualização).
 * 
 * COMO FUNCIONA:
 * 1. Tokens são acumulados em um buffer de referência (useRef)
 * 2. Um requestAnimationFrame é agendado quando o primeiro token chega
 * 3. Tokens subsequentes no mesmo frame apenas adicionam ao buffer
 * 4. Quando o RAF dispara, chama o callback com todo o conteúdo acumulado
 * 5. O callback atualiza o estado React com o conteúdo completo
 * 
 * FLUXO VISUAL:
 * Token 1 → buffer: "Olá" → agendar RAF
 * Token 2 → buffer: "Olá mundo" → (RAF já agendado)
 * Token 3 → buffer: "Olá mundo, como" → (RAF já agendado)
 * [16ms depois] → RAF dispara → callback("Olá mundo, como") → React re-renderiza
 * 
 * USO:
 * const { appendToken, getBufferedContent, reset } = useStreamBuffer();
 * 
 * // No callback de token:
 * appendToken(token, (content) => {
 *   setMessages(prev => prev.map(msg =>
 *     msg.id === targetId ? { ...msg, content } : msg
 *   ));
 * });
 * ============================================================
 */

// ============================================================
// IMPORTAÇÕES
// ============================================================
import { useRef, useCallback } from 'react'; // Hooks do React para referências e callbacks

/**
 * Hook que fornece buffer de streaming otimizado para performance.
 * 
 * @returns Objeto com:
 *   - appendToken: Função para adicionar um token ao buffer
 *   - getBufferedContent: Função para obter o conteúdo acumulado
 *   - reset: Função para limpar o buffer
 */
export function useStreamBuffer() {
    // Referência para o conteúdo acumulado (não causa re-renderização)
    const bufferRef = useRef<string>('');
    
    // Referência para o ID do requestAnimationFrame atual
    const rafIdRef = useRef<number | null>(null);

    /**
     * Adiciona um token ao buffer e agenda um esvaziamento agrupado.
     * 
     * COMPORTAMENTO:
     * - Se nenhum RAF estiver agendado, agenda um novo
     * - Se um RAF já estiver agendado, apenas adiciona ao buffer
     * - Quando o RAF dispara, chama o callback com o conteúdo completo
     * 
     * @param token - Texto a ser adicionado ao buffer
     * @param onFlush - Callback chamado com o conteúdo acumulado total
     */
    const appendToken = useCallback((token: string, onFlush: (content: string) => void) => {
        // Adicionar token ao buffer (operação muito barata - apenas concatenação)
        bufferRef.current += token;

        // Apenas agendar um RAF se nenhum estiver pendente
        // Isso garante que múltiplos tokens no mesmo frame
        // sejam agrupados em uma única atualização
        if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null; // Limpar referência
                
                // Chamar callback com todo o conteúdo acumulado até agora
                // O React processará esta atualização no próximo tick
                onFlush(bufferRef.current);
            });
        }
    }, []); // Array vazio = função estável (não muda entre renderizações)

    /**
     * Obtém o conteúdo armazenado no buffer.
     * 
     * USO ÚTIL:
     * - Commit final quando o stream termina
     * - Verificar o último conteúdo antes de enviar
     * 
     * @returns String com todo o conteúdo acumulado no buffer
     */
    const getBufferedContent = useCallback(() => bufferRef.current, []);

    /**
     * Reseta o buffer e cancela qualquer RAF pendente.
     * 
     * QUANDO USAR:
     * - Ao iniciar um novo stream
     * - Na limpeza do componente (cleanup)
     * - Ao cancelar um stream em andamento
     */
    const reset = useCallback(() => {
        bufferRef.current = ''; // Limpar conteúdo
        
        // Cancelar RAF se estiver pendente
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
    }, []);

    return { appendToken, getBufferedContent, reset };
}
