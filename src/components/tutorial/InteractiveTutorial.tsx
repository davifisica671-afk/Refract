import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
    Camera,
    MessageSquareText,
    ShieldCheck,
    Keyboard,
    ArrowRight,
    ArrowLeft,
    Check,
    GraduationCap,
    Clock,
} from 'lucide-react';
import { RefractLogoMark } from '../RefractLogoMark';
import { analytics } from '../../lib/analytics/analytics.service';

/**
 * InteractiveTutorial.tsx
 * Tour guiado de 5 passos para o primeiro uso — reprisável pelo topbar.
 *
 * Craft: mesma linguagem do FeatureSpotlight (superfície escura, hairline,
 * orbe-aurora por passo) levada um grau acima —
 *   • transições DIRECIONAIS: o conteúdo desliza no sentido da navegação,
 *     com entrada em cascata (eyebrow → headline → corpo → atalhos)
 *   • orbe flutuante que faz crossfade de cor por passo, com deriva lenta
 *   • keycaps 3D (bisel superior iluminado, base em relevo, afundam no hover)
 *   • uma palavra do headline por passo em gradiente com o accent
 *   • progresso com ponta luminosa (cometa) + dots de passo preenchidos
 *   • reduced-motion respeitado; foco gerenciado no botão primário
 *
 * Os atalhos exibidos são os defaults reais do KeybindManager. Concluir OU
 * pular marca a flag persistente seenInteractiveTutorial.
 */

type StepId = 'welcome' | 'summon' | 'capture' | 'ask' | 'private';

interface Step {
    id: StepId;
    eyebrow: string;
    headline: string;
    /** Palavra do headline que recebe o gradiente de accent. */
    highlight: string;
    body: string;
    accent: string; // rgb "r,g,b"
    icon: React.ElementType;
    shortcuts?: Array<{ keys: string[]; label: string }>;
}

const isMacPlatform = () =>
    typeof window !== 'undefined' && (window as any).electronAPI?.platform === 'darwin';

/** Traduz um accelerator "CommandOrControl+X" para chips por plataforma. */
const kbdChips = (accelerator: string): string[] => {
    const mac = isMacPlatform();
    const mod = mac ? '⌘' : 'Ctrl';
    return accelerator.split('+').map((part) =>
        part === 'CommandOrControl' ? mod : part === 'Shift' ? (mac ? '⇧' : 'Shift') : part,
    );
};

const STEPS: Step[] = [
    {
        id: 'welcome',
        eyebrow: 'Welcome',
        headline: 'Your private copilot for live moments',
        highlight: 'private',
        body: 'Refract listens to your meetings and interviews, transcribes in real time, and feeds you answers through an invisible overlay. Sixty seconds and you know everything.',
        accent: '99,102,241',
        icon: GraduationCap,
    },
    {
        id: 'summon',
        eyebrow: 'Step 1',
        headline: 'Summon it anywhere',
        highlight: 'anywhere',
        body: 'Start a meeting and the overlay sits on top of Zoom, Meet, or Teams — invisible to screen shares. These shortcuts work from inside any app:',
        accent: '56,132,255',
        icon: Keyboard,
        shortcuts: [
            { keys: kbdChips('CommandOrControl+B'), label: 'Show / hide the overlay' },
            { keys: kbdChips('CommandOrControl+Shift+B'), label: 'Click-through mode' },
        ],
    },
    {
        id: 'capture',
        eyebrow: 'Step 2',
        headline: 'Point. Shoot. Understand.',
        highlight: 'Understand.',
        body: 'Slide on screen? Coding problem on LeetCode? Capture it and the AI reads the image — full screen or just a region:',
        accent: '52,211,153',
        icon: Camera,
        shortcuts: [
            { keys: kbdChips('CommandOrControl+H'), label: 'Screenshot the whole screen' },
            { keys: kbdChips('CommandOrControl+Shift+H'), label: 'Select a region' },
        ],
    },
    {
        id: 'ask',
        eyebrow: 'Step 3',
        headline: 'Ask while it\u2019s hot',
        highlight: 'hot',
        body: 'The rolling transcript keeps full context of who said what — dual channel: system audio for them, your mic for you. One key gets an instant hint:',
        accent: '251,191,36',
        icon: MessageSquareText,
        shortcuts: [{ keys: kbdChips('CommandOrControl+1'), label: '"What should I answer?"' }],
    },
    {
        id: 'private',
        eyebrow: 'Step 4',
        headline: 'Yours alone',
        highlight: 'alone',
        body: 'Transcripts, memory, and keys stay on this machine. Bring any model — Gemini, GPT, Claude, Groq, or 100% offline with Ollama — in Settings → AI Providers. When you\u2019re ready, Practice (topbar → Target) rehearses you for the real thing.',
        accent: '167,139,250',
        icon: ShieldCheck,
    },
];

