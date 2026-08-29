/**
 * ModelSelectorWindowHelper.ts
 * Gerencia a janela dropdown de seleção de modelo LLM.
 * Cria, posiciona e controla a visibilidade do seletor de modelo,
 * incluindo suporte a proteção de conteúdo (modo indetectável) e
 * comportamento de foco NSPanel no macOS.
 */
import { BrowserWindow, screen, app } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

import type { WindowHelper } from "./WindowHelper"

type WindowActivationOptions = {
    activate?: boolean
}

export class ModelSelectorWindowHelper {
    private window: BrowserWindow | null = null
    private contentProtection: boolean = false
    private opacityTimeout: NodeJS.Timeout | null = null;

    constructor() { }

    private windowHelper: WindowHelper | null = null;

    public setWindowHelper(wh: WindowHelper): void {
        this.windowHelper = wh;
    }

    public getWindow(): BrowserWindow | null {
        return this.window
    }

    public preloadWindow(): void {
        if (!this.window || this.window.isDestroyed()) {
            this.createWindow(-10000, -10000, false);
        }
    }

    public showWindow(x: number, y: number, options: WindowActivationOptions = {}): void {
        if (!this.window || this.window.isDestroyed()) {
            this.createWindow(x, y, true, options)
            return
        }

        const activate = options.activate ?? true;

        // Define pai e alinha configurações da janela
        const mainWin = this.windowHelper?.getMainWindow();
        const isOverlay = mainWin === this.windowHelper?.getOverlayWindow();

        if (mainWin && !mainWin.isDestroyed()) {
            this.window.setParentWindow(mainWin);
        }

        if (process.platform === "darwin") {
            // Alinha com o comportamento da janela pai
            this.window.setVisibleOnAllWorkspaces(isOverlay, { visibleOnFullScreen: isOverlay });
            // Apenas define alwaysOnTop se o valor realmente está mudando — chamá-lo desnecessariamente
            // ativa NSApp no macOS, roubando foco de outros apps.
            const currentAlwaysOnTop = this.window.isAlwaysOnTop();
            if (currentAlwaysOnTop !== isOverlay) {
                this.window.setAlwaysOnTop(isOverlay, "floating");
            }
            // Sempre ocultar do Mission Control pois é um dropdown
            this.window.setHiddenInMissionControl(true);
        }

        // Posicionamento padrão de dropdown
        this.window.setPosition(Math.round(x), Math.round(y))
        this.ensureVisibleOnScreen();

        if (process.platform === 'win32' && this.contentProtection) {
            this.window.setOpacity(0);
            if (activate) this.window.show(); else this.window.showInactive();
            this.window.setContentProtection(true);

            if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
            this.opacityTimeout = setTimeout(() => {
                if (this.window && !this.window.isDestroyed()) {
                    this.window.setOpacity(1);
                    if (activate) this.window.focus();
                }
            }, 60);
        } else {
            this.window.setContentProtection(this.contentProtection);
            if (activate) this.window.show(); else this.window.showInactive();
            if (activate) this.window.focus();
        }
    }

    public hideWindow(): void {
        if (this.window && !this.window.isDestroyed()) {
            this.window.setParentWindow(null);
            this.window.hide();
            // Não chamar mainWin.focus() aqui — o seletor de modelo é um dropdown flutuante.
            // Focar explicitamente a janela principal rouba o foco do SO de qualquer coisa que o
            // usuário tinha ativo (Zoom, navegador, etc.) antes de abrir o seletor.
        }
    }

    public toggleWindow(x: number, y: number, options: WindowActivationOptions = {}): void {
        if (this.window && !this.window.isDestroyed()) {
            if (this.window.isVisible()) {
                this.hideWindow()
            } else {
                this.showWindow(x, y, options)
            }
        } else {
            this.createWindow(x, y, true, options)
        }
    }

    public closeWindow(): void {
        this.hideWindow();
    }

