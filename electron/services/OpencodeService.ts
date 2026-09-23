// electron/services/OpencodeService.ts
// Local opencode sidecar client (v1 session API + HTTP Basic).
// Credentials stay in opencode; Refract only holds the per-boot sidecar password in memory.

export class OpenCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenCodeError';
  }
}

export interface OpencodeModelRef {
  provider: string;
  model: string;
  label: string;
}

export interface OpencodeServiceOptions {
  baseUrl: string;
  password: string | null;
  timeoutMs?: number;
}

function parseModelRef(ref: string): { providerId: string; modelId: string } {
  const m = /^opencode\/([^/]+)\/(.+)$/.exec(ref.trim());
  if (!m) throw new OpenCodeError(`invalid opencode model ref: ${ref}`);
  return { providerId: m[1], modelId: m[2] };
}

export class OpencodeService {
  private readonly baseUrl: string;
  private readonly password: string | null;
  private readonly timeoutMs: number;

  constructor(opts: OpencodeServiceOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.password = opts.password;
    this.timeoutMs = opts.timeoutMs ?? 60000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.password) h['Authorization'] = `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`;
    return h;
  }

  private async req(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...init?.headers },
      signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await this.req('/global/health', { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;
      const data = (await res.json()) as { healthy?: boolean };
      return data.healthy === true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<OpencodeModelRef[]> {
    const res = await this.req('/provider', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new OpenCodeError(`provider list failed: ${res.status}`);
    const data = (await res.json()) as {
      default?: Record<string, string>;
      connected?: string[];
    };
    const connected = new Set(data.connected ?? []);
    return Object.entries(data.default ?? {})
      .filter(([providerId]) => connected.has(providerId))
      .map(([providerId, modelId]) => ({ provider: providerId, model: modelId, label: `${providerId}/${modelId}` }));
  }

  async chat(prompt: string, modelRef: string, opts: { timeoutMs?: number } = {}): Promise<string> {
    if (!prompt.trim()) throw new OpenCodeError('prompt required');
    const { providerId, modelId } = parseModelRef(modelRef);
    if (prompt.length > 200 * 1024) throw new OpenCodeError('prompt exceeds 200 KB limit');
    const timeout = opts.timeoutMs ?? this.timeoutMs;
    const created = await this.req('/session', {
      method: 'POST',
      body: JSON.stringify({ title: 'Refract' }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!created.ok) throw new OpenCodeError(`session create failed: ${created.status}`);
    const session = (await created.json()) as { id: string };
    try {
      const replied = await this.req(`/session/${session.id}/message`, {
        method: 'POST',
        body: JSON.stringify({
          agent: 'build',
          model: { providerID: providerId, modelID: modelId },
          parts: [{ type: 'text', text: prompt }],
        }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!replied.ok) throw new OpenCodeError(`prompt failed: ${replied.status}`);
      const data = (await replied.json()) as { parts?: Array<{ type?: string; text?: string }> };
      return (data.parts ?? [])
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n');
    } finally {
      await this.req(`/session/${session.id}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
    }
  }
}
