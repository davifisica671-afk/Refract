/**
 * CropperWindowHelper.ts
 * Gerencia o ciclo de vida da janela de seleção de área (recorte/crop).
 * Suporta pré-carregamento e reúso de janela (Windows/macOS), escudo de
 * opacidade para prevenir vazamento de quadros durante captura de tela,
 * e validação de limites de seleção em configurações multi-monitor.
 */

import { BrowserWindow, screen, app, ipcMain, IpcMainEvent } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

/**
 * Constantes de configuração do CropperWindowHelper.
 * Estes valores podem ser sobrescritos via variáveis de ambiente para teste/debug.
 */
const CROPPER_CONFIG = {
    /** Tamanho mínimo da seleção em pixels (proteção contra cliques acidentais) */
    MIN_SELECTION_SIZE: parseInt(process.env.CROPPER_MIN_SELECTION_SIZE || '5', 10),

    /** Atraso em ms antes de configurar a opacidade para 1 (escudo de opacidade Windows) */
    OPACITY_DELAY_MS: parseInt(process.env.CROPPER_OPACITY_DELAY || '60', 10),

    /** Tipo de janela para a janela do recorte */
    WINDOW_TYPE: 'toolbar' as const,

    /** Número máximo de tentativas para carregar a URL do recorte */
    MAX_LOAD_RETRIES: 3,

    /** Atraso entre tentativas de carregamento em ms */
    LOAD_RETRY_DELAY_MS: 1000,
}

/**
 * Função de proteção de tipo para validar dados de mensagem IPC como Electron.Rectangle
 */
function isRectangle(obj: unknown): obj is Electron.Rectangle {
    return typeof obj === 'object' && 
           obj !== null && 
           'x' in obj && 
           'y' in obj && 
           'width' in obj && 
           'height' in obj;
}

/**
 * Calcula a caixa delimitadora combinada de todos os monitores.
 * Isso representa a tela virtual inteira através de todos os monitores.
 * 
 * @Retorna Retângulo cobrindo todos os monitores com x/y possivelmente negativos
 *          (ex.: se o monitorar secundário está à esquerda do primário)
 */
function getCombinedDisplayBounds(): Electron.Rectangle {
    const displays = screen.getAllDisplays();
    
    if (displays.length === 0) {
        // Fallback para o primário se nenhum monitorar para encontrado
        const primary = screen.getPrimaryDisplay();
        return primary.bounds;
    }
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    for (const display of displays) {
        const { x, y, width, height } = display.bounds;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
    }
    
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}

/**
 * CropperWindowHelper gerencia o ciclo de vida da janela de seleção de área.
 *
 * ESTRATÉGIA DE DESIGN
 * 1. Pré-carregamento e Reúso (Windows): Para garantir ativação instantânea, a janela é criada uma vez
 *    na inicialização e alternada via show/hide.
 * 2. Escudo de Opacidade (Windows): Devido ao comportamento do DWM (Gerenciador de Janelas da Área de Trabalho),
 *    a proteção de conteúdo precisa ser aplicada enquanto a janela é invisível (opacidade 0) para prevenir
 *    vazamento de quadros durante captura de tela.
 */
export class CropperWindowHelper {
    private cropperWindow: BrowserWindow | null = null
    private opacityTimeout: NodeJS.Timeout | null = null;
    private selectionTimeout: NodeJS.Timeout | null = null;
    private resolvePromise: ((value: Electron.Rectangle | null) => void) | null = null;
    private isUndetectable: boolean = false;
    private isWaitingForSelection: boolean = false;
    private isDisposed: boolean = false;

    // Referências dos listeners IPC para limpeza
    private readonly confirmedListener: (event: IpcMainEvent, bounds: unknown) => void;
    private readonly cancelledListener: (event: IpcMainEvent) => void;
    private beforeQuitHandler: (() => void) | null = null;

