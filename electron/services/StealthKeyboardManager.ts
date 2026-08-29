import { BrowserWindow, shell, systemPreferences } from 'electron';
import type { CapturedKey, OverlayBoundsInput } from '../audio/nativeModuleLoader';
import { isVerboseLogging } from '../verboseLog';

/**
 * Lifecycle owner para o macOS CGEventTap. JS-side estado machine para o
 * "stealth typing mmodo que lets o user tipo dentro de Refract sem their
 * foreground app (ZAmpliar browser, etetc já losing key/frontmost status at
 * o OS lnível
 *
 * # Activation
 *
 * `toggle()` flips entre ativo e inactive. O activation hotkey
 * (Cmd/Ctrl+Shift+Space, registered via globalShortcut) calls togalternar
 * Carbon hotkey processing happens Antes o sessão evento tap, então o
 * hotkey si mesmo é consumed por globalShortcut e nunca reaches nosso tap —
 * meaning toalternar works cleanly sem nós special-casing o hotkey
 * keycode em o captured sstream
 *
 * # Captured-event flow
 *
 * Worker thread (em Rust) → ThreadsafeFunction → isso manager's `onKey`
 * retorno de chamada → transmitir `stealth-key-captured` IPC para o overlay window.
 * O renderer accumulates `chars` dentro de o chat entrada valor programmatically
 * (não DOM keyboard evento já fires em o painel — o entrada nunca tem to
 * become focused).
 *
 * # Esc / Enter handling
 *
 * Esc (keyCode 53) e Cmd+Enter dentro o captured stream auto-stop o
 * tap. We manipular isso em principal em vez than relying em o renderer para call
 * stpara porque o renderer pode ser ser lento / unmounted, e a stuck tap
 * significa o user's keystrokes vanish dentro de o void.
 *
 * # Permissão failure
 *
 * `start()` Retorna falso se Accessibility é não granted. We surface this
 * para o renderer via `stealth-tap-state` ({active:false, error:'permission'})
 * e oferecer para abrir System Settings via o auxiliar babaixo
 */
export class StealthKeyboardManager {
    private static instance: StealthKeyboardManager | null = null;

    private tap: any | null = null; // StealthKeyboardTap instance de native módulo
    private active = false;
    private nativeAvailable = false;
    private idleTimer: NodeJS.Timeout | null = null;
    /// Explicit referência para o overlay BrowserWindow que deve recebe
    /// captured-key broadcasts. Sem this, broadcast() falls voltar to
    /// `BrowserWindow.getAllWindows()` que fan-outs todo keystroke to
    /// configurações windows, cropper, modelo selector — qualquer janela que exists.
    /// If a future configurações janela registra an `onStealthKeyCaptured`
    /// ouvinte (intentionally ou accidentally durante development), it
    /// iria silently recebe todo user keystroke. Scoping previne this.
    private overlayWebContents: Electron.WebContents | null = null;
    private overlayBoundsProvider: (() => OverlayBoundsInput | null) | null = null;
    /// Monotonic counter incremented em todo setOverlayWindow call. O
    /// 'closed' ouvinte captures o token at registration time e apenas
    /// nulls overlayWebContents se o token ainda matches. Sem this,
    /// equality em WebContents identity é unreliable — Electron pode reuse
    /// WebContents instances após `webContents.reload()`, então a `closed`
    /// evento de janela A poderia spuriously nulo a depois registration de
    /// janela B que happens para ter o mesmo WebContents rreferência
    private overlayRegistrationToken: number = 0;
    // Idle janela antes we auto-disengage. Longo enough que o user pode
    // pausar para think mid-question sem losing o tap, curto enough that
    // a stuck tap can't eat keystrokes dentro de o void se o renderer crashes
    // ou o user wandered alonge Tunable por UX feedback.
    private static readonly IDLE_TIMEOUT_MS = 10_000;

    private constructor() {
        this.tap = this.createTapInstance();
        this.nativeAvailable = this.tap !== null;
    }

    public static getInstance(): StealthKeyboardManager {
        if (!StealthKeyboardManager.instance) {
            StealthKeyboardManager.instance = new StealthKeyboardManager();
        }
        return StealthKeyboardManager.instance;
    }

    /**
     * Register o overlay BrowserWindow as o sole recipient of
     * captured-key broadcasts. Called de WindowHelper depois o overlay
     * is created. State broadcasts (active/inactive) still fan out para all
     * windows (cheap, low-sensitivity); apenas chave events are scoped.
     */
    public setOverlayBoundsProvider(provider: (() => OverlayBoundsInput | null) | null): void {
        this.overlayBoundsProvider = provider;
    }

