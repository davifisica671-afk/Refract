/**
 * =============================================================================
 * diarizableSTT.ts — capacidade opcional de diarização para provedores de STT
 * =============================================================================
 *
 * A diarização hoje está embutida no adaptador do Deepgram e é ligada por um
 * cast concreto em `main.ts`. Isso prende a funcionalidade a um único provedor
 * — e o Deepgram é um provedor de nuvem, o que conflita com o posicionamento
 * on-device do produto.
 *
 * Este módulo descreve a capacidade como uma interface estrutural. Qualquer
 * adaptador que exponha `setDiarization(boolean)` passa a ser elegível, sem
 * herança nem registro em enum: basta implementar o método.
 *
 * `isDiarizableSTT` é o type guard usado pelo main para decidir em runtime.
 * =============================================================================
 */

export interface DiarizableSTT {
    setDiarization(enable: boolean): void;
}

export function isDiarizableSTT(provider: unknown): provider is DiarizableSTT {
    return (
        typeof provider === "object" &&
        provider !== null &&
        typeof (provider as { setDiarization?: unknown }).setDiarization === "function"
    );
};