// electron/services/ForegroundGate.ts
//
// ISOLAMENTO DE TRABALHO EM BACKGROUND (regressão manual 2026-06-12, P9).
//
// Após a reunião, a geração de resumo + RAG chunking + persistência de embeddings
// todos executam no processo Principal do Electron. better-sqlite3 calls são
// SINCRONOS, então a drenagem da fila de embeddings intercala dezenas de declarações
// bloqueantes de BD com as perguntas manuais do usuário — o relato de "app trava
// após ~50 perguntas". Não há thread para movê-las sem reescrever o worker;
// o que podemos fazer barato e com segurança é fazer todo loop de drenagem
// em background CEDER enquanto a resposta em foreground está em voo.
//
// Modelo de prioridade (especificação):
//   P0  Resposta UI/manual/WTA em voo     → loops de background PAUSAR
//   P1  Transcrição STT ativa             → não afetado (já event-driven)
//   P2+ RAG ao vivo / resumo de reunião / embeddings → verificar o gate entre itens
//
// Uso:
//   ForegroundGate.begin('manual')   // quando a requisição manual/WTA inicia
//   ForegroundGate.end('manual')     // quando ela finaliza
//   await ForegroundGate.waitUntilIdle()  // loops de background, entre itens
//
// O gate é consultivo e auto-recuperável: uma begin vazada expira automaticamente
// após 60s para que uma requisição com falha nunca congeça o processamento em
// background para sempre.

const FOREGROUND_TIMEOUT_MS = 60_000;
const POLL_MS = 250;

class ForegroundGateImpl {
    private active = new Map<string, number>(); // token → startedAt

    /** Marca uma requisição de foreground como em voo. Retorna o token para finalizar. */
    begin(kind: 'manual' | 'wta' | 'ui' = 'manual'): string {
        const token = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.active.set(token, Date.now());
        return token;
    }

    end(token: string): void {
        this.active.delete(token);
    }

    /** Verdadeiro quando qualquer requisição de foreground não expirada está em voo. */
    isBusy(): boolean {
        if (this.active.size === 0) return false;
        const now = Date.now();
        for (const [token, startedAt] of this.active) {
            if (now - startedAt > FOREGROUND_TIMEOUT_MS) this.active.delete(token); // leaked
        }
        return this.active.size > 0;
    }

    /**
     * Resolve quando nenhum trabalho de foreground está em voo (verificado a cada 250ms,
     * limitado rigidamente por `maxWaitMs` para que o trabalho em background sempre
     * execute eventualmente).
     */
    async waitUntilIdle(maxWaitMs = 30_000): Promise<void> {
        const start = Date.now();
        while (this.isBusy() && Date.now() - start < maxWaitMs) {
            await new Promise((r) => setTimeout(r, POLL_MS));
        }
    }
}

export const ForegroundGate = new ForegroundGateImpl();
