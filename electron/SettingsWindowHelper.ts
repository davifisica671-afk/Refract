/**
 * SettingsWindowHelper.ts
 * Gerencia a janela de configurações como popup sobre a janela principal.
 * Cria, posiciona e controla a visibilidade da janela de configurações,
 * incluindo suporte a proteção de conteúdo (modo indetectável) e
 * comportamento de foco NSPanel no macOS.
 */
import { BrowserWindow, screen, app } from "electron"
import { WindowHelper } from "./WindowHelper"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

type WindowActivationOptions = {
    activate?: boolean
}

export class SettingsWindowHelper {
    private settingsWindow: BrowserWindow | null = null
    private windowHelper: WindowHelper | null = null;
    private opacityTimeout: NodeJS.Timeout | null = null;

    public getSettingsWindow(): BrowserWindow | null {
        return this.settingsWindow
    }

    public setWindowDimensions(win: BrowserWindow, width: number, height: number): void {
        if (!win || win.isDestroyed() || !win.isVisible()) return

        const currentBounds = win.getBounds()
        // Apenas atualiza se as dimensões realmente mudaram (evita loops infinitos)
        if (currentBounds.width === width && currentBounds.height === height) return

        win.setSize(width, height)
    }

    // Armazena offsets relativos à janela principal
    private offsetX: number = 0
    private offsetY: number = 0

    private lastBlurTime: number = 0
    private ignoreBlur: boolean = false;

    constructor() { }

    public setIgnoreBlur(ignore: boolean): void {
        this.ignoreBlur = ignore;
    }

