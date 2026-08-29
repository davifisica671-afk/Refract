/**
 * =============================================================================
 * DatabaseManager.ts — GERENCIADOR DE BANCO DE DADOS LOCAL
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Gerencia o banco de dados SQLite local do aplicativo usando better-sqlite3.
 * Armazena TODOS os dados persistentes do app:
 * 
 * TABELAS PRINCIPAIS:
 * - meetings: Reuniões salvas (título, resumo, transcrição, uso)
 * - modes: Modos personalizados do usuário
 * - reference_files: Arquivos de referência para modos
 * - note_sections: Seções de notas para modos
 * - modes_reference_files: Índice de vetores para arquivos de referência
 * - modes_note_sections: Índice de vetores para seções de notas
 * 
 * BANCO: {userData}/refract.db
 * EXTENSÃO: sqlite-vec (busca por vetores/similaridade)
 * 
 * SEGURANÇA:
 * - Nunca lança exceções do construtor (evita loop de erro)
 * - Falha graciosamente: se SQLite não carregar, app funciona sem persistência
 * - Migrações automáticas de esquema na inicialização
 * 
 * PADRÃO SINGLETON:
 * DatabaseManager.getInstance() retorna sempre a mesma instância
 * =============================================================================
 */

import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import * as sqliteVec from 'sqlite-vec';
import { buildLegacySpaceCaseSql } from '../rag/embeddingSpace';
import type { ActionItem, DecisionItem, FollowUpDraft, MeetingSummaryGenerationMeta, MeetingSummaryModeMeta, MeetingSummarySectionV3, NoteBlock, PersonMention, QuestionItem, RiskItem, SourceQualityMeta, SpeakerLabelMap, SummaryStatus, TimelineItem } from '../services/meeting/types';

// Interfaces para nossos objetos de dados
export interface Meeting {
    id: string;
    title: string;
    date: string; // String ISO
    duration: string;
    summary: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
        actionItemsTitle?: string;
        keyPointsTitle?: string;
        sections?: Array<{ title: string; bullets: string[] }>;
        schemaVersion?: number;
        tldr?: string[];
        whatChanged?: string[];
        decisions?: DecisionItem[];
        openQuestions?: QuestionItem[];
        risks?: RiskItem[];
        sourceQuality?: SourceQualityMeta;
        timeline?: TimelineItem[];
        people?: PersonMention[];
        topics?: string[];
        recipes?: Record<string, string>;
        noteBlocks?: NoteBlock[];
        sectionsV3?: MeetingSummarySectionV3[];
        mode?: MeetingSummaryModeMeta;
        generation?: MeetingSummaryGenerationMeta;
        actionItemsStructured?: Array<{ id: string; text: string; owner?: string; deadline?: string; sourceTimestamp?: number }>;
        actionItemsV3?: ActionItem[];
        // follow-up V3 é o objeto estruturado FollowUpDraft; linhas legadas armazenam como string simples
        followUpDraft?: FollowUpDraft | string;
        speakerLabels?: SpeakerLabelMap;
        crossMeeting?: { carriedOpenQuestions?: Array<{ text: string; fromMeetingId: string; fromTitle: string }>; recurringRisks?: Array<{ text: string; fromMeetingId: string; fromTitle: string }>; stillOpen?: string[] };
        coachingInsights?: Array<{ id: string; type: string; title: string; detail: string; severity: 'info' | 'opportunity' | 'warning'; evidence?: string }>;
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    calendarEventId?: string;
    source?: 'manual' | 'calendar';
    isProcessed?: boolean;
    summaryStatus?: SummaryStatus;
}

export class DatabaseManager {
    private static instance: DatabaseManager;
    private db: Database.Database | null = null;
    private dbPath: string;
    private resolvedExtPath: string = '';
    private initError: Error | null = null;

    private constructor() {
        let userDataPath: string;
        try {
            const fromEnv = process.env.REFRACT_TEST_USER_DATA;
            if (fromEnv) {
                userDataPath = fromEnv;
            } else if (app && typeof app.getPath === 'function') {
                userDataPath = app.getPath('userData');
            } else {
                userDataPath = path.join(os.tmpdir(), 'refract-no-electron-app');
            }
        } catch {
            userDataPath = path.join(os.tmpdir(), 'refract-no-electron-app');
        }

        try { fs.mkdirSync(userDataPath, { recursive: true }); } catch (e) {}
        this.dbPath = path.join(userDataPath, 'refract.db');

        // IMPORTANTE: nunca lance exceções fora do construtor. Se init() lançar uma exceção
        // e escapar, `DatabaseManager.instance` nunca é atribuído — então toda chamada
        // subsequente a getInstance() re-entra não construtor e emite novamente
        // a falha idêntica (é por isso que um único erro de dlopen costumava imprimir
        // uma parede de ~dezenas de traces de pilha idênticos através de seed-demo,
        // get-recent-meetings, modes:get-active, etc. Em vez disso, capturamos o
        // erro uma vez e degradamos para db: null; todo método público já verifica
        // com `if (!this.db)`, então os chamadores obtêm resultados vazios/nulos, não exceções.
        try {
            this.init();
        } catch (error) {
            this.initError = error as Error;
            this.reportInitFailure(error);
        }
    }