// Easing "expo-out" — a mesma família usada no FeatureSpotlight.
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Headline com a palavra-destaque em gradiente branco → accent. */
const Headline: React.FC<{ step: Step }> = ({ step }) => {
    const h = step.headline;
    const idx = h.indexOf(step.highlight);
    if (idx < 0) return <>{h}</>;
    return (
        <>
            {h.slice(0, idx)}
            <span
                style={{
                    background: `linear-gradient(115deg, #ffffff 12%, rgba(${step.accent},0.95) 100%)`,
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                }}
            >
                {step.highlight}
            </span>
            {h.slice(idx + step.highlight.length)}
        </>
    );
};

/** Keycap 3D — topo iluminado, base em relevo, afunda no active. */
const KeyCap: React.FC<{ k: string; accent: string }> = ({ k, accent }) => (
    <kbd
        className="inline-flex items-center justify-center min-w-[27px] h-[27px] px-1.5 rounded-[7px] text-[11.5px] font-semibold text-white/85 select-none cursor-default transition-transform duration-100"
        style={{
            background: `linear-gradient(180deg, rgba(${accent},0.16), rgba(${accent},0.05) 55%, rgba(255,255,255,0.02))`,
            border: `1px solid rgba(${accent},0.32)`,
            borderBottomColor: `rgba(${accent},0.55)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -2px 0 rgba(0,0,0,0.42), 0 2px 5px rgba(0,0,0,0.38)`,
        }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(1.5px)'; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = ''; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = ''; }}
    >
        {k}
    </kbd>
);

export interface InteractiveTutorialProps {
    open: boolean;
    onClose: () => void;
}

export const InteractiveTutorial: React.FC<InteractiveTutorialProps> = ({ open, onClose }) => {
    const [index, setIndex] = useState(0);
    const [direction, setDirection] = useState(1);
    const step = STEPS[index];
    const isLast = index === STEPS.length - 1;
    const reduced = useReducedMotion() ?? false;
    const primaryRef = useRef<HTMLButtonElement>(null);

    const markSeen = useCallback(() => {
        window.electronAPI?.onboardingSetFlag?.('seenInteractiveTutorial', true).catch(() => {});
    }, []);

    const finish = useCallback(() => {
        analytics.trackCommandExecuted?.('tutorial_completed');
        markSeen();
        onClose();
    }, [markSeen, onClose]);

    const skip = useCallback(() => {
        markSeen();
        onClose();
    }, [markSeen, onClose]);

    const go = useCallback((delta: number) => {
        setDirection(delta);
        setIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
    }, []);

    const next = useCallback(() => {
        if (index === 0) analytics.trackCommandExecuted?.('tutorial_started');
        if (isLast) finish();
        else go(1);
    }, [finish, go, index, isLast]);

    const back = useCallback(() => go(-1), [go]);

    // Reset ao (re)abrir + foco no primário a cada passo (diálogo acessível).
    useEffect(() => {
        if (open) { setIndex(0); setDirection(1); }
    }, [open]);

    useEffect(() => {
        if (open) primaryRef.current?.focus({ preventScroll: true });
    }, [open, index]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); skip(); }
            else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, next, back, skip]);

    const progress = useMemo(() => (index + 1) / STEPS.length, [index]);

    // Variantes de entrada em cascata para os filhos do passo.
    const stagger = {
        hidden: {},
        show: { transition: { staggerChildren: 0.055, delayChildren: 0.06 } },
    };
    const rise = {
        hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 12 },
        show: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.5, ease: EASE_OUT },
        },
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[80] flex items-center justify-center p-6"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0.12 : 0.24 }}
                    style={{
                        background: 'rgba(5,6,8,0.74)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                    }}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Refract tutorial"
                >
                    {/* Vinheta radial sobre o backdrop — profundidade sem ruído */}
                    <div
                        aria-hidden
                        className="absolute inset-0 pointer-events-none"
                        style={{ background: 'radial-gradient(120% 130% at 50% 38%, transparent 42%, rgba(0,0,0,0.38) 100%)' }}
                    />

                    <motion.div
                        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.955, y: 18 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
                        transition={{ type: 'spring', stiffness: 290, damping: 26 }}
                        className="relative w-full max-w-[540px] rounded-[20px] overflow-hidden border border-white/[0.1]"
                        style={{ background: '#0e1015', boxShadow: '0 48px 120px -28px rgba(0,0,0,0.92)' }}
                    >
                        {/* Hairline superior */}
                        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.18] to-transparent pointer-events-none z-10" />

                        {/* ── Orbe-aurora do passo ───────────────────────────
                            Crossfade de cor por passo + deriva lenta contínua.
                            Eco do FeatureSpotlight: o tour "viaja" com o launcher. */}
                        <div aria-hidden className="absolute -top-24 -right-24 w-[340px] h-[340px] pointer-events-none z-0">
                            <AnimatePresence mode="wait" initial={false}>
                                <motion.div
                                    key={`orb-${step.id}`}
                                    initial={{ opacity: 0, scale: 0.82 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 1.08 }}
                                    transition={{ duration: 0.85, ease: EASE_OUT }}
                                    className="absolute inset-0 rounded-full"
                                    style={{
                                        background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), rgba(${step.accent},0.20) 26%, rgba(${step.accent},0.05) 56%, transparent 72%)`,
                                    }}
                                />
                            </AnimatePresence>
                            {!reduced && (
                                <motion.div
                                    className="absolute inset-0 rounded-full"
                                    style={{
                                        background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), rgba(${step.accent},0.20) 26%, rgba(${step.accent},0.05) 56%, transparent 72%)`,
                                    }}
                                    animate={{ y: [0, -9, 0], x: [0, 5, 0] }}
                                    transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
                                />
                            )}
                        </div>

                        {/* Lavagem de cor diagonal do passo */}
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={`wash-${step.id}`}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.65, ease: 'easeOut' }}
                                className="absolute inset-0 pointer-events-none"
                                style={{
                                    background: `linear-gradient(128deg, transparent 30%, rgba(${step.accent},0.05) 68%, rgba(${step.accent},0.12) 100%)`,
                                }}
                            />
                        </AnimatePresence>

                        <div className="relative z-[5] px-9 pt-8 pb-6">
                            {/* Cabeçalho: marca + contador + skip */}
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-2.5">
                                    <div
                                        className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center border transition-colors duration-500"
                                        style={{
                                            background: `rgba(${step.accent},0.12)`,
                                            borderColor: `rgba(${step.accent},0.25)`,
                                        }}
                                    >
                                        <RefractLogoMark size={14} className="text-white/70" />
                                    </div>
                                    <span className="text-[12px] font-semibold text-white/70 tracking-[-0.01em]">
                                        Refract
                                    </span>
                                </div>
                                <div className="flex items-center gap-3.5">
                                    <span className="text-[10.5px] tabular-nums tracking-[0.08em] text-white/35">
                                        {String(index + 1).padStart(2, '0')}
                                        <span className="mx-1 text-white/20">—</span>
                                        {String(STEPS.length).padStart(2, '0')}
                                    </span>
                                    <button
                                        onClick={skip}
                                        className="text-[11.5px] font-medium text-white/35 hover:text-white/70 transition-colors"
                                    >
                                        Skip
                                    </button>
                                </div>
                            </div>

                            {/* ── Corpo do passo — desliza no sentido da navegação ── */}
                            <div className="relative min-h-[252px]" aria-live="polite">
                                <AnimatePresence mode="wait" custom={direction} initial={false}>
                                    <motion.div
                                        key={step.id}
                                        custom={direction}
                                        initial={reduced
                                            ? { opacity: 0 }
                                            : { opacity: 0, x: direction * 34, filter: 'blur(5px)' }}
                                        animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                                        exit={reduced
                                            ? { opacity: 0 }
                                            : { opacity: 0, x: direction * -26, filter: 'blur(5px)' }}
                                        transition={{ duration: 0.42, ease: EASE_OUT }}
                                        className="flex flex-col"
                                    >
                                        <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col">
                                            <motion.div variants={rise} className="flex items-center gap-2 mb-3">
                                                <span
                                                    className="w-[5px] h-[5px] rounded-full"
                                                    style={{
                                                        background: `rgba(${step.accent},0.95)`,
                                                        boxShadow: `0 0 8px rgba(${step.accent},0.55)`,
                                                    }}
                                                />
                                                <span className="text-[10px] font-semibold tracking-[0.16em] uppercase text-white/40">
                                                    {step.eyebrow}
                                                </span>
                                                {index === 0 && (
                                                    <span
                                                        className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium text-white/45 border"
                                                        style={{ borderColor: `rgba(${step.accent},0.28)`, background: `rgba(${step.accent},0.08)` }}
                                                    >
                                                        <Clock size={8.5} />
                                                        60-second tour
                                                    </span>
                                                )}
                                            </motion.div>

                                            <motion.h2
                                                variants={rise}
                                                className="text-[23px] font-semibold leading-[1.14] text-white tracking-[-0.018em]"
                                            >
                                                <Headline step={step} />
                                            </motion.h2>

                                            <motion.p variants={rise} className="mt-2.5 text-[13px] leading-[1.62] text-white/55 max-w-[440px]">
                                                {step.body}
                                            </motion.p>

                                            {step.shortcuts && (
                                                <motion.div variants={rise} className="mt-5 flex flex-col gap-2.5">
                                                    {step.shortcuts.map((shortcut) => (
                                                        <div key={shortcut.label} className="flex items-center gap-3.5">
                                                            <span className="flex items-center gap-1.5 shrink-0">
                                                                {shortcut.keys.map((k) => (
                                                                    <KeyCap key={k} k={k} accent={step.accent} />
                                                                ))}
                                                            </span>
                                                            <span className="text-[12px] text-white/50">{shortcut.label}</span>
                                                        </div>
                                                    ))}
                                                </motion.div>
                                            )}
                                        </motion.div>
                                    </motion.div>
                                </AnimatePresence>
                            </div>

                            {/* ── Progresso: cometa + dots ────────────────────── */}
                            <div className="mt-7 mb-5">
                                <div className="relative h-[2px] rounded-full bg-white/[0.07] overflow-visible">
                                    <motion.div
                                        className="h-full rounded-full"
                                        animate={{ width: `${progress * 100}%` }}
                                        transition={{ duration: 0.55, ease: EASE_OUT }}
                                        style={{ background: `rgba(${step.accent},0.7)` }}
                                    />
                                    {/* Ponta luminosa — cometa */}
                                    <motion.div
                                        className="absolute top-1/2 w-[7px] h-[7px] rounded-full -translate-y-1/2"
                                        animate={{ left: `calc(${progress * 100}% - 3.5px)` }}
                                        transition={{ duration: 0.55, ease: EASE_OUT }}
                                        style={{
                                            background: `rgba(${step.accent},1)`,
                                            boxShadow: `0 0 10px rgba(${step.accent},0.85), 0 0 3px rgba(${step.accent},1)`,
                                        }}
                                    />
                                </div>
                                <div className="mt-3.5 flex items-center justify-center gap-2">
                                    {STEPS.map((s, i) => (
                                        <span
                                            key={s.id}
                                            className="block rounded-full transition-all duration-500"
                                            style={{
                                                width: i === index ? 14 : 5,
                                                height: 4,
                                                background: i === index
                                                    ? `rgba(${s.accent},0.85)`
                                                    : i < index
                                                        ? 'rgba(255,255,255,0.28)'
                                                        : 'rgba(255,255,255,0.12)',
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* ── Rodapé: navegação + dica de teclado ─────────── */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 min-w-[64px]">
                                    <button
                                        onClick={back}
                                        disabled={index === 0}
                                        className="flex items-center gap-1.5 text-[12.5px] font-medium text-white/40 hover:text-white/75 transition-colors disabled:opacity-0 disabled:pointer-events-none"
                                    >
                                        <ArrowLeft size={13} />
                                        Back
                                    </button>
                                    {!isLast && index > 0 && (
                                        <span className="text-[10px] tracking-wide text-white/22 select-none">
                                            ←→ navigate · Esc skip
                                        </span>
                                    )}
                                </div>

                                {isLast ? (
                                    <motion.button
                                        ref={primaryRef}
                                        onClick={finish}
                                        whileHover={reduced ? undefined : { scale: 1.025, filter: 'brightness(1.08)' }}
                                        whileTap={{ scale: 0.97 }}
                                        className="relative overflow-hidden flex items-center gap-2 h-[40px] px-7 rounded-full text-[13px] font-semibold text-white outline-none"
                                        style={{
                                            background: `linear-gradient(135deg, rgba(${step.accent},0.92), rgba(${step.accent},0.66))`,
                                            boxShadow: `0 0 0 1px rgba(${step.accent},0.38), 0 10px 30px rgba(${step.accent},0.28)`,
                                        }}
                                    >
                                        {/* Vaseline — brilho que atravessa o CTA final */}
                                        {!reduced && (
                                            <motion.span
                                                aria-hidden
                                                className="absolute inset-y-0 w-1/3 pointer-events-none"
                                                style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)', transform: 'skewX(-14deg)' }}
                                                animate={{ x: ['-160%', '320%'] }}
                                                transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity, repeatDelay: 4.2 }}
                                            />
                                        )}
                                        <motion.span
                                            initial={reduced ? false : { scale: 0, rotate: -30 }}
                                            animate={{ scale: 1, rotate: 0 }}
                                            transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.15 }}
                                            className="grid place-items-center w-[19px] h-[19px] rounded-full"
                                            style={{ background: 'rgba(255,255,255,0.18)' }}
                                        >
                                            <Check size={12} strokeWidth={3} />
                                        </motion.span>
                                        <span className="relative">You're ready</span>
                                    </motion.button>
                                ) : (
                                    <motion.button
                                        ref={primaryRef}
                                        onClick={next}
                                        whileHover={reduced ? undefined : { scale: 1.025, filter: 'brightness(1.08)' }}
                                        whileTap={{ scale: 0.97 }}
                                        className="flex items-center gap-2 h-[38px] px-6 rounded-full text-[13px] font-semibold text-white outline-none"
                                        style={{
                                            background: `linear-gradient(135deg, rgba(${step.accent},0.85), rgba(${step.accent},0.62))`,
                                            boxShadow: `0 0 0 1px rgba(${step.accent},0.32), 0 8px 24px rgba(${step.accent},0.22)`,
                                        }}
                                    >
                                        {index === 0 ? 'Start the tour' : 'Next'}
                                        <motion.span
                                            animate={reduced ? {} : { x: [0, 3, 0] }}
                                            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.2 }}
                                        >
                                            <ArrowRight size={14} />
                                        </motion.span>
                                    </motion.button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default InteractiveTutorial;
