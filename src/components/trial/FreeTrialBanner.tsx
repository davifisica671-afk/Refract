// src/components/trial/FreeTrialBanner.tsx
// Banner de contagem regressiva persistente exibido durante um trial ativo.
// Permanece visível durante toda a sessão, não é dispensável enquanto o trial está ativo.

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Clock, Mic, Search, Zap } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

// URL de checkout do plano Pro
const PLAN_PRO_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';

// Props do banner de trial
interface TrialBannerProps {
  expiresAt: string; // Carimbo de data/hora ISO
  usage: { ai: number; stt_seconds: number; search: number };
  onUpgrade: () => void; // Abre o modal de atualização
}

// Formata milissegundos em mm:ss
function fmt(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Componente de banner com contagem regressiva do trial
export const FreeTrialBanner: React.FC<TrialBannerProps> = ({ expiresAt, usage, onUpgrade }) => {
  // Estado: tempo restante calculado a partir da data de expiração
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(expiresAt).getTime() - Date.now()),
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Atualiza o tempo restante a cada segundo
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemaining(left);
      if (left === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    intervalRef.current = setInterval(tick, 1000);
    tick();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expiresAt]);

  // Estado visual: aviso quando restam menos de 2 minutos, expirado quando zero
  const isWarning = remaining > 0 && remaining < 2 * 60 * 1000;
  const expired = remaining === 0;

  // Percentuais de uso para as barras de progresso
  const aiPct = Math.min(100, (usage.ai / 10) * 100);
  const sttPct = Math.min(100, (usage.stt_seconds / 60 / 10) * 100);
  const searchPct = Math.min(100, (usage.search / 2) * 100);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        className={`
                    mx-3 mb-2 rounded-xl border px-3 py-2
                    ${
                      isWarning || expired
                        ? 'bg-amber-500/10 border-amber-500/30'
                        : 'bg-bg-item-surface border-border-subtle'
                    }
                `}
      >
        <div className="flex items-center justify-between gap-3">
          {/* Cronômetro: exibe o tempo restante do trial */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Clock
              size={12}
              strokeWidth={2}
              className={isWarning || expired ? 'text-amber-400' : 'text-text-tertiary'}
            />
            <span
              className={`text-[12px] font-mono font-semibold tabular-nums ${
                isWarning || expired ? 'text-amber-400' : 'text-text-secondary'
              }`}
            >
              {expired ? 'Trial ended' : fmt(remaining)}
            </span>
            <span className="text-[10px] text-text-tertiary/70 font-medium">free trial</span>
          </div>

          {/* Mini barras de uso de AI, STT e busca */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <UsagePip icon={Zap} pct={aiPct} label={`${usage.ai}/10 AI`} />
            <UsagePip
              icon={Mic}
              pct={sttPct}
              label={`${(usage.stt_seconds / 60).toFixed(1)}/10m STT`}
            />
            <UsagePip icon={Search} pct={searchPct} label={`${usage.search}/2 search`} />
          </div>

          {/* Botão de chamada para atualização */}
          <button
            onClick={onUpgrade}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 border border-violet-500/30 transition-colors shrink-0"
          >
            Upgrade
            <ArrowUpRight size={10} strokeWidth={2.5} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

// Mini indicador de uso: ícone + barra de progresso compacta
function UsagePip({
  icon: Icon,
  pct,
  label,
}: {
  icon: React.ElementType;
  pct: number;
  label: string;
}) {
  // Marca como "alto" quando o uso atinge 80% ou mais
  const isHigh = pct >= 80;
  return (
    <div className="flex items-center gap-1.5 min-w-0" title={label}>
      <Icon
        size={10}
        strokeWidth={2}
        className={isHigh ? 'text-amber-400 shrink-0' : 'text-text-tertiary/60 shrink-0'}
      />
      <div className="h-[3px] w-12 bg-bg-input rounded-full overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            isHigh ? 'bg-amber-400' : 'bg-violet-500/60'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
