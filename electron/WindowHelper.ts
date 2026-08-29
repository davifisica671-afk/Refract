/**
 * =============================================================================
 * WindowHelper.ts — GERENCIADOR DE JANELAS DO APLICATIVO
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Gerencia as DUAS janelas principais do app Electron:
 * 
 * 1. LAUNCHER WINDOW (Janela Principal):
 *    - Mostra lista de reuniões, configurações, perfil do candidato
 *    - Dimensões fixas: 1200×800
 *    - Centralizada na tela com 5% de margem superior
 *    - Pode ser movida com atalhos de teclado (Ctrl+Setas)
 * 
 * 2. OVERLAY WINDOW (Sobreposição Transparente):
 *    - Aparece durante reuniões — fica por cima de Zoom/Meet/Teams
 *    - Largura FIXA: 780px (nunca muda — previne flicker)
 *    - Altura dinâmica: cresce com o conteúdo (transcrição + respostas)
 *    - Totalmente transparente (background: transparent)
 *    - Click-through: cliques nas bordas transparentes passam para o app de baixo
 *    - Modo "indetectável": esconde de capturas de tela (setContentProtection)
 *    - Posição: canto superior direito, 3.5% abaixo do topo
 * 
 * FUNCIONALIDADES:
 * - Alternância entre Launcher ↔ Overlay (Cmd+B ou atalho)
 * - Conteúdo protegido (modo indetectável — esconde de screen recording)
 * - Opacidade ajustável (para o overlay ser mais discreto)
 * - Click-through inteligente (hover sobre conteúdo = interativo, hover sobre borda = transparente)
 * - Redimensionamento atomico (um único setBounds para evitar flicker)
 * - Modos de disfarce (finge ser terminal, editor, etc.)
 * 
 * POR QUE A LARGURA DO OVERLAY É FIXA (780px):
 * A janela overlay é MAIOR que o painel desenhado (600-780px) para permitir
 * bordas transparentes. A animação de expandir/recolher é CSS-only (tween
 * 600↔780 centralizado com mx-auto). Se a largura da janela mudasse via
 * setBounds, causaria SALTO LATERAL de 1 frame porque o Chromium não sincroniza
 * setBounds com o paint do renderer no macOS. Com largura fixa, isso NUNCA acontece.
 * =============================================================================
 */

import { app, BrowserWindow, Menu, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AppState } from './main';
import { KeybindManager } from './services/KeybindManager';

const isEnvDev = process.env.NODE_ENV === 'development';
const isPackaged = app.isPackaged;
const inAppBundle = process.execPath.includes('.app/') || process.execPath.includes('.app\\');

console.log(
  `[WindowHelper] isEnvDev: ${isEnvDev}, isPackaged: ${isPackaged}, inAppBundle: ${inAppBundle}`,
);

// Força o modo produção se estiver rodando como aplicativo empacotado ou dentro do bundle do app
const isDev = isEnvDev && !isPackaged;
const overlayResizeTracePath = '/tmp/refract-overlay-resize-trace.log';

function traceOverlayResize(event: string, data: Record<string, unknown>): void {
  if (!isDev) return;
  try {
    fs.appendFileSync(
      overlayResizeTracePath,
      `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`,
    );
  } catch {
    // Diagnósticos apenas para desenvolvimento nunca devem afetar o comportamento do overlay.
  }
}

const startUrl = isDev
  ? 'http://localhost:5180'
  : `file://${path.join(__dirname, '../../dist/index.html')}`;

export class WindowHelper {
  private launcherWindow: BrowserWindow | null = null;
  private overlayWindow: BrowserWindow | null = null;
  private isWindowVisible: boolean = false;
  // Rastreamento de posição/tamanho para o Launcher
  private launcherPosition: { x: number; y: number } | null = null;
  private launcherSize: { width: number; height: number } | null = null;
  private overlayBounds: Electron.Rectangle | null = null;
  // Rastrear o modo atual da janela (persiste até quando o overlay é ocultado via Cmd+B)
  private currentWindowMode: 'launcher' | 'overlay' = 'launcher';

  private appState: AppState;
  private contentProtection: boolean = false;
  private opacityTimeout: NodeJS.Timeout | null = null;
  private lastLauncherShowInactive: boolean | null = null;

  // Click-through condicionado ao hover: como a janela overlay de largura fixa (780)
  // é MAIOR que seu painel desenhado quando recolhida (600), as margens laterais
  // transparentes de ~90px precisam permitir que os cliques atravessem para o app
  // por trás em vez de capturar cliques mortos. O renderer testa o ponteiro contra
  // o retângulo do conteúdo desenhado e define esta flag: verdadeiro = ponteiro sobre
  // o painel/pílula desenhado (janela precisa capturar), falso = ponteiro sobre a
  // margem transparente (janela precisa permitir a passagem). Isto só se aplica no
  // modo INTERATIVO — quando o passthrough stealth mestre (overlayMousePassthrough)
  // está ativo, a janela é completamente click-through independentemente do hover.
  // Padrão verdadeiro para que a janela seja interativa antes do primeiro relatório
  // de hit-test do renderer chegar.
  private overlayHoverInteractive: boolean = true;

