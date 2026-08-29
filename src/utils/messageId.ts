/**
 * ============================================================
 * GERADOR DE IDs ÚNICOS PARA MENSAGENS DE CHAT
 * ============================================================
 * 
 * PROBLEMA QUE RESOLVE:
 * O React usa "keys" para identificar elementos em uma lista.
 * Se duas mensagens tiverem a mesma key, o React troca o DOM entre
 * elas, causando bugs visuais como chat piscando ou mensagens
 * aparecendo na ordem errada.
 * 
 * ANTES (problemático):
 * Date.now().toString() colide quando duas mensagens são adicionadas
 * no mesmo manipulador síncrono. Exemplo: ao enviar uma mensagem,
 * o app adiciona tanto a mensagem do usuário quanto um placeholder
 * de streaming no mesmo tick - ambas teriam o mesmo timestamp.
 * 
 * DEPOIS (solução):
 * Adicionamos um contador crescente ao timestamp para garantir
 * unicidade. O contador é semeado com um offset aleatório para
 * evitar colisões durante hot reload (Vite HMR).
 * 
 * FORMATO DO ID:
 * "{timestamp}-{counter}" → ex: "1719144000000-42"
 * 
 * VANTAGENS:
 * - Timestamp permite ordenação cronológica
 * - Counter garante unicidade dentro de um tick
 * - Offset aleatório previne colisões após HMR
 * ============================================================
 */

// Contador monotonamente crescente, semeado com offset aleatório
// para evitar colisões após Vite HMR (que reseta o estado do módulo)
let counter = Math.floor(Math.random() * 1_000_000);

/**
 * Gera um ID único para mensagem de chat.
 * 
 * @returns String no formato "{timestamp}-{counter}" que é:
 *   - Único mesmo em chamadas síncronas
 *   - Ordenável cronologicamente
 *   - Resistente a colisões após hot reload
 */
export const genMessageId = (): string => `${Date.now()}-${++counter}`;