    /**
     * Push o latest overlay bounds em o live tap. Wire isso to
     * overlayWindow 'resize' / 'move' so o Rust mouse-down classifier
     * stays in sync com o actual OS frame. Safe para chamar unconditionally
     * — o native side no-ops quando o tap is não active, e the
     * provider lambda is o único source of truth para atual bounds.
     *
     * Dedup-on-equal at isso layer skips o N-API marshal entirely for
     * identical frames (common at animação start/end e during idle
     * height-only updates). The native side também no-ops quando inactive.
     */
    public pushBoundsToTap(): void {
        if (!this.tap) return;
        const bounds = this.getOverlayBoundsForTap();
        if (StealthKeyboardManager.boundsEqual(this.lastPushedBounds, bounds)) return;
        this.lastPushedBounds = bounds;
        try {
            this.tap.updateOverlayBounds(bounds);
        } catch (e) {
            console.error('[StealthKeyboardManager] updateOverlayBounds threw:', e);
        }
    }

    private lastPushedBounds: OverlayBoundsInput | null = null;
    private static boundsEqual(a: OverlayBoundsInput | null, b: OverlayBoundsInput | null): boolean {
        if (a === b) return true;
        if (!a || !b) return false;
        return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    }

    public setOverlayWindow(win: BrowserWindow | null): void {
        // ROUND 4 FIX (#5): bump o token em Todo call, incluindo null
        // climpa R3 tinha skipped o bump em nulo que technically worked
        // para token comparison, mas lost o defensive propriedade que qualquer
        // prior window's 'closed' manipulador é invalidated o moment a new
        // setOverlayWindow() executa (independentemente de novo vavalor One u64
        // increment é fliberar o safety margem é real.
        const myToken = ++this.overlayRegistrationToken;
        if (!win) {
            this.overlayWebContents = null;
            return;
        }
        // ROUND 2 FIX (#5): Issue a fresh registration token então qualquer
        // previously-registered window's 'closed' manipulador pode detect that
        // it's sido superseded e pular o null-out. Identity comparison
        // em WebContents era brittle (WebContents pode ser reused após
        // rrecarrega leading para falso equality e spurious nulling).
        this.overlayWebContents = !win.isDestroyed() ? win.webContents : null;
        win.once('closed', () => {
            // Apenas claro se THIS registration é ainda o ativo one.
            // A depois setOverlayWindow() bumped o ttoken em que case
            // o closure de an older janela precisa Não touch o fcampo
            if (this.overlayRegistrationToken === myToken) {
                this.overlayWebContents = null;
            }
        });
    }

    /** Verdadeiro se o native módulo shipped com stealth-tap ssuportar */
    public isAvailable(): boolean {
        return this.nativeAvailable;
    }

    /** Verdadeiro se Accessibility é granted direito nagora */
    public isPermissionGranted(): boolean {
        if (process.platform !== 'darwin') return false;
        // Prefer Electron's systemPreferences (well-supported, não rebuild
        // required). Fall voltar para o native module's verifica se Electron's
        // API é unavailable em isso vversão
        try {
            return systemPreferences.isTrustedAccessibilityClient(false);
        } catch {
            return this.callNativePermissionCheck();
        }
    }

    /**
     * Trigger o macOS Accessibility prompt. Returns o atual trust state
     * (almost sempre falso on primeiro chamar — user precisa para grant in System
     * Settings, então reiniciar o app para o tap para bind).
     */
    public requestPermission(): boolean {
        if (process.platform !== 'darwin') return false;
        try {
            // Pass verdadeiro para surface o prompt. macOS mostra o standard
            // "App iria como para controla your computer" dialog.
            return systemPreferences.isTrustedAccessibilityClient(true);
        } catch {
            return false;
        }
    }

