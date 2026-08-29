import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, ArrowRight } from 'lucide-react';

/**
 * PixCheckoutButton.tsx
 * Compra via PIX em três estados, num único elemento que se transforma:
 *
 *   idle → e-mail → aguardando pagamento → ativado
 *
 * Sem modal, sem página nova: o botão vira campo, o campo vira status.
 * A licença é ativada sozinha pelo main process assim que o webhook
 * confirma o pagamento — o usuário não cola nada.
 */

type Phase = 'idle' | 'email' | 'creating' | 'waiting' | 'done' | 'error';

const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60_000; // 15 min — depois disso, cai no e-mail

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Marca do PIX — losango do Banco Central, traçado, herda currentColor. */
const PixGlyph: React.FC<{ size?: number }> = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M12 2.6 21.4 12 12 21.4 2.6 12 12 2.6Z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
        />
        <path d="M8.6 8.6 12 12l3.4-3.4M8.6 15.4 12 12l3.4 3.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export interface PixCheckoutButtonProps {
    plan: 'lifetime' | 'yearly' | 'monthly';
    /** Preço já formatado em BRL, ex.: "R$ 249". Exibido no estado inicial. */
    priceLabel?: string;
    /** Disparado quando o Pro é ativado — o pai deve recarregar a licença. */
    onActivated?: () => void;
    className?: string;
}