    private createWindow(
        x?: number,
        y?: number,
        showWhenReady: boolean = true,
        showOptions: WindowActivationOptions = {},
    ): void {
        const isMac = process.platform === 'darwin';
        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width: 140,
            height: 200,
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
                backgroundThrottling: false
            },
            // CORREÇÃO ROUND 3: type:'panel' torna isso um NSPanel em vez de um
            // NSWindow regular. Necessário para que becomesKeyOnlyIfNeeded e
            // _setPreventsActivation (chamadas SPI em applyStealthToWindow) tenham
            // efeito real (essas são propriedades exclusivas do NSPanel).
            // Sem isso, a chamada anterior a applyStealthToWindow era um no-op
            // e clicar no seletor de modelo ainda roubava o foco do app em primeiro plano.
            //
            // Fechar ao clicar fora é tratado pelo manipulador de mousedown
            // do renderer (NativelyInterface.tsx) que despacha o IPC
            // `model-selector:close-if-open`, protegido contra o botão de
            // alternância via `data-model-selector-toggle`.
            ...(isMac ? { type: 'panel' as const } : {}),
        }

        if (x !== undefined && y !== undefined) {
            windowSettings.x = Math.round(x)
            windowSettings.y = Math.round(y)
        }

        this.window = new BrowserWindow(windowSettings)

        if (process.platform === "darwin") {
            // Valores iniciais padrão — serão atualizados em showWindow
            this.window.setHiddenInMissionControl(true)
        }

        // Aplica proteção de conteúdo para o Modo Indetectável
        console.log(`[ModelSelectorWindowHelper] Creating window with Content Protection: ${this.contentProtection}`);
        this.window.setContentProtection(this.contentProtection)

        // Carrega com parâmetro de consulta para roteamento
        const url = isDev
            ? `${startUrl}?window=model-selector`
            : `${startUrl}?window=model-selector`

        this.window.loadURL(url).catch(e => {
            console.error('[ModelSelectorWindowHelper] Failed to load URL:', e);
        });

        this.window.once('ready-to-show', () => {
            // Aplica atributos stealth do NSPanel ANTES de qualquer show() para que
            // clicar no seletor de modelo na sobreposição do Refract não ative
            // o Refract e escureça o app em primeiro plano do usuário (Zoom/navegador)
            // durante a reunião. Sem isso, trocar de modelo era uma janela regular
            // focável e toda interação roubava o foco. Falha não fatal.
            //
            // NOTA: o seletor de modelo também usa `on('blur')` para fechar
            // automaticamente (linha abaixo). Com panel-nonactivating +
            // becomesKeyOnlyIfNeeded, a semântica de blur é sutil — a janela pode
            // não se tornar key ao clicar e portanto nunca recebe blur. Se isso
            // se probar problemático, o manipulador de fechar no blur deve trocar
            // para um ouvinte de clique-fora registrado na sobreposição pai.
            if (process.platform === 'darwin' && this.window && !this.window.isDestroyed()) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { loadNativeModule } = require('./audio/nativeModuleLoader');
                    const native = loadNativeModule();
                    if (native && typeof native.applyStealthToWindow === 'function') {
                        native.applyStealthToWindow(this.window.getNativeWindowHandle());
                    }
                } catch (e) {
                    console.error('[ModelSelectorWindowHelper] applyStealthToWindow failed:', e);
                }
            }
            if (showWhenReady) {
                this.showWindow(
                    this.window?.getBounds().x || 0,
                    this.window?.getBounds().y || 0,
                    showOptions,
                )
            }
        })

        // Fechar no blur é intencionalmente NÃO conectado aqui. Um ouvinte
        // de blur por janela dispara em transferências de foco dentro do app
        // (overlay ↔ panel), o que entra em conflito com o caminho de abertura
        // do botão de alternância e produziu o bug histórico "primeiro clique
        // não faz nada, segundo clique abre". Três caminhos de fechamento
        // ortogonais cobrem os casos legítimos:
        //   • manipulador de captura de mousedown do renderer em NativelyInterface.tsx
        //     despacha `model-selector:close-if-open` para cliques externos
        //     dentro da sobreposição (protegido por data-model-selector-toggle).
        //   • main.ts se inscreve em app.on('did-resign-active') (macOS) /
        //     'browser-window-blur' + getFocusedWindow()===null (win/linux)
        //     para fechar automaticamente quando o usuário clica em outro app.
        //   • clicar em um modelo na lista oculta explicitamente o painel via
        //     o IPC set-active-model.

        // CORREÇÃO ROUND 3 (#1): para o tap stealth quando o Seletor de Modelo é exibido,
        // espelhando o manipulador de Configurações. Embora breve (seletor de modelo
        // é um dropdown), a interação com o dropdown ainda requer teclas para
        // alcançar a árvore React desta janela, que o tap interceptaria
        // ao nível do SO.
        this.window.on('show', () => {
            if (process.platform !== 'darwin') return;
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
                StealthKeyboardManager.getInstance().stop();
            } catch (e) {
                console.error('[ModelSelectorWindowHelper] failed to stop stealth tap on show:', e);
            }
        });
    }

    private ensureVisibleOnScreen() {
        if (!this.window) return;
        const { x, y, width, height } = this.window.getBounds();
        const display = screen.getDisplayNearestPoint({ x, y });
        const bounds = display.workArea;

        let newX = x;
        let newY = y;

        // Manter dentro dos limites horizontais
        if (x + width > bounds.x + bounds.width) {
            newX = bounds.x + bounds.width - width;
        }
        if (x < bounds.x) {
            newX = bounds.x;
        }

        // Manter dentro dos limites verticais
        if (y + height > bounds.y + bounds.height) {
            newY = bounds.y + bounds.height - height;
        }
        if (y < bounds.y) {
            newY = bounds.y;
        }

        this.window.setPosition(newX, newY);
    }

    public setContentProtection(enable: boolean): void {
        // Deduplicação: ver raciocínio em WindowHelper.setContentProtection — chamadas
        // idênticas repetidas são comuns (o IPC de alternância se propaga entre helpers) e
        // produce DWM affinity churn on Windows.
        if (this.contentProtection === enable && this.window && !this.window.isDestroyed()) return;
        console.log(`[ModelSelectorWindowHelper] Setting content protection to: ${enable}`);
        this.contentProtection = enable;
        if (this.window && !this.window.isDestroyed()) {
            this.window.setContentProtection(enable);
        }
    }

    // Force-reapply the current content-protection state, bypassing the dedupe
    // guard above. Called after app.dock.hide()/show() flips the macOS
    // activation policy, which can reset the window's sharingType even though
    // our in-memory flag is unchanged.
    public reassertContentProtection(): void {
        if (this.window && !this.window.isDestroyed()) {
            this.window.setContentProtection(this.contentProtection);
        }
    }

    public syncActivationPolicy(): void {
        if (process.platform !== 'win32') return;
        if (!this.window || this.window.isDestroyed()) return;
        this.window.setContentProtection(this.contentProtection);
        if (this.window.isVisible()) {
            this.window.setOpacity(1);
        }
    }
}
