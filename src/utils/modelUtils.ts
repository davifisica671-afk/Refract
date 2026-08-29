/**
 * ============================================================
 * UTILITÁRIOS DE MODELOS DE IA
 * ============================================================
 * 
 * Este arquivo define os modelos de IA disponíveis no Refract
 * e fornece funções auxiliares para trabalhar com eles.
 * 
 * MODELOS SUPORTADOS:
 * - Gemini (Google): Flash, Flash Lite, Pro
 * - OpenAI: GPT 5.4
 * - Claude (Anthropic): Sonnet 4.6
 * - Groq: Llama 3.3 (ultra-rápido)
 * - DeepSeek: V4 Flash e V4 Pro
 * - Codex CLI: Para uso local via CLI
 * 
 * ESTRUTURA:
 * Cada provedor tem: verificação de chave, IDs, nomes, descrições
 * e chave de modelo preferido no armazenamento.
 * ============================================================
 */

/**
 * Mapa de modelos padrão da nuvem disponíveis.
 * Cada entrada contém informações completas sobre os modelos
 * de um provedor específico.
 */
export const STANDARD_CLOUD_MODELS: Record<string, {
    hasKeyCheck: (creds: any) => boolean; // Função para verificar se o usuário tem chave válida
    ids: string[];     // IDs dos modelos (usados na API)
    names: string[];   // Nomes para exibição na UI
    descs: string[];   // Descrições curtas de cada modelo
    pmKey: 'geminiPreferredModel' | 'openaiPreferredModel' | 'claudePreferredModel' | 'groqPreferredModel' | 'deepseekPreferredModel'; // Chave no localStorage
}> = {
    // ============================================================
    // GOOGLE GEMINI
    // ============================================================
    // Modelos Google com diferentes níveis de velocidade/qualidade
    gemini: {
        hasKeyCheck: (creds) => !!creds?.hasGeminiKey, // Verificar se tem chave Gemini
        ids: ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'],
        names: ['Gemini 3.5 Flash', 'Gemini 3.1 Flash Lite', 'Gemini 3.1 Pro'],
        descs: ['Mais Rápido • Multimodal', 'Raciocínio • Alta Qualidade'],
        pmKey: 'geminiPreferredModel'
    },
    // ============================================================
    // OPENAI
    // ============================================================
    // Modelo GPT mais recente da OpenAI
    openai: {
        hasKeyCheck: (creds) => !!creds?.hasOpenaiKey,
        ids: ['gpt-5.4'],
        names: ['GPT 5.4'],
        descs: ['OpenAI'],
        pmKey: 'openaiPreferredModel'
    },
    // ============================================================
    // ANTHROPIC CLAUDE
    // ============================================================
    // Modelo Claude mais recente da Anthropic
    claude: {
        hasKeyCheck: (creds) => !!creds?.hasClaudeKey,
        ids: ['claude-sonnet-4-6'],
        names: ['Sonnet 4.6'],
        descs: ['Anthropic'],
        pmKey: 'claudePreferredModel'
    },
    // ============================================================
    // GROQ (ULTRA-RÁPIDO)
    // ============================================================
    // Modelos Groq com latência extremamente baixa
    groq: {
        hasKeyCheck: (creds) => !!creds?.hasGroqKey,
        ids: ['llama-3.3-70b-versatile'],
        names: ['Groq Llama 3.3'],
        descs: ['Ultra Rápido'],
        pmKey: 'groqPreferredModel'
    },
    // ============================================================
    // DEEPSEEK
    // ============================================================
    // Modelos DeepSeek com foco em raciocínio
    deepseek: {
        hasKeyCheck: (creds) => !!creds?.hasDeepseekKey,
        ids: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        names: ['DeepSeek V4 Flash', 'DeepSeek V4 Pro'],
        descs: ['Rápido • Somente Texto', 'Raciocínio • Somente Texto'],
        pmKey: 'deepseekPreferredModel'
    },
};

/**
 * Modelo padrão para o Codex CLI (uso local via linha de comando).
 */
export const CODEX_CLI_MODEL = {
    id: 'codex-cli',     // ID interno do modelo
    name: 'Codex CLI',   // Nome para exibição
    desc: 'Transporte CLI Local', // Descrição curta
};

/**
 * Predefinições de modelos disponíveis para o Codex CLI.
 * Estes são modelos que o usuário pode selecionar ao configurar o Codex.
 */
export const CODEX_CLI_MODEL_PRESETS = [
    { id: 'gpt-5.5', name: 'ChatGPT 5.5' },           // Modelo mais recente
    { id: 'gpt-5.3-codex', name: 'Codex 5.3' },        // Modelo Codex padrão
    { id: 'gpt-5.3-codex-spark', name: 'Codex Spark 5.3' }, // Variante Spark
    { id: 'gpt-5.4', name: 'ChatGPT 5.4' },            // Modelo anterior
];

/**
 * Gera o ID do seletor para um modelo Codex CLI.
 * 
 * EXEMPLO:
 * codexCliSelectorId('gpt-5.5') → 'codex-cli:gpt-5.5'
 * 
 * @param modelId - ID do modelo
 * @returns ID no formato 'codex-cli:{modelId}'
 */
export const codexCliSelectorId = (modelId: string): string => `codex-cli:${modelId}`;

/**
 * Obtém o nome de exibição de um modelo Codex CLI.
 * 
 * LÓGICA:
 * 1. Se for o modelo padrão, retorna "Codex CLI"
 * 2. Se não começar com "codex-cli:", retorna null
 * 3. Caso contrário, procura nas predefinições
 * 4. Se não encontrar, formata o ID automaticamente
 * 
 * @param id - ID completo do modelo (ex: 'codex-cli:gpt-5.5')
 * @returns Nome de exibição ou null se inválido
 */
export const getCodexCliModelDisplayName = (id: string): string | null => {
    if (id === CODEX_CLI_MODEL.id) return CODEX_CLI_MODEL.name; // Modelo padrão
    if (!id.startsWith('codex-cli:')) return null; // Não é um modelo Codex CLI

    // Extrair o ID do modelo após o prefixo
    const modelId = id.slice('codex-cli:'.length);
    
    // Procurar nas predefinições
    const preset = CODEX_CLI_MODEL_PRESETS.find(model => model.id === modelId);
    
    // Retornar nome da predefinição ou formatar o ID automaticamente
    return preset?.name || prettifyModelId(modelId);
};

/**
 * Formata um ID de modelo para exibição legível.
 * 
 * EXEMPLO:
 * prettifyModelId('gpt-5.4') → 'Gpt 5.4'
 * prettifyModelId('deepseek-v4-flash') → 'Deepseek V4 Flash'
 * prettifyModelId('llama_3.3') → 'Llama 3.3'
 * 
 * @param id - ID bruto do modelo
 * @returns String formatada com primeira letra maiúscula
 */
export const prettifyModelId = (id: string): string => {
    if (!id) return ''; // Retornar vazio se não houver ID
    
    // Substituir hífens e underscores por espaços
    // Capitalizar primeira letra de cada palavra
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};
