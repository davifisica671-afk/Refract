import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, CreditCard, ArrowRight } from 'lucide-react';

/**
 * LemonSqueezyCheckoutButton.tsx
 * Checkout internacional (cartão) em três estados, num único elemento que se
 * transforma — mesmo padrão do PixCheckoutButton:
 *
 *   idle → e-mail → abrindo checkout → aguardando pagamento → ativado
 *
 * O checkout hospedado abre no navegador; a licença REFRACT-PRO é ativada
 * sozinha pelo main process assim que o polling confirma o pagamento.
 * Se o backend não estiver disponível, o manager cai no fallback de URL
 * direta (sem checkoutId) e o botão mostra o caminho manual por e-mail.
 */

type Phase = 'idle' | 'email' | 'creating' | 'waiting' | 'manual' | 'done' | 'error';

const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60_000; // 15 min — depois disso, cai no manual

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Copy por locale — este botão aparece tanto para pt (como alternativa ao Pix)
// quanto para o resto do mundo (como caminho primário de cartão), então precisa
// falar o idioma da tela.
const IS_PT = typeof navigator !== 'undefined' && /^pt\b/i.test(navigator.language || '');
const COPY = IS_PT
    ? {
        payByCard: 'Pagar com cartão',
        emailPlaceholder: 'voce@email.com',
        checkout: 'Finalizar',
        opening: 'Abrindo checkout…',
        waiting: 'Aguardando pagamento…',
        cancel: 'Cancelar',
        activated: 'Pro ativado',
        manual: 'Confira seu e-mail — o Pro ativa sozinho assim que o pagamento confirmar.',
        back: 'Voltar',
        tryAgain: 'Tentar novamente',
        invalidEmail: 'Digite um e-mail válido para receber sua licença.',
        openError: 'Não foi possível abrir o checkout. Tente novamente.',
        connError: 'Falha de conexão. Verifique sua internet.',
        waitingHint: 'Conclua o pagamento no navegador. Pode fechar esta janela.',
        emailHint: 'Sua chave de licença será enviada para este e-mail.',
    }
    : {
        payByCard: 'Pay by card',
        emailPlaceholder: 'you@email.com',
        checkout: 'Checkout',
        opening: 'Opening checkout…',
        waiting: 'Waiting for payment…',
        cancel: 'Cancel',
        activated: 'Pro activated',
        manual: 'Check your e-mail — Pro activates automatically once payment confirms',
        back: 'Back',
        tryAgain: 'Try again',
        invalidEmail: 'Enter a valid e-mail to receive your license.',
        openError: 'Could not open checkout. Try again.',
        connError: 'Connection failed. Check your internet.',
        waitingHint: 'Complete the payment in your browser. You can close this window.',
        emailHint: 'Your license key will be sent to this e-mail.',
    };

export interface LemonSqueezyCheckoutButtonProps {
    plan: 'lifetime' | 'yearly' | 'monthly';
    /** Preço já formatado, ex.: "$24". Exibido no estado inicial. */
    priceLabel?: string;
    /** Disparado quando o Pro é ativado — o pai deve recarregar a licença. */
    onActivated?: () => void;
    className?: string;
}

