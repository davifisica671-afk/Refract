// electron/utils/emailUtils.ts
// Utilitários para funcionalidade de e-mail de acompanhamento
// Fornece funções para extrair e-mails de transcrições, construir links mailto,
// criar URLs de composição do Gmail e gerar prompts para geração de e-mails via LLM.

/**
 * Extrair endereços de e-mail de texto de transcrição
 * Usa regex para encontrar padrões de e-mail mencionados na conversa
 */
export function extractEmailsFromTranscript(transcript: Array<{ text: string }>): string[] {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = new Set<string>();

    for (const entry of transcript) {
        const matches = entry.text.match(emailRegex);
        if (matches) {
            matches.forEach(email => emails.add(email.toLowerCase()));
        }
    }

    return Array.from(emails);
}

/**
 * Construir um link mailto: com conteúdo pré-preenchido
 * @param para - Destinatário(s) de e-mail, separados por vírgula
 * @param subject - Linha de assunto do e-mail
 * @param body - Texto do corpo do e-mail
 */
export function buildMailtoLink(to: string, subject: string, body: string): string {
    const params = new URLSearchParams();
    params.set('subject', subject);
    params.set('body', body);

    // URLSearchParams codifica espaços como '+', mas mailto espera '%20'
    const queryString = params.toString().replace(/\+/g, '%20');

    return `mailto:${encodeURIComponent(to)}?${queryString}`;
}

/**
 * Construir uma URL de composição do Gmail
 * Abre a interface web do Gmail com conteúdo pré-preenchido
 */
export function buildGmailComposeUrl(to: string, subject: string, body: string): string {
    const params = new URLSearchParams();
    params.set('view', 'cm');
    params.set('fs', '1');
    params.set('to', to);
    params.set('su', subject);
    params.set('body', body);

    return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Gera o assunto de e-mail sugerido a partir do título da reunião
 */
export function generateEmailSubject(meetingTitle: string, meetingType: string = 'meeting'): string {
    const cleanTitle = meetingTitle.replace(/["\*]/g, '').trim();

    if (meetingType === 'interview') {
        return `Following up on our conversation - ${cleanTitle}`;
    }

    return `Following up - ${cleanTitle}`;
}

/**
 * Constrói o payload de entrada para geração de e-mail de acompanhamento via LLM
 */
export interface FollowUpEmailInput {
    meeting_type: 'interview' | 'call' | 'demo' | 'discussion' | 'meeting';
    title: string;
    summary?: string;
    action_items?: string[];
    key_points?: string[];
    recipient_name?: string;
    sender_name?: string;
    tone?: 'friendly' | 'neutral' | 'formal';
}

export function buildFollowUpEmailPromptInput(input: FollowUpEmailInput): string {
    const parts: string[] = [];

    parts.push(`Meeting Type: ${input.meeting_type}`);
    parts.push(`Title: ${input.title}`);

    if (input.recipient_name) {
        parts.push(`Recipient Name: ${input.recipient_name}`);
    }

    if (input.sender_name) {
        parts.push(`Sender Name: ${input.sender_name}`);
    }

    if (input.summary) {
        parts.push(`Summary: ${input.summary}`);
    }

    if (input.action_items && input.action_items.length > 0) {
        parts.push(`Action Items:\n${input.action_items.map(item => `- ${item}`).join('\n')}`);
    }

    if (input.key_points && input.key_points.length > 0) {
        parts.push(`Key Points:\n${input.key_points.map(point => `- ${point}`).join('\n')}`);
    }

    if (input.tone) {
        parts.push(`Tone: ${input.tone}`);
    }

    return parts.join('\n\n');
}

/**
 * Analisa o nome do participante a partir de dados de calendário ou transcrição
 * Extrai o primeiro nome de um nome completo ou e-mail
 */
export function extractRecipientName(attendeeInfo: string): string {
    // Se for um e-mail, extrair a parte antes do @
    if (attendeeInfo.includes('@')) {
        const localPart = attendeeInfo.split('@')[0];
        // Converte algo como "john.doe" para "John"
        const firstName = localPart.split(/[._-]/)[0];
        return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    }

    // Se for um nome completo, pegar a primeira palavra
    const firstName = attendeeInfo.split(' ')[0];
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

/**
 * Copia texto para o clipboard (processo renderer auxiliar)
 */
export function copyToClipboard(text: string): Promise<void> {
    return navigator.clipboard.writeText(text);
}
