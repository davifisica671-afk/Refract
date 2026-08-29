/**
 * SettingsPopup.tsx
 *
 * Popup compacto de configurações exibido como menu flutuante.
 * Contém alternâncias rápidas para: indetectabilidade, modo rápido,
 * transcrição, modo entrevista, modo perfil, mostrar/ocultar e captura de tela.
 * Inclui suporte a atalhos de teclado dinâmicos e temas de vidro.
 */
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { MessageSquare, Camera, Zap, User } from 'lucide-react';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getModifierSymbol } from '../utils/platformUtils';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../lib/meetingInterfaceTheme';

const SettingsPopup = () => {
    const { shortcuts } = useShortcuts();
    const isLightTheme = useResolvedTheme() === 'light';
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [useGroqFastText, setUseGroqFastText] = useState(() => {
        return localStorage.getItem('refract_groq_fast_text') === 'true';
    });
    const [profileMode, setProfileMode] = useState(false);
    const [hasProfile, setHasProfile] = useState(false);
    const [isPremium, setIsPremium] = useState(false);

    const isFirstRender = React.useRef(true);

    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    const [interfaceTheme, setInterfaceTheme] = useState<MeetingInterfaceTheme>(() => {
        return getMeetingInterfaceTheme();
    });

    // Carrega credenciais
    const loadCredentials = async () => {
        try {
            // @ts-ignore
            const creds = await window.electronAPI?.getStoredCredentials?.();
            if (creds) {
                setHasStoredKey({
                    gemini: !!creds.hasGeminiKey,
                    groq: !!creds.hasGroqKey,
                    openai: !!creds.hasOpenaiKey,
                    claude: !!creds.hasClaudeKey,
                    deepseek: !!creds.hasDeepseekKey,
                    refract: !!creds.hasRefractKey
                });
            }
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    };

    // Carrega dados iniciais e atualiza ao focar
    useEffect(() => {
        loadCredentials();
        const handleFocus = () => loadCredentials();
        window.addEventListener('focus', handleFocus);

        // Carregar status do perfil
        const loadProfile = async () => {
            try {
                // @ts-ignore
                const status = await window.electronAPI?.profileGetStatus?.();
                if (status) {
                    setHasProfile(status.hasProfile);
                    setProfileMode(status.profileMode);
                }
                // Verificar status premium
                const premium = await window.electronAPI?.licenseCheckPremium?.();
                setIsPremium(!!premium);
            } catch (e) { console.warn('[SettingsPopup] Failed to load profile/premium status:', e); }

        };
        loadProfile();

        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    // Sincronizar tema da interface da reunião com localStorage e processo principal
    useEffect(() => {
        const handleStorage = () => {
            setInterfaceTheme(getMeetingInterfaceTheme());
        };
        window.addEventListener('storage', handleStorage);
        // @ts-ignore
        const unsubscribe = window.electronAPI?.onMeetingInterfaceThemeChanged?.((theme: string) => {
            const valid: MeetingInterfaceTheme[] = ['default', 'liquid-glass', 'modern'];
            if (valid.includes(theme as MeetingInterfaceTheme)) {
                setInterfaceTheme(theme as MeetingInterfaceTheme);
            }
        });
        return () => {
            window.removeEventListener('storage', handleStorage);
            unsubscribe?.();
        };
    }, []);

    // Buscar estado undetectable inicial do processo principal (fonte de verdade)
    useEffect(() => {
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then((state: boolean) => {
                setIsUndetectable(state);
            });
        }
    }, []);

    // Escuta de unidirecional recebe mudanças de estado do processo principal, nunca retorna eco
    useEffect(() => {
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((newState: boolean) => {
                setIsUndetectable(newState);
                localStorage.setItem('refract_undetectable', String(newState));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Ouvir mudanças de outras janelas (sincronização bidirecional)
        if (window.electronAPI?.onGroqFastTextChanged) {
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setUseGroqFastText(enabled);
                localStorage.setItem('refract_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Pular renderização inicial para evitar chamadas IPC desnecessárias
        if (isFirstRender.current) {
            isFirstRender.current = false;
            // Garantir que o backend está sincronizado ao montar (mesmo sem alteração)
            try {
                // @ts-ignore
                window.electronAPI?.invoke('set-groq-fast-text-mode', useGroqFastText);
            } catch (e) {
                console.error(e);
            }
            return;
        }

        // Aplica Groq Text Modo
        localStorage.setItem('refract_groq_fast_text', String(useGroqFastText));
        try {
            // @ts-ignore - electronAPI ainda não tipado neste arquivo
            window.electronAPI?.invoke('set-groq-fast-text-mode', useGroqFastText);
        } catch (e) {
            console.error(e);
        }
    }, [useGroqFastText]);

    const [actionButtonMode, setActionButtonModeState] = useState<'recap' | 'brainstorm'>('recap');

    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('refract_interviewer_transcript');
        return stored !== 'false'; // Padrão para verdadeiro se não definido
    });

    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('refract_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // Carregar modo do botão de ação e inscrever-se em mudanças de outras janelas
    useEffect(() => {
        // @ts-ignore
        window.electronAPI?.getActionButtonMode?.()?.then((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode ?? 'recap');
        }).catch(() => {});
        // @ts-ignore
        if (!window.electronAPI?.onActionButtonModeChanged) return;
        // @ts-ignore
        const unsubscribe = window.electronAPI.onActionButtonModeChanged((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode);
        });
        return () => unsubscribe();
    }, []);

    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-resize Window
    useLayoutEffect(() => {
        if (!contentRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const rect = entry.target.getBoundingClientRect();
                // Enviar dimensões exatas ao Electron
                try {
                    // @ts-ignore
                    window.electronAPI?.updateContentDimensions({
                        width: Math.ceil(rect.width),
                        height: Math.ceil(rect.height)
                    });
                } catch (e) {
                    console.warn("Failed to update dimensions", e);
                }
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    // Determinar se o fundo é escuro (temas de vidro sempre são vidro escuro)
    const isDarkBg = interfaceTheme === 'liquid-glass' || interfaceTheme === 'modern' || !isLightTheme;

    const popupPanelClass = isDarkBg
        ? 'bg-[#1E1E1E]/80 border-white/10 shadow-black/40'
        : 'bg-[#F3F4F6]/92 border-black/10 shadow-black/10';
    const itemHoverClass = isDarkBg ? 'hover:bg-white/5' : 'hover:bg-black/[0.04]';
    const glassRowClass = 'glass-popup-row';
    const labelColorClass = isDarkBg ? 'text-white' : 'text-slate-900';
    const inactiveIconColorClass = isDarkBg
        ? 'text-white/60 group-hover:text-white/90'
        : 'text-slate-500 group-hover:text-slate-800';
    const dividerClass = isDarkBg ? 'bg-white/[0.04]' : 'bg-black/[0.06]';
    const shortcutKeyClass = isDarkBg
        ? 'border-white/10 bg-white/5 text-slate-400 glass-shortcut-key'
        : 'border-black/10 bg-black/[0.04] text-slate-600 glass-shortcut-key';
    const defaultToggleTrackClass = isDarkBg ? 'bg-white/10 glass-toggle-track' : 'bg-black/[0.22] glass-toggle-track';
    const toggleKnobClass = isDarkBg ? 'bg-black shadow-sm' : 'bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]';

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div ref={contentRef} className={`w-[180px] backdrop-blur-md border rounded-[14px] overflow-hidden shadow-2xl p-1.5 flex flex-col animate-scale-in origin-top-left overlay-shell-surface ${popupPanelClass}`}>
                <div className="relative z-[1] flex flex-col">

                {/* Undetectability */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group cursor-default ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <CustomGhost
                            className={`w-4 h-4 transition-colors ${isUndetectable ? (isDarkBg ? 'text-white' : 'text-slate-900') : inactiveIconColorClass}`}
                            fill={isUndetectable ? "currentColor" : "none"}
                            stroke={isUndetectable ? "none" : "currentColor"}
                            eyeColor={isUndetectable ? (isDarkBg ? "black" : "white") : (isDarkBg ? "white" : "#334155")}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>{isUndetectable ? 'Undetectable' : 'Detectable'}</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !isUndetectable;
                            setIsUndetectable(newState);
                            localStorage.setItem('refract_undetectable', String(newState));
                            window.electronAPI?.setUndetectable(newState);
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${isUndetectable
                            ? (isDarkBg ? 'bg-white shadow-[0_2px_8px_rgba(255,255,255,0.2)]' : 'bg-slate-900 shadow-[0_2px_8px_rgba(15,23,42,0.18)]')
                            : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${isUndetectable ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>


                    {/* Groq (Texto Rápido) Alternar — habilitado com chave Groq ou chave API Refract */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group ${!(hasStoredKey.groq || hasStoredKey.refract) ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} ${glassRowClass} cursor-default`}`} title={!(hasStoredKey.groq || hasStoredKey.refract) ? "Requires Groq or Refract API key" : ""}>
                    <div className="flex items-center gap-2.5">
                        <Zap
                            className={`w-4 h-4 transition-colors ${useGroqFastText ? 'text-orange-500' : inactiveIconColorClass}`}
                            fill={useGroqFastText ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>Fast Response</span>
                    </div>
                    <button
                        onClick={() => {
                            if (!(hasStoredKey.groq || hasStoredKey.refract)) return;
                            setUseGroqFastText(!useGroqFastText);
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${useGroqFastText ? 'bg-orange-500 shadow-[0_2px_10px_rgba(249,115,22,0.3)]' : defaultToggleTrackClass}`}
                        disabled={!(hasStoredKey.groq || hasStoredKey.refract)}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${useGroqFastText ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                    {/* Alternar de Transcrição do Entrevistador */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group cursor-default ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <MessageSquare
                            className={`w-3.5 h-3.5 transition-colors ${showTranscript ? 'text-emerald-400' : inactiveIconColorClass}`}
                            fill={showTranscript ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>Transcript</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !showTranscript;
                            setShowTranscript(newState);
                            localStorage.setItem('refract_interviewer_transcript', String(newState));
                            // Despachar evento para ouvintes na mesma janela
                            window.dispatchEvent(new Event('storage'));
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${showTranscript ? 'bg-emerald-500 shadow-[0_2px_10px_rgba(16,185,129,0.3)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${showTranscript ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                    {/* Alternar de Modo Interview (Brainstorm) */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group cursor-default ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`w-3.5 h-3.5 transition-colors ${actionButtonMode === 'brainstorm' ? 'text-violet-400' : inactiveIconColorClass}`}
                        >
                            <line x1="6" y1="3" x2="6" y2="15" />
                            <circle cx="18" cy="6" r="3" />
                            <circle cx="6" cy="18" r="3" />
                            <path d="M18 9a9 9 0 0 1-9 9" />
                        </svg>
                        <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>Modo Interview</span>
                    </div>
                    <button
                        onClick={async () => {
                            const newMode: 'recap' | 'brainstorm' = actionButtonMode === 'brainstorm' ? 'recap' : 'brainstorm';
                            setActionButtonModeState(newMode);
                            try {
                                // @ts-ignore
                                await window.electronAPI?.setActionButtonMode?.(newMode);
                            } catch (e) { console.error(e); }
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${actionButtonMode === 'brainstorm' ? 'bg-violet-500 shadow-[0_2px_10px_rgba(139,92,246,0.3)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${actionButtonMode === 'brainstorm' ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                    {/* Alternar de Modo Perfil */}
                {hasProfile && (
                    <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group ${!isPremium ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} ${glassRowClass} cursor-default`}`} title={!isPremium ? 'Requires Pro license to be active' : ''}>
                        <div className="flex items-center gap-2.5">
                            <User
                                className={`w-3.5 h-3.5 transition-colors ${profileMode && isPremium ? 'text-accent-primary' : inactiveIconColorClass}`}
                                fill={profileMode && isPremium ? "currentColor" : "none"}
                            />
                            <span className={`text-[12px] font-medium transition-colors ${labelColorClass}`}>Profile Mode</span>
                        </div>
                        <button
                            onClick={async () => {
                                if (!isPremium) return;
                                const newState = !profileMode;
                                setProfileMode(newState);
                                try {
                                    // @ts-ignore
                                    await window.electronAPI?.profileSetMode?.(newState);
                                } catch (e) { console.error(e); }
                            }}
                            className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${profileMode && isPremium ? 'bg-accent-primary shadow-[0_2px_10px_rgba(var(--color-accent-primary),0.3)]' : defaultToggleTrackClass}`}
                            disabled={!isPremium}
                        >
                            <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${profileMode && isPremium ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                        </button>
                    </div>
                )}

                <div className={`h-px my-0.5 mx-1.5 ${dividerClass}`} />

                {/* Show/Hide Refract */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <MessageSquare className={`w-3.5 h-3.5 transition-colors ${inactiveIconColorClass}`} />
                        <span className={`text-[12px] transition-colors ${labelColorClass}`}>Show/Hide</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {/* Chaves dinâmicas para alternar visibilidade */}
                        {(shortcuts.toggleVisibility || [getModifierSymbol('cmd'), 'B']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Screenshot */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass} ${glassRowClass}`}>
                    <div className="flex items-center gap-2.5">
                        <Camera className={`w-3.5 h-3.5 transition-colors ${inactiveIconColorClass}`} />
                        <span className={`text-[12px] transition-colors ${labelColorClass}`}>Screenshot</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {/* Chaves dinâmicas para capturar tela */}
                        {(shortcuts.takeScreenshot || [getModifierSymbol('cmd'), 'H']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                </div>
            </div>
        </div>
    );
};

interface CustomGhostProps {
    className?: string;
    fill?: string;
    stroke?: string;
    eyeColor?: string;
}

// Fantasma personalizado com suporte a cor de olhos dinâmica
const CustomGhost = ({ className, fill, stroke, eyeColor }: CustomGhostProps) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={fill || "none"}
        stroke={stroke || "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        {/* Corpo */}
        <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
        {/* Eyes - Não stroke, apenas fill */}
        <path
            d="M9 10h.01 M15 10h.01"
            stroke={eyeColor || "currentColor"}
                strokeWidth="2.5" // Ligeiramente mais grosso para visibilidade
            fill="none"
        />
    </svg>
);

export default SettingsPopup;
