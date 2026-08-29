/**
 * ============================================================
 * CONSTANTES DE PROVEDORES DE SPEECH-TO-TEXT (STT)
 * ============================================================
 * 
 * Este arquivo define todas as configurações dos provedores de
 * transcrição de áudio (Speech-to-Text) suportados pelo Refract.
 * 
 * PROVEDORES SUPORTADOS:
 * - Google Cloud (gRPC streaming)
 * - Groq (ultra-rápido, via Whisper)
 * - OpenAI (Whisper API)
 * - Deepgram (streaming WebSocket)
 * - ElevenLabs (Scribe v2)
 * - Azure Speech (Microsoft)
 * - IBM Watson
 * - Refract Pro (gerenciado)
 * 
 * COMO FUNCIONA:
 * Cada provedor tem uma configuração que inclui:
 * - Endpoint da API
 * - Modelo padrão de transcrição
 * - Tipo de upload (multipart, binary, websocket)
 * - Método de autenticação (headers HTTP)
 * - Caminho para extrair o texto da resposta JSON
 * 
 * O provedor ativo é selecionado pelo usuário nas configurações
 * e a configuração é usada pelo módulo de áudio para fazer a
 * transcrição em tempo real.
 * ============================================================
 */

/**
 * Tipo que representa o identificador de um provedor STT.
 * Usado como chave no mapa de provedores e para validação de tipo.
 */
export type SttProviderId = 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'refract' | 'local-whisper';

/**
 * Interface que define a estrutura de configuração de um provedor STT.
 * Cada provedor deve implementar esta interface completa.
 */
export interface SttProviderConfig {
    id: SttProviderId;           // Identificador único do provedor
    name: string;                // Nome legível para exibição na UI
    description: string;         // Descrição curta do provedor
    endpoint: string;            // URL do endpoint da API de transcrição
    model: string;               // Modelo padrão de transcrição deste provedor
    /** Modelos disponíveis para este provedor (para seleção do usuário) */
    availableModels?: { id: string; label: string }[];
    /** Tipo de upload de áudio: 'multipart' para FormData, 'binário' para corpo cru, 'websocket' para streaming */
    uploadType?: 'multipart' | 'binary' | 'websocket';
    authHeader: (apiKey: string) => Record<string, string>; // Função que gera headers de autenticação
    /** Caminho para extrair o texto da transcrição da resposta JSON (notação de ponto) */
    responseContentPath: string;
    /** Campos de formulário extras para incluir no upload multipart */
    extraFormFields?: Record<string, string>;
}

/**
 * Mapa de configurações de todos os provedores STT.
 * Cada entrada contém a configuração completa do provedor.
 */
