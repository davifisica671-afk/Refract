// electron/services/OpencodeService.ts
// Integração com OpenCode — delega tarefas de código ao agente opencode local

export interface OpencodeSession {
  id: string;
  title?: string;
}

export interface OpencodeResult {
  success: boolean;
  output?: string;
  error?: string;
  sessionId?: string;
}

export class OpencodeService {
  private baseUrl: string;
  private connected = false;
  private sessionPool: Map<string, string> = new Map(); // tarefa -> sessionId

  constructor(hostname = '127.0.0.1', port = 4096) {
    this.baseUrl = `http://${hostname}:${port}`;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;
      const data = await res.json();
      this.connected = data.healthy === true;
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listSessions(): Promise<OpencodeSession[]> {
    const res = await this.fetch('/session');
    if (!res.ok) return [];
    return res.json();
  }

  async createSession(title?: string): Promise<OpencodeSession | null> {
    const res = await this.fetch('/session', {
      method: 'POST',
      body: JSON.stringify({ title: title || 'Refract Code Task' }),
    });
    if (!res.ok) return null;
    return res.json();
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<string> {
    const res = await this.fetch(`/session/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({
        parts: [{ type: 'text', text: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Opencode prompt failed: ${res.statusText}`);
    const data = await res.json();
    // Extrair texto de resposta parts
    const parts: any[] = data.parts || [];
    return parts
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('\n');
  }

  async executeTask(task: string): Promise<OpencodeResult> {
    try {
      const ok = await this.checkHealth();
      if (!ok) {
        return { success: false, error: 'Opencode server not available. Run `opencode serve` first.' };
      }

      const session = await this.createSession(`Code: ${task.slice(0, 60)}`);
      if (!session) {
        return { success: false, error: 'Failed to create opencode session' };
      }

      this.sessionPool.set(task, session.id);
      const output = await this.sendPrompt(session.id, task);
      return { success: true, output, sessionId: session.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async explainCode(code: string, language: string): Promise<OpencodeResult> {
    return this.executeTask(`Explain this ${language} code:\n\n${code}`);
  }

  async generateCode(description: string, language: string): Promise<OpencodeResult> {
    return this.executeTask(`Generate ${language} code that: ${description}`);
  }

  async reviewCode(code: string, language: string): Promise<OpencodeResult> {
    return this.executeTask(`Review this ${language} code for bugs and issues:\n\n${code}`);
  }

  async searchCode(query: string): Promise<OpencodeResult> {
    return this.executeTask(`Search the codebase for: ${query}`);
  }

  async readFile(filePath: string): Promise<string | null> {
    try {
      const res = await this.fetch(`/file/content?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.content || null;
    } catch {
      return null;
    }
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      signal: init?.signal || AbortSignal.timeout(30000),
    });
  }
}
