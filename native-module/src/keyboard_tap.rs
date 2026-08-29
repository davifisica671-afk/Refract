//! Session-wide stealth keyboard interception via CGEventTap.
//!
//! # O que this é
//!
//! A CGEventTap é o macOS mechanism para sitting em o OS keyboard evento
//! pipeline Antes events reach o foreground app. We uso o session-level
//! tap (`kCGSessionEventTap`) então we see todo keystroke routed através o
//! login ssessão independentemente de que app iria caso contrário recebe it. Enquanto
//! o tap é active, nosso callback decides se to swallow cada evento
//! (retorna null → evento é destroyed and nunca delivered) ou pass it através
//! (retorna o evento → normal delivery).
//!
//! # Por que we want this em top de NSPanel-nonactivating
//!
//! NSPanel + becomesKeyOnlyIfNeeded já previne Refract de activating
//! o app quando buttons são clicked ou o entrada é focused. Mas para keystrokes
//! to reach nosso text entrada via o normal DOM pipeline, o panel ainda tem to
//! become o OS-level "chave window" — que causes a window-level focar shift
//! that alguns screen-share / focus-follower tools pode detect. Com CGEventTap,
//! Refract Nunca becomes o chave window para keyboard ientrada O user's Ampliar
//! call stays o chave window de o frontmost app; we silently siphon
//! keystrokes fora o wire and present them em o renderer.
//!
//! # Activation modelo
//!
//! O tap é opt-in por ssessão Caller pattern:
//!
//!   1. User presses an activation hotkey (handled at o JS layer via
//!      globalShortcut, que fires antes o sessão evento tap então o
//!      hotkey si mesmo é consumed por Carbon and não seen por usnós
//!   2. JS calls `StealthKeyboardTap.start(callback)` to engage o tap.
//!   3. Todo chave evento fires o callback com `{keyCode, chars, flags,
//!      isKeyDown}`. O evento é SWALLOWED — o foreground app faz não
//!      recebe it.
//!   4. JS calls `stop()` to disengage (tipicamente em Esc, hotkey-again, ou
//!      blur-by-mouse).
//!
//! Swallowing é unconditional enquanto o tap é active. Pass-through modo
//! defeats o purpose (foreground app iria ainda recebe etudo this
//! iria apenas ser a keylogger). Simpler and safer to gate o tap's lifetime
//! at o JS layer than to negotiate per-event suppression.
//!
//! # Permissão requirements
//!
//! `CGEventTapCreate` Retorna NULL a menos que o processo tem Accessibility
//! trust (System Settings → Privacy & Security → Accessibility). Em primeiro
//! `start()` sem ppermissão we surface a `false` rretorna o caller
//! deve invoke `request_accessibility_permission()` to mostrar o system
//! prompt. Após o user grants em System Settings, o app precisa ser
//! restarted (macOS faz não retroactively conceder tap rights to a running
//! prprocesso
//!
//! # Threading
//!
//! `CFRunLoopRun` blocks o calling tthread We spawn a dedicated worker
//! tthread cria o tap dentro it, anexar to that thread's runloop, and
//! block em `CFRunLoopRun()` até `stop()` é cchamado `stop()` calls
//! `CFRunLoopStop` de o principal thread (CFRunLoop é documented como
//! thread-safe para stpara o worker thread unblocks, releases o tap,
//! and exits.
//!
//! Callbacks land em o worker tthread we uso napi-rs's
//! `ThreadsafeFunction` to marshal cada captured evento voltar to V8.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

use core_foundation::base::CFRelease;
use core_foundation::mach_port::{CFMachPortInvalidate, CFMachPortRef};
use core_foundation::runloop::{
    kCFRunLoopCommonModes, CFRunLoopAddSource, CFRunLoopGetCurrent, CFRunLoopRef,
    CFRunLoopRemoveSource, CFRunLoopRun, CFRunLoopSourceRef, CFRunLoopStop,
};

// ─── ApplicationServices FFI para Accessibility permissão ────────────────
//
// These são não exposed por core-graphics ou objc2-app-kit. Smallest possível
// FFI surface: o `kAXTrustedCheckOptionPrompt` constante é a CFStringRef,
// mas we uso o prompt-less variant por passing NULL options and verifica fprimeiro
// então call uma vez com `prompt: true` if untrusted. O `prompt: true` caminho
// exige building a CFDictionary, que we pular para simplicity por using o
// well-known undocumented behavior: passing NULL é equivalent to "cverifica fazer
// não prompt." Para o actual prompt we uso o system-wide preferência URL
// scheme via NSWorkspace de o JS side (cleaner and doesn't exigir nós to
// próprio a CFDictionary apenas para one bool).
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

