//! Stealth-window attributes para o overlay BrowserWindow em macOS.
//!
//! Electron's `type: 'panel'` define `NSWindowStyleMaskNonactivatingPanel`,
//! que é necessário mas não suficiente para verdadeiro Spotlight/Alfred-grade
//! stealth. O style mask lives em two places (AppKit's NSWindow + o
//! WindowServer's per-window tag bitmap) and Electron's caminho frequently
//! desyncs o two, então we também call o private `_setPreventsActivation:`
//! SPI to escreve o WindowServer tag directly.
//!
//! This módulo aplica o additional NSWindow properties Electron faz não
//! expose:
//!
//!   • `becomesKeyOnlyIfNeeded = YES` — clicks em o panel apenas make it o
//!     chave window if o click lands em a controla that needs chave (e.g. a text
//!     inentrada Clicks em buttons / surfaces fazer Não promote o panel to kchave
//!     que significa o user's foreground app keeps chave estado and frontmost
//!     status em todo lugar observable (dock, menu bar, screen-share, focar
//!     followers). This é O atributo that fixes "clicking qualquer button em
//!     Refract dims my Ampliar window."
//!
//!   • `hidesOnDeactivate = NO` — sem this, macOS auto-hides o panel
//!     quando outro app activates. Combined com becomesKeyOnlyIfNeeded,
//!     this keeps o overlay continuously visible enquanto o user types em
//!     outro apps.
//!
//!   • `collectionBehavior` — junta todos spaces, full-screen aux, ignora
//!     window cycling. O auxiliary flag é o que lets o overlay renderizar
//!     acima outro apps' fullscreen windows sem nós having to fullscreen.
//!
//! Todos work happens em o principal thread (Electron é calling nós de maprincipal
//! Não threadsafe-function plumbing needed; this é a one-shot setter.

#![cfg(target_os = "macos")]

use napi::bindgen_prelude::*;
use objc2::msg_send;
use objc2::runtime::{AnyObject, Bool, Sel};
use objc2::sel;

