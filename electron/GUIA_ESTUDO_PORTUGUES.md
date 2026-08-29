# =============================================================================
# GUIA DE ESTUDO — PASTA electron/ (Comentários em Português)
# =============================================================================

## VISÃO GERAL DO PROJETO

O **Refract** é um assistente de IA para entrevistas ao vivo que funciona como
sobreposição transparente sobre aplicativos de videoconferência (Zoom, Meet, Teams).

---

## ESTRUTURA DE PASTAS

```
electron/
├── main.ts                    ← CORAÇÃO do app (AppState, inicialização)
├── preload.ts                 ← Ponte segura entre renderer ↔ processo principal
├── ipcHandlers.ts             ← Todos os manipuladores IPC (comunicação)
├── LLMHelper.ts               ← COMUNICAÇÃO COM MODELOS DE IA (Gemini, Groq, OpenAI...)
├── WindowHelper.ts            ← GERENCIAMENTO DE JANELAS (Launcher + Overlay)
├── IntelligenceManager.ts     ← FACHADA do sistema de inteligência
├── IntelligenceEngine.ts      ← CÉREBRO de roteamento de modos LLM
├── SessionTracker.ts          ← MEMÓRIA de trabalho durante reunião
├── MeetingPersistence.ts      ← SALVAMENTO de reuniões em background
├── ProcessingHelper.ts        ← PROCESSAMENTO de screenshots via LLM
├── ScreenshotHelper.ts        ← CAPTURA DE TELA do desktop
├── CropperWindowHelper.ts     ← JANELA de seleção de área (recorte)
├── ModelSelectorWindowHelper.ts ← SELETOR de modelo LLM
├── SettingsWindowHelper.ts    ← JANELA de configurações
├── DonationManager.ts         ← Gerenciador de pedido de doação
├── ThemeManager.ts            ← TEMAS (claro/escuro/sistema)
├── verboseLog.ts              ← Sistema de logging detalhado
├── config/
│   ├── constants.ts           ← Constantes globais (sentinel, limites)
│   └── languages.ts           ← 30+ idiomas suportados
├── db/
│   └── DatabaseManager.ts     ← BANCO DE DADOS SQLite local
├── llm/
│   ├── index.ts               ← Barrel de exportação de todos os módulos LLM
│   ├── types.ts               ← Tipos compartilhados do sistema LLM
│   ├── prompts.ts             ← Prompts do sistema para cada modo
│   ├── tinyPrompts.ts         ← Prompts enxutos para modelos menores
│   ├── modelCapabilities.ts   ← Capacidades e limites de cada modelo
│   ├── ProviderRouter.ts      ← Roteamento entre provedores LLM
│   ├── AnswerPlanner.ts       ← Planejamento de tipo de resposta
│   ├── IntentClassifier.ts    ← Classificador de intenção (transformer)
│   ├── ProfileOutputValidator.ts ← Validação de perspectiva do candidato
│   ├── codeVerification/      ← Verificação de código gerado
│   └── __tests__/             ← 80+ arquivos de teste
├── rag/
│   ├── RAGManager.ts          ← ORQUESTRADOR RAG (busca em reuniões)
│   ├── EmbeddingPipeline.ts   ← Pipeline de embeddings (OpenAI/Gemini/Ollama)
│   ├── VectorStore.ts         ← Armazenamento de vetores (sqlite-vec)
│   ├── SemanticChunker.ts     ← Divisão semântica de transcrições
│   └── RAGRetriever.ts        ← Recuperação e re-ranking
├── intelligence/
│   ├── intelligenceFlags.ts   ← Feature flags da inteligência
│   ├── ContextRouter.ts       ← Roteamento de contexto
│   ├── LiveTranscriptBrain.ts ← Memória de sessão ao vivo
│   ├── ProfileTreeService.ts  ← Serviço de perfil do candidato
│   └── ConversationMemoryService.ts ← Memória de conversação
├── services/
│   ├── CredentialsManager.ts  ← SEGURANÇA de chaves de API
│   ├── KeybindManager.ts      ← Atalhos de teclado
│   ├── SettingsManager.ts     ← Configurações do usuário
│   ├── PhoneMirrorService.ts  ← Espelho de tela para celular
│   └── toggleStateReducer.ts  ← Lógica pura de alternância
├── utils/
│   ├── redactForLog.ts        ← REDATOR de segurança para logs
│   └── curlUtils.ts           ← Utilitários para comandos cURL
└── update/
    └── ReleaseNotesManager.ts ← Gerenciador de notas de versão
```

