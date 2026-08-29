/**
 * =============================================================================
 * App.tsx — COMPONENTE RAIZ DA APLICAÇÃO REACT
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Este é o componente raiz que orquestra TODA a interface do Refract.
 * Ele gerencia qual janela/modo está ativo e renderiza o componente correto.
 * 
 * JANELAS SUPORTADAS (uma janela HTML, múltiplos modos via query string):
 * 
 * 1. LAUNCHER (padrão):
 *    - Janela principal que mostra reuniões recentes, configurações
 *    - Acesso a: calendar, perfil, modos, pesquisa
 *    - Ponto de entrada do app
 * 
 * 2. OVERLAY:
 *    - Sobreposição transparente durante reuniões
 *    - Mostra transcrição ao vivo + respostas de IA
 *    - Fica por cima de Zoom/Meet/Teams
 * 
 * 3. SETTINGS:
 *    - Janela de configurações (pode abrir em janela separada)
 *    - Tabs: Geral, Provedores IA, STT, Modos, etc.
 * 
 * 4. MODEL-SELECTOR:
 *    - Dropdown para trocar modelo LLM ativo
 *    - Posicionado próximo ao botão de seleção
 * 
 * 5. CROPPER:
 *    - Janela de seleção de área para captura de tela
 *    - Tela inteira, modo recorte
 * 
 * SISTEMAS GERenciADOS POR ESTE COMPONENTE:
 * - Tema (claro/escuro) via useResolvedTheme()
 * - Atalhos de teclado via useShortcuts()
 * - Trial/assinatura e banners de promoção
 * - Onboarding (permissões, modos, perfil)
 * - Estado de atualização automática
 * - Opacidade do overlay
 * - Tema da interface de reunião
 * - Status do Ollama (download de modelos)
 * - Campanhas de anúncios (premium)
 * 
 * ARQUITETURA:
 * Cada "janela" é a MESMA página HTML carregada com ?window=<nome>
 * O App.tsx lê a query string e renderiza APENAS o componente adequado.
 * Isso permite que cada janela tenha seu próprio BrowserWindow no Electron.
 * =============================================================================
 */
import React, { useCallback, useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ToastProvider, ToastViewport } from "./components/ui/toast"
import RefractInterface from "./components/RefractInterface"
import SettingsPopup from "./components/SettingsPopup" // Mantido para janela legado/específica se necessário
import Launcher from "./components/Launcher"
import ModelSelectorWindow from "./components/ModelSelectorWindow"
import SettingsOverlay from "./components/SettingsOverlay"
import StartupSequence from "./components/StartupSequence"
import { AnimatePresence, motion } from "framer-motion"
import UpdateBanner from "./components/UpdateBanner"
import { SupportToaster } from "./components/SupportToaster"
import { RefractQuotaBanner } from "./components/RefractQuotaBanner"
import { FreeTrialBanner }      from "./components/trial/FreeTrialBanner"
import { FreeTrialModal }       from "./components/trial/FreeTrialModal"
import { TrialPromoToaster }    from "./components/trial/TrialPromoToaster"
import { PermissionsToaster }   from "./components/onboarding/PermissionsToaster"
import { AlertCircle, RefreshCw } from "lucide-react"
import { clampOverlayOpacity, OVERLAY_OPACITY_DEFAULT, getDefaultOverlayOpacity } from "./lib/overlayAppearance"
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from './lib/meetingInterfaceTheme'
import { isMac } from "./utils/platformUtils"
import { trackAppOpen, markToasterAsShown } from "./lib/toasterGating"
import {
  JDAwarenessToaster,
  ProfileFeatureToaster,
  PremiumPromoToaster,
  RemoteCampaignToaster,
  PremiumUpgradeModal,
  RefractApiPromoToaster,
  MaxUltraUpgradeToaster,
  useAdCampaigns
} from './premium'
import { analytics } from "./lib/analytics/analytics.service"
import { ErrorBoundary } from "./components/ErrorBoundary"
import ModesSettings from "./components/settings/ModesSettings"
import { ProfileIntelligenceSettings } from "./components/ProfileIntelligenceSettings"
import { CodeOverlay } from "./components/dev/CodeOverlay"
import { DevDashboard } from "./components/dev/DevDashboard"
import { OpencodePanel } from "./components/dev/OpencodePanel"
import { LanguageLearningOverlay } from "./components/LanguageLearningOverlay"
const ReplicaOverlay = React.lazy(() => import("./components/ReplicaOverlay"))

const queryClient = new QueryClient()
const CropperWindow = React.lazy(() => import('./components/Cropper'))