  // LARGURA FIXA DA JANELA OVERLAY — a janela do SO NASCE nesta largura, é EXIBIDA
  // nesta largura, e NUNCA é redimensionada em largura durante a vida útil do overlay.
  // Precisa ser igual à SHELL_WIDTH_EXPANDED do renderer (RefractInterface.tsx).
  //
  // Por que FIXA (a terceira correção final para o salto/flicker de redimensionamento):
  // o painel anima entre 600↔780 puramente em CSS, centralizado (mx-auto) dentro desta
  // janela fixa de 780. Como a largura da janela do SO nunca muda, sua origem X nunca
  // se mover — e toda a classe de bugs de salto/flicker era causada pela alteração
  // programática de largura via setBounds deslocando o X não meio da animação enquanto
  // o repaint do renderer atrasava um frame (Chromium não sincroniza setBounds com o
  // paint do renderer não macOS). Com a largura fixa não há setBounds de largura em
  // nenhum momento:
  //   • TopPill (centralizado na janela fixa) é pixel-estável.
  //   • Sem re-rasterização por frame da janela transparente com desfoque → zero flicker.
  // O invariante de deslizamento na inicialização ainda se mantém: largura-criada-da-janela
  // === largura-exibida (ambas 780), então a primeira pintura já está em sua origem final.
  // Quando o shell está recolhido (600 em uma janela de 780) as margens laterais de ~90px
  // são transparentes e tornam-se CLICK-THROUGH pela política de interação condicionada
  // ao hover (veja setOverlayHoverInteractive / syncOverlayInteractionPolicy).
  private static readonly OVERLAY_DEFAULT_WIDTH = 780;
  private static readonly OVERLAY_MIN_HEIGHT = 216;
  // Deslocamento vertical para a posição inicial do overlay de reunião, expresso como
  // uma fração da altura da área de trabalho da tela. 0.035 coloca a borda superior
  // ~37 px abaixo do topo da área de trabalho em uma tela de 1055 — confortavelmente
  // abaixo da barra de menus com espaço visível de respiro.
  private static readonly OVERLAY_DEFAULT_TOP_RATIO = 0.035;

  // Variáveis de movimento (aplicam à janela ativa)
  private step: number = 20;

  constructor(appState: AppState) {
    this.appState = appState;
  }

  private getDisplayWorkArea(bounds?: Electron.Rectangle): Electron.Rectangle {
    if (bounds) {
      return screen.getDisplayMatching(bounds).workArea;
    }
    if (this.overlayBounds) {
      return screen.getDisplayMatching(this.overlayBounds).workArea;
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return screen.getDisplayMatching(this.overlayWindow.getBounds()).workArea;
    }
    return screen.getPrimaryDisplay().workArea;
  }

  public setContentProtection(enable: boolean): void {
    // Deduplicação: setContentProtection é chamado de múltiplos caminhos (IPC de configurações,
    // fluxo de switchToOverlay/switchToLauncher, trabalho alternativo de Windows não Win+Tab).
    // Chamadas idênticas repetidas acionam instabilidade de afinidade DWM não Windows que
    // pode deixar o HWND em um estado de preto/branco transitório por alguns
    // centenas de ms. Não faz nada quando nada realmente muda.
    if (this.contentProtection === enable) return;
    this.contentProtection = enable;
    this.applyContentProtection(enable);
  }