export const STT_PROVIDERS: Record<SttProviderId, SttProviderConfig> = {
    // ============================================================
    // GOOGLE CLOUD SPEECH-TO-TEXT
    // ============================================================
    // Usa gRPC streaming via Service Account do Google Cloud
    // Melhor para: alta precisão, suporte a múltiplos idiomas
    // Requer: credenciais de conta de serviço Google Cloud
    google: {
        id: 'google',
        name: 'Google Cloud (Default)',
        description: 'Uses gRPC streaming via Google Cloud Service Account',
        endpoint: '', // Google usa gRPC, não REST — endpoint vazio
        model: '',   // Modelo definido pelo Google automaticamente
        authHeader: () => ({}), // Autenticação via Service Account, não header
        responseContentPath: '', // Resposta processada via gRPC, não JSON
    },
    
    // ============================================================
    // GROQ WHISPER (ULTRA-RÁPIDO)
    // ============================================================
    // Usa a API Groq para transcrição via Whisper
    // Melhor para: velocidade extrema (latência mínima)
    // Requer: chave API Groq
    groq: {
        id: 'groq',
        name: 'Groq Whisper (Fast)',
        description: 'Ultra-fast transcription via Groq API',
        endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
        model: 'whisper-large-v3-turbo', // Modelo Whisper otimizado para velocidade
        uploadType: 'multipart', // Upload via FormData (multipart/form-data)
        availableModels: [
            { id: 'whisper-large-v3-turbo', label: 'Whisper Large V3 Turbo (Fastest)' }, // Mais rápido
            { id: 'whisper-large-v3', label: 'Whisper Large V3 (Most Accurate)' },       // Mais preciso
        ],
        authHeader: (apiKey: string) => ({
            Authorization: `Bearer ${apiKey}`, // Autenticação via token Bearer
        }),
        responseContentPath: 'text', // O texto fica em response.text
        extraFormFields: {
            temperature: '0',            // Temperatura zero = mais determinístico
            response_format: 'json',     // Formato JSON da resposta
            language: 'en',              // Idioma padrão: inglês
        },
    },
    
    // ============================================================
    // OPENAI WHISPER
    // ============================================================
    // Usa a API OpenAI para transcrição via Whisper
    // Melhor para: qualidade comprovada, boa documentação
    // Requer: chave API OpenAI
    openai: {
        id: 'openai',
        name: 'OpenAI Whisper',
        description: 'Transcription via OpenAI Whisper API',
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        model: 'whisper-1', // Modelo Whisper da OpenAI
        uploadType: 'multipart', // Upload via FormData
        authHeader: (apiKey: string) => ({
            Authorization: `Bearer ${apiKey}`,
        }),
        responseContentPath: 'text',
    },
    
    // ============================================================
    // DEEPGRAM NOVA-3
    // ============================================================
    // Usa WebSocket para streaming em tempo real
    // Melhor para: streaming de baixa latência, transcrição em tempo real
    // Requer: chave API Deepgram
    deepgram: {
        id: 'deepgram',
        name: 'Deepgram Nova-3',
        description: 'Real-time streaming transcription via Deepgram WebSocket',
        endpoint: 'wss://api.deepgram.com/v1/listen', // WebSocket URL (wss://)
        model: 'nova-3', // Modelo Nova-3 mais recente
        uploadType: 'websocket', // Upload via WebSocket (streaming)
        authHeader: (apiKey: string) => ({
            Authorization: `Token ${apiKey}`, // Autenticação via Token (não Bearer)
        }),
        responseContentPath: 'channel.alternatives[0].transcript', // Caminho aninhado na resposta
    },
    
    // ============================================================
    // ELEVENLABS SCRIBE
    // ============================================================
    // Usa a API ElevenLabs para transcrição via Scribe v2
    // Melhor para: qualidade de voz, detecção de falantes
    // Requer: chave API ElevenLabs
    elevenlabs: {
        id: 'elevenlabs',
        name: 'ElevenLabs Scribe',
        description: 'Scribe v2 Realtime API',
        endpoint: 'https://api.elevenlabs.io/v1/speech-to-text',
        model: 'scribe_v2', // Modelo Scribe v2
        uploadType: 'multipart',
        authHeader: (apiKey: string) => ({
            'xi-api-key': apiKey, // Header específico da ElevenLabs
        }),
        responseContentPath: 'text',
    },
    
    // ============================================================
    // MICROSOFT AZURE SPEECH
    // ============================================================
    // Usa os Serviços Cognitivos da Microsoft Azure
    // Melhor para: integração com ecossistema Microsoft
    // Requer: chave API Azure + região
    azure: {
        id: 'azure',
        name: 'Azure Speech',
        description: 'Microsoft Azure Cognitive Services STT',
        endpoint: 'https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1',
        model: '', // Modelo definido pelo Azure
        uploadType: 'binary', // Upload de áudio como corpo binário
        authHeader: (apiKey: string) => ({
            'Ocp-Apim-Subscription-Key': apiKey, // Header específico do Azure
        }),
        responseContentPath: 'DisplayText', // Texto em response.DisplayText
    },
    
    // ============================================================
    // IBM WATSON SPEECH-TO-TEXT
    // ============================================================
    // Usa o serviço Watson Speech-to-Text da IBM
    // Melhor para: empresas com infraestrutura IBM
    // Requer: chave API IBM Watson + região
    ibmwatson: {
        id: 'ibmwatson',
        name: 'IBM Watson',
        description: 'IBM Watson Speech-to-Text cloud service',
        endpoint: 'https://api.{region}.speech-to-text.watson.cloud.ibm.com/v1/recognize',
        model: '', // Modelo definido pelo Watson
        uploadType: 'binary',
        authHeader: (apiKey: string) => ({
            Authorization: `Basic ${btoa(`apikey:${apiKey}`)}`, // Autenticação Basic com Base64
        }),
        responseContentPath: 'results[0].alternatives[0].transcript', // Caminho aninhado
    },
    
    // ============================================================
    // REFRACT PRO (GERENCIADO)
    // ============================================================
    // Serviço de transcrição gerenciado pelo próprio Refract
    // Melhor para: usuários que não querem configurar provedores
    // Requer: assinatura Refract Pro
    refract: {
        id: 'refract',
        name: 'Refract Pro (Managed)',
        description: 'All-in-one managed STT via Refract API',
        endpoint: '', // Gerenciado internamente
        model: '',
        uploadType: 'websocket',
        authHeader: () => ({}), // Autenticação interna
        responseContentPath: '',
    },
    'local-whisper': {
        id: 'local-whisper',
        name: 'Local Whisper',
        description: 'Private on-device transcription',
        endpoint: '',
        model: 'base.en',
        authHeader: () => ({}),
        responseContentPath: '',
    },
};

/**
 * Array com todas as configurações de provedores para iteração.
 * Útil para renderizar listas de seleção na UI.
 */
export const STT_PROVIDER_OPTIONS = Object.values(STT_PROVIDERS);

/**
 * Provedor STT padrão usado quando o usuário não selecionou nenhum.
 * Google Cloud é o padrão por oferecer a melhor combinação de
 * precisão e suporte a idiomas.
 */
export const DEFAULT_STT_PROVIDER: SttProviderId = 'google';
