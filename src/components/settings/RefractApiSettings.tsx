import {
  AlertCircle,
  ArrowUpRight,
  Brain,
  CalendarClock,
  CheckCircle,
  Clock,
  Info,
  Loader2,
  Mic,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefractLogoMark } from '../RefractLogoMark';
import { FreeTrialModal } from '../trial/FreeTrialModal';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Tipos ───────────────────────────────────────────────────
// Tipos de dados para cotação de uso e produtos de preço
interface QuotaBucket {
  used: number;
  limit: number;
  remaining: number;
}
interface UsageData {
  plan: string;
  member_since: string;
  quota: {
    transcription: QuotaBucket;
    ai: QuotaBucket;
    search: QuotaBucket;
    resets_at: string;
  };
}

interface PricingProduct {
  formattedPrice: string | null;
  checkoutUrl: string;
}

const PLAN_IDS_ORDER = [
  'refract_api_standard_monthly',
  'refract_api_pro_monthly',
  'refract_api_max_monthly',
  'refract_api_ultra_monthly',
] as const;

const PLAN_STANDARD_URL = 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl';
const PLAN_PRO_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';
const PLAN_MAX_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf';
const PLAN_ULTRA_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU';
const MASKED_REFRACT_KEY = '•'.repeat(24);

const PLANS = [
  {
    id: 'refract_api_standard_monthly',
    name: 'Standard',
    price: '$8',
    url: PLAN_STANDARD_URL,
    badgeText: 'Basic',
    includesPro: false,
    description: 'Ideal for light individual users who want essential transcription and model usage.',
    note: 'Does not include Refract Pro desktop app license. Custom API key usage is supported.',
    features: [
      '500 AI requests per month',
      '200 minutes of Speech-to-Text',
      '20 real-time web searches',
      'Standard server priority & support',
      'Full local API key support',
    ],
  },
  {
    id: 'refract_api_pro_monthly',
    name: 'Pro',
    price: '$15',
    url: PLAN_PRO_URL,
    badgeText: 'Recommended',
    includesPro: true,
    description: 'Best for power users and professionals seeking full local productivity integrations.',
    note: 'Includes a full Refract Pro desktop app license for the duration of subscription.',
    features: [
      '1,000 AI requests per month',
      '500 minutes of Speech-to-Text',
      '100 real-time web searches',
      'High-priority server request queue',
      'Full Refract Pro app features included',
    ],
  },
  {
    id: 'refract_api_max_monthly',
    name: 'Max',
    price: '$25',
    url: PLAN_MAX_URL,
    badgeText: 'Best Value',
    includesPro: true,
    description: 'Built for developers and teams using high volume text-to-speech and AI reasoning.',
    note: 'Includes a full Refract Pro desktop app license for the duration of subscription.',
    features: [
      '2,000 AI requests per month',
      '1,000 minutes of Speech-to-Text',
      '200 real-time web searches',
      'High-priority server request queue',
      'Full Refract Pro app features included',
    ],
  },
  {
    id: 'refract_api_ultra_monthly',
    name: 'Ultra',
    price: '$35',
    url: PLAN_ULTRA_URL,
    badgeText: 'Heavy Users',
    includesPro: true,
    description: 'For heavy enterprise users, continuous screen understanding, and high-frequency meeting recording.',
    note: 'Includes a full Refract Pro desktop app license for the duration of subscription.',
    features: [
      '3,000 AI requests per month',
      '2,000 minutes of Speech-to-Text',
      '300 real-time web searches',
      'Dedicated high-throughput queue',
      'Full Refract Pro app features included',
    ],
  },
] as const;

// Variantes de animação para o container de cartões de planos
const cardContainerVariants = {
  enter: (_direction: number) => ({
    opacity: 0,
  }),
  center: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.02,
    }
  },
  exit: (_direction: number) => ({
    opacity: 0,
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1 as const,
    }
  })
};

// Variantes de animação: slide para a esquerda ao entrar/sair
const cardSlideLeftVariants = {
  enter: {
    x: -12,
    scale: 0.98,
    opacity: 0,
    filter: 'blur(1px)'
  },
  center: {
    x: 0,
    scale: 1,
    opacity: 1,
    filter: 'blur(0px)',
    transition: {
      x: { type: 'spring' as const, duration: 0.58, bounce: 0.04 },
      scale: { type: 'spring' as const, duration: 0.58, bounce: 0.04 },
      opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const },
      filter: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const }
    }
  },
  exit: {
    x: -8,
    scale: 0.985,
    opacity: 0,
    filter: 'blur(1px)',
    transition: {
      x: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      scale: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      opacity: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const },
      filter: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const }
    }
  }
};

// Variantes de animação: slide para a direita ao entrar/sair
const cardSlideRightVariants = {
  enter: {
    x: 12,
    scale: 0.98,
    opacity: 0,
    filter: 'blur(1px)'
  },
  center: {
    x: 0,
    scale: 1,
    opacity: 1,
    filter: 'blur(0px)',
    transition: {
      x: { type: 'spring' as const, duration: 0.58, bounce: 0.04 },
      scale: { type: 'spring' as const, duration: 0.58, bounce: 0.04 },
      opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const },
      filter: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const }
    }
  },
  exit: {
    x: 8,
    scale: 0.985,
    opacity: 0,
    filter: 'blur(1px)',
    transition: {
      x: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      scale: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      opacity: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const },
      filter: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const }
    }
  }
};

// Variantes de animação para o CTA do cartão
const cardCtaVariants = {
  enter: {
    y: 6,
    scale: 0.98,
    opacity: 0
  },
  center: {
    y: 0,
    scale: 1,
    opacity: 1,
    transition: {
      y: { type: 'spring' as const, duration: 0.58, bounce: 0.06 },
      scale: { type: 'spring' as const, duration: 0.58, bounce: 0.06 },
      opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const }
    }
  },
  exit: {
    y: 4,
    scale: 0.99,
    opacity: 0,
    transition: {
      y: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      scale: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      opacity: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const }
    }
  }
};

