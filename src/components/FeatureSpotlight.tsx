import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * FeatureSpotlight.tsx
 * Cartão hero do launcher. Rotaciona os pilares do produto em slides
 * silenciosos — tipografia precisa sobre superfície escura com aurora
 * sutil. Sem imagens, sem dourado, sem propaganda: contenção é o luxo.
 */

interface Slide {
    id: string;
    eyebrow: string;
    headline: string;
    subtitle: string;
    accent: string; // cor da aurora e do dot ativo
}

const SLIDES: Slide[] = [
    {
        id: 'profile',
        eyebrow: 'Profile Intelligence',
        headline: 'Answers that sound like you',
        subtitle: 'Refract learns your experience, projects, and voice — every suggestion is grounded in who you are.',
        accent: '56,132,255',
    },
    {
        id: 'private',
        eyebrow: 'On-device',
        headline: 'Private by design',
        subtitle: 'Transcription and memory run locally. Your conversations never leave this machine unless you say so.',
        accent: '52,211,153',
    },
    {
        id: 'stealth',
        eyebrow: 'Stealth',
        headline: 'Invisible when it matters',
        subtitle: 'Undetectable to screen shares and recorders. Your copilot is your business — no one else’s.',
        accent: '167,139,250',
    },
];

const SLIDE_MS = 7000;

export const FeatureSpotlight: React.FC = () => {
    const [index, setIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const slide = SLIDES[index];

    useEffect(() => {
        if (isPaused) return;
        const t = setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_MS);
        return () => clearTimeout(t);
    }, [index, isPaused]);

    return (
        <div
            className="feature-spotlight premium-surface relative h-full w-full select-none"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            style={{ isolation: 'isolate' }}
        >
            <div className="feature-spotlight-orbit" aria-hidden="true">
                <motion.span
                    key={`orb-${slide.id}`}
                    initial={{ opacity: 0, scale: 0.82, rotate: -8 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                    className="feature-spotlight-orb"
                    style={{
                        background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.34), rgba(${slide.accent},0.22) 24%, rgba(${slide.accent},0.055) 58%, transparent 72%)`,
                        borderColor: `rgba(${slide.accent},0.18)`,
                        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.16), 0 24px 60px rgba(${slide.accent},0.10)`,
                    }}
                />
                <span className="feature-spotlight-orbit-line feature-spotlight-orbit-line--outer" />
                <span className="feature-spotlight-orbit-line feature-spotlight-orbit-line--inner" />
            </div>

            <motion.div
                key={`wash-${slide.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: `linear-gradient(118deg, transparent 28%, rgba(${slide.accent},0.045) 68%, rgba(${slide.accent},0.10) 100%)`,
                }}
            />

            <div className="relative z-10 h-full flex flex-col justify-between px-7 pt-6 pb-5">
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={slide.id}
                        initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                        className="flex-1 flex flex-col justify-center min-h-0"
                    >
                        <div className="flex items-center gap-2 mb-2.5">
                            <span
                                className="w-[5px] h-[5px] rounded-full"
                                style={{ background: `rgba(${slide.accent},0.9)`, boxShadow: `0 0 8px rgba(${slide.accent},0.55)` }}
                            />
                            <span className="text-[10.5px] font-semibold tracking-[0.16em] uppercase text-white/40">
                                {slide.eyebrow}
                            </span>
                        </div>
                        <h2 className="text-[24px] font-semibold leading-[1.12] text-white">
                            {slide.headline}
                        </h2>
                        <p className="mt-2 text-[13px] leading-[1.55] text-white/50 max-w-[400px]">
                            {slide.subtitle}
                        </p>
                    </motion.div>
                </AnimatePresence>

                <div className="flex items-center gap-1.5 shrink-0">
                    {SLIDES.map((s, i) => (
                        <button
                            key={s.id}
                            onClick={() => setIndex(i)}
                            aria-label={s.headline}
                            className="group flex h-7 items-center py-1.5 -my-1.5 px-0.5"
                        >
                            <span
                                className="block h-[3px] rounded-full transition-all duration-500 ease-out"
                                style={{
                                    width: i === index ? 16 : 5,
                                    background: i === index
                                        ? `rgba(${s.accent},0.85)`
                                        : 'rgba(255,255,255,0.16)',
                                }}
                            />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
