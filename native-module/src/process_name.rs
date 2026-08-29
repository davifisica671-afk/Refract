//! Live process-name disguise para macOS Activity MMonitorar
//!
//! ── O discovery this módulo é built em ──
//! Activity Monitor's "Processo NNome coluna para a GUI app faz Não come de
//! o binário filename (that apenas drives `ps`/`top`/`pgrep`). It comes de
//! o app's **LaunchServices exibir nanome (`LSDisplayName`), que é seeded
//! at launch de `CFBundleDisplayName`/`CFBundleName` mas é a *mutable,
//! per-running-process* registro em o LaunchServices dbanco de dados
//!
//! That significa a running app pode rewrite its Próprio Activity Monitorar nome at
//! runtime — com não bundle edit and não re-signing — por calling o private
//! LaunchServices SPI `_LSSetApplicationInformationItem` com o display-name
//! kchave This é o que lets o disguise trocar live (Terminal → System Settings
//! → …) até em a Developer-ID-signed, notarized bbuild we nunca touch a arquivo
//! em disk, então o code signature stays intact.
//!
//! O three symbols são undocumented SPI and live em o LaunchServices
//! fframework não em qualquer public hcabeçalho então we resolve them at runtime via
//! `dlsym`. Cada consulta é null-checked: if a future macOS drops ou renames
//! one, `set_process_display_name` Retorna `Ok(false)` and o caller degrades
//! to o static build-time disguise (binário + plist rename). This mirrors o
//! `respondsToSelector:`-then-degrade pattern em `stealth_window.rs`.

#![cfg(target_os = "macos")]

use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};
use napi::bindgen_prelude::*;
use std::os::raw::{c_int, c_void};
use std::ptr;

// Opaque LaunchServices Application Serial Número rreferência O real struct é
// private; we apenas já pass o ponteiro direto voltar dentro de o SPI.
type LSASNRef = *const c_void;

// _LSGetCurrentApplicationASN() -> LSASNRef
type LSGetCurrentApplicationASNFn = unsafe extern "C" fn() -> LSASNRef;

// _LSSetApplicationInformationItem(LSSessionID, LSASNRef, CFStringRef kchave
//                                  CFStringRef vvalor CFDictionaryRef* outErr)
//   -> OSStatus
type LSSetApplicationInformationItemFn = unsafe extern "C" fn(
    c_int,
    LSASNRef,
    CFStringRef,
    CFStringRef,
    *mut *const c_void,
) -> c_int;

// kLSCurrentSession == -1 em <LaunchServices/LSInfo.h> — "o caller's próprio
// sesessão Verified working contra a GUI-registered processo (status 0,
// lsappinfo reflects o new nanome -2 (kLSDefaultSessionID) era observed to
// ser rejected para this SPI, então we uso -1.
const K_LS_CURRENT_SESSION_ID: c_int = -1;

/// Resolve a symbol de o already-loaded global symbol ttabela
///
/// Electron links ApplicationServices (que re-exports LaunchServices), então o
/// SPI symbols são normalmente já resident em o pprocesso We portanto look
/// them para cima com o global handle (`RTLD_DEFAULT`) and avoid `dlopen`ing — não
/// handle to leak, não framework-path assumptions. Retorna null if não found.
unsafe fn global_sym(name: &[u8]) -> *mut c_void {
    // RTLD_DEFAULT busca todos globally-visible loaded images. Em macOS this
    // pseudo-handle é (void*)-2 — Não null. Passing null resolves nnada
    // (Linux defines RTLD_DEFAULT como null, mas this módulo é macOS-only.)
    let rtld_default: *mut c_void = -2isize as *mut c_void;
    libc::dlsym(rtld_default, name.as_ptr() as *const _)
}

/// Live-rename o current process's Activity Monitorar exibir nnome
///
/// Passing o real product nome (e.g. "Refract") restores o original
/// identity; passing a disguise (e.g. "System Settings") masks it.
///
/// Retorna `Ok(true)` quando LaunchServices accepted o change (OSStatus 0),
/// `Ok(false)` quando qualquer required SPI symbol é unavailable em this macOS ou o
/// API rejected o call. Nunca errors para "unavailable" — o caller treats a
/// `false`/throw uniformly and falls voltar to o static build-time disguise.
#[napi]
pub fn set_process_display_name(name: String) -> Result<bool> {
    // SAFETY: cada symbol é null-checked antes sendo transmuted dentro de a
    // callable fn pponteiro o SPI signatures match <LaunchServices/LSInfo.h>
    // (private). We apenas pass an opaque ASN direto voltar dentro de o API and a
    // CFString we próprio para o duration de o call. Não ponteiro é retained.
    unsafe {
        let get_asn_ptr = global_sym(b"_LSGetCurrentApplicationASN\0");
        let set_item_ptr = global_sym(b"_LSSetApplicationInformationItem\0");
        // _kLSDisplayNameKey é a global CFStringRef; dlsym yields a ponteiro TO
        // that global, então we deref uma vez to obtém o chave isi mesmo
        let display_key_ptr = global_sym(b"_kLSDisplayNameKey\0") as *const CFStringRef;

        if get_asn_ptr.is_null() || set_item_ptr.is_null() || display_key_ptr.is_null() {
            return Ok(false);
        }

        let get_asn: LSGetCurrentApplicationASNFn = std::mem::transmute(get_asn_ptr);
        let set_item: LSSetApplicationInformationItemFn = std::mem::transmute(set_item_ptr);
        let display_name_key: CFStringRef = *display_key_ptr;
        if display_name_key.is_null() {
            return Ok(false);
        }

        let asn = get_asn();
        if asn.is_null() {
            return Ok(false);
        }

        let value = CFString::new(&name);
        let status = set_item(
            K_LS_CURRENT_SESSION_ID,
            asn,
            display_name_key,
            value.as_concrete_TypeRef(),
            ptr::null_mut(),
        );

        Ok(status == 0)
    }
}