export const LemonSqueezyCheckoutButton: React.FC<LemonSqueezyCheckoutButtonProps> = ({
    plan,
    priceLabel,
    onActivated,
    className = '',
}) => {
    const [phase, setPhase] = useState<Phase>('idle');
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');

    const inputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<number | null>(null);
    const deadlineRef = useRef(0);
    const checkoutIdRef = useRef('');

    const stopPolling = useCallback(() => {
        if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    useEffect(() => stopPolling, [stopPolling]);

    useEffect(() => {
        if (phase === 'email') inputRef.current?.focus();
    }, [phase]);

    // Rede de segurança: o main process persiste a compra pendente e continua
    // o polling mesmo se esta janela/app fechar. Quando ele ativa, a UI
    // atualiza na hora — inclusive depois de reabrir o app.
    useEffect(() => {
        const unsub = (window.electronAPI as any)?.onPurchaseActivationChanged?.((data: any) => {
            if (
                data?.status === 'activated' &&
                data?.checkoutId &&
                data.checkoutId === checkoutIdRef.current
            ) {
                stopPolling();
                setPhase('done');
                onActivated?.();
            }
        });
        return () => unsub?.();
    }, [onActivated, stopPolling]);

    const startPolling = useCallback((checkoutId: string) => {
        deadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
        stopPolling();
        pollRef.current = window.setInterval(async () => {
            if (Date.now() > deadlineRef.current) {
                stopPolling();
                setPhase('manual');
                return;
            }
            try {
                const res = await window.electronAPI?.lemonsqueezyPollLicense?.(checkoutId);
                if (res?.activated) {
                    stopPolling();
                    setPhase('done');
                    onActivated?.();
                }
                // pending ou erro transitório — continua tentando até o deadline
            } catch {
                /* rede instável — a próxima tentativa resolve */
            }
        }, POLL_MS);
    }, [onActivated, stopPolling]);

    const handleSubmit = useCallback(async () => {
        const value = email.trim();
        if (!EMAIL_RE.test(value)) {
            setError(COPY.invalidEmail);
            return;
        }
        setError('');
        setPhase('creating');
        try {
            const res = await window.electronAPI?.lemonsqueezyCreateCheckout?.({ plan, email: value });
            if (!res?.success) {
                setPhase('error');
                setError(res?.error || COPY.openError);
                return;
            }
            if (res.checkoutUrl) {
                (window.electronAPI as any)?.openExternal?.(res.checkoutUrl);
            }
            if (res.checkoutId) {
                checkoutIdRef.current = res.checkoutId;
                setPhase('waiting');
                startPolling(res.checkoutId);
                // Fire-and-forget: o main process assume a ativação em
                // background (sobrevive a fechar janela/app; expira em 7 dias).
                try {
                    void window.electronAPI?.purchaseActivationTrack?.({
                        provider: 'lemonsqueezy',
                        checkoutId: res.checkoutId,
                        plan,
                        email: value,
                    });
                } catch {
                    /* best-effort — o poll local continua como caminho primário */
                }
            } else {
                // Fallback de URL direta — sem checkout rastreável, a chave
                // chega por e-mail e a ativação é manual.
                setPhase('manual');
            }
        } catch {
            setPhase('error');
            setError(COPY.connError);
        }
    }, [email, plan, startPolling]);

    const reset = () => {
        stopPolling();
        // Não cancelamos o rastreio no main process de propósito: se o usuário
        // concluir o pagamento mais tarde, o Pro ainda ativa sozinho.
        checkoutIdRef.current = '';
        setPhase('idle');
        setError('');
    };

    // Superfície comum: mesmo hairline do PixCheckoutButton, tonalidade sky.
    const shell =
        'relative w-full h-11 rounded-full overflow-hidden flex items-center justify-center ' +
        'transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50';

    return (
        <div className={`w-full ${className}`}>
            <AnimatePresence mode="wait" initial={false}>
                {/* ── Repouso ─────────────────────────────────────────── */}
                {phase === 'idle' && (
                    <motion.button
                        key="idle"
                        onClick={(e) => { e.stopPropagation(); setPhase('email'); }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        whileHover={{ scale: 1.008 }}
                        whileTap={{ scale: 0.992 }}
                        className={`${shell} group text-sky-50 bg-sky-500/[0.09] ring-1 ring-sky-400/25 hover:bg-sky-500/[0.15] hover:ring-sky-400/40`}
                    >
                        <span className="flex items-center gap-2.5 text-[13px] font-semibold tracking-[-0.005em]">
                            <span className="text-sky-300"><CreditCard size={15} /></span>
                            {COPY.payByCard}
                            {priceLabel && (
                                <span className="text-sky-200/60 font-medium tabular-nums">· {priceLabel}</span>
                            )}
                            <ArrowRight size={13} className="opacity-0 -translate-x-1 group-hover:opacity-60 group-hover:translate-x-0 transition-all duration-300" />
                        </span>
                    </motion.button>
                )}

                {/* ── E-mail: o botão vira campo ──────────────────────── */}
                {phase === 'email' && (
                    <motion.div
                        key="email"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className={`${shell} bg-white/[0.05] ring-1 ring-white/[0.12] focus-within:ring-sky-400/45 pl-4 pr-1.5 !justify-start gap-2`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <span className="text-sky-300/70 shrink-0"><CreditCard size={14} /></span>
                        <input
                            ref={inputRef}
                            type="email"
                            value={email}
                            onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
                                if (e.key === 'Escape') reset();
                            }}
                            placeholder={COPY.emailPlaceholder}
                            spellCheck={false}
                            autoComplete="email"
                            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px] text-text-primary placeholder:text-text-tertiary/70"
                        />
                        <button
                            onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
                            disabled={!EMAIL_RE.test(email.trim())}
                            className="shrink-0 h-8 px-3.5 rounded-full text-[12.5px] font-semibold bg-sky-500 text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-sky-400 active:scale-95"
                        >
                            {COPY.checkout}
                        </button>
                    </motion.div>
                )}

                {/* ── Abrindo checkout ────────────────────────────────── */}
                {phase === 'creating' && (
                    <motion.div
                        key="creating"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={`${shell} bg-white/[0.05] ring-1 ring-white/[0.1] text-text-secondary`}
                    >
                        <span className="flex items-center gap-2.5 text-[13px] font-medium">
                            <Loader2 size={14} className="animate-spin" />
                            {COPY.opening}
                        </span>
                    </motion.div>
                )}

                {/* ── Aguardando pagamento no navegador ────────────────── */}
                {phase === 'waiting' && (
                    <motion.div
                        key="waiting"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={`${shell} bg-sky-500/[0.07] ring-1 ring-sky-400/25`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <motion.span
                            aria-hidden
                            className="absolute inset-y-0 w-1/3 pointer-events-none"
                            style={{ background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.10), transparent)' }}
                            animate={{ x: ['-120%', '320%'] }}
                            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        <span className="relative flex items-center gap-2.5 text-[13px] font-medium text-sky-100">
                            <span className="relative flex h-[7px] w-[7px]">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-60" />
                                <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-sky-400" />
                            </span>
                            {COPY.waiting}
                        </span>
                        <button
                            onClick={(e) => { e.stopPropagation(); reset(); }}
                            className="absolute right-3 text-[11px] font-medium text-sky-200/45 hover:text-sky-100 transition-colors"
                        >
                            {COPY.cancel}
                        </button>
                    </motion.div>
                )}

                {/* ── Ativado ─────────────────────────────────────────── */}
                {phase === 'done' && (
                    <motion.div
                        key="done"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className={`${shell} bg-sky-500 text-white`}
                    >
                        <span className="flex items-center gap-2.5 text-[13px] font-semibold">
                            <Check size={15} strokeWidth={3} />
                            {COPY.activated}
                        </span>
                    </motion.div>
                )}

                {/* ── Manual: chave vem por e-mail ────────────────────── */}
                {phase === 'manual' && (
                    <motion.div
                        key="manual"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={`${shell} bg-white/[0.05] ring-1 ring-white/[0.12] text-text-secondary`}>
                            <span className="text-[12.5px] font-medium text-center px-4">
                                {COPY.manual}
                            </span>
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); reset(); }}
                            className="mt-2 w-full text-[11px] font-medium text-text-tertiary hover:text-text-secondary transition-colors"
                        >
                            {COPY.back}
                        </button>
                    </motion.div>
                )}

                {/* ── Erro ────────────────────────────────────────────── */}
                {phase === 'error' && (
                    <motion.div
                        key="error"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={(e) => { e.stopPropagation(); reset(); }}
                            className={`${shell} bg-white/[0.05] ring-1 ring-white/[0.12] text-text-secondary hover:bg-white/[0.08]`}
                        >
                            <span className="text-[12.5px] font-medium">{COPY.tryAgain}</span>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Linha de apoio — só aparece quando há algo a dizer */}
            <AnimatePresence>
                {(error || phase === 'waiting' || phase === 'email') && (
                    <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className={`mt-2 text-center text-[10px] leading-snug ${error ? 'text-rose-300/80' : 'text-text-tertiary'}`}
                    >
                        {error
                            || (phase === 'waiting'
                                ? COPY.waitingHint
                                : COPY.emailHint)}
                    </motion.p>
                )}
            </AnimatePresence>
        </div>
    );
};

export default LemonSqueezyCheckoutButton;
