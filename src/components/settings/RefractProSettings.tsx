/**
 * RefractProSettings.tsx
 *
 * Painel de configuração do Refract Pro — gerenciamento de licença,
 * exibição de preços (plano anual e vitalício), ativação/desativação
 * de licença, e política de reembolso.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, useReducedMotion, type Variants, useMotionValue, useTransform, useSpring } from 'framer-motion';
import {
    Lock, Key, CheckCircle, AlertCircle, Check, Copy, X, PlayCircle,
    EyeOff, Shield,
    Layers, UserCheck, Database, TrendingUp, Maximize2, Target, FileText, Building2,
} from 'lucide-react';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';
import PixCheckoutButton from './PixCheckoutButton';
import LemonSqueezyCheckoutButton from './LemonSqueezyCheckoutButton';

interface PricingProduct {
    formattedPrice: string | null;
    checkoutUrl: string;
}

// ─── Curvas de easing forte (por emil-design-eng) ───────
// Nunca usar o padrão fraco `ease` / `ease-in` para animações de UI.
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const EASE_OUT_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';

// ─── Preços — FONTE ÚNICA ────────────────────────────────────────────────
// Antes os preços viviam espalhados: fallback do card ($30/$50), rótulos dos
// botões ($24/$59 e R$99/R$249) e o /v1/pricing (fora do ar). Resultado: três
// números diferentes no mesmo card. Agora tudo deriva daqui. Para reajustar o
// preço, altere SÓ este objeto.
const PRICING = {
    yearly:   { usd: 24, brl: 99 },
    lifetime: { usd: 59, brl: 249 },
} as const;
const fmtUsd = (n: number) => `$${n}`;
const fmtBrl = (n: number) => `R$ ${n}`;

// ─── Locale da tela de compra ────────────────────────────────────────────
// pt (Brasil) → português + Pix em destaque + preços em BRL.
// demais      → inglês + cartão internacional em destaque + preços em USD.
// (O Pix é meio de pagamento brasileiro; para o resto do mundo o cartão via
//  LemonSqueezy é o caminho primário.)
const IS_PT = typeof navigator !== 'undefined' && /^pt\b/i.test(navigator.language || '');

// Cópia transacional por locale (rótulos de plano, preço, cobrança, CTAs).
// As descrições longas de features seguem em inglês por ora — tradução completa
// é um passo separado.
const COPY = IS_PT
    ? {
        chooseTitle: 'Escolha seu plano',
        chooseSub: 'Libere o kit completo do Refract Pro.',
        yearlyTier: 'Pro · Anual',
        lifetimeTier: 'Pro · Vitalício',
        perYear: 'por ano · cobrança anual',
        oneTime: 'Pagamento único. Seu para sempre.',
        renews: (p: string) => `Cancele quando quiser. Renova por ${p}/ano.`,
        saveVs: (v: string) => `Economize ${v} frente a 3 anos do anual.`,
        payOnce: 'Pague uma vez. Sem renovação.',
        everything: 'Tudo que vem no Pro',
    }
    : {
        chooseTitle: 'Choose your plan',
        chooseSub: 'Unlock the full Refract Pro toolkit.',
        yearlyTier: 'Pro · Yearly',
        lifetimeTier: 'Pro · Lifetime',
        perYear: 'per year · billed annually',
        oneTime: 'One-time payment. Yours forever.',
        renews: (p: string) => `Cancels anytime. Renews at ${p}/yr.`,
        saveVs: (v: string) => `Save ${v} vs 3 years of yearly.`,
        payOnce: 'Pay once. Never renew.',
        everything: 'Everything you get in Pro',
    };

// ─── Componente wrapper de cartão ────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-bg-item-surface rounded-2xl border border-border-subtle overflow-hidden ${className}`}>
            {children}
        </div>
    );
}

// ─── Cartão 3D Interativo (por emil-design-eng & ui-ux-designer) ────
// Cartão com efeito de spotlight 3D, rotação suave e escala tátil ao pressionar
interface InteractiveCardProps {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    role?: string;
    tabIndex?: number;
    'aria-pressed'?: boolean;
    'data-active'?: string;
    style?: React.CSSProperties;
    glowColor?: string;
}

function InteractiveCard({
    children,
    className = '',
    onClick,
    glowColor = 'rgba(59, 130, 246, 0.15)',
    style,
    ...props
}: InteractiveCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();

    // Coordenadas do mouse (0 para 1)
    const mouseX = useMotionValue(0.5);
    const mouseY = useMotionValue(0.5);

    // Posições do spotlight (0% para 100%)
    const spotlightX = useSpring(useTransform(mouseX, [0, 1], [0, 100]), { stiffness: 200, damping: 20 });
    const spotlightY = useSpring(useTransform(mouseY, [0, 1], [0, 100]), { stiffness: 200, damping: 20 });

    // Molas de rotação 3D suaves
    const rotateX = useSpring(useTransform(mouseY, [0, 1], [8, -8]), { stiffness: 120, damping: 20 });
    const rotateY = useSpring(useTransform(mouseX, [0, 1], [-8, 8]), { stiffness: 120, damping: 20 });

    // Mola de escala tátil (estado ativo)
    const scale = useSpring(1, { stiffness: 450, damping: 14 });

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (prefersReducedMotion || !cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const mouseXVal = (e.clientX - rect.left) / width;
        const mouseYVal = (e.clientY - rect.top) / height;
        mouseX.set(mouseXVal);
        mouseY.set(mouseYVal);
    };

    const handleMouseLeave = () => {
        mouseX.set(0.5);
        mouseY.set(0.5);
        scale.set(1);
    };

    const handleMouseDown = () => {
        if (prefersReducedMotion) return;
        scale.set(0.97); // Recomendação do Emil para escala ao pressionar
    };

    const handleMouseUp = () => {
        scale.set(1);
    };

    const dynamicStyle = prefersReducedMotion
        ? {}
        : {
              scale,
          };

    const spotlightBg = useTransform(
        [spotlightX, spotlightY],
        ([x, y]) => `radial-gradient(circle 180px at ${x}% ${y}%, ${glowColor}, transparent 80%)`
    );

    return (
        <motion.div
            ref={cardRef}
            className={`${className} perspective-1000`}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={onClick}
            style={{ ...style, ...dynamicStyle }}
            {...props}
        >
            {!prefersReducedMotion && (
                <motion.div
                    className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 opacity-0 group-hover:opacity-100"
                    style={{ background: spotlightBg }}
                />
            )}
            {children}
        </motion.div>
    );
}

// ─── Cartão de Recurso Interativo (com spotlight personalizado e inclinação 3D sutil) ─────
interface InteractiveFeatureCardProps {
    children: React.ReactNode;
    className?: string;
    glowColor?: string;
    isSoon?: boolean;
    colorTheme?: 'violet' | 'teal' | 'blue' | 'rose' | 'orange' | 'cyan' | 'gray' | 'pink';
}

function InteractiveFeatureCard({
    children,
    className = '',
    glowColor = 'rgba(59, 130, 246, 0.12)',
    isSoon = false,
    colorTheme = 'blue',
}: InteractiveFeatureCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();

    const mouseX = useMotionValue(0.5);
    const mouseY = useMotionValue(0.5);

    const spotlightX = useSpring(useTransform(mouseX, [0, 1], [0, 100]), { stiffness: 220, damping: 22 });
    const spotlightY = useSpring(useTransform(mouseY, [0, 1], [0, 100]), { stiffness: 220, damping: 22 });

    const rotateX = useSpring(useTransform(mouseY, [0, 1], [4, -4]), { stiffness: 150, damping: 22 });
    const rotateY = useSpring(useTransform(mouseX, [0, 1], [-4, 4]), { stiffness: 150, damping: 22 });

    const scale = useSpring(1, { stiffness: 450, damping: 16 });

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (prefersReducedMotion || !cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        mouseX.set((e.clientX - rect.left) / rect.width);
        mouseY.set((e.clientY - rect.top) / rect.height);
    };

    const handleMouseLeave = () => {
        mouseX.set(0.5);
        mouseY.set(0.5);
        scale.set(1);
    };

    const handleMouseDown = () => {
        if (prefersReducedMotion) return;
        scale.set(0.98);
    };

    const handleMouseUp = () => {
        scale.set(1);
    };

    const dynamicStyle = prefersReducedMotion
        ? {}
        : {
              rotateX,
              rotateY,
              scale,
              transformStyle: 'preserve-3d' as const,
          };

    const spotlightBg = useTransform(
        [spotlightX, spotlightY],
        ([x, y]) => `radial-gradient(circle 120px at ${x}% ${y}%, ${glowColor}, transparent 80%)`
    );

    return (
        <motion.div
            ref={cardRef}
            className={`pro-feature-card pro-feature-card-${colorTheme} group relative overflow-hidden transition-all duration-200 ${
                isSoon ? 'opacity-60 saturate-[0.7]' : ''
            } ${className}`}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            style={dynamicStyle}
        >
            {!prefersReducedMotion && !isSoon && (
                <motion.div
                    className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 opacity-0 group-hover:opacity-100"
                    style={{ background: spotlightBg }}
                />
            )}
            {children}
        </motion.div>
    );
}

// ─── Pôster de Modos (ilustração jelly-clay × liquid-glass) ──────
// SVG inline: nó central do modo ativo com ramificações para múltiplos
// nós de persona especialista (Technical, Sales, PM, etc) com órbitas
// de conexão brilhantes em espaço de perspectiva 3D.
function ModesPoster({ animateShimmer }: { animateShimmer: boolean }) {
    return (
        <div
            className="relative w-full h-[120px] mt-3 select-none pointer-events-none overflow-hidden"
            aria-hidden="true"
        >
            <svg viewBox="0 0 280 120" className="w-full h-full">
                <defs>
                    {/* Soft background radial glows */}
                    <radialGradient id="blueGlowYearly" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(59, 130, 246, 0.35)" />
                        <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
                    </radialGradient>
                    <radialGradient id="emeraldGlowYearly" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(16, 185, 129, 0.28)" />
                        <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
                    </radialGradient>

                    {/* Gradient para Glass Nodes */}
                    <linearGradient id="nodeBg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0.18)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0.04)" />
                    </linearGradient>

                    {/* Shimmer gradient */}
                    <linearGradient id="yearlyShimmer" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0)" />
                        <stop offset="50%" stopColor="rgba(255, 255, 255, 0.18)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                        {animateShimmer && (
                            <animateTransform
                                attributeName="gradientTransform"
                                type="translate"
                                from="-1 0"
                                to="1 0"
                                dur="4s"
                                repeatCount="indefinite"
                            />
                        )}
                    </linearGradient>
                </defs>

                {/* Ambient Glows */}
                <circle cx="140" cy="60" r="70" fill="url(#blueGlowYearly)" />
                <circle cx="60" cy="40" r="50" fill="url(#emeraldGlowYearly)" />

                {/* 3D Agrupar com perspective */}
                <g style={{ transform: 'perspective(600px) rotateX(16deg) rotateY(-10deg) rotateZ(1deg)', transformOrigin: 'center center' }}>
                    
                    {/* Conexão lines de center to outer modes */}
                    <line x1="140" y1="60" x2="60" y2="35" className="pricing-poster-stroke-subtle-line" strokeWidth="1" strokeDasharray="3 2" />
                    <line x1="140" y1="60" x2="80" y2="90" className="pricing-poster-stroke-subtle-line" strokeWidth="1" strokeDasharray="3 2" />
                    <line x1="140" y1="60" x2="220" y2="35" className="pricing-poster-stroke-subtle-line" strokeWidth="1" strokeDasharray="3 2" />
                    <line x1="140" y1="60" x2="200" y2="90" className="pricing-poster-stroke-subtle-line" strokeWidth="1" strokeDasharray="3 2" />
                    
                    {/* Glowing highlight conexão para o ACTIVE modo */}
                    <path d="M140 60 Q100 40 60 35" fill="none" stroke="rgba(16, 185, 129, 0.6)" strokeWidth="1.2" />

                    {/* Nó 1: TECHNICAL (Active / Highlighted) */}
                    <g transform="translate(60 35)">
                        <circle cx="0" cy="0" r="18" fill="rgba(16, 185, 129, 0.15)" stroke="rgba(16, 185, 129, 0.5)" strokeWidth="1" />
                        <circle cx="0" cy="0" r="15" className="pricing-poster-node-bg" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="0.5" />
                        {/* Icon: Code </> representation */}
                        <path d="M-4 -3 L-7 0 L-4 3 M4 -3 L7 0 L4 3" fill="none" stroke="#10b981" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="1" y1="-4" x2="-1" y2="4" stroke="#10b981" strokeWidth="1.2" />
                        
                        {/* Active Dot */}
                        <circle cx="12" cy="-12" r="2.5" fill="#10b981" />
                        <circle cx="12" cy="-12" r="5" fill="none" stroke="#10b981" strokeWidth="0.8" opacity="0.5">
                            <animate attributeName="r" values="3;7;3" dur="2s" repeatCount="indefinite" />
                        </circle>
                    </g>
                    {/* Label para Tech */}
                    <rect x="35" y="60" width="50" height="7" rx="2" fill="rgba(16, 185, 129, 0.1)" stroke="rgba(16, 185, 129, 0.2)" strokeWidth="0.5" />
                    <text x="60" y="65" textAnchor="middle" fill="#10b981" fontSize="4" fontWeight="bold" fontFamily="Geist, Satoshi, sans-serif" letterSpacing="0.02em">TECH INTERVIEW</text>


                    {/* Nó 2: SALES (Briefcase representation) */}
                    <g transform="translate(220 35)">
                        <circle cx="0" cy="0" r="16" fill="url(#nodeBg)" className="pricing-poster-glass-node-border" strokeWidth="1" />
                        <rect x="-16" y="-16" width="32" height="32" rx="16" fill="url(#yearlyShimmer)" style={{ mixBlendMode: 'overlay' }} opacity="0.75" />
                        {/* Icon: Briefcase */}
                        <rect x="-4" y="-2" width="8" height="6" rx="1" fill="none" className="pricing-poster-stroke-bright" strokeWidth="1" />
                        <path d="M-2 -2 L-2 -4 L2 -4 L2 -2" fill="none" className="pricing-poster-stroke-bright" strokeWidth="1" />
                    </g>
                    {/* Label para Sales */}
                    <text x="220" y="58" textAnchor="middle" className="pricing-poster-text-muted" fontSize="4.2" fontWeight="bold" fontFamily="Geist, Satoshi, sans-serif">SALES</text>


                    {/* Nó 3: PRODUCT Gerenciador */}
                    <g transform="translate(80 90)">
                        <circle cx="0" cy="0" r="16" fill="url(#nodeBg)" className="pricing-poster-glass-node-border" strokeWidth="1" />
                        {/* Icon: Layers */}
                        <path d="M-4 -2 L0 -4 L4 -2 L0 0 Z" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <path d="M-4 1 L0 3 L4 1" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                    </g>
                    {/* Label para PM */}
                    <text x="80" y="112" textAnchor="middle" className="pricing-poster-text-muted" fontSize="4.2" fontWeight="bold" fontFamily="Geist, Satoshi, sans-serif">PRODUCT</text>


                    {/* Nó 4: SYSTEM DESIGN */}
                    <g transform="translate(200 90)">
                        <circle cx="0" cy="0" r="16" fill="url(#nodeBg)" className="pricing-poster-glass-node-border" strokeWidth="1" />
                        {/* Icon: Flow Chart */}
                        <rect x="-4" y="-4" width="3" height="3" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <rect x="1" y="-4" width="3" height="3" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <rect x="-1.5" y="1" width="3" height="3" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <path d="M-2.5 -1 L-2.5 0 L0 0 L0 1" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <path d="M2.5 -1 L2.5 0 L0 0" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                    </g>
                    {/* Label para System Design */}
                    <text x="200" y="112" textAnchor="middle" className="pricing-poster-text-muted" fontSize="4.2" fontWeight="bold" fontFamily="Geist, Satoshi, sans-serif">ARCHITECT</text>


                    {/* CENTRAL NNó ACTIVE ENGINE */}
                    <g transform="translate(140 60)">
                        {/* Glass Corpo */}
                        <circle cx="0" cy="0" r="22" className="pricing-poster-node-bg" stroke="rgba(59, 130, 246, 0.6)" strokeWidth="1.2" />
                        
                        {/* AI Text Orb */}
                        <circle cx="0" cy="0" r="16" fill="rgba(59, 130, 246, 0.15)" />
                        <text x="0" y="3.5" textAnchor="middle" className="pricing-poster-central-ai-text" fontSize="9" fontWeight="900" fontFamily="Geist, Satoshi, sans-serif" letterSpacing="0.05em">AI</text>
                        
                        {/* Outer rotating/pulsing dashes */}
                        <circle cx="0" cy="0" r="25" fill="none" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="0.8" strokeDasharray="4 6">
                            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="15s" repeatCount="indefinite" />
                        </circle>
                    </g>

                </g>
            </svg>
        </div>
    );
}