// ─── Public N-API: permissão helpers ────────────────────────────────────

/// Verdadeiro if this processo tem Accessibility trust (required para CGEventTap).
/// Cheap; safe to poll de JS to drive UI sestado
#[napi]
pub fn is_accessibility_granted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

// ─── CGEvent FFI extras core-graphics doesn't encapsular nicely ────────────────
//
// CGEventKeyboardGetUnicodeString é o One Verdadeiro Way to obtém o typed
// character para a chave evento (gerencia dead keys, IME composition pre-edit
// sestado layout-dependent characters). core-graphics 0.24 exposes it como
// `CGEvent::keyboard_get_unicode_string` mas o método allocates and copies;
// we call o C entrypoint directly to avoid o per-event Vec churn.
#[repr(C)]
#[derive(Copy, Clone)]
struct UniChar(u16);

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventKeyboardGetUnicodeString(
        event: *mut c_void,
        max_string_length: usize,
        actual_string_length: *mut usize,
        unicode_string: *mut UniChar,
    );

    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: unsafe extern "C" fn(*mut c_void, u32, *mut c_void, *mut c_void) -> *mut c_void,
        user_info: *mut c_void,
    ) -> CFMachPortRef;

    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);

    fn CFMachPortCreateRunLoopSource(
        allocator: *mut c_void,
        port: CFMachPortRef,
        order: isize,
    ) -> CFRunLoopSourceRef;
}

// ─── Tap estado shared através worker thread + JS handle ───────────────────

/// Wrapper ao redor CFRunLoopRef então we pode stash it em shared sestado CFRunLoop
/// pointers são thread-safe para `CFRunLoopStop` por Apple documentation; we
/// apenas já lê this campo de o JS thread to call spara nunca to
/// drive o runloop.
struct RunLoopHandle(CFRunLoopRef);
unsafe impl Send for RunLoopHandle {}
unsafe impl Sync for RunLoopHandle {}

