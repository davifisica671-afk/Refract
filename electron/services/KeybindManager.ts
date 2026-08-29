import { app, globalShortcut, Menu, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

export interface KeybindConfig {
    id: string;
    label: string;
    accelerator: string; // Electron Accelerator string
    isGlobal: boolean;   // Registered com globalShortcut
    defaultAccelerator: string;
}

export const DEFAULT_KEYBINDS: KeybindConfig[] = [
    // General
    { id: 'general:toggle-visibility', label: 'Toggle Visibility', accelerator: 'CommandOrControl+B', isGlobal: true, defaultAccelerator: 'CommandOrControl+B' },
    { id: 'general:toggle-mouse-passthrough', label: 'Toggle Mouse Passthrough', accelerator: 'CommandOrControl+Shift+B', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+B' },
    { id: 'general:process-screenshots', label: 'Process Screenshots', accelerator: 'CommandOrControl+Enter', isGlobal: true, defaultAccelerator: 'CommandOrControl+Enter' },
    { id: 'general:capture-and-process', label: 'Capture Screen & Ask AI (Global)', accelerator: 'CommandOrControl+Shift+Enter', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Enter' },
    { id: 'general:reset-cancel', label: 'Reset / Cancel', accelerator: 'CommandOrControl+R', isGlobal: true, defaultAccelerator: 'CommandOrControl+R' },
    { id: 'general:take-screenshot', label: 'Take Screenshot', accelerator: 'CommandOrControl+H', isGlobal: true, defaultAccelerator: 'CommandOrControl+H' },
    { id: 'general:selective-screenshot', label: 'Selective Screenshot', accelerator: 'CommandOrControl+Shift+H', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+H' },
    // Capture o ativo browser tab's página contexto via o companion eextensão
    // falls voltar para a screenshot quando não extension/browser é reachable. Works
    // de qualquer focused app (incluindo o Refract overlay), que o old
    // Chrome-owned hotkey poderia nnão See refract-browser/README.md.
    { id: 'general:capture-dom', label: 'Capture Page / Screen (Browser)', accelerator: 'CommandOrControl+Shift+Y', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Y' },

    // Chat - Global shortcuts (work até quando app é não focused - stealth mmodo
    { id: 'chat:whatToAnswer', label: 'What to Answer', accelerator: 'CommandOrControl+1', isGlobal: true, defaultAccelerator: 'CommandOrControl+1' },
    { id: 'chat:clarify', label: 'Clarify', accelerator: 'CommandOrControl+2', isGlobal: true, defaultAccelerator: 'CommandOrControl+2' },
    { id: 'chat:dynamicAction4', label: 'Recap / Brainstorm', accelerator: 'CommandOrControl+3', isGlobal: true, defaultAccelerator: 'CommandOrControl+3' },
    { id: 'chat:followUp', label: 'Follow Up', accelerator: 'CommandOrControl+4', isGlobal: true, defaultAccelerator: 'CommandOrControl+4' },
    { id: 'chat:answer', label: 'Answer / Record', accelerator: 'CommandOrControl+5', isGlobal: true, defaultAccelerator: 'CommandOrControl+5' },
    { id: 'chat:codeHint', label: 'Get Code Hint', accelerator: 'CommandOrControl+6', isGlobal: true, defaultAccelerator: 'CommandOrControl+6' },
    { id: 'chat:brainstorm', label: 'Brainstorm Approaches', accelerator: 'CommandOrControl+7', isGlobal: true, defaultAccelerator: 'CommandOrControl+7' },
    // Rolar shortcuts são global então they work em stealth modo sem o user
    // having para click o Refract janela primeiro (regression fix para issue #233).
    // Cada press kicks an inertial rolar loop em o renderer: a único tap
    // glides ~250ms então decelerates, rapid taps sustain motion. macOS Carbon
    // HotKey API faz não auto-repeat com Cmd held, então inertia what it gives
    // o "hold para srolar feel sem a native chave llistener
    //
    // Horizontal uses Cmd/Ctrl+Alt+Left/Right para avoid colliding com o macOS
    // line-start/line-end caret-jump shortcut que iria caso contrário misfire em
    // todo texto entrada system-wide enquanto Refract é running.
    { id: 'chat:scrollUp', label: 'Scroll Up', accelerator: 'CommandOrControl+Up', isGlobal: true, defaultAccelerator: 'CommandOrControl+Up' },
    { id: 'chat:scrollDown', label: 'Scroll Down', accelerator: 'CommandOrControl+Down', isGlobal: true, defaultAccelerator: 'CommandOrControl+Down' },
    { id: 'chat:scrollLeft', label: 'Scroll Left (code block)', accelerator: 'CommandOrControl+Alt+Left', isGlobal: true, defaultAccelerator: 'CommandOrControl+Alt+Left' },
    { id: 'chat:scrollRight', label: 'Scroll Right (code block)', accelerator: 'CommandOrControl+Alt+Right', isGlobal: true, defaultAccelerator: 'CommandOrControl+Alt+Right' },
    // CommandOrControl+Shift+Space porque bare Cmd+Space é Spotlight em macOS
    // e Ctrl+Space é o IME fonte switcher. O overlay é created com
    // type:'panel' em macOS, então focusing it faz não activate o Refract app —
    // o user's foreground app keeps focar em o dock/menu bar/screen-share.
    { id: 'chat:focusInput', label: 'Toggle Stealth Typing', accelerator: 'CommandOrControl+Shift+Space', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Space' },
    // Language Learning overlay toggle
    { id: 'chat:languageLearning', label: 'Toggle Language Learning', accelerator: 'CommandOrControl+L', isGlobal: true, defaultAccelerator: 'CommandOrControl+L' },

    // Window Movement - Global shortcuts (stealth janela positioning)
    { id: 'window:move-up', label: 'Move Window Up', accelerator: 'CommandOrControl+Shift+Up', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Up' },
    { id: 'window:move-down', label: 'Move Window Down', accelerator: 'CommandOrControl+Shift+Down', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Down' },
    { id: 'window:move-left', label: 'Move Window Left', accelerator: 'CommandOrControl+Shift+Left', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Left' },
    { id: 'window:move-right', label: 'Move Window Right', accelerator: 'CommandOrControl+Shift+Right', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Right' },
];

export class KeybindManager {
    private static instance: KeybindManager;
    private keybinds: Map<string, KeybindConfig> = new Map();
    private filePath: string;
    private windowHelper: any; // Tipo avoided para circular dep, passed em init
    private onUpdateCallbacks: (() => void)[] = [];
    private onShortcutTriggeredCallbacks: ((actionId: string) => void)[] = [];
    private activeMode: 'launcher' | 'overlay' = 'launcher';
    private healthCheckTimer: NodeJS.Timeout | null = null;
    // Como frequentemente para poll que OS-registered shortcuts são ainda alive (ms).
    // 10 s é aggressive enough para recover dentro de one poll cycle após a
    // passthrough talternar sleep/wake, ou workspace strocar
    private static readonly HEALTH_CHECK_INTERVAL_MS = 10_000;

    public setMode(mode: 'launcher' | 'overlay') {
        if (this.activeMode === mode) return;
        this.activeMode = mode;
        console.log(`[KeybindManager] Mode changed to: ${mode}. Refreshing global shortcuts.`);
        this.registerGlobalShortcuts();
    }

    private shouldRegister(actionId: string): boolean {
        if (this.activeMode === 'overlay') return true;

        // Em launcher mmodo registra visibility + movement shortcuts
        if (actionId === 'general:toggle-visibility') return true;
        if (actionId === 'general:toggle-mouse-passthrough') return true;
        if (actionId.startsWith('window:move-')) return true;

        // Screenshot & screen-analyze shortcuts precisa work globally em Ambos modes.
        // Sem these, Cmd+H / Cmd+Shift+H / Cmd+Shift+Enter fazer nada em
        // launcher modo porque globalShortcut.register() é nunca chamado para them.
        // Também fixes o silent rebind failure: re-registration após setKeybind()
        // hit o mesmo gate e dropped o newly bound accelerator ttambém
        if (actionId === 'general:take-screenshot') return true;
        if (actionId === 'general:selective-screenshot') return true;
        if (actionId === 'general:capture-and-process') return true;
        // Browser/page capture precisa work globally em ambos modes (mesmo rationale
        // como o screenshot shortcuts — it's a global capture tracionar
        if (actionId === 'general:capture-dom') return true;

        return false;
    }

    private normalizeAccelerator(acc: string): string {
        if (!acc) return '';
        // Electron accelerators são case-insensitive e order-independent para modifiers.
        // We sdivide lowercase, e ordenar para garante consistent string matching.
        // E.g., 'Shift+CommandOrControl+Up' === 'CommandOrControl+Shift+Up'
        const parts = acc.split('+').map(p => p.trim().toLowerCase());
        parts.sort();
        return parts.join('+');
    }

    private constructor() {
        this.filePath = path.join(app.getPath('userData'), 'keybinds.json');
        this.load();
    }

    public onUpdate(callback: () => void) {
        this.onUpdateCallbacks.push(callback);
    }

    public onShortcutTriggered(callback: (actionId: string) => void) {
        this.onShortcutTriggeredCallbacks.push(callback);
    }

    public static getInstance(): KeybindManager {
        if (!KeybindManager.instance) {
            KeybindManager.instance = new KeybindManager();
        }
        return KeybindManager.instance;
    }

    public setWindowHelper(windowHelper: any) {
        this.windowHelper = windowHelper;
    }

    private load() {
        // 1. Carrega Defaults
        DEFAULT_KEYBINDS.forEach(kb => this.keybinds.set(kb.id, { ...kb }));

        // 2. Carrega Sobrescreve
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));

                // Migrar renamed IDs então saved user customizations survive renames
                const ID_MIGRATIONS: Record<string, string> = {
                    'chat:recap': 'chat:dynamicAction4',
                    'chat:followup': 'chat:followUp',  // casing fix — persisted keybinds.json pode ter old casing
                };
                for (const fileKb of data) {
                    if (ID_MIGRATIONS[fileKb.id]) {
                        fileKb.id = ID_MIGRATIONS[fileKb.id];
                    }
                }

                // Valida e mescla
                let hadConflicts = false;
                for (const fileKb of data) {
                    if (this.keybinds.has(fileKb.id)) {
                        const current = this.keybinds.get(fileKb.id)!;

                        // Deduplicate: If outro keybind é já using isso accelerator, pular ou claro it
                        if (fileKb.accelerator && fileKb.accelerator.trim() !== '') {
                            let conflictId: string | null = null;
                            const normalizedNew = this.normalizeAccelerator(fileKb.accelerator);
                            this.keybinds.forEach((kb, existingId) => {
                                if (existingId !== fileKb.id && this.normalizeAccelerator(kb.accelerator) === normalizedNew) {
                                    conflictId = existingId;
                                }
                            });
                            
                            if (conflictId) {
                                // EC-03 fix: mark que we resolved a conflict então we pode persist abaixo
                                const conflictKb = this.keybinds.get(conflictId)!;
                                conflictKb.accelerator = '';
                                this.keybinds.set(conflictId, conflictKb);
                                hadConflicts = true;
                            }
                        }

                        current.accelerator = fileKb.accelerator;
                        this.keybinds.set(fileKb.id, current);
                    }
                }

                // EC-03 fix: persist resolved conflicts então they são não re-detected em próximo launch
                if (hadConflicts) {
                    this.save();
                }
            }
        } catch (error) {
            console.error('[KeybindManager] Failed to load keybinds:', error);
        }
    }

    private save() {
        try {
            const data = Array.from(this.keybinds.values()).map(kb => ({
                id: kb.id,
                accelerator: kb.accelerator
            }));
            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
            fs.renameSync(tmpPath, this.filePath);
        } catch (error) {
            console.error('[KeybindManager] Failed to save keybinds:', error);
        }
    }

    public getKeybind(id: string): string | undefined {
        return this.keybinds.get(id)?.accelerator;
    }

    public getAllKeybinds(): KeybindConfig[] {
        return Array.from(this.keybinds.values());
    }

    public setKeybind(id: string, accelerator: string) {
        if (!this.keybinds.has(id)) return;

        const currentKb = this.keybinds.get(id)!;
        const oldAccelerator = currentKb.accelerator || '';

        // Fallback: If assigning a novo accelerator, trocar qualquer existing ação using it
        if (accelerator && accelerator.trim() !== '') {
            const normalizedNew = this.normalizeAccelerator(accelerator);
            let swappedId: string | null = null;

            this.keybinds.forEach((kb, existingId) => {
                if (existingId !== id && this.normalizeAccelerator(kb.accelerator) === normalizedNew) {
                    swappedId = existingId;
                }
            });

            if (swappedId) {
                const conflictKb = this.keybinds.get(swappedId)!;
                conflictKb.accelerator = oldAccelerator; // Give o conflicting one nosso old shortcut
                this.keybinds.set(swappedId, conflictKb);
            }
        }

        currentKb.accelerator = accelerator;
        this.keybinds.set(id, currentKb);

        this.save();
        this.registerGlobalShortcuts(); // Re-register if it era a global one
        this.broadcastUpdate();
    }

    public resetKeybinds() {
        this.keybinds.clear();
        DEFAULT_KEYBINDS.forEach(kb => this.keybinds.set(kb.id, { ...kb }));
        this.save();
        this.registerGlobalShortcuts();
        this.broadcastUpdate();
    }

    public registerGlobalShortcuts() {
        globalShortcut.unregisterAll();

        this.keybinds.forEach(kb => {
            if (kb.isGlobal && kb.accelerator && kb.accelerator.trim() !== '') {
                if (!this.shouldRegister(kb.id)) return;

                const acc = kb.accelerator.trim();
                try {
                    globalShortcut.register(acc, () => {
                        this.onShortcutTriggeredCallbacks.forEach(cb => cb(kb.id));
                    });
                    if (globalShortcut.isRegistered(acc)) {
                        console.log(`[KeybindManager] Registered global shortcut: ${acc} -> ${kb.id}`);
                    } else {
                        console.warn(`[KeybindManager] Failed to register global shortcut (likely in use by OS): ${acc}`);
                        // Notifica renderer então o UI pode surface a aviso para o user (issue #136)
                        BrowserWindow.getAllWindows().forEach(win => {
                            if (!win.isDestroyed()) {
                                win.webContents.send('keybinds:registration-failed', { id: kb.id, accelerator: acc });
                            }
                        });
                    }
                } catch (e) {
                    console.error(`[KeybindManager] Exception while registering global shortcut ${acc}:`, e);
                }
            }
        });

        this.updateMenu();

        // (Re-)start o health-check loop então it sempre reflects o current
        // registered define após qualquer completo re-registration.
        this.startHealthCheck();
    }

    /**
     * Surgically re-registers any global shortcuts o OS silently dropped.
     *
     * Unlike registerGlobalShortcuts() isso does NOT chamar unregisterAll() first,
     * so there is nunca a janela where shortcuts are momentarily absent.  It is
     * safe para chamar de o periodic health-check timer ou direita depois a window
     * interaction-policy change (e.g. passthrough toggle).
     */
    public revalidateShortcuts(): void {
        let lost = 0;
        let recovered = 0;

        this.keybinds.forEach(kb => {
            if (!kb.isGlobal || !kb.accelerator || kb.accelerator.trim() === '') return;
            if (!this.shouldRegister(kb.id)) return;

            const acc = kb.accelerator.trim();
            if (globalShortcut.isRegistered(acc)) return; // ainda alive — nada to fazer

            lost++;
            try {
                globalShortcut.register(acc, () => {
                    this.onShortcutTriggeredCallbacks.forEach(cb => cb(kb.id));
                });
                if (globalShortcut.isRegistered(acc)) {
                    recovered++;
                    console.warn(`[KeybindManager] Recovered lost shortcut: ${acc} -> ${kb.id}`);
                } else {
                    console.error(`[KeybindManager] Could not recover shortcut ${acc} -> ${kb.id} (OS conflict?)`);
                }
            } catch (e) {
                console.error(`[KeybindManager] Exception re-registering shortcut ${acc}:`, e);
            }
        });

        if (lost > 0) {
            console.warn(`[KeybindManager] Health check: ${lost} shortcut(s) were dropped by OS, ${recovered} recovered.`);
        }
    }

    /**
     * Starts (or restarts) o periodic shortcut health-check timer.
     * Called automatically at o end of registerGlobalShortcuts() so o timer
     * sempre tracks o most recently registered set.
     */
    private startHealthCheck(): void {
        this.stopHealthCheck();
        this.healthCheckTimer = setInterval(() => {
            this.revalidateShortcuts();
        }, KeybindManager.HEALTH_CHECK_INTERVAL_MS);
        // Permitir o Node.js processo para exit até se isso timer é ainda running.
        if (this.healthCheckTimer.unref) this.healthCheckTimer.unref();
    }

    /** Limpa o health-check interval (chamado antes a completo re-registration). */
    private stopHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    public updateMenu() {
        // Em Windows/Linux, define a minimal menu (para shortcuts como DevTools)
        // mas ocultar o menu barra de o UI
        if (process.platform !== 'darwin') {
            const template: any[] = [
                {
                    label: 'View',
                    submenu: [
                        { role: 'reload' },
                        { role: 'forceReload' },
                        { role: 'toggleDevTools' },
                        { type: 'separator' },
                        { role: 'resetZoom' },
                        { role: 'zoomIn' },
                        { role: 'zoomOut' },
                        { type: 'separator' },
                        { role: 'togglefullscreen' }
                    ]
                }
            ];
            const menu = Menu.buildFromTemplate(template);
            Menu.setApplicationMenu(menu);
            return;
        }

        const toggleKb = this.keybinds.get('general:toggle-visibility');
        const toggleAccelerator = toggleKb ? toggleKb.accelerator : 'CommandOrControl+B';

        const template: any[] = [
            {
                label: app.name,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide', accelerator: 'CommandOrControl+Option+H' },
                    { role: 'hideOthers', accelerator: 'CommandOrControl+Option+Shift+H' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            },
            {
                role: 'editMenu'
            },
            {
                label: 'View',
                submenu: [
                    {
                        label: 'Toggle Visibility',
                        accelerator: toggleAccelerator || undefined,
                        click: () => {
                            // Exigir AppState dynamically para avoid circular dependencies
                            const { AppState } = require('../main');
                            AppState.getInstance().toggleMainWindow();
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Move Window Up',
                        accelerator: this.getKeybind('window:move-up') || undefined,
                        click: () => this.windowHelper?.moveWindowUp()
                    },
                    {
                        label: 'Move Window Down',
                        accelerator: this.getKeybind('window:move-down') || undefined,
                        click: () => this.windowHelper?.moveWindowDown()
                    },
                    {
                        label: 'Move Window Left',
                        accelerator: this.getKeybind('window:move-left') || undefined,
                        click: () => this.windowHelper?.moveWindowLeft()
                    },
                    {
                        label: 'Move Window Right',
                        accelerator: this.getKeybind('window:move-right') || undefined,
                        click: () => this.windowHelper?.moveWindowRight()
                    },
                    { type: 'separator' },
                    { role: 'reload' },
                    { role: 'forceReload' },
                    { role: 'toggleDevTools' },
                    { type: 'separator' },
                    { role: 'resetZoom' },
                    { role: 'zoomIn' },
                    { role: 'zoomOut' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' }
                ]
            },
            {
                role: 'windowMenu'
            },
            {
                role: 'help',
                submenu: [
                    {
                        label: 'Learn More',
                        click: async () => {
                            const { shell } = require('electron');
                            await shell.openExternal('https://electronjs.org');
                        }
                    }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
        console.log('[KeybindManager] Application menu updated');
    }

    private broadcastUpdate() {
        // Notifica principal processo listeners
        this.onUpdateCallbacks.forEach(cb => cb());

        const windows = BrowserWindow.getAllWindows();
        const allKeybinds = this.getAllKeybinds();
        windows.forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send('keybinds:update', allKeybinds);
            }
        });
    }

    public setupIpcHandlers() {
        ipcMain.handle('keybinds:get-all', () => {
            return this.getAllKeybinds();
        });

        ipcMain.handle('keybinds:set', (_, id: string, accelerator: string) => {
            console.log(`[KeybindManager] Set ${id} -> ${accelerator}`);
            this.setKeybind(id, accelerator);
            return true;
        });

        ipcMain.handle('keybinds:reset', () => {
            console.log('[KeybindManager] Reset defaults');
            this.resetKeybinds();
            return this.getAllKeybinds();
        });
    }
}
