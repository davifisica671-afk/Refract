import React, { useEffect, useRef } from 'react';
import {
    Github, Twitter, Shield, Cpu, Database,
    Heart, Linkedin, Instagram, Mail, MicOff, Star, Bug, Globe, Sparkles, Zap, Camera, LayoutGrid, User, Volume2, Activity, MessageSquare, Link, Smartphone, Calendar, ListTodo, Users, WifiOff, Send
} from 'lucide-react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getPlatformShortcut } from '../utils/platformUtils';

/**
 * AboutSection.tsx
 * Seção "Sobre" do aplicativo. Exibe informações sobre o Refract,
 * novidades da versão, arquitetura, privacidade, links da comunidade
 * e créditos das tecnologias utilizadas.
 */

interface AboutSectionProps { }

export const AboutSection: React.FC<AboutSectionProps> = () => {
    const isLight = useResolvedTheme() === 'light';
    const donationClickTimeRef = useRef<number | null>(null);

    // Verificação inicial do status de doação — não necessária para os visuais mais
    // (desde que removemos a chave de entrada mas talvez queiramos ocultar o
    // botão de suporte se já doou? O usuário disse "não mostrar se o usuário
    // abrir o botão de doação" -> isso se refere ao toaster.
    // Para a seção Sobre, geralmente o botão de validação/suporte permanece.
    // Vou manter como está, apenas mudando a lógica.

    useEffect(() => {
        const handleFocus = async () => {
            if (donationClickTimeRef.current) {
                const elapsed = Date.now() - donationClickTimeRef.current;
                if (elapsed > 20000) { // 20 seconds
                    console.log("User returned after >20s. Marking as donated.");
                    await window.electronAPI?.setDonationComplete();
                    donationClickTimeRef.current = null; // Reinicia
                } else {
                    console.log("User returned too quickly (<20s). Not confirming donation.");
                    donationClickTimeRef.current = null;
                }
            }
        };

        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const handleOpenLink = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
        e.preventDefault();

        // Tratamento especial para link de doação
        if (url.includes('buymeacoffee.com')) {
            donationClickTimeRef.current = Date.now();
        }

        // Usa o shell.openExternal do backend
        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(url);
        } else {
            window.open(url, '_blank');
        }
    };

    return (
        <div className="space-y-6 animated fadeIn pb-10">
            {/* Cabeçalho */}
            <div>
                <h3 className="text-lg font-bold text-text-primary mb-1">About Refract</h3>
                    <p className="text-sm text-text-secondary">Projetado para ser invisível, inteligente e confiável.</p>
            </div>

            {/* What's New Section */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">O que há de novo no v2.8</h4>
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle overflow-hidden">
                    {/* 1. Stateful "Intelligence OS" */}
                    <div className="p-3 border-b border-border-subtle bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 shrink-0">
                                <Cpu size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">Stateful "Intelligence OS"</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    Transitioned to a stateful control plane with mode-aware priors (Sales, Technical, Lecture) that automatically route queries and filter context based on your active task.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 2. Hindsight Long-Term Memory */}
                    <div className="p-3 border-b border-border-subtle bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
                                <Database size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">Hindsight Long-Term Memory</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    Integrates a secure local sidecar vector database that indexes past meetings, custom profiles, and documents, retrieving relevant semantic matches dynamically.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 3. Spoken Answer Humanizer */}
                    <div className="p-3 border-b border-border-subtle bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 shrink-0">
                                <MessageSquare size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">Spoken Answer Humanizer</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    Deterministically rewrites raw LLM outputs to strip corporate jargon, filter out structure bugs (em-dashes, empty bullets), and optimize prose for natural spoken flow.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 4. Sandboxed Code Verification */}
                    <div className="p-3 border-b border-border-subtle bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
                                <Zap size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">Sandboxed Code Verification</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    Automatically executes Python, JS, and SQLite code in isolated local subprocesses, verifying correctness and auto-correcting errors before displaying a verified badge.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 5. Regional STT-Relay Migration */}
                    <div className="p-3 bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 shrink-0">
                                <Globe size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">Regional STT-Relay Migration</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    Migrated realtime audio transcription to low-latency regional VPS hosts with transaction-scoped quota advisory locks to prevent double-billing.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Arquitetura Section */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">How Refract Works</h4>
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle overflow-hidden">
                    <div className="p-3 border-b border-border-subtle bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
                                <Cpu size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">Stateful Intelligence OS</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    Acts as a persistent control plane using mode-aware priors (Sales, Technical, Lecture) to dynamically filter context and direct queries to the optimal reasoning engine.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="p-3 bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
                                <Database size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">Hindsight LTM & Session Memory</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    Combines a secure local sidecar vector database for document indexing with a time-decayed sliding transcript memory to retrieve relevant semantic context on-demand.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Privacy Section */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">Privacy & Data</h4>
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-4">
                    <div className="flex items-start gap-3">
                        <Shield size={16} className="text-green-400 mt-0.5" />
                        <div>
                            <h5 className="text-sm font-medium text-text-primary">Stealth & Control</h5>
                            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                                Features "Undetectable Mode" to hide from the dock and "Masquerading" to disguise as system apps. You control exactly what data leaves your device.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <MicOff size={16} className="text-red-500 mt-0.5" />
                        <div>
                            <h5 className="text-sm font-medium text-text-primary">No Recording</h5>
                            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                                Refract listens only when active. It does not record video, take arbitrary screenshots without command, or perform background surveillance.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Community Section */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">Community</h4>
                <div className="space-y-4">
                    {/* 0. Official Website */}
                    <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500 shadow-sm shadow-indigo-500/5">
                                <Globe size={18} className="opacity-80" />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">Official Website</h5>
                            </div>
                        </div>
                        <a
                            href="https://refract.software"
                            onClick={(e) => handleOpenLink(e, "https://refract.software")}
                            className="whitespace-nowrap px-4 py-2 bg-text-primary hover:bg-white/90 text-bg-main text-xs font-bold rounded-lg transition-all shadow hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
                        >
                            <Globe size={14} />
                            Visit Website
                        </a>
                    </div>

                    {/* 0.5. Telegram Community */}
                    <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-sky-500/10 flex items-center justify-center text-sky-500 shadow-sm shadow-sky-500/5">
                                <Send size={18} className="opacity-80" />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">Telegram Community</h5>
                            </div>
                        </div>
                        <a
                            href="https://t.me/refractaichat"
                            onClick={(e) => handleOpenLink(e, "https://t.me/refractaichat")}
                            className="whitespace-nowrap px-4 py-2 bg-text-primary hover:bg-white/90 text-bg-main text-xs font-bold rounded-lg transition-all shadow hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
                        >
                            <Send size={14} />
                            Join Chat
                        </a>
                    </div>

                    {/* 0.6. Refract LinkedIn */}
                    <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-sm shadow-blue-500/5">
                                <Linkedin size={18} className="opacity-80" />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">LinkedIn Company Page</h5>
                            </div>
                        </div>
                        <a
                            href="https://www.linkedin.com/company/refract"
                            onClick={(e) => handleOpenLink(e, "https://www.linkedin.com/company/refract")}
                            className="whitespace-nowrap px-4 py-2 bg-text-primary hover:bg-white/90 text-bg-main text-xs font-bold rounded-lg transition-all shadow hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
                        >
                            <Linkedin size={14} />
                            Follow Page
                        </a>
                    </div>

                    {/* 1. Founder Perfil */}
                    <div className="bg-bg-item-surface rounded-xl p-5">
                        <div className="flex flex-col gap-4">
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center shrink-0 text-[13px] font-semibold text-text-primary shadow-sm">
                                    JL
                                </div>
                                <div className="pt-0.5">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h5 className="text-sm font-bold text-text-primary">João Lucas</h5>
                                        <span className={`text-[10px] font-medium px-1.5 py-[1px] rounded-full ${isLight ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-yellow-400/10 text-yellow-200 border border-yellow-400/5'}`}>Creator</span>
                                    </div>
                                    <p className="text-xs text-text-secondary leading-relaxed max-w-lg">
                                        I build software that stays out of the way.
                                        <br />
                                        <span className="font-bold text-text-primary">Refract</span> is made to feel fast, quiet, and respectful of your privacy.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 pl-[60px]">
                                <a
                                    href="https://github.com/Refract-AI-assistant/refract"
                                    onClick={(e) => handleOpenLink(e, "https://github.com/Refract-AI-assistant/refract")}
                                    className="text-text-tertiary hover:text-text-primary transition-colors"
                                    title="GitHub"
                                >
                                    <Github size={18} />
                                </a>
                                <a
                                    href="https://www.linkedin.com/in/joaolucas"
                                    onClick={(e) => handleOpenLink(e, "https://www.linkedin.com/in/joaolucas")}
                                    className="text-text-tertiary hover:text-text-primary transition-colors"
                                    title="LinkedIn"
                                >
                                    <Linkedin size={18} />
                                </a>
                            </div>
                        </div>
                    </div>

                    {/* 2. Star & Report */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <a
                            href="https://github.com/Refract-AI-assistant/refract"
                            onClick={(e) => handleOpenLink(e, "https://github.com/Refract-AI-assistant/refract")}
                            className="bg-bg-item-surface border border-border-subtle rounded-xl p-5 transition-all group flex items-center gap-4 h-full hover:bg-white/10"
                        >
                            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center text-yellow-500 shrink-0 group-hover:scale-110 transition-transform">
                                <Star size={20} className="transition-all group-hover:fill-current" />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">Star on GitHub</h5>
                                <p className="text-xs text-text-secondary mt-0.5">Love Refract? Support us by starring the repo.</p>
                            </div>
                        </a>

                        <a
                            href="https://github.com/Refract-AI-assistant/refract/issues"
                            onClick={(e) => handleOpenLink(e, "https://github.com/Refract-AI-assistant/refract/issues")}
                            className="bg-bg-item-surface border border-border-subtle rounded-xl p-5 transition-all group flex items-center gap-4 h-full hover:bg-white/10"
                        >
                            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500 shrink-0 group-hover:scale-110 transition-transform">
                                <Bug size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">Report an Issue</h5>
                                <p className="text-xs text-text-secondary mt-0.5">Found a bug? Let us know so we can fix it.</p>
                            </div>
                        </a>
                    </div>

                    {/* 3. Obtém em Touch */}
                    <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-sm shadow-blue-500/5">
                                <Mail size={18} className="opacity-80" />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">Get in Touch</h5>
                                <p className="text-xs text-text-secondary mt-0.5">Open for professional collaborations and job offers.</p>
                            </div>
                        </div>
                        <a
                            href="mailto:refract.contact@gmail.com"
                            onClick={(e) => handleOpenLink(e, "mailto:refract.contact@gmail.com")}
                            className="whitespace-nowrap px-4 py-2 bg-text-primary hover:bg-white/90 text-bg-main text-xs font-bold rounded-lg transition-all shadow hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
                        >
                            <Mail size={14} />
                            Contact Me
                        </a>
                    </div>

                    {/* 4. Suportar */}
                    <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-500 shadow-sm shadow-pink-500/5">
                                <Heart size={18} fill="currentColor" className="opacity-80" />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">Support Development</h5>
                                <p className="text-xs text-text-secondary mt-0.5">Refract is independent open-source software.</p>
                            </div>
                        </div>
                        <a
                            href="https://buymeacoffee.com/joaolucas"
                            onClick={(e) => handleOpenLink(e, "https://buymeacoffee.com/joaolucas")}
                            className="whitespace-nowrap px-4 py-2 bg-text-primary hover:bg-white/90 text-bg-main text-xs font-bold rounded-lg transition-all shadow hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
                        >
                            Support Project
                        </a>
                    </div>
                </div>
            </div>

            {/* Credits */}
            <div className="pt-4 border-t border-border-subtle">
                <div>
                    <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-3">Core Technology</h4>
                    <div className="flex flex-wrap gap-2">
                        {['Groq', 'Gemini', 'OpenAI', 'Deepgram', 'ElevenLabs', 'Electron', 'React', 'Rust', 'Sharp', 'TypeScript', 'Tailwind CSS', 'Vite', 'Google Cloud', 'SQLite'].map(tech => (
                            <span key={tech} className="px-2.5 py-1 rounded-md bg-bg-input border border-border-subtle text-[11px] font-medium text-text-secondary">
                                {tech}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div >
    );
};