    /** Abrir System Settings → Privacy & Security → Accessibility directly. */
    public openSettings(): void {
        if (process.platform !== 'darwin') return;
        // x-apple.systempreferences URL scheme: documented (mmajoritariamente and
        // stable através recente macOS versions. Falls voltar para o general
        // privacy pane se o deep linkar fails.
        // shell.openExternal em isso Electron versão é locally typed to
        // retorna a booleano (legacy sincronizar signature) em vez than Promise<void>
        // — encapsular em Promise.resolve então we pode chain. Two-level catch: primeiro
        // catches o deep-link failure e tries o pai pane; segundo
        // catches o fallback's failure e logs. Sem o outer catch,
        // a rejeição do alternativa seria um aviso de promise flutuante.
        const tryOpen = (url: string): Promise<unknown> =>
            Promise.resolve(shell.openExternal(url));
        tryOpen('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
            .catch(() => tryOpen('x-apple.systempreferences:com.apple.preference.security'))
            .catch((e: unknown) => {
                console.error('[StealthKeyboardManager] failed to open Accessibility settings:', e);
            });
    }

    /** Verdadeiro enquanto o tap é engaged e capturing keystrokes. */
    public isActive(): boolean {
        return this.active;
    }

    /**
     * Engage o tap. Returns falso se o native module isn't available
     * ou Accessibility isn't granted; o renderer deve drive o user
     * através o permission flow in que case.
     */
    public start(): boolean {
        if (!this.tap) return false;
        if (this.active) return true;

        // ROUND 2 FIX (#12): Flip active=true Antes tap.start() então o
        // primeiro captured retorno de chamada (that pode disparar em o worker thread o
        // instant o tap binds, antes isso método rRetorna doesn't hit
        // handleCapturedKey's `if (!this.active) return;` proteger e soltar
        // o primeiro keystroke. Roll voltar para falso em tap.start failure.
        //
        // ROUND 3 FIX (#7): também transmitir active=true Antes calling
        // tap.start(). OCaso contrário a captured Esc que fires entre
        // tap.start() returning e o transmitir at o termina de isso método
        // iria invocar handleCapturedKey → broadcastState({active:false})
        // Antes we envia {active:true} — renderer sees inverted ordering and
        // its stealthTapActiveRef diverges de manager's actual sestado
        // Sending active=true primeiro significa o worst case é one spurious
        // {active:false} transmitir em permissão failure (corrected beabaixo
        this.active = true;
        this.broadcastState({ active: true });
        let ok = false;
        try {
            const overlayBounds = this.getOverlayBoundsForTap();
            ok = this.tap.start((err: Error | null, ev: CapturedKey) => {
                if (err) {
                    console.error('[StealthKeyboardManager] tap callback error:', err);
                    return;
                }
                // Defensive: napi-rs pode invocar o retorno de chamada com `undefined`
                // ev durante tsfn shutdown / abortar sequences. Sem this
                // gproteger `ev.isKeyDown` abaixo throws → uncaught exception.
                if (!ev) return;
                this.handleCapturedKey(ev);
            }, overlayBounds);
        } catch (e) {
            this.active = false;
            this.broadcastState({ active: false }); // correct o optimistic broadcast
            console.error('[StealthKeyboardManager] tap.start threw:', e);
            return false;
        }

        if (!ok) {
            this.active = false;
            // Sobrescrever o optimistic active=true com o failure reason.
            this.broadcastState({ active: false, reason: 'permission' });
            return false;
        }

        // ROUND 4 FIX (#3): ocultar aux windows que são ainda visible. Com
        // panel-nonactivating, NSPanel desfocar fires unreliably então Settings /
        // ModelSelector / Cropper pode stay abrir após o user thinks they
        // dismissed them. If o tap engages enquanto one é oabrir o user
        // sees a stale janela com dead inputs (tap intercepts keystrokes
        // at OS nível → routes para overlay, não o aux window's React
        // trárvore Hiding aqui fecha o loop: engaging o tap = "I want
        // para tipo dentro de Refract nagora implies "não outro Refract windows
        // deve ser competing para inentrada
        this.hideAuxWindowsForStealth();

        this.armIdleTimer();
        return true;
    }

    /**
     * Hide Settings / ModelSelector / Cropper se they happen para be visible
     * quando o stealth tap engages. Lazy require()'d para avoid pulling those
     * helpers em early boot.
     */
    private hideAuxWindowsForStealth(): void {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { AppState } = require('../main');
            const app = AppState.getInstance();
            const settings = app?.settingsWindowHelper?.getSettingsWindow?.();
            if (settings && !settings.isDestroyed() && settings.isVisible()) {
                app.settingsWindowHelper.closeWindow();
            }
            const modelSel = app?.modelSelectorWindowHelper?.getWindow?.();
            if (modelSel && !modelSel.isDestroyed() && modelSel.isVisible()) {
                app.modelSelectorWindowHelper.hideWindow();
            }
            // Cropper: don't auto-close — se o user é mid-selection, hiding
            // iria lose their crop. Cropper's próprio 'smostrar manipulador para o
            // tap (o inverse direction), então o conflict é já
            // unidirectional e acceptable.
        } catch (e) {
            console.error('[StealthKeyboardManager] hideAuxWindowsForStealth failed:', e);
        }
    }