// ─── Barra de Cotação ───────────────────────────────────────────────
// Componente de barra de progresso para exibir o uso de recursos (AI, STT, busca)
function QuotaBar({
  label,
  icon: Icon,
  bucket,
  barColor,
}: {
  label: string;
  icon: React.ElementType;
  bucket: QuotaBucket;
  barColor: string;
}) {
  const pct = bucket.limit > 0 ? Math.min(100, (bucket.used / bucket.limit) * 100) : 0;
  const isHigh = pct >= 80;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon
            size={12}
            className={isHigh ? 'text-amber-400' : 'text-text-tertiary'}
            strokeWidth={1.75}
          />
          <span className="text-[12px] text-text-secondary">{label}</span>
        </div>
        <span
          className={`text-[12px] tabular-nums font-medium ${isHigh ? 'text-amber-400' : 'text-text-tertiary'}`}
        >
          {bucket.used.toLocaleString()}
          <span className="font-normal text-text-tertiary/60">
            {' '}
            / {bucket.limit.toLocaleString()}
          </span>
        </span>
      </div>
      <div className="h-[5px] w-full bg-bg-input rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${isHigh ? 'bg-amber-400' : barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Contagem regressiva do trial (ao vivo, atualiza a cada 1s) ───────────────
function TrialCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(expiresAt).getTime() - Date.now()),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const totalSec = Math.ceil(remaining / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const isWarning = remaining < 2 * 60 * 1000;
  return (
    <div
      className={`flex items-center gap-1 ${isWarning ? 'text-amber-400' : 'text-text-tertiary'}`}
    >
      <Clock size={11} strokeWidth={2} />
      <span className="text-[11px] font-mono font-semibold tabular-nums">
        {remaining === 0 ? 'Ended' : `${m}:${s.toString().padStart(2, '0')}`}
      </span>
    </div>
  );
}