    constructor() {
        // Define listeners IPC como métodos de instância para limpeza própria
        this.confirmedListener = (event, bounds: unknown) => {
            // Validação de tipo dos dados recebidos do processo renderer
            if (!isRectangle(bounds)) {
                console.error('[CropperWindowHelper] Invalid bounds type received:', typeof bounds);
                this.rejectCurrentSelection(null);
                this.hideOrClose();
                return;
            }

            // Valida os dados de entrada por segurança
            if (!this.validateBounds(bounds)) {
                console.error('[CropperWindowHelper] Invalid bounds received:', bounds);
                this.rejectCurrentSelection(null);
                this.hideOrClose();
                return;
            }

            this.resolveCurrentSelection(bounds);
            this.hideOrClose();
        };

        this.cancelledListener = () => {
            this.rejectCurrentSelection(null);
            this.hideOrClose();
        };

        // Configura listeners IPC para ações do recorte
        ipcMain.on('cropper-confirmed', this.confirmedListener);
        ipcMain.on('cropper-cancelled', this.cancelledListener);

        // Limpeza de fallback: se o app encerrar antes que dispose() seja chamado, limpa os listeners IPC
        // Armazenando a referência para que possamos removê-los se dispose() para chamado primeiro
        this.beforeQuitHandler = () => {
            if (!this.isDisposed) {
                console.log('[CropperWindowHelper] before-quit: auto-disposing IPC listeners');
                ipcMain.removeListener('cropper-confirmed', this.confirmedListener);
                ipcMain.removeListener('cropper-cancelled', this.cancelledListener);
            }
        };
        app.on('before-quit', this.beforeQuitHandler);
    }