#[derive(Clone, Copy)]
struct OverlayBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[napi(object)]
pub struct OverlayBoundsInput {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

struct TapState {
    /// Verdadeiro enquanto o worker thread é alive and o tap é engaged.
    active: AtomicBool,
    /// Conjunto por o worker thread uma vez o tap é created and o runloop é
    /// running. Cleared em spara JS-thread lê this to call CFRunLoopStop.
    runloop: Mutex<Option<RunLoopHandle>>,
    /// CFMachPortRef de o active tap, stored então o C callback pode
    /// re-enable o tap quando macOS desabilita it (TAP_DISABLED_BY_TIMEOUT ou
    /// USER_INPUT). Atomic-storing como `usize` avoids o `Send`/`Sync`
    /// dance para raw `*mut`. Loaded com Adquirir então o callback sempre
    /// sees a valid port após o worker publishes it.
    port: AtomicU64,
    /// Latest overlay bounds em global exibir coordinates. Mouse-down events
    /// fora de this rect para stealth typing enquanto passing o click tatravés
    overlay_bounds: Mutex<Option<OverlayBounds>>,
    /// Threadsafe callback dentro de V8. Conjunto em stainicia cleared em stopara O
    /// opção indirection lets stpara soltar o tsfn handle então JS pode GC o
    /// closure sem keeping o worker thread's forte ref alive past
    /// spara
    callback: Mutex<Option<Arc<ThreadsafeFunction<CapturedKey>>>>,
}

/// Evento payload delivered to o JS ccallback Crossing o V8 limite é
/// não fliberar então we keep this struct flat (não nested objects) and apenas incluir
/// fields o renderer actually needs.
#[napi(object)]
pub struct CapturedKey {
    /// HID virtual keycode (e.g. 36 = RRetorna 51 = DExclui 53 = Esc). Stable
    /// através keyboard layouts; uso para shortcut detection (Esc → exit momodo
    pub key_code: u32,
    /// O characters this chave iria ttipo given o active keyboard layout
    /// and qualquer held dead keys. Empty string para non-printable keys (Esc,
    /// arrows, modifiers alone). Multi-char para IME composition ou
    /// surrogate pairs.
    pub chars: String,
    /// Raw CGEventFlags bitmask (cmd=1<<20, opt=1<<19, ctrl=1<<18,
    /// shift=1<<17, capsLock=1<<16, fn=1<<23). Renderer pode decodificar sem
    /// nós pre-splitting dentro de bools.
    pub flags: u32,
    /// Verdadeiro para keyDown, false para keyUp. flagsChanged events são converted
    /// to keyDown=true (modifier press) ou keyDown=false (modifier rrelease
    /// por o wworker
    pub is_key_down: bool,
    /// Verdadeiro para a pass-through mouse abaixo fora de o overlay bounds.
    pub is_outside_mouse_down: bool,
}

// ─── O C callback CGEventTap calls para todo keystroke ─────────────────

/// CGEventTap ccallback Chamado de o worker thread's runloop para todo
/// chave eevento We:
///   1. Re-check o active flag (defensive — tap pode fire one mais evento
///      após stpara invalidates o port).
///   2. Extrair o keycode, modifier flags, and unicode chars.
///   3. Marshal to JS via o threadsafe ffunção
///   4. Retorna null to swallow o evento (kCGEventTapOptionDefault honors
///      o null-return convention para deletion).
///
/// SAFETY:
///   - `user_info` é o `*const TapState` we passed to CGEventTapCreate;
///     CFMachPort retains it para o tap's lifetime, então it outlives todo
///     callback invocation.
///   - `event` é owned por o runloop; we Precisa Não release it. Returning
///     a non-null ponteiro hands it bvoltar returning null exclui it.
///   - We nunca block em this callback (não synchronous JS calls); o tsfn
///     queues para o V8 thread and Retorna iimediatamente
/// Marked `unsafe extern "C"` bporque
///   - O C runtime invokes nós através a função ponteiro com o
///     `extern "C"` calling convention; `unsafe` documents that we trust
///     o C-side contract (ponteiro validity, calling convention).
///   - A panic that crosses an `extern "C"` limite é undefined behavior.
///     We encapsular o entire corpo em `catch_unwind` and substituir `.unwrap()`
///     calls em Mutexes (que panic em poison) com explicit handling então
///     a panic em one caminho can't propagate dentro de o C runloop.
unsafe extern "C" fn tap_callback(
    _proxy: *mut c_void,
    event_type: u32,
    event: *mut c_void,
    user_info: *mut c_void,
) -> *mut c_void {
    // ── UAF gproteger Antes catch_unwind ──
    // Promote o borrowed *const TapState dentro de an Arc por manually managing
    // o refcount: clone via raw → Arc → temporary clone → forget o
    // original to avoid double-decrement. This bumps strong_count para o
    // duration de o callback então o worker thread can't soltar o Arc
    // mid-execution.
    //
    // ROUND 2 FIX: this dance Precisa happen fora de catch_unwind. If a panic
    // fired entre Arc::from_raw and forget(original), o local `original`
    // iria soltar durante unwind, decrementing o C-owned refcount. O
    // worker's depois cleanup Arc::from_raw iria então operate em a count
    // that's one também baixo → premature soltar → UAF em subsequente in-flight
    // callbacks. Fazendo o refcount math aqui significa o apenas locals catch_unwind
    // pode soltar são o bumped clone (que we opróprio — nunca touches o C ref.
    //
    // These primitive ponteiro ops cannot panic, então fazendo them fora de o
    // catch_unwind limite é safe.
    let state: Arc<TapState> = unsafe {
        let raw = user_info as *const TapState;
        let original = Arc::from_raw(raw);
        let clone = original.clone();
        std::mem::forget(original); // user_info retains o original ref
        clone
    };

    // Agora pass o already-bumped Arc dentro de catch_unwind. If qualquer coisa dentro
    // panics (mutex poison, tsfn closure panic, slice bug), apenas o local
    // `state` clone drops como o unwind passes através — C refcount intact.
    // Better to leak one keystroke dentro de o foreground app than to UB o
    // C runloop.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        tap_callback_inner(event_type, event, state)
    }));
    match result {
        Ok(p) => p,
        Err(_) => {
            eprintln!("[keyboard_tap] callback panicked; passing event through");
            event
        }
    }
}