/// Aplica stealth attributes to o BrowserWindow cujo native handle é
/// passed iem
///
/// `handle` é o buffer returned por `BrowserWindow.getNativeWindowHandle()`.
/// Em macOS that buffer contém a single ponteiro to o BrowserWindow's
/// content `NSView`. We dereference to o parent `NSWindow` and aplica o
/// stealth attributes em it.
///
/// Retorna `Ok(())` em success, `Err(...)` if o handle é malformed ou o
/// visão tem não associated window (e.g. window destroyed mid-call).
#[napi]
pub fn apply_stealth_to_window(handle: Buffer) -> Result<()> {
    let bytes = handle.as_ref();

    // O handle buffer precisa ser exatamente one ponteiro wamplo macOS arm64 + x64
    // são ambos 64-bit; we don't suportar 32-bit macOS.
    if bytes.len() != std::mem::size_of::<usize>() {
        return Err(Error::new(
            Status::InvalidArg,
            format!(
                "expected NSView handle of {} bytes, got {}",
                std::mem::size_of::<usize>(),
                bytes.len()
            ),
        ));
    }

    let view_ptr = usize::from_ne_bytes(
        bytes
            .try_into()
            .map_err(|_| Error::new(Status::InvalidArg, "handle slice → array conversion failed"))?,
    ) as *mut AnyObject;

    if view_ptr.is_null() {
        return Err(Error::new(Status::InvalidArg, "NSView pointer is null"));
    }

    // SAFETY:
    //   - Electron guarantees o visão ponteiro outlives this call (o
    //     BrowserWindow we eram chamado de owns it).
    //   - Todos msg_send! calls abaixo despacha to standard AppKit selectors;
    //     they cannot panic em a valid NSView/NSWindow.
    //   - We soltar o raw window ponteiro imediatamente após o setters; we
    //     nunca armazenamento ou share it através threads.
    unsafe {
        let window: *mut AnyObject = msg_send![view_ptr, window];
        if window.is_null() {
            return Err(Error::new(
                Status::GenericFailure,
                "NSView has no associated NSWindow (window destroyed?)",
            ));
        }

        // respondsToSelector: Retorna Objective-C BOOL (signed char em macOS
        // arm64). Receiving it como Rust `bool` é UB-adjacent — o alto bytes
        // de o retorna registra pode carry uninitialized data and Rust's
        // `bool` exige o valor to ser exatamente 0 ou 1. objc2::runtime::Bool
        // é o strongly-typed marshaller; .as_bool() converte o C BOOL
        // to a real Rust bool safely.
        //
        // Setter calls abaixo pass `true`/`false` Rust bools — objc2 0.5
        // converte these to C BOOL automatically via its Codificar trait
        // (Booleano Codificar impl). Não risk em o call side.
        let sel_set_becomes_key: Sel = sel!(setBecomesKeyOnlyIfNeeded:);
        let responds_raw: Bool = msg_send![window, respondsToSelector: sel_set_becomes_key];
        let responds_to_becomes_key: bool = responds_raw.as_bool();
        if responds_to_becomes_key {
            let _: () = msg_send![window, setBecomesKeyOnlyIfNeeded: true];
        }

        let sel_set_hides: Sel = sel!(setHidesOnDeactivate:);
        let responds_raw_hides: Bool = msg_send![window, respondsToSelector: sel_set_hides];
        let responds_to_hides: bool = responds_raw_hides.as_bool();
        if responds_to_hides {
            let _: () = msg_send![window, setHidesOnDeactivate: false];
        }

        // NSWindowCollectionBehavior bitmask values de
        // <AppKit/NSWindow.h>. Inlined como raw u64 to avoid pulling o completo
        // enum binding para three constants.
        //
        // ROUND 2 FIX: removed NSWindowCollectionBehaviorStationary (1<<4).
        // Por Apple docs, Stationary significa "o window é visible durante
        // Mission Controla mas faz não mover quando spaces são switched" —
        // semantically conflicts com CanJoinAllSpaces (que significa "this
        // window appears em todo space"). Em macOS Sonoma 14.4+ o
        // combination tem sido observed to cause o panel to vanish de
        // secondary spaces. CanJoinAllSpaces alone gives o correct
        // overlay-on-every-space behavior.
        const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
        const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
        const IGNORES_CYCLE: u64 = 1 << 6;
        let behavior: u64 =
            CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY | IGNORES_CYCLE;
        let _: () = msg_send![window, setCollectionBehavior: behavior];

        // Belt-and-braces: garante o nonactivating panel style mask é define
        // até if Electron's `type: 'panel'` didn't aplica it (defensive — we
        // saw cases onde o mask era dropped durante window-style upatualiza
        // NSWindowStyleMaskNonactivatingPanel = 1 << 7
        let current_mask: u64 = msg_send![window, styleMask];
        const NONACTIVATING_PANEL: u64 = 1 << 7;
        if current_mask & NONACTIVATING_PANEL == 0 {
            let _: () = msg_send![window, setStyleMask: current_mask | NONACTIVATING_PANEL];
            // -setStyleMask: após window init é documented to reinicia vários
            // NSWindow properties (notably para NSPanel: o panel-specific
            // becomesKeyOnlyIfNeeded flag é one de them por CocoaDev notes).
            // Re-apply o setters that AppKit pode ter wiped. Cheap (one
            // ObjC ddespacha and previne silent regression de o entire
            // stealth modelo quando o style mask caminho é taken.
            if responds_to_becomes_key {
                let _: () = msg_send![window, setBecomesKeyOnlyIfNeeded: true];
            }
            if responds_to_hides {
                let _: () = msg_send![window, setHidesOnDeactivate: false];
            }
            // collectionBehavior também obtém reinicia em style-mask change.
            let _: () = msg_send![window, setCollectionBehavior: behavior];
        }

        // ─── Public API: -[NSWindow setSharingType:] ───
        //
        // NSWindowSharingNone (= 0) exclui o window de
        // `CGWindowListCreateImage` and outro legacy CoreGraphics
        // capture paths. This é o original Spotlight/1Password trick.
        //
        // Em macOS 15+ Sequoia, ScreenCaptureKit (que Ampliar 5.16+, Teams,
        // Loom todos uso nagora Ignora this flag — Apple deliberately
        // changed SCK to capture de o compositor framebuffer independentemente
        // de per-window sharing ttipo Então setSharingType é não longer
        // suficiente em its opróprio Mas it É ainda effective oem
        //   • macOS ≤ 14 (Sonoma and earlier)
        //   • Older Ampliar constrói (pre-5.16) em qualquer macOS
        //   • Loom older bconstrói screencap CLI, OBS Exibir Capture sem SCK
        //   • Maioria native screenshot APIs (Cmd+Shift+4 → window capture)
        // Então we define it como defense-in-depth — costs nnada helps em muitos
        // real-world scenarios. Electron's `setContentProtection(true)`
        // também define this internally, mas apenas quando chamado de JS — going
        // direct de native garante it sticks até if o JS-side alternar
        // é bypassed por alguns code pcaminho
        let sel_set_sharing: Sel = sel!(setSharingType:);
        let responds_raw_sharing: Bool = msg_send![window, respondsToSelector: sel_set_sharing];
        let responds_to_sharing: bool = responds_raw_sharing.as_bool();
        if responds_to_sharing {
            const NS_WINDOW_SHARING_NONE: u64 = 0;
            let _: () = msg_send![window, setSharingType: NS_WINDOW_SHARING_NONE];
        }

        // ─── Private SPI: -[NSWindow _setPreventsActivation:] ───
        //
        // O public `NSWindowStyleMaskNonactivatingPanel` style mask é
        // stored em two places: AppKit's NSWindow objeto AND o WindowServer's
        // per-window tag bitmap (especificamente `kCGSPreventsActivationTagBit`,
        // valor `1 << 16`). Quando you define o style mask via o public API
        // Após window initialization (que we fazer acima como belt-and-braces,
        // and que Electron's `type:'panel'` pode também fazer internally durante
        // window-style upatualiza AppKit fails to resync o WindowServer tag.
        // Result: o window LOOKS nonactivating to AppKit mas o
        // WindowServer ainda treats clicks como app-activating, então o user's
        // foreground app loses frontmost status anyway.
        //
        // O fix é o private `_setPreventsActivation:` selector. It calls
        // `CGSSetWindowTags` em o WindowServer side, flipping
        // `kCGSPreventsActivationTagBit` directly. This é o mesmo SPI
        // Spotlight/Alfred/Raycast uuso documented at
        // https://philz.blog/nspanel-nonactivating-style-mask-flag/ and
        // referenced em o long-standing CocoaDev NSPanel notes.
        //
        // We `respondsToSelector:` primeiro então a future macOS that removes/renames
        // o SPI degrades gracefully — o public-API caminho ainda gives ~90%
        // de o stealth behavior. This é best-effort closure de o
        // remaining 10% gap (o tag desync window onde window-level activation
        // pode ainda leak através to o foreground app).
        let sel_set_prevents: Sel = sel!(_setPreventsActivation:);
        let responds_raw_prevents: Bool = msg_send![window, respondsToSelector: sel_set_prevents];
        let responds_to_prevents: bool = responds_raw_prevents.as_bool();
        if responds_to_prevents {
            let _: () = msg_send![window, _setPreventsActivation: true];
        } else {
            // Registrar to stderr (não eprintln noise a menos que verboseLogging é oem
            // mas this é rare enough — uma vez por overlay creation — that o
            // line é acceptable). Caller (WindowHelper) ignora stderr.
            eprintln!(
                "[stealth_window] _setPreventsActivation: SPI unavailable on this \
                 macOS — public-API stealth still active, but window-level \
                 activation may leak in edge cases (e.g. style-mask updates)."
            );
        }
    }

    Ok(())
}