// ─── Pôster de Correspondência de Currículo (ilustração jelly-clay × liquid-glass) ──────
// SVG inline: dois painéis de vidro 3D inclinados (Currículo à esquerda, Descrição do Cargo à direita)
// com nós de conexão laser desenhando linhas entre habilidades correspondentes.
// Inclui um badge de pílula flutuante central com brilho dinâmico "94% Match".
function ResumeMatchPoster({ animateShimmer }: { animateShimmer: boolean }) {
    return (
        <div
            className="relative w-full h-[120px] mt-3 select-none pointer-events-none overflow-hidden"
            aria-hidden="true"
        >
            <svg viewBox="0 0 280 120" className="w-full h-full">
                <defs>
                    {/* Soft background radial glows */}
                    <radialGradient id="purpleGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(139, 92, 246, 0.38)" />
                        <stop offset="100%" stopColor="rgba(139, 92, 246, 0)" />
                    </radialGradient>
                    <radialGradient id="emeraldGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(16, 185, 129, 0.28)" />
                        <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
                    </radialGradient>
                    <radialGradient id="blueGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(59, 130, 246, 0.32)" />
                        <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
                    </radialGradient>

                    {/* Gradient para Glass Panels */}
                    <linearGradient id="panelBg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0.18)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0.04)" />
                    </linearGradient>

                    {/* Shimmer gradient */}
                    <linearGradient id="stealthShimmer" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0)" />
                        <stop offset="50%" stopColor="rgba(255, 255, 255, 0.20)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                        {animateShimmer && (
                            <animateTransform
                                attributeName="gradientTransform"
                                type="translate"
                                from="-1 0"
                                to="1 0"
                                dur="4s"
                                repeatCount="indefinite"
                            />
                        )}
                    </linearGradient>
                </defs>

                {/* Ambient Glows */}
                <circle cx="60" cy="60" r="70" fill="url(#purpleGlow)" />
                <circle cx="220" cy="60" r="70" fill="url(#blueGlow)" />
                <circle cx="140" cy="60" r="50" fill="url(#emeraldGlow)" />

                {/* 3D Agrupar com perspective */}
                <g style={{ transform: 'perspective(600px) rotateX(16deg) rotateY(-10deg) rotateZ(1deg)', transformOrigin: 'center center' }}>
                    
                    {/* LEFT PANEL: Retomar */}
                    {/* Glass Corpo */}
                    <rect x="25" y="16" width="95" height="78" rx="8" fill="url(#panelBg)" className="pricing-poster-panel-border" strokeWidth="1" />
                    <rect x="25" y="16" width="95" height="78" rx="8" fill="url(#stealthShimmer)" style={{ mixBlendMode: 'overlay' }} opacity="0.75" />
                    
                    {/* Cabeçalho line & avatar representation */}
                    <circle cx="38" cy="28" r="4.5" className="pricing-poster-avatar-bg" />
                    <rect x="47" y="24" width="35" height="3" rx="1.5" className="pricing-poster-rect-light" />
                    <rect x="47" y="30" width="20" height="2" rx="1" className="pricing-poster-rect-subtle" />
                    
                    {/* Habilidades Checklist dentro Retomar card */}
                    <g transform="translate(34 42)">
                        {/* Verifica 1 */}
                        <circle cx="4" cy="5" r="2.5" fill="rgba(16, 185, 129, 0.2)" stroke="rgba(16, 185, 129, 0.6)" strokeWidth="0.6" />
                        <rect x="11" y="3.5" width="48" height="3" rx="1.5" className="pricing-poster-rect-light" />
                        <text x="12" y="6.5" className="pricing-poster-text-bright" fontSize="4.5" fontFamily="Geist, Satoshi, sans-serif" fontWeight="600" letterSpacing="0.02em">React Native</text>

                        {/* Verifica 2 */}
                        <circle cx="4" cy="17" r="2.5" fill="rgba(16, 185, 129, 0.2)" stroke="rgba(16, 185, 129, 0.6)" strokeWidth="0.6" />
                        <rect x="11" y="15.5" width="55" height="3" rx="1.5" className="pricing-poster-rect-light" />
                        <text x="12" y="18.5" className="pricing-poster-text-bright" fontSize="4.5" fontFamily="Geist, Satoshi, sans-serif" fontWeight="600" letterSpacing="0.02em">System Design</text>

                        {/* Verifica 3 */}
                        <circle cx="4" cy="29" r="2.5" className="pricing-poster-check3-bg pricing-poster-check3-border" strokeWidth="0.6" />
                        <rect x="11" y="27.5" width="40" height="3" rx="1.5" className="pricing-poster-rect-subtle" />
                        <text x="12" y="30.5" className="pricing-poster-text-muted" fontSize="4.5" fontFamily="Geist, Satoshi, sans-serif" fontWeight="600" letterSpacing="0.02em">Python</text>
                    </g>
                    {/* Pequeno Retomar Badge */}
                    <rect x="34" y="81" width="30" height="7" rx="2" fill="rgba(139, 92, 246, 0.2)" stroke="rgba(139, 92, 246, 0.3)" strokeWidth="0.5" />
                    <text x="49" y="85" textAnchor="middle" fill="#c4b5fd" className="pricing-poster-badge-text-purple" fontSize="4.5" fontWeight="bold" fontFamily="Geist, Satoshi, sans-serif">RESUME</text>


                    {/* Direito PANEL: Job DESCRIPTION */}
                    {/* Glass Corpo */}
                    <rect x="160" y="16" width="95" height="78" rx="8" fill="url(#panelBg)" className="pricing-poster-panel-border" strokeWidth="1" />
                    <rect x="160" y="16" width="95" height="78" rx="8" fill="url(#stealthShimmer)" style={{ mixBlendMode: 'overlay' }} opacity="0.75" />
                    
                    {/* Job requirements lines */}
                    <rect x="169" y="24" width="45" height="3.5" rx="1.5" className="pricing-poster-rect-light" />
                    <rect x="169" y="31" width="60" height="2" rx="1" className="pricing-poster-rect-subtle" />

                    {/* Requirements lista */}
                    <g transform="translate(169 42)">
                        {/* Requirement 1 */}
                        <rect x="0" y="3.5" width="60" height="3" rx="1.5" className="pricing-poster-rect-light" />
                        <text x="2" y="6.5" className="pricing-poster-text-bright" fontSize="4.5" fontFamily="Geist, Satoshi, sans-serif" fontWeight="600" letterSpacing="0.02em">React Native</text>

                        {/* Requirement 2 */}
                        <rect x="0" y="15.5" width="65" height="3" rx="1.5" className="pricing-poster-rect-light" />
                        <text x="2" y="18.5" className="pricing-poster-text-bright" fontSize="4.5" fontFamily="Geist, Satoshi, sans-serif" fontWeight="600" letterSpacing="0.02em">System Design</text>

                        {/* Requirement 3 */}
                        <rect x="0" y="27.5" width="50" height="3" rx="1.5" className="pricing-poster-rect-light" />
                        <text x="2" y="30.5" className="pricing-poster-text-muted" fontSize="4.5" fontFamily="Geist, Satoshi, sans-serif" fontWeight="600" letterSpacing="0.02em">TypeScript</text>
                    </g>
                    {/* Pequeno JD Badge */}
                    <rect x="169" y="81" width="30" height="7" rx="2" fill="rgba(59, 130, 246, 0.2)" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="0.5" />
                    <text x="184" y="85" textAnchor="middle" fill="#93c5fd" className="pricing-poster-badge-text-blue" fontSize="4.5" fontWeight="bold" fontFamily="Geist, Satoshi, sans-serif">ROLE JD</text>


                    {/* CONNECTING AI LASER LINES */}
                    {/* Conexão 1 (React Native) */}
                    <path d="M96 47 Q137 42 169 47" fill="none" stroke="rgba(16, 185, 129, 0.75)" strokeWidth="1" strokeDasharray="3 2" />
                    <circle cx="96" cy="47" r="1.5" fill="#10b981" />
                    <circle cx="169" cy="47" r="1.5" fill="#10b981" />

                    {/* Conexão 2 (System Design) */}
                    <path d="M103 59 Q137 54 169 59" fill="none" stroke="rgba(16, 185, 129, 0.75)" strokeWidth="1" strokeDasharray="3 2" />
                    <circle cx="103" cy="59" r="1.5" fill="#10b981" />
                    <circle cx="169" cy="59" r="1.5" fill="#10b981" />


                    {/* CENTRAL ANALYSIS GLOWING BADGE */}
                    <g transform="translate(140 52)">
                        {/* Outer Glow */}
                        <rect x="-24" y="-8" width="48" height="16" rx="8" fill="rgba(16, 185, 129, 0.15)" stroke="rgba(16, 185, 129, 0.4)" strokeWidth="0.8" style={{ filter: 'drop-shadow(0 0 4px rgba(16,185,129,0.3))' }} />
                        {/* Solid Badge */}
                        <rect x="-22" y="-7" width="44" height="14" rx="7" fill="rgba(16, 185, 129, 0.95)" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }} />
                        {/* Match text */}
                        <text x="0" y="2.5" textAnchor="middle" fill="#ffffff" fontSize="5.5" fontWeight="900" fontFamily="Geist, Satoshi, sans-serif" letterSpacing="0.01em">94% MATCH</text>
                    </g>

                </g>
            </svg>
        </div>
    );
}