const App: React.FC = () => {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isLauncherWindow = new URLSearchParams(window.location.search).get('window') === 'launcher';
  const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';
  const isModelSelectorWindow = new URLSearchParams(window.location.search).get('window') === 'model-selector';
  const isCropperWindow = new URLSearchParams(window.location.search).get('window') === 'cropper';
  const isLanguageLearningWindow = new URLSearchParams(window.location.search).get('window') === 'language-learning';
  const isReplicaWindow = new URLSearchParams(window.location.search).get('window') === 'replica';

  // Padrão para launcher se não especificado (segurança em modo dev)
  const isDefault = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !isCropperWindow && !isLanguageLearningWindow && !isReplicaWindow;

  // Inicializar Analytics
  useEffect(() => {
    // Apenas inicializar se estamos na janela principal para evitar eventos duplicados de janelas auxiliares
    // Provavelmente queremos rastrear abertura do app não entry point principal.
    // Proteger a inicialização para garantir execução única por janela.
    // O serviço já gerencia inicializar único, mas vamos ser cuidadosos sobre qual janela rastreia "App Aberto".
    // Launcher é o entry principal. Overlay é o "Assistente".

    analytics.initAnalytics();

    if (isLauncherWindow || isDefault) {
      analytics.trackAppOpen();
    }

    if (isOverlayWindow) {
      analytics.trackAssistantStart();
    }

    // Cleanup / Session End
    const handleUnload = () => {
      if (isOverlayWindow) {
        analytics.trackAssistantStop();
      }
      if (isLauncherWindow || isDefault) {
        analytics.trackAppClose();
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [isLauncherWindow, isOverlayWindow, isDefault]);

  // State
  const [showStartup, setShowStartup] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string>('general');
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const openSettingsExclusive = useCallback((tab: string = 'general') => {
    setIsModesOpen(false);
    setIsProfileOpen(false);
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  }, []);
  const openProfileExclusive = useCallback(() => {
    setIsModesOpen(false);
    setIsSettingsOpen(false);
    setIsProfileOpen(true);
  }, []);
  const openModesExclusive = useCallback(() => {
    setIsProfileOpen(false);
    setIsSettingsOpen(false);
    setIsModesOpen(true);
  }, []);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [isPremiumActive, setIsPremiumActive] = useState(false);
  const [hasLoadedLicense, setHasLoadedLicense] = useState(false);
  const [planDetails, setPlanDetails] = useState<{ isPremium: boolean; plan?: string; provider?: string }>({ isPremium: false });

  // Opacidade do overlay — apenas relevante quando isOverlayWindow, mas armazenado centralmente
  // para que possa ser inicializado uma vez a partir do localStorage e atualizado via IPC.
  const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
    const stored = localStorage.getItem('refract_overlay_opacity');
    const parsed = stored ? parseFloat(stored) : NaN;
    // Tratar valor ausente ou o padrão antigo (0.65) como "não definido pelo usuário"
    const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
    return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
  });

  const [meetingInterfaceTheme, setMeetingInterfaceThemeState] = useState<MeetingInterfaceTheme>(getMeetingInterfaceTheme);

  // Estado do perfil para segmentação de anúncios
  const [hasProfile, setHasProfile] = useState(false);
  const [isLauncherMainView, setIsLauncherMainView] = useState(true);

  // Inicializar gerenciador de campanhas de anúncios
  const [appStartTime] = useState<number>(Date.now());
  const [lastMeetingEndTime, setLastMeetingEndTime] = useState<number | null>(null);
  const [isProcessingMeeting, setIsProcessingMeeting] = useState<boolean>(false);
  
  // Estado de auto-pull do Ollama
  const [ollamaPullStatus, setOllamaPullStatus] = useState<'idle' | 'downloading' | 'complete' | 'failed'>('idle');
  const [ollamaPullPercent, setOllamaPullPercent] = useState<number>(0);
  const [ollamaPullMessage, setOllamaPullMessage] = useState<string>('');

  // Estado de re-indexação
  const [incompatibleWarning, setIncompatibleWarning] = useState<{count: number; oldProvider: string; newProvider: string} | null>(null);
  // Progresso de re-indexação automática em segundo plano (disparado após atualização do modelo de embeddings).
  const [reindexProgress, setReindexProgress] = useState<{done: number; total: number} | null>(null);
  
  // Verificação de API
  const [hasRefractApi, setHasRefractApi] = useState<boolean>(false);

  // ── Toasters de onboarding / promo ───────────────────────────
  const [showPermissionsToaster, setShowPermissionsToaster] = useState(false);
  const [showTrialPromo,         setShowTrialPromo]         = useState(false);


  // ── Estado global do Trial ────────────────────────────────
  const [activeTrial, setActiveTrial] = useState<{
    expiresAt: string;
    usage: { ai: number; stt_seconds: number; search: number };
  } | null>(null);
  const [showTrialExpiredModal, setShowTrialExpiredModal] = useState(false);

  const [showCodeOverlay, setShowCodeOverlay] = useState(false);
  const [showDevDashboard, setShowDevDashboard] = useState(false);
  const [showOpencodePanel, setShowOpencodePanel] = useState(false);

  const isAppReady = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !showStartup && !isSettingsOpen && isLauncherMainView && !isProfileOpen;
  const { activeAd, dismissAd } = useAdCampaigns(
    planDetails,
    hasProfile,
    isAppReady,
    appStartTime,
    lastMeetingEndTime,
    isProcessingMeeting,
    hasRefractApi
  );



  useEffect(() => {
    // Rastrear abertura do app para gating global
    trackAppOpen();

    // Limpar dados antigos do localStorage
    localStorage.removeItem('useLegacyAudioBackend');

    const fallbackLocal = () => {
      // A animação de inicialização clássica é intencionalmente exibida em cada
      // inicialização do launcher, correspondendo ao comportamento mais antigo do app desde 93ee4a21.
    };

    if (window.electronAPI?.onboardingGetFlags) {
      window.electronAPI.onboardingGetFlags()
        .then((flags) => {
          if (flags) {
            // 1. seenStartup intencionalmente não suprime mais a animação
            // de inicialização com logo preto; o app antigo a reproduzia a cada inicialização.

            // 2. seenModesOnboarding
            if (flags.seenModesOnboarding) {
              try { localStorage.setItem('refract_seen_modes_onboarding_v5', 'true'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('refract_seen_modes_onboarding_v5') === 'true';
                if (localSeen) {
                  window.electronAPI?.onboardingSetFlag?.('seenModesOnboarding', true).catch(() => {});
                }
              } catch {}
            }

            // 3. seenProfileOnboarding
            if (flags.seenProfileOnboarding) {
              try { localStorage.setItem('refract_seen_profile_onboarding_v1', 'true'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('refract_seen_profile_onboarding_v1') === 'true';
                if (localSeen) {
                  window.electronAPI?.onboardingSetFlag?.('seenProfileOnboarding', true).catch(() => {});
                }
              } catch {}
            }

            // 4. permsShown
            if (flags.permsShown) {
              try { localStorage.setItem('refract_perms_shown_v1', '1'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('refract_perms_shown_v1') === '1';
                if (localSeen) {
                  window.electronAPI?.onboardingSetFlag?.('permsShown', true).catch(() => {});
                }
              } catch {}
            }
          } else {
            fallbackLocal();
          }
        })
        .catch(() => {
          fallbackLocal();
        });
    } else {
      fallbackLocal();
    }

    // Verificação básica de status para segmentação de campanhas
    window.electronAPI?.profileGetStatus?.().then(s => setHasProfile(s?.hasProfile || false)).catch(() => {});
    // Carregar detalhes completos do plano para entrega segmentada de anúncios (nível do plano + provedor).
    window.electronAPI?.licenseGetDetails?.()
      .then(details => {
        setPlanDetails(details ?? { isPremium: false });
        setIsPremiumActive(details?.isPremium ?? false);
        setHasLoadedLicense(true);
      })
      .catch(() => {
        // Alternativa: verificação assíncrona de premium se licenseGetDetails não estiver disponível
        const premiumCheck = window.electronAPI?.licenseCheckPremiumAsync ?? window.electronAPI?.licenseCheckPremium;
        if (premiumCheck) {
          premiumCheck().then((active: boolean) => {
            setIsPremiumActive(active);
            setPlanDetails({ isPremium: active });
            setHasLoadedLicense(true);
          }).catch(() => setHasLoadedLicense(true));
        } else {
          setHasLoadedLicense(true);
        }
      });

    // Também verificar chave da API Refract
    window.electronAPI?.getStoredCredentials?.()
      .then((creds) => setHasRefractApi(!!creds?.hasRefractKey))
      .catch(() => {});

    // ── Trial: verificar token armazenado e iniciar polling se ativo ──
    let trialPollId: ReturnType<typeof setInterval> | null = null;
    let profileWiped = false; // proteção: limpar apenas uma vez por sessão
    const checkTrial = async () => {
      try {
        const res = await window.electronAPI?.getTrialStatus?.();
        if (!res?.ok) return;
        if (res.expired) {
          setActiveTrial(null);
          // Limpar dados do perfil automaticamente na primeira vez que a expiração é detectada para que
          // dados de currículo/vaga não permaneçam não SQLite além do período do trial.
          if (!profileWiped) {
            profileWiped = true;
            window.electronAPI?.wipeTrialProfileData?.().catch(() => {});
          }
          setShowTrialExpiredModal(true);
          if (trialPollId) { clearInterval(trialPollId); trialPollId = null; }
        } else {
          setActiveTrial({
            expiresAt: res.expires_at ?? '',
            usage:     res.usage     ?? { ai: 0, stt_seconds: 0, search: 0 },
          });
        }
      } catch { /* ignore — non-critical */ }
    };
    window.electronAPI?.getLocalTrial?.().then((local: any) => {
      if (!local?.hasToken) return;
      if (local.expired) {
        // Já expirado na inicialização — limpar imediatamente e mostrar modal após breve atraso
        if (!profileWiped) {
          profileWiped = true;
          window.electronAPI?.wipeTrialProfileData?.().catch(() => {});
        }
        setTimeout(() => setShowTrialExpiredModal(true), 10_000);
        return;
      }
      checkTrial();
      trialPollId = setInterval(checkTrial, 30_000);
    }).catch(() => {});

    // Escutar evento de trial encerrado (emitido por IPC trial:end-byok)
    const removeTrialListener = window.electronAPI?.onTrialEnded?.(() => {
      setActiveTrial(null);
      setShowTrialExpiredModal(false);
    });

    // ── Toasters de onboarding ──────────────────────────────────
    if (isLauncherWindow || isDefault) {
      const permsShown = localStorage.getItem('refract_perms_shown_v1');
      if (!permsShown) {
        // Primeira inicialização — mostrar toaster de permissões
        setShowPermissionsToaster(true);
      } else {
        // Inicialização de retorno: re-verificar status TCC ao vivo. Uma concessão de permissão macOS
        // pode ser REVOGADA de um usuário que retorna — mais comumente após
        // uma atualização do app alterar a assinatura de código (macOS pode re-avaliar /
        // invalidar a concessão de Gravação de Tela ou Microfone para o novo
        // binário), ou se o usuário a revogou nas Configurações do Sistema. Nesse estado,
        // askForMediaAccess() retorna negado SEM um prompt (macOS só
        // solicita a partir de 'not-determined'), então o app falharia silenciosamente ao
        // capturar sem nada na tela. Exibir o cartão recuperável de permissões
        // (que faz link direto para o painel exato das Configurações do Sistema) em vez do
        // promo de trial quando microfone/tela está negado ou restrito. O processo principal
        // também transmite um banner negado na inicialização, mas isso é direcionado para a
        // superfície de reunião não overlay — na inicialização o usuário está não launcher,
        // então esta verificação não launcher what it ele realmente vê.
        const showTrialPromoFallback = () => {
          // Inicializações subsequentes — o promo de trial será autorregulado via TrialPromoToaster
          const trialShown = localStorage.getItem('refract_trial_promo_ts');
          if (!trialShown) {
            setShowTrialPromo(true);
          }
        };
        const maybeSurfacePermissions = window.electronAPI?.checkPermissions;
        if (maybeSurfacePermissions) {
          maybeSurfacePermissions()
            .then((p) => {
              const blocked = (s?: string) => s === 'denied' || s === 'restricted';
              if (p?.platform === 'darwin' && (blocked(p.microphone) || blocked(p.screen))) {
                setShowPermissionsToaster(true);
              } else {
                showTrialPromoFallback();
              }
            })
            .catch(showTrialPromoFallback);
        } else {
          // Não-macOS ou API indisponível — preservar o comportamento original.
          showTrialPromoFallback();
        }
      }
    }

    // Escutar eventos de abertura de aba de configurações de outras janelas (ex: botão Modos não overlay)
    const removeOpenSettingsTab = window.electronAPI?.onOpenSettingsTab?.((tab: string) => {
      openSettingsExclusive(tab);
    });

    // Escutar conclusão do processamento da reunião para acionar anúncios pós-reunião
    const removeMeetingsListener = window.electronAPI?.onMeetingsUpdated?.(() => {
      console.log("[App.tsx] Meetings updated (processing finished), starting ad delay timer");
      setIsProcessingMeeting(false);
      setLastMeetingEndTime(Date.now());
    });

    // Escutar progresso do Auto-Pull do Ollama
    let removeProgress: (() => void) | undefined;
    let removeComplete: (() => void) | undefined;
    if (window.electronAPI?.onOllamaPullProgress && window.electronAPI?.onOllamaPullComplete) {
      removeProgress = window.electronAPI.onOllamaPullProgress((data) => {
        setOllamaPullStatus('downloading');
        setOllamaPullPercent(data.percent || 0);
        setOllamaPullMessage(data.status || 'Downloading...');
      });

      removeComplete = window.electronAPI.onOllamaPullComplete(() => {
        setOllamaPullStatus('complete');
        setOllamaPullMessage('Local AI memory ready');
        setOllamaPullPercent(100);
        setTimeout(() => setOllamaPullStatus('idle'), 3000);
      });
    }

    let removeWarning: (() => void) | undefined;
    if (window.electronAPI?.onIncompatibleProviderWarning) {
      removeWarning = window.electronAPI.onIncompatibleProviderWarning((data) => {
        setIncompatibleWarning(data);
      });
    }

    let removeReindexProgress: (() => void) | undefined;
    if (window.electronAPI?.onReindexProgress) {
      removeReindexProgress = window.electronAPI.onReindexProgress((phase, data) => {
        if (phase === 'started') {
          setReindexProgress({ done: 0, total: data.count ?? 0 });
        } else if (phase === 'progress') {
          setReindexProgress({ done: data.done ?? 0, total: data.total ?? 0 });
        } else if (phase === 'complete') {
          // Na conclusão total mostrar 100%; em uma interrupção parcial (pausado por
          // reuniões contínuas ao vivo — retoma na próxima inicialização) refletir a contagem real em vez
          // de forçar 100%. De qualquer forma, mostrar brevemente e depois dispensar.
          const total = data.total ?? 0;
          const done = data.partial ? (data.done ?? 0) : total;
          setReindexProgress({ done, total });
          setTimeout(() => setReindexProgress(null), 4000);
        }
      });
    }

    // Escutar alterações de status da licença em tempo real (ativação, revogação, desativação)
    const removeLicenseListener = window.electronAPI?.onLicenseStatusChanged?.((data) => {
      setIsPremiumActive(data.isPremium);
      setPlanDetails(prev => ({ ...prev, isPremium: data.isPremium, ...(data.plan ? { plan: data.plan } : {}) }));
      setHasLoadedLicense(true);
    });

    return () => {
      if (removeMeetingsListener) removeMeetingsListener();
      if (removeProgress) removeProgress();
      if (removeComplete) removeComplete();
      if (removeWarning) removeWarning();
      if (removeReindexProgress) removeReindexProgress();
      if (removeLicenseListener) removeLicenseListener();
      if (trialPollId) clearInterval(trialPollId);
      if (removeTrialListener) removeTrialListener();
      if (removeOpenSettingsTab) removeOpenSettingsTab();
    }
  }, []);

  // Atalhos de teclado do painel de desenvolvimento
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.ctrlKey) {
        switch (e.code) {
          case 'KeyD':
            e.preventDefault();
            setShowDevDashboard(v => !v);
            break;
          case 'KeyK':
            e.preventDefault();
            setShowCodeOverlay(v => !v);
            break;
          case 'KeyO':
            e.preventDefault();
            setShowOpencodePanel(v => !v);
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Escutar alterações de opacidade do overlay — escopado apenas à janela do overlay
  useEffect(() => {
    if (!isOverlayWindow) return;
    const removeOpacityListener = window.electronAPI?.onOverlayOpacityChanged?.((opacity) => {
      setOverlayOpacity(opacity);
    });
    return () => {
      if (removeOpacityListener) removeOpacityListener();
    };
  }, [isOverlayWindow]);

  // Quando o tema muda e nenhuma preferência do usuário está armazenada, redefinir para o padrão baseado não tema
  useEffect(() => {
    if (!isOverlayWindow || !window.electronAPI?.onThemeChanged) return;
    return window.electronAPI.onThemeChanged(() => {
      const stored = localStorage.getItem('refract_overlay_opacity');
      if (!stored) {
        setOverlayOpacity(getDefaultOverlayOpacity());
      }
    });
  }, [isOverlayWindow]);

  useEffect(() => {
    // Dois canais de propagação:
    //  1. Evento `storage` — dispara dentro da mesma janela quando nossa própria
    //     setMeetingInterfaceTheme() o emite (cobre configurações → estado do App
    //     não launcher).
    //  2. Transmissão IPC `interface-theme:changed` — o processo principal transmit o novo tema
    //     para CADA BrowserWindow, incluindo o overlay. Sem isso, o
    //     overlay mantém um valor de tema desatualizado entre ciclos de ocultar/exibir, o que
    //     resultava em UI semipintada não início da próxima reunião.
    const handleStorage = () => setMeetingInterfaceThemeState(getMeetingInterfaceTheme());
    window.addEventListener('storage', handleStorage);
    const unsubscribeIpc = window.electronAPI?.onMeetingInterfaceThemeChanged?.((theme) => {
      const valid: MeetingInterfaceTheme[] = ['default', 'liquid-glass', 'modern'];
      if (valid.includes(theme as MeetingInterfaceTheme)) {
        setMeetingInterfaceThemeState(theme as MeetingInterfaceTheme);
      }
    });
    return () => {
      window.removeEventListener('storage', handleStorage);
      unsubscribeIpc?.();
    };
  }, []);


  // Handlers
  const handleReindex = async () => {
    if (window.electronAPI?.reindexIncompatibleMeetings) {
      setIncompatibleWarning(null);
      await window.electronAPI.reindexIncompatibleMeetings();
    }
  };

  const handleStartMeeting = async () => {
    try {
      localStorage.setItem('refract_last_meeting_start', Date.now().toString());
      const inputDeviceId = localStorage.getItem('preferredInputDeviceId');
      let outputDeviceId = localStorage.getItem('preferredOutputDeviceId');
    // SCK é um backend exclusivo do macOS (ScreenCaptureKit + CoreAudio Process Tap
    // ficam não módulo Rust speaker sob #[cfg(target_os = "macos")]).
    // F-003 ocultou a interface de alternância não Windows, mas a chave do localStorage pode
    // estar presente em uma máquina Windows via sincronização entre SOs ou backup restaurado —
    // rotear "sck" como outputDeviceId então passa ao módulo speaker do Windows
    // um id de dispositivo WASAPI desconhecido e silenciosamente quebra o áudio do sistema.
    // Defesa em profundidade: também exigir isMac não consumidor.
      const useExperimentalSck = isMac && localStorage.getItem('useExperimentalSckBackend') === 'true';

      // Sobrescrever ID do dispositivo de saída para forçar SCK se o modo experimental estiver habilitado
      // Padrão para CoreAudio exceto se o experimental estiver habilitado
      if (useExperimentalSck) {
        console.log("[App] Using ScreenCaptureKit backend (Experimental).");
        outputDeviceId = "sck";
      } else if (isMac) {
        console.log("[App] Using CoreAudio backend (Default).");
      }

      const meetingRetention = await window.electronAPI.getMeetingRetention?.().catch(() => 'forever');
      const result = await window.electronAPI.startMeeting({
        audio: { inputDeviceId, outputDeviceId },
        doNotPersist: meetingRetention === 'never'
      });
      if (result.success) {
        analytics.trackMeetingStarted();
        // A troca de janela acontece dentro da startMeeting() do processo principal agora (antes da
        // transmissão do estado da reunião) para evitar um flash de CTA azul→verde no
        // launcher. Nenhuma IPC setWindowMode adicional é necessária aqui.
      } else {
        console.error("Failed to start meeting:", result.error);
        // Uma negação de permissão de microfone aborta a reunião antes que o overlay (que
        // hospeda o banner de áudio da reunião) seja exibido — então o usuário fica
        // não launcher sem nada acionável. Reabrir o cartão de permissões,
        // que verifica o status ao vivo do microfone/tela, solicita novamente o microfone, e
        // faz link direto para as Configurações do Sistema. Esta é a superfície recuperável para
        // o relato "eu clico em Iniciar Refract e nada acontece".
        if (result.code === 'mic-permission-denied') {
          setShowPermissionsToaster(true);
        }
      }
    } catch (err) {
      console.error("Failed to start meeting:", err);
      // Defesa em profundidade: hoje o manipulador IPC de iniciar reunião captura e
      // resolver {success:false, code}, então uma negação de microfone cai não ramo
      // else acima. Se a chamada rejeitar em vez disso, o Electron preserva o
      // .code do erro serializado através do ipcRenderer.invoke — manter a recuperação
      // funcionando para que a negação nunca regreda para uma falha silenciosa.
      if ((err as { code?: string })?.code === 'mic-permission-denied') {
        setShowPermissionsToaster(true);
      }
    }
  };

  const handleEndMeeting = () => {
    console.log("[App.tsx] handleEndMeeting triggered");
    analytics.trackMeetingEnded();
    setIsProcessingMeeting(true);

    // Registro local que não depende do processo principal.
    const startStr = localStorage.getItem('refract_last_meeting_start');
    if (startStr) {
      const duration = Date.now() - parseInt(startStr, 10);
      const threshold = import.meta.env.DEV ? 10000 : 180000;
      if (duration >= threshold) {
        localStorage.setItem('refract_show_profile_toaster', 'true');
      }
      localStorage.removeItem('refract_last_meeting_start');
    }

    // Disparar e esquecer: o manipulador endMeeting() do processo principal agora executa a
    // troca do launcher sincronicamente não topo, ANTES de qualquer desmontagem de áudio
    // bloqueante. Aguardar aqui travaria o loop de renderização do React do overlay
    // durante a ida e volta da IPC enquanto o libuv-blocking setImmediate
    // nativo dispara não processo principal — que é o atraso que o usuário
    // estava vendo. A janela do launcher recebe um evento 'meetings-updated'
    // após a desmontagem em segundo plano então sua lista atualiza sozinha.
    window.electronAPI.endMeeting().catch(err => {
      console.error("Failed to end meeting:", err);
      // Segurança extra: se a própria IPC rejeitou, a troca pode
      // não ter acontecido — solicitar manualmente para que o usuário não fique
      // preso em um overlay morto.
      window.electronAPI.setWindowMode('launcher');
    });
  };

  const interfaceThemeAttribute = meetingInterfaceTheme === 'default' ? undefined : meetingInterfaceTheme;

  // Lógica de Renderização
  if (isCropperWindow) {
    return (
      <React.Suspense fallback={<div className="w-screen h-screen bg-transparent" />}>
        <CropperWindow />
      </React.Suspense>
    );
  }

  if (isSettingsWindow) {
    return (
      <ErrorBoundary context="SettingsPopup">
        <div className="h-full min-h-0 w-full" data-interface-theme={interfaceThemeAttribute}>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <SettingsPopup />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  if (isModelSelectorWindow) {
    return (
      <ErrorBoundary context="ModelSelector">
        <div
          className="h-full min-h-0 w-full overflow-hidden"
          data-interface-theme={interfaceThemeAttribute}
        >
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <ModelSelectorWindow />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- JANELA LANGUAGE LEARNING ---
  if (isLanguageLearningWindow) {
    return (
      <ErrorBoundary context="LanguageLearning">
        <div className="w-full h-full relative overflow-hidden bg-transparent">
          <LanguageLearningOverlay />
        </div>
      </ErrorBoundary>
    );
  }

  // --- JANELA REPLICA / INTERVIEW COACH ---
  if (isReplicaWindow) {
    return (
      <ErrorBoundary context="Replica">
        <div className="w-full h-full relative overflow-hidden bg-transparent">
          <React.Suspense fallback={<div style={{ padding: 20, color: '#888' }}>Loading coach…</div>}>
            <ReplicaOverlay />
          </React.Suspense>
        </div>
      </ErrorBoundary>
    );
  }

  // --- JANELA OVERLAY (Interface de Reunião) ---
  if (isOverlayWindow) {
    return (
      <ErrorBoundary context="Overlay">
        <div className="w-full h-full relative overflow-hidden bg-transparent">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <div
                style={{
                  ['--overlay-opacity' as '--overlay-opacity']: String(overlayOpacity),
                  transition: 'background-color 75ms ease, border-color 75ms ease, box-shadow 75ms ease'
                } as React.CSSProperties}
              >
                <RefractInterface
                  onEndMeeting={handleEndMeeting}
                  overlayOpacity={overlayOpacity}
                  interfaceTheme={meetingInterfaceTheme}
                />
              </div>
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- JANELA LAUNCHER (Padrão) ---
  // Render se window=launcher OR não param
  return (
    <ErrorBoundary context="Launcher">
    <div className="h-full min-h-0 w-full relative bg-transparent">
      <AnimatePresence>
        {showStartup ? (
          <motion.div
            key="startup"
            className="h-full w-full"
            initial={{ opacity: 0, scale: 1.01 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] } }}
            exit={{ opacity: 0, scale: 1.04, pointerEvents: "none", transition: { duration: 0.55, ease: [0.4, 0, 0.2, 1] } }}
          >
            <StartupSequence onComplete={() => setShowStartup(false)} />
          </motion.div>
        ) : (
          <motion.div
            key="main"
            className="h-full w-full"
            initial={{ opacity: 0, scale: 0.99, y: 8 }} // Entrada estilo "Linear": levemente abaixo e escalonado
            animate={{ opacity: 1, scale: 1, y: 0 }}    // Deslizar para cima e encaixar
            transition={{
              duration: 0.6,
              ease: [0.19, 1, 0.22, 1], // Expo-out: início ágil, pouso suave
            }}
          >
            <QueryClientProvider client={queryClient}>
              <ToastProvider>
                <div id="launcher-container" className="h-full w-full relative">
                  <Launcher
                    onStartMeeting={handleStartMeeting}
                    onOpenSettings={(tab = 'general') => openSettingsExclusive(tab)}
                    onOpenProfile={() => openProfileExclusive()}
                    onOpenModes={() => openModesExclusive()}
                    onPageChange={setIsLauncherMainView}
                    ollamaPullStatus={ollamaPullStatus}
                    ollamaPullPercent={ollamaPullPercent}
                    ollamaPullMessage={ollamaPullMessage}
                    isPremium={isPremiumActive}
                    activeModeId={null}
                    onSelectAssistant={async (templateType) => {
                      try {
                        // Get all modes, find one matching this template
                        const modes = await window.electronAPI?.modesGetAll?.();
                        if (modes && Array.isArray(modes)) {
                          const match = modes.find((m: any) => m.templateType === templateType);
                          if (match) {
                            await window.electronAPI?.modesSetActive?.(match.id);
                          }
                        }
                      } catch (e) {
                        console.error('[App] Failed to activate assistant:', e);
                      }
                    }}
                  />
                </div>
                <SettingsOverlay
                  isOpen={isSettingsOpen}
                  onClose={() => {
                    setIsSettingsOpen(false);
                  }}
                  initialTab={settingsInitialTab}
                  initialIsPremium={hasLoadedLicense ? isPremiumActive : null}
                  initialHasRefractKey={hasRefractApi}
                />
                <AnimatePresence>
                  {isModesOpen && (
                    <motion.div
                      key="modes-panel"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                      onClick={(e) => { if (e.target === e.currentTarget) setIsModesOpen(false); }}
                    >
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 18, filter: 'blur(12px)' }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(8px)' }}
                        transition={{
                          opacity: { duration: 0.32, ease: [0.23, 1, 0.32, 1] },
                          filter: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
                          scale: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                          y: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                        }}
                        style={{
                          willChange: 'transform, opacity, filter',
                          transformOrigin: 'center',
                          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.65), 0 16px 40px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
                        }}
                        className="w-[820px] h-[600px] max-w-[95vw] max-h-[90vh] rounded-2xl overflow-hidden border border-white/10 bg-[#141414]"
                      >
                        <ModesSettings onClose={() => setIsModesOpen(false)} isPremium={isPremiumActive} isLoaded={hasLoadedLicense} isTrialActive={!!activeTrial} onOpenRefractAPI={() => openSettingsExclusive('refract-api')} />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {isProfileOpen && (
                    <motion.div
                      key="profile-panel"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                      onClick={(e) => { if (e.target === e.currentTarget) setIsProfileOpen(false); }}
                    >
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 18, filter: 'blur(12px)' }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(8px)' }}
                        transition={{
                          opacity: { duration: 0.32, ease: [0.23, 1, 0.32, 1] },
                          filter: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
                          scale: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                          y: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                        }}
                        style={{
                          willChange: 'transform, opacity, filter',
                          transformOrigin: 'center',
                          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.65), 0 16px 40px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
                        }}
                        className="w-[820px] h-[600px] max-w-[95vw] max-h-[90vh] rounded-2xl overflow-hidden border border-white/10 bg-[#141414]"
                      >
                        <ProfileIntelligenceSettings
                          onClose={() => setIsProfileOpen(false)}
                        />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <ToastViewport />
              </ToastProvider>
            </QueryClientProvider>
          </motion.div>
        )}
      </AnimatePresence>


      <AnimatePresence>
        {incompatibleWarning && isDefault && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed bottom-6 right-6 z-50 pointer-events-auto"
          >
            <div className="bg-[#1A1A1A] border border-[#ff3333]/30 shadow-2xl rounded-2xl p-5 max-w-[340px] flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#ff3333] shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-[#E0E0E0] font-medium text-sm">Provider Changed</h3>
                  <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                    ⚠ {incompatibleWarning.count} meetings used your previous AI provider ({incompatibleWarning.oldProvider}) and won't appear in search results under {incompatibleWarning.newProvider}.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-1 justify-end">
                <button 
                  onClick={() => setIncompatibleWarning(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#A0A0A0] hover:text-white hover:bg-white/5 transition-colors"
                >
                  Dismiss
                </button>
                <button 
                  onClick={handleReindex}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ff3333]/10 text-[#ff3333] hover:bg-[#ff3333]/20 transition-colors"
                >
                  Re-index automatically
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reindexProgress && isDefault && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed bottom-6 right-6 z-50 pointer-events-auto"
          >
            <div className="bg-[#1A1A1A] border border-white/10 shadow-2xl rounded-2xl p-5 max-w-[340px] flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <RefreshCw className={`w-5 h-5 text-[#A0A0A0] shrink-0 mt-0.5 ${reindexProgress.done < reindexProgress.total ? 'animate-spin' : ''}`} />
                <div className="flex-1">
                  <h3 className="text-[#E0E0E0] font-medium text-sm">
                    {reindexProgress.done >= reindexProgress.total && reindexProgress.total > 0
                      ? 'Search index updated'
                      : 'Updating search index'}
                  </h3>
                  <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                    {reindexProgress.done >= reindexProgress.total && reindexProgress.total > 0
                      ? 'Your past conversations are searchable again.'
                      : `Re-indexing your past conversations for the upgraded AI model… ${reindexProgress.done}/${reindexProgress.total}`}
                  </p>
                  {reindexProgress.total > 0 && (
                    <div className="mt-2 h-1 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-[#E0E0E0] transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.round((reindexProgress.done / reindexProgress.total) * 100))}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UpdateBanner />
      <SupportToaster />
      <RefractQuotaBanner />



      {/* Banner de contagem regressiva do trial gratuito — apenas na janela do launcher enquanto o trial está ativo */}
      {(isLauncherWindow || isDefault) && activeTrial && (
        <FreeTrialBanner
          expiresAt={activeTrial.expiresAt}
          usage={activeTrial.usage}
          onUpgrade={() => openSettingsExclusive('api')}
        />
      )}

      {/* Toaster de permissões — primeira inicialização */}
      <PermissionsToaster
        isOpen={showPermissionsToaster}
        onDismiss={() => {
          localStorage.setItem('refract_perms_shown_v1', '1');
          window.electronAPI?.onboardingSetFlag?.('permsShown', true).catch(() => {});
          setShowPermissionsToaster(false);
          // Mostrar o promo de trial imediatamente após a configuração de permissões (com atraso de transição de 1,5s)
          setTimeout(() => {
            setShowTrialPromo(true);
          }, 1500);
        }}
      />

      {/* Toaster de promo de trial — 5s após reinício (autorregulado via localStorage + condições) */}
      <TrialPromoToaster
        isOpen={showTrialPromo}
        hasRefractKey={hasRefractApi}
        hasTrialToken={!!activeTrial}
        onDismiss={() => setShowTrialPromo(false)}
        onStartTrial={async () => {
          const res = await window.electronAPI?.startTrial?.();
          if (!res?.ok) throw new Error(res?.error || 'Could not start trial');
          if (res.expires_at) {
            setActiveTrial({ expiresAt: res.expires_at, usage: res.usage ?? { ai: 0, stt_seconds: 0, search: 0 } });
          }
          setShowTrialPromo(false);
        }}
        onManualSetup={() => {
          setShowTrialPromo(false);
          openSettingsExclusive('api');
        }}
      />

      {/* Modal de upgrade pós-trial — exibido quando o trial expira */}
      {(isLauncherWindow || isDefault) && showTrialExpiredModal && (
        <FreeTrialModal
          usage={activeTrial?.usage ?? { ai: 0, stt_seconds: 0, search: 0 }}
          onByok={async () => {
            await window.electronAPI?.endTrialByok?.();
          }}
          onStandard={async () => {
            // Limpar currículo + vaga (cache do orquestrador + SQLite) antes de abrir o checkout
            await window.electronAPI?.wipeTrialProfileData?.().catch(() => {});
            // Reverter modo ativo para nenhum — plano Standard não tem acesso a modos
            await window.electronAPI?.modesSetActive?.(null).catch(() => {});
          }}
          onDone={() => {
            setShowTrialExpiredModal(false);
            setActiveTrial(null);
          }}
        />
      )}
      {/* Toasters de anúncios */}
      {isLauncherMainView && !isSettingsOpen && (
        <RefractApiPromoToaster
          isOpen={activeAd === 'refract_api'}
          onDismiss={() => dismissAd('refract_api')}
          onOpenSettings={(tab: string) => openSettingsExclusive(tab)}
        />
      )}
      {isLauncherMainView && (
        <>
          <ProfileFeatureToaster
            isOpen={activeAd === 'profile'}
            onDismiss={dismissAd}
            onSetupProfile={() => openProfileExclusive()}
          />
          <JDAwarenessToaster
            isOpen={activeAd === 'jd'}
            onDismiss={dismissAd}
            onSetupJD={() => openProfileExclusive()}
          />
          <PremiumPromoToaster
            isOpen={activeAd === 'promo'}
            onDismiss={dismissAd}
            onUpgrade={() => {
              setShowPremiumModal(true);
            }}
          />
          <MaxUltraUpgradeToaster
            isOpen={activeAd === 'max_ultra_upgrade'}
            onDismiss={dismissAd}
            onUpgrade={() => {
              setShowPremiumModal(true);
            }}
          />

          {/* Lógica de Renderização de Campanhas Remotas (Comentado)
          <RemoteCampaignToaster
            isOpen={typeof activeAd === 'object' && activeAd !== null}
            campaign={typeof activeAd === 'object' && activeAd !== null ? activeAd : undefined as any}
            onDismiss={dismissAd}
          />
          */}
        </>
      )}

      <PremiumUpgradeModal
        isOpen={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
        isPremium={isPremiumActive}
        onActivated={() => {
          setIsPremiumActive(true);
          // Atualizar detalhes completos do plano após ativação para que a segmentação de anúncios reflita o novo plano
          window.electronAPI?.licenseGetDetails?.()
            .then(d => setPlanDetails(d ?? { isPremium: true }))
            .catch(() => setPlanDetails({ isPremium: true }));
          setShowPremiumModal(false);
          // Se o usuário ativou durante o modal pós-trial, fechar — agora tem um plano
          setShowTrialExpiredModal(false);
          setActiveTrial(null);
          // Após ativação, abrir configurações não Perfil Inteligente
          setTimeout(() => {
            openProfileExclusive();
          }, 300);
        }}
        onDeactivated={() => { setIsPremiumActive(false); setPlanDetails({ isPremium: false }); }}
      />

      {/* Ferramentas de desenvolvimento — alternadas via Ctrl+Shift+D/K/O */}
      <CodeOverlay visible={showCodeOverlay} onClose={() => setShowCodeOverlay(false)} />
      <DevDashboard visible={showDevDashboard} onClose={() => setShowDevDashboard(false)} />
      <OpencodePanel visible={showOpencodePanel} onClose={() => setShowOpencodePanel(false)} />
    </div>
    </ErrorBoundary>
  )
}

export default App
