/**
 * ============================================================
 * GERADOR DE PDF PARA REUNIÕES
 * ============================================================
 * 
 * Este arquivo gera arquivos PDF a partir dos dados de uma reunião,
 * permitindo que o usuário exporte o conteúdo para leitura offline
 * ou compartilhamento.
 * 
 * CONTEÚDO INCLUÍDO NO PDF:
 * 1. Cabeçalho: Título, data e duração da reunião
 * 2. Resumo: Resumo gerado por IA
 * 3. Itens de Ação: Tarefas pendentes identificadas
 * 4. Pontos Principais: Insights importantes da reunião
 * 5. Transcrição: Texto completo com timestamps
 * 6. Interações com IA: Perguntas e respostas com o assistente
 * 
 * BIBLIOTECA UTILIZADA:
 * jsPDF - Biblioteca leve para geração de PDF no navegador
 * ============================================================
 */

// ============================================================
// IMPORTAÇÕES
// ============================================================
import jsPDF from 'jspdf'; // Biblioteca para geração de PDF no navegador

/**
 * Interface que define a estrutura de dados de uma reunião.
 */
interface Meeting {
    id: string;           // Identificador único da reunião
    title: string;        // Título da reunião
    date: string;         // Data da reunião (formato legível)
    duration: string;     // Duração (ex: "45 minutos")
    summary: string;      // Resumo gerado por IA
    detailedSummary?: {   // Resumo detalhado (opcional)
        actionItems: string[]; // Itens de ação pendentes
        keyPoints: string[];   // Pontos principais da reunião
    };
    transcript?: Array<{  // Transcrição da reunião (opcional)
        speaker: string;  // Nome do falante
        text: string;     // Texto falado
        timestamp: number; // Timestamp em milissegundos
    }>;
    usage?: Array<{       // Interações com IA (opcional)
        type: 'assist' | 'followup' | 'chat' | 'followup_questions'; // Tipo de interação
        timestamp: number; // Quando aconteceu
        question?: string; // Pergunta do usuário (para chat)
        answer?: string;   // Resposta da IA
        items?: string[];  // Lista de itens (para followup_questions)
    }>;
}

/**
 * Gera um PDF com os dados completos de uma reunião.
 * 
 * @param meeting - Objeto com todos os dados da reunião
 */