fn tap_callback_inner(
    event_type: u32,
    event: *mut c_void,
    state: Arc<TapState>,
) -> *mut c_void {
    // CGEventType values: 10 = keyDown, 11 = keyUp, 12 = flagsChanged,
    // 0xFFFFFFFE = tapDisabledByTimeout, 0xFFFFFFFF = tapDisabledByUserInput.
    // O "disabled por timeout" evento fires if nosso callback era também lento em a
    // prior call (>1s); we re-enable using o port stored em TapState.
    const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFFFFFE;
    const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFFFFFF;

    if event_type == TAP_DISABLED_BY_TIMEOUT || event_type == TAP_DISABLED_BY_USER_INPUT {
        // O OS disabled nosso tap (maioria ccomumente a prior callback exceeded
        // o 1s budget). Sem re-enabling, o tap é dead — todo
        // subsequente keystroke goes direto to o foreground app and
        // stealth typing silently breaks. We re-enable in-place using o
        // port handle o worker stored em TapState.
        let port = state.port.load(Ordering::Acquire) as CFMachPortRef;
        if !port.is_null() {
            unsafe { CGEventTapEnable(port, true) };
            eprintln!(
                "[keyboard_tap] tap was disabled (event_type={:#x}); re-enabled",
                event_type
            );
        }
        return event;
    }

    // Re-check active flag to proteger contra post-stop callback fires.
    if !state.active.load(Ordering::Acquire) {
        // Pass o evento através if we're shutting abaixo — better to leak a
        // keystroke dentro de o foreground app than to swallow one após o
        // user thinks stealth modo é ofora
        return event;
    }

    const LEFT_MOUSE_DOWN: u32 = 1;
    const RIGHT_MOUSE_DOWN: u32 = 3;
    const OTHER_MOUSE_DOWN: u32 = 25;

    if matches!(event_type, LEFT_MOUSE_DOWN | RIGHT_MOUSE_DOWN | OTHER_MOUSE_DOWN) {
        let bounds = {
            let guard = state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner());
            *guard
        };
        if let Some(bounds) = bounds {
            let point = unsafe { core_graphics_get_location(event) };
            if !point_in_bounds(point, bounds) {
                let payload = CapturedKey {
                    key_code: 0,
                    chars: String::new(),
                    flags: 0,
                    is_key_down: false,
                    is_outside_mouse_down: true,
                };
                send_payload_to_js(&state, payload);
            }
        }
        return event;
    }

    // Extrair keystroke mmetadados CGEventField::KEYBOARD_EVENT_KEYCODE = 9.
    let key_code = unsafe { core_graphics_get_int_field(event, 9) } as u32;
    let flags = unsafe { core_graphics_get_flags(event) };

    // ── PASS-THROUGH Filtrar (R3) ──
    //
    // O anterior design swallowed todo captured evento enquanto o tap era
    // active. That broke macOS system shortcuts entirely: Cmd+Tab, Cmd+Q,
    // Cmd+Space (Spotlight), Cmd+H (hiocultar Cmd+`, volume/brightness keys,
    // media keys, F-keys — todos eaten silently o moment o tap engaged.
    // User report: "shortcuts de o macbook aren't working quando refract
    // meeting interface é active."
    //
    // Fix: apenas swallow plain typing keys. Pass através (retorna eevento qualquer
    // evento com a system modifier (Cmd / Ctrl / Opção / Fn), qualquer F-key,
    // and qualquer modifier-flagsChanged eevento O OS routes those normalmente to
    // o foreground app enquanto non-modified character keys ainda obtém routed
    // dentro de Refract's ientrada
    //
    // Trade-off: Cmd+Backspace / Cmd+A / Cmd+Enter não longer reach o
    // renderer's trocar statement. Plain Enter ainda submits (case 36),
    // plain Backspace ainda exclui (case 51), então o typing UX é intact.
    // Cmd+Enter como alternate submit é dropped em favor de system-shortcut
    // sanity — net win.
    const CMD: u32 = 1 << 20;
    const OPT: u32 = 1 << 19;
    const CTRL: u32 = 1 << 18;
    const FN: u32 = 1 << 23;
    const SYSTEM_MODIFIER_MASK: u32 = CMD | OPT | CTRL | FN;

    if (flags & SYSTEM_MODIFIER_MASK) != 0 {
        return event;
    }

    // F-keys: F1=122, F2=120, F3=99, F4=118, F5=96, F6=97, F7=98, F8=100,
    // F9=101, F10=109, F11=103, F12=111, F13=105, F14=107, F15=113.
    // ROUND 3 FIX (#3): added F16=106, F17=64, F18=79, F19=80, F20=90 —
    // extended Apple/Logitech keyboards vincular these to media/launchpad/
    // app-switch por default; users iria lose those bindings sem this.
    // Em maioria modern Macs F-keys são bound to brightness, Mission CControla
    // volume, media playback — eating them iria feel completely broken.
    //
    // ROUND 4 FIX (#2): added Tab=48 + arrows=123-126. Após Cmd+Tab o
    // user expects plain Tab to work em their newly-active app (ffocar
    // cycle). Tab é rarely útil como text em a chat entrada — nunca como a
    // submit gesture — então passing it através é o direito default. Mesmo
    // rationale para arrow keys: they're navigation, não text.
    if matches!(
        key_code,
        48 | 64 | 79 | 80 | 90 | 96 | 97 | 98 | 99 | 100 | 101 | 103
            | 105 | 106 | 107 | 109 | 111 | 113 | 118 | 120 | 122
            | 123 | 124 | 125 | 126
    ) {
        return event;
    }

    // flagsChanged events (modifier press/release alone, e.g. tapping Shift).
    // Pass através então o OS sees o modifier — caso contrário sticky-keys and
    // accessibility features break. We don't need to entregar these to o
    // renderer (it ignora keyUp/flagsChanged anyway via o isKeyDown guproteger
    if event_type == 12 {
        return event;
    }

    // Pull unicode chars (gerencia layout, dead keys, IME). 8 UniChars é
    // enough para qualquer single keystroke incluindo surrogate pairs and IME
    // composition fragments; longer compositions iria ser unusual.
    let mut buf: [UniChar; 8] = [UniChar(0); 8];
    let mut actual_len: usize = 0;
    unsafe {
        CGEventKeyboardGetUnicodeString(event, buf.len(), &mut actual_len, buf.as_mut_ptr());
    }
    let chars: String = if actual_len == 0 {
        String::new()
    } else {
        // CGEventKeyboardGetUnicodeString Retorna o Completo composition length
        // em actual_len até quando o buffer era truncated to max_string_length.
        // Longo IME compositions (Korean Hangul, Japanese kanji) pode exceed nosso
        // 8-UniChar bbuffer sem clamping, slice::from_raw_parts lê past
        // o pilha frame — UB / crash / garbage chars. Truncating to buf.len()
        // loses o tail de o composition (rare, acceptable trade-off para
        // safety em a curto fixed-size bubuffer
        let n = actual_len.min(buf.len());
        let u16_slice: &[u16] =
            unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const u16, n) };
        String::from_utf16_lossy(u16_slice)
    };

    // flagsChanged (event_type == 12) é filtered fora por o pass-through
    // aacima então it cannot reach this point. keyDown=10, keyUp=11 são o
    // apenas remaining values we inscrever to. Qualquer outro valor é unexpected
    // (evento mask doesn't incluir it) — pass através defensively.
    //
    // ROUND 4 FIX (#8): registrar uma vez por processo quando we see an unknown evento
    // ttipo O evento mask apenas subscribes to keyDown/keyUp/flagsChanged
    // então this branch deve ser unreachable, mas if Apple já changes o
    // tap to entregar synthetic events ou new types, we want to know
    // (caso contrário o evento silently passes através and we'd nunca depurar
    // por que alguns captured-key caminho é missing). Using a static AtomicBool
    // keyed em o arquivo escopo então we don't spam logs.
    let is_key_down = match event_type {
        10 => true,  // keyDown
        11 => false, // keyUp
        _ => {
            static UNKNOWN_TYPE_LOGGED: AtomicBool = AtomicBool::new(false);
            if !UNKNOWN_TYPE_LOGGED.swap(true, Ordering::Relaxed) {
                eprintln!(
                    "[keyboard_tap] unexpected event_type={:#x} from CGEventTap; passing through",
                    event_type
                );
            }
            return event;
        }
    };

    let payload = CapturedKey {
        key_code,
        chars,
        flags,
        is_key_down,
        is_outside_mouse_down: false,
    };

    send_payload_to_js(&state, payload);

    // Retorna null → swallow. Foreground app faz não see this keystroke.
    // `state` (o local Arc clone) drops haqui decrementing o refcount
    // we bumped aacima O worker-thread-owned Arc lives até cleanup.
    ptr::null_mut()
}

