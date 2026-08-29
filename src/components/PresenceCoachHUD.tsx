import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePresenceCoach, type PresenceNudge } from '../hooks/usePresenceCoach';

const IS_PT = typeof navigator !== 'undefined' && /^pt\b/i.test(navigator.language || '');
const t = (pt: string, en: string) => (IS_PT ? pt : en);

const NUDGE_TEXT: Record<PresenceNudge['type'], string> = IS_PT
  ? {
      monologue: 'Você está há 1min sem passar a palavra',
      pace: 'Respira — ritmo acelerado',
      dominating: 'Você está dominando a conversa',
      interrupting: 'Deixe a pessoa terminar',
    }
  : {
      monologue: "You've talked for 1min straight",
      pace: 'Slow down — pace is high',
      dominating: "You're dominating the conversation",
      interrupting: 'Let them finish',
    };

/**
 * HUD discreto do Presence Coach. Enquanto `active`, mostra fala/escuta, ritmo
 * e vícios ao vivo + um toast de nudge efêmero. Clicar na pílula expande o card
 * de recap (fala/escuta final, ritmo médio, interrupções, top-3 vícios) — sob
 * demanda, porque o overlay não expõe um "fim de call" com janela pra render.
 * Tudo local; nada persiste.
 */
export default function PresenceCoachHUD({ active }: { active: boolean }) {
  const { snapshot: s, nudge, clearNudge } = usePresenceCoach(active);
  const [showRecap, setShowRecap] = useState(false);

  useEffect(() => {
    if (!nudge) return;
    const id = window.setTimeout(clearNudge, 3000);
    return () => window.clearTimeout(id);
  }, [nudge, clearNudge]);

  if (!active) return null;

  const warming = !s || s.elapsedMs < 30000;

  if (showRecap && s) {
    const top = Object.entries(s.fillers.byWord).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return (
      <div
        onClick={() => setShowRecap(false)}
        title={t('fechar', 'close')}
        className="overlay-pill-surface rounded-2xl px-4 py-3 overlay-text-primary text-[12px] space-y-1.5 cursor-pointer"
        style={{ minWidth: 220 }}
      >
        <div className="font-semibold text-[13px] flex items-center justify-between">
          {t('Resumo da call', 'Call recap')}
          <span className="opacity-45 text-[11px]">✕</span>
        </div>
        <div>{t('Fala/escuta', 'Talk/listen')}: <b>{s.talk.userPct}%</b> / {100 - s.talk.userPct}%</div>
        <div>{t('Ritmo médio', 'Avg pace')}: <b>{s.paceWpm}</b> wpm</div>
        <div>{t('Interrupções', 'Interruptions')}: <b>{s.interruptions}</b></div>
        {top.length > 0 && (
          <div>{t('Vícios', 'Fillers')}: {top.map(([w, c]) => `${w} (${c})`).join(' · ')}</div>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        onClick={() => { if (!warming) setShowRecap(true); }}
        title={warming ? '' : t('ver resumo', 'view recap')}
        className={`overlay-pill-surface rounded-full px-3 py-1.5 flex items-center gap-3 overlay-text-primary text-[11px] tabular-nums select-none ${warming ? '' : 'cursor-pointer'}`}
      >
        {warming ? (
          <span className="opacity-70">{t('aquecendo…', 'warming up…')}</span>
        ) : (
          <>
            <span title={t('fala / escuta', 'talk / listen')}>🗣 {s!.talk.userPct}%</span>
            <span title={t('ritmo (wpm)', 'pace (wpm)')} className={s!.paceWpm > 180 ? 'text-amber-300' : ''}>
              {s!.paceWpm} wpm
            </span>
            {s!.fillers.total > 0 && (
              <span title={t('vícios', 'fillers')} className="text-amber-300/90">◦ {s!.fillers.total}</span>
            )}
            <span className="opacity-40 text-[10px]">▾</span>
          </>
        )}
      </div>

      <AnimatePresence>
        {nudge && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="overlay-pill-surface rounded-full px-3.5 py-1.5 mt-2 text-[11.5px] overlay-text-primary pointer-events-none"
          >
            {NUDGE_TEXT[nudge.type]}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
