
/**
 * ============================================================
 * VARIANTES DE INGLÊS PARA TRANSCRIÇÃO DE ÁUDIO
 * ============================================================
 * 
 * Este arquivo define as variantes do idioma inglês suportadas
 * pelo sistema de transcrição de áudio (STT - Speech-to-Text).
 * 
 * POR QUE VARIANTES?
 * O inglês tem sotaques e pronúncias diferentes dependendo da
 * região (Índia, EUA, Reino Unido, Austrália, Canadá). Cada
 * variante tem um código BCP-47 primário e lista de alternativas.
 * 
 * COMO FUNCIONA:
 * 1. O usuário seleciona sua variante preferida nas configurações
 * 2. O STT tenta usar o código primário (ex: en-IN)
 * 3. Se o provedor não suportar, usa a primeira alternativa (ex: en-US)
 * 
 * CÓDIGOS BCP-47:
 * - en-IN: Inglês da Índia
 * - en-US: Inglês dos Estados Unidos
 * - en-GB: Inglês do Reino Unido
 * - en-AU: Inglês da Austrália
 * - en-CA: Inglês do Canadá
 * ============================================================
 */

/**
 * Tipo que define a estrutura de uma variante de inglês.
 */
export type EnglishVariant = {
    label: string;       // Nome legível para exibição na UI (ex: "English (India)")
    primary: string;     // Código BCP-47 primário para uso no STT (ex: "en-IN")
    alternates: string[]; // Lista de códigos alternativos, em ordem de preferência
};

/**
 * Mapa de todas as variantes de inglês suportadas.
 * As chaves são identificadores internos usados no armazenamento.
 */
export const ENGLISH_VARIANTS: Record<string, EnglishVariant> = {
    'english-india': {
        label: 'English (India)',     // Nome para exibição
        primary: 'en-IN',             // Código primário: Inglês da Índia
        alternates: ['en-US', 'en-GB', 'en-AU', 'en-CA'], // Alternativas em ordem de preferência
    },
    'english-us': {
        label: 'English (United States)',
        primary: 'en-US',             // Código primário: Inglês dos EUA
        alternates: ['en-IN', 'en-GB', 'en-AU', 'en-CA'],
    },
    'english-uk': {
        label: 'English (United Kingdom)',
        primary: 'en-GB',             // Código primário: Inglês do Reino Unido
        alternates: ['en-IN', 'en-US', 'en-AU', 'en-CA'],
    },
    'english-au': {
        label: 'English (Australia)',
        primary: 'en-AU',             // Código primário: Inglês da Austrália
        alternates: ['en-GB', 'en-US', 'en-IN', 'en-CA'],
    },
    'english-ca': {
        label: 'English (Canada)',
        primary: 'en-CA',             // Código primário: Inglês do Canadá
        alternates: ['en-US', 'en-GB', 'en-IN', 'en-AU'],
    },
};