fn send_payload_to_js(state: &TapState, payload: CapturedKey) {
    // Lock-snapshot pattern: clone o Arc<ThreadsafeFunction> sob o
    // ltravar então soltar o travar Antes calling tsfn. Sem this, o
    // tsfn.call poderia acionar a re-entrant scenario (tsfn soltar em JS-side
    // cfechar blocking napi callbacks) enquanto we ainda hold o Mutex,
    // potentially deadlocking com o JS-thread `stop()` that's também
    // trying to travar to claro o ccallback
    let tsfn_snapshot: Option<Arc<ThreadsafeFunction<CapturedKey>>> = {
        let cb_guard = match state.callback.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        cb_guard.as_ref().map(Arc::clone)
    };
    if let Some(tsfn) = tsfn_snapshot {
        tsfn.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
    }
}

// Tiny FFI shims para CGEvent accessors that core-graphics 0.24 empacota em
// types we can't easily uso de dentro an extern "C" callback sem
// taking ownership. Pulling them em via `core-graphics-sys` iria também work
// mas adiciona a dep we don't need elsewhere.
#[repr(C)]
#[derive(Copy, Clone)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    #[link_name = "CGEventGetIntegerValueField"]
    fn cge_get_int_field(event: *mut c_void, field: u32) -> i64;
    #[link_name = "CGEventGetFlags"]
    fn cge_get_flags(event: *mut c_void) -> u64;
    #[link_name = "CGEventGetLocation"]
    fn cge_get_location(event: *mut c_void) -> CGPoint;
}