    /**
     * Pre-create o configurações janela in o fundo (hidden) para faster primeiro open
     */
    public preloadWindow(): void {
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
            // Cria janela off-screen então it's pronto mas não visible
            this.createWindow(-10000, -10000, false);
        }
    }

    public setWindowHelper(wh: WindowHelper): void {
        this.windowHelper = wh;
    }

    public toggleWindow(x?: number, y?: number): void {
        const mainWindow = this.windowHelper?.getMainWindow() ?? null;
        if (mainWindow && !mainWindow.isDestroyed() && x !== undefined && y !== undefined) {
            const bounds = mainWindow.getBounds();
            this.offsetX = x - bounds.x;
            this.offsetY = y - (bounds.y + bounds.height);
        }

        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            // Fix: If janela era apenas closed por desfocar (e.g. clicking o alternar button), don't re-open imediatamente
            if (!this.settingsWindow.isVisible() && (Date.now() - this.lastBlurTime < 250)) {
                return;
            }

            if (this.settingsWindow.isVisible()) {
                this.closeWindow(); // Uso closeWindow to handle focar restore
            } else {
                this.showWindow(x, y)
            }
        } else {
            this.createWindow(x, y)
        }
    }

    public showWindow(x?: number, y?: number, options: WindowActivationOptions = {}): void {
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
            this.createWindow(x, y)
            return
        }

        const activate = options.activate ?? true;

        // Conjunto pai para garante it stays em topo de o correto window
        const mainWin = this.windowHelper?.getMainWindow();
        if (mainWin && !mainWin.isDestroyed()) {
            this.settingsWindow.setParentWindow(mainWin);
        }

        if (x !== undefined && y !== undefined) {
            this.settingsWindow.setPosition(Math.round(x), Math.round(y))
        }

        // Garante completamente visible em screen
        this.ensureVisibleOnScreen();

        if (process.platform === 'win32' && this.contentProtection) {
            this.settingsWindow.setOpacity(0);
            if (activate) this.settingsWindow.show(); else this.settingsWindow.showInactive();
            this.settingsWindow.setContentProtection(true);

            if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
            this.opacityTimeout = setTimeout(() => {
                if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
                    this.settingsWindow.setOpacity(1);
                    if (activate) this.settingsWindow.focus();
                }
            }, 60);
        } else {
            this.settingsWindow.setContentProtection(this.contentProtection);
            if (activate) this.settingsWindow.show(); else this.settingsWindow.showInactive();
            if (activate) this.settingsWindow.focus();
        }

        this.emitVisibilityChange(true);
    }

    public reposition(mainBounds: Electron.Rectangle): void {
        if (!this.settingsWindow || !this.settingsWindow.isVisible() || this.settingsWindow.isDestroyed()) return;

        const newX = mainBounds.x + this.offsetX;
        const newY = mainBounds.y + mainBounds.height + this.offsetY;

        this.settingsWindow.setPosition(Math.round(newX), Math.round(newY));
    }

    public closeWindow(): void {
        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.hide()
            this.emitVisibilityChange(false);
        }
    }

    private emitVisibilityChange(isVisible: boolean): void {
        const mainWindow = this.windowHelper?.getMainWindow() ?? null;
        if (!mainWindow) {
            console.warn('[SettingsWindowHelper] settings-visibility-changed dropped — no main window bound yet.');
            return;
        }
        if (mainWindow.isDestroyed()) return;
        try {
            mainWindow.webContents.send('settings-visibility-changed', isVisible);
        } catch {
            // Renderer é tearing dabaixo iignorar
        }
    }

    private createWindow(x?: number, y?: number, showWhenReady: boolean = true): void {
        const isMac = process.platform === 'darwin';
        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width: 180, // Match React componente width (SettingsPopup.tsx)
            height: 200, // Trimmed; ResizeObserver em renderer pins exact height
            frame: false,
            transparent: true,
            resizable: false,
            fullscreenable: false,
            hasShadow: false,
            alwaysOnTop: true,
            backgroundColor: "#00000000",
            show: false,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js"),
                backgroundThrottling: false // Keep window ready até quando hidden
            },
            // ROUND 3 FIX: ttipo 'panel' what it makes isso an NSPanel em vez
            // than a regular NSWindow. Sem it, o becomesKeyOnlyIfNeeded
            // e _setPreventsActivation: SPI calls em applyStealthToWindow
            // são no-ops (those são NSPanel-only properties — respondsToSelector
            // Retorna falso em a plain NSWindow). O anterior fix apenas added
            // applyStealthToWindow sem o underlying painel ttipo que é
            // por que focar theft persisted. NSPanel + type:'panel' = o mesmo
            // Spotlight/Alfred mechanism o overlay uses.
            ...(isMac ? { type: 'panel' as const } : {}),
        }

        if (x !== undefined && y !== undefined) {
            windowSettings.x = Math.round(x)
            windowSettings.y = Math.round(y)
        }

        this.settingsWindow = new BrowserWindow(windowSettings)

        if (process.platform === "darwin") {
            this.settingsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
            this.settingsWindow.setHiddenInMissionControl(true)
            this.settingsWindow.setAlwaysOnTop(true, "floating")
        }

        console.log(`[SettingsWindowHelper] Creating Janela de Configurações with Content Protection: ${this.contentProtection}`);
        this.settingsWindow.setContentProtection(this.contentProtection);

        // Carrega com consulta param
        const settingsUrl = isDev
            ? `${startUrl}?window=settings`
            : `${startUrl}?window=settings` // arquivo url também works com busca params em modern Electron

        this.settingsWindow.loadURL(settingsUrl).catch(e => {
            console.error('[SettingsWindowHelper] Failed to load URL:', e);
        });

        this.settingsWindow.once('ready-to-show', () => {
            // Aplica NSPanel stealth attributes (becomesKeyOnlyIfNeeded +
            // _setPreventsActivation + sharingType=None + collectionBehavior)
            // Antes qualquer shmostrar então clicking o Settings botão em o
            // Refract overlay doesn't activate o Refract app e dim
            // o user's foreground app (Zoom/browser/IDE) mid-meeting.
            // Sem this, configurações era a regular focusable janela and
            // todo interaction stole ffocar Failure é non-fatal; logged.
            if (process.platform === 'darwin' && this.settingsWindow && !this.settingsWindow.isDestroyed()) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { loadNativeModule } = require('./audio/nativeModuleLoader');
                    const native = loadNativeModule();
                    if (native && typeof native.applyStealthToWindow === 'function') {
                        native.applyStealthToWindow(this.settingsWindow.getNativeWindowHandle());
                    }
                } catch (e) {
                    console.error('[SettingsWindowHelper] applyStealthToWindow failed:', e);
                }
            }
            if (showWhenReady) {
                this.showWindow(this.settingsWindow?.getBounds().x || 0, this.settingsWindow?.getBounds().y || 0)
            }
        })

        // Ocultar em desfocar em vez disso de cfechar para keep sestado
        // Ou apenas let user fechar it.
        // User asked para "independent window", talvez sticky?
        // Vamos manter simples: clicar fora fecha se quisermos comportamento de .popover.
        // Para nagora let it stay abrir até toggled ou ESC.
        this.settingsWindow.on('blur', () => {
            if (this.ignoreBlur) return;
            this.lastBlurTime = Date.now();
            this.closeWindow();
        })

        // ROUND 3 FIX (#1): quando Settings becomes visible, para o
        // CGEventTap. Caso contrário o tap intercepts todo plain keystroke at
        // OS nível e routes them dentro de Refract's chat entrada — o user
        // can't tipo API keys (ou aqualquer coisa dentro de Settings fields. Settings
        // entrada é a long-form interaction; stealth-typing-into-overlay é
        // não o que o user wants haqui They pode re-engage com o hotkey
        // após Settings cfecha
        this.settingsWindow.on('show', () => {
            // ROUND 4 FIX (#7): reinicia desfocar timestamp em todo successful
            // smostrar Sem this, a stale lastBlurTime de a prior sessão
            // (ou de a brief NSPanel-nonactivating desfocar que fez fire)
            // pode keep o 250ms toggle-protection proteger hot indefinitely,
            // suppressing legitimate user re-toggles. Resetting at mostrar
            // time bounds o proteger para "o Último bdesfocar em vez than "qualquer
            // desfocar já observed."
            this.lastBlurTime = 0;

            if (process.platform !== 'darwin') return;
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
                StealthKeyboardManager.getInstance().stop();
            } catch (e) {
                console.error('[SettingsWindowHelper] failed to stop stealth tap on show:', e);
            }
        });


    }



    private ensureVisibleOnScreen() {
        if (!this.settingsWindow) return;
        const { x, y, width, height } = this.settingsWindow.getBounds();
        const display = screen.getDisplayNearestPoint({ x, y });
        const bounds = display.workArea;

        let newX = x;
        let newY = y;

        if (x + width > bounds.x + bounds.width) {
            newX = bounds.x + bounds.width - width;
        }
        if (y + height > bounds.y + bounds.height) {
            newY = bounds.y + bounds.height - height;
        }

        this.settingsWindow.setPosition(newX, newY);
    }
    private contentProtection: boolean = false; // Track estado

    public setContentProtection(enable: boolean): void {
        // Dedupe: avoid redundant DWM affinity churn em Windows quando o mesmo
        // valor é reapplied (settings IPC + mostrar events + global toggles todos
        // converge heaqui O primeiro chamar ainda hits ambos o in-memory estado
        // e o native window; depois identical calls no-op.
        if (this.contentProtection === enable && this.settingsWindow && !this.settingsWindow.isDestroyed()) return;
        console.log(`[SettingsWindowHelper] Setting content protection to: ${enable}`);
        this.contentProtection = enable;

        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.setContentProtection(enable);
        }
    }

    // Force-reapply o atual content-protection sestado bypassing o dedupe
    // proteger aacima Chamado após app.dock.hide()/show() flips o macOS
    // activation ppolítica que pode reinicia o window's sharingType até though
    // nosso in-memory flag é unchanged.
    public reassertContentProtection(): void {
        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.setContentProtection(this.contentProtection);
        }
    }

    public syncActivationPolicy(): void {
        if (process.platform !== 'win32') return;
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) return;
        this.settingsWindow.setContentProtection(this.contentProtection);
        if (this.settingsWindow.isVisible()) {
            this.settingsWindow.setOpacity(1);
        }
    }
}