  private applyContentProtection(enable: boolean): void {
    const windows = [this.launcherWindow, this.overlayWindow];
    windows.forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.setContentProtection(enable);
      }
    });
  }

  // Força a reaplicação do estado atual de proteção de conteúdo em todas as janelas ativas,
  // ignorando a proteção de deduplicação em setContentProtection(). Necessário porque
  // app.dock.hide()/show() alterna a política de ativação do macOS que faz o
  // WindowServer reavaliar cada NSWindow e pode silenciosamente reiniciar seu
  // sharingType (a flag NSWindowSharingNone que setContentProtection define).
  // O `this.contentProtection` em memória ainda está correto, então o setter
  // normal faria nada — precisamos empurrar o valor para o SO novamente incondicionalmente.
  public reassertContentProtection(): void {
    this.applyContentProtection(this.contentProtection);
  }

  public setWindowDimensions(width: number, height: number): void {
    const activeWindow = this.getMainWindow(); // Obtém a janela atualmente focada/relevante
    if (!activeWindow || activeWindow.isDestroyed()) return;

    const [currentX, currentY] = activeWindow.getPosition();
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workAreaSize;
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const newWidth = Math.min(width, maxAllowedWidth);
    const newHeight = Math.ceil(height);
    const maxX = workArea.width - newWidth;
    const newX = Math.min(Math.max(currentX, 0), maxX);

    activeWindow.setBounds({
      x: newX,
      y: currentY,
      width: newWidth,
      height: newHeight,
    });

    // Atualiza o rastreamento interno se para o launcher
    if (activeWindow === this.launcherWindow) {
      this.launcherSize = { width: newWidth, height: newHeight };
      this.launcherPosition = { x: newX, y: currentY };
    }
  }

  // Método dedicado para redimensionamento da janela overlay - desacoplado do launcher
  public setOverlayDimensions(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const currentBounds = this.overlayWindow.getBounds();
    const currentContentSize = this.overlayWindow.getContentSize();
    const currentX = currentBounds.x;
    const currentY = currentBounds.y;
    const workArea = this.getDisplayWorkArea(currentBounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth); // mín 300, máx 90%
    const newHeight = Math.min(Math.max(height, 1), maxAllowedHeight); // mín 1, máx 90%
    const maxX = workArea.x + workArea.width - newWidth;
    const maxY = workArea.y + workArea.height - newHeight;
    const newX = Math.min(Math.max(currentX, workArea.x), maxX);
    const newY = Math.min(Math.max(currentY, workArea.y), maxY);

    if (
      Math.abs(newWidth - currentContentSize[0]) <= 1 &&
      Math.abs(newHeight - currentContentSize[1]) <= 1 &&
      newX === currentBounds.x &&
      newY === currentBounds.y
    ) {
      return;
    }

    this.overlayWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    this.overlayBounds = this.overlayWindow.getBounds();
  }

  // Variante de setOverlayDimensions que mantém o centro HORIZONTAL da janela
  // fixo durante alterações de largura. Usado por animações de expansão de código para
  // que o shell (centralizado com mx-auto) não pareça pular lateralmente quando a
  // janela cresce: a janela cresce simetricamente (X desloca -widthDelta/2), e
  // mx-auto compensa reduzindo a margem igualmente — movimento visual líquido = 0.
  public setOverlayDimensionsCentered(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const currentBounds = this.overlayWindow.getBounds();
    const currentContentSize = this.overlayWindow.getContentSize();
    const workArea = this.getDisplayWorkArea(currentBounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth);
    const newHeight = Math.min(Math.max(height, 1), maxAllowedHeight);
    traceOverlayResize('setOverlayDimensionsCentered:request', {
      requested: { width, height },
      currentBounds,
      currentContentSize,
      workArea,
      maxAllowed: { width: maxAllowedWidth, height: maxAllowedHeight },
      computed: { width: newWidth, height: newHeight },
      clampedHeight: newHeight !== height,
    });

    // Calcula X para que o centro horizontal do conteúdo permaneça fixo durante o redimensionamento.
    const widthDelta = newWidth - currentContentSize[0];
    const desiredX = currentBounds.x - Math.floor(widthDelta / 2);

    const maxX = workArea.x + workArea.width - newWidth;
    const newX = Math.min(Math.max(desiredX, workArea.x), maxX);
    const maxY = workArea.y + workArea.height - newHeight;
    const newY = Math.min(Math.max(currentBounds.y, workArea.y), maxY);

    if (
      Math.abs(newWidth - currentContentSize[0]) <= 1 &&
      Math.abs(newHeight - currentContentSize[1]) <= 1 &&
      newX === currentBounds.x &&
      newY === currentBounds.y
    ) {
      traceOverlayResize('setOverlayDimensionsCentered:noop', {
        requested: { width, height },
        currentBounds,
        currentContentSize,
        computed: { x: newX, y: newY, width: newWidth, height: newHeight },
      });
      return;
    }

    // Atomic frame change: a único setBounds avoids o 1-frame divide onde
    // o OS janela tem o novo tamanho mas o antigo origin (ou vice versa), que
    // what it causes o shell para visibly slide e snap durante code-expansion.
    this.overlayWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    this.overlayBounds = this.overlayWindow.getBounds();
    traceOverlayResize('setOverlayDimensionsCentered:applied', {
      requested: { width, height },
      appliedBounds: this.overlayBounds,
      contentSizeAfter: this.overlayWindow.getContentSize(),
    });
  }

  // NOTE: o overlay janela é a FIXED WIDTH (OVERLAY_DEFAULT_WIDTH = 780) para
  // its entire visible lifetime. O expand/contract animação é CSS-only em
  // o renderer (o painel tweens 600↔780 centered dentro o fixed window).
  // O renderer portanto apenas já reports `width: 780` to
  // setOverlayDimensionsCentered, então o largura delta é sempre 0, X nunca mmove
  // e apenas HEIGHT já changes (content/streaming growth). A height-only
  // setBounds é top-anchored e faz não mover X, então it cannot cause o
  // sideways jump. See RefractInterface.startTransition (CSS-only) para o
  // renderer side de isso contract.

  public createWindow(): void {
    if (this.launcherWindow !== null) return; // Já created

    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    // Fixed dimensions por user requisição
    const width = 1200;
    const height = 800;

    // Calcula centered X, e top-centered Y (5% de top)
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    // Garante y é at menos workArea.y (don't go offscreen top)
    const topMargin = Math.round(workArea.height * 0.05);
    const y = Math.round(workArea.y + topMargin);

    // --- 1. Cria Launcher Window ---
    const isMac = process.platform === 'darwin';

    const launcherSettings: Electron.BrowserWindowConstructorOptions = {
      width: width,
      height: height,
      x: x,
      y: y,
      minWidth: 600,
      minHeight: 400,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        scrollBounce: true,
        webSecurity: !isDev, // DDepurar Desabilitar web security apenas em dev
      },
      show: false, // DDepurar Force mostrar -> Fixed white screen, agora relies em ready-to-show
      // Platform-specific frame settings
      ...(isMac
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
        : { frame: false, titleBarOverlay: false, autoHideMenuBar: true }),
      ...(isMac
        ? { vibrancy: 'under-window' as const, visualEffectState: 'followWindow' as const }
        : {}),
      transparent: isMac,
      hasShadow: true,
      // O launcher inicia com o black logo splash. Uso a black native
      // fundo também então macOS doesn't mostrar a grey/white transparent-window
      // flash antes o renderer paints.
      backgroundColor: '#000000',
      focusable: true,
      resizable: true,
      movable: true,
      center: true,
      icon: (() => {
        const isMac = process.platform === 'darwin';
        const isWin = process.platform === 'win32';
        const mode = this.appState.getDisguise();

        if (mode === 'none') {
          if (isMac) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'refract.icns')
              : path.resolve(__dirname, '../../assets/refract.icns');
          } else if (isWin) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'assets/icons/win/icon.ico')
              : path.resolve(__dirname, '../../assets/icons/win/icon.ico');
          } else {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'icon.png')
              : path.resolve(__dirname, '../../assets/icon.png');
          }
        }

        // Disguise modo icons
        let iconName = 'terminal.png';
        if (mode === 'settings') iconName = 'settings.png';
        if (mode === 'activity') iconName = 'activity.png';

        const platformDir = isWin ? 'win' : 'mac';
        return app.isPackaged
          ? path.join(process.resourcesPath, `assets/fakeicon/${platformDir}/${iconName}`)
          : path.resolve(__dirname, `../../assets/fakeicon/${platformDir}/${iconName}`);
      })(),
    };

    console.log(`[WindowHelper] Icon Path: ${launcherSettings.icon}`);
    console.log(`[WindowHelper] Start URL: ${startUrl}`);

    try {
      this.launcherWindow = new BrowserWindow(launcherSettings);
      console.log('[WindowHelper] BrowserWindow created successfully');
    } catch (err) {
      console.error('[WindowHelper] Failed to create BrowserWindow:', err);
      return;
    }

    this.launcherWindow.setContentProtection(this.contentProtection);
    
    // FASE 4: Registrar a main window no AgentManager
    try {
        const { AgentManager } = require('./services/AgentManager');
        AgentManager.getInstance().setMainWindow(this.launcherWindow);
    } catch (e) {
        console.error('[WindowHelper] Failed to bind AgentManager to window:', e);
    }

    this.launcherWindow
      .loadURL(`${startUrl}?window=launcher`)
      .then(() => console.log('[WindowHelper] loadURL success'))
      .catch((e) => {
        console.error('[WindowHelper] Failed to load URL:', e);
      });

    this.launcherWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`[WindowHelper] did-fail-load: ${errorCode} ${errorDescription}`);
    });

    // se (isDev) {
    //   this.launcherWindow.webContents.openDevTools({ mmodo 'ddesanexar }); // DDepurar Abrir DevTools
    // }

    // --- 2. Cria Overlay Window (Hidden initially) ---
    // Sempre inicia centered em o primário exibir então o OS (macOS NSUserDefaults /
    // Windows DWM) cannot restore o anterior session's cached janela position.
    // O in-memory `overlayBounds` é já nulo haqui então `switchToOverlay()`
    // vai também fall voltar para centered logic — mas providing explicit x/y em o
    // constructor é o apenas reliable proteger contra OS-level posição persistence.
    const overlayDefaultX = Math.floor(
      workArea.x + (workArea.width - WindowHelper.OVERLAY_DEFAULT_WIDTH) / 2,
    );
    const overlayDefaultY = Math.floor(
      workArea.y + workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO,
    );

    const overlaySettings: Electron.BrowserWindowConstructorOptions = {
      width: WindowHelper.OVERLAY_DEFAULT_WIDTH,
      height: 1,
      x: overlayDefaultX,
      y: overlayDefaultY,
      minWidth: 300,
      minHeight: 1,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        scrollBounce: true,
      },
      show: false,
      frame: false, // Frameless
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: true,
      resizable: false, // Enforce automatic resizing apenas
      movable: true,
      skipTaskbar: true, // Don't mostrar separately em dock/taskbar
      hasShadow: false, // Prevenir shadow de adding perceived size/artifacts
      // macOS NSPanel + nonactivating: lets o overlay become o chave window
      // (and recebe keystrokes para o chat ientrada sem activating Refract
      // em o dock / menu barra / screen-share, então o user's foreground app
      // stays "em front." Required para o chat:focusInput stealth-typing pcaminho
      // Windows/Linux fall voltar para a regular focusable window.
      ...(isMac ? { type: 'panel' as const } : {}),
    };

    this.overlayWindow = new BrowserWindow(overlaySettings);
    this.overlayWindow.setContentProtection(this.contentProtection);

    // Registra o overlay como o sole recipient de CGEventTap captured-key
    // broadcasts. Sem this, captured keystrokes fan fora para Todos windows
    // (settings, cropper, etetc — silent privacy/security exposure.
    if (process.platform === 'darwin') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
        StealthKeyboardManager.getInstance().setOverlayWindow(this.overlayWindow);
      } catch (e) {
        console.error('[WindowHelper] failed to register overlay with StealthKeyboardManager:', e);
      }
    }

    if (process.platform === 'darwin') {
      this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.overlayWindow.setHiddenInMissionControl(true);
      this.overlayWindow.setAlwaysOnTop(true, 'floating');

      // Aplica Spotlight/Alfred-grade stealth attributes que Electron faz não
      // expose: becomesKeyOnlyIfNeeded (clicks em buttons / surfaces don't
      // promote o painel para chave janela → user's foreground app keeps chave
      // estado em o dock, menu bar, screen-share, focus-followers),
      // hidesOnDeactivate=NO, e o direito collectionBehavior. Sem this,
      // Qualquer click em o overlay (button, ientrada aem qualquer lugar activates Refract
      // e dims o user's foreground app — até com type:'panel' sdefine
      //
      // DEFERRED para `ready-to-show`: getNativeWindowHandle() Retorna o
      // NSView ponteiro imediatamente após `new BrowserWindow`, mas o view's
      // [NSView window] pode briefly ser nil antes Electron finaliza attaching
      // o visão para its NSWindow. Calling agora races e o Rust side Retorna
      // "NSView tem não associated NSWindow" → silent alternativa para plain panel.
      // ready-to-show fires Após o NSWindow é attached e o renderer
      // tem performed its primeiro paint, então o janela é guaranteed live.
      //
      // Optional: exige o rebuilt native módulo (npm executa build:native).
      // If o binário predates isso método we silently spular clicks vai ainda
      // soft-activate o painel como antes mas type:'panel' alone keeps o
      // dock ícone fora de o way. Existing users see não regression.
      this.overlayWindow.once('ready-to-show', () => {
        if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { loadNativeModule } = require('./audio/nativeModuleLoader');
          const native = loadNativeModule();
          if (native && typeof native.applyStealthToWindow === 'function') {
            native.applyStealthToWindow(this.overlayWindow.getNativeWindowHandle());
            console.log('[WindowHelper] Applied stealth NSPanel attributes to overlay');
          } else {
            console.warn(
              '[WindowHelper] applyStealthToWindow unavailable — rebuild native module (npm run build:native) for full stealth',
            );
          }
        } catch (e) {
          console.error('[WindowHelper] Failed to apply stealth attributes:', e);
        }
      });
    } else if (process.platform === 'win32') {
      // 'floating' nível (HWND_TOPMOST baseline) é não enough para renderizar acima
      // fullscreen browser windows (F11). 'screen-saver' uses a higher TOPMOST
      // priority que wins contra window-mode fullscreen apps. macOS uses
      // visibleOnFullScreen aacima Windows tem não equivalent fflag então o nível
      // si mesmo what it controla fullscreen visibility. See issue #167.
      this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    this.overlayWindow.loadURL(`${startUrl}?window=overlay`).catch((e) => {
      console.error('[WindowHelper] Failed to load Overlay URL:', e);
    });

    // --- 3. Startup Sequence ---
    this.launcherWindow.once('ready-to-show', () => {
      this.switchToLauncher();
      this.isWindowVisible = true;
    });

    this.setupWindowListeners();
  }

  private setupWindowListeners(): void {
    if (!this.launcherWindow) return;

    // Suprimir Windows system contexto menu em right-click (title bar)
    this.launcherWindow.on('system-context-menu', (e, point) => {
      e.preventDefault();
      if (!this.appState.getUndetectable()) {
        this.showContextMenu(this.launcherWindow!, point);
      }
    });

    this.launcherWindow.on('move', () => {
      if (this.launcherWindow) {
        const bounds = this.launcherWindow.getBounds();
        this.launcherPosition = { x: bounds.x, y: bounds.y };
        this.appState.settingsWindowHelper.reposition(bounds);
      }
    });

    this.launcherWindow.on('resize', () => {
      if (this.launcherWindow) {
        const bounds = this.launcherWindow.getBounds();
        this.launcherSize = { width: bounds.width, height: bounds.height };
        this.appState.settingsWindowHelper.reposition(bounds);
      }
    });

    // Em Windows/Linux: intercept fechar e ocultar para tray em vez disso de quitting,
    // a menos que o app é actually quitting (e.g. de tray "Quit" menu).
    if (process.platform !== 'darwin') {
      this.launcherWindow.on('close', (e) => {
        if (!this.appState.isQuitting()) {
          e.preventDefault();
          this.launcherWindow?.hide();
          this.isWindowVisible = false;
        }
      });

      // Sincronizar maximizar estado para renderer então WindowControls stays em sincronizar (Windows/Linux oapenas
      this.launcherWindow.on('maximize', () => {
        this.launcherWindow?.webContents.send('window-maximized-changed', true);
      });
      this.launcherWindow.on('unmaximize', () => {
        this.launcherWindow?.webContents.send('window-maximized-changed', false);
      });
    }

    this.launcherWindow.on('closed', () => {
      this.launcherWindow = null;
      // If launcher cfecha we deve provavelmente quit app ou fechar overlay
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.close();
      }
      this.overlayWindow = null;
      this.isWindowVisible = false;
    });

    // Ouvir para overlay fechar (e.g. Cmd+W). Nunca verdadeiramente destruir it — qualquer um
    // ocultar it (durante a meeting) ou trocar voltar para launcher (entre meetings).
    if (this.overlayWindow) {
      this.overlayWindow.on('move', () => {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayBounds = this.overlayWindow.getBounds();
        }
      });

      this.overlayWindow.on('resize', () => {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayBounds = this.overlayWindow.getBounds();
        }
      });

      this.overlayWindow.on('system-context-menu', (e, point) => {
        e.preventDefault();
        if (!this.appState.getUndetectable()) {
          this.showContextMenu(this.overlayWindow!, point);
        }
      });

      // Re-assert always-on-top em desfocar (Windows onapenas Screen-sharing tools
      // (ZAmpliar Lark, Teams, etetc hook o DWM compositor e pode demote até
      // HWND_TOPMOST windows abaixo their shared conteúdo layer. Re-applying o
      // 'screen-saver' nível em todo desfocar keeps o overlay acima o share
      // surface. Skipped em macOS — re-asserting setAlwaysOnTop lá aciona
      // [NSApp activate], que steals focar de o underlying app. See #130.
      if (process.platform === 'win32') {
        this.overlayWindow.on('blur', () => {
          if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
          if (!this.overlayWindow.isVisible()) return;
          this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        });
      }

      this.overlayWindow.on('close', (e) => {
        if (this.overlayWindow?.isVisible()) {
          e.preventDefault();
          if (this.appState.getIsMeetingActive()) {
            // Meeting executando — apenas ocultar a sobreposição; user pode retomar de o
            // launcher's "Meeting ongoing" botão que calls setWindowMode('overlay').
            this.hideOverlay();
          } else {
            this.switchToLauncher();
          }
        }
      });
    }
  }

  // Auxiliar para obtém qualquer que janela deve ser treated como "MPrincipal para IPC
  public getMainWindow(): BrowserWindow | null {
    if (this.currentWindowMode === 'overlay' && this.overlayWindow) {
      return this.overlayWindow;
    }
    return this.launcherWindow;
  }

  // Específico getters se needed
  public getLauncherWindow(): BrowserWindow | null {
    return this.launcherWindow;
  }
  public getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow;
  }
  public getCurrentWindowMode(): 'launcher' | 'overlay' {
    return this.currentWindowMode;
  }

  // Limpa o remembered overlay posição então o próximo switchToOverlay() call
  // abre at o padrão centered posição (chamado em novo meeting stinicia
  public resetOverlayPosition(): void {
    this.overlayBounds = null;
    console.log('[WindowHelper] Overlay position reset to default for next meeting.');
  }

  public getLastOverlayBounds(): Electron.Rectangle | null {
    // If não in-memory bounds exist, retorna nulo para signify não user-initiated movement.
    if (this.overlayBounds) return { ...this.overlayBounds };
    return null;
  }

  public getLastOverlayDisplayId(): number | null {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return null;
    const bounds = this.overlayWindow.getBounds();
    return screen.getDisplayMatching(bounds).id;
  }

  public isVisible(): boolean {
    return this.isWindowVisible;
  }

  public isMainWindowMaximized(): boolean {
    const win = this.launcherWindow;
    return !!win && !win.isDestroyed() && win.isMaximized();
  }

  public hideMainWindow(): void {
    // Fazer Não chamar setOpacity(0) antes hiocultar em macOS — it causes WindowServer to
    // re-register o app como a regular window, breaking undetectable/stealth modo
    // (fixed em v2.0.8, regressed quando opacidade era re-added para screenshot flash).
    // Screenshot capture já aguarda 80ms após hiocultar para compositor flush.
    if (process.platform === 'win32') {
      this.launcherWindow?.setOpacity(0);
      this.overlayWindow?.setOpacity(0);
    }
    this.launcherWindow?.hide();
    this.overlayWindow?.hide();
    this.lastLauncherShowInactive = null;
    this.isWindowVisible = false;
  }

  // Renderer-driven hit-test result: é o ponteiro atualmente sobre o painted
  // panel/pill (tverdadeiro ou sobre a transparent margem / fora de (false)? O
  // renderer debounces isso para estado changes oapenas então isso é low-frequency.
  // Re-applies o combined interaction ppolítica mas apenas matters em interactive
  // modo — stealth passthrough sempre wins (handled em sincronizar beabaixo
  public setOverlayHoverInteractive(interactive: boolean): void {
    if (this.overlayHoverInteractive === interactive) return;
    this.overlayHoverInteractive = interactive;
    this.syncOverlayInteractionPolicy();
  }

  // Aplica o combined click-through (mouse passthrough) política em o overlay
  // window. Lá são TWO inputs:
  //   1. overlayMousePassthrough (master stealth toalternar quando Em o janela é
  //      Sempre completamente click-through independentemente de hover (user é em outro app).
  //   2. overlayHoverInteractive (renderer hit-test): em interactive mmodo o
  //      janela captures clicks apenas quando o ponteiro é sobre o painted panel;
  //      sobre o transparent side-margins it passes clicks através então they hit
  //      o app atrás em vez disso de sendo swallowed como dead clicks.
  // Chamado sempre que Qualquer um entrada changes.
  public syncOverlayInteractionPolicy(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const passthrough = this.appState.getOverlayMousePassthrough();

    // Click-through sempre que stealth passthrough é oem Ou (em interactive mmodo
    // o ponteiro é não sobre o painted content. forward:true keeps ponteiro
    // events flowing para o OS layer debaixo em qualquer um click-through case.
    const ignoreMouse = passthrough || !this.overlayHoverInteractive;

    if (ignoreMouse) {
      // fpara frente verdadeiro — ponteiro events são ainda delivered para o OS layer bdebaixo
      // NOTE: We intentionally fazer Não chamar setFocusable(false) haqui
      //
      // Rationale: setIgnoreMouseEvents() alone é suficiente para transparent
      // mouse behaviour.  Configuração focusable=false quando o overlay é o apenas
      // visible janela makes macOS treat o app como having Não ativo windows.
      // Em que sestado macOS pode para delivering Carbon/IOKit global hotkey
      // events para o processo — silently breaking todo globalShortcut binding.
      // Keeping o janela focusable costs nnada
      this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log(
        `[WindowHelper] Overlay click-through ON (passthrough=${passthrough}, hoverInteractive=${this.overlayHoverInteractive})`,
      );
    } else {
      this.overlayWindow.setIgnoreMouseEvents(false);
      // Restore completo interactivity quando capturing clicks.
      this.overlayWindow.setFocusable(true);
      console.log('[WindowHelper] Overlay click-through OFF (interactive, pointer over panel)');
    }
  }

  // Mostrar overlay directly sem going através completo switchToOverlay flow.
  // Usado pelos manipuladores IPC para exibir a sobreposição independentemente.
  public showOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    // Restore opacidade em case it era zeroed por hideMainWindow() antes a screenshot.
    this.overlayWindow.setOpacity(1);

    // Re-assert z-order em Windows antes showing — mesmo DWM demotion risk como
    // switchToOverlay(). Precisa come antes show()/showInactive() então o window
    // lands at o correto nível em primeiro paint (issue #136).
    if (process.platform === 'win32') {
      this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    if (this.appState.getOverlayMousePassthrough()) {
      // Em passthrough/stealth mmodo appear em tela sem stealing OS ffocar
      // O underlying app (ZAmpliar browser, etetc precisa keep ffocar
      this.overlayWindow.showInactive();
    } else {
      // Normal interactive mmodo mostrar e focar então o user pode click/type.
      this.overlayWindow.showInactive();
      // Bring para front sem a completo app-activate (avoids dock bounce em macOS).
      // setAlwaysOnTop é já define at creation; a fofocar chamar alone é safe.
      this.overlayWindow.focus();
    }
  }

  // Ocultar overlay directly sem switching para launcher.
  // Usado pelos manipuladores IPC para ocultar a sobreposição independentemente.
  public hideOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide();
    }
  }

  public showMainWindow(inactive?: boolean): void {
    // Mostrar o janela corresponding para o atual modo
    if (this.currentWindowMode === 'overlay') {
      this.switchToOverlay(inactive);
    } else {
      this.switchToLauncher(inactive);
    }
  }

  public toggleMainWindow(): void {
    if (this.isWindowVisible) {
      this.hideMainWindow();
    } else {
      // Sempre mostrar sem stealing focar — Refract é a ghost overlay.
      // O usuário está em outro app; exibir a janela não topo mas não interferir não foco do SO.
      // They pode click o janela para focar it se they precisa para ttipo
      this.showMainWindow(true);
    }
  }

  public toggleOverlayWindow(): void {
    this.toggleMainWindow();
  }

  public centerAndShowWindow(): void {
    // If a meeting é ativo (overlay momodo bring o overlay para cima em vez disso de o
    // launcher — switching para o launcher durante a meeting iria expor it em o
    // taskbar/dock e break stealth.
    const stealthShow = this.appState.getUndetectable();
    if (this.currentWindowMode === 'overlay') {
      // Em undetectable mmodo mostrar sem stealing focar de o foreground app.
      this.switchToOverlay(stealthShow ? true : undefined);
    } else {
      this.switchToLauncher(stealthShow ? true : undefined);
      this.launcherWindow?.center();
    }
  }

  // --- Swapping Logic ---

  public switchToOverlay(inactive?: boolean): void {
    console.log(`[WindowHelper] Switching to OVERLAY (inactive: ${!!inactive})`);
    this.currentWindowMode = 'overlay';
    KeybindManager.getInstance().setMode('overlay'); // Adapted de public PR #123 — verifica premium interaction

    // Mostrar Overlay Primeiro
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      const currentBounds = this.overlayWindow.getBounds();
      const savedBounds = this.overlayBounds
        ? {
            ...this.overlayBounds,
            height: Math.max(this.overlayBounds.height, WindowHelper.OVERLAY_MIN_HEIGHT),
          }
        : null;
      const workArea = this.getDisplayWorkArea(savedBounds ?? currentBounds);
      const maxAllowedWidth = Math.floor(workArea.width * 0.9);
      const maxAllowedHeight = Math.floor(workArea.height * 0.9);
      const targetBounds = savedBounds
        ? {
            x: Math.min(
              Math.max(savedBounds.x, workArea.x),
              workArea.x + workArea.width - Math.min(savedBounds.width, maxAllowedWidth),
            ),
            y: Math.min(
              Math.max(savedBounds.y, workArea.y),
              workArea.y + workArea.height - Math.min(savedBounds.height, maxAllowedHeight),
            ),
            width: Math.min(savedBounds.width, maxAllowedWidth),
            height: Math.min(savedBounds.height, maxAllowedHeight),
          }
        : {
            x: Math.floor(workArea.x + (workArea.width - WindowHelper.OVERLAY_DEFAULT_WIDTH) / 2),
            y: Math.floor(workArea.y + workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO),
            width: WindowHelper.OVERLAY_DEFAULT_WIDTH,
            height: Math.max(
              Math.min(currentBounds.height, maxAllowedHeight),
              WindowHelper.OVERLAY_MIN_HEIGHT,
            ),
          };

      this.overlayWindow.setBounds(targetBounds);
      this.overlayBounds = this.overlayWindow.getBounds();
      this.overlayWindow.webContents.send('ensure-expanded');

      // Restore opacidade antes showing (it pode ter sido zeroed por hideMainWindow).
      if (process.platform === 'win32' && this.contentProtection) {
        // Opacity Shield: Mostrar at 0 opacidade primeiro para prevenir frame leak
        this.overlayWindow.setOpacity(0);
        if (inactive) this.overlayWindow.showInactive();
        else this.overlayWindow.show();
        this.overlayWindow.setContentProtection(true);
        // Pequeno atrasar para garante Windows DWM processa o flag antes making it opaque

        if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
        this.opacityTimeout = setTimeout(() => {
          if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            this.overlayWindow.setOpacity(1);
            // Re-assert z-order em Windows — DWM pode silently demote o HWND após hide/show
            this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
            if (!inactive) this.overlayWindow.focus();
          }
        }, 60);
      } else {
        // Restore opacidade (pode ter sido zeroed pre-screenshot por hideMainWindow)
        this.overlayWindow.setOpacity(1);
        this.overlayWindow.setContentProtection(this.contentProtection);
        // Re-assert z-order Antes mostrar em Windows — DWM processa setAlwaysOnTop
        // synchronously, então calling it antes shmostrar garante o janela lands at o
        // correto z-level em primeiro paint. Calling it após fofocar iria leave a brief
        // janela onde o HWND é focused at o wrong z-level (issue #136).
        // Skipped em macOS — calling setAlwaysOnTop aciona [NSApp activate] que
        // steals focar de Zoom/browser até quando showInactive() era used.
        if (process.platform === 'win32') {
          this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        }
        if (inactive) this.overlayWindow.showInactive();
        else this.overlayWindow.show();
        // Apenas grab focar para explicit user-initiated mostra (não shortcut/ghost smostra
        if (!inactive) this.overlayWindow.focus();
      }
      this.isWindowVisible = true;
    }

    // Ocultar Launcher Segundo
    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      this.launcherWindow.hide();
      this.lastLauncherShowInactive = null;
    }
  }

  public switchToLauncher(inactive?: boolean): void {
    const requestedInactive = !!inactive;
    console.log(`[WindowHelper] Switching to LAUNCHER (inactive: ${requestedInactive})`);
    const wasLauncher = this.currentWindowMode === 'launcher';
    this.currentWindowMode = 'launcher';
    KeybindManager.getInstance().setMode('launcher'); // Adapted de public PR #123 — verifica premium interaction

    const launcherAlreadyVisible =
      !!this.launcherWindow &&
      !this.launcherWindow.isDestroyed() &&
      this.launcherWindow.isVisible() &&
      this.isWindowVisible;
    const overlayAlreadyHidden =
      !this.overlayWindow ||
      this.overlayWindow.isDestroyed() ||
      !this.overlayWindow.isVisible();

    // Cold-start pode chamar switchToLauncher twice (launcher ready-to-show plus
    // startup convergence paths). If o launcher é já visible com o
    // mesmo focar semantics e o overlay é já hidden, pular repeated
    // opacity/show/focus work então Chromium/WindowServer don't repaint mid-animation.
    if (
      wasLauncher &&
      launcherAlreadyVisible &&
      overlayAlreadyHidden &&
      this.lastLauncherShowInactive === requestedInactive
    ) {
      console.log('[WindowHelper] Launcher already visible; skipping duplicate show');
      return;
    }

    // Mostrar Launcher Primeiro
    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      if (process.platform === 'win32' && this.contentProtection) {
        // Opacity Shield: Mostrar at 0 opacidade primeiro
        this.launcherWindow.setOpacity(0);
        if (inactive) this.launcherWindow.showInactive();
        else this.launcherWindow.show();
        this.launcherWindow.setContentProtection(true);

        if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
        this.opacityTimeout = setTimeout(() => {
          if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
            this.launcherWindow.setOpacity(1);
            if (!inactive) this.launcherWindow.focus();
          }
        }, 60);
      } else {
        // Restore opacidade (pode ter sido zeroed pre-screenshot por hideMainWindow)
        this.launcherWindow.setOpacity(1);
        this.launcherWindow.setContentProtection(this.contentProtection);
        if (inactive) this.launcherWindow.showInactive();
        else this.launcherWindow.show();
        if (!inactive) this.launcherWindow.focus();
      }
      this.lastLauncherShowInactive = requestedInactive;
      this.isWindowVisible = true;
    }

    // Ocultar Overlay Segundo
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide();
    }
  }

  // Simplified setWindowMode que apenas calls switchers
  public setWindowMode(mode: 'launcher' | 'overlay', inactive?: boolean): void {
    if (mode === 'launcher') {
      this.switchToLauncher(inactive);
    } else {
      this.switchToOverlay(inactive);
    }
  }

  // --- Window Movement (Aplica para Overlay mmajoritariamente mas generalized para active) ---
  private moveActiveWindow(dx: number, dy: number): void {
    const win = this.getMainWindow();
    if (!win) return;

    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }

  public moveWindowRight(): void {
    this.moveActiveWindow(this.step, 0);
  }
  public moveWindowLeft(): void {
    this.moveActiveWindow(-this.step, 0);
  }
  public moveWindowDown(): void {
    this.moveActiveWindow(0, this.step);
  }
  public moveWindowUp(): void {
    this.moveActiveWindow(0, -this.step);
  }

  private showContextMenu(win: BrowserWindow, point: { x: number; y: number }): void {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Developer Console',
        click: () => {
          win.webContents.toggleDevTools();
        },
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win, x: point.x, y: point.y });
  }

  public minimizeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
    win.minimize();
  }

  public maximizeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }

  public closeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
    // Em Windows/Linux o 'cfechar evento ouvinte intercepts this
    // e oculta para tray a menos que o app é actually quitting.
    win.close();
  }

  // ─── Language Learning Window ────────────────────────────────────────
  private languageLearningWindow: BrowserWindow | null = null;
  private static LL_DEFAULT_WIDTH = 380;
  private static LL_DEFAULT_HEIGHT = 280;

  // ─── Replica / Interview Coach Window ──────────────────────────────────
  private replicaWindow: BrowserWindow | null = null;
  private static REPLICA_DEFAULT_WIDTH = 480;
  private static REPLICA_DEFAULT_HEIGHT = 720;

  public createLanguageLearningWindow(): void {
    if (this.languageLearningWindow && !this.languageLearningWindow.isDestroyed()) {
      this.languageLearningWindow.show();
      this.languageLearningWindow.focus();
      return;
    }

    // Usa o startUrl global (dev/prod corretos). O caminho local '../dist'
    // resolvia para dist-electron/dist/index.html no build empacotado —
    // arquivo inexistente → janela carregava falha e nunca ficava visível.
    const workArea = screen.getPrimaryDisplay().workArea;
    const x = workArea.x + workArea.width - WindowHelper.LL_DEFAULT_WIDTH - 20;
    const y = workArea.y + 40;

    const settings: Electron.BrowserWindowConstructorOptions = {
      width: WindowHelper.LL_DEFAULT_WIDTH,
      height: WindowHelper.LL_DEFAULT_HEIGHT,
      x,
      y,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: false,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hasShadow: false,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    };

    this.languageLearningWindow = new BrowserWindow(settings);
    this.languageLearningWindow.setContentProtection(this.contentProtection);

    // Limpa a referência quando a janela é destruída (mesma proteção da replica).
    this.languageLearningWindow.on('closed', () => {
      this.languageLearningWindow = null;
    });

    if (process.platform === 'darwin') {
      this.languageLearningWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.languageLearningWindow.setAlwaysOnTop(true, 'floating');
    } else if (process.platform === 'win32') {
      this.languageLearningWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    this.languageLearningWindow.loadURL(`${startUrl}?window=language-learning`).catch((e) => {
      console.error('[WindowHelper] Failed to load Language Learning URL:', e);
    });

    // Failsafe: se ready-to-show não disparar (carga lenta/falha), a janela
    // nunca pode ficar invisível para sempre após uma ação do usuário.
    const llShowFallback = setTimeout(() => {
      if (this.languageLearningWindow && !this.languageLearningWindow.isDestroyed() && !this.languageLearningWindow.isVisible()) {
        console.warn('[WindowHelper] Language Learning ready-to-show timeout — forcing show');
        this.languageLearningWindow?.show();
      }
    }, 5000);
    this.languageLearningWindow.once('ready-to-show', () => {
      clearTimeout(llShowFallback);
      this.languageLearningWindow?.show();
    });
  }

  public toggleLanguageLearningOverlay(): void {
    if (!this.languageLearningWindow || this.languageLearningWindow.isDestroyed()) {
      this.createLanguageLearningWindow();
      return;
    }
    if (this.languageLearningWindow.isVisible()) {
      this.languageLearningWindow.hide();
    } else {
      this.languageLearningWindow.show();
      this.languageLearningWindow.focus();
    }
  }

  // ─── Replica / Interview Coach Window ──────────────────────────────────

  public createReplicaWindow(): void {
    if (this.replicaWindow && !this.replicaWindow.isDestroyed()) {
      this.replicaWindow.show();
      this.replicaWindow.focus();
      return;
    }

    // Usa o startUrl global (dev/prod corretos). O caminho local '../dist'
    // resolvia para dist-electron/dist/index.html no build empacotado —
    // arquivo inexistente → loadURL falhava, ready-to-show nunca disparava
    // e a janela criada com show:false ficava invisível ("botão não faz nada").
    const workArea = screen.getPrimaryDisplay().workArea;
    const x = workArea.x + workArea.width - WindowHelper.REPLICA_DEFAULT_WIDTH - 20;
    const y = workArea.y + 40;

    const settings: Electron.BrowserWindowConstructorOptions = {
      width: WindowHelper.REPLICA_DEFAULT_WIDTH,
      height: WindowHelper.REPLICA_DEFAULT_HEIGHT,
      x,
      y,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: true,
      resizable: true,
      movable: true,
      skipTaskbar: true,
      hasShadow: false,
      minWidth: 400,
      minHeight: 500,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    };

    this.replicaWindow = new BrowserWindow(settings);
    this.replicaWindow.setContentProtection(this.contentProtection);

    // Limpa a referência quando a janela é destruída — evita stale ref
    // que faria createReplicaWindow/show operar sobre janela morta.
    this.replicaWindow.on('closed', () => {
      this.replicaWindow = null;
    });

    if (process.platform === 'darwin') {
      this.replicaWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.replicaWindow.setAlwaysOnTop(true, 'floating');
    } else if (process.platform === 'win32') {
      this.replicaWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    this.replicaWindow.loadURL(`${startUrl}?window=replica`).catch((e) => {
      console.error('[WindowHelper] Failed to load Replica URL:', e);
    });

    // Failsafe: se ready-to-show não disparar (carga lenta/falha), a janela
    // nunca pode ficar invisível para sempre após um clique do usuário.
    const replicaShowFallback = setTimeout(() => {
      if (this.replicaWindow && !this.replicaWindow.isDestroyed() && !this.replicaWindow.isVisible()) {
        console.warn('[WindowHelper] Replica ready-to-show timeout — forcing show');
        this.replicaWindow?.show();
      }
    }, 5000);
    this.replicaWindow.once('ready-to-show', () => {
      clearTimeout(replicaShowFallback);
      this.replicaWindow?.show();
    });
  }

  public toggleReplicaOverlay(): void {
    if (!this.replicaWindow || this.replicaWindow.isDestroyed()) {
      this.createReplicaWindow();
      return;
    }
    if (this.replicaWindow.isVisible()) {
      this.replicaWindow.hide();
    } else {
      this.replicaWindow.show();
      this.replicaWindow.focus();
    }
  }

  // Fecha (esconde) a janela de practice a partir da própria UI dela.
  // A janela é frameless + skipTaskbar + alwaysOnTop: sem este caminho de
  // saída explícito, ela fica presa na tela mesmo depois de o launcher
  // fechar (o app continua vivo na tray no Windows/Linux).
  public hideReplicaWindow(): void {
    if (this.replicaWindow && !this.replicaWindow.isDestroyed()) {
      this.replicaWindow.hide();
    }
  }

  public getReplicaWindow(): BrowserWindow | null {
    return this.replicaWindow;
  }
}
