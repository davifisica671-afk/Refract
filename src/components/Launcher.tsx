/**
 * Launcher.tsx
 * Tela principal do Refract (launcher). Exibe lista de reuniões recentes,
 * eventos próximos, status de detecção, pesquisa global e controles de
 * janela. Serve como ponto de entrada para todas as funcionalidades do app.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ToggleLeft, ToggleRight, Search, Calendar, ArrowRight, ArrowLeft, MoreHorizontal, Globe, Clock, ChevronRight, Settings, LayoutGrid, RefreshCw, Eye, EyeOff, Ghost, Plus, Mail, Link as LinkIcon, ChevronDown, Trash2, Bell, Check, Download, DownloadCloud, CheckCircle, AlertCircle, User, UserSearch, Sparkles, ArrowUpRight, Target, GraduationCap } from 'lucide-react';
import { generateMeetingPDF } from '../utils/pdfGenerator';
import { RefractLogoMark } from './RefractLogoMark';
import mainui from "../UI_comp/mainui.png";
import calender from "../UI_comp/calender.png";
import ConnectCalendarButton from './ui/ConnectCalendarButton';
import MeetingDetails from './MeetingDetails';
import TopSearchPill from './TopSearchPill';
import GlobalChatOverlay from './GlobalChatOverlay';
import { motion, AnimatePresence } from 'framer-motion';
import { FeatureSpotlight } from './FeatureSpotlight';
import { analytics } from '../lib/analytics/analytics.service'; // Added analytics importar
import { AssistantsPicker } from './AssistantsPicker';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { isMac } from '../utils/platformUtils';
import WindowControls from './WindowControls';
import { SystemHealthPopover } from './SystemHealthPopover';
import { InteractiveTutorial } from './tutorial/InteractiveTutorial';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    active?: boolean; // UI estado
    time?: string; // Optional para compatibility
}

interface LauncherProps {
    onStartMeeting: () => void;
    onOpenSettings: (tab?: string) => void;
    onOpenProfile?: () => void;
    onOpenModes?: () => void;
    onPageChange?: (isMain: boolean) => void;
    ollamaPullStatus?: 'idle' | 'downloading' | 'complete' | 'failed';
    ollamaPullPercent?: number;
    ollamaPullMessage?: string;
    isPremium?: boolean;
    activeModeId?: string | null;
    onSelectAssistant?: (templateType: string) => void;
}

// Função auxiliar para formatar grupos de data
const getGroupLabel = (dateStr: string) => {
    if (dateStr === "Today") return "Today"; // Compatibilidade retroativa

    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (checkDate.getTime() === today.getTime()) return "Today";
    if (checkDate.getTime() === yesterday.getTime()) return "Yesterday";

    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// Função auxiliar para formatar hora (ex: 3:14pm)
const formatTime = (dateStr: string) => {
    if (dateStr === "Today") return "Just now"; // Legado
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
};

const Launcher: React.FC<LauncherProps> = ({ onStartMeeting, onOpenSettings, onOpenProfile, onOpenModes, onPageChange, ollamaPullStatus = 'idle', ollamaPullPercent = 0, ollamaPullMessage = '', isPremium = false, activeModeId = null, onSelectAssistant }) => {
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [isDetectable, setIsDetectable] = useState(false);
    const [isMeetingActive, setIsMeetingActive] = useState(false);
    const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
    const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
    const [isCalendarConnected, setIsCalendarConnected] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showNotification, setShowNotification] = useState(false);

    // Estado de busca global (para o overlay de chat AI)
    const [isGlobalChatOpen, setIsGlobalChatOpen] = useState(false);
    const [submittedGlobalQuery, setSubmittedGlobalQuery] = useState('');

    const [showModesOnboarding, setShowModesOnboarding] = useState(false);
    const [showProfileOnboarding, setShowProfileOnboarding] = useState(false);
    const [launchCount, setLaunchCount] = useState<number>(0);
    const [showAssistantsPicker, setShowAssistantsPicker] = useState(false);

    // Tour guiado — abre sozinho no primeiro uso (flag persistida no main);
    // reprise manual pelo botão de tutorial no topbar.
    const [tutorialOpen, setTutorialOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        window.electronAPI?.onboardingGetFlags?.()
            .then((flags) => {
                if (!cancelled && flags && !flags.seenInteractiveTutorial) {
                    // Pequeno delay para não competir com a animação de startup.
                    const t = window.setTimeout(() => setTutorialOpen(true), 1200);
                    return () => window.clearTimeout(t);
                }
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const fetchMeetings = () => {
        if (window.electronAPI && window.electronAPI.getRecentMeetings) {
            window.electronAPI.getRecentMeetings().then(setMeetings).catch(err => console.error("Failed to fetch meetings:", err));
        }
    };

    const fetchEvents = () => {
        if (window.electronAPI && window.electronAPI.getUpcomingEvents) {
            window.electronAPI.getUpcomingEvents().then(setUpcomingEvents).catch(err => console.error("Failed to fetch events:", err));
        }
    }

    const handleRefresh = async () => {
        setIsRefreshing(true);
        analytics.trackCommandExecuted('refresh_calendar');
        try {
            if (window.electronAPI && window.electronAPI.calendarRefresh) {
                setShowNotification(true);
                await window.electronAPI.calendarRefresh();
                fetchEvents();
                fetchMeetings();
                setTimeout(() => {
                    setShowNotification(false);
                }, 3000);
            } else {
                console.warn("electronAPI.calendarRefresh not found");
            }
        } catch (e) {
            console.error("Refresh failed in handleRefresh:", e);
        } finally {
            // Garante distinct feedback provided (min 500ms spin)
            setTimeout(() => setIsRefreshing(false), 500);
        }
    };

    // Keybinds
    const { isShortcutPressed } = useShortcuts();
    const isLight = useResolvedTheme() === 'light';
    useEffect(() => {
        let mounted = true;
        console.log("Launcher mounted");
        // Rastreia contagem de inicializações para mostrar o pill "Novidades"
        const storedCount = localStorage.getItem('refract_launch_count_v2.7');
        const currentCount = storedCount ? parseInt(storedCount, 10) : 0;
        const newCount = currentCount + 1;
        localStorage.setItem('refract_launch_count_v2.7', newCount.toString());
        if (mounted) {
            setLaunchCount(newCount);
        }
        // Semente de dados demo se necessário (seguro chamar sempre — executa uma vez na montagem)
        if (window.electronAPI && window.electronAPI.seedDemo) {
            window.electronAPI.seedDemo().catch(err => console.error("Failed to seed demo:", err));
        }

        // Verificação de onboarding
        const hasSeenModesOnboarding = localStorage.getItem('refract_seen_modes_onboarding_v5');
        if (!hasSeenModesOnboarding) {
            setTimeout(() => {
                if (mounted) setShowModesOnboarding(true);
            }, 8000); // Atraso aumentado para não sobrepor outras notificações de inicialização
        }

        const hasSeenProfileOnboarding = localStorage.getItem('refract_seen_profile_onboarding_v1');
        if (!hasSeenProfileOnboarding && hasSeenModesOnboarding) {
            setTimeout(() => {
                if (mounted) setShowProfileOnboarding(true);
            }, 9000);
        } else if (!hasSeenProfileOnboarding && !hasSeenModesOnboarding) {
             // Se ambos não foram vistos, mostra perfil após modos
             setTimeout(() => {
                if (mounted) setShowProfileOnboarding(true);
            }, 18000);
        }

        // Sincroniza estado inicial de detecção
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then((undetectable) => {
                if (mounted) setIsDetectable(!undetectable);
            });
        }

        // Escuta mudanças de detecção
        let removeUndetectableListener: (() => void) | undefined;
        if (window.electronAPI?.onUndetectableChanged) {
            removeUndetectableListener = window.electronAPI.onUndetectableChanged((undetectable) => {
                setIsDetectable(!undetectable);
            });
        }

        fetchMeetings();
        fetchEvents();

        // Sincroniza estado inicial de reunião ativa — protegido para não escrever em componente desmontado
        if (window.electronAPI?.getMeetingActive) {
            window.electronAPI.getMeetingActive()
                .then((active) => { if (mounted) setIsMeetingActive(active); })
                .catch(() => {});
        }

        // Escuta mudanças de estado da reunião (ex: reunião iniciada/encerrada pelo overlay)
        let removeMeetingStateListener: (() => void) | undefined;
        if (window.electronAPI?.onMeetingStateChanged) {
            removeMeetingStateListener = window.electronAPI.onMeetingStateChanged(({ isActive }) => {
                setIsMeetingActive(isActive);
            });
        }

        // Escuta atualizações de fundo (ex: após processamento de reunião finalizar)
        let removeMeetingsListener: (() => void) | undefined;
        if (window.electronAPI?.onMeetingsUpdated) {
            removeMeetingsListener = window.electronAPI.onMeetingsUpdated(() => {
                console.log("Received meetings-updated event");
                fetchMeetings();
            });
        }

        // Polling simples para eventos a cada minuto
        const interval = setInterval(fetchEvents, 60000);

        return () => {
            mounted = false;
            if (removeMeetingsListener) removeMeetingsListener();
            if (removeUndetectableListener) removeUndetectableListener();
            if (removeMeetingStateListener) removeMeetingStateListener();
            clearInterval(interval);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Mount-only: stable configura that precisa executa exatamente uma vez

    // Efeito separado para listener de teclado — re-registra quando isShortcutPressed muda
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isShortcutPressed(e, 'toggleVisibility')) {
                e.preventDefault();
                window.electronAPI?.toggleWindow?.();
            } else if (isShortcutPressed(e, 'moveWindowUp')) {
                e.preventDefault();
                window.electronAPI?.moveWindowUp?.();
            } else if (isShortcutPressed(e, 'moveWindowDown')) {
                e.preventDefault();
                window.electronAPI?.moveWindowDown?.();
            } else if (isShortcutPressed(e, 'moveWindowLeft')) {
                e.preventDefault();
                window.electronAPI?.moveWindowLeft?.();
            } else if (isShortcutPressed(e, 'moveWindowRight')) {
                e.preventDefault();
                window.electronAPI?.moveWindowRight?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isShortcutPressed]);

    // Reuniões próximas (em andamento para cima até 5 min atrás, ou qualquer evento futuro
    // na janela de 7 dias da API), ordenadas por proximidade. Limitado a 3 para o cartão
    // de visualização lateral do calendário
    const upcomingMeetings = upcomingEvents
        .filter(e => new Date(e.startTime).getTime() - Date.now() > -5 * 60000)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const visibleMeetings = upcomingMeetings.slice(0, 3);
    const nextMeeting = visibleMeetings[0];
    const moreMeetingsCount = Math.max(0, upcomingMeetings.length - visibleMeetings.length);

    const toggleDetectable = () => {
        const newState = !isDetectable;
        setIsDetectable(newState);
        window.electronAPI?.setUndetectable(!newState); // Note: setUndetectable takes o *undetectable* sestado que é inverse de *detectable*
        analytics.trackModeSelected(newState ? 'launcher' : 'undetectable'); // If visible (detectable), modo é normal/launcher. If não detectable, modo é undetectable.
    };

    // Agrupa reuniões
    const groupedMeetings = meetings.reduce((acc, meeting) => {
        const label = getGroupLabel(meeting.date);
        if (!acc[label]) acc[label] = [];
        acc[label].push(meeting);
        return acc;
    }, {} as Record<string, Meeting[]>);

    // Resumo dos últimos 7 dias — lê o que já existe no histórico, sem
    // telemetria nova: contagem, minutos capturados e itens de ação abertos.
    const weekStats = useMemo(() => {
        // Janela de 7 dias alinhada ao início do dia local (não às últimas 24h),
        // para que o sparkline e os totais leiam como "dias corridos".
        const dayMs = 86400000;
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const cutoff = startOfToday.getTime() - 6 * dayMs;
        const recent = meetings.filter((m) => {
            const t = new Date(m.date).getTime();
            return Number.isFinite(t) && t >= cutoff;
        });
        // duration chega como "MM:SS" (ou "M:SS"); tudo mais conta zero.
        const durationMinutes = (m: Meeting) => {
            const [mm, ss] = String(m.duration || '').split(':');
            const parsed = parseInt(mm, 10);
            if (!Number.isFinite(parsed)) return 0;
            return parsed + (parseInt(ss, 10) >= 30 ? 1 : 0);
        };
        const minutes = recent.reduce((sum, m) => sum + durationMinutes(m), 0);
        const actions = recent.reduce(
            (sum, m) => sum + (m.detailedSummary?.actionItems?.length || 0),
            0,
        );
        // Minutos capturados por dia (índice 0 = há 6 dias, índice 6 = hoje).
        const perDay = Array.from({ length: 7 }, (_, i) => {
            const dayStart = cutoff + i * dayMs;
            return recent.reduce((sum, m) => {
                const t = new Date(m.date).getTime();
                return t >= dayStart && t < dayStart + dayMs ? sum + durationMinutes(m) : sum;
            }, 0);
        });
        return { count: recent.length, minutes, actions, perDay };
    }, [meetings]);

    // "128 min" vira "2h 8m" — minutos crus ficam ilegíveis passando de uma hora.
    const formatMinutes = (total: number) => {
        if (total < 60) return `${total}m`;
        const h = Math.floor(total / 60);
        const m = total % 60;
        return m === 0 ? `${h}h` : `${h}h ${m}m`;
    };

    // Ordenação dos grupos (Hoje, Ontem, depois os demais do mais novo para o mais antigo —
    // idealmente via ordenação da API, mas a ordenação de chaves de objeto JS não é garantida.
    // Usamos Map ou apenas chaves conhecidas.)
    // Ordenação simples para chaves:
    const sortedGroups = Object.keys(groupedMeetings).sort((a, b) => {
        if (a === 'Today') return -1;
        if (b === 'Today') return 1;
        if (a === 'Yesterday') return -1;
        if (b === 'Yesterday') return 1;
        // Aproximação para os demais: analisa a data
        return new Date(b).getTime() - new Date(a).getTime();
    });


    const [forwardMeeting, setForwardMeeting] = useState<Meeting | null>(null);
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [menuEntered, setMenuEntered] = useState(false);

    useEffect(() => {
        setMenuEntered(false);
    }, [activeMenuId]);

    // Global click ouvinte para fechar menu
    useEffect(() => {
        const handleClickOutside = () => setActiveMenuId(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    // Notifica pai se we são em o principal launcher lista visão
    useEffect(() => {
        if (onPageChange) {
            onPageChange(!selectedMeeting && !isGlobalChatOpen);
        }
    }, [selectedMeeting, isGlobalChatOpen, onPageChange]);

    const handleOpenMeeting = async (meeting: Meeting) => {
        setForwardMeeting(null); // Limpa para frente history em new navigation
        console.log("[Launcher] Opening meeting:", meeting.id);
        analytics.trackCommandExecuted('open_meeting_details');

        // Busca completo meeting details incluindo transcript e usage
        if (window.electronAPI && window.electronAPI.getMeetingDetails) {
            try {
                console.log("[Launcher] Fetching full meeting details...");
                const fullMeeting = await window.electronAPI.getMeetingDetails(meeting.id);
                console.log("[Launcher] Got meeting details:", fullMeeting);
                console.log("[Launcher] Transcript count:", fullMeeting?.transcript?.length);
                console.log("[Launcher] Usage count:", fullMeeting?.usage?.length);
                if (fullMeeting) {
                    setSelectedMeeting(fullMeeting);
                    return;
                }
            } catch (err) {
                console.error("[Launcher] Failed to fetch meeting details:", err);
            }
        } else {
            console.warn("[Launcher] getMeetingDetails not available on electronAPI");
        }
        // Fallback para list-view dados se busca fails
        setSelectedMeeting(meeting);
    };

    const handleBack = () => {
        setForwardMeeting(selectedMeeting);
        setSelectedMeeting(null);
    };

    const handleForward = () => {
        if (forwardMeeting) {
            setSelectedMeeting(forwardMeeting);
            setForwardMeeting(null);
        }
    };

    // Função auxiliar para formatar duração em mm:ss ou mmm:ss
    // Função auxiliar para formatar duração em mm:ss ou mmm:ss
    const formatDurationPill = (durationStr: string) => {
        if (!durationStr) return "00:00";

        // Verifica se já está no formato de dois pontos (ex: "5:30", "105:20")
        if (durationStr.includes(':')) {
            const parts = durationStr.split(':');
            const mins = parts[0];
            const secs = parts[1] || "00";

            // Permite 3 dígitos para minutos se >= 100, caso contrário preenche com 2
            const formattedMins = mins.length >= 3 ? mins : mins.padStart(2, '0');
            return `${formattedMins}:${secs}`;
        }

        // Fallback para formato "X min" (legado)
        const minutes = parseInt(durationStr.replace('min', '').trim()) || 0;
        const mm = minutes.toString().padStart(2, '0');
        return `${mm}:00`;
    };

    return (
        <div
            className="refract-launcher h-full w-full flex flex-col bg-bg-primary text-text-primary font-sans overflow-hidden selection:bg-accent-secondary/30"
            data-stealth={!isDetectable ? 'true' : 'false'}
        >
            {/* 1. Cabeçalho (Estático) */}
            <header className="refract-topbar relative w-full h-[44px] shrink-0 flex items-center justify-between pl-0 drag-region select-none border-b z-[200]">
                {/* Esquerda: Espaço para Luzes de Tráfego + Botões de Navegação */}
                <div className="flex items-center gap-1 no-drag">
                    {isMac && <div className="w-[70px]" />} {/* Espaço para Luzes de Tráfego (apenas macOS */}

                    {/* Botão Voltar */}
                    <button
                        onClick={selectedMeeting ? handleBack : undefined}
                        disabled={!selectedMeeting}
                        className={`
                            refract-topbar-button transition-all duration-300 flex items-center justify-center ml-2
                            ${selectedMeeting
                                ? `text-text-secondary hover:text-text-primary ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`
                                : 'text-text-tertiary opacity-50 cursor-default'}
                        `}
                    >
                        <ArrowLeft size={16} />
                    </button>

                    {/* Botão Avançar */}
                    <button
                        onClick={handleForward}
                        disabled={!forwardMeeting}
                        className={`
                            refract-topbar-button transition-all duration-300 flex items-center justify-center
                            ${forwardMeeting
                                ? `text-text-secondary hover:text-text-primary ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`
                                : 'text-text-tertiary opacity-0 cursor-default'}
                        `}
                    >
                        <ArrowRight size={16} />
                    </button>
                </div>


                {/* Centro: Pill de Busca estilo Spotlight */}
                <TopSearchPill
                    meetings={meetings}
                    onAIQuery={(query) => {
                        analytics.trackCommandExecuted('ai_query_search');
                        setSubmittedGlobalQuery(query);
                        setIsGlobalChatOpen(true);
                    }}
                    onLiteralSearch={(query) => {
                        analytics.trackCommandExecuted('literal_search');
                        // GLOBAL Busca V2 (Fase 9): real local-DB literal busca atrás
                        // global_search_v2_enabled. Quando habilitado e there's a match, abrir
                        // o top-ranked meeting directly. Caso contrário fall voltar para o
                        // existing AI-query behavior (preserved). O backend Retorna
                        // { enabled:false } quando o flag é ofora então isso é a pure no-op tentão
                        // O manipulador stays synchronous (prop é `(q) => void`); o await
                        // executa em an inner IIFE então we nunca retorna a floating Promise para o
                        // event-handler prop.
                        const runFallback = () => {
                            setSubmittedGlobalQuery(query);
                            setIsGlobalChatOpen(true);
                        };
                        void (async () => {
                            try {
                                const resp = await window.electronAPI.searchGlobalMeetings?.(query);
                                if (resp?.enabled && Array.isArray(resp.results) && resp.results.length > 0) {
                                    const top = resp.results[0];
                                    const meeting = meetings.find((m) => m.id === top.meetingId);
                                    if (meeting) {
                                        handleOpenMeeting(meeting);
                                        return;
                                    }
                                }
                            } catch (_) { /* fall através to AI consulta */ }
                            runFallback();
                        })();
                    }}
                    onOpenMeeting={(meetingId) => {
                        const meeting = meetings.find(m => m.id === meetingId);
                        if (meeting) {
                            handleOpenMeeting(meeting);
                            analytics.trackCommandExecuted('open_meeting_from_search');
                        }
                    }}
                />

                {/* Ações da Direita */}
                <div className={`flex items-center gap-1 no-drag shrink-0 ${isMac ? 'mr-1' : ''}`}>
                    <div className="relative group/profile-btn select-none">
                        <button
                            data-testid="open-profile-intelligence"
                            onClick={() => {
                                setShowProfileOnboarding(false);
                                localStorage.setItem('refract_seen_profile_onboarding_v1', 'true');
                                window.electronAPI?.onboardingSetFlag?.('seenProfileOnboarding', true).catch(() => {});
                                onOpenProfile?.();
                            }}
                            title="Profile Intelligence"
                            className="refract-topbar-button flex items-center justify-center text-text-secondary"
                        >
                            <UserSearch size={18} />
                        </button>
                        
                        <AnimatePresence>
                            {showProfileOnboarding && (
                                <motion.div
                                    initial={{ opacity: 0, y: 6, scale: 0.96, filter: "blur(4px)" }}
                                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                                    exit={{ opacity: 0, y: -2, scale: 0.98, filter: "blur(2px)", transition: { duration: 0.15, ease: "easeOut" } }}
                                    transition={{ type: "spring", stiffness: 350, damping: 25, mass: 1 }}
                                    className={`absolute top-[38px] right-2 w-[270px] rounded-[20px] p-4 z-[300] origin-top-right backdrop-blur-[40px] saturate-[180%] transform-gpu ${
                                        isLight 
                                        ? 'bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]' 
                                        : 'bg-[#18181A]/70 shadow-[0_8px_30px_rgb(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)]'
                                    }`}
                                >
                                    {/* Triangle Ponteiro */}
                                    <div className={`absolute -top-[5px] right-[14px] w-2.5 h-2.5 rotate-45 rounded-tl-[3px] ${
                                        isLight 
                                        ? 'bg-white/70 border-t border-l border-black/5 backdrop-blur-[40px]' 
                                        : 'bg-[#18181A]/70 border-t border-l border-white/5 backdrop-blur-[40px]'
                                    }`} />
                                    
                                    <div className="relative flex gap-3">
                                        <div className={`w-9 h-9 flex items-center justify-center shrink-0 rounded-full ${
                                            isLight
                                            ? 'bg-blue-500 bg-opacity-10 text-blue-500'
                                            : 'bg-blue-500 bg-opacity-15 text-blue-400'
                                        }`}>
                                            <UserSearch size={18} />
                                        </div>
                                        <div className="flex-1 pt-[2px]">
                                            <h3 className="text-[14px] font-semibold tracking-[-0.015em] mb-1 flex items-center gap-2">
                                                <span className={isLight ? 'text-slate-900' : 'text-slate-100'}>Profile Intel</span>
                                                <span className={`text-[10px] font-medium px-1.5 py-[1px] rounded-[5px] ${
                                                    isLight
                                                    ? 'bg-blue-50 text-blue-600 border border-blue-100/50'
                                                    : 'bg-blue-500/10 text-blue-400'
                                                }`}>
                                                    Beta
                                                </span>
                                            </h3>
                                            <p className={`text-[12px] leading-[1.35] mb-3.5 tracking-[-0.01em] ${
                                                isLight ? 'text-slate-500' : 'text-slate-400'
                                            }`}>
                                                Manage your persona, career history, and active job description.
                                            </p>
                                            <div className="flex justify-end gap-1.5 isolate">
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        setShowProfileOnboarding(false); 
                                                        localStorage.setItem('refract_seen_profile_onboarding_v1', 'true'); 
                                                        window.electronAPI?.onboardingSetFlag?.('seenProfileOnboarding', true).catch(() => {});
                                                    }}
                                                    className={`text-[12px] font-medium px-3.5 py-[6px] rounded-full transition-all active:scale-95 ${
                                                        isLight
                                                        ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/60'
                                                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/10'
                                                    }`}
                                                >
                                                    Dismiss
                                                </button>
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        onOpenProfile?.(); 
                                                        setShowProfileOnboarding(false); 
                                                        localStorage.setItem('refract_seen_profile_onboarding_v1', 'true'); 
                                                        window.electronAPI?.onboardingSetFlag?.('seenProfileOnboarding', true).catch(() => {});
                                                    }}
                                                    className={`text-[12px] font-medium px-4 py-[6px] rounded-full transition-all active:scale-95 shadow-sm ${
                                                        isLight
                                                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                                                        : 'bg-slate-100 text-slate-900 hover:bg-white'
                                                    }`}
                                                >
                                                    Try it out
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <div className="relative group/modes-btn select-none">
                        <button
                            onClick={() => {
                                setShowModesOnboarding(false);
                                localStorage.setItem('refract_seen_modes_onboarding_v5', 'true');
                                window.electronAPI?.onboardingSetFlag?.('seenModesOnboarding', true).catch(() => {});
                                onOpenModes?.();
                            }}
                            title="Modes"
                            className="refract-topbar-button flex items-center justify-center text-text-secondary"
                        >
                            <svg width={18} height={18} viewBox="0 0 14 14" fill="none">
                                <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.35"/>
                            </svg>
                        </button>
                        
                        <AnimatePresence>
                            {showModesOnboarding && (
                                <motion.div
                                    initial={{ opacity: 0, y: 6, scale: 0.96, filter: "blur(4px)" }}
                                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                                    exit={{ opacity: 0, y: -2, scale: 0.98, filter: "blur(2px)", transition: { duration: 0.15, ease: "easeOut" } }}
                                    transition={{ type: "spring", stiffness: 350, damping: 25, mass: 1 }}
                                    className={`absolute top-[38px] right-2 w-[270px] rounded-[20px] p-4 z-[300] origin-top-right backdrop-blur-[40px] saturate-[180%] transform-gpu ${
                                        isLight 
                                        ? 'bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]' 
                                        : 'bg-[#18181A]/70 shadow-[0_8px_30px_rgb(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)]'
                                    }`}
                                >
                                    {/* Triangle Ponteiro */}
                                    <div className={`absolute -top-[5px] right-[14px] w-2.5 h-2.5 rotate-45 rounded-tl-[3px] ${
                                        isLight 
                                        ? 'bg-white/70 border-t border-l border-black/5 backdrop-blur-[40px]' 
                                        : 'bg-[#18181A]/70 border-t border-l border-white/5 backdrop-blur-[40px]'
                                    }`} />
                                    
                                    <div className="relative flex gap-3">
                                        <div className={`w-9 h-9 flex items-center justify-center shrink-0 rounded-full ${
                                            isLight
                                            ? 'bg-orange-500 bg-opacity-10 text-orange-500'
                                            : 'bg-orange-500 bg-opacity-15 text-orange-400'
                                        }`}>
                                            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
                                                <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                                <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                                <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                                <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.4"/>
                                            </svg>
                                        </div>
                                        <div className="flex-1 pt-[2px]">
                                            <h3 className="text-[14px] font-semibold tracking-[-0.015em] mb-1 flex items-center gap-2">
                                                <span className={isLight ? 'text-slate-900' : 'text-slate-100'}>Modes</span>
                                                <span className={`text-[10px] font-medium px-1.5 py-[1px] rounded-[5px] ${
                                                    isLight
                                                    ? 'bg-orange-50 text-orange-600 border border-orange-100/50'
                                                    : 'bg-orange-500/10 text-orange-400'
                                                }`}>
                                                    Beta
                                                </span>
                                            </h3>
                                            <p className={`text-[12px] leading-[1.35] mb-3.5 tracking-[-0.01em] ${
                                                isLight ? 'text-slate-500' : 'text-slate-400'
                                            }`}>
                                                Custom instructions and formulas designed for different meeting contexts.
                                            </p>
                                            <div className="flex justify-end gap-1.5 isolate">
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        setShowModesOnboarding(false); 
                                                        localStorage.setItem('refract_seen_modes_onboarding_v5', 'true'); 
                                                        window.electronAPI?.onboardingSetFlag?.('seenModesOnboarding', true).catch(() => {});
                                                    }}
                                                    className={`text-[12px] font-medium px-3.5 py-[6px] rounded-full transition-all active:scale-95 ${
                                                        isLight
                                                        ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/60'
                                                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/10'
                                                    }`}
                                                >
                                                    Dismiss
                                                </button>
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        onOpenModes?.(); 
                                                        setShowModesOnboarding(false); 
                                                        localStorage.setItem('refract_seen_modes_onboarding_v5', 'true'); 
                                                        window.electronAPI?.onboardingSetFlag?.('seenModesOnboarding', true).catch(() => {});
                                                    }}
                                                    className={`text-[12px] font-medium px-4 py-[6px] rounded-full transition-all active:scale-95 shadow-sm ${
                                                        isLight
                                                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                                                        : 'bg-slate-100 text-slate-900 hover:bg-white'
                                                    }`}
                                                >
                                                    Try it out
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <button
                        onClick={() => setShowAssistantsPicker(true)}
                        title="Assistants"
                        className="refract-topbar-button flex items-center justify-center text-text-secondary"
                    >
                        <Sparkles size={18} />
                    </button>
                    <SystemHealthPopover onOpenSettings={onOpenSettings} />
                    <button
                        onClick={() => setTutorialOpen(true)}
                        title="Tutorial — replay the guided tour"
                        aria-label="Replay tutorial"
                        className="refract-topbar-button flex items-center justify-center text-text-secondary"
                    >
                        <GraduationCap size={18} />
                    </button>
                    <button
                        onClick={() => {
                            onOpenSettings();
                        }}
                        title="Settings"
                        className="refract-topbar-button flex items-center justify-center text-text-secondary"
                    >
                        <Settings size={18} />
                    </button>
                    {!isMac && <WindowControls />}
                </div>
            </header>

            <div className="relative flex-1 flex flex-col overflow-hidden">
                {!isDetectable && (
                    <div className="launcher-stealth-halo absolute inset-0 pointer-events-none z-[100]" aria-hidden="true" />
                )}
                <AnimatePresence mode="wait">
                    {selectedMeeting ? (
                        <motion.div
                            key="details"
                            className="flex-1 overflow-hidden"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <MeetingDetails
                                meeting={selectedMeeting}
                                onBack={handleBack}
                                onOpenSettings={onOpenSettings}
                            />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="launcher"
                            className="flex-1 flex flex-col overflow-hidden"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >

                            {/* Área Principal - Topo Fixo, Fundo Rolável */}
                            {/* Top Section é agora effectively static due to parent flex col */}

                            {/* Seção Superior: Fundo Cinza (Rola com o conteúdo) */}
                            <section className="launcher-hero px-8 pt-7 pb-8 border-b shrink-0">
                                <div className="launcher-workspace max-w-[1080px] mx-auto space-y-6">
                                    {/* 1.5. Cabeçalho Hero (Título + Controles + CTA) */}
                                    <div className="launcher-workspace-header flex items-center justify-between">
                                        <div className="launcher-workspace-controls flex items-center gap-3">
                                            <div>
                                                <p className="launcher-workspace-kicker text-[11px] font-medium text-text-tertiary mb-1">Workspace</p>
                                                <h1 className="launcher-workspace-title text-[24px] leading-none font-semibold text-text-primary">My Refract</h1>
                                            </div>

                                            {/* Botão Atualizar */}
                                            <button
                                                onClick={handleRefresh}
                                                disabled={isRefreshing}
                                                className={`p-1.5 text-text-tertiary hover:text-text-primary rounded-full transition-colors ${isRefreshing ? 'animate-spin text-blue-400' : ''} ${isLight ? 'hover:bg-black/8' : 'hover:bg-white/8'}`}
                                                title="Refresh State"
                                            >
                                                <RefreshCw size={15} />
                                            </button>

                                            {/* Pill Alternar Detecção — hairline silencioso */}
                                            <button
                                                onClick={toggleDetectable}
                                                className={`launcher-privacy-toggle flex items-center gap-2 rounded-full pl-2.5 pr-1.5 py-[5px] transition-colors select-none ${
                                                    isLight
                                                        ? 'bg-black/[0.04] ring-1 ring-black/[0.07] hover:bg-black/[0.06]'
                                                        : 'bg-white/[0.04] ring-1 ring-white/[0.08] hover:bg-white/[0.07]'
                                                }`}
                                                title={isDetectable ? 'Visible to screen shares' : 'Hidden from screen shares'}
                                            >
                                                {isDetectable ? (
                                                    <Ghost
                                                        size={13}
                                                        strokeWidth={2}
                                                        className="text-text-tertiary transition-colors"
                                                    />
                                                ) : (
                                                    <svg
                                                        width="13"
                                                        height="13"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="transition-colors"
                                                    >
                                                        <path
                                                            d="M12 2C7.58172 2 4 5.58172 4 10V22L7 19L9.5 21.5L12 19L14.5 21.5L17 19L20 22V10C20 5.58172 16.4183 2 12 2Z"
                                                            fill={isLight ? '#7c3aed' : '#c4b5fd'}
                                                        />
                                                        <circle cx="9" cy="10" r="1.5" fill={isLight ? 'white' : 'black'} />
                                                        <circle cx="15" cy="10" r="1.5" fill={isLight ? 'white' : 'black'} />
                                                    </svg>
                                                )}
                                                <span className={`text-[12px] font-medium transition-colors ${!isDetectable ? 'text-text-primary' : 'text-text-secondary'}`}>
                                                    {isDetectable ? "Detectable" : "Undetectable"}
                                                </span>
                                                <span
                                                    className={`relative w-[30px] h-[17px] rounded-full transition-colors duration-300 ${
                                                        !isDetectable ? 'bg-violet-500' : isLight ? 'bg-black/15' : 'bg-white/15'
                                                    }`}
                                                >
                                                    <span className={`absolute top-[2px] w-[13px] h-[13px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-all duration-300 ${!isDetectable ? 'left-[15px]' : 'left-[2px]'}`} />
                                                </span>
                                            </button>

                                             {/* Pill Novidades */}
                                             {launchCount < 10 && (
                                                 <button
                                                     onClick={() => onOpenSettings('about')}
                                                     className={`flex items-center gap-1 rounded-full px-3 py-[5px] transition-all duration-200 cursor-pointer active:scale-95 text-[12px] font-medium shrink-0 select-none group ${
                                                         isLight
                                                             ? 'text-emerald-700 bg-emerald-500/[0.06] ring-1 ring-emerald-500/15 hover:bg-emerald-500/10'
                                                             : 'text-emerald-300/90 bg-emerald-400/[0.07] ring-1 ring-emerald-400/15 hover:bg-emerald-400/[0.12]'
                                                     }`}
                                                 >
                                                     <span>What's New in 2.8</span>
                                                     <ArrowUpRight size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                                                 </button>
                                             )}
                                         </div>
                                         {/* Centro: Pill de Status do Ollama Pull (flex-1 para centralizar uniformemente) */}
                                        <div className="flex-1 flex justify-center mx-4">
                                            <AnimatePresence>
                                                {ollamaPullStatus !== 'idle' && (
                                                    <motion.div
                                                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                        exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                                        transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                                        className={`flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl ${isLight ? 'bg-bg-elevated border border-border-muted shadow-[0_4px_16px_rgba(0,0,0,0.1)]' : 'bg-bg-elevated/80 border border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.3)]'}`}
                                                    >
                                                        {ollamaPullStatus === 'downloading' ? (
                                                            <DownloadCloud size={14} className="text-blue-400 animate-pulse shrink-0" />
                                                        ) : ollamaPullStatus === 'complete' ? (
                                                            <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                                                        ) : (
                                                            <AlertCircle size={14} className="text-red-400 shrink-0" />
                                                        )}
                                                        <div className="flex flex-col">
                                                            <span className="text-[11px] font-medium text-text-secondary whitespace-nowrap">
                                                                {ollamaPullStatus === 'downloading' ? `Setting up AI memory... ${ollamaPullPercent}%` : ollamaPullMessage}
                                                            </span>
                                                            {ollamaPullStatus === 'downloading' && (
                                                                <div className="w-full h-[3px] bg-white/10 rounded-full mt-1 overflow-hidden">
                                                                    <div
                                                                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                                                        style={{ width: `${ollamaPullPercent}%` }}
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>

                                         {/* CTA principal — sólido, profundidade discreta, sem gloss */}
                                        <motion.button
                                            onClick={() => {
                                                if (isMeetingActive) {
                                                    // inactive=true: overlay aparece no topo mas não ativa
                                                    // o app Refract nem rouba o foco do SO — preserva sigilo.
                                                    // setWindowMode (não showWindow) é necessário porque
                                                    // clique no logo define currentWindowMode='launcher', então showWindow()
                                                    // re-mostraria o launcher em vez de trocar para o overlay.
                                                    window.electronAPI?.setWindowMode?.('overlay', true);
                                                    analytics.trackCommandExecuted('resume_meeting_from_launcher');
                                                } else {
                                                    onStartMeeting();
                                                    analytics.trackCommandExecuted('start_refract_cta');
                                                }
                                            }}
                                            whileHover={{ scale: 1.015 }}
                                            whileTap={{ scale: 0.985 }}
                                            transition={{ duration: 0.15, ease: 'easeOut' }}
                                            className="launcher-primary-action group relative overflow-hidden text-white pl-4 pr-5 h-[38px] rounded-full font-medium flex items-center justify-center gap-2.5 shrink-0"
                                            data-active={isMeetingActive}
                                        >
                                            {/* Sheen de hover — luz suspensa, quase imperceptível */}
                                            <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                                            {/* Button content — crossfade entre idle and meeting states */}
                                            <div className="relative z-10 flex items-center gap-2.5">
                                                <AnimatePresence mode="wait" initial={false}>
                                                    {isMeetingActive ? (
                                                        <motion.div
                                                            key="meeting"
                                                            initial={{ opacity: 0, y: 5 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -5 }}
                                                            transition={{ duration: 0.2, ease: 'easeOut' }}
                                                            className="flex items-center gap-2.5"
                                                        >
                                                            {/* Ping live-indicator dot */}
                                                            <span className="relative flex h-[7px] w-[7px] shrink-0">
                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
                                                                <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-white" />
                                                            </span>
                                                            <span className="text-[14px] leading-none tracking-[-0.01em]">Meeting ongoing</span>
                                                        </motion.div>
                                                    ) : (
                                                        <motion.div
                                                            key="start"
                                                            initial={{ opacity: 0, y: 5 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -5 }}
                                                            transition={{ duration: 0.2, ease: 'easeOut' }}
                                                            className="flex items-center gap-2.5"
                                                        >
                                                            <RefractLogoMark size={15} className="opacity-95" />
                                                            <span className="text-[14px] leading-none tracking-[-0.01em]">Start Refract</span>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        </motion.button>

                                        {/* Practice — secundário silencioso: ghost com hairline */}
                                        <motion.button
                                            onClick={() => {
                                                window.electronAPI?.replicaOpenWindow?.();
                                                analytics.trackCommandExecuted?.('open_replica_coach');
                                            }}
                                            whileHover={{ scale: 1.015 }}
                                            whileTap={{ scale: 0.985 }}
                                            transition={{ duration: 0.15, ease: 'easeOut' }}
                                            title="Practice Interview Coach"
                                            className={`launcher-secondary-action h-[38px] px-4 rounded-full font-medium flex items-center justify-center gap-2 shrink-0 transition-colors ${
                                                isLight
                                                    ? 'text-slate-700 bg-black/[0.04] ring-1 ring-black/[0.08] hover:bg-black/[0.07]'
                                                    : 'text-white/85 bg-white/[0.05] ring-1 ring-white/[0.1] hover:bg-white/[0.09]'
                                            }`}
                                        >
                                            <Target size={14} className="opacity-70" />
                                            <span className="text-[13.5px] leading-none tracking-[-0.01em]">Practice</span>
                                        </motion.button>
                                    </div>

                                    {/* 2. Hero Section Cards */}
                                    <div className="launcher-feature-grid grid grid-cols-1 md:grid-cols-3 gap-4 h-[206px]">
                                        {/* Default Intro — refract support & upcoming features.
                                            Calendar "Up Next" lives in Settings → Calendar, not here. */}
                                        <div className="md:col-span-2 h-full">
                                            <FeatureSpotlight />
                                        </div>



                                        {/* Cartão do calendário — mesma linguagem do Spotlight: superfície escura, hairline, aurora violeta */}
                                        <div className="calendar-spotlight md:col-span-1 rounded-xl overflow-hidden relative group flex flex-col border border-white/[0.07]" style={{ isolation: 'isolate' }}>
                                            {/* Hairline superior */}
                                            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.14] to-transparent pointer-events-none" />
                                            <div
                                                className="absolute inset-0 pointer-events-none transition-opacity duration-700"
                                                style={{
                                                    background: 'linear-gradient(145deg, transparent 30%, rgba(139,92,246,0.05) 70%, rgba(139,92,246,0.12) 100%)',
                                                    opacity: isCalendarConnected ? 1 : 0.45,
                                                }}
                                            />

                                            {/* Content Layer */}
                                            {isCalendarConnected ? (() => {
                                                const eventCount = upcomingMeetings.length;
                                                const summaryLabel = eventCount === 0
                                                    ? 'No upcoming events'
                                                    : `${eventCount} upcoming event${eventCount === 1 ? '' : 's'}`;

                                                const formatTimeLabel = (startTime: string) => {
                                                    const start = new Date(startTime);
                                                    const now = new Date();
                                                    const tomorrow = new Date(now.getTime() + 86400000);
                                                    const isToday = start.toDateString() === now.toDateString();
                                                    const isTomorrow = start.toDateString() === tomorrow.toDateString();
                                                    const t = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                                                    return isToday ? `Today at ${t}`
                                                        : isTomorrow ? `Tomorrow at ${t}`
                                                        : `${start.toLocaleDateString([], { weekday: 'short' })} at ${t}`;
                                                };

                                                // Deterministic avatar palette de email/name
                                                const avatarPalette = [
                                                    'bg-rose-300/90 text-rose-900',
                                                    'bg-amber-200/90 text-amber-900',
                                                    'bg-emerald-200/90 text-emerald-900',
                                                    'bg-sky-200/90 text-sky-900',
                                                    'bg-violet-200/90 text-violet-900',
                                                    'bg-teal-200/90 text-teal-900',
                                                ];
                                                const initialsFor = (a: { email: string; name?: string }) => {
                                                    const src = (a.name || a.email).trim();
                                                    const parts = src.split(/[\s._-]+/).filter(Boolean);
                                                    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
                                                    return src.slice(0, 2).toUpperCase();
                                                };
                                                const colorFor = (key: string) => {
                                                    let h = 0;
                                                    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
                                                    return avatarPalette[Math.abs(h) % avatarPalette.length];
                                                };

                                                const visibleAttendees = (nextMeeting?.attendees || []).slice(0, 3);
                                                const remaining = Math.max(0, (nextMeeting?.attendees?.length || 0) - visibleAttendees.length);
                                                const peekMeetings = visibleMeetings.slice(1); // para cima to 2 atrás o front card

                                                return (
                                                    <div className="relative z-10 w-full flex flex-col h-full">
                                                        {/* Heading block — top-centered */}
                                                        <div className="px-4 pt-5 text-center">
                                                            <h3 className="text-[20px] font-semibold text-white leading-[1.15] tracking-[-0.01em]">Calendar linked</h3>
                                                            <p className="text-[13px] text-white/55 font-medium mt-0.5 tabular-nums">{summaryLabel}</p>
                                                        </div>

                                                        {/* Calendar Connected pill — translucent violet glass com verifica */}
                                                        <div className="px-4 mt-3 flex justify-center">
                                                            <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/20 ring-1 ring-violet-300/25 backdrop-blur-md px-2 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_18px_-6px_rgba(99,102,241,0.45)]">
                                                                <span className="w-5 h-5 rounded-full bg-violet-500 ring-1 ring-violet-300/40 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                                                                    <Check size={11} strokeWidth={3} className="text-white" />
                                                                </span>
                                                                <span className="text-[12px] font-semibold text-white/95 pr-1.5 tracking-[-0.005em]">Calendar Connected</span>
                                                            </div>
                                                        </div>

                                                        {/* Real stacked peek de upcoming meetings — front card é fcompleto 1–2 atrás mostrar apenas titles */}
                                                        {nextMeeting && (
                                                            <div className="mt-auto px-2 pb-0">
                                                                <div className="relative">
                                                                    {/* Real peek cards atrás — mostrar actual subsequente meetings */}
                                                                    {peekMeetings[1] && (
                                                                        <div
                                                                            className="absolute -top-3 left-3 right-3 h-7 rounded-t-[14px] bg-white/[0.06] ring-1 ring-white/[0.06] backdrop-blur-sm overflow-hidden"
                                                                            title={peekMeetings[1].title}
                                                                        >
                                                                            <div className="px-3 pt-1 text-[10.5px] font-medium text-white/55 line-clamp-1 tracking-[-0.005em]">
                                                                                {peekMeetings[1].title}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {peekMeetings[0] && (
                                                                        <div
                                                                            className="absolute -top-1.5 left-1.5 right-1.5 h-7 rounded-t-[14px] bg-white/[0.09] ring-1 ring-white/[0.08] backdrop-blur-sm overflow-hidden"
                                                                            title={peekMeetings[0].title}
                                                                        >
                                                                            <div className="px-3 pt-1 text-[11px] font-medium text-white/70 line-clamp-1 tracking-[-0.005em]">
                                                                                {peekMeetings[0].title}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* Front card — exibir oapenas não click */}
                                                                    <div
                                                                        className="relative w-full text-left rounded-[14px] bg-white/[0.07] ring-1 ring-white/[0.1] backdrop-blur-md px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_24px_-12px_rgba(0,0,0,0.55)]"
                                                                    >
                                                                        <div className="flex items-start justify-between gap-2">
                                                                            <h4 className="text-[15px] font-semibold text-white leading-tight tracking-[-0.01em] line-clamp-1">
                                                                                {nextMeeting.title}
                                                                            </h4>
                                                                            {moreMeetingsCount > 0 && (
                                                                                <span className="shrink-0 inline-flex items-center rounded-full bg-white/10 ring-1 ring-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white/80 tabular-nums">
                                                                                    +{moreMeetingsCount} more
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="mt-1.5 flex items-center justify-between gap-2">
                                                                            <span className="text-[11.5px] text-cyan-200/85 font-medium tabular-nums">
                                                                                {formatTimeLabel(nextMeeting.startTime)}
                                                                            </span>
                                                                            {visibleAttendees.length > 0 && (
                                                                                <div className="flex -space-x-1.5">
                                                                                    {visibleAttendees.map((a: { email: string; name?: string }) => (
                                                                                        <span
                                                                                            key={a.email}
                                                                                            title={a.name || a.email}
                                                                                            className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full ring-[1.5px] ring-[#121214] text-[8.5px] font-bold ${colorFor(a.email)}`}
                                                                                        >
                                                                                            {initialsFor(a)}
                                                                                        </span>
                                                                                    ))}
                                                                                    {remaining > 0 && (
                                                                                        <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full ring-[1.5px] ring-[#121214] bg-white/15 text-[8.5px] font-bold text-white/85 tabular-nums">
                                                                                            +{remaining}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })() : (
                                                <div className="calendar-empty-state relative z-10 w-full flex flex-col items-center justify-center h-full px-6 text-center">
                                                    <div className="calendar-empty-icon" aria-hidden="true">
                                                        <Calendar size={18} strokeWidth={1.8} />
                                                    </div>
                                                    <h3 className="calendar-empty-title text-[19px] leading-tight mt-3 mb-1 tracking-[-0.02em]">
                                                        <span className="block font-semibold">Your day, already prepared</span>
                                                    </h3>
                                                    <p className="calendar-empty-copy text-[12px] leading-relaxed mb-4 max-w-[230px]">
                                                        Connect your calendar to see what is next and enter meetings in one click.
                                                    </p>

                                                    <ConnectCalendarButton
                                                        className="-translate-x-0.5"
                                                        onConnect={() => setIsCalendarConnected(true)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* BOTTOM SECTION: Black Background (Scrollable content) */}
                            <main className="meeting-history flex-1 overflow-y-auto custom-scrollbar">
                                <section className="launcher-history-section px-8 py-7 min-h-full">
                                    <div className="launcher-history-inner max-w-[1080px] mx-auto space-y-8">

                                        <div className="launcher-history-header flex items-end justify-between gap-6">
                                            <div>
                                                <div className="launcher-history-kicker flex items-center gap-2 mb-1.5">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                                                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">Memory</span>
                                                </div>
                                                <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.025em] text-text-primary">
                                                    Recent conversations
                                                </h2>
                                                <p className="text-[12.5px] text-text-tertiary mt-1">
                                                    Searchable context from every session.
                                                </p>
                                            </div>

                                            {meetings.length > 0 && (
                                                <div className="launcher-week-side">
                                                    {/* Sparkline: minutos capturados por dia nos últimos 7 dias.
                                                        Derivado do histórico já carregado — sem telemetria nova. */}
                                                    <div
                                                        className="launcher-sparkline"
                                                        role="img"
                                                        aria-label="Minutes captured per day over the last seven days"
                                                        title="Minutes captured per day · last 7 days"
                                                    >
                                                        {weekStats.perDay.map((mins, i) => {
                                                            const peak = Math.max(...weekStats.perDay, 1);
                                                            const pct = mins === 0 ? 5 : Math.max(12, Math.round((mins / peak) * 100));
                                                            return (
                                                                <span
                                                                    key={i}
                                                                    className={`launcher-sparkline-bar${i === 6 ? ' is-today' : ''}`}
                                                                    style={{ height: `${pct}%` }}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="launcher-week-summary" aria-label="Last seven days">
                                                        <span className="launcher-week-label">Last 7 days</span>
                                                        <span className="launcher-week-stat"><strong>{weekStats.count}</strong> sessions</span>
                                                        <span className="launcher-week-divider" />
                                                        <span className="launcher-week-stat"><strong>{formatMinutes(weekStats.minutes)}</strong> captured</span>
                                                        <span className="launcher-week-divider" />
                                                        <span className="launcher-week-stat"><strong>{weekStats.actions}</strong> actions</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Iterating Date Groups */}
                                        {sortedGroups.map((label) => (
                                            <section key={label} className="meeting-history-group">
                                                <h3 className="meeting-history-label">{label}</h3>
                                                <div className="space-y-1">
                                                    {groupedMeetings[label].map((m) => (
                                                        <motion.div
                                                            key={m.id}
                                                            layoutId={`meeting-${m.id}`}
                                                            className="meeting-row group relative flex items-center justify-between px-3.5 py-2 bg-transparent"
                                                            onClick={() => handleOpenMeeting(m)}
                                                        >
                                                            <div className={`font-medium text-[14px] max-w-[60%] truncate ${m.title === 'Processing...' ? 'text-blue-400 italic animate-pulse' : 'text-text-primary'}`}>
                                                                {m.title}
                                                            </div>

                                                            {/* Time & Duration Section */}
                                                            <div className="flex items-center gap-4">
                                                                {m.title === 'Processing...' ? (
                                                                    <div className="flex items-center gap-2 transition-all duration-200 ease-out group-hover:opacity-0 group-hover:translate-x-2 delayed-hover-exit">
                                                                        <RefreshCw size={12} className="animate-spin text-blue-500" />
                                                                        <span className="text-xs text-blue-500 font-medium">Finalizing...</span>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <span className="relative z-10 bg-bg-elevated text-text-secondary text-[9px] px-1.5 py-0.5 rounded-full font-medium min-w-[35px] text-center tracking-wide">
                                                                            {formatDurationPill(m.duration)}
                                                                        </span>

                                                                        {/* Time Text (Deve fade fora em hover) */}
                                                                        <span className="text-[13px] text-text-secondary font-medium min-w-[60px] text-right transition-all duration-200 ease-out group-hover:opacity-0 group-hover:translate-x-2 delayed-hover-exit">
                                                                            {formatTime(m.date)}
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </div>

                                                            {/* Contexto Menu Acionar (Slides em em hover) */}
                                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 translate-x-4 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0">
                                                                <button
                                                                    className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setActiveMenuId(activeMenuId === m.id ? null : m.id);
                                                                    }}
                                                                >
                                                                    <MoreHorizontal size={16} />
                                                                </button>
                                                            </div>

                                                            {/* Dropdown Menu */}
                                                            <AnimatePresence>
                                                                {activeMenuId === m.id && (
                                                                    <motion.div
                                                                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                                        exit={{ opacity: 0, scale: 0.95, y: 5 }}
                                                                        transition={{ duration: 0.1 }}
                                                                        className={`absolute right-0 top-full mt-1 w-[90px] backdrop-blur-xl rounded-lg shadow-2xl z-50 overflow-hidden border ${isLight ? 'bg-bg-elevated border-border-muted shadow-[0_8px_24px_rgba(0,0,0,0.12)]' : 'bg-[#1E1E1E]/80 border-white/10'}`}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        onMouseEnter={() => setMenuEntered(true)}
                                                                        onMouseLeave={() => {
                                                                            if (menuEntered) setActiveMenuId(null);
                                                                        }}
                                                                    >
                                                                        <div className="p-1 flex flex-col gap-0.5">
                                                                            <button
                                                                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary rounded-lg transition-colors text-left ${isLight ? 'hover:bg-bg-item-surface' : 'hover:bg-white/10'}`}
                                                                                onClick={async () => {
                                                                                    setActiveMenuId(null);
                                                                                    analytics.trackPdfExported();
                                                                                    // Busca completo details se needed
                                                                                    if (window.electronAPI && window.electronAPI.getMeetingDetails) {
                                                                                        try {
                                                                                            const fullMeeting = await window.electronAPI.getMeetingDetails(m.id);
                                                                                            if (fullMeeting) {
                                                                                                generateMeetingPDF(fullMeeting);
                                                                                            } else {
                                                                                                generateMeetingPDF(m);
                                                                                            }
                                                                                        } catch (e) {
                                                                                            console.error("Failed to fetch details for PDF", e);
                                                                                            generateMeetingPDF(m);
                                                                                        }
                                                                                    } else {
                                                                                        generateMeetingPDF(m);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <Download size={13} />
                                                                                Export
                                                                            </button>
                                                                            <button
                                                                                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-lg transition-colors text-left"
                                                                                onClick={async () => {
                                                                                    if (window.electronAPI && window.electronAPI.deleteMeeting) {
                                                                                        const success = await window.electronAPI.deleteMeeting(m.id);
                                                                                        if (success) {
                                                                                            // Optimistic atualiza ou refetch
                                                                                            setMeetings(prev => prev.filter(meeting => meeting.id !== m.id));
                                                                                        }
                                                                                    }
                                                                                    setActiveMenuId(null);
                                                                                }}
                                                                            >
                                                                                <Trash2 size={13} />
                                                                                Delete
                                                                            </button>
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </motion.div>
                                                    ))}
                                                </div>
                                            </section>
                                        ))}

                                        {meetings.length === 0 && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
                                                className="launcher-empty-state"
                                            >
                                                <div className="launcher-empty-visual" aria-hidden="true">
                                                    <span className="launcher-empty-ring launcher-empty-ring--one" />
                                                    <span className="launcher-empty-ring launcher-empty-ring--two" />
                                                    <div className="launcher-empty-core">
                                                        <Sparkles size={20} strokeWidth={1.75} />
                                                    </div>
                                                </div>

                                                <div className="launcher-empty-content">
                                                    <span className="launcher-empty-eyebrow">Your private meeting memory</span>
                                                    <h3>Start with a conversation</h3>
                                                    <p>
                                                        Refract turns live conversations into searchable notes, clear answers, and follow-ups — quietly in the background.
                                                    </p>
                                                    <div className="launcher-empty-actions">
                                                        <button
                                                            type="button"
                                                            onClick={onStartMeeting}
                                                            className="launcher-empty-primary"
                                                        >
                                                            <RefractLogoMark size={14} />
                                                            Start a session
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => onOpenSettings('calendar')}
                                                            className="launcher-empty-secondary"
                                                        >
                                                            <Calendar size={14} />
                                                            Connect calendar
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="launcher-empty-capabilities" aria-label="Refract capabilities">
                                                    <div>
                                                        <span className="launcher-capability-icon"><Clock size={14} /></span>
                                                        <span><strong>Live context</strong><small>Understands the conversation as it happens</small></span>
                                                    </div>
                                                    <div>
                                                        <span className="launcher-capability-icon"><Search size={14} /></span>
                                                        <span><strong>Instant answers</strong><small>Ask across meetings, notes, and your profile</small></span>
                                                    </div>
                                                    <div>
                                                        <span className="launcher-capability-icon"><Check size={14} /></span>
                                                        <span><strong>Clean follow-ups</strong><small>Decisions and next steps, ready when you are</small></span>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}

                                    </div>
                                </section>
                            </main>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>



            {/* Notification Toast - Liquid Glass (macOS 26 Tahoe Concept) */}
            <AnimatePresence>
                {showNotification && (
                    <motion.div
                        initial={{ x: 300, opacity: 0, scale: 0.9 }}
                        animate={{ x: 0, opacity: 1, scale: 1 }}
                        exit={{ x: 300, opacity: 0, scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 350, damping: 30, mass: 1 }}
                        className={`fixed bottom-10 right-10 z-[2000] flex items-center gap-4 pl-4 pr-6 py-3.5 rounded-[18px] backdrop-blur-xl saturate-[180%] ring-1 ring-black/10 ${isLight ? 'bg-bg-elevated/90 border border-border-muted shadow-[0_8px_32px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.9)]' : 'bg-[#2A2A2E]/40 border border-white/10 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(255,255,255,0.05)]'}`}
                    >
                        {/* Liquid Icon Orb */}
                        <div className="relative flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-b from-blue-400/20 to-blue-600/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] border border-white/5">
                            <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-md" />
                            <RefreshCw size={15} className="text-blue-300 animate-[spin_2s_linear_infinite] drop-shadow-[0_0_5px_rgba(59,130,246,0.6)]" />
                        </div>

                        {/* Text Content */}
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[14px] font-semibold text-text-primary leading-none tracking-tight">Refreshed</span>
                            <span className="text-[11px] text-text-tertiary font-medium leading-none tracking-wide">Synced with calendar</span>
                        </div>

                        {/* Specular Highlight Overlay */}
                        <div className="absolute inset-0 rounded-[18px] bg-gradient-to-tr from-white/5 via-transparent to-transparent pointer-events-none" />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Global Chat Overlay */}
            <GlobalChatOverlay
                isOpen={isGlobalChatOpen}
                onClose={() => {
                    setIsGlobalChatOpen(false);
                    setSubmittedGlobalQuery('');
                }}
                initialQuery={submittedGlobalQuery}
            />

            {/* Assistants Picker Modal */}
            <AnimatePresence>
                {showAssistantsPicker && (
                    <AssistantsPicker
                        isPremium={isPremium}
                        activeModeId={activeModeId}
                        onSelectMode={(templateType) => {
                            onSelectAssistant?.(templateType);
                            setShowAssistantsPicker(false);
                        }}
                        onClose={() => setShowAssistantsPicker(false)}
                    />
                )}
            </AnimatePresence>

            {/* Tour guiado — primeiro uso + reprise pelo topbar */}
            <InteractiveTutorial open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
        </div >
    );
};

export default Launcher;