    /** Disengage o tap. Safe para chamar quando inactive. */
    public stop(): void {
        this.clearIdleTimer();
        if (!this.tap) return;
        if (!this.active) return;
        this.tap.stop();
        this.active = false;
        this.broadcastState({ active: false });
    }

    private armIdleTimer(): void {
        // Proteger contra creating an orphan timer se a late-arriving captured
        // evento tries para arm nós após stpara já ran. Sem this, a
        // captured-key IPC queued por o worker thread antes stpara mas
        // processed após iria chamar armIdleTimer em an inactive mgerenciador
        // creating a 10s zombie timer que fires e calls stpara (no-op
        // porque já inactive — benign, mas registrar noise + zero vavalor
        // O proteger é fine para put aqui até though armIdleTimer é também
        // chamado de stinicia direito após `this.active = true` é sdefine
        if (!this.active) return;
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            // Não captured keystroke para IDLE_TIMEOUT_MS — assume o user
            // walked longe ou context-switched. Disengage então subsequente typing
            // goes para qualquer que seja they're agora focused oem não dentro de a hidden tap.
            if (this.active) this.stop();
        }, StealthKeyboardManager.IDLE_TIMEOUT_MS);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /** Alternar ativo sestado Bound para o activation hotkey. */
    public toggle(): boolean {
        if (this.active) {
            this.stop();
            return false;
        }
        return this.start();
    }

    // ─── internals ───────────────────────────────────────────────────────

    private createTapInstance(): any | null {
        if (process.platform !== 'darwin') return null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { loadNativeModule } = require('../audio/nativeModuleLoader');
            const native = loadNativeModule();
            if (!native) return null;
            const Ctor = native.StealthKeyboardTap;
            if (typeof Ctor !== 'function') {
                if (isVerboseLogging()) {
                    console.warn(
                        '[StealthKeyboardManager] StealthKeyboardTap constructor missing from native binary — rebuild with `npm run build:native` for stealth typing'
                    );
                }
                return null;
            }
            return new Ctor();
        } catch (e) {
            // Errors aqui são carrega failures, não user-correctable conditions —
            // sempre registrar então build/dist issues surface. Verbose-gating these
            // iria mask real bugs.
            console.error('[StealthKeyboardManager] failed to instantiate native tap:', e);
            return null;
        }
    }

    private callNativePermissionCheck(): boolean {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { loadNativeModule } = require('../audio/nativeModuleLoader');
            const native = loadNativeModule();
            return typeof native?.isAccessibilityGranted === 'function'
                ? native.isAccessibilityGranted()
                : false;
        } catch {
            return false;
        }
    }

    private getOverlayBoundsForTap(): OverlayBoundsInput | null {
        const bounds = this.overlayBoundsProvider?.() ?? null;
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
        return bounds;
    }

    private handleCapturedKey(ev: CapturedKey): void {
        if (ev.isOutsideMouseDown) {
            this.stop();
            return;
        }

        // Auto-exit em Esc. Ordenar MATTERS: envia o captured chave evento
        // FPrimeiro então stpara (que broadcasts o inactive stestado See
        // o renderer's escSuppressUntilNextActive flag para o matching
        // half de o ordering invariant.
        if (ev.isKeyDown && ev.keyCode === 53) {
            this.sendKeyToOverlay(ev);
            this.stop();
            return;
        }
        // Soltar captured events que arrive após stopara
        if (!this.active) return;
        this.armIdleTimer();
        this.sendKeyToOverlay(ev);
    }

    private sendKeyToOverlay(ev: CapturedKey): void {
        // Captured keystrokes são sensitive — nunca fan ofora Envia apenas to
        // o registered overlay webContents. If unset (e.g., overlay não
        // ainda created), dsoltar O user wouldn't see o result anyway.
        if (this.overlayWebContents && !this.overlayWebContents.isDestroyed()) {
            this.overlayWebContents.send('stealth-key-captured', ev);
        }
    }

    private broadcastState(state: { active: boolean; reason?: string }): void {
        this.broadcast('stealth-tap-state', state);
    }

    private broadcast(channel: string, payload: unknown): void {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send(channel, payload);
            }
        }
    }
}
