/**
 * openaiTranscriptTurnCoalescer — Coalescador de eventos de transcrição OpenAI Realtime GA
 *
 * Agrupa eventos de transcrição em turnos no nível de frase.
 *
 * O servidor pode emitir um evento `conversation.item.input_audio_transcription.completed`
 * por commit do VAD (às vezes apenas uma palavra). A interface do usuário downstream
 * trata cada final como uma linha separada — este módulo acumula finais até que
 * `input_audio_buffer.speech_stopped` seja emitido, agrupando-os em um único turno final.
 */

export class OpenAITranscriptTurnCoalescer {
    private deltaAccum = '';
    private completedSegments: string[] = [];

    /** Inicia um novo turno de fala; esvazia qualquer turno anterior não comprometido. */
    onSpeechStarted(): string | null {
        const orphan = this.takeFinal();
        this.deltaAccum = '';
        this.completedSegments = [];
        return orphan;
    }

    /** Acumula texto delta incremental; retorna parcial acumulado para visualização na UI. */
    onDelta(delta: string): string | null {
        if (!delta) return this.getPartialText();
        this.deltaAccum += delta;
        return this.getPartialText();
    }

    /** Registra segmento completado item por item sem emitir um turno final ainda. */
    onCompleted(transcript: string): string | null {
        const text = transcript.trim();
        if (text) {
            this.completedSegments.push(text);
            const joined = this.completedSegments.join(' ');
            if (joined.length > this.deltaAccum.length) {
                this.deltaAccum = joined;
            }
        }
        return this.getPartialText();
    }

    /** Termina uma fala — emite um turno final coalescido. */
    onSpeechStopped(): string | null {
        return this.takeFinal();
    }

    /** Esvazia qualquer texto pendente (ex.: em stop()/finalize()). */
    flush(): string | null {
        return this.takeFinal();
    }

    reset(): void {
        this.deltaAccum = '';
        this.completedSegments = [];
    }

    getPartialText(): string | null {
        const joined = this.completedSegments.map(s => s.trim()).filter(Boolean).join(' ');
        const text = (joined.length >= this.deltaAccum.trim().length ? joined : this.deltaAccum).trim();
        return text || null;
    }

    private takeFinal(): string | null {
        const text = this.getPartialText();
        this.reset();
        return text;
    }
}
