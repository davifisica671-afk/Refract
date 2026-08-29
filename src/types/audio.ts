/**
 * Tipo que representa o resultado de uma transcrição de áudio.
 * Usado pelo sistema STT (Speech-to-Text) para retornar o texto transcrito
 * junto com o momento exato em que o áudio foi processado.
 */
export interface AudioResult {
  text: string;      // O texto transcrito do áudio pelo motor STT
  timestamp: number; // Carimbo de data/hora (Unix timestamp em milissegundos) da transcrição
}