---

## FLUXO PRINCIPAL DO APLICATIVO

### 1. INICIALIZAÇÃO
```
app.whenReady()
  → AppState.constructor()
    → SettingsManager (carrega configurações)
    → WindowHelper (cria janelas)
    → ProcessingHelper (inicializa LLMHelper)
    → IntelligenceManager (inicializa sistema de IA)
    → ThemeManager (configura tema)
    → RAGManager (inicializa pipeline de busca)
    → initializeApp() (verifica permissões, mostra UI)
```

### 2. DURANTE UMA REUNIÃO
```
Usuário clica "Iniciar Refract"
  → startMeeting()
    → Inicializa captura de áudio do sistema (entrevistador)
    → Inicializa captura de microfone (usuário)
    → Conecta ao STT (Speech-to-Text)
    → Mostra overlay transparente
    → IntelligenceEngine em modo IDLE aguardando áudio

Áudio chega → STT converte em texto → addTranscript()
  → IntelligenceEngine detecta pergunta
  → planAnswer() decide tipo de resposta
  → LLMHelper gera resposta via streaming
  → Resposta aparece no overlay em tempo real

Usuário clica "Parar"
  → endMeeting()
    → Para capturas de áudio
    → Para STT
    → MeetingPersistence.stopMeeting()
      → Snapshot dos dados
      → Reset do estado
      → Processamento em background:
        → Gera título via LLM
        → Gera resumo estruturado V3 via LLM
        → Salva no SQLite
        → Indexa para RAG
```

### 3. COMMUNICAÇÃO IPC
```
Renderer (React/Vite)
  ↓ window.electronAPI.metodo(args)
  ↓ ipcRenderer.invoke('canal', args)
  ↓ [Electron IPC Bridge]
  ↓ ipcMain.handle('canal', handler)
Processo Principal
  → handler executa lógica
  → retorna resultado
  ↓ [Promise resolvida]
  ↓ ipcRenderer.invoke retorna
Renderer recebe resultado
```

---

## CONCEITOS CHAVE PARA ESTUDAR

### LLM (Large Language Model)
- **Gemini**: Provedor padrão (Google), rápido e bom custo-benefício
- **Groq**: Ultra-rápido (LLaMA 3.3 70B), ideal para respostas ao vivo
- **OpenAI**: GPT-5.4, alta qualidade
- **Claude**: Anthropic, bom para código
- **Ollama**: LOCAL, roda na máquina do usuário, sem nuvem

### STT (Speech-to-Text)
- Converte áudio em texto em tempo real
- Múltiplos provedores: Google, Groq, OpenAI, Deepgram, Soniox, local
- Suporte a 30+ idiomas

### RAG (Retrieval-Augmented Generation)
- Indexa reuniões anteriores em vetores
- Busca por similaridade semântica
- Fornece contexto relevante para respostas

### Overlay
- Janela transparente que fica por cima de videoconferências
- Largura fixa (780px) para evitar flicker
- Modo "indetectável" esconde de capturas de tela

### TCC (macOS)
- Sistema de permissões do macOS
- Controla acesso a: microfone, gravação de tela
- App precisa de permissão para capturar áudio/tela

---

## DICAS DE ESTUDO

1. **Comece pelo main.ts**: É o ponto de entrada e mostra como tudo se conecta
2. **Estude LLMHelper.ts**: É a classe mais complexa e importante
3. **Entenda o IPC**: Leia preload.ts e ipcHandlers.ts juntos
4. **Siga o fluxo de áudio**: main.ts → SystemAudioCapture → STT → IntelligenceEngine
5. **RAG é avançado**: Estude depois de entender o fluxo básico

---

## COMENTÁRIOS ADICIONADOS

Todos os arquivos principais agora têm comentários detalhados em português
explicando:
- O que o arquivo faz
- Por que existe
- Como se conecta com outros módulos
- Conceitos importantes
- Padrões de design utilizados
- Decisões de arquitetura

Procure por blocos de comentário `/**` no início de cada arquivo.
