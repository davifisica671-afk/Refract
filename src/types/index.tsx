/**
 * Tipo que representa uma captura de tela feita pelo aplicativo.
 * Cada screenshot armazena um identificador único, o caminho do arquivo no disco,
 * o timestamp de quando foi tirada e uma miniatura em Base64 para exibição rápida
 * sem precisar carregar a imagem completa do disco.
 */
export interface Screenshot {
  id: string        // Identificador único da captura de tela
  path: string      // Caminho absoluto do arquivo da imagem no disco do usuário
  timestamp: number // Carimbo de data/hora (Unix timestamp em milissegundos) de quando a captura foi feita
  thumbnail: string // Miniatura da imagem codificada em Base64 (formato data URL) para exibição na interface
}

/**
 * Re-exporta o tipo Solution do módulo solutions.
 * Isso permite que outros arquivos importem Solution diretamente de types/index.tsx
 * em vez de precisar saber a estrutura interna do módulo solutions.
 */
export type { Solution } from './solutions';