export const PixCheckoutButton: React.FC<PixCheckoutButtonProps> = ({
    plan,
    priceLabel,
    onActivated,
    className = '',
}) => {
    const [phase, setPhase] = useState<Phase>('idle');
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [manualKey, setManualKey] = useState('');

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
                setPhase('error');
                setError('Se você pagou, o Pro será ativado automaticamente em segundo plano. A chave também foi para seu e-mail.');
                return;
            }
            try {
                const res = await window.electronAPI?.pixPollLicense?.(checkoutId);
                if (!res?.ok) return; // erro transitório de rede — continua tentando
                if (res.status === 'activated') {
                    stopPolling();
                    setPhase('done');
                    onActivated?.();
                } else if (res.status === 'paid') {
                    // Pago, mas a ativação automática falhou — mostra a chave.
                    stopPolling();
                    setManualKey(res.licenseKey || '');
                    setPhase('error');
                    setError('Pagamento confirmado. Copie a chave abaixo e ative manualmente.');
                }
            } catch {
                /* rede instável — a próxima tentativa resolve */
            }
        }, POLL_MS);
    }, [onActivated, stopPolling]);

    const handleSubmit = useCallback(async () => {
        const value = email.trim();
        if (!EMAIL_RE.test(value)) {
            setError('Digite um e-mail válido para receber a chave.');
            return;
        }
        setError('');
        setPhase('creating');
        try {
            const res = await window.electronAPI?.pixCreateCheckout?.({ plan, email: value });
            if (!res?.ok || !res.url || !res.checkoutId) {
                setPhase('error');
                setError(
                    res?.error === 'invalid_email'
                        ? 'E-mail inválido.'
                        : 'Não foi possível abrir o checkout. Tente novamente.',
                );
                return;
            }
            (window.electronAPI as any)?.openExternal?.(res.url);
            checkoutIdRef.current = res.checkoutId;
            setPhase('waiting');
            startPolling(res.checkoutId);
            // Fire-and-forget: o main process assume a ativação em background
            // (sobrevive a fechar janela/app; expira só após 7 dias).
            try {
                void window.electronAPI?.purchaseActivationTrack?.({
                    provider: 'pix',
                    checkoutId: res.checkoutId,
                    plan,
                    email: value,
                });
            } catch {
                /* best-effort — o poll local continua como caminho primário */
            }
        } catch {
            setPhase('error');
            setError('Falha de conexão. Verifique sua internet.');
        }
    }, [email, plan, startPolling]);

    const reset = () => {
        stopPolling();
        // Não cancelamos o rastreio no main process de propósito: se o usuário
        // pagar o PIX aberto mais tarde, o Pro ainda ativa sozinho.
        checkoutIdRef.current = '';
        setPhase('idle');
        setError('');
        setManualKey('');
    };

    // Superfície comum: hairline sobre vidro, sem gloss.
    const shell =
        'relative w-full h-11 rounded-full overflow-hidden flex items-center justify-center ' +
        'transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50';

    return (
        <div className={`w-full ${className}`}>
            <AnimatePresence mode="wait" initial={false}>
                {/* ── Repouso: convite silencioso ─────────────────────── */}
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
                        className={`${shell} group text-emerald-50 bg-emerald-500/[0.09] ring-1 ring-emerald-400/25 hover:bg-emerald-500/[0.15] hover:ring-emerald-400/40`}
                    >
                        <span className="flex items-center gap-2.5 text-[13px] font-semibold tracking-[-0.005em]">
                            <span className="text-emerald-300"><PixGlyph size={15} /></span>
                            Comprar com Pix
                            {priceLabel && (
                                <span className="text-emerald-200/60 font-medium tabular-nums">· {priceLabel}</span>
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
                        className={`${shell} bg-white/[0.05] ring-1 ring-white/[0.12] focus-within:ring-emerald-400/45 pl-4 pr-1.5 !justify-start gap-2`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <span className="text-emerald-300/70 shrink-0"><PixGlyph size={14} /></span>
                        <input
                            ref={inputRef}
                            type="email"
                            value={email}
                            onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
                                if (e.key === 'Escape') reset();
                            }}
                            placeholder="seu@email.com"
                            spellCheck={false}
                            autoComplete="email"
                            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px] text-text-primary placeholder:text-text-tertiary/70"
                        />
                        <button
                            onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
                            disabled={!EMAIL_RE.test(email.trim())}
                            className="shrink-0 h-8 px-3.5 rounded-full text-[12.5px] font-semibold bg-emerald-500 text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-emerald-400 active:scale-95"
                        >
                            Gerar Pix
                        </button>
                    </motion.div>
                )}

                {/* ── Criando cobrança ────────────────────────────────── */}
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
                            Abrindo checkout…
                        </span>
                    </motion.div>
                )}

                {/* ── Aguardando pagamento: respiração viva ───────────── */}
                {phase === 'waiting' && (
                    <motion.div
                        key="waiting"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={`${shell} bg-emerald-500/[0.07] ring-1 ring-emerald-400/25`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Varredura lenta — sinal de vida, não spinner */}
                        <motion.span
                            aria-hidden
                            className="absolute inset-y-0 w-1/3 pointer-events-none"
                            style={{ background: 'linear-gradient(90deg, transparent, rgba(52,211,153,0.10), transparent)' }}
                            animate={{ x: ['-120%', '320%'] }}
                            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        <span className="relative flex items-center gap-2.5 text-[13px] font-medium text-emerald-100">
                            <span className="relative flex h-[7px] w-[7px]">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                                <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-emerald-400" />
                            </span>
                            Aguardando pagamento…
                        </span>
                        <button
                            onClick={(e) => { e.stopPropagation(); reset(); }}
                            className="absolute right-3 text-[11px] font-medium text-emerald-200/45 hover:text-emerald-100 transition-colors"
                        >
                            Cancelar
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
                        className={`${shell} bg-emerald-500 text-white`}
                    >
                        <span className="flex items-center gap-2.5 text-[13px] font-semibold">
                            <Check size={15} strokeWidth={3} />
                            Pro ativado
                        </span>
                    </motion.div>
                )}

                {/* ── Erro / fallback manual ──────────────────────────── */}
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
                            <span className="text-[12.5px] font-medium">Tentar novamente</span>
                        </button>
                        {manualKey && (
                            <button
                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(manualKey); }}
                                className="mt-2 w-full text-left px-3 py-2 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08] hover:bg-white/[0.07] transition-colors"
                                title="Clique para copiar"
                            >
                                <span className="block text-[10px] font-mono text-text-tertiary truncate">{manualKey}</span>
                            </button>
                        )}
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
                                ? 'Ative na hora que o Pix cair. Pode fechar esta janela.'
                                : 'Enviamos a chave de licença para este e-mail.')}
                    </motion.p>
                )}
            </AnimatePresence>
        </div>
    );
};

export default PixCheckoutButton;