// ─── Pílula de uso do trial ─────────────────────────────────────────
// Indicador compacto de uso de recursos durante o trial gratuito
function TrialUsagePill({
  icon: Icon,
  used,
  limit,
  label,
  unit,
}: {
  icon: React.ElementType;
  used: number;
  limit: number;
  label: string;
  unit: string;
}) {
  const pct = Math.min(100, (used / limit) * 100);
  const isHigh = pct >= 80;
  return (
    <div className="bg-bg-input rounded-[10px] px-3 py-2.5 space-y-2 border border-border-subtle">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon
            size={12}
            strokeWidth={2}
            className={isHigh ? 'text-amber-400' : 'text-text-tertiary'}
          />
          <span className="text-[10.5px] text-text-secondary font-medium">{label}</span>
        </div>
        <span
          className={`text-[12px] tabular-nums font-bold ${isHigh ? 'text-amber-400' : 'text-text-primary'}`}
        >
          {used}
          <span className="text-[10px] font-medium text-text-tertiary">
            /{limit}
            {unit}
          </span>
        </span>
      </div>
      <div className="h-[4px] w-full bg-bg-surface rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isHigh ? 'bg-amber-400' : 'bg-violet-500/70'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Componente wrapper de cartão ────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`bg-bg-item-surface rounded-2xl border border-border-subtle overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

// ─── Componente Principal ───────────────────────────────────────
interface RefractApiSettingsProps {
  initialIsSaved?: boolean;
}

// Componente principal de configuração da API Refract
export const RefractApiSettings: React.FC<RefractApiSettingsProps> = ({ initialIsSaved = false }) => {
  // Estado: chave de API, status de salvar/carregar, dados de uso, produtos de preço e plano selecionado
  const [apiKey, setApiKey] = useState(() => (initialIsSaved ? MASKED_REFRACT_KEY : ''));
  const [isSaved, setIsSaved] = useState(initialIsSaved);
  const [isLoading, setIsLoading] = useState(!initialIsSaved);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [pricingProducts, setPricingProducts] = useState<Record<string, PricingProduct>>({});
  const [selectedPlanId, setSelectedPlanId] = useState<string>('refract_api_pro_monthly');
  const [prevPlanId, setPrevPlanId] = useState<string>('refract_api_pro_monthly');
  const [hasUserSelected, setHasUserSelected] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Efeito de auto-rotação: alterna automaticamente entre planos quando o usuário não interage
  useEffect(() => {
    if (hasUserSelected || isHovered) return;

    const interval = setInterval(() => {
      setSelectedPlanId(prev => {
        setPrevPlanId(prev);
        const currentIndex = PLAN_IDS_ORDER.indexOf(prev as any);
        const nextIndex = currentIndex === -1 ? 1 : (currentIndex + 1) % PLAN_IDS_ORDER.length;
        return PLAN_IDS_ORDER[nextIndex];
      });
    }, 4500);

    return () => clearInterval(interval);
  }, [hasUserSelected, isHovered]);

  const selectPlan = useCallback((newPlanId: string) => {
    setSelectedPlanId(prev => {
      setPrevPlanId(prev);
      return newPlanId;
    });
  }, []);

  useEffect(() => {
    if (usageData?.plan) {
      const planName = usageData.plan.toLowerCase();
      if (planName === 'starter' || planName === 'standard') {
        selectPlan('refract_api_standard_monthly');
      } else if (planName === 'pro') {
        selectPlan('refract_api_pro_monthly');
      } else if (planName === 'max') {
        selectPlan('refract_api_max_monthly');
      } else if (planName === 'ultra') {
        selectPlan('refract_api_ultra_monthly');
      }
    }
  }, [usageData, selectPlan]);

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

  // ── Estado do Trial Gratuito ──────────────────────────────────────
  const [trialState, setTrialState] = useState<{
    active: boolean;
    expired: boolean;
    expiresAt: string;
    startedAt: string;
    usage: { ai: number; stt_seconds: number; search: number };
  } | null>(null);
  // Verdadeiro enquanto getLocalTrial está em execução — impede o flash do cartão "iniciar trial"
  // antes de saber se o token de trial existe.
  const [isCheckingTrial, setIsCheckingTrial] = useState(true);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [showTrialModal, setShowTrialModal] = useState(false);
  const trialPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const creds = await window.electronAPI.getStoredCredentials();
        if (creds.hasRefractKey) {
          setApiKey(MASKED_REFRACT_KEY);
          setIsSaved(true);
        } else {
          setApiKey('');
          setIsSaved(false);
          setUsageData(null);
          setUsageError(null);
        }
      } catch (e) {
        console.error('[RefractApi]', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const fetchUsage = useCallback(async () => {
    setIsLoadingUsage(true);
    setUsageError(null);
    try {
      const r = await window.electronAPI.getRefractUsage();
      if (r.ok && r.quota) {
        setUsageData(r as UsageData);
      } else {
        setUsageError(
          r.error === 'subscription_inactive'
            ? 'Subscription inactive — renew to restore access.'
            : r.error === 'key_not_found'
              ? 'Key not recognised by server.'
              : r.error === 'invalid_key_format'
                ? 'Invalid key format.'
                : r.error === 'network_error' || r.error?.includes('fetch')
                  ? 'Could not reach server.'
                  : `Server error: ${r.error ?? 'unknown'}`,
        );
      }
    } catch {
      setUsageError('Failed to load usage.');
    } finally {
      setIsLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    if (isSaved && !isLoading) fetchUsage();
  }, [isSaved, isLoading, fetchUsage]);

  useEffect(() => {
    window.electronAPI?.getRefractPricing?.()
      .then((res) => {
        if (res?.ok && res.products) setPricingProducts(res.products);
      })
      .catch(() => {});
  }, []);

  // ── Inicialização do Trial + polling ──────────────────────────────────
  const refreshTrial = useCallback(async () => {
    const res = await window.electronAPI?.getTrialStatus?.();
    if (!res?.ok) return;

    localStorage.setItem('refract_trial_claimed', 'true');

    setTrialState({
      active: !(res.expired ?? false),
      expired: res.expired ?? false,
      expiresAt: res.expires_at ?? '',
      startedAt: res.started_at ?? '',
      usage: res.usage ?? { ai: 0, stt_seconds: 0, search: 0 },
    });
    if (res.expired) {
      setShowTrialModal(true);
      if (trialPollRef.current) {
        clearInterval(trialPollRef.current);
        trialPollRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    // Em mmontar lê local trial token (não network) para determine initial renderizar sestado
    // então busca live usage de sservidor Configuração trialState de local dados primeiro
    // previne o "inicia trial" cartão de flashing enquanto o servidor chamar é em flight.
    (async () => {
      try {
        const local = await window.electronAPI?.getLocalTrial?.();
        if (!local?.hasToken) {
          if (local?.trialClaimed) localStorage.setItem('refract_trial_claimed', 'true');
          return;
        }

        localStorage.setItem('refract_trial_claimed', 'true');

        if (local.expired) {
          // Token exists mas expired locally — mostrar modal iimediatamente confirm via servidor
          setTrialState({
            active: false,
            expired: true,
            expiresAt: local.expiresAt ?? '',
            startedAt: local.startedAt ?? '',
            usage: { ai: 0, stt_seconds: 0, search: 0 },
          });
          setShowTrialModal(true);
          refreshTrial(); // atualiza usage counters em o modal
          return;
        }

        // Conjunto optimistic ativo estado imediatamente de local dados então o correct
        // cartão renderiza antes o servidor responds (previne start-card flash).
        // Usage counters inicia at 0 e são replaced por refreshTrial babaixo
        setTrialState({
          active: true,
          expired: false,
          expiresAt: local.expiresAt ?? '',
          startedAt: local.startedAt ?? '',
          usage: { ai: 0, stt_seconds: 0, search: 0 },
        });

        // Busca live usage + inicia 15s polling (era 30s — halved então counters
        // feel mais responsive durante an ativo sesessão
        refreshTrial();
        trialPollRef.current = setInterval(refreshTrial, 15_000);
      } finally {
        setIsCheckingTrial(false);
      }
    })();
    return () => {
      if (trialPollRef.current) clearInterval(trialPollRef.current);
    };
  }, [refreshTrial]);

  // Inicia o trial gratuito e configura o polling de atualização
  const handleStartTrial = async () => {
    setTrialLoading(true);
    setTrialError(null);
    try {
      const res = await window.electronAPI?.startTrial?.();
      if (!res?.ok) {
        if (res?.error === 'trial_ip_limit' || res?.error === 'trial_start_rate_limited') {
          localStorage.setItem('refract_trial_claimed', 'true');
          setTrialState({
            active: false,
            expired: true,
            expiresAt: '',
            startedAt: '',
            usage: { ai: 0, stt_seconds: 0, search: 0 },
          });
          return;
        }
        const msg =
          res?.error === 'invalid_hwid'
            ? 'Could not read device ID. Restart the app and try again.'
            : res?.error || 'Could not start trial. Try again.';
        setTrialError(msg);
        return;
      }

      localStorage.setItem('refract_trial_claimed', 'true');

      if (res.already_used && res.expired) {
        setTrialState({
          active: false,
          expired: true,
          expiresAt: '',
          startedAt: '',
          usage: { ai: 0, stt_seconds: 0, search: 0 },
        });
        return;
      }
      setTrialState({
        active: !(res.expired ?? false),
        expired: res.expired ?? false,
        expiresAt: res.expires_at ?? '',
        startedAt: res.started_at ?? '',
        usage: res.usage ?? { ai: 0, stt_seconds: 0, search: 0 },
      });
      if (!res.expired) {
        trialPollRef.current = setInterval(refreshTrial, 30_000);
      }
    } catch (e: any) {
      setTrialError(e.message || 'Network error');
    } finally {
      setTrialLoading(false);
    }
  };

  // Apenas limpa — o modal transiciona para DoneState, então onDone fecha
  const handleByok = async () => {
    await window.electronAPI?.endTrialByok?.();
  };

  const handleTrialDone = () => {
    setTrialState(null);
    setShowTrialModal(false);
  };

  // Salva a chave de API Refract
  const handleSave = async () => {
    if (!apiKey.trim() || apiKey.includes('•')) return;
    setIsSaving(true);
    setError(null);
    try {
      const r = await window.electronAPI.setRefractApiKey(apiKey.trim());
      if (r.success) {
        setApiKey('•'.repeat(24));
        setIsSaved(true);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
        // NOTA: não chamar setDefaultModel('refract') / setSttProvider('refract') aqui
        // pois o manipulador `set-refract-api-key` no processo principal já promove
        // automaticamente o modelo padrão e o provedor STT server-side (veja
        // CredentialsManager.setRefractApiKey) e executa reconfigureSttProvider uma vez.
        // Esses IPCs extras competiam com a segunda reconstrução do pipeline de áudio,
        // causando deadlock/crash na pilha nativa de áudio logo após salvar a chave
        // (o bug "app trava após inserir a chave", macOS + Windows).
      } else {
        setError(r.error || 'Failed to save API key');
      }
    } catch (e: any) {
      setError(e.message || 'Unexpected error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    setApiKey('');
    setIsSaved(false);
    setError(null);
    setUsageData(null);
    setUsageError(null);
    window.electronAPI.setRefractApiKey('').catch(() => {});
  };

  const openExternal = (url: string) => {
    (window.electronAPI as any)?.openExternal?.(url);
  };

  const isDirty = apiKey.length > 0 && !apiKey.includes('•') && !isSaved;
  const planLabel = usageData?.plan
    ? usageData.plan.charAt(0).toUpperCase() + usageData.plan.slice(1)
    : null;
  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const PlansCard = (
    <div 
      className="space-y-4"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Cabeçalho and Valor Proposition */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">
            Choose a Plan
          </p>
          <span className="text-[10px] text-text-tertiary">
            Pro, Max &amp; Ultra include Refract Pro app
          </span>
        </div>
        <div className="w-full flex items-center justify-center py-2.5 rounded-xl border refract-api-header-promo-banner">
          <span className="text-[11.5px] font-medium refract-api-header-promo-text">
            Use code <span className="font-bold refract-api-header-promo-code">INSIDER20</span> for 20% off Pro, Max &amp; Ultra
          </span>
        </div>
      </div>

      {/* Segmented controla selector tab bar */}
      <div className="refract-api-selector-bar grid grid-cols-4 relative p-1 bg-black/10 dark:bg-white/5 border border-white/5 rounded-2xl overflow-hidden mb-2">
        {/* Active sliding pill */}
        <div 
          className="absolute top-0 bottom-0 left-0 w-1/4 p-1 transition-transform duration-220 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform"
          style={{
            transform: `translate3d(${
              selectedPlanId === 'refract_api_standard_monthly' ? '0%' :
              selectedPlanId === 'refract_api_pro_monthly' ? '100%' :
              selectedPlanId === 'refract_api_max_monthly' ? '200%' :
              '300%'
            }, 0, 0)`
          }}
        >
          <div className={`w-full h-full refract-api-selector-pill rounded-xl transition-all duration-300 ${
            selectedPlanId === 'refract_api_standard_monthly' ? 'refract-api-selector-pill-standard' :
            selectedPlanId === 'refract_api_pro_monthly' ? 'refract-api-selector-pill-pro' :
            selectedPlanId === 'refract_api_max_monthly' ? 'refract-api-selector-pill-max' :
            'refract-api-selector-pill-ultra'
          }`} />
        </div>
        {(
          [
            { id: 'refract_api_standard_monthly', name: 'Standard', price: '$8/mo' },
            { id: 'refract_api_pro_monthly', name: 'Pro', price: '$15/mo' },
            { id: 'refract_api_max_monthly', name: 'Max', price: '$25/mo' },
            { id: 'refract_api_ultra_monthly', name: 'Ultra', price: '$35/mo' },
          ] as const
        ).map((tab) => {
          const isSel = selectedPlanId === tab.id;
          const liveProduct = pricingProducts[tab.id];
          const displayPrice = liveProduct?.formattedPrice || tab.price;
          return (
            <button
              key={tab.id}
              onClick={() => {
                selectPlan(tab.id);
                setHasUserSelected(true);
              }}
              className={`refract-api-selector-tab ${isSel ? 'active' : ''}`}
            >
              <span className="tab-name">{tab.name}</span>
              <span className="tab-price">{displayPrice}</span>
            </button>
          );
        })}
      </div>

      {/* Selected Plan Details Container (Double-Bezel Architecture) */}
      {(() => {
        const planOrder = [
          'refract_api_standard_monthly',
          'refract_api_pro_monthly',
          'refract_api_max_monthly',
          'refract_api_ultra_monthly',
        ];
        const prevIndex = planOrder.indexOf(prevPlanId);
        const currentIndex = planOrder.indexOf(selectedPlanId);
        const direction = currentIndex >= prevIndex ? 1 : -1;

        const plan = PLANS.find((p) => p.id === selectedPlanId)!;
        const liveProduct = pricingProducts[plan.id];
        const price = liveProduct?.formattedPrice || plan.price;
        const checkoutUrl = liveProduct?.checkoutUrl || plan.url;
        const currentPlan = usageData?.plan?.toLowerCase();
        const rowPlan = plan.name.toLowerCase();
        const isActive =
          currentPlan === rowPlan ||
          (rowPlan === 'standard' && currentPlan === 'starter');

        return (
          <div className="refract-api-details-wrapper relative w-full">
            <div 
              className={`refract-api-detail-card h-full w-full relative overflow-hidden refract-api-detail-card-${plan.name.toLowerCase()}`} 
              data-active={isActive ? "true" : "false"}
              style={{
                transition: 'background 280ms cubic-bezier(0.23, 1, 0.32, 1), border-color 280ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 280ms cubic-bezier(0.23, 1, 0.32, 1)'
              }}
            >
              <AnimatePresence custom={direction}>
                <motion.div
                  key={selectedPlanId}
                  custom={direction}
                  variants={cardContainerVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full h-full absolute top-0 left-0 p-6"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch relative z-10 h-full">
                    {/* Left Coluna - Pricing & Actions */}
                    <div className="flex flex-col justify-between">
                      <motion.div variants={cardSlideLeftVariants}>
                        {/* Badge & Inclusion Linha */}
                        <div className="flex items-center gap-2 mb-4 h-6">
                          {plan.badgeText && (
                            <span className={`refract-api-pricing-badge ${
                              plan.name === 'Pro' 
                                ? 'refract-api-pricing-badge-recommended refract-api-badge-text-recommended' 
                                : plan.name === 'Max'
                                  ? 'refract-api-pricing-badge-max refract-api-badge-text-max'
                                  : plan.name === 'Ultra'
                                    ? 'refract-api-pricing-badge-ultra refract-api-badge-text-ultra'
                                    : 'refract-api-pricing-badge-standard refract-api-badge-text-standard'
                            }`}>
                              {plan.badgeText}
                            </span>
                          )}
                          {plan.includesPro && (
                            <span className="refract-api-pricing-badge refract-api-pricing-badge-emerald refract-api-badge-text-emerald select-none">
                              + Pro App
                            </span>
                          )}
                        </div>

                        {/* Plan Nome */}
                        <h4 className="text-[20px] font-bold text-text-primary tracking-tight">
                          {plan.name} Tier
                        </h4>

                        {/* Price */}
                        <div className="mt-3 flex items-baseline gap-1.5">
                          <span className={`text-[34px] font-extrabold tracking-tight leading-none ${
                            plan.name === 'Pro' 
                              ? 'refract-api-price-pro' 
                              : plan.name === 'Max'
                                ? 'refract-api-price-max'
                                : plan.name === 'Ultra'
                                  ? 'refract-api-price-ultra'
                                  : 'refract-api-price-standard'
                          }`}>
                            {price}
                          </span>
                          <span className="text-[12px] font-medium text-text-tertiary">/ month</span>
                        </div>
                        <p className="text-[11.5px] text-text-secondary mt-2.5 leading-relaxed">
                          {plan.description}
                        </p>
                      </motion.div>

                      {/* Ação / Checkout section */}
                      <motion.div className="mt-6 space-y-3" variants={cardCtaVariants}>
                        <div 
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border refract-api-pricing-promo-wrapper"
                          style={{ visibility: plan.includesPro ? 'visible' : 'hidden' }}
                        >
                          <span className="text-[11px] font-medium refract-api-pricing-promo-text">
                            Code <strong className="refract-api-pricing-promo-bold font-bold select-all">INSIDER20</strong> for 20% off
                          </span>
                        </div>

                        <div>
                          {isActive ? (
                            <div className="w-full refract-api-active-tag text-center py-3 rounded-full text-[13px] font-semibold select-none flex items-center justify-center">
                              Active Plan
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                openExternal(checkoutUrl);
                                setHasUserSelected(true);
                              }}
                              className={`refract-api-pricing-cta ${
                                plan.name === 'Pro' 
                                  ? 'refract-api-pricing-cta-pro' 
                                  : plan.name === 'Max'
                                    ? 'refract-api-pricing-cta-max'
                                    : plan.name === 'Ultra'
                                      ? 'refract-api-pricing-cta-ultra'
                                      : 'refract-api-pricing-cta-neutral'
                              }`}
                            >
                              Get Started with {plan.name} <ArrowUpRight size={14} strokeWidth={2.5} />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    </div>

                    {/* Direito Coluna - Features & Escopo */}
                    <motion.div 
                      className="flex flex-col h-full refract-api-features-panel rounded-2xl p-5"
                      variants={cardSlideRightVariants}
                    >
                      <p className="text-[10px] font-bold text-text-primary uppercase tracking-wider mb-4">
                        What's Included
                      </p>
                      <ul className="space-y-3 flex-1">
                        {plan.features.map((feature, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[12px] text-text-secondary leading-snug">
                            <CheckCircle 
                              size={13} 
                              className={`shrink-0 mt-[1.5px] ${
                                plan.name === 'Pro' 
                                  ? 'refract-api-check-icon-pro' 
                                  : plan.name === 'Max'
                                    ? 'refract-api-check-icon-max'
                                    : plan.name === 'Ultra'
                                      ? 'refract-api-check-icon-ultra'
                                      : 'refract-api-check-icon-standard'
                              }`}
                              strokeWidth={2.5} 
                            />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5">
                        <p className="text-[10.5px] text-text-tertiary leading-relaxed">
                          {plan.note}
                        </p>
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        );
      })()}

      {/* AI quota note */}
      <div className="flex items-start gap-2 px-3 py-2.5 bg-bg-input rounded-xl border border-border-subtle">
        <Info size={11} className="text-text-tertiary shrink-0 mt-[1px]" strokeWidth={2} />
        <p className="text-[11px] text-text-tertiary leading-relaxed">
          AI requests include chat replies, meeting title &amp; summary generation, and embeddings
          — not just manual messages.
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 animated fadeIn" data-interface-theme={interfaceTheme}>
      {/* ── Título da Página ───────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-text-primary tracking-[-0.01em]">
            Refract API
          </h3>
          <p className="text-[12px] text-text-tertiary mt-0.5 leading-snug">
            Managed transcription, AI &amp; search
          </p>
        </div>
        {!isLoading && isSaved && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
            <span className="text-[10px] font-semibold text-emerald-500 tracking-wide">
              {planLabel ?? 'Connected'}
            </span>
          </div>
        )}
      </div>

      {/* ── Modal de Trial Gratuito (pós-trial) ─────────────── */}
      {showTrialModal && trialState && (
        <FreeTrialModal usage={trialState.usage} onByok={handleByok} onDone={handleTrialDone} />
      )}

      {/* ── Cartão de status do trial ativo ──────────────────── */}
      {trialState?.active &&
        (() => {
          const sttMin = (trialState.usage.stt_seconds / 60).toFixed(1);
          return (
            <Card className="shadow-sm border-violet-500/25">
              <div className="px-5 pt-5 pb-5 space-y-4">
                {/* Cabeçalho — mesmo layout do cartão "Experimentar Refract API" */}
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-[11px] bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <RefractLogoMark size={18} className="text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-[13.5px] font-semibold text-text-primary tracking-tight">
                        Free Trial Active
                      </p>
                      <TrialCountdown expiresAt={trialState.expiresAt} />
                    </div>
                    <p className="text-[10.5px] text-text-tertiary mt-1">
                      {trialState.usage.ai} AI · {sttMin} min STT · {trialState.usage.search}{' '}
                      searches used
                    </p>
                  </div>
                </div>

                {/* Pílulas de uso de AI, STT e busca */}
                <div className="grid grid-cols-3 gap-2">
                  <TrialUsagePill
                    icon={Zap}
                    used={trialState.usage.ai}
                    limit={10}
                    label="AI"
                    unit=""
                  />
                  <TrialUsagePill
                    icon={Mic}
                    used={Math.round(trialState.usage.stt_seconds / 60)}
                    limit={10}
                    label="STT"
                    unit="m"
                  />
                  <TrialUsagePill
                    icon={Search}
                    used={trialState.usage.search}
                    limit={2}
                    label="Search"
                    unit=""
                  />
                </div>

                {/* Botão de chamada para ação */}
                <button
                  onClick={() => setShowTrialModal(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[9px] text-[12.5px] font-semibold bg-violet-600 hover:bg-violet-500 text-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] transition-all active:scale-[0.98] cursor-pointer"
                >
                  <ArrowUpRight size={13} strokeWidth={2.3} />
                  Keep the momentum going
                </button>
              </div>
            </Card>
          );
        })()}

      {/* ── Cartão de início do trial (sem chave e sem trial ativo) ── */}
      {!isLoading &&
        !isSaved &&
        !isCheckingTrial &&
        (!trialState || (trialState.expired && !trialState.active)) &&
        (() => {
          const isClaimed =
            trialState?.expired === true ||
            localStorage.getItem('refract_trial_claimed') === 'true';

          if (isClaimed) {
            return null;
          }

          return (
            <Card className="shadow-sm">
              <div className="px-5 pt-5 pb-4 flex flex-col items-center justify-center text-center">
                {/* Ícone promocional */}
                <div className="w-[42px] h-[42px] mb-3 rounded-[12px] bg-bg-input border border-border-subtle shadow-[inset_0_1px_rgba(255,255,255,0.06),0_2px_8px_rgba(0,0,0,0.04)] flex items-center justify-center relative overflow-hidden">
                  <RefractLogoMark
                    size={20}
                    className={
                      isClaimed ? 'text-text-tertiary' : 'text-text-primary drop-shadow-sm'
                    }
                  />
                </div>

                <h3 className="text-[14.5px] font-bold text-text-primary tracking-tight mb-1">
                  Refract API. Try it free.
                </h3>
                <p className="text-[12px] text-text-secondary leading-snug px-4 mb-4">
                  Experience managed text-to-speech, AI models, and real-time research without a
                  subscription.
                </p>

                {/* Grade de limites do trial */}
                <div className="flex items-center justify-center gap-3.5 mb-5 text-[11.5px] font-medium text-text-primary bg-bg-input px-3.5 py-2 rounded-[8px] border border-border-subtle shadow-[inset_0_1px_rgba(255,255,255,0.02)]">
                  <div className="flex flex-col items-center gap-1">
                    <Clock size={14} strokeWidth={2} className="text-blue-500" />
                    <span>30 min</span>
                  </div>
                  <div className="w-px h-5 bg-border-subtle/80" />
                  <div className="flex flex-col items-center gap-1">
                    <Brain size={14} strokeWidth={2} className="text-violet-500" />
                    <span>10 reqs</span>
                  </div>
                  <div className="w-px h-5 bg-border-subtle/80" />
                  <div className="flex flex-col items-center gap-1">
                    <Mic size={14} strokeWidth={2} className="text-emerald-500" />
                    <span>10m STT</span>
                  </div>
                  <div className="w-px h-5 bg-border-subtle/80" />
                  <div className="flex flex-col items-center gap-1">
                    <Search size={14} strokeWidth={2} className="text-orange-500" />
                    <span>2 searches</span>
                  </div>
                </div>

                <button
                  onClick={handleStartTrial}
                  disabled={trialLoading || isClaimed}
                  className={`w-full max-w-[240px] flex items-center justify-center gap-2 py-2 rounded-full text-[13px] font-bold shadow-[0_1px_3px_rgba(0,0,0,0.1)] transition-all ${
                    isClaimed
                      ? 'bg-bg-input text-text-tertiary border border-border-subtle cursor-not-allowed'
                      : 'bg-text-primary hover:bg-text-primary/90 text-bg-primary active:scale-[0.98]'
                  }`}
                >
                  {trialLoading ? (
                    <>
                      <Loader2 size={13} className="animate-spin" /> Starting trial…
                    </>
                  ) : isClaimed ? (
                    'Trial Already Claimed'
                  ) : (
                    'Start 10-Minute Free Trial'
                  )}
                </button>

                {/* Tratamento de erros */}
                {trialError && !isClaimed && (
                  <div className="flex items-center gap-1.5 px-3 py-2 mt-3 bg-red-500/10 border border-red-500/20 rounded-[8px]">
                    <AlertCircle size={13} className="text-red-500 shrink-0" strokeWidth={2} />
                    <p className="text-[11.5px] text-red-500 font-medium">{trialError}</p>
                  </div>
                )}

                <p className="text-[10.5px] text-text-tertiary font-medium mt-3">
                  No account needed — bound to this device.
                </p>

                <div className="w-[30px] h-px bg-border-subtle my-3" />

                <p className="text-[11px] text-text-secondary font-medium">
                  Already have an API key? Enter it below.
                </p>
              </div>
            </Card>
          );
        })()}

      {/* ── Plans ────────────────────────────────────────── */}
      {!isSaved && PlansCard}

      {/* ── Cartão de Chave de API ─────────────────────────────────── */}
      <Card>
        {/* Cabeçalho do cartão */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          {/* Tinted icon bem — Apple style */}
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0">
            <RefractLogoMark size={18} className="text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">API Key</p>
            <p className="text-[11px] text-text-tertiary leading-snug mt-0.5">
              Your Refract API key from your subscription email
            </p>
          </div>
        </div>

        {/* Divisor de linha fina */}
        <div className="h-px bg-border-subtle mx-5" />

        {/* Corpo do cartão */}
        <div className="px-5 pt-4 pb-5 space-y-3">
          {/* Linha do rótulo */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">
              Secret key
            </span>
            {isSaved && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-400 transition-colors duration-150 cursor-pointer"
              >
                <Trash2 size={11} strokeWidth={2} />
                Remove
              </button>
            )}
          </div>

          {/* Campo de entrada — com sombra interna para profundidade Apple */}
          <input
            type="text"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setIsSaved(false);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="refract_api_..."
            spellCheck={false}
            autoComplete="off"
            className={`w-full bg-bg-input border rounded-xl px-3.5 py-2.5 text-[13px] font-mono text-text-primary
                            placeholder:text-text-tertiary/50 placeholder:font-sans placeholder:text-[13px]
                            shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]
                            focus:outline-none transition-all duration-150
                            ${
                              error
                                ? 'border-red-500/40 focus:border-red-500/60 focus:ring-1 focus:ring-red-500/20'
                                : 'border-border-subtle focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/15'
                            }`}
          />

          {/* Mensagem de erro */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/8 border border-red-500/15 rounded-xl text-[12px] text-red-400">
              <AlertCircle size={13} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Botão de salvar */}
          <button
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className={`w-full py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 select-none
                            ${
                              isSaving
                                ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-wait'
                                : justSaved
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-pointer'
                                  : !isDirty
                                    ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-default'
                                    : 'bg-button-primary-bg hover:bg-button-primary-hover text-white shadow-sm active:scale-[0.99] cursor-pointer'
                            }`}
          >
            {isSaving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={13} className="animate-spin" />
                Saving…
              </span>
            ) : justSaved ? (
              <span className="flex items-center justify-center gap-2">
                <CheckCircle size={13} />
                Saved
              </span>
            ) : (
              'Save key'
            )}
          </button>

          {/* Dica para obter uma chave */}
          <p className="text-[11px] text-text-secondary leading-relaxed text-center">
            Don't have a key?{' '}
            <span
              onClick={() => openExternal(PLAN_STANDARD_URL)}
              className="text-blue-400 hover:text-blue-300 cursor-pointer transition-colors duration-150"
            >
              Subscribe to get one
            </span>
          </p>

          {/* Consentimento dos Termos e Condições */}
          <p className="text-[10.5px] text-text-tertiary leading-relaxed text-center">
            By saving your key, you agree to our{' '}
            <span
              onClick={() => openExternal('https://refract.software/refractapi/t&c')}
              className="text-text-secondary hover:text-text-primary underline decoration-border-subtle underline-offset-[3px] cursor-pointer transition-colors"
            >
              Terms &amp; Conditions
            </span>
            .
          </p>
        </div>
      </Card>

      {/* ── Cartão de Uso (quando conectado) ─────────────────── */}
      {isSaved && (
        <Card>
          {/* Cabeçalho do cartão de uso */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
                {isLoadingUsage && !usageData ? (
                  <Loader2 size={15} className="animate-spin text-violet-400" />
                ) : (
                  <CalendarClock size={15} className="text-violet-400" strokeWidth={1.75} />
                )}
              </div>
              <div>
                <p className="text-[13px] font-semibold text-text-primary">Usage this month</p>
                {usageData && (
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    Resets {fmtDate(usageData.quota.resets_at)}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={fetchUsage}
              disabled={isLoadingUsage}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-text-tertiary
                                hover:text-text-secondary hover:bg-bg-input transition-all duration-150
                                disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw
                size={11}
                className={isLoadingUsage ? 'animate-spin' : ''}
                strokeWidth={2}
              />
              Refresh
            </button>
          </div>

          {usageError && !usageData && (
            <div className="mx-5 mb-5 flex items-center gap-2 px-3 py-2.5 bg-red-500/8 border border-red-500/15 rounded-xl text-[12px] text-red-400">
              <AlertCircle size={13} className="shrink-0" /> {usageError}
            </div>
          )}

          {usageData && (
            <>
              {/* Faixa de estatísticas */}
              <div className="mx-5 mb-4 grid grid-cols-3 bg-bg-input border border-border-subtle rounded-2xl overflow-hidden divide-x divide-border-subtle">
                {[
                  {
                    label: 'STT mins',
                    value: usageData.quota.transcription.used,
                    color: 'text-blue-400',
                    glow: 'rgba(59,130,246,0.5)',
                  },
                  {
                    label: 'AI calls',
                    value: usageData.quota.ai.used,
                    color: 'text-violet-400',
                    glow: 'rgba(139,92,246,0.5)',
                  },
                  {
                    label: 'Searches',
                    value: usageData.quota.search.used,
                    color: 'text-emerald-400',
                    glow: 'rgba(16,185,129,0.5)',
                  },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex flex-col items-center py-4 px-3 gap-1">
                    <span
                      className={`text-[22px] font-semibold tabular-nums tracking-tight leading-none ${color}`}
                    >
                      {value.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-text-tertiary font-medium tracking-wide">
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Barras de progresso de uso */}
              <div className="px-5 pb-5 space-y-3.5">
                <QuotaBar
                  label="Transcription"
                  icon={Mic}
                  bucket={usageData.quota.transcription}
                  barColor="bg-blue-500"
                />
                <QuotaBar
                  label="AI requests"
                  icon={Brain}
                  bucket={usageData.quota.ai}
                  barColor="bg-violet-500"
                />
                <QuotaBar
                  label="Web searches"
                  icon={Search}
                  bucket={usageData.quota.search}
                  barColor="bg-emerald-500"
                />
              </div>
            </>
          )}
        </Card>
      )}

      {/* ── Plans ────────────────────────────────────────── */}
      {isSaved && PlansCard}

      {/* ── Como Funciona ─────────────────────────────────── */}
      <Card>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3.5">
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">
              How it works
            </p>
            <button
              onClick={() => openExternal('https://refract.software/pro')}
              className="flex items-center gap-1 text-[10px] font-semibold text-blue-400 hover:text-blue-300 uppercase tracking-widest transition-colors cursor-pointer"
            >
              Watch Demonstração <ArrowUpRight size={10} strokeWidth={2} />
            </button>
          </div>
          <div className="space-y-3">
            {[
              { step: '1', text: 'Subscribe above and complete checkout on Dodo Payments.' },
              { step: '2', text: 'Your API key is emailed instantly to your inbox.' },
              { step: '3', text: 'Paste it here — Refract handles the rest automatically.' },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-bg-input border border-border-subtle flex items-center justify-center text-[10px] font-bold text-text-tertiary shrink-0 mt-[1px]">
                  {step}
                </div>
                <p className="text-[12px] text-text-secondary leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Política de Reembolso ────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <Shield size={18} className="text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">Refund Policy</p>
            <p className="text-[11px] text-text-tertiary leading-snug mt-0.5">
              24-hour refund window — voucher purchases are final sale
            </p>
          </div>
        </div>

        <div className="h-px bg-border-subtle mx-5" />

        <div className="px-5 pt-4 pb-4">
          <div className="space-y-3">
            <div className="rounded-xl bg-bg-input/50 border border-border-subtle px-3.5 py-3">
              <p className="text-[11.5px] text-text-secondary leading-relaxed">
                <strong className="text-text-primary font-semibold">A quick heads-up:</strong>{' '}
                Refract is built and maintained by a single developer and integrates a lot of
                third-party services — AI providers, transcription engines, search APIs, payments,
                OS-level audio &amp; screen capture. That gives the app a lot of capability, but the
                surface area is wider than a typical closed-source product, and once in a while
                something may not behave exactly as expected. If you run into something like that,
                please <em>report it</em> rather than disputing the charge — we read every report
                and fixes typically land in the next update.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary/40 shrink-0 mt-[6px]" />
              <p className="text-[11.5px] text-text-secondary leading-relaxed">
                Purchases made with a coupon, voucher, referral credit, or limited-time offer are{' '}
                <strong className="text-text-primary font-semibold">final sale</strong> and not
                eligible for refund.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary/40 shrink-0 mt-[6px]" />
              <p className="text-[11.5px] text-text-secondary leading-relaxed">
                To cancel your subscription, log in to the{' '}
                <span
                  onClick={() => openExternal('https://customer.dodopayments.com/')}
                  className="text-blue-400 hover:text-blue-300 underline decoration-blue-400/40 underline-offset-[3px] cursor-pointer transition-colors"
                >
                  customer portal
                </span>{' '}
                to manage or cancel your plan.
              </p>
            </div>

            <div className="h-px bg-border-subtle mt-4 mb-3" />

            <p className="text-[11.5px] text-text-secondary leading-relaxed">
              For everything else — the 24-hour refund window, subscription handling, taxes &amp;
              fees, and your local consumer rights — please see our full{' '}
              <span
                onClick={() => openExternal('https://refract.software/refundpolicy')}
                className="text-text-primary hover:text-text-secondary underline decoration-border-subtle underline-offset-[3px] cursor-pointer transition-colors"
              >
                Refund Policy
              </span>
              . To request a refund or ask a question, email{' '}
              <span
                onClick={() => openExternal('mailto:refract.contact@gmail.com')}
                className="text-text-primary hover:text-text-secondary underline decoration-border-subtle underline-offset-[3px] cursor-pointer transition-colors"
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
    </div>
  );
};