// Props do painel de configuração Refract Pro
interface RefractProSettingsProps {
    initialIsPremium?: boolean | null; // Estado premium inicial (null = ainda carregando)
}

// Componente principal do painel de configuração Refract Pro
export const RefractProSettings: React.FC<RefractProSettingsProps> = ({ initialIsPremium = null }) => {
    // Preferência de movimento reduzido do sistema
    const prefersReducedMotion = useReducedMotion();
    const [interfaceTheme, setInterfaceTheme] = useState<MeetingInterfaceTheme>(() => {
        const theme = getMeetingInterfaceTheme();
        return theme === 'default' ? 'liquid-glass' : theme;
    });

    useEffect(() => {
        const handleStorage = () => {
            const theme = getMeetingInterfaceTheme();
            setInterfaceTheme(theme === 'default' ? 'liquid-glass' : theme);
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // Estado: chave de licença, ID do hardware, status de operação e produtos de preço
    const [licenseKey, setLicenseKey] = useState('');
    const [hardwareId, setHardwareId] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [copiedHwid, setCopiedHwid] = useState(false);
    const [pricingProducts, setPricingProducts] = useState<Record<string, PricingProduct>>({});

    // Estado premium do usuário (true = licença ativa, false = inativa, null = carregando)
    const [isPremium, setIsPremium] = useState<boolean | null>(initialIsPremium);

    // Busca e atualiza o estado da licença
    const refreshLicense = async () => {
        try {
            const details = await window.electronAPI?.licenseGetDetails?.();
            if (details) {
                setIsPremium(details.isPremium ?? false);
            } else {
                setIsPremium(prev => prev ?? false);
            }
        } catch {
            const check = window.electronAPI?.licenseCheckPremiumAsync ?? window.electronAPI?.licenseCheckPremium;
            if (check) {
                try {
                    const active = await check();
                    setIsPremium(active);
                } catch {
                    setIsPremium(prev => prev ?? false);
                }
            } else {
                setIsPremium(prev => prev ?? false);
            }
        }
    };

    useEffect(() => {
        window.electronAPI?.licenseGetHardwareId?.().then(setHardwareId).catch(() => setHardwareId('unavailable'));
        refreshLicense();
        window.electronAPI?.getRefractPricing?.()
            .then((res) => {
                if (res?.ok && res.products) setPricingProducts(res.products);
            })
            .catch(() => {});

        // Optional: ouvir para license status changes se o principal processo envia them
        const onStatusChanged = (data?: { isPremium: boolean; plan?: string }) => {
            if (data && typeof data.isPremium === 'boolean') {
                setIsPremium(data.isPremium);
            } else {
                refreshLicense();
            }
        };
        const removeLicenseListener = window.electronAPI?.onLicenseStatusChanged?.(onStatusChanged);

        return () => {
            removeLicenseListener?.();
        };
    }, []);

    // Ativa a licença com a chave informada
    const handleActivate = async () => {
        if (!licenseKey.trim()) return;
        setStatus('loading');
        setErrorMessage('');

        try {
            // Envia a chave para o processo principal para ativação
            const result = await window.electronAPI?.licenseActivate?.(licenseKey.trim());
            if (result?.success) {
                setStatus('success');
                setLicenseKey('');
                setTimeout(() => {
                    refreshLicense();
                    setStatus('idle');
                }, 1200);
            } else {
                setStatus('error');
                setErrorMessage(result?.error || 'Activation failed. Please try again.');
            }
        } catch (e: any) {
            setStatus('error');
            setErrorMessage(e.message || 'Activation failed.');
        }
    };

    // Desativa a licença do dispositivo atual
    const handleDeactivate = async () => {
        try {
            await window.electronAPI?.licenseDeactivate?.();
            refreshLicense();
        } catch (e: any) {
            setErrorMessage(e.message || 'Deactivation failed.');
        }
    };

    // Copia o ID do hardware para a área de transferência
    const copyHardwareId = () => {
        navigator.clipboard.writeText(hardwareId);
        setCopiedHwid(true);
        setTimeout(() => setCopiedHwid(false), 2000);
    };

    const openExternal = (url: string) => { (window.electronAPI as any)?.openExternal?.(url); };
    const lifetimeProduct = pricingProducts.refract_pro_lifetime;
    const yearlyProduct = pricingProducts.refract_pro_yearly;
    // Preço da FONTE ÚNICA (PRICING), por locale. Um preço vindo do backend
    // (/v1/pricing), se algum dia responder, ainda tem prioridade.
    const priceCur = IS_PT ? 'brl' : 'usd';
    const fmtPrice = IS_PT ? fmtBrl : fmtUsd;
    const yearlyPriceText = yearlyProduct?.formattedPrice || fmtPrice(PRICING.yearly[priceCur]);
    const lifetimePriceText = lifetimeProduct?.formattedPrice || fmtPrice(PRICING.lifetime[priceCur]);

    // Analisa preços numéricos uma vez — usado tanto para o chip "Salva N%" no alternador
    // quanto para o texto ao vivo "Salva $X sobre 3 anos" sob o CTA vitalício —
    // âncora concreta é mais persuasiva que uma porcentagem.
    const { yearlyPrice, lifetimePrice, lifetimeSavingsPct, lifetimeSavingsAbs, yearlyDiscountAbs, yearlyOriginalText } = useMemo(() => {
        const parsePrice = (s?: string | null): number | null => {
            if (!s) return null;
            const m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
            return m ? parseFloat(m[1]) : null;
        };
        const y = parsePrice(yearlyPriceText);
        const l = parsePrice(lifetimePriceText);
        const horizon = 3;
        let pct: number | null = null;
        let abs: number | null = null;
        if (y && l) {
            const totalYearly = y * horizon;
            if (totalYearly > 0 && l < totalYearly) {
                pct = Math.round(((totalYearly - l) / totalYearly) * 100);
                abs = Math.round(totalYearly - l);
            }
        }
        // INSIDER20 anchor: synthesize a "wera price para o Yearly cartão por
        // dividing por 0.8 (o post-coupon price é 80% de original). Renderizar
        // strikethrough apenas se o math é clean.
        let yearlyOrig: string | null = null;
        let yearlyDiscount: number | null = null;
        if (y) {
            const original = Math.round(y / 0.8);
            // currency symbol detection — keep qualquer que seja o API returned
            const symbolMatch = yearlyPriceText.match(/^([^0-9]+)/);
            const symbol = symbolMatch ? symbolMatch[1] : '$';
            yearlyOrig = `${symbol}${original}`;
            yearlyDiscount = Math.round(((original - y) / original) * 100);
        }
        return {
            yearlyPrice: y,
            lifetimePrice: l,
            lifetimeSavingsPct: pct,
            lifetimeSavingsAbs: abs,
            yearlyDiscountAbs: yearlyDiscount,
            yearlyOriginalText: yearlyOrig,
        };
    }, [yearlyPriceText, lifetimePriceText]);

    // ─── Variantes de animação ─────────────────────────────────────
    // Escalonamento pai: cabeçalho → alternador → cartões → grade de recursos.
    // Movimento reduzido: mantém fade de opacidade, remove o escalonamento de y-offset.
    const containerVariants: Variants = prefersReducedMotion
        ? {
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { duration: 0.2 } },
        }
        : {
            hidden: { opacity: 0 },
            visible: {
                opacity: 1,
                transition: {
                    staggerChildren: 0.05,
                    delayChildren: 0.02,
                    when: 'beforeChildren',
                },
            },
        };

    const itemVariants: Variants = prefersReducedMotion
        ? {
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { duration: 0.18 } },
        }
        : {
            hidden: { opacity: 0, y: 8 },
            visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.32, ease: EASE_OUT },
            },
        };

    const gridVariants: Variants = prefersReducedMotion
        ? {
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { duration: 0.18 } },
        }
        : {
            hidden: { opacity: 0 },
            visible: {
                opacity: 1,
                transition: {
                    staggerChildren: 0.045,
                    delayChildren: 0,
                },
            },
        };

    const gridItemVariants: Variants = prefersReducedMotion
        ? {
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { duration: 0.18 } },
        }
        : {
            hidden: { opacity: 0, y: 6 },
            visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.28, ease: EASE_OUT },
            },
        };

    // Pulso de preço ao mudar de plano. Memorizado para disparar apenas quando a chave
    // (plano ativo) muda, não a cada renderização
    const priceTickAnim = prefersReducedMotion
        ? undefined
        : { scale: [1, 1.04, 1] };
    const priceTickTransition = { duration: 0.22, ease: EASE_OUT, times: [0, 0.5, 1] };

    // Pulso vitalício único — box-shadow transitório que sobrescreve o CSS
    // e retorna ao estado estável [data-active] após 520ms.
    const lifetimePulseShadow =
        '0 0 0 2px rgba(190, 185, 255, 0.85), 0 0 64px -4px rgba(140, 130, 240, 0.70), 0 20px 50px rgba(99, 102, 241, 0.42), 0 4px 14px rgba(0, 0, 0, 0.30)';

    if (isPremium === null) {
        return <div className="p-8 flex justify-center"><div className="w-5 h-5 border-2 border-white/40 border-t-transparent rounded-full animate-spin" /></div>;
    }

    return (
        <div className="space-y-4" data-interface-theme={interfaceTheme}>


            {isPremium ? (
                <Card>
                    <div className="flex flex-col items-center text-center py-8 px-6">
                        <div className="w-16 h-16 rounded-[16px] bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center mb-6 shadow-inner relative group">
                            <CheckCircle size={28} className="text-emerald-400" strokeWidth={2} />
                        </div>
                        <h2 className="text-[18px] font-semibold tracking-tight text-text-primary">Pro License Active</h2>
                        <p className="text-[13px] mt-2 max-w-[280px] mx-auto leading-relaxed mb-8 text-text-secondary">
                            Your device is fully authorized for Refract's premium features including the Profile Engine, Job Description Intelligence, and Company Research.
                        </p>

                        <button
                            onClick={handleDeactivate}
                            className="w-full max-w-[280px] py-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-[13px] font-medium hover:bg-red-500/20 flex items-center justify-center gap-2 shadow-inner cursor-pointer active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
                            style={{ transition: `transform 140ms ${EASE_OUT_CSS}, background-color 180ms ${EASE_OUT_CSS}` }}
                        >
                            <X size={15} /> Deactivate License
                        </button>
                        <p className="text-[11px] text-center px-4 mt-4 leading-relaxed text-text-tertiary max-w-[300px]">
                            Deactivating will remove the license from this device, allowing you to use it on another computer.
                        </p>
                    </div>
                </Card>
            ) : (
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="space-y-4"
                >
                    {/* ── Seção hero de seleção de plano ────────────────────────────── */}
                    <div className="space-y-3">
                        {/* Title linha */}
                        <motion.div variants={itemVariants} className="px-0.5 pt-1">
                            <h2 className="text-[18px] font-bold tracking-[-0.02em] text-text-primary leading-tight">
                                {COPY.chooseTitle}
                            </h2>
                            <p className="text-[12px] text-text-tertiary mt-1 leading-snug">
                                {COPY.chooseSub}
                            </p>
                        </motion.div>

                        {/* Grade de dois cartões de preço — vitalício ~16px mais alto */}
                        <div className="grid grid-cols-2 gap-3 items-stretch">
                            {/* ── Esquerda: Pro · Anual (gelatina azul-gelo pálida) ───── */}
                            {/* Card apresentacional — a ação de compra vive nos botões
                                Pix/cartão no rodapé do card (removido o CTA Dodo). */}
                            <InteractiveCard
                                className="pricing-card-yearly group relative overflow-hidden px-6 py-7 flex flex-col"
                                data-active="false"
                                style={{ minHeight: 264, transformStyle: 'preserve-3d' }}
                                glowColor="rgba(59, 130, 246, 0.28)"
                            >
                                <div className="relative flex items-center justify-between" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(12px)' }}>
                                    <span className="badge-tier-label inline-flex items-center px-2 py-0.5 rounded-full text-text-primary text-[10px] font-semibold" style={{ letterSpacing: '0.02em' }}>
                                        {COPY.yearlyTier}
                                    </span>
                                </div>

                                {/* Bloco de preço: âncora (preço original riscado + atual) inline */}
                                <div className="relative mt-4 flex items-baseline gap-2 flex-wrap" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(20px)' }}>
                                    {yearlyOriginalText && (
                                        <span
                                            className="pricing-card-original-price text-[17px] font-normal"
                                            style={{
                                                textDecoration: 'line-through',
                                                textDecorationThickness: '1px',
                                                fontVariantNumeric: 'tabular-nums',
                                                fontFeatureSettings: '"tnum"',
                                                letterSpacing: '-0.02em',
                                            }}
                                        >
                                            {yearlyOriginalText}
                                        </span>
                                    )}
                                    <span
                                        className="pricing-card-price text-[44px] font-bold leading-none text-text-primary"
                                        style={{
                                            display: 'inline-block',
                                            fontVariantNumeric: 'tabular-nums',
                                            fontFeatureSettings: '"tnum"',
                                            letterSpacing: '-0.035em',
                                        }}
                                    >
                                        {yearlyPriceText}
                                    </span>
                                </div>
                                <p className="relative mt-1 text-[11px] font-medium text-text-secondary" style={{ transform: 'translateZ(10px)' }}>
                                    {COPY.perYear}
                                </p>

                                {/* Divisor de linha fina com gradiente nítido */}
                                <div className="relative h-px my-4 pricing-card-divider" style={{ transform: 'translateZ(8px)' }} />

                                {/* Recurso principal: Modos de Persona Especialista */}
                                <div className="relative" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(14px)' }}>
                                    <div className="flex items-start gap-2.5">
                                        <span className="feature-icon-chip w-6 h-6 flex items-center justify-center shrink-0 mt-px">
                                            <Layers size={12} className="text-text-primary" strokeWidth={2.4} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[12.5px] font-semibold leading-tight text-text-primary" style={{ letterSpacing: '-0.01em' }}>
                                                Expert Persona Modes
                                            </p>
                                            <p className="text-[10.5px] leading-snug mt-1 text-text-secondary">
                                                Switch between 7 specialized AI personas tailored for different conversation dynamics.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Pôster de modos — flex-1 empurra para o fundo */}
                                <div className="relative flex-1 min-h-0 flex items-end" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(18px)' }}>
                                    <ModesPoster animateShimmer={!prefersReducedMotion} />
                                </div>

                                {/* Cobrança + pagamento. O CTA Dodo saiu: a compra acontece
                                    nos botões abaixo (ativação automática, backend deste repo). */}
                                <p className="relative mt-3 text-center text-[10px] leading-snug text-text-secondary" style={{ transform: 'translateZ(6px)' }}>
                                    {COPY.renews(yearlyPriceText)}
                                </p>

                                <div className="relative mt-2.5 pt-3 border-t border-white/[0.06] space-y-2" style={{ transform: 'translateZ(24px)' }}>
                                    {IS_PT ? (
                                        <>
                                            {/* Brasil: Pix em destaque, cartão como alternativa. */}
                                            <PixCheckoutButton plan="yearly" priceLabel={fmtBrl(PRICING.yearly.brl)} onActivated={refreshLicense} />
                                            <LemonSqueezyCheckoutButton plan="yearly" priceLabel={fmtUsd(PRICING.yearly.usd)} onActivated={refreshLicense} />
                                        </>
                                    ) : (
                                        // Fora do Brasil: só o cartão internacional (Pix é BR-only).
                                        <LemonSqueezyCheckoutButton plan="yearly" priceLabel={fmtUsd(PRICING.yearly.usd)} onActivated={refreshLicense} />
                                    )}
                                </div>
                            </InteractiveCard>

                            {/* ── Direita Pro · Vitalício (gelatina índigo-violeta mais profunda) ── */}
                            <InteractiveCard
                                className="pricing-card-lifetime group relative overflow-hidden px-6 py-7 flex flex-col"
                                data-active="true"
                                style={{ minHeight: 264, transformStyle: 'preserve-3d' }}
                                glowColor="rgba(139, 92, 246, 0.32)"
                            >
                                {/* Rótulo linha Pro · Vitalício */}
                                <div className="relative flex items-center justify-between" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(12px)' }}>
                                    <span className="badge-tier-label inline-flex items-center px-2 py-0.5 rounded-full text-text-primary text-[10px] font-semibold" style={{ letterSpacing: '0.02em' }}>
                                        {COPY.lifetimeTier}
                                    </span>
                                </div>

                                {/* Bloco de preço: âncora (3 anos) + atual */}
                                <div className="relative mt-4 flex items-baseline gap-2 flex-wrap" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(20px)' }}>
                                    {yearlyPrice !== null && lifetimePrice !== null && (
                                        <span
                                            className="pricing-card-original-price text-[17px] font-normal"
                                            style={{
                                                textDecoration: 'line-through',
                                                textDecorationThickness: '1px',
                                                fontVariantNumeric: 'tabular-nums',
                                                fontFeatureSettings: '"tnum"',
                                                letterSpacing: '-0.02em',
                                            }}
                                        >
                                            {fmtPrice(yearlyPrice * 3)}
                                        </span>
                                    )}
                                    <span
                                        className="pricing-card-price text-[44px] font-bold leading-none text-text-primary"
                                        style={{
                                            display: 'inline-block',
                                            fontVariantNumeric: 'tabular-nums',
                                            fontFeatureSettings: '"tnum"',
                                            letterSpacing: '-0.035em',
                                        }}
                                    >
                                        {lifetimePriceText}
                                    </span>
                                    {lifetimeSavingsPct !== null && (
                                        <span className="pricing-card-savings-badge text-[10px] font-medium tracking-[0.01em] px-2 py-0.5 rounded-full select-none ml-1.5 self-center">
                                            Save {lifetimeSavingsPct}%
                                        </span>
                                    )}
                                </div>
                                <p className="relative mt-1 text-[11px] font-medium text-text-secondary" style={{ transform: 'translateZ(10px)' }}>
                                    {COPY.oneTime}
                                </p>

                                {/* Divisor nítido */}
                                <div className="relative h-px my-4 pricing-card-divider" style={{ transform: 'translateZ(8px)' }} />

                                {/* Recurso principal: Currículo & Ancoragem de Contexto */}
                                <div className="relative" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(14px)' }}>
                                    <div className="flex items-start gap-2.5">
                                        <span className="feature-icon-chip w-6 h-6 flex items-center justify-center shrink-0 mt-px">
                                            <UserCheck size={12} className="text-text-primary" strokeWidth={2.4} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[12.5px] font-semibold leading-tight text-text-primary" style={{ letterSpacing: '-0.01em' }}>
                                                Resume &amp; Context Grounding
                                            </p>
                                            <p className="text-[10.5px] leading-snug mt-1 text-text-secondary">
                                                Align your live assistant guidance with your CV, background files, and target job description.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Pôster de correspondência — flex-1 empurra para o fundo */}
                                <div className="relative flex-1 min-h-0 flex items-end" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(18px)' }}>
                                    <ResumeMatchPoster animateShimmer={!prefersReducedMotion} />
                                </div>

                                {/* Cobrança + pagamento (CTA Dodo removido — compra nos botões abaixo). */}
                                {lifetimeSavingsAbs !== null ? (
                                    <p className="relative mt-3 text-center text-[10px] leading-snug text-text-secondary" style={{ transform: 'translateZ(6px)' }}>
                                        {COPY.saveVs(fmtPrice(lifetimeSavingsAbs))}
                                    </p>
                                ) : (
                                    <p className="relative mt-3 text-center text-[10px] leading-snug text-text-secondary" style={{ transform: 'translateZ(6px)' }}>
                                        {COPY.payOnce}
                                    </p>
                                )}

                                <div className="relative mt-2.5 pt-3 border-t border-white/[0.06] space-y-2" style={{ transform: 'translateZ(24px)' }}>
                                    {IS_PT ? (
                                        <>
                                            {/* Brasil: Pix em destaque, cartão como alternativa. */}
                                            <PixCheckoutButton plan="lifetime" priceLabel={fmtBrl(PRICING.lifetime.brl)} onActivated={refreshLicense} />
                                            <LemonSqueezyCheckoutButton plan="lifetime" priceLabel={fmtUsd(PRICING.lifetime.usd)} onActivated={refreshLicense} />
                                        </>
                                    ) : (
                                        // Fora do Brasil: só o cartão internacional (Pix é BR-only).
                                        <LemonSqueezyCheckoutButton plan="lifetime" priceLabel={fmtUsd(PRICING.lifetime.usd)} onActivated={refreshLicense} />
                                    )}
                                </div>
                            </InteractiveCard>
                        </div>

                        {/* ── Seção de Comparação de Recursos (Grade Bento) ────────── */}
                        <motion.div variants={itemVariants} className="mt-2 space-y-3">
                            {/* Cabeçalho da seção de recursos */}
                            <div className="flex items-center justify-between px-0.5">
                                <h3 className="text-[13px] font-bold tracking-[-0.015em] text-text-primary">
                                    {COPY.everything}
                                </h3>
                                <span className="text-[9px] uppercase tracking-[0.1em] font-semibold text-text-tertiary px-2 py-0.5 rounded-full border border-white/5 bg-white/2">
                                    Both tiers
                                </span>
                            </div>

                            {/* Grade Bento de recursos */}
                            <motion.div
                                variants={gridVariants}
                                initial="hidden"
                                animate="visible"
                                className="grid grid-cols-2 gap-3"
                            >
                                {/* 1. Gerenciador de Modos (ocupa 2 colunas) */}
                                <InteractiveFeatureCard
                                    colorTheme="violet"
                                    glowColor="rgba(139, 92, 246, 0.15)"
                                    className="col-span-2 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                                >
                                    <div className="flex items-start gap-3 flex-1">
                                        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-violet-500/15 to-blue-500/15 border border-violet-400/25 text-violet-300">
                                            <Layers size={16} strokeWidth={2} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[12.5px] font-bold tracking-tight text-text-primary leading-tight">
                                                Modes Manager
                                            </p>
                                            <p className="text-[11px] text-text-secondary leading-snug mt-1 max-w-[340px]">
                                                7 expert personas customized for tech interview prep, PM strategy, executive presence, and sales negotiation.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.09] rounded-full px-3 py-1.5 shadow-sm">
                                        <span className="text-[9px] font-extrabold text-text-primary tracking-wider uppercase">
                                            7 expert personas
                                        </span>
                                        <div className="flex -space-x-1.5">
                                            {['bg-emerald-400', 'bg-blue-400', 'bg-violet-400', 'bg-pink-400', 'bg-orange-400', 'bg-cyan-400', 'bg-yellow-400'].map((color, idx) => (
                                                <span
                                                    key={idx}
                                                    className={`w-3 h-3 rounded-full ${color} border border-black/30 shadow relative shrink-0`}
                                                    style={{
                                                        boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.45), 0 1px 3px rgba(0,0,0,0.35)'
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </InteractiveFeatureCard>

                                {/* 2. Inteligência de Currículo (1 coluna) */}
                                <InteractiveFeatureCard
                                    colorTheme="teal"
                                    glowColor="rgba(20, 184, 166, 0.12)"
                                    className="p-4 flex flex-col justify-between min-h-[110px]"
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-teal-500/15 to-emerald-500/15 border border-teal-400/25 text-teal-300">
                                            <UserCheck size={16} strokeWidth={2} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-bold tracking-tight text-text-primary leading-tight">
                                                Resume Intelligence
                                            </p>
                                            <p className="text-[10.5px] text-text-secondary leading-snug mt-1">
                                                AI grounded in your lived experience, background, and career accomplishments.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-center gap-1.5">
                                        <div className="h-1.5 w-full bg-white/[0.06] rounded-full overflow-hidden border border-white/[0.04]">
                                            <motion.div
                                                className="h-full bg-gradient-to-r from-teal-400 to-emerald-400 rounded-full"
                                                initial={{ width: 0 }}
                                                animate={{ width: '92%' }}
                                                transition={{ duration: 1.5, delay: 0.5, ease: EASE_OUT }}
                                            />
                                        </div>
                                        <span className="text-[8.5px] font-mono text-emerald-350 font-bold shrink-0">92% MATCH</span>
                                    </div>
                                </InteractiveFeatureCard>

                                {/* 3. Inteligência de Contexto (1 coluna) */}
                                <InteractiveFeatureCard
                                    colorTheme="blue"
                                    glowColor="rgba(59, 130, 246, 0.12)"
                                    className="p-4 flex flex-col justify-between min-h-[110px]"
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-blue-500/15 to-indigo-500/15 border border-blue-400/25 text-blue-350">
                                            <Database size={16} strokeWidth={2} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-bold tracking-tight text-text-primary leading-tight">
                                                Context Intelligence
                                            </p>
                                            <p className="text-[10.5px] text-text-secondary leading-snug mt-1">
                                                Ground the AI response in custom reference files, PDFs, docs, and codebases.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-center gap-1 flex-wrap">
                                        {['.pdf', '.docx', '.txt', '.json'].map((ext) => (
                                            <span key={ext} className="text-[8.5px] font-mono font-bold text-blue-300 uppercase px-1.5 py-0.5 rounded border border-blue-500/20 bg-blue-500/8">
                                                {ext}
                                            </span>
                                        ))}
                                    </div>
                                </InteractiveFeatureCard>

                                {/* 4. Coaching de Negociação (1 coluna) */}
                                <InteractiveFeatureCard
                                    colorTheme="rose"
                                    glowColor="rgba(244, 63, 94, 0.12)"
                                    className="p-4 flex flex-col justify-between min-h-[110px]"
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-rose-500/15 to-amber-500/15 border border-rose-400/25 text-rose-300">
                                            <TrendingUp size={16} strokeWidth={2} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-bold tracking-tight text-text-primary leading-tight">
                                                Negotiation Coaching
                                            </p>
                                            <p className="text-[10.5px] text-text-secondary leading-snug mt-1">
                                                Live coaching, counter-offer scripting, and real-time market-band analysis.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between text-[8.5px] font-mono text-text-secondary bg-white/[0.03] border border-white/[0.07] rounded-lg px-2 py-1">
                                        <span>$140k</span>
                                        <div className="h-1 w-16 bg-white/[0.08] rounded-full relative">
                                            <div className="absolute left-[30%] right-[20%] top-0 bottom-0 bg-rose-400 rounded-full" />
                                            <div className="absolute left-[55%] top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-text-primary rounded-full border border-rose-400" />
                                        </div>
                                        <span className="text-text-primary font-bold">$185k</span>
                                    </div>
                                </InteractiveFeatureCard>

                                {/* 5. Inteligência de Descrição de Cargo (1 coluna) */}
                                <InteractiveFeatureCard
                                    colorTheme="orange"
                                    glowColor="rgba(249, 115, 22, 0.12)"
                                    className="p-4 flex flex-col justify-between min-h-[110px]"
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-orange-500/15 to-amber-500/15 border border-orange-400/25 text-orange-300">
                                            <FileText size={16} strokeWidth={2} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-bold tracking-tight text-text-primary leading-tight">
                                                JD Intelligence
                                            </p>
                                            <p className="text-[10.5px] text-text-secondary leading-snug mt-1">
                                                Gap-analysis comparing your profile directly against target job descriptions.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="mt-3 space-y-1 text-[8.5px] font-semibold">
                                        <div className="flex items-center justify-between text-emerald-300">
                                            <span className="flex items-center gap-1">
                                                <Check size={8} strokeWidth={3} />
                                                System Design
                                            </span>
                                            <span className="font-mono text-[7.5px] font-bold tracking-wider text-emerald-400">MATCH</span>
                                        </div>
                                        <div className="flex items-center justify-between text-amber-300">
                                            <span className="flex items-center gap-1">
                                                <AlertCircle size={8} strokeWidth={3} />
                                                Distributed Caching
                                            </span>
                                            <span className="font-mono text-[7.5px] font-bold tracking-wider text-amber-400">GAP</span>
                                        </div>
                                    </div>
                                </InteractiveFeatureCard>

                                {/* 6. Pesquisa de Empresa (1 coluna) */}
                                <InteractiveFeatureCard
                                    colorTheme="cyan"
                                    glowColor="rgba(6, 182, 212, 0.12)"
                                    className="p-4 flex flex-col justify-between min-h-[110px]"
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-cyan-500/15 to-teal-500/15 border border-cyan-400/25 text-cyan-300">
                                            <Building2 size={16} strokeWidth={2} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-bold tracking-tight text-text-primary leading-tight">
                                                Company Research
                                            </p>
                                            <p className="text-[10.5px] text-text-secondary leading-snug mt-1">
                                                Real-time deep-dive into culture, tech stack, and strategic industry positioning.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between text-[8.5px] text-text-primary bg-white/[0.03] border border-white/[0.07] rounded-lg px-2 py-1">
                                        <span className="flex items-center gap-1 font-semibold text-text-secondary">
                                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-350 animate-pulse" />
                                            Culture Intel
                                        </span>
                                        <span className="font-mono text-cyan-350 font-bold uppercase tracking-wider text-[7.5px]">FETCHED LIVE</span>
                                    </div>
                                </InteractiveFeatureCard>

                                {/* 7. Design de Sistema (1 coluna - em breve) */}
                                <InteractiveFeatureCard
                                    colorTheme="gray"
                                    glowColor="rgba(148, 163, 184, 0.05)"
                                    isSoon
                                    className="p-4 flex flex-col justify-between min-h-[110px]"
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-slate-400/20 to-slate-500/10 border border-slate-400/25 text-slate-300">
                                            <Maximize2 size={16} strokeWidth={2} />
                                        </span>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <p className="text-[12px] font-bold tracking-tight text-text-secondary leading-tight">
                                                    System Design
                                                </p>
                                                <span className="text-[8px] font-extrabold uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25 shrink-0">
                                                    Soon
                                                </span>
                                            </div>
                                            <p className="text-[10.5px] text-text-tertiary leading-snug mt-1">
                                                Arquitetura whiteboard blueprints & diagram image OCR extraction.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="mt-3 relative h-6 rounded border border-dashed border-white/10 bg-white/[0.01] overflow-hidden flex items-center justify-center">
                                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:6px_6px]" />
                                        <span className="text-[8px] font-mono font-bold text-slate-400 select-none tracking-wider">ARCHITECTURE GRID</span>
                                    </div>
                                </InteractiveFeatureCard>

                                {/* 8. Entrevistas Simuladas (ocupa 2 colunas - em breve) */}
                                <InteractiveFeatureCard
                                    colorTheme="pink"
                                    glowColor="rgba(139, 92, 246, 0.05)"
                                    isSoon
                                    className="col-span-2 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                                >
                                    <div className="flex items-start gap-3 flex-1">
                                        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-pink-400/20 to-violet-400/10 border border-pink-400/25 text-pink-300">
                                            <Target size={16} strokeWidth={2} />
                                        </span>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <p className="text-[12px] font-bold tracking-tight text-text-secondary leading-tight">
                                                    Mock Interviews
                                                </p>
                                                <span className="text-[8px] font-extrabold uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25 shrink-0">
                                                    Soon
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-text-tertiary leading-snug mt-1 max-w-[340px]">
                                                Practice dialogues with specialized hiring manager personas, offering dynamic difficulty and grading reports.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1 border border-white/[0.07] bg-white/[0.02] rounded-xl p-2 min-w-[160px] select-none shadow-sm shrink-0">
                                        <div className="flex items-center justify-between border-b border-white/[0.05] pb-1">
                                            <span className="text-[8px] font-mono text-text-secondary uppercase tracking-wider">Report</span>
                                            <span className="text-[9px] font-mono font-bold text-pink-450">SCORE: 88%</span>
                                        </div>
                                        <div className="space-y-0.5 text-[8px] text-text-secondary leading-tight">
                                            <div className="flex items-center gap-1">
                                                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                                                <span>Strong behavioral stats</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="w-1 h-1 rounded-full bg-amber-400" />
                                                <span>Add details in architecture</span>
                                            </div>
                                        </div>
                                    </div>
                                </InteractiveFeatureCard>
                            </motion.div>
                        </motion.div>

                        {/* Rodapé: linha de cupom + link de demonstração */}
                        <motion.div variants={itemVariants} className="flex items-center justify-between gap-3 flex-wrap pt-1 px-0.5">
                            <div className="overlay-subtle-surface inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full">
                                <span className="text-[10.5px] font-medium text-text-secondary">
                                    Code{' '}
                                    <strong className="font-mono font-semibold text-text-primary tracking-tight" style={{ letterSpacing: '-0.01em' }}>INSIDER20</strong>
                                    {' '}· 20% off yearly
                                </span>
                            </div>
                            <button
                                onClick={() => openExternal('https://refract.software/pro')}
                                className="text-[11.5px] font-medium flex items-center gap-1.5 text-text-secondary hover:text-text-primary cursor-pointer active:scale-[0.97] h-8 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-md"
                                style={{ transition: `color 180ms ${EASE_OUT_CSS}, transform 140ms ${EASE_OUT_CSS}` }}
                            >
                                <PlayCircle size={13} />
                                <span className="underline underline-offset-4 decoration-border-subtle hover:decoration-current">
                                    Watch it in action
                                </span>
                            </button>
                        </motion.div>
                        <motion.p variants={itemVariants} className="text-[10px] text-text-tertiary leading-relaxed text-center px-2 pt-1">
                            By upgrading you agree to our{' '}
                            <span
                                onClick={() => openExternal('https://refract.software/refractpro/t&c')}
                                className="text-text-secondary hover:text-text-primary underline decoration-border-subtle underline-offset-[3px] cursor-pointer"
                                style={{ transition: `color 180ms ${EASE_OUT_CSS}` }}
                            >
                                Terms &amp; Conditions
                            </span>
                            .
                        </motion.p>
                    </div>

                    <motion.div variants={itemVariants}>
                    <Card>
                        <div className="px-5 pt-5 pb-5">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-8 h-8 rounded-[10px] bg-bg-input border border-border-subtle shadow-[inset_0_1px_rgba(255,255,255,0.06),0_2px_4px_rgba(0,0,0,0.02)] flex items-center justify-center shrink-0">
                                    <Key size={14} className="text-text-primary" strokeWidth={2} />
                                </div>
                                <div>
                                    <h3 className="text-[13.5px] font-semibold tracking-tight text-text-primary leading-none">Already purchased?</h3>
                                    <p className="text-[11.5px] text-text-tertiary mt-1">Enter your license key to activate this device.</p>
                                </div>
                            </div>

                            <div className="space-y-3 mt-1">
                                <div className="relative">
                                    <Key size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                    <input
                                        type="text"
                                        value={licenseKey}
                                        onChange={(e) => setLicenseKey(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                                        placeholder="Enter your license key"
                                        disabled={status === 'loading' || status === 'success'}
                                        className="w-full rounded-[10px] pl-9 pr-3 py-2.5 text-[13px] font-mono focus:outline-none disabled:opacity-50 bg-bg-input border border-border-subtle text-text-primary placeholder-text-tertiary focus:border-white/30 focus:ring-1 focus:ring-white/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]"
                                        style={{ transition: `border-color 180ms ${EASE_OUT_CSS}, box-shadow 180ms ${EASE_OUT_CSS}` }}
                                    />
                                </div>

                                <button
                                    onClick={handleActivate}
                                    disabled={!licenseKey.trim() || status === 'loading' || status === 'success'}
                                    className={`w-full h-11 rounded-full text-[13px] font-semibold flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary ${status === 'success'
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-none'
                                        : status === 'loading'
                                            ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-wait shadow-none'
                                            : !licenseKey.trim()
                                                ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-default shadow-none'
                                                : 'pricing-cta-lifetime cursor-pointer'
                                        }`}
                                    style={{ letterSpacing: '-0.005em', transition: status === 'success' || status === 'loading' || !licenseKey.trim() ? `transform 140ms ${EASE_OUT_CSS}, background-color 180ms ${EASE_OUT_CSS}, opacity 180ms ${EASE_OUT_CSS}, box-shadow 200ms ${EASE_OUT_CSS}` : undefined }}
                                >
                                    {status === 'success' ? (
                                        <><CheckCircle size={14} /> Activated!</>
                                    ) : status === 'loading' ? (
                                        <><div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> Verifying...</>
                                    ) : (
                                        <><Lock size={14} /> Activate License</>
                                    )}
                                </button>

                                {/* Mensagem de erro de ativação */}
                                {status === 'error' && errorMessage && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-500 font-medium">
                                        <AlertCircle size={14} className="shrink-0" /> {errorMessage}
                                    </div>
                                )}

                                {/* T&C consent */}
                                <p className="text-[10.5px] text-text-tertiary leading-relaxed text-center pt-1">
                                    By activating, you agree to our{' '}
                                    <span
                                        onClick={() => openExternal('https://refract.software/refractpro/t&c')}
                                        className="text-text-secondary hover:text-text-primary underline decoration-border-subtle underline-offset-[3px] cursor-pointer"
                                        style={{ transition: `color 180ms ${EASE_OUT_CSS}` }}
                                    >
                                        Terms &amp; Conditions
                                    </span>
                                    .
                                </p>
                            </div>
                        </div>
                    </Card>
                    </motion.div>
                </motion.div>
            )}

            {/* ── Política de Reembolso ────────────────────────────────── */}
            <Card>
                <div className="flex items-center gap-3 px-5 pt-5 pb-4">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
                        <Shield size={18} className="text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary">Refund Policy — Refract Pro</p>
                        <p className="text-[11px] text-text-tertiary leading-snug mt-0.5">
                            Please try the Free Trial first
                        </p>
                    </div>
                </div>

                <div className="h-px bg-border-subtle mx-5" />

                <div className="px-5 pt-4 pb-4">
                    <div className="space-y-3">
                        <div className="rounded-xl bg-bg-input/50 border border-border-subtle px-3.5 py-3">
                            <p className="text-[11.5px] text-text-secondary leading-relaxed">
                                <strong className="text-text-primary font-semibold">A quick heads-up:</strong> Refract is built and maintained by a single developer and integrates a lot of third-party services — AI providers, speech-to-text engines, search APIs, payments, OS-level audio &amp; screen capture. That gives Pro a lot of capability, but the surface area is wider than a typical closed-source app, and once in a while something may not behave exactly as expected. If that happens, please <em>report it</em> rather than disputing the charge — we read every report and fixes typically land in the next update.
                            </p>
                        </div>

                        <div className="flex items-start gap-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary/40 shrink-0 mt-[6px]" />
                            <p className="text-[11.5px] text-text-secondary leading-relaxed">
                                Purchases made with a coupon, voucher, referral credit, or limited-time offer are <strong className="text-text-primary font-semibold">final sale</strong> and not eligible for refund.
                            </p>
                        </div>

                        <div className="flex items-start gap-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary/40 shrink-0 mt-[6px]" />
                            <p className="text-[11.5px] text-text-secondary leading-relaxed">
                                To cancel your subscription, log in to the{' '}
                                <span
                                    onClick={() => openExternal('https://customer.dodopayments.com/')}
                                    className="text-blue-400 hover:text-blue-300 underline decoration-blue-400/40 underline-offset-[3px] cursor-pointer"
                                    style={{ transition: `color 180ms ${EASE_OUT_CSS}` }}
                                >
                                    customer portal
                                </span>{' '}
                                to manage or cancel your plan.
                            </p>
                        </div>

                        <div className="h-px bg-border-subtle mt-4 mb-3" />

                        <p className="text-[11.5px] text-text-secondary leading-relaxed">
                            For everything else — the 1-hour pre-activation window, subscription handling, taxes &amp; fees, and your local consumer rights — please see our full{' '}
                            <span
                                onClick={() => openExternal('https://refract.software/refundpolicy')}
                                className="text-text-primary hover:text-text-secondary underline decoration-border-subtle underline-offset-[3px] cursor-pointer"
                                style={{ transition: `color 180ms ${EASE_OUT_CSS}` }}
                            >
                                Refund Policy
                            </span>
                            . Have a question before buying? Email{' '}
                            <span
                                onClick={() => openExternal('mailto:refract.contact@gmail.com')}
                                className="text-text-primary hover:text-text-secondary underline decoration-border-subtle underline-offset-[3px] cursor-pointer"
                                style={{ transition: `color 180ms ${EASE_OUT_CSS}` }}
                            >
                                refract.contact@gmail.com
                            </span>
                            .
                        </p>

                        <div className="mt-3 px-3 py-2.5 rounded-xl bg-amber-500/6 border border-amber-500/15">
                            <p className="text-[11.5px] text-text-secondary leading-relaxed">
                                <strong className="text-text-primary font-semibold">A personal note:</strong>{' '}
                                Refract is built, maintained, and supported entirely by one person — in their free time.
                                Email replies may take a few days, and weekends (Sat &amp; Sun) are offline.
                                Your patience is genuinely appreciated.
                            </p>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Hardware ID */}
            {hardwareId && (
                <div className="px-2 pt-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-text-tertiary">Device ID</span>
                        <button
                            onClick={copyHardwareId}
                            className="text-[11px] font-medium flex items-center gap-1 text-text-secondary hover:text-text-primary cursor-pointer active:scale-[0.97] h-8 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-md"
                            style={{ transition: `color 180ms ${EASE_OUT_CSS}, transform 140ms ${EASE_OUT_CSS}` }}
                        >
                            {copiedHwid ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                            {copiedHwid ? 'Copied' : 'Copy ID'}
                        </button>
                    </div>
                    <p className="text-[11px] font-mono mt-1.5 truncate select-all text-text-tertiary">
                        {hardwareId}
                    </p>
                </div>
            )}
        </div>
    );
};