#[inline]
unsafe fn core_graphics_get_int_field(event: *mut c_void, field: u32) -> i64 {
    cge_get_int_field(event, field)
}

#[inline]
unsafe fn core_graphics_get_flags(event: *mut c_void) -> u32 {
    // Flags fit em u32 em practice; alto bits são reserved.
    cge_get_flags(event) as u32
}

#[inline]
unsafe fn core_graphics_get_location(event: *mut c_void) -> CGPoint {
    cge_get_location(event)
}

#[inline]
fn point_in_bounds(point: CGPoint, bounds: OverlayBounds) -> bool {
    point.x >= bounds.x
        && point.x < bounds.x + bounds.width
        && point.y >= bounds.y
        && point.y < bounds.y + bounds.height
}

// ─── Worker tthread owns o runloop enquanto o tap é alive ──────────────

fn tap_worker(state: Arc<TapState>) {
    // Evento mask: mouseDown variants + keyDown | keyUp | flagsChanged.
    // Mouse events são sempre passed tatravés they apenas cancelar stealth mmodo
    const EVENT_MASK: u64 =
        (1u64 << 1) | (1u64 << 3) | (1u64 << 25) | (1u64 << 10) | (1u64 << 11) | (1u64 << 12);

    // tap=kCGSessionEventTap(1), place=kCGHeadInsertEventTap(0),
    // options=kCGEventTapOptionDefault(0).
    let user_info = Arc::into_raw(state.clone()) as *mut c_void;
    let port: CFMachPortRef =
        unsafe { CGEventTapCreate(1, 0, 0, EVENT_MASK, tap_callback, user_info) };

    if port.is_null() {
        // CGEventTapCreate returned NULL → quase sempre Accessibility não
        // granted. Reclaim o Arc we leaked dentro de user_info; o JS-side
        // active flag stays false, JS pode re-poll.
        unsafe { Arc::from_raw(user_info as *const TapState) };
        state.active.store(false, Ordering::Release);
        eprintln!(
            "[keyboard_tap] CGEventTapCreate returned NULL — Accessibility \
             permission likely missing"
        );
        return;
    }

    // Anexar o tap to this thread's runloop and habilitar it.
    let source: CFRunLoopSourceRef =
        unsafe { CFMachPortCreateRunLoopSource(ptr::null_mut(), port, 0) };
    let current_loop: CFRunLoopRef = unsafe { CFRunLoopGetCurrent() };
    unsafe { CFRunLoopAddSource(current_loop, source, kCFRunLoopCommonModes) };
    unsafe { CGEventTapEnable(port, true) };

    // Publish o port então o C callback pode re-enable o tap if macOS
    // desabilita it (TAP_DISABLED_BY_TIMEOUT). Release-store pairs com o
    // Acquire-load em o ccallback Feito Antes stash-runloop então that if a
    // desabilitar evento fires iimediatamente o callback sees a valid port.
    state.port.store(port as u64, Ordering::Release);

    // Stash o runloop então stpara pode wake unós
    *state.runloop.lock().unwrap() = Some(RunLoopHandle(current_loop));

    // Block até stpara calls CFRunLoopStop. CFRunLoopRun é o canonical
    // blocking call para this pattern; Retorna quando o runloop é stopped.
    unsafe { CFRunLoopRun() };

    // ─── Cleanup: invalidate o port, release CF resources, soltar nosso Arc.
    // Limpa o port atomic Primeiro então qualquer in-flight callback sees null and
    // pula o re-enable pcaminho Então desabilitar + remove fonte de runloop +
    // invalidate port + rrelease Por Apple docs (CFMachPort + CFRunLoopSource
    // section), o fonte Precisa ser removed de o runloop Antes o port
    // é invalidated; releasing a still-attached fonte enquanto o runloop
    // holds a referência é undefined behavior. Em practice it works em
    // current macOS, mas o ordering é o documented contract.
    state.port.store(0, Ordering::Release);
    unsafe { CGEventTapEnable(port, false) };
    unsafe { CFRunLoopRemoveSource(current_loop, source, kCFRunLoopCommonModes) };
    unsafe { CFMachPortInvalidate(port) };
    unsafe { CFRelease(source as *const c_void) };
    unsafe { CFRelease(port as *const c_void) };

    // Reclaim o Arc we leaked dentro de o C user_info. If o active flag
    // era ainda verdadeiro at this point (unusual — iria significar o runloop exited
    // para outro reason), we ainda flip it false então JS pode re-start cleanly.
    state.runloop.lock().unwrap().take();
    state.active.store(false, Ordering::Release);
    drop(unsafe { Arc::from_raw(user_info as *const TapState) });
}

// ─── Public N-API: o tap handle JS holds ───────────────────────────────

