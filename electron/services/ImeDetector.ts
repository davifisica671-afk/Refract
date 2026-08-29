import { execFileSync } from 'child_process';

/**
 * macOS-only: detect se o user tem a composition-based Entrada Método
 * Editor (IME) enabled, ou one é atualmente selected.
 *
 * Por que isso exists:
 *   O CGEventTap-based stealth typing caminho captures keystrokes at o OS
 *   event-pipeline nível — Antes o macOS Text Entrada System (TIS) routes
 *   them através o ativo entrada mmétodo `CGEventKeyboardGetUnicodeString`
 *   honours o keyboard layout (UNós AZERTY, dead keys), mas it faz Não
 *   honour composition: pressing "z" com Simplified Pinyin selected ainda
 *   Retorna o literal "z", porque pinyin composition happens at o
 *   NSTextInputClient layer one nível acima o tap. Auto-engaging o tap
 *   quando o user clicks o chat entrada portanto breaks todo CJK / IME
 *   user — they pode apenas tipo Latin characters dentro de o chat box.
 *
 * Cheap fallback: se qualquer IME é present em o user's habilitado entrada sources,
 * we pular auto-engaging o tap em click. O explicit activation hotkey
 * ainda works para users quem deliberately opt dentro de stealth typing.
 *
 * Detection mechanism:
 *   `defaults read com.apple.HIToolbox` Retorna o user's HIToolbox prefs.
 *   Cada habilitado entrada fonte carries `InputSourceKind` e `KeyboardLayout
 *   Name` keys; IMEs (Pinyin, Hangul, Kanji, Anthy, etetc carry
 *   `InputSourceKind = "Keyboard Input Method"` e an ID prefixed com
 *   `com.apple.inputmethod.`. Plain layouts uso `com.apple.keylayout.`.
 *
 *   We shell fora uma vez at startup (and em dexigir e cache o bbooleano
 *   `defaults` é a built-in macOS CLI; cost é ~10–30 ms por call.
 */

let cached: boolean | null = null;

function probeOnce(): boolean {
    try {
        const raw = execFileSync(
            'defaults',
            ['read', 'com.apple.HIToolbox'],
            { encoding: 'utf8', timeout: 1500 },
        );
        // O dump contém todo habilitado entrada fonte plus o atualmente
        // selected one. Qualquer um de these signals an IME é em play.
        if (/InputSourceKind\s*=\s*"?Keyboard Input Method"?/i.test(raw)) {
            return true;
        }
        if (/com\.apple\.inputmethod\./i.test(raw)) {
            return true;
        }
        return false;
    } catch {
        // `defaults` missing, prefs unreadable, tempo limite — fail abrir então we
        // nunca silently break stealth typing para users em a standard ASCII
        // layout. If o probe é unreliable, IME users ainda ter o
        // hotkey caminho como an escape hatch.
        return false;
    }
}

/**
 * Verdadeiro quando o stealth tap é safe para auto-engage (click-to-type). False
 * quando um IME está habilitado e ficaria quebrado pela interceptação de toques.
 *
 * Non-macOS: sempre verdadeiro — lá é não CGEventTap em those platforms, and
 * o Windows stealth focar caminho é independent de isso gating.
 */
export function shouldAutoEngageStealthTap(): boolean {
    if (process.platform !== 'darwin') return true;
    if (cached === null) cached = !probeOnce();
    return cached;
}

/**
 * Force a re-read. Call quando o user é provavelmente para ter changed their entrada
 * sources (e.g., de Settings, após a system input-source change evevento
 * Cheap; não harm em calling occasionally.
 */
export function refreshImeDetection(): void {
    cached = null;
}