export const generateMeetingPDF = (meeting: Meeting) => {
    // Criar nova instância do documento PDF (A4 padrão)
    const doc = new jsPDF();
    
    // Obter dimensões da página para cálculos de layout
    const pageWidth = doc.internal.pageSize.getWidth(); // Largura da página
    const margin = 20; // Margem de 20px em todos os lados
    const contentWidth = pageWidth - (margin * 2); // Largura disponível para conteúdo
    let y = 20; // Posição Y atual (ponto de inserção)

    // ============================================================
    // FUNÇÕES AUXILIARES
    // ============================================================

    /**
     * Converte cor hexadecimal para array RGB.
     * 
     * EXEMPLO:
     * hexToRgb('#FF5733') → [255, 87, 51]
     * 
     * @param hex - Cor em formato hexadecimal (com ou sem #)
     * @returns Array [r, g, b] com valores de 0 a 255
     */
    const hexToRgb = (hex: string): [number, number, number] => {
        const h = hex.replace('#', ''); // Remover # se presente
        return [
            parseInt(h.substring(0, 2), 16), // Componente vermelho
            parseInt(h.substring(2, 4), 16), // Componente verde
            parseInt(h.substring(4, 6), 16), // Componente azul
        ];
    };

    /**
     * Adiciona texto ao PDF com quebra automática de linha e página.
     * 
     * @param text - Texto a ser adicionado
     * @param fontSize - Tamanho da fonte (padrão: 10)
     * @param isBold - Se o texto deve ser negrito (padrão: false)
     * @param color - Cor hexadecimal (padrão: '#000000')
     */
    const addText = (text: string, fontSize: number = 10, isBold: boolean = false, color: string = '#000000') => {
        doc.setFontSize(fontSize); // Definir tamanho da fonte
        doc.setFont('helvetica', isBold ? 'bold' : 'normal'); // Definir estilo da fonte
        const [r, g, b] = hexToRgb(color); // Converter cor para RGB
        doc.setTextColor(r, g, b); // Aplicar cor

        // Quebrar texto em múltiplas linhas se necessário
        const lines = doc.splitTextToSize(text, contentWidth);

        // Verificar se precisamos de uma nova página
        if (y + (lines.length * fontSize * 0.5) > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage(); // Adicionar nova página
            y = 20; // Reiniciar posição Y
        }

        doc.text(lines, margin, y); // Inserir texto no PDF
        y += (lines.length * fontSize * 0.5) + 2; // Avançar posição Y
    };

    /**
     * Adiciona espaço vertical entre elementos.
     * 
     * @param amount - Quantidade de espaço em pontos
     */
    const addVerticalSpace = (amount: number) => {
        y += amount;
    };

    // ============================================================
    // SEÇÃO: CABEÇALHO
    // ============================================================
    addText(meeting.title, 18, true, '#000000'); // Título grande e negrito
    addVerticalSpace(2);
    addText(`${meeting.date} • ${meeting.duration}`, 10, false, '#666666'); // Data e duração em cinza
    addVerticalSpace(10);

    // ============================================================
    // SEÇÃO: RESUMO
    // ============================================================
    if (meeting.summary) {
        addText('Resumo', 14, true, '#000000');
        addVerticalSpace(2);
        addText(meeting.summary, 10, false, '#333333');
        addVerticalSpace(8);
    }

    // ============================================================
    // SEÇÃO: RESUMO DETALHADO
    // ============================================================
    if (meeting.detailedSummary) {
        // Itens de Ação
        if (meeting.detailedSummary.actionItems && meeting.detailedSummary.actionItems.length > 0) {
            addText('Itens de Ação', 12, true, '#000000');
            meeting.detailedSummary.actionItems.forEach(item => {
                addText(`• ${item}`, 10, false, '#333333'); // Cada item com bullet point
            });
            addVerticalSpace(5);
        }

        // Pontos Principais
        if (meeting.detailedSummary.keyPoints && meeting.detailedSummary.keyPoints.length > 0) {
            addText('Pontos Principais', 12, true, '#000000');
            meeting.detailedSummary.keyPoints.forEach(point => {
                addText(`• ${point}`, 10, false, '#333333'); // Cada ponto com bullet point
            });
            addVerticalSpace(8);
        }
    }

    // ============================================================
    // SEÇÃO: TRANSCRIÇÃO
    // ============================================================
    if (meeting.transcript && meeting.transcript.length > 0) {
        addText('Transcrição', 14, true, '#000000');
        addVerticalSpace(2);

        meeting.transcript.forEach(entry => {
            // Formatar timestamp para HH:MM:SS
            const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            // Linha do palestrante (negrito, cinza escuro)
            addText(`${entry.speaker} [${timeStr}]`, 10, true, '#444444');
            
            // Linha do texto (normal, cinza médio)
            addText(entry.text, 10, false, '#333333');
            addVerticalSpace(2); // Espaço entre entradas
        });
        addVerticalSpace(8);
    }

    // ============================================================
    // SEÇÃO: INTERAÇÕES COM IA
    // ============================================================
    if (meeting.usage && meeting.usage.length > 0) {
        addText('Uso de IA & Interações', 14, true, '#000000');
        addVerticalSpace(2);

        meeting.usage.forEach(item => {
            // Chat: Pergunta e Resposta
            if (item.type === 'chat' && item.question && item.answer) {
                addText(`P: ${item.question}`, 10, true, '#222222');   // Pergunta em negrito
                addText(`R: ${item.answer}`, 10, false, '#444444');   // Resposta normal
                addVerticalSpace(3);
            }
            // Assistência: Apenas resposta
            else if (item.type === 'assist' && item.answer) {
                addText('Assistência:', 10, true, '#222222');
                addText(item.answer, 10, false, '#444444');
                addVerticalSpace(3);
            }
        });
    }

    // ============================================================
    // SALVAR O PDF
    // ============================================================
    // Criar nome seguro para o arquivo (remover caracteres especiais)
    const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`${safeTitle}.pdf`); // Salvar com nome baseado no título
};