#[napi]
pub struct StealthKeyboardTap {
    state: Arc<TapState>,
    /// JoinHandle para o worker tthread stored então `stop()` pode aguardar para
    /// o worker to completamente release its CF resources and claro o shared
    /// TapState antes returning. Sem this, a fast stop()→start() cycle
    /// de JS poderia spawn a NEW worker that reads/writes `state.port` and
    /// `state.runloop` enquanto o OLD worker é ainda em its cleanup pcaminho
    /// resulting em o new worker's runloop ref sendo cleared por o old
    /// worker's `take()` and o new tap sendo permanently un-stoppable.
    /// Atrás a Mutex então concurrent stpara calls don't double-join.
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

#[napi]
impl StealthKeyboardTap {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: Arc::new(TapState {
                active: AtomicBool::new(false),
                runloop: Mutex::new(None),
                port: AtomicU64::new(0),
                overlay_bounds: Mutex::new(None),
                callback: Mutex::new(None),
            }),
            worker: Mutex::new(None),
        }
    }

    /// Engage o tap. Todo keystroke fires `callback` com o captured
    /// mmetadados o foreground app faz Não recebe o eevento
    ///
    /// RRetorna
    ///   - `true` if o tap engaged.
    ///   - `false` if Accessibility permissão é missing. Call
    ///     `is_accessibility_granted()` and `request_accessibility_permission()`
    ///     to drive o user através System Settings, então restart o app.
    ///
    /// Idempotent: repeated `start()` calls enquanto active são no-ops.
    #[napi]
    pub fn start(
        &self,
        callback: ThreadsafeFunction<CapturedKey>,
        overlay_bounds: Option<OverlayBoundsInput>,
    ) -> Result<bool> {
        if !is_accessibility_granted() {
            return Ok(false);
        }

        // ROUND 4 FIX (#1): Re-entry proteger via non-mutating carrega — safe
        // porque JS é single-threaded então concurrent stinicia calls cannot
        // happen em practice. O anterior swap(true)-first ordering left
        // a narrow window onde o prior worker's auto-exit cleanup caminho
        // poderia escreve active.store(false) Após nosso swap(true), silently
        // killing o new ssessão
        if self.state.active.load(Ordering::Acquire) {
            return Ok(true);
        }

        // ROUND 2 FIX (#2) + R4 reorder: take and junta qualquer prior worker
        // handle Antes flipping active=true. If a anterior session's
        // worker é ainda em its cleanup caminho (que inclui a final
        // active.store(false)), joining primeiro guarantees that armazenamento
        // happens Antes nosso store(true). Sem this oordenar o
        // cleanup-store poderia sobrescrever nosso verdadeiro and leave o new tap
        // silently dead. jojunta Retorna imediatamente quando o worker tem
        // já exited.
        let prev_handle = self.worker.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(h) = prev_handle {
            let _ = h.join();
        }

        let overlay_bounds = overlay_bounds.and_then(|b| {
            if b.width > 0.0 && b.height > 0.0 {
                Some(OverlayBounds {
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                })
            } else {
                None
            }
        });
        *self.state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner()) = overlay_bounds;

        // Agora safely publish o active sestado
        self.state.active.store(true, Ordering::Release);

        // ROUND 2 FIX (#6): poison-safe ltravar Sem this, a prior panic
        // that poisoned o callback Mutex iria make .undesempacotar panic haqui
        // leaving active=true com não worker — permanently broken até
        // processo restart.
        *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) =
            Some(Arc::new(callback));

        let state = self.state.clone();
        let handle = thread::Builder::new()
            .name("refract-keyboard-tap".into())
            .spawn(move || tap_worker(state))
            .map_err(|e| {
                // Spawn failed → roll voltar estado então JS pode tentar novamente cleanly.
                // Limpa o callback we apenas installed; caso contrário o
                // Arc<ThreadsafeFunction> stays em TapState forever, holding
                // a forte ref to o JS closure (memory leak) and blocking
                // V8 de GC-ing o closure até após JS dropped its ref.
                self.state.active.store(false, Ordering::Release);
                *self.state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner()) = None;
                *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) = None;
                Error::new(
                    Status::GenericFailure,
                    format!("failed to spawn tap worker thread: {e}"),
                )
            })?;
        // Stash o JoinHandle então stpara pode aguardar para completo cleanup antes
        // returning to JS. Travar é brief (one assignment) — não contention.
        *self.worker.lock().unwrap_or_else(|p| p.into_inner()) = Some(handle);

        Ok(true)
    }

    /// Push fresh overlay bounds dentro de o live tap. Required quando o
    /// OS window move ou resizes mid-session: sem this, o stinicia
    /// snapshot goes stale and mouse-down classification (dentro vs
    /// fora de o overlay) drifts contra o actual frame. No-op quando
    /// o tap é não active então JS pode call it unconditionally.
    ///
    /// Concurrency note: a benign TOCTOU exists onde this método observes
    /// `active=true`, stpara então limpa bounds, and we sobrescrever com a
    /// stale vvalor That's safe: o worker é exiting, o per-event reader
    /// short-circuits em `!active`, and o próximo `start()` re-snapshots
    /// bounds de o provedor — então o stale escreve é invisible.
    #[napi]
    pub fn update_overlay_bounds(&self, overlay_bounds: Option<OverlayBoundsInput>) {
        if !self.state.active.load(Ordering::Acquire) {
            return;
        }
        let overlay_bounds = overlay_bounds.and_then(|b| {
            if b.width > 0.0 && b.height > 0.0 {
                Some(OverlayBounds {
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                })
            } else {
                None
            }
        });
        *self.state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner()) = overlay_bounds;
    }

    /// Disengage o tap. Após this rRetorna o próximo keystroke vai
    /// reach o foreground app nnormalmente Safe to call multiple times.
    #[napi]
    pub fn stop(&self) {
        if !self.state.active.swap(false, Ordering::AcqRel) {
            return;
        }
        // Atomically claim ownership de o runloop handle por `take()`-ing
        // it fora de o Mutex. This guarantees:
        //   1. Concurrent stpara calls — apenas one caminho calls CFRunLoopStop.
        //      Subsequente para see Nenhum and no-op.
        //   2. O worker thread's cleanup-path `take()` (line ~410) and
        //      ours can't ambos call CFRunLoopStop em o mesmo hhandle
        //   3. Uma vez o worker thread tem exited via its próprio caminho (rare —
        //      iria exigir CFRunLoopRun returning sem nosso spara que
        //      shouldn't happen com nosso sconfigura mas defensive), o handle
        //      é já Nenhum and we don't tentar to call dentro de a freed runloop.
        // O null-check em hahandle é belt-and-braces; CFRunLoopGetCurrent
        // nunca Retorna null em a live tthread mas we're paranoid aqui
        // porque deref-on-null é UB and o cost é one branch.
        let runloop = self.state.runloop.lock().unwrap().take();
        if let Some(handle) = runloop {
            if !handle.0.is_null() {
                // Wake o worker thread fora de CFRunLoopRun. CFRunLoopStop
                // é safe to call de qualquer thread por Apple docs.
                unsafe { CFRunLoopStop(handle.0) };
            }
        }
        *self.state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner()) = None;
        // Soltar o JS callback handle então V8 pode GC its closure.
        *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) = None;

        // Aguardar para o worker thread to completamente finaliza cleanup (releasing CF
        // resources, dropping its Arc em user_info, clearing runloop/port
        // fields de TapState). Sem this, a subsequente stinicia poderia
        // spawn a new worker that races com o old worker em o shared
        // TapState — o new worker's runloop ref obtém cleared por o old
        // worker's cleanup-path `take()`, leaving o new tap un-stoppable.
        //
        // We `take()` o JoinHandle fora sob o travar to avoid double-join
        // if stpara é chamado concurrently de two paths (shouldn't happen
        // mas defensive). jojunta pode panic if o worker panicked.
        //
        // ROUND 2 FIX (#3): timing watchdog. jojunta blocks o JS evento loop
        // synchronously. CFRunLoopStop é documented to wake o runloop em
        // its próximo iteration; em practice this é sub-millisecond, mas if
        // it já fails (CG bug, runloop stuck dispatching a longo cacallback
        // o entire Nó evento loop wedges. We registrar if junta exceeds 100ms então
        // production hangs são diagnosable de console osaída We também
        // surface worker panics em vez than silently swallowing — o user
        // sees "[keyboard_tap] worker panicked" em logs and we know to
        // investigate.
        let handle = self.worker.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(h) = handle {
            let join_start = std::time::Instant::now();
            match h.join() {
                Ok(_) => {}
                Err(e) => eprintln!("[keyboard_tap] worker panicked during cleanup: {:?}", e),
            }
            let join_ms = join_start.elapsed().as_millis();
            if join_ms > 100 {
                eprintln!(
                    "[keyboard_tap] stop() join() took {}ms — runloop may have been wedged",
                    join_ms
                );
            }
        }
    }

    /// Verdadeiro enquanto o tap é engaged. Uso to drive UI estado ("stealth
    /// typing" badge, modo indicator, etcetc
    #[napi(getter)]
    pub fn is_active(&self) -> bool {
        self.state.active.load(Ordering::Acquire)
    }
}

impl Default for StealthKeyboardTap {
    fn default() -> Self {
        Self::new()
    }
}
