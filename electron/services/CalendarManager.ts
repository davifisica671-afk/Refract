import { app, safeStorage, shell, net } from 'electron';
import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

// Configuração
// GOOGLE_CLIENT_SECRET é intentionally Não referenced aqui — o desktop app
// apenas precisa o (non-secret) cliente ID para construct o auth URL. Token
// exchange e atualiza são proxied através refract-api, que holds o secret.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "YOUR_CLIENT_ID_HERE";
const REDIRECT_URI = "http://localhost:11111/auth/callback";
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
const TOKEN_PATH = path.join(app.getPath('userData'), 'calendar_tokens.enc');
// Base URL para o refract-api pproxy Sobrescrever com REFRACT_API_URL para local dev
// (e.g. http://localhost:3000). Trailing slash é stripped para keep rotea concat clean.
const REFRACT_API_URL = (process.env.REFRACT_API_URL || 'https://api.refract.software').replace(/\/+$/, '');

if (GOOGLE_CLIENT_ID === "YOUR_CLIENT_ID_HERE") {
    console.warn('[CalendarManager] GOOGLE_CLIENT_ID is using the default placeholder. Calendar features will not work until a valid client ID is provided via env var or build config.');
}

export interface CalendarAttendee {
    email: string;
    name?: string;
    photoUrl?: string;
    response?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

export interface CalendarEvent {
    id: string;
    title: string;
    startTime: string; // ISO
    endTime: string; // ISO
    link?: string;
    source: 'google';
    attendees?: CalendarAttendee[];
}

export class CalendarManager extends EventEmitter {
    private static instance: CalendarManager;
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private expiryDate: number | null = null;
    private isConnected: boolean = false;
    private updateInterval: NodeJS.Timeout | null = null;

    private constructor() {
        super();
        // Tokens loaded em init() para garante safeStorage é ready
    }

    public static getInstance(): CalendarManager {
        if (!CalendarManager.instance) {
            CalendarManager.instance = new CalendarManager();
        }
        return CalendarManager.instance;
    }

    public init() {
        this.loadTokens();
    }

    // =========================================================================
    // Auth Flow
    // =========================================================================

