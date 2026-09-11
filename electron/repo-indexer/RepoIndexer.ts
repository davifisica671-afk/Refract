import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import { VectorStore } from '../rag/VectorStore';
import { EmbeddingPipeline } from '../rag/EmbeddingPipeline';
import { RAGRetriever } from '../rag/RAGRetriever';
import { isIntelligenceFlagEnabled } from '../intelligence/intelligenceFlags';
import {
  REPO_SCAN_MAX_FILES,
  REPO_SCAN_MAX_FILE_BYTES,
  REPO_SCAN_MAX_TOTAL_BYTES,
} from './repoPathPolicy';

export { validateRepoPath } from './repoPathPolicy';

interface RepoFile {
  path: string;
  content: string;
  language: string;
}

export class RepoIndexer {
  private vectorStore: VectorStore;
  private embeddingPipeline: EmbeddingPipeline;
  private retriever: RAGRetriever;
  private repoPath: string;
  private ignoreFilter: ReturnType<typeof ignore>;

  constructor(config: { repoPath: string; db: any; dbPath: string; extPath: string }) {
    this.repoPath = config.repoPath;
    this.vectorStore = new VectorStore(config.db, config.dbPath, config.extPath);
    this.embeddingPipeline = new EmbeddingPipeline(config.db, this.vectorStore);
    this.retriever = new RAGRetriever(this.vectorStore, this.embeddingPipeline);
    this.ignoreFilter = ignore().add([
      'node_modules', '.git', 'dist', 'build', '.next',
      '*.pyc', '__pycache__', '.venv', 'venv',
      '.DS_Store', '*.exe', '*.dll', '*.so', '*.o',
    ]);
    if (fs.existsSync(path.join(config.repoPath, '.gitignore'))) {
      this.ignoreFilter.add(fs.readFileSync(path.join(config.repoPath, '.gitignore'), 'utf-8'));
    }
  }

  isEnabled(): boolean {
    return isIntelligenceFlagEnabled('repoIndexer');
  }

  async scanRepo(): Promise<{ fileCount: number; chunkCount: number }> {
    if (!this.isEnabled()) return { fileCount: 0, chunkCount: 0 };
    const files = this.walkRepo();
    const chunks: any[] = [];
    for (const file of files) {
      const segments = this.chunkFile(file);
      chunks.push(...segments);
    }
    if (chunks.length > 0) {
      await this.vectorStore.saveChunks(chunks);
      await this.embeddingPipeline.processQueue();
    }
    return { fileCount: files.length, chunkCount: chunks.length };
  }

  private walkRepo(): RepoFile[] {
    const results: RepoFile[] = [];
    let totalBytes = 0;
    const walkDir = (dir: string) => {
      if (results.length >= REPO_SCAN_MAX_FILES || totalBytes >= REPO_SCAN_MAX_TOTAL_BYTES) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= REPO_SCAN_MAX_FILES || totalBytes >= REPO_SCAN_MAX_TOTAL_BYTES) return;
        // Symlinks nunca são seguidos: um repo malicioso poderia apontar
        // para fora (ex.: /etc) e vazar arquivos na indexação.
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(this.repoPath, fullPath);
        if (this.ignoreFilter.ignores(relPath)) continue;
        if (entry.isDirectory()) { walkDir(fullPath); continue; }
        const ext = path.extname(entry.name).toLowerCase();
        const lang = this.extToLang(ext);
        if (!lang) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile() || stat.size > REPO_SCAN_MAX_FILE_BYTES) continue;
          if (totalBytes + stat.size > REPO_SCAN_MAX_TOTAL_BYTES) return;
          const content = fs.readFileSync(fullPath, 'utf-8');
          totalBytes += stat.size;
          results.push({ path: relPath, content, language: lang });
        } catch { }
      }
    };
    walkDir(this.repoPath);
    return results;
  }

  private extToLang(ext: string): string | null {
    const map: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
      '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.cpp': 'cpp',
      '.c': 'c', '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp', '.rb': 'ruby',
      '.php': 'php', '.swift': 'swift', '.kt': 'kotlin', '.scala': 'scala',
      '.sql': 'sql', '.r': 'r', '.sh': 'shell', '.bash': 'shell',
      '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json', '.xml': 'xml',
      '.md': 'markdown', '.css': 'css', '.scss': 'scss', '.html': 'html',
    };
    return map[ext] || null;
  }

  private chunkFile(file: RepoFile): any[] {
    const lines = file.content.split('\n');
    const maxLines = 100;
    const chunks: any[] = [];
    for (let i = 0; i < lines.length; i += maxLines) {
      const chunkLines = lines.slice(i, i + maxLines);
      chunks.push({
        id: `${file.path}:${i + 1}`,
        content: chunkLines.join('\n'),
        metadata: { filePath: file.path, language: file.language, startLine: i + 1, endLine: i + chunkLines.length },
      });
    }
    return chunks;
  }

  async query(query: string, topK = 10): Promise<any[]> {
    try {
      const result = await this.retriever.retrieve(query, { topK, maxTokens: 99999 });
      return (result.chunks || []).map((r: any) => ({
        filePath: r.metadata?.filePath,
        language: r.metadata?.language,
        content: r.content,
        score: r.similarity,
      }));
    } catch {
      return [];
    }
  }

  dispose(): void {
    this.vectorStore.destroy();
  }
}
