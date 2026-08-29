/**
 * StartupSequence.tsx
 *
 * Animação de inicialização exibida ao abrir o aplicativo.
 * Exibe o ícone do app com efeito de iluminação volumétrica,
 * transição de cinza para colorido e brilho progressivo.
 */
import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import appIcon from './icon.png';

interface StartupSequenceProps {
    onComplete: () => void;
}

const StartupSequence: React.FC<StartupSequenceProps> = ({ onComplete }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onComplete();
        }, 1800);
        return () => clearTimeout(timer);
    }, [onComplete]);

    return (
        <div className="fixed inset-0 z-[100] bg-[#0d0e10] flex items-center justify-center overflow-hidden">
            <motion.div
                className="relative flex flex-col items-center"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            >
                <motion.div
                    className="w-[72px] h-[72px] rounded-[18px] border border-white/10 bg-white/[0.035] flex items-center justify-center shadow-[0_24px_70px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.09)]"
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                >
                    <img src={appIcon} alt="" className="w-11 h-11 object-contain" />
                </motion.div>
                <motion.h1
                    className="mt-5 text-[17px] font-semibold text-white"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.22, duration: 0.5 }}
                >
                    Refract
                </motion.h1>
                <motion.p
                    className="mt-1.5 text-[11px] text-white/35"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.34, duration: 0.5 }}
                >
                    Private intelligence, ready when you are
                </motion.p>
            </motion.div>
        </div>
    );
};

export default StartupSequence;