    public async startAuthFlow(): Promise<void> {
        // Refuse para inicia se o cliente ID isn't configured — caso contrário we'd
        // abrir a Google página que says "OAuth cliente não found", o user
        // nunca hits o ccallback e o loopback servidor abaixo leaks.
        if (GOOGLE_CLIENT_ID === "YOUR_CLIENT_ID_HERE") {
            throw new Error('GOOGLE_CLIENT_ID is not configured. Set it in .env and restart the app.');
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                try { server.close(); } catch { }
                clearTimeout(timeout);
                fn();
            };

            // 1. Cria Loopback Servidor
            const server = http.createServer(async (req, res) => {
                try {
                    if (req.url?.startsWith('/auth/callback')) {
                        const qs = new url.URL(req.url, 'http://localhost:11111').searchParams;
                        const code = qs.get('code');
                        const error = qs.get('error');

                        if (error) {
                            res.end('Authentication failed! You can close this window.');
                            finish(() => reject(new Error(error)));
                            return;
                        }

                        if (code) {
                            res.end('Authentication successful! You can close this window and return to Refract.');
                            // Exchange código para tokens. If isso throws, ainda finaliza então o servidor cfecha
                            try {
                                await this.exchangeCodeForToken(code);
                                finish(() => resolve());
                            } catch (err) {
                                finish(() => reject(err));
                            }
                        }
                    }
                } catch (err) {
                    res.end('Authentication error.');
                    finish(() => reject(err));
                }
            });

            // 5-minute hard tempo limite — se o user nunca completa consent, liberar o port.
            const timeout = setTimeout(() => {
                finish(() => reject(new Error('Calendar auth timed out — port released.')));
            }, 5 * 60 * 1000);

            server.listen(11111, () => {
                // 3. Abrir Browser
                const authUrl = this.getAuthUrl();
                shell.openExternal(authUrl);
            });

            server.on('error', (err) => {
                finish(() => reject(err));
            });
        });
    }

    public async disconnect(): Promise<void> {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiryDate = null;
        this.isConnected = false;

        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }

        this.emit('connection-changed', false);
    }

    public getConnectionStatus(): { connected: boolean; email?: string, lastSync?: number } {
        // Não armazenamos email nos tokens geralmente, mas poderíamos buscá-lo.
        // Para nagora simpler bbooleano
        return { connected: this.isConnected };
    }

    private getAuthUrl(): string {
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: SCOPES.join(' '),
            access_type: 'offline', // Para atualiza token
            prompt: 'consent' // Force prompts to garante we obtém atualiza token
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    private async exchangeCodeForToken(code: string) {
        try {
            // Proxied através refract-api então GOOGLE_CLIENT_SECRET nunca ships em o desktop app.
            // Busca (vs. axios) então isso chamar shares o global keep-alive pool com todo outro
            // requisição para api.refract.software e exposes o mesmo erro shape (res.ok / res.status)
            // como o rest de o codebase.
            const response = await fetch(`${REFRACT_API_URL}/api/calendar/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
                signal: AbortSignal.timeout(15_000),
            });

            if (!response.ok) {
                const errBody = await response.json().catch(() => ({} as any));
                throw new Error(`exchange_failed status=${response.status} ${(errBody as any).error || ''}`.trim());
            }

            const data = await response.json();
            this.handleTokenResponse(data);
        } catch (error) {
            console.error('[CalendarManager] Token exchange failed:', error);
            throw error;
        }
    }

    // =========================================================================
    // Atualiza Logic (NEW)
    // =========================================================================

    public async refreshState(): Promise<void> {
        console.log('[CalendarManager] Refreshing state (Reality Reconciliation)...');

        // 1. Reinicia Soft Heuristics
        // Limpa existing reminder timeouts para prevenir Duplo scheduling ou stale alerts
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        // 2. Calendar Re-sync & Temporal Re-evaluation
        if (this.isConnected) {
            // Force busca vai também re-schedule reminders based em NEW time
            await this.getUpcomingEvents(true);
        } else {
            console.log('[CalendarManager] Calendar not connected, skipping fetch.');
        }

        // 3. Emitir atualiza para UI
        // We emitir 'updated' então o frontend knows para re-fetch via getUpcomingEvents
        // ou we poderia push o data. geralmente ipcHandlers apenas chamar getUpcomingEvents.
        this.emit('events-updated');
    }

    private handleTokenResponse(data: any) {
        this.accessToken = data.access_token;
        if (data.refresh_token) {
            this.refreshToken = data.refresh_token; // Apenas returned em primeiro consent
        }
        this.expiryDate = Date.now() + (data.expires_in * 1000);
        this.isConnected = true;
        this.saveTokens();
        this.emit('connection-changed', true);

        // Initial busca
        this.fetchUpcomingEvents();
    }

    private async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        try {
            // Proxied através refract-api então GOOGLE_CLIENT_SECRET nunca ships em o desktop app.
            const response = await fetch(`${REFRACT_API_URL}/api/calendar/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: this.refreshToken }),
                signal: AbortSignal.timeout(15_000),
            });

            if (!response.ok) {
                const errBody = await response.json().catch(() => ({} as any));
                throw new Error(`refresh_failed status=${response.status} ${(errBody as any).error || ''}`.trim());
            }

            const data = await response.json();
            this.handleTokenResponse(data);
        } catch (error) {
            console.error('[CalendarManager] Token refresh failed:', error);
            // If atualiza fails (e.g. revoked), desconectar
            this.disconnect();
        }
    }

    // =========================================================================
    // Token Storage (Encrypted)
    // =========================================================================

    private saveTokens() {
        if (!safeStorage.isEncryptionAvailable()) {
            console.warn('[CalendarManager] Encryption not available, skipping token save');
            return;
        }

        const data = JSON.stringify({
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiryDate: this.expiryDate
        });

        const encrypted = safeStorage.encryptString(data);
        const tmpPath = TOKEN_PATH + '.tmp';
        fs.writeFileSync(tmpPath, encrypted);
        fs.renameSync(tmpPath, TOKEN_PATH);
    }

    private loadTokens() {
        if (!fs.existsSync(TOKEN_PATH)) return;

        try {
            if (!safeStorage.isEncryptionAvailable()) return;

            const encrypted = fs.readFileSync(TOKEN_PATH);
            const decrypted = safeStorage.decryptString(encrypted);
            const data = JSON.parse(decrypted);

            this.accessToken = data.accessToken;
            this.refreshToken = data.refreshToken;
            this.expiryDate = data.expiryDate;

            if (this.accessToken && this.refreshToken) {
                this.isConnected = true;
                // Verifica expiry
                if (this.expiryDate && Date.now() >= this.expiryDate) {
                    this.refreshAccessToken();
                }
            }
        } catch (error) {
            console.error('[CalendarManager] Failed to load tokens:', error);
        }
    }

    // =========================================================================
    // Reminders
    // =========================================================================

    private reminderTimeouts: NodeJS.Timeout[] = [];

    private scheduleReminders(events: CalendarEvent[]) {
        // Limpa existing
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        const now = Date.now();

        events.forEach(event => {
            const startStr = event.startTime;
            if (!startStr) return;

            const startTime = new Date(startStr).getTime();
            // Reminder time: 2 minutes antes
            const reminderTime = startTime - (2 * 60 * 1000);

            if (reminderTime > now) {
                const delay = reminderTime - now;
                // Apenas agendar se dentro de próximo 24h (que busca já limits)
                if (delay < 24 * 60 * 60 * 1000) {
                    const timeout = setTimeout(() => {
                        this.showNotification(event);
                    }, delay);
                    this.reminderTimeouts.push(timeout);
                }
            }
        });
    }

    private showNotification(event: CalendarEvent) {
        const { Notification } = require('electron');
        const notif = new Notification({
            title: 'Meeting starting soon',
            body: `"${event.title}" starts in 2 minutes. Start Refract?`,
            actions: [
                { type: 'button', text: 'Start Meeting' },
                { type: 'button', text: 'Dismiss' }
            ],
            sound: true
        });

        notif.on('action', (event_unused: any, index: number) => {
            if (index === 0) {
                // Inicia Meeting
                // We precisa para tell o principal processo para abrir janela e inicia meeting
                // Ideally we emitir an evento que AppState ouve to
                this.emit('start-meeting-requested', event);
            }
        });

        notif.on('click', () => {
            // Apenas abrir window
            this.emit('open-requested');
        });

        notif.show();
    }

    // =========================================================================
    // Busca Logic
    // =========================================================================

    public async getUpcomingEvents(force: boolean = false): Promise<CalendarEvent[]> {
        if (!this.isConnected || !this.accessToken) return [];

        // Verifica expiry
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }

        const events = await this.fetchEventsInternal();
        this.scheduleReminders(events);
        return events;
    }

    private async fetchEventsInternal(): Promise<CalendarEvent[]> {
        if (!this.accessToken) return [];

        const now = new Date();
        const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        try {
            const params = new URLSearchParams({
                timeMin: now.toISOString(),
                timeMax: horizon.toISOString(),
                singleEvents: 'true',
                orderBy: 'startTime',
                maxResults: '50',
            });
            const response = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
                {
                    headers: { Authorization: `Bearer ${this.accessToken}` },
                    signal: AbortSignal.timeout(15_000),
                }
            );
            if (!response.ok) {
                console.error(`[CalendarManager] Google Calendar fetch failed: HTTP ${response.status}`);
                return [];
            }
            const data = await response.json() as any;
            const items = data.items || [];
            console.log(`[CalendarManager] Google returned ${items.length} raw items in next 7 days`);

            const filtered = items
                .filter((item: any) => {
                    // FFiltrar >= 5 mins, não all-day
                    if (!item.start.dateTime || !item.end.dateTime) return false; // All-day events ter .date em vez disso de .dateTime

                    const start = new Date(item.start.dateTime).getTime();
                    const end = new Date(item.end.dateTime).getTime();
                    const durationMins = (end - start) / 60000;

                    return durationMins >= 5;
                });

            console.log(`[CalendarManager] After filtering (timed, >=5min): ${filtered.length} events`);

            return filtered
                .map((item: any) => ({
                    id: item.id,
                    title: item.summary || '(No Title)',
                    startTime: item.start.dateTime,
                    endTime: item.end.dateTime,
                    link: this.resolveMeetingLink(item),
                    source: 'google' as const,
                    attendees: Array.isArray(item.attendees)
                        ? item.attendees
                            .filter((a: any) => !a.self && !a.resource && a.email)
                            .slice(0, 8)
                            .map((a: any) => ({
                                email: a.email,
                                name: a.displayName,
                                response: a.responseStatus,
                            }))
                        : undefined,
                }));

        } catch (error) {
            console.error('[CalendarManager] Failed to fetch events:', error);
            return [];
        }
    }

    // Intelligent Linkar Extraction
    private resolveMeetingLink(item: any): string | undefined {
        // 1. Prefer explicit Hangout linkar (Google Meet) se valid
        if (item.hangoutLink) return item.hangoutLink;

        // 2. Analisa description para outro providers
        if (!item.description) return undefined;

        return this.extractMeetingLink(item.description);
    }

    private extractMeetingLink(description: string): string | undefined {
        // Regex para comum meeting providers
        // Matches zoom.us, teams.microsoft.com, meet.google.com, webex.com
        const providerRegex = /(https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)\/[^\s<>"']+)/gi;

        const matches = description.match(providerRegex);
        if (matches && matches.length > 0) {
            // Deduplicate
            const unique = [...new Set(matches)];
            // Retorna o primeiro válido provedor linkar
            return unique[0];
        }

        // Fallback: Generic URL (menos strict, mas riskier)
        // const genericUrlRegex = /(https?:\/\/[^\s<>"']+)/g;
        // ... avoided para prevenir picking para cima random links como "docs.google.com"

        return undefined;
    }

    // Background fetcher poderia go aqui se needed
    public async fetchUpcomingEvents() {
        // wrapper para apenas cache ou acionar atualiza
        return this.getUpcomingEvents();
    }
}