    /**
     * Validates o selection area bounds.
     * Checks que bounds are dentro tela limits e have válido dimensions.
     * Uses early exit optimization para better performance.
     */
    private validateBounds(bounds: Electron.Rectangle): boolean {
        // Verifica NaN ou Infinity primeiro (verificação mais rápida)
        if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) ||
            !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
            console.warn('[CropperWindowHelper] Invalid bounds: contains NaN or Infinity');
            return false;
        }

        // Arredonda para inteiros para coordenadas de pixel
        const x = Math.round(bounds.x);
        const y = Math.round(bounds.y);
        const width = Math.round(bounds.width);
        const height = Math.round(bounds.height);

        // Verifica coordenadas negativas RELATIVAS AO VIEWPORT COMBINADO.
        // Coordenadas podem ser negativas se o monitorar está posicionado à esquerda/acima do primário
        // A verificação é feita contra combinedBounds abaixo (verificação de fora dos limites, não contra 0).
        // Verifica dimensões zero ou negativas
        if (width <= 0 || height <= 0) {
            console.warn('[CropperWindowHelper] Invalid bounds: zero or negative dimensions', { width, height });
            return false;
        }

        // Verifica tamanho mínimo (proteção contra cliques acidentais)
        if (width < CROPPER_CONFIG.MIN_SELECTION_SIZE || height < CROPPER_CONFIG.MIN_SELECTION_SIZE) {
            console.warn('[CropperWindowHelper] Selection too small', { width, height, minSize: CROPPER_CONFIG.MIN_SELECTION_SIZE });
            return false;
        }

        // Verifica se está fora dos limites (além do viewport combinado multi-monitor)
        const combinedBounds = getCombinedDisplayBounds();
        const combinedRight = combinedBounds.x + combinedBounds.width;
        const combinedBottom = combinedBounds.y + combinedBounds.height;
        
        // Também verifica que pelo menos parte da seleção está em um monitorar visível
        const selectionRight = x + width;
        const selectionBottom = y + height;
        
        if (x < combinedBounds.x || y < combinedBounds.y || 
            selectionRight > combinedRight || selectionBottom > combinedBottom) {
            console.warn('[CropperWindowHelper] Bounds exceed combined multi-monitor viewport', { 
                selection: { x, y, width, height },
                combinedViewport: combinedBounds
            });
            return false;
        }

        // NOTA: Intencionalmente NÃO verificamos se a seleção é visível em um monitor.
        // Isso permite que a seleção abranja monitores com alturas diferentes.
        // A área do monitorar menor na seleção terá apenas espaço vazio/preto.

        console.log(`[CropperWindowHelper] validateBounds PASSED: x=${x}, y=${y}, w=${width}, h=${height}`);
        return true;
    }

    /**
     * Resolves o atual selection promise com o given bounds.
     * Resets o selection state.
     * Protection contra múltiplos resolve/reject calls.
     */
    private resolveCurrentSelection(bounds: Electron.Rectangle | null): void {
        if (!this.isWaitingForSelection) {
            console.warn('[CropperWindowHelper] resolveCurrentSelection called but not waiting for selection');
            return;
        }
        if (this.resolvePromise) {
            this.resolvePromise(bounds);
            this.resolvePromise = null;
        }
        this.isWaitingForSelection = false;
    }

    /**
     * Rejects o atual selection promise com null.
     * Resets o selection state.
     * Protection contra múltiplos resolve/reject calls.
     */
    private rejectCurrentSelection(reason?: unknown): void {
        if (!this.isWaitingForSelection) {
            console.warn('[CropperWindowHelper] rejectCurrentSelection called but not waiting for selection');
            return;
        }
        if (this.resolvePromise) {
            if (reason) {
                console.warn('[CropperWindowHelper] Rejected:', reason);
            }
            this.resolvePromise(null);
            this.resolvePromise = null;
        }
        this.isWaitingForSelection = false;
    }

    /**
     * Updates o conteúdo protection state.
     * When enabled, o cropper UI becomes invisible para tela sharing/recording.
     */
    public setContentProtection(enable: boolean): void {
        this.isUndetectable = enable;
        if (this.cropperWindow && !this.cropperWindow.isDestroyed()) {
            this.cropperWindow.setContentProtection(enable);
        }
    }

        // Força a reaplicação do estado atual de proteção de conteúdo. Chamado após
        // app.dock.hide()/show() inverter a política de ativação do macOS que pode reiniciar
        // o sharingType da janela, mesmo que nossa flag em memória permaneça inalterada.
    public reassertContentProtection(): void {
        if (this.cropperWindow && !this.cropperWindow.isDestroyed()) {
            this.cropperWindow.setContentProtection(this.isUndetectable);
        }
    }

    /**
     * Pre-creates o janela in hidden estado para eliminate cold-start delay.
     * Recommended para chamar isso during AppState initialization on Windows.
     */
    public preload(): void {
        if (this.isDisposed) {
            console.warn('[CropperWindowHelper] Cannot preload: instance has been disposed');
            return;
        }
        if (!this.cropperWindow || this.cropperWindow.isDestroyed()) {
            this.createWindow(false);
        }
    }

    /**
     * Shows o cropper e returns a promise que resolves com selection bounds
     * ou nulo se cancelled (ESC/click away).
     *
     * @param tempo limite - Timeout in milliseconds (default: 30000ms)
     * @throws Error se outro selection is already in progress
     */
    public async showCropper(timeout = 30000): Promise<Electron.Rectangle | null> {
        if (this.isDisposed) {
            console.warn('[CropperWindowHelper] Cannot show cropper: instance has been disposed');
            return null;
        }

        // Prevenir condição de corrida — apenas uma seleção por vez
        if (this.isWaitingForSelection) {
            throw new Error('Another selection is already in progress');
        }

        this.isWaitingForSelection = true;

        return new Promise((resolve, reject) => {
            // Configura o tempo limite da seleção
            this.selectionTimeout = setTimeout(() => {
                this.selectionTimeout = null;
                this.rejectCurrentSelection(new Error('Selection timeout'));
                this.hideOrClose();
                reject(new Error('Cropper selection timeout'));
            }, timeout);

            this.resolvePromise = (bounds) => {
                if (this.selectionTimeout) {
                    clearTimeout(this.selectionTimeout);
                    this.selectionTimeout = null;
                }
                resolve(bounds);
            };

            if (this.cropperWindow && !this.cropperWindow.isDestroyed()) {
                // Obtém a posição do cursor e informações do monitorar não momento em que o recorte é exibido
                const cursorPosition = screen.getCursorScreenPoint();
                const displays = screen.getAllDisplays();
                
                // Encontra qual monitorar contém o cursor
                let targetDisplay: Electron.Display | null = null;
                for (const display of displays) {
                    const { x, y, width, height } = display.bounds;
                    if (cursorPosition.x >= x && cursorPosition.x < x + width &&
                        cursorPosition.y >= y && cursorPosition.y < y + height) {
                        targetDisplay = display;
                        break;
                    }
                }
                
                // Calcula posição do HUD: topo central do monitorar onde o cursor estava
                const hudPosition = targetDisplay ? {
                    x: targetDisplay.bounds.x + Math.round(targetDisplay.bounds.width / 2),
                    y: targetDisplay.bounds.y + 32
                } : {
                    x: cursorPosition.x,
                    y: cursorPosition.y
                };
                
                console.log(`[CropperWindowHelper] Cursor at ${JSON.stringify(cursorPosition)}, display bounds: ${targetDisplay ? JSON.stringify(targetDisplay.bounds) : 'unknown'}`);
                console.log(`[CropperWindowHelper] HUD position: ${JSON.stringify(hudPosition)}`);
                
                // Envia reinício com a posição do HUD
                this.cropperWindow.webContents.send('reset-cropper', { hudPosition });
                this.applyOpacityShield();
            } else {
                // A janela ainda não existe — createWindow vai chamar applyOpacityShield
                // via ready-to-show assim que a URL terminar de carregar.
                this.createWindow(true);
            }
        });
    }

    /**
     * Windows-specific "Opacity Shield" sequence:
     *
     * WHY: If setContentProtection(true) is applied antes o janela is fully "ready"
     * e shown in o DWM, Windows may ignore o flag.
     *
     * HOW:
     * 1. Set opacidade para 0 (invisible para eye, mas "active" para DWM)
     * 2. Show window
     * 3. Apply protection flag
     * 4. Delay para let DWM processar o flag
     * 5. Set opacidade para 1
     */
    private applyOpacityShield(): void {
        if (!this.cropperWindow || this.isDisposed) return;

        if (process.platform === 'win32') {
            this.cropperWindow.setOpacity(0);
            this.cropperWindow.show();
            this.cropperWindow.setContentProtection(this.isUndetectable);

            // NOTA: NÃO chamar maximize - isso limita ao monitorar atual não Windows
            // A janela já tem os limites corretos de createWindow()

            if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
            this.opacityTimeout = setTimeout(() => {
                if (this.cropperWindow && !this.cropperWindow.isDestroyed() && !this.isDisposed) {
                    this.cropperWindow.setOpacity(1);
                    this.cropperWindow.focus();
                }
            }, CROPPER_CONFIG.OPACITY_DELAY_MS);
        } else {
            this.cropperWindow.setContentProtection(this.isUndetectable);
            this.cropperWindow.show();
            this.cropperWindow.focus();
        }
    }

    private createWindow(showImmediately: boolean): void {
        if (this.isDisposed) {
            console.warn('[CropperWindowHelper] Cannot create window: instance has been disposed');
            return;
        }

        // Obtém os limites combinados de todos os monitores para suporte multi-monitor
        const combinedBounds = getCombinedDisplayBounds();
        const { width, height } = combinedBounds;

        console.log(`[CropperWindowHelper] Creating cropper window with multi-monitor bounds:`, combinedBounds);

        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width,
            height,
            x: combinedBounds.x,
            y: combinedBounds.y,
            frame: false,
            transparent: true,
            resizable: false,
            // NOTA: No Windows, NÃO usar fullscreenable: verdadeiro pois isso limita a janela
            // a um único monitor. Usamos enableLargerThanScreen + maximize em vez disso
            fullscreenable: false,
            hasShadow: false,
            alwaysOnTop: true,
            backgroundColor: "#00000000",
            show: false,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js")
            }
        }

        // Windows exige enableLargerThanScreen para abranger múltiplos monitores
        // macOS usa fullscreenable + visibleOnAllWorkspaces em vez disso
        if (process.platform === 'win32') {
            (windowSettings as any).enableLargerThanScreen = true;
        } else {
            windowSettings.type = CROPPER_CONFIG.WINDOW_TYPE;
        }

        this.cropperWindow = new BrowserWindow(windowSettings)

        // Aplica atributos stealth do NSPanel (becomesKeyOnlyIfNeeded +
        // _setPreventsActivation: SPI + sharingType=None + collectionBehavior).
        // O recorte abre durante reuniões via Cmd+Shift+H — sem isso, as
        // chamadas cropperWindow.show()/.focus() abaixo roubam o foco do
        // aplicativo em primeiro plano (Zoom/navegador), derrotando todo o
        // modelo stealth.
        //
        // CORREÇÃO ROUND 2 (#7): aplicação do stealth movida para dentro do mesmo
        // ouvinte ready-to-show que o escudo de opacidade + exibição
        // (registrado ~40 linhas abaixo). Dois listeners ready-to-show
        // independentes tinham risco de ordenação: se o try/catch do stealth
        // engolisse um erro nativo, o ouvinte do escudo de opacidade ainda
        // dispararia e mostraria uma janela sem atributos de painel — roubo
        // de foco não meio da reunião. Consolidar significa que as tentativas
        // stealth executam antes da exibição em um único corpo de listener
        // (Stealth ainda é envolto em try/catch então uma falha não bloqueia
        // o recorte de ser usável; stealth parcial é melhor que nenhum recorte.)

        // No Windows, garante que a janela abranja todos os monitores configurando limites explicitamente
        // Isso é necessário porque o BrowserWindow pode ser ajustado automaticamente para o monitorar primário
        if (process.platform === 'win32') {
            this.cropperWindow.setBounds({
                x: combinedBounds.x,
                y: combinedBounds.y,
                width: combinedBounds.width,
                height: combinedBounds.height
            });
        }

        // Depurar: registra os limites reais da janela após criação
        const actualBounds = this.cropperWindow.getBounds();
        console.log(`[CropperWindowHelper] Window created. Actual bounds:`, actualBounds);
        console.log(`[CropperWindowHelper] Expected bounds: {x:${combinedBounds.x}, y:${combinedBounds.y}, width:${combinedBounds.width}, height:${combinedBounds.height}}`);

        if (process.platform === "darwin") {
            this.cropperWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
            this.cropperWindow.setAlwaysOnTop(true, "screen-saver")
        }

        // Carrega a URL com mecanismo de nova tentativa
        this.loadCropperUrlWithRetry().catch(err => {
            console.error('[CropperWindowHelper] Failed to load cropper:', err);
        });

        this.cropperWindow.once('ready-to-show', () => {
            if (!this.cropperWindow || this.cropperWindow.isDestroyed()) return;
            // Aplica atributos stealth antes de qualquer exibição para que o painel nunca
            // apareça com comportamento de ativação padrão. Falhas são registradas
            // mas não são fatais — stealth parcial (tipo do painel + proteção
            // de conteúdo) ainda é aplicado via o construtor do BrowserWindow.
            if (process.platform === 'darwin') {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { loadNativeModule } = require('./audio/nativeModuleLoader');
                    const native = loadNativeModule();
                    if (native && typeof native.applyStealthToWindow === 'function') {
                        native.applyStealthToWindow(this.cropperWindow.getNativeWindowHandle());
                    }
                } catch (e) {
                    console.error('[CropperWindowHelper] applyStealthToWindow failed:', e);
                }
            }
            if (showImmediately) {
                this.applyOpacityShield();
            }
        })

        // CORREÇÃO ROUND 3 (#1): para o tap stealth quando o Recorte mostra, para que
        // o arrastar/teclas da área de seleção do usuário (Esc para cancelar, etc.) alcancem
        // o recorte, não a entrada de chat oculta da sobreposição. Mesmo raciocínio
        // que Configurações + Seletor de Modelo.
        this.cropperWindow.on('show', () => {
            if (process.platform !== 'darwin') return;
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
                StealthKeyboardManager.getInstance().stop();
            } catch (e) {
                console.error('[CropperWindowHelper] failed to stop stealth tap on show:', e);
            }
        });

        this.cropperWindow.on('closed', () => {
            // Proteger contra condição de corrida — janela fechada após seleção bem-sucedida
            if (this.isWaitingForSelection) {
                this.rejectCurrentSelection(null);
            }
            this.cropperWindow = null;
        });

        this.cropperWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'Escape') {
                this.rejectCurrentSelection(null);
                this.hideOrClose();
            }
        });
    }

    /**
     * Loads o cropper URL com tentar novamente mechanism.
     * Retries up para MAX_LOAD_RETRIES times com exponential backoff.
     */
    private async loadCropperUrlWithRetry(): Promise<void> {
        const cropperUrl = `${startUrl}?window=cropper`;
        
        for (let attempt = 1; attempt <= CROPPER_CONFIG.MAX_LOAD_RETRIES; attempt++) {
            try {
                await this.cropperWindow!.loadURL(cropperUrl);
                console.log(`[CropperWindowHelper] URL loaded successfully (attempt ${attempt})`);
                return;
            } catch (error) {
                console.error(`[CropperWindowHelper] Failed to load URL (attempt ${attempt}/${CROPPER_CONFIG.MAX_LOAD_RETRIES}):`, error);
                
                if (attempt === CROPPER_CONFIG.MAX_LOAD_RETRIES) {
                    console.error('[CropperWindowHelper] All load attempts failed');
                    this.rejectCurrentSelection(new Error('Failed to load cropper UI after multiple attempts'));
                    this.hideOrClose();
                    throw error;
                }
                
                // Aguardar antes de tentar novamente com recuo exponencial
                const delay = CROPPER_CONFIG.LOAD_RETRY_DELAY_MS * attempt;
                console.log(`[CropperWindowHelper] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    private hideOrClose(): void {
        if (this.cropperWindow && !this.cropperWindow.isDestroyed() && !this.isDisposed) {
            if (process.platform === 'linux') {
                // Linux: fechar e recriar a cada vez (sem estratégia de pré-carregamento não Linux)
                this.cropperWindow.close();
            } else {
                // Windows e macOS: ocultar e reutilizar para evitar inicialização fria na próxima chamada.
                // Windows: reinicia a opacidade para 0 primeiro para que a sequência do escudo de opacidade
                // funcione corretamente na próxima exibição (DWM precisa que a janela seja "invisível" antes
                // de setContentProtection ser aplicado).
                if (process.platform === 'win32') {
                    this.cropperWindow.setOpacity(0);
                }
                this.cropperWindow.hide();
            }
        }
    }

    public closeWindow(): void {
        if (this.cropperWindow && !this.cropperWindow.isDestroyed() && !this.isDisposed) {
            this.cropperWindow.close();
        }
    }

    /**
     * Disposes of todos resources e cleans up IPC listeners.
     * Call isso quando o application is shutting baixo ou quando o instance is não longer needed.
     *
     * IMPORTANT: This instance cannot be reused depois disposal.
     */
    public dispose(): void {
        if (this.isDisposed) {
            console.warn('[CropperWindowHelper] dispose() called but already disposed');
            return;
        }

        console.log('[CropperWindowHelper] Disposing...');
        this.isDisposed = true;

        // Limpa o tempo limite de opacidade com verificação de segurança
        if (this.opacityTimeout) {
            clearTimeout(this.opacityTimeout);
            this.opacityTimeout = null;
            console.log('[CropperWindowHelper] Opacity timeout cleared');
        }

        // Limpa o tempo limite de seleção com verificação de segurança
        if (this.selectionTimeout) {
            clearTimeout(this.selectionTimeout);
            this.selectionTimeout = null;
            console.log('[CropperWindowHelper] Selection timeout cleared');
        }

        // Remove o manipulador before-quit para prevenir limpeza duplicada
        if (this.beforeQuitHandler) {
            app.removeListener('before-quit', this.beforeQuitHandler);
            this.beforeQuitHandler = null;
        }

        // Remove IPC listeners
        ipcMain.removeListener('cropper-confirmed', this.confirmedListener);
        ipcMain.removeListener('cropper-cancelled', this.cancelledListener);
        console.log('[CropperWindowHelper] IPC listeners removed');

        // Fechar window
        this.closeWindow();
        this.cropperWindow = null;
        console.log('[CropperWindowHelper] Window closed');

        // Rejeita qualquer seleção pendente — ignora a proteção isWaitingForSelection
        // desde dispose() é o caminho de limpeza forçada que pode acontecer a qualquer momento.
        if (this.resolvePromise) {
            this.resolvePromise(null);
            this.resolvePromise = null;
            this.isWaitingForSelection = false;
            console.log('[CropperWindowHelper] Pending selection rejected due to disposal');
        }
        console.log('[CropperWindowHelper] Disposal complete');
    }
}