    public static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
    }

    /** Verdadeiro quando o banco de dados SQLite subjacente é aberto com sucesso. */
    public isAvailable(): boolean {
        return this.db !== null;
    }

    /**
     * The erro que caused initialization para fail, se any. Lets o app surface
     * a único user-facing banner (e.g. "Local database unavailable — meeting
     * history disabled") instead of relying on registro scraping.
     */
    public getInitError(): Error | null {
        return this.initError;
    }

    /**
     * Translate an inicializar failure em a single, actionable registro line. The most
     * comum fatal cause is a native-module architecture mismatch (an x86_64
     * better-sqlite3 binary loaded sob o arm64 Electron runtime, typically
     * produced by an `npm install` que ran sob a Rosetta shell).
     */
    private reportInitFailure(error: unknown): void {
        const err = error as NodeJS.ErrnoException;
        const msg = err?.message || String(error);
        const isArchMismatch =
            err?.code === 'ERR_DLOPEN_FAILED' ||
            /incompatible architecture|ERR_DLOPEN_FAILED|mach-o/i.test(msg);

        if (isArchMismatch) {
            console.error(
                '[DatabaseManager] FATAL: native module (better-sqlite3) failed to load — the compiled ' +
                'binary architecture does not match the Electron runtime. Local database is DISABLED ' +
                '(meeting history, modes, and notes will not persist this session).\n' +
                '  Fix: run `npm run rebuild:native` from a native (non-Rosetta) terminal, then restart the app.'
            );
        } else {
            console.error(
                '[DatabaseManager] FATAL: database initialization failed. Local database is DISABLED ' +
                '(meeting history, modes, and notes will not persist this session).',
                error
            );
        }
    }

    private init() {
        try {
            console.log(`[DatabaseManager] Initializing database at ${this.dbPath}`);
            // Garante que o diretório existe (embora userData geralmente faça
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[DatabaseManager] Created directory: ${dir}`);
            } else {
                console.log(`[DatabaseManager] Directory exists: ${dir}`);
                try {
                    const files = fs.readdirSync(dir);
                    console.log(`[DatabaseManager] Directory contents:`, files);
                    const dbExists = fs.existsSync(this.dbPath);
                    if (dbExists) {
                        const stats = fs.statSync(this.dbPath);
                        console.log(`[DatabaseManager] Found existing DB. Size: ${stats.size} bytes`);
                    } else {
                        console.log(`[DatabaseManager] No existing DB found at ${this.dbPath}. Creating new one.`);
                    }
                } catch (e) {
                    console.error('[DatabaseManager] Error checking directory/file:', e);
                }
            }

            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');

            // Carrega a extensão sqlite-vec para busca vetorial nativa
            try {
                // 1. getLoadablePath() do sqlite-vec retorna o caminho dentro do app.asar
                //    (ex.: .../app.asar/node_modules/sqlite-vec-darwin-arm64/vec0.dylib)
                //    mas dlopen() precisa de arquivos reais em disco, não arquivos dentro do arquivo asar.
                //    O asarUnpack do electron-builder os coloca em app.asar.unpacked em vez disso.
                // 2. loadExtension() do better-sqlite3 adiciona automaticamente a extensão da plataforma
                //    (.dylib/.so/.dll), então removemos para evitar vec0.dylib.dylib.
                let extPath = sqliteVec.getLoadablePath();
                extPath = extPath.replace('app.asar', 'app.asar.unpacked');
                extPath = extPath.replace(/\.(dylib|so|dll)$/, '');
                this.db.loadExtension(extPath);
                this.resolvedExtPath = extPath; // Armazenado para acesso da thread de trabalho
                console.log('[DatabaseManager] sqlite-vec extension loaded successfully');
            } catch (extErr) {
                console.error('[DatabaseManager] Failed to load sqlite-vec extension:', extErr);
                console.warn('[DatabaseManager] Vector search will fall back to JS cosine similarity');
            }

            this.runMigrations();
        } catch (error) {
            console.error('[DatabaseManager] Failed to initialize database:', error);
            throw error;
        }
    }

    // ============================================
    // Sistema de Migração PRAGMA user_version
    // ============================================
    // Cada versão é aplicada exatamente uma vez em ordem.
    // Novas migrações adicionam um novo bloco `if (version < N)`.
    // ============================================

    private runMigrations() {
        if (!this.db) return;

        const version = (this.db.pragma('user_version', { simple: true }) as number) || 0;
        console.log(`[DatabaseManager] Current schema version: ${version}`);

        // Versão 0 → 1: Esquema inicial (todas as tabelas principais)
        if (version < 1) {
            console.log('[DatabaseManager] Applying migration v0 → v1: Initial schema');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS meetings (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    start_time INTEGER,
                    duration_ms INTEGER,
                    summary_json TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    calendar_event_id TEXT,
                    source TEXT,
                    is_processed INTEGER DEFAULT 1,
                    summary_status TEXT DEFAULT 'completed'
                );

                CREATE TABLE IF NOT EXISTS transcripts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT,
                    speaker TEXT,
                    content TEXT,
                    timestamp_ms INTEGER,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS ai_interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT,
                    type TEXT,
                    timestamp INTEGER,
                    user_query TEXT,
                    ai_response TEXT,
                    metadata_json TEXT,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    speaker TEXT,
                    start_timestamp_ms INTEGER,
                    end_timestamp_ms INTEGER,
                    cleaned_text TEXT NOT NULL,
                    token_count INTEGER NOT NULL,
                    embedding BLOB,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS chunk_summaries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT NOT NULL UNIQUE,
                    summary_text TEXT NOT NULL,
                    embedding BLOB,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS embedding_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT NOT NULL,
                    chunk_id INTEGER,
                    status TEXT DEFAULT 'pending',
                    retry_count INTEGER DEFAULT 0,
                    error_message TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    processed_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_chunks_meeting ON chunks(meeting_id);

                CREATE TABLE IF NOT EXISTS user_profile (
                    id INTEGER PRIMARY KEY,
                    structured_json TEXT NOT NULL,
                    compact_persona TEXT NOT NULL,
                    intro_short TEXT,
                    intro_interview TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS resume_nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT,
                    title TEXT,
                    organization TEXT,
                    start_date TEXT,
                    end_date TEXT,
                    duration_months INTEGER,
                    text_content TEXT,
                    tags TEXT,
                    embedding BLOB
                );
            `);
            this.db.pragma('user_version = 1');
        }

        // Versão 1 → 2: Adiciona colunas para instalações existentes (seguro para instalações novas também)
        if (version < 2) {
            console.log('[DatabaseManager] Aplicando migração v1 → v2: Adicionar colunas meetings');
            // Para instalações novas, essas colunas já existem desde v1, então protegemos com try/catch.
            // Diferente do código antigo, essas são versionadas e executam exatamente uma vez
            const columnsToAdd = [
                "ALTER TABLE meetings ADD COLUMN calendar_event_id TEXT",
                "ALTER TABLE meetings ADD COLUMN source TEXT",
                "ALTER TABLE meetings ADD COLUMN is_processed INTEGER DEFAULT 1"
            ];
            for (const sql of columnsToAdd) {
                try { this.db.exec(sql); } catch (e) { /* Coluna já existe desde a criação em v1 */ }
            }
            this.db.pragma('user_version = 2');
        }

        // Versão 2 → 3: sqlite-vec virtual tables para native vector busca
        if (version < 3) {
            console.log('[DatabaseManager] Applying migration v2 → v3: vec0 virtual tables');
            try {
                // Cria vec0 virtual tabela para chunk embeddings (dynamic dimension)
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                        chunk_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                // Cria vec0 virtual tabela para summary embeddings (dynamic dimension)
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
                        summary_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                // Migrar existing chunk embeddings de BLOB coluna para vec0 tabela
                this.migrateExistingEmbeddings();

                console.log('[DatabaseManager] vec0 virtual tables created successfully');
            } catch (e) {
                console.error('[DatabaseManager] vec0 migration failed (sqlite-vec may not be loaded):', e);
                console.warn('[DatabaseManager] VectorStore will fall back to JS cosine similarity');
            }
            this.db.pragma('user_version = 3');
        }

        // Versão 3 → 4: Remover tabelas vec0 com dimensão fixa 768 para permitir dimensões de embedding flexíveis
        if (version < 4) {
            console.log('[DatabaseManager] Applying migration v3 → v4: Drop strict dimension vec0 tables');
            try {
                this.db.exec('DROP TABLE IF EXISTS vec_chunks;');
                this.db.exec('DROP TABLE IF EXISTS vec_summaries;');

                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                        chunk_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
                        summary_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                this.migrateExistingEmbeddings();
                console.log('[DatabaseManager] vec0 virtual tables recreated for flexible dimensions');
            } catch (e) {
                console.error('[DatabaseManager] vec0 migration v4 failed:', e);
            }
            this.db.pragma('user_version = 4');
        }

        // Versão 4 → 5: Adiciona embedding provedor e dimensions columns
        if (version < 5) {
            console.log('[DatabaseManager] Applying migration v4 → v5: Add embedding provider/dimensions columns');
            const columnsToAdd = [
                "ALTER TABLE meetings ADD COLUMN embedding_provider TEXT",
                "ALTER TABLE meetings ADD COLUMN embedding_dimensions INTEGER"
            ];
            for (const sql of columnsToAdd) {
                try { this.db.exec(sql); } catch (e) { /* Coluna já exists */ }
            }
            this.db.pragma('user_version = 5');
        }

        // Versão 5 → 6: Adiciona tabela app_state para armazenamento KV (estado de pull do Ollama, etc.)
        if (version < 6) {
            console.log('[DatabaseManager] Applying migration v5 → v6: Add app_state table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            `);
            this.db.pragma('user_version = 6');
        }

        // Versão 6 → 7: Adiciona índices em transcripts e ai_interactions meeting_id
        // (Anteriormente ausentes — causavam varreduras O(N) na tabela inteira ao buscar detalhes da reunião)
        if (version < 7) {
            console.log('[DatabaseManager] Applying migration v6 → v7: Add meeting_id indexes');
            try {
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id);');
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_ai_interactions_meeting ON ai_interactions(meeting_id, timestamp);');
                console.log('[DatabaseManager] Meeting ID indexes created successfully');
            } catch (e) {
                console.error('[DatabaseManager] Failed to create indexes (non-fatal):', e);
            }
            this.db.pragma('user_version = 7');
        }

        // Versão 7 → 8: Cria tabelas vec0 por dimensão (NOTA: esta v8 rodou em duas iterações
        // quebradas para alguns usuários — primeiro com tabela float única, depois com tabelas
        // corretas por dimensão. A migração v9 abaixo corrige qualquer v8 que usou o esquema antigo quebrado
        if (version < 8) {
            console.log('[DatabaseManager] Applying migration v7 → v8: Provision per-dimension vec0 tables');
            // Remover tabelas legadas de dimensão única de v3/v4 se existirem e forem inutilizáveis
            try { this.db.exec('DROP TABLE IF EXISTS vec_chunks;'); } catch (_) {}
            try { this.db.exec('DROP TABLE IF EXISTS vec_summaries;'); } catch (_) {}

            for (const dim of DatabaseManager.KNOWN_DIMS) {
                this.ensureVecTableForDim(dim);
            }
            console.log('[DatabaseManager] v8 migration: per-dimension vec0 tables provisioned');
            this.db.pragma('user_version = 8');
        }

        // Versão 8 → 9: Garante que tabelas por dimensão existam.
        // Necessário para BDs já na v8 mas com o esquema float único antigo quebrado
        // ou com a primeira migração v8 incorreta que não criou as tabelas KNOWN_DIMS.
        if (version < 9) {
            console.log('[DatabaseManager] Applying migration v8 → v9: Ensure per-dimension vec0 tables exist');
            // Remover tabelas órfãs antigas de dimensão única se existirem (esquema float único
            try { this.db.exec('DROP TABLE IF EXISTS vec_chunks;'); } catch (_) {}
            try { this.db.exec('DROP TABLE IF EXISTS vec_summaries;'); } catch (_) {}

            let allOk = true;
            for (const dim of DatabaseManager.KNOWN_DIMS) {
                this.ensureVecTableForDim(dim);
                // Verifica se a tabela realmente existe após a criação
                try {
                    this.db.prepare(`SELECT count(*) FROM vec_chunks_${dim} LIMIT 1`).get();
                } catch (e) {
                    console.error(`[DatabaseManager] v9: vec_chunks_${dim} still missing after provisioning:`, e);
                    allOk = false;
                }
            }
            if (allOk) {
                console.log('[DatabaseManager] v9 migration: all per-dimension vec0 tables verified ✓');
            } else {
                console.warn('[DatabaseManager] v9 migration: some tables missing — sqlite-vec extension may not be loaded');
            }
            this.db.pragma('user_version = 9');
        }

        // Versão 9 → 10: Adiciona restrição UNIQUE em embedding_queue(meeting_id, chunk_id).
        // Isso habilita INSERT OR IGNORE não EmbeddingPipeline.queueMeeting() para silenciosamente
        // pular linhas duplicadas quando queueMeeting() é chamado mais de uma vez para a mesma reunião.
        // SQLite não suporta ALTER TABLE ADD CONSTRAINT em tabelas existentes, então recriamos a tabela
        // usando o padrão padrão renomear-criar-copiar-remover.
        if (version < 10) {
            console.log('[DatabaseManager] Applying migration v9 → v10: Add UNIQUE constraint to embedding_queue');
            try {
                // Encapsular todos os passos em uma transação explícita do better-sqlite3 para atomicidade.
                // Se qualquer passo lançar exceção, a migração inteira é desfeita limpa —
                // prevenindo o estado perigoso de tabela semi-renomeada que uma cadeia de exec() deixaria.
                const migrate = this.db.transaction(() => {
                    // Passo 1: Renomear a tabela existente para um nome temporário
                    this.db!.exec('ALTER TABLE embedding_queue RENAME TO embedding_queue_old;');

                    // Passo 2: Recriar com a restrição UNIQUE(meeting_id, chunk_id)
                    this.db!.exec(`
                        CREATE TABLE embedding_queue (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            meeting_id TEXT NOT NULL,
                            chunk_id INTEGER,
                            status TEXT DEFAULT 'pending',
                            retry_count INTEGER DEFAULT 0,
                            error_message TEXT,
                            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                            processed_at TEXT,
                            UNIQUE(meeting_id, chunk_id)
                        );
                    `);

                    // Step 3: Copy rows; Insere Ou Ignorar silently drops qualquer pre-existing duplicates
                    this.db!.exec(`
                        INSERT OR IGNORE INTO embedding_queue
                            (id, meeting_id, chunk_id, status, retry_count, error_message, created_at, processed_at)
                        SELECT id, meeting_id, chunk_id, status, retry_count, error_message, created_at, processed_at
                        FROM embedding_queue_old;
                    `);

                    // Passo 4: Remover o backup
                    this.db!.exec('DROP TABLE embedding_queue_old;');
                });
                migrate();
                console.log('[DatabaseManager] v10 migration: embedding_queue UNIQUE constraint added ✓');
                this.db.pragma('user_version = 10');
            } catch (e) {
                console.error('[DatabaseManager] v10 migration failed — table structure unchanged:', e);
                // BUG-3 FIX: user_version NÃO avança em falha. A transação SQLite
                // (this.db.transaction()) garante rollback atômico de TODOS os 4 passos —
                // ALTER TABLE RENAME, CREATE TABLE, INSERT, DROP TABLE — se qualquer um
                // lançar exceção. Portanto embedding_queue_old NUNCA sobra. Como a
                // versão não avançou, a migração será re-tentada no próximo startup.
                // No caso de falha permanente, INSERT OR IGNORE em queueMeeting() ainda
                // funciona por unicidade natural, apenas sem deduplicação forçada pelo DB.
            }
        }

        // Versão 10 → 11: Adiciona modes, mode_reference_files, e mode_note_sections tables
        if (version < 11) {
            console.log('[DatabaseManager] Applying migration v10 → v11: Add modes tables');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS modes (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    template_type TEXT NOT NULL DEFAULT 'general',
                    custom_context TEXT NOT NULL DEFAULT '',
                    is_active INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS mode_reference_files (
                    id TEXT PRIMARY KEY,
                    mode_id TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS mode_note_sections (
                    id TEXT PRIMARY KEY,
                    mode_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    compiled_prompt TEXT DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
                );
            `);
            // Semear o modo "General" padrão como ativo
            const defaultModeId = 'mode_general_default';
            this.db.prepare(`
                INSERT OR IGNORE INTO modes (id, name, template_type, custom_context, is_active)
                VALUES (?, ?, ?, ?, 1)
            `).run(defaultModeId, 'General', 'general', '');
            this.db.pragma('user_version = 11');
        }

        // Versão 11 → 12: Seed note sections para o padrão General modo se missing
        if (version < 12) {
            console.log('[DatabaseManager] Applying migration v11 → v12: Seed default General mode note sections');
            const defaultModeId = 'mode_general_default';
            const modeExists = this.db.prepare('SELECT id FROM modes WHERE id = ?').get(defaultModeId);
            const existing = modeExists
                ? this.db.prepare('SELECT id FROM mode_note_sections WHERE mode_id = ?').get(defaultModeId)
                : null;
            if (modeExists && !existing) {
                const defaultSections = [
                    { title: 'Summary',      description: 'High-level summary of the conversation.' },
                    { title: 'Action items', description: 'Tasks and follow-ups identified.' },
                    { title: 'Key points',   description: 'Important points discussed.' },
                ];
                const insertSection = this.db.prepare(
                    'INSERT OR IGNORE INTO mode_note_sections (id, mode_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)'
                );
                defaultSections.forEach((s, i) => {
                    insertSection.run(`ns_general_${i}`, defaultModeId, s.title, s.description, i);
                });
            }
            this.db.pragma('user_version = 12');
        }

        // Versão 12 → 13: Backfill note sections para qualquer modo instance que tem nenhum
        if (version < 13) {
            console.log('[DatabaseManager] Applying migration v12 → v13: Backfill missing mode note sections');
            const BACKFILL_SECTIONS: Record<string, Array<{ title: string; description: string }>> = {
                general: [
                    { title: 'Summary',      description: 'High-level summary of the conversation.' },
                    { title: 'Action items', description: 'Tasks and follow-ups identified.' },
                    { title: 'Key points',   description: 'Important points discussed.' },
                ],
                'looking-for-work': [
                    { title: 'Follow-up actions',       description: 'Next interview steps or additional materials I said I would send if applicable.' },
                    { title: 'Overview',                description: 'Overview of the interview, the company, and general structure.' },
                    { title: 'Questions and responses', description: 'All questions asked to me during the interview and answers that gave.' },
                    { title: 'Areas to improve',        description: 'What I could have done better during the interview.' },
                    { title: 'Role details',            description: 'Anything discussed about the position, salary expectations, etc.' },
                ],
                sales: [
                    { title: 'Action Items',        description: 'All action items that were said I would do after the meeting.' },
                    { title: 'Outcome',             description: 'Did I close the sale and what was the outcome of the conversation.' },
                    { title: 'Prospect background', description: 'Background and context on who I was selling to.' },
                    { title: 'Discovery',           description: 'What the prospect said during discovery.' },
                    { title: 'Product',             description: "How I pitched the product and the prospect's reaction." },
                    { title: 'Objections',          description: 'Objections from the prospect if there were any.' },
                ],
                recruiting: [
                    { title: 'Action Items',          description: 'All action items that I have to do after the meeting.' },
                    { title: 'Experience and skills', description: "Candidate's previous work experience and skills discussed." },
                    { title: 'Quality of responses',  description: 'If there were questions asked, how well and how accurately the candidate answered each question.' },
                    { title: 'Interest in company',   description: 'What the candidate said about their interest in the company.' },
                    { title: 'Role expectations',     description: 'Anything discussed about the position, salary expectations, etc.' },
                ],
                'team-meet': [
                    { title: 'Action Items',           description: 'All action items that were said I would do after the meeting.' },
                    { title: 'Announcements',          description: 'Any team-wide announcements from the meeting.' },
                    { title: 'Team updates',           description: "Each team member's progress, accomplishments, and current focus." },
                    { title: 'Challenges or blockers', description: 'Any issues or obstacles raised that may affect progress.' },
                    { title: 'Decisions made',         description: 'Key decisions or agreements reached during the meeting.' },
                ],
                lecture: [
                    { title: 'Follow-up work', description: 'Follow-up reading, assignments, or tasks to complete.' },
                    { title: 'Topic',          description: 'Main subject or theme of the lecture.' },
                    { title: 'Key concepts',   description: 'Core ideas or frameworks covered.' },
                    { title: 'Content',        description: 'All content from the lecture with incredibly detailed bullet notes.' },
                ],
                'technical-interview': [
                    { title: 'Problems covered', description: 'Each problem asked, the approach used, and the outcome.' },
                    { title: 'Concepts tested',  description: 'Key algorithms, data structures, or system design concepts that came up.' },
                    { title: 'What went well',   description: 'Approaches or explanations that landed well.' },
                    { title: 'Areas to study',   description: 'Topics or gaps identified that need more preparation.' },
                    { title: 'Action items',     description: 'Follow-up steps — e.g. send code, study specific topics, await next round.' },
                ],
            };

            const allModes = this.db.prepare('SELECT id, template_type FROM modes').all() as Array<{ id: string; template_type: string }>;
            const insertSection = this.db.prepare(
                'INSERT OR IGNORE INTO mode_note_sections (id, mode_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)'
            );
            for (const mode of allModes) {
                const hasSection = this.db.prepare('SELECT id FROM mode_note_sections WHERE mode_id = ? LIMIT 1').get(mode.id);
                if (!hasSection) {
                    const sections = BACKFILL_SECTIONS[mode.template_type] ?? [];
                    sections.forEach((s, i) => {
                        insertSection.run(`ns_bf_${mode.id}_${i}`, mode.id, s.title, s.description, i);
                    });
                    if (sections.length > 0) {
                        console.log(`[DatabaseManager] Backfilled ${sections.length} sections for mode "${mode.id}" (${mode.template_type})`);
                    }
                }
            }
            this.db.pragma('user_version = 13');
        }

        // Versão 13 → 14: Adiciona profile_custom_notes tabela
        if (version < 14) {
            console.log('[DatabaseManager] Applying migration v13 → v14: Add profile_custom_notes table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_custom_notes (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT OR IGNORE INTO profile_custom_notes (id, content) VALUES (1, '');
            `);
            this.db.pragma('user_version = 14');
        }

        // Versão 14 → 15: Adiciona profile_persona tabela
        if (version < 15) {
            console.log('[DatabaseManager] Applying migration v14 → v15: Add profile_persona table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_persona (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT OR IGNORE INTO profile_persona (id, content) VALUES (1, '');
            `);
            this.db.pragma('user_version = 15');
        }

        // Versão 15 → 16: Adiciona coluna de identidade embedding_space + backfill.
        // A verificação de compatibilidade de re-indexação anterior era baseada em `embedding_provider`
        // (apenas o nome, ex.: 'gemini'), que NÃO consegue distinguir dois modelos com o
        // mesmo provedor+dimensões mas espaços vetoriais incompatíveis (ex.:
        // gemini-embedding-001 768d vs gemini-embedding-2 768d). embedding_space é
        // a identidade composta `${name}:${model}:${dims}` que corrige isso.
        //
        // O backfill sintetiza o espaço v1 para cada linha legada a partir de seu
        // provedor+dims existente, então it corretamente DIFERE do espaço de qualquer modelo novo. As
        // strings de modelo abaixo precisam corresponder ao padrão enviado por cada provedor na
        // época em que as linhas legadas foram escritas (ver electron/rag/embeddingSpace.ts:legacySpaceForProvider).
        if (version < 16) {
            console.log('[DatabaseManager] Applying migration v15 → v16: Add embedding_space column + backfill');
            try { this.db.exec('ALTER TABLE meetings ADD COLUMN embedding_space TEXT'); } catch (e) { /* coluna já exists */ }
            try {
                // Build o CASE arms de o Mesmo shared mapa legacySpaceForProvider uses,
                // então o migration backfill e o runtime space chave pode nunca drift apart.
                const caseArms = buildLegacySpaceCaseSql();
                this.db.exec(`
                    UPDATE meetings
                    SET embedding_space =
                        embedding_provider || ':' ||
                        CASE embedding_provider
                          ${caseArms}
                          ELSE 'unknown'
                        END || ':' ||
                        COALESCE(CAST(embedding_dimensions AS TEXT), 'unknown')
                    WHERE embedding_provider IS NOT NULL
                      AND embedding_space IS NULL;
                `);
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_meetings_embedding_space ON meetings(embedding_space);');
                console.log('[DatabaseManager] v16 migration: embedding_space backfilled + indexed ✓');
            } catch (e) {
                console.error('[DatabaseManager] v16 migration backfill failed (non-fatal):', e);
            }
            this.db.pragma('user_version = 16');
        }

        // Versão 16 → 17: Rastreia o estado de geração de notas pós-reunião
        // A sumarização V3 é multi-estágio (em fila → chunking → summarizing_chunks →
        // reducing → validating → completed/failed). Armazenamos apenas a string de status segura —
        // nunca transcript ou conteúdo de nota gerado — para que a UI possa expor retry/regenerate.
        if (version < 17) {
            console.log('[DatabaseManager] Applying migration v16 → v17: Add summary_status column');
            try { this.db.exec("ALTER TABLE meetings ADD COLUMN summary_status TEXT DEFAULT 'completed'"); } catch (e) { /* coluna já exists */ }
            try { this.db.exec("UPDATE meetings SET summary_status = 'queued' WHERE is_processed = 0"); } catch (e) { /* non-fatal backfill */ }
            this.db.pragma('user_version = 17');
        }

        // Versão 17 → 18: Adiciona compiled_prompt em mode_note_sections. Quando um usuário adiciona ou
        // edita uma seção de notas (ou cria um modo personalizado), uma instrução de extração
        // compilada por IA é gerada a partir do título+descrição da seção e cacheada aqui para que
        // a geração de resumo possa preencher essa seção fielmente. Vazio/null = volta para
        // título+descrição. Nunca armazena transcript ou conteúdo de nota.
        if (version < 18) {
            console.log('[DatabaseManager] Applying migration v17 → v18: Add compiled_prompt to mode_note_sections');
            try { this.db.exec("ALTER TABLE mode_note_sections ADD COLUMN compiled_prompt TEXT DEFAULT ''"); } catch (e) { /* coluna já exists */ }
            this.db.pragma('user_version = 18');
        }

        // Versão 18 → 19: Adiciona a tabela user_preferences e decision_history para Memória do Projeto / Pessoal
        if (version < 19) {
            console.log('[DatabaseManager] Applying migration v18 → v19: Add user_preferences and decision_history tables');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS user_preferences (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS decision_history (
                    id TEXT PRIMARY KEY,
                    decision_topic TEXT NOT NULL,
                    decision_details TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            `);
            this.db.pragma('user_version = 19');
        }

        // Versão 19 → 20: Adiciona a tabela replica_sessions para o Modo Réplica (Interview Coach)
        // Sessões de prática de entrevista: guarda perguntas, respostas, avaliação e score.
        if (version < 20) {
            console.log('[DatabaseManager] Applying migration v19 → v20: Add replica_sessions table (Interview Coach)');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS replica_sessions (
                    id TEXT PRIMARY KEY,
                    mode_type TEXT NOT NULL DEFAULT 'technical-interview',
                    language TEXT NOT NULL DEFAULT 'en',
                    title TEXT NOT NULL DEFAULT '',
                    questions_json TEXT NOT NULL DEFAULT '[]',
                    evaluation_json TEXT,
                    score INTEGER,
                    grade TEXT,
                    duration_ms INTEGER,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_replica_sessions_created ON replica_sessions(created_at);
            `);
            this.db.pragma('user_version = 20');
        }

        console.log('[DatabaseManager] Migrations completed.');
    }

    // ============================================
    // Perfil Custom Notes
    // ============================================

    public getCustomNotes(): string {
        if (!this.db) return '';
        try {
            const row = this.db.prepare('SELECT content FROM profile_custom_notes WHERE id = 1').get() as { content: string } | undefined;
            return row?.content ?? '';
        } catch (e) {
            console.error('[DatabaseManager] getCustomNotes failed:', e);
            return '';
        }
    }

    public saveCustomNotes(content: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                'INSERT INTO profile_custom_notes (id, content, updated_at) VALUES (1, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
            ).run(content);
        } catch (e) {
            console.error('[DatabaseManager] saveCustomNotes failed:', e);
        }
    }

    public getPersona(): string {
        if (!this.db) return '';
        try {
            const row = this.db.prepare('SELECT content FROM profile_persona WHERE id = 1').get() as { content: string } | undefined;
            return row?.content ?? '';
        } catch (e) {
            console.error('[DatabaseManager] getPersona failed:', e);
            return '';
        }
    }

    public savePersona(content: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                'INSERT INTO profile_persona (id, content, updated_at) VALUES (1, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
            ).run(content);
        } catch (e) {
            console.error('[DatabaseManager] savePersona failed:', e);
        }
    }

    public clearProfilePersona(): void {
        if (!this.db) return;
        try {
            this.db.prepare('UPDATE profile_persona SET content = \'\', updated_at = datetime(\'now\') WHERE id = 1').run();
        } catch (e) {
            console.error('[DatabaseManager] clearProfilePersona failed:', e);
        }
    }

    // ============================================
    // FASE 3: Project-Wide & Personal Memory
    // ============================================

    public getAllUserPreferences(): Record<string, string> {
        if (!this.db) return {};
        try {
            const rows = this.db.prepare('SELECT key, value FROM user_preferences').all() as Array<{ key: string; value: string }>;
            const prefs: Record<string, string> = {};
            for (const row of rows) prefs[row.key] = row.value;
            return prefs;
        } catch (e) {
            console.error('[DatabaseManager] getAllUserPreferences failed:', e);
            return {};
        }
    }

    public setUserPreference(key: string, value: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                `INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
            ).run(key, value);
        } catch (e) {
            console.error('[DatabaseManager] setUserPreference failed:', e);
        }
    }

    public deleteUserPreference(key: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM user_preferences WHERE key = ?').run(key);
        } catch (e) {
            console.error('[DatabaseManager] deleteUserPreference failed:', e);
        }
    }

    public getRecentDecisions(limit: number = 10): string {
        if (!this.db) return '';
        try {
            const rows = this.db.prepare(
                'SELECT decision_topic, decision_details FROM decision_history ORDER BY created_at DESC LIMIT ?'
            ).all(limit) as Array<{ decision_topic: string; decision_details: string }>;
            if (rows.length === 0) return '';
            return rows.map(r => `• ${r.decision_topic}: ${r.decision_details}`).join('\n');
        } catch (e) {
            console.error('[DatabaseManager] getRecentDecisions failed:', e);
            return '';
        }
    }

    public addDecision(topic: string, details: string): string {
        if (!this.db) return '';
        try {
            const id = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            this.db.prepare(
                'INSERT INTO decision_history (id, decision_topic, decision_details) VALUES (?, ?, ?)'
            ).run(id, topic, details);
            // Auto-prune to keep only the last 50 decisions (bounded storage)
            this.pruneOldDecisions(50);
            return id;
        } catch (e) {
            console.error('[DatabaseManager] addDecision failed:', e);
            return '';
        }
    }

    /** Removes oldest decisions beyond the retention limit. */
    private pruneOldDecisions(retainCount: number): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                `DELETE FROM decision_history WHERE id NOT IN (
                    SELECT id FROM decision_history ORDER BY created_at DESC LIMIT ?
                )`
            ).run(retainCount);
        } catch (e) {
            console.error('[DatabaseManager] pruneOldDecisions failed:', e);
        }
    }
    // ============================================
    // Modes CRUD
    // ============================================

    public getModes(): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare('SELECT * FROM modes ORDER BY created_at ASC').all();
        } catch (e) {
            console.error('[DatabaseManager] getModes failed:', e);
            return [];
        }
    }

    public getActiveMode(): any | null {
        if (!this.db) return null;
        try {
            return this.db.prepare('SELECT * FROM modes WHERE is_active = 1 LIMIT 1').get() ?? null;
        } catch (e) {
            console.error('[DatabaseManager] getActiveMode failed:', e);
            return null;
        }
    }

    public createMode(mode: { id: string; name: string; templateType: string; customContext: string }): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO modes (id, name, template_type, custom_context, is_active)
                VALUES (?, ?, ?, ?, 0)
            `).run(mode.id, mode.name, mode.templateType, mode.customContext);
        } catch (e) {
            console.error('[DatabaseManager] createMode failed:', e);
        }
    }

    public updateMode(id: string, updates: { name?: string; templateType?: string; customContext?: string }): void {
        if (!this.db) return;
        try {
            if (updates.name !== undefined) {
                this.db.prepare('UPDATE modes SET name = ? WHERE id = ?').run(updates.name, id);
            }
            if (updates.templateType !== undefined) {
                this.db.prepare('UPDATE modes SET template_type = ? WHERE id = ?').run(updates.templateType, id);
            }
            if (updates.customContext !== undefined) {
                this.db.prepare('UPDATE modes SET custom_context = ? WHERE id = ?').run(updates.customContext, id);
            }
        } catch (e) {
            console.error('[DatabaseManager] updateMode failed:', e);
        }
    }

    public deleteMode(id: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM modes WHERE id = ?').run(id);
        } catch (e) {
            console.error('[DatabaseManager] deleteMode failed:', e);
        }
    }

    public setActiveMode(id: string | null): void {
        if (!this.db) return;
        try {
            const txn = this.db.transaction(() => {
                this.db!.prepare('UPDATE modes SET is_active = 0').run();
                if (id) {
                    const result = this.db!.prepare('UPDATE modes SET is_active = 1 WHERE id = ?').run(id);
                    if (result.changes === 0) {
                        console.warn(`[DatabaseManager] setActiveMode: no mode found with id "${id}" — active mode cleared`);
                    }
                }
            });
            txn();
        } catch (e) {
            console.error('[DatabaseManager] setActiveMode failed:', e);
        }
    }

    public getReferenceFiles(modeId: string): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare('SELECT * FROM mode_reference_files WHERE mode_id = ? ORDER BY created_at ASC').all(modeId);
        } catch (e) {
            console.error('[DatabaseManager] getReferenceFiles failed:', e);
            return [];
        }
    }

    public addReferenceFile(file: { id: string; modeId: string; fileName: string; content: string }): void {
        if (!this.db) throw new Error('Database not initialized');
        try {
            this.db.prepare(`
                INSERT INTO mode_reference_files (id, mode_id, file_name, content)
                VALUES (?, ?, ?, ?)
            `).run(file.id, file.modeId, file.fileName, file.content);
        } catch (e) {
            console.error('[DatabaseManager] addReferenceFile failed:', e);
            throw e;
        }
    }

    public deleteReferenceFile(id: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM mode_reference_files WHERE id = ?').run(id);
        } catch (e) {
            console.error('[DatabaseManager] deleteReferenceFile failed:', e);
        }
    }

    // ── Note Sections ─────────────────────────────────────────────

    public getNoteSections(modeId: string): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare(
                'SELECT * FROM mode_note_sections WHERE mode_id = ? ORDER BY sort_order ASC, created_at ASC'
            ).all(modeId);
        } catch (e) {
            console.error('[DatabaseManager] getNoteSections failed:', e);
            return [];
        }
    }

    public addNoteSection(section: { id: string; modeId: string; title: string; description: string; sortOrder: number }): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO mode_note_sections (id, mode_id, title, description, sort_order)
                VALUES (?, ?, ?, ?, ?)
            `).run(section.id, section.modeId, section.title, section.description, section.sortOrder);
        } catch (e) {
            console.error('[DatabaseManager] addNoteSection failed:', e);
        }
    }

    public updateNoteSection(id: string, updates: { title?: string; description?: string; sortOrder?: number; compiledPrompt?: string }): void {
        if (!this.db) return;
        try {
            if (updates.title !== undefined) {
                this.db.prepare('UPDATE mode_note_sections SET title = ? WHERE id = ?').run(updates.title, id);
            }
            if (updates.description !== undefined) {
                this.db.prepare('UPDATE mode_note_sections SET description = ? WHERE id = ?').run(updates.description, id);
            }
            if (updates.sortOrder !== undefined) {
                this.db.prepare('UPDATE mode_note_sections SET sort_order = ? WHERE id = ?').run(updates.sortOrder, id);
            }
            if (updates.compiledPrompt !== undefined) {
                try { this.db.prepare('UPDATE mode_note_sections SET compiled_prompt = ? WHERE id = ?').run(updates.compiledPrompt, id); } catch { /* coluna pode não exist em muito old DB */ }
            }
        } catch (e) {
            console.error('[DatabaseManager] updateNoteSection failed:', e);
        }
    }

    /** Procura o modo que possui um dado id de seção de notas (usado pelo compilador de prompts). */
    public getNoteSectionOwnerMode(sectionId: string): { sectionId: string; modeId: string; title: string; description: string; templateType?: string } | null {
        if (!this.db) return null;
        try {
            const row = this.db.prepare(`
                SELECT s.id as section_id, s.mode_id, s.title, s.description, m.template_type
                FROM mode_note_sections s JOIN modes m ON m.id = s.mode_id
                WHERE s.id = ?
            `).get(sectionId) as any;
            if (!row) return null;
            return { sectionId: row.section_id, modeId: row.mode_id, title: row.title, description: row.description, templateType: row.template_type };
        } catch (e) {
            console.error('[DatabaseManager] getNoteSectionOwnerMode failed:', e);
            return null;
        }
    }

    public deleteNoteSection(id: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM mode_note_sections WHERE id = ?').run(id);
        } catch (e) {
            console.error('[DatabaseManager] deleteNoteSection failed:', e);
        }
    }

    public deleteAllNoteSections(modeId: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM mode_note_sections WHERE mode_id = ?').run(modeId);
        } catch (e) {
            console.error('[DatabaseManager] deleteAllNoteSections failed:', e);
        }
    }

    // ============================================
    // System KV Armazenamento (app_state)
    // ============================================

    public getAppState(key: string): string | null {
        if (!this.db) return null;
        try {
            const stmt = this.db.prepare('SELECT value FROM app_state WHERE key = ?');
            const row = stmt.get(key) as { value: string } | undefined;
            return row ? row.value : null;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to get app_state for key: ${key}`, error);
            return null;
        }
    }

    public setAppState(key: string, value: string): void {
        if (!this.db) return;
        try {
            const stmt = this.db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
            stmt.run(key, value);
        } catch (error) {
            console.error(`[DatabaseManager] Failed to set app_state for key: ${key}`, error);
        }
    }

    public deleteAppState(key: string): void {
        if (!this.db) return;
        try {
            const stmt = this.db.prepare('DELETE FROM app_state WHERE key = ?');
            stmt.run(key);
        } catch (error) {
            console.error(`[DatabaseManager] Failed to delete app_state for key: ${key}`, error);
        }
    }

    /**
     * One-time migration: Copy existing BLOB embeddings em vec0 virtual tables.
     */
    private migrateExistingEmbeddings(): void {
        if (!this.db) return;

        // Migrar chunk embeddings
        try {
            const chunkRows = this.db.prepare(
                'SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL'
            ).all() as any[];

            if (chunkRows.length > 0) {
                const insert = this.db.prepare(
                    'INSERT OR IGNORE INTO vec_chunks(chunk_id, embedding) VALUES (?, ?)'
                );
                const migrateAll = this.db.transaction(() => {
                    for (const row of chunkRows) {
                        try {
                            insert.run(row.id, row.embedding);
                        } catch (err) {
                            // Em mismatch (e.g. mixed 768 e 3072 dims), nullify para re-embed depois
                            this.db.prepare('UPDATE chunks SET embedding = NULL WHERE id = ?').run(row.id);
                        }
                    }
                });
                migrateAll();
                console.log(`[DatabaseManager] Migrated ${chunkRows.length} chunk embeddings to vec_chunks`);
            }
        } catch (e) {
            console.error('[DatabaseManager] Failed to migrate chunk embeddings:', e);
        }

        // Migrar summary embeddings
        try {
            const summaryRows = this.db.prepare(
                'SELECT id, embedding FROM chunk_summaries WHERE embedding IS NOT NULL'
            ).all() as any[];

            if (summaryRows.length > 0) {
                const insert = this.db.prepare(
                    'INSERT OR IGNORE INTO vec_summaries(summary_id, embedding) VALUES (?, ?)'
                );
                const migrateAll = this.db.transaction(() => {
                    for (const row of summaryRows) {
                        try {
                            insert.run(row.id, row.embedding);
                        } catch (err) {
                            this.db.prepare('UPDATE chunk_summaries SET embedding = NULL WHERE id = ?').run(row.id);
                        }
                    }
                });
                migrateAll();
                console.log(`[DatabaseManager] Migrated ${summaryRows.length} summary embeddings to vec_summaries`);
            }
        } catch (e) {
            console.error('[DatabaseManager] Failed to migrate summary embeddings:', e);
        }
    }

    /**
     * Known embedding dimension tiers.
     * Used by o v8 migration, excluir operations, e tabela provisioning.
     * When a novo provider dimension is encountered at runtime, ensureVecTableForDim() handles it.
     */
    public static readonly KNOWN_DIMS: readonly number[] = [768, 1536, 3072];

    /** Cache de dimensões para que as tabelas vec0 já tenham sido verificadas/criadas nesta sessão */
    private ensuredDims = new Set<number>();

    /**
     * Lazily criar a per-dimension vec0 tabela pair se não already present.
     * Called by v8 migration e at runtime quando a novo embedding dimension is primeiro seen.
     * Uses an in-memory cache para avoid redundant CREATE TABLE IF NOT EXISTS on todo insert.
     */
    public ensureVecTableForDim(dim: number): void {
        if (this.ensuredDims.has(dim)) return; // Já verificado nesta sessão
        if (!this.db) return;
        // Proteção contra injeção SQL: dim precisa ser um inteiro positivo
        if (!Number.isInteger(dim) || dim <= 0 || dim > 100_000) {
            console.error(`[DatabaseManager] Invalid dimension for vec0 table: ${dim}`);
            return;
        }
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_${dim} USING vec0(
                    chunk_id INTEGER PRIMARY KEY,
                    embedding float[${dim}]
                );
            `);
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries_${dim} USING vec0(
                    summary_id INTEGER PRIMARY KEY,
                    embedding float[${dim}]
                );
            `);
            this.ensuredDims.add(dim);
            console.log(`[DatabaseManager] Ensured vec0 tables for dim=${dim}`);
        } catch (e) {
            console.error(`[DatabaseManager] Failed to create vec0 tables for dim=${dim}:`, e);
        }
    }

    /**
     * Enumerate todo embedding dimension que actually has a vec0 table, unioned
     * com KNOWN_DIMS. Used by delete/clear paths so they cover dims provisioned
     * at runtime via ensureVecTableForDim() — não just o static KNOWN_DIMS list.
     *
     * Without this, a provider que introduced a dimension fora KNOWN_DIMS (e.g.
     * a future model at 1024d) would have its rows created on inserir mas NEVER
     * deleted, orphaning vec0 rows on re-index/fallback.
     */
    public getExistingVecDims(): number[] {
        const dims = new Set<number>(DatabaseManager.KNOWN_DIMS);
        if (!this.db) return [...dims];
        try {
            const rows = this.db.prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vec_chunks_%'`
            ).all() as { name: string }[];
            for (const r of rows) {
                const m = r.name.match(/^vec_chunks_(\d+)$/);
                if (m) dims.add(Number(m[1]));
            }
        } catch (e) {
            console.warn('[DatabaseManager] getExistingVecDims failed; falling back to KNOWN_DIMS:', e);
        }
        return [...dims];
    }

    /**
     * Check se sqlite-vec is disponível (any per-dimension vec0 tabela deve exist)
     */
    public hasVecExtension(): boolean {
        if (!this.db) return false;
        try {
            // Verifica a dimensão mais comum (Ollama 768); qualquer uma pode ser suficiente
            this.db.prepare("SELECT count(*) FROM vec_chunks_768 LIMIT 1").get();
            return true;
        } catch (e) {
            return false;
        }
    }

    // ============================================
    // Public API
    // ============================================

    /**
     * Expose o raw database instance para external managers (e.g. ProfileDatabaseManager).
     */
    public getDb(): Database.Database | null {
        return this.db;
    }

    /** Caminho do arquivo do banco de dados SQLite em disco. Usado por threads de trabalho. */
    public getDbPath(): string {
        return this.dbPath;
    }

    /**
     * Resolved sqlite-vec extension caminho (without platform file suffix).
     * Used by worker threads que abrir their own DB connection.
     */
    public getExtPath(): string {
        return this.resolvedExtPath;
    }

    public saveMeeting(meeting: Meeting, startTimeMs: number, durationMs: number) {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            return;
        }

        const insertMeeting = this.db.prepare(`
            INSERT OR REPLACE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, calendar_event_id, source, is_processed, summary_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertTranscript = this.db.prepare(`
            INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
            VALUES (?, ?, ?, ?)
        `);

        const insertInteraction = this.db.prepare(`
            INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        // Idempotência: a linha de meetings usa INSERT OR REPLACE mas transcripts
        // e ai_interactions são append-only com ids autoincrement, então uma segunda
        // saveMeeting() para o mesmo id (o fluxo normal: stopMeeting escreve um
        // snapshot placeholder, então processAndSaveMeeting escreve o final —
        // ver MeetingPersistence) faria APPEND de uma cópia duplicada de cada linha
        // filha. Re-saves de recuperação e reprocessamento RAG então leriam transcripts
        // duplicados. Limpar os filhos existentes dentro da mesma transação
        // antes de reinserir torna saveMeeting idempotente para um dado meeting id.
        const deleteTranscripts = this.db.prepare(`DELETE FROM transcripts WHERE meeting_id = ?`);
        const deleteInteractions = this.db.prepare(`DELETE FROM ai_interactions WHERE meeting_id = ?`);

        const summaryJson = JSON.stringify({
            legacySummary: meeting.summary,
            detailedSummary: meeting.detailedSummary
        });

        const runTransaction = this.db.transaction(() => {
            // 1. Insere Meeting
            insertMeeting.run(
                meeting.id,
                meeting.title,
                startTimeMs,
                durationMs,
                summaryJson,
                meeting.date, // Using o ISO string como created_at para sorting simplesmente
                meeting.calendarEventId || null,
                meeting.source || 'manual',
                meeting.isProcessed ? 1 : 0,
                meeting.summaryStatus || (meeting.isProcessed ? 'completed' : 'queued')
            );

            // 2. Insere Transcript
            // Limpa qualquer prior filho rows para isso meeting primeiro então re-saving o
            // mesmo meeting id (placeholder → final) faz não duplicate them.
            deleteTranscripts.run(meeting.id);
            if (meeting.transcript) {
                for (const segment of meeting.transcript) {
                    insertTranscript.run(
                        meeting.id,
                        segment.speaker,
                        segment.text,
                        segment.timestamp
                    );
                }
            }

            // 3. Insere Interactions
            deleteInteractions.run(meeting.id);
            if (meeting.usage) {
                for (const usage of meeting.usage) {
                    let metadata = null;
                    if (usage.items) {
                        metadata = JSON.stringify(usage.items);
                    } else if (usage.type === 'followup_questions' && usage.answer) {
                        // Às vezes answer é o array para questions, ou we armazenamento it em metadados
                        // Em intelligence gerenciador we pushed: { ttipo 'followup_questions', answer: fullQuestions }
                        // Vamos armazenar a resposta (array) nos metadados para este tipo
                        if (Array.isArray(usage.answer)) {
                            metadata = JSON.stringify(usage.answer);
                        }
                    }

                    // Normalization
                    const answerText = Array.isArray(usage.answer) ? null : usage.answer || null;
                    const queryText = usage.question || null;

                    insertInteraction.run(
                        meeting.id,
                        usage.type,
                        usage.timestamp,
                        queryText,
                        answerText,
                        metadata
                    );
                }
            }
        });

        try {
            runTransaction();
            console.log(`[DatabaseManager] Successfully saved meeting ${meeting.id}`);
        } catch (err) {
            console.error(`[DatabaseManager] Failed to save meeting ${meeting.id}`, err);
            throw err;
        }
    }

    public updateMeetingTitle(id: string, title: string): boolean {
        if (!this.db) return false;
        try {
            const stmt = this.db.prepare('UPDATE meetings SET title = ? WHERE id = ?');
            const info = stmt.run(title, id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to update title for meeting ${id}:`, error);
            return false;
        }
    }

    public updateSummaryStatus(id: string, status: SummaryStatus): boolean {
        if (!this.db) return false;
        try {
            const allowed = new Set(['queued', 'chunking', 'summarizing_chunks', 'reducing', 'validating', 'completed', 'failed']);
            if (!allowed.has(status)) return false;
            const info = this.db.prepare('UPDATE meetings SET summary_status = ? WHERE id = ?').run(status, id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to update summary status for meeting ${id}:`, error);
            return false;
        }
    }

    public getMeetingsWithSummaryStatus(status: SummaryStatus): Array<{ id: string; title: string; summaryStatus: SummaryStatus; date: string }> {
        if (!this.db) return [];
        try {
            const rows = this.db.prepare('SELECT id, title, created_at, summary_status FROM meetings WHERE summary_status = ? ORDER BY created_at DESC').all(status) as Array<{ id: string; title: string; created_at: string; summary_status: SummaryStatus }>;
            return rows.map(row => ({ id: row.id, title: row.title, date: row.created_at, summaryStatus: row.summary_status }));
        } catch (error) {
            console.error(`[DatabaseManager] Failed to get meetings with summary status ${status}:`, error);
            return [];
        }
    }

    public updateMeetingSummary(id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }): boolean {
        if (!this.db) return false;

        try {
            // 1. Obtém atual summary_json
            const row = this.db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get(id) as any;
            if (!row) return false;

            const existingData = JSON.parse(row.summary_json || '{}');
            const currentDetailed = existingData.detailedSummary || {};

            // 2. Mescla atualiza
            const newDetailed = {
                ...currentDetailed,
                ...updates
            };

            // Deve provavelmente filtrar fora undefined atualiza se spread doesn't manipular them como we want,
            // mas spread sobre undefined é fine. We want para sobrescrever se provided.
            // If updates.overview é vazio sstring it overwrites.
            // If updates.overview é undefined, we uso ...atualiza trick:
            // Actually spread apenas inclui próprio enumerable properties. If I pass { overview: "new" }, it works.

            // HNo entanto we precisa para ser careful não para wipe legacySummary se it exists
            const newData = {
                ...existingData,
                detailedSummary: newDetailed
            };

            const jsonStr = JSON.stringify(newData);

            // 3. Escreve voltar
            const stmt = this.db.prepare('UPDATE meetings SET summary_json = ? WHERE id = ?');
            const info = stmt.run(jsonStr, id);
            return info.changes > 0;

        } catch (error) {
            console.error(`[DatabaseManager] Failed to update summary for meeting ${id}:`, error);
            return false;
        }
    }

    /**
     * Replace o entire detailedSummary blob (used by regenerate-notes). Preserves any
     * sibling keys in summary_json (e.g. legacy fields). Also updates o title coluna when
     * o novo summary carries one. summary_status is set para o provided value.
     */
    public replaceDetailedSummary(id: string, detailedSummary: Meeting['detailedSummary'], opts?: { title?: string; summaryStatus?: SummaryStatus }): boolean {
        if (!this.db) return false;
        try {
            const row = this.db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get(id) as any;
            if (!row) return false;
            const existingData = JSON.parse(row.summary_json || '{}');
            const newData = { ...existingData, detailedSummary };
            const jsonStr = JSON.stringify(newData);
            if (opts?.title && opts?.summaryStatus) {
                const info = this.db.prepare('UPDATE meetings SET summary_json = ?, title = ?, summary_status = ? WHERE id = ?').run(jsonStr, opts.title, opts.summaryStatus, id);
                return info.changes > 0;
            }
            if (opts?.summaryStatus) {
                const info = this.db.prepare('UPDATE meetings SET summary_json = ?, summary_status = ? WHERE id = ?').run(jsonStr, opts.summaryStatus, id);
                return info.changes > 0;
            }
            const info = this.db.prepare('UPDATE meetings SET summary_json = ? WHERE id = ?').run(jsonStr, id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to replace detailed summary for meeting ${id}:`, error);
            return false;
        }
    }

    /**
     * Persist o per-meeting speaker renomear mapear em detailedSummary.speakerLabels.
     * Additive: nunca touches transcript rows ou outro summary fields.
     */
    public updateSpeakerLabels(id: string, speakerLabels: Record<string, string>): boolean {
        if (!this.db) return false;
        try {
            const row = this.db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get(id) as any;
            if (!row) return false;
            const existingData = JSON.parse(row.summary_json || '{}');
            // Preserve qualquer que seja detailedSummary shape exists (V3, legacy, ou nonenhum Quando it é
            // absent we anexar labels para a minimal objeto Sem inventing empty
            // actionItems/keyPoints arrays que o renderer iria treat como "processed mas
            // empty" — labels alone é a safe additive blob a depois resumir vai mescla identro de
            const currentDetailed = existingData.detailedSummary;
            const newDetailed = currentDetailed && typeof currentDetailed === 'object'
                ? { ...currentDetailed, speakerLabels }
                : { speakerLabels };
            const newData = { ...existingData, detailedSummary: newDetailed };
            const info = this.db.prepare('UPDATE meetings SET summary_json = ? WHERE id = ?').run(JSON.stringify(newData), id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to update speaker labels for meeting ${id}:`, error);
            return false;
        }
    }

    public getRecentMeetings(limit: number = 50): Meeting[] {
        if (!this.db) return [];

        const stmt = this.db.prepare(`
            SELECT * FROM meetings
            ORDER BY created_at DESC
            LIMIT ?
        `);

        const rows = stmt.all(limit) as any[];

        return rows.map(row => {
            const summaryData = JSON.parse(row.summary_json || '{}');

        // Formata a string de duração se necessário, mas tipicamente armazenamos em ms
        // Vamos recriar a string 'duration' "MM:SS" a partir de duration_ms
            const minutes = Math.floor(row.duration_ms / 60000);
            const seconds = Math.floor((row.duration_ms % 60000) / 1000);
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            return {
                id: row.id,
                title: row.title,
                date: row.created_at, // Uso o stored ISO string
                duration: durationStr,
                summary: summaryData.legacySummary || '',
                detailedSummary: summaryData.detailedSummary,
                calendarEventId: row.calendar_event_id,
                source: row.source as any,
                summaryStatus: row.summary_status as SummaryStatus | undefined,
                // Não carregamos o transcript/usage completo para a visão da lista, para manter leve
                transcript: [] as any[],
                usage: [] as any[]
            };
        });
    }

    public getMeetingDetails(id: string): Meeting | null {
        if (!this.db) return null;

        const meetingStmt = this.db.prepare('SELECT * FROM meetings WHERE id = ?');
        const meetingRow = meetingStmt.get(id) as any;

        if (!meetingRow) return null;

        // Obtém Transcript
        const transcriptStmt = this.db.prepare('SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY timestamp_ms ASC');
        const transcriptRows = transcriptStmt.all(id) as any[];

        // Obtém Usage
        const usageStmt = this.db.prepare('SELECT * FROM ai_interactions WHERE meeting_id = ? ORDER BY timestamp ASC');
        const usageRows = usageStmt.all(id) as any[];

        // Reconstruct
        const summaryData = JSON.parse(meetingRow.summary_json || '{}');
        const minutes = Math.floor(meetingRow.duration_ms / 60000);
        const seconds = Math.floor((meetingRow.duration_ms % 60000) / 1000);
        const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const transcript = transcriptRows.map(row => ({
            speaker: row.speaker,
            text: row.content,
            timestamp: row.timestamp_ms
        }));

        const usage = usageRows.map(row => {
            let items: string[] | undefined;
            let answer = row.ai_response;

            if (row.metadata_json) {
                try {
                    const parsed = JSON.parse(row.metadata_json);
                    if (Array.isArray(parsed)) {
                        items = parsed;
                        // Special case: para 'followup_questions', earlier we treated 'answer' como o array em memory
                        // UI expects appropriate fcampo If tipo é 'followup_questions', geralmente answer é nulo e items tem o questions.
                    }
                } catch (e) { console.warn('[DatabaseManager] Failed to parse metadata_json for interaction:', row?.id, e); }
            }

            return {
                type: row.type,
                timestamp: row.timestamp,
                question: row.user_query,
                answer: answer,
                items: items
            };
        });

        return {
            id: meetingRow.id,
            title: meetingRow.title,
            date: meetingRow.created_at,
            duration: durationStr,
            summary: summaryData.legacySummary || '',
            detailedSummary: summaryData.detailedSummary,
            calendarEventId: meetingRow.calendar_event_id,
            source: meetingRow.source,
            summaryStatus: meetingRow.summary_status as SummaryStatus | undefined,
            transcript: transcript,
            usage: usage
        };
    }

    public deleteMeeting(id: string): boolean {
        if (!this.db) return false;

        try {
            const stmt = this.db.prepare('DELETE FROM meetings WHERE id = ?');
            const info = stmt.run(id);
            console.log(`[DatabaseManager] Deleted meeting ${id}. Changes: ${info.changes}`);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to delete meeting ${id}:`, error);
            return false;
        }
    }

    public getUnprocessedMeetings(): Meeting[] {
        if (!this.db) return [];

        // is_processed = 0 significa false
        const stmt = this.db.prepare(`
            SELECT * FROM meetings
            WHERE is_processed = 0
            ORDER BY created_at DESC
        `);

        const rows = stmt.all() as any[];

        return rows.map(row => {                // Reconstrói objeto mínimo da reunião para processamento
            // Precisamos principalmente do ID para buscar transcripts depois
            const summaryData = JSON.parse(row.summary_json || '{}');
            const minutes = Math.floor(row.duration_ms / 60000);
            const seconds = Math.floor((row.duration_ms % 60000) / 1000);
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            return {
                id: row.id,
                title: row.title,
                date: row.created_at,
                duration: durationStr,
                summary: summaryData.legacySummary || '',
                detailedSummary: summaryData.detailedSummary,
                calendarEventId: row.calendar_event_id,
                source: row.source,
                isProcessed: false,
                summaryStatus: row.summary_status as SummaryStatus | undefined,
                transcript: [] as any[], // Buscado separadamente via getMeetingDetails ou manualmente se necessário
                usage: [] as any[]
            };
        });
    }

    public clearAllData(): boolean {
        if (!this.db) return false;

        try {
            // Limpa todos tables atomically (ordenar matters due para foreign keys,
            // mas SQLite gerencia cascades). Using a transação garante we nunca
            // termina para cima em a half-cleared estado se one statement fails.
            this.db.transaction(() => {
                this.db!.exec('DELETE FROM embedding_queue');
                this.db!.exec('DELETE FROM chunk_summaries');
                this.db!.exec('DELETE FROM chunks');
                this.db!.exec('DELETE FROM ai_interactions');
                this.db!.exec('DELETE FROM transcripts');
                this.db!.exec('DELETE FROM meetings');
            })();

            console.log('[DatabaseManager] All data cleared from database.');
            return true;
        } catch (error) {
            console.error('[DatabaseManager] Failed to clear all data:', error);
            return false;
        }
    }

    public seedDemoMeeting() {
        if (!this.db) return;

        // Verifica se demo meeting já exists
        const existing = this.db.prepare('SELECT id FROM meetings WHERE id = ?').get('demo-meeting');
        if (existing) {
            console.log('[DatabaseManager] Demonstração meeting already exists, skipping seed.');
            return;
        }

        // NÃO limpar todas as reuniões. Preservar dados do usuário é crítico.
        // Se realmente precisarmos limpar dados antigos de demonstração, devemos excluir apenas esse ID.
        // this.deleteMeeting('demo-meeting'); // Segurança opcional se quiséssemos forçar atualização

        const demoId = 'demo-meeting';

        // Define a dados para hoje às 9:30
        const today = new Date();
        today.setHours(9, 30, 0, 0);

        const durationMs = 300000; // 5 min

        const summaryMarkdown = `# Overview

Refract is a real-time AI meeting assistant designed to help you stay focused, informed, and fast-moving during calls. Get live insights while you speak, instant answers to questions, and structured notes after every meeting.

# Getting Started

### Start a Session
Click **Start Session** from the dashboard.
Join a scheduled meeting and start directly from the meeting notification.

### During a Meeting
- Use the **five quick action buttons** for real-time assistance
- Show or hide Refract at any time:
  - **Mac**: Cmd + B
  - **Windows**: Ctrl + B
- Move the widget anywhere on your screen by hovering over the top pill and dragging

# Main Features

## Five Quick Action Buttons
- **What to answer**: Instantly generates a context-aware response to the current topic.
- **Clarify**: Asks a targeted, senior-level clarifying question to establish constraints.
- **Recap**: Generates a comprehensive summary of the conversation so far.
- **Follow Up Question**: Suggests strategic questions you can ask to drive the conversation.
- **Answer**: Manually trigger a response or use voice input to ask specific questions.

## Meeting Insights (Launcher)
- **Smart Note Taking**: Automatically captures key points, action items, and structured summaries.
- **Summary**: A concise high-level brief of the entire meeting.
- **Transcript**: Full real-time speech-to-text transcript, available during and after the call.
- **Usage**: Track your interaction history and see how Refract assisted you.

## Live Insights
Click **Live Insights** during a call to view:
- Real-time questions and prompts
- Detected keywords and topics
- Context-aware suggestions based on the conversation
- Click any insight to get an instant response.

## AI Chat
- Type your question and press **Enter** or click **Submit**
- Enable **Smart Mode** for advanced reasoning and coding assistance

## Screenshots
- **Full Screen Screenshot**: Cmd + H
- **Selective Screenshot**: Cmd + Shift + H

# Making the Most of Refract

### Custom Context
Upload resumes, project briefs, sales scripts, or other documents to tailor responses to your workflow. (coming soon).

### Language Preferences
Go to **Settings → Language Preferences** to:
- Change input and output language
- Enable real-time translation during calls

### Undetectability
Unlock the **Undetectability** add-on to keep Refract invisible during screen sharing.

# Interface Basics

- **Dashboard**: Start meetings and view recent activity
- **Start Session**: Begin a new meeting instantly
- **Settings**: Configure API keys, language, and visibility
- **History**: Review past meetings, notes, and transcripts

# API Setup

1. Open **Settings**
2. Scroll to **Credentials**
3. Add your API keys:
   - **Gemini**
   - **Groq**
4. To enable real-time transcription, select the location of your **Google Cloud service account JSON file**.

If you don’t already have one, follow the steps below to create it.

# Creating a Google Speech-to-Text Service Account

## 1. Create or Select a Project
- Open **Google Cloud Console**
- Create a new project or select an existing one
- Ensure billing is enabled

## 2. Enable Speech-to-Text API
- Go to **APIs & Services → Library**
- Enable **Speech-to-Text API**

## 3. Create a Service Account
- Navigate to **IAM & Admin → Service Accounts**
- Click **Create Service Account**
- **Name**: refract-stt
- **Description**: optional

## 4. Assign Permissions
- Grant the following role: **Speech-to-Text User** (\`roles/speech.client\`)

## 5. Create a JSON Key
- Open the service account
- Go to **Keys → Add Key → Create new key**
- Select **JSON**
- Download the file

**Once downloaded, retornar para Settings → Credentials in Refract e selecionar isso file para completo setup.**

# Free Google Cloud Credit (New Users)

New Google Cloud accounts receive **$300 in free credits**, valid for 90 days.

To activate:
1. Visit [cloud.google.com](https://cloud.google.com)
2. Click **Get started for free**
3. Sign in with a Google account
4. Add billing details (card required)
5. Activate the free trial

The credit can be used for Speech-to-Text and is sufficient for extended testing and regular usage.

# Support

If you need help with setup or usage, contact us anytime at:
refract.contact@gmail.com`;

        const demoMeeting: Meeting = {
            id: demoId,
            title: "Refract Demonstração & Guide",
            date: today.toISOString(),
            duration: "5:00",
            summary: "Complete guide to using Refract - your real-time AI meeting assistant.",
            detailedSummary: {
                overview: summaryMarkdown,
                actionItems: [],
                keyPoints: []
            },
            transcript: [
                { speaker: 'interviewer', text: "Welcome to Refract! Let me show you how it works.", timestamp: 0 },
                { speaker: 'user', text: "Thanks! I'm excited to try it out.", timestamp: 5000 },
                { speaker: 'interviewer', text: "You have 5 quick action buttons. 'What to answer' listens to the conversation and suggests what you should say.", timestamp: 10000 },
                { speaker: 'user', text: "That sounds helpful for interviews.", timestamp: 18000 },
                { speaker: 'interviewer', text: "Check out the 'How to Use' section in the notes for API setup instructions.", timestamp: 20000 },
                { speaker: 'interviewer', text: "'Clarify' asks a targeted question to get missing constraints. 'Recap' summarizes the entire conversation so far.", timestamp: 22000 },
                { speaker: 'user', text: "What about the other buttons?", timestamp: 30000 },
                { speaker: 'interviewer', text: "'Follow Up Questions' suggests questions you can ask. 'Answer' lets you speak a question and get an instant response.", timestamp: 35000 },
                { speaker: 'user', text: "Can I take screenshots during calls?", timestamp: 45000 },
                { speaker: 'interviewer', text: "Yes! Press Cmd+H for full screen or Cmd+Shift+H to select an area. The AI will analyze it and help you.", timestamp: 50000 },
                { speaker: 'user', text: "How do I hide Refract during screen share?", timestamp: 60000 },
                { speaker: 'interviewer', text: "Press Cmd+B to toggle visibility anytime. You can also enable undetectable mode in settings.", timestamp: 65000 },
                { speaker: 'user', text: "This is amazing. What happens after the call?", timestamp: 75000 },
                { speaker: 'interviewer', text: "You get detailed meeting notes with action items, key points, full transcript, and a log of all AI interactions.", timestamp: 80000 }
            ],
            usage: [
                { type: 'assist', timestamp: 15000, question: 'What features does Refract have?', answer: 'Refract offers 5 quick action buttons, screenshot analysis, real-time transcription, and comprehensive meeting notes.' },
                { type: 'followup', timestamp: 40000, question: 'How do the action buttons work?', answer: 'Each button serves a specific purpose: suggest answers, clarify questions, recap conversations, generate follow-up questions, or get instant voice-to-answer responses.' }
            ],
            isProcessed: true
        };

        this.saveMeeting(demoMeeting, today.getTime(), durationMs);
        console.log('[DatabaseManager] Seeded demo meeting.');
    }

    /**
     * Otimiza o banco de dados liberando espaço não utilizado no disco.
     * Sofisticação de nível Enterprise para manter a performance de I/O no topo.
     */
    public vacuum(): boolean {
        if (!this.db) return false;
        try {
            this.db.exec('VACUUM');
            console.log('[DatabaseManager] Database vacuumed successfully.');
            return true;
        } catch (error) {
            console.error('[DatabaseManager] Failed to vacuum database:', error);
            return false;
        }
    }

    /**
     * Otimiza o query planner do banco para consultas mais rápidas.
     * Cluely do Vale do Silício não tem chance com essas micro-otimizações.
     */
    public optimize(): boolean {
        if (!this.db) return false;
        try {
            this.db.exec('PRAGMA optimize');
            console.log('[DatabaseManager] Database optimized successfully.');
            return true;
        } catch (error) {
            console.error('[DatabaseManager] Failed to optimize database:', error);
            return false;
        }
    }

    // ============================================
    // Replica Sessions (Interview Coach)
    // ============================================

    public createReplicaSession(
        id: string,
        modeType: string,
        language: string,
        title: string = '',
    ): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO replica_sessions (id, mode_type, language, title, questions_json, created_at)
                VALUES (?, ?, ?, ?, '[]', datetime('now'))
            `).run(id, modeType, language, title);
        } catch (e) {
            console.error('[DatabaseManager] Failed to create replica session:', e);
        }
    }

    public appendReplicaQuestion(
        sessionId: string,
        question: {
            question: string;
            difficulty: string;
            category: string;
            userAnswer: string;
            feedback: string;
        },
    ): void {
        if (!this.db) return;
        try {
            const row = this.db.prepare('SELECT questions_json FROM replica_sessions WHERE id = ?').get(sessionId) as { questions_json: string } | undefined;
            const questions = row ? JSON.parse(row.questions_json || '[]') : [];
            questions.push(question);
            this.db.prepare('UPDATE replica_sessions SET questions_json = ? WHERE id = ?').run(JSON.stringify(questions), sessionId);
        } catch (e) {
            console.error('[DatabaseManager] Failed to append replica question:', e);
        }
    }

    public finalizeReplicaSession(
        sessionId: string,
        evaluation: { score: number; grade: string; summary: string; strengths: string[]; improvements: string[] },
        durationMs: number,
    ): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                UPDATE replica_sessions
                SET evaluation_json = ?, score = ?, grade = ?, duration_ms = ?
                WHERE id = ?
            `).run(
                JSON.stringify(evaluation),
                evaluation.score,
                evaluation.grade,
                durationMs,
                sessionId,
            );
        } catch (e) {
            console.error('[DatabaseManager] Failed to finalize replica session:', e);
        }
    }

    public getReplicaSessions(limit: number = 50): Array<{
        id: string;
        mode_type: string;
        language: string;
        title: string;
        score: number | null;
        grade: string | null;
        duration_ms: number | null;
        created_at: string;
    }> {
        if (!this.db) return [];
        try {
            return this.db.prepare(`
                SELECT id, mode_type, language, title, score, grade, duration_ms, created_at
                FROM replica_sessions
                ORDER BY created_at DESC
                LIMIT ?
            `).all(limit) as any;
        } catch (e) {
            console.error('[DatabaseManager] Failed to get replica sessions:', e);
            return [];
        }
    }

    public getReplicaSessionDetail(sessionId: string): {
        id: string;
        mode_type: string;
        language: string;
        title: string;
        questions_json: string;
        evaluation_json: string | null;
        score: number | null;
        grade: string | null;
        duration_ms: number | null;
        created_at: string;
    } | null {
        if (!this.db) return null;
        try {
            const row = this.db.prepare(`
                SELECT id, mode_type, language, title, questions_json, evaluation_json, score, grade, duration_ms, created_at
                FROM replica_sessions
                WHERE id = ?
            `).get(sessionId) as any;
            return row ?? null;
        } catch (e) {
            console.error('[DatabaseManager] Failed to get replica session detail:', e);
            return null;
        }
    }

    public deleteReplicaSession(sessionId: string): boolean {
        if (!this.db) return false;
        try {
            const result = this.db.prepare('DELETE FROM replica_sessions WHERE id = ?').run(sessionId);
            return result.changes > 0;
        } catch (e) {
            console.error('[DatabaseManager] Failed to delete replica session:', e);
            return false;
        }
    }
}
