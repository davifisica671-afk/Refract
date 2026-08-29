import { useEffect, useRef, useState } from 'react';
import { createPresenceCoachEngine, type PresenceSnapshot, type PresenceNudge } from '../lib/presenceCoachEngine';

export type { PresenceSnapshot, PresenceNudge };

// v1: idioma dos vícios = locale da UI (proxy do idioma falado). Futuro: usar o
// idioma real do STT quando ele for exposto ao renderer.
const LANG = typeof navigator !== 'undefined' && /^pt\b/i.test(navigator.language || '') ? 'pt' : 'en';

/**
 * Assina o transcript nativo, alimenta o motor do Presence Coach e expõe o
 * snapshot ao vivo + o último nudge. `active=false` desliga a assinatura e o
 * ticker (ex.: fora de reunião), evitando trabalho quando o HUD está oculto.
 */
export function usePresenceCoach(active: boolean) {
  const engineRef = useRef(createPresenceCoachEngine({ lang: LANG }));
  const [snapshot, setSnapshot] = useState<PresenceSnapshot | null>(null);
  const [nudge, setNudge] = useState<PresenceNudge | null>(null);

  useEffect(() => {
    if (!active) return;
    const engine = engineRef.current;
    engine.reset();
    setSnapshot(null);
    const unsub = window.electronAPI?.onNativeAudioTranscript?.((t) => {
      engine.ingest({ speaker: t.speaker, text: t.text, timestamp: t.timestamp ?? Date.now(), final: t.final });
      const drained = engine.drainNudges();
      if (drained.length) setNudge(drained[drained.length - 1]);
    });
    const iv = window.setInterval(() => setSnapshot(engine.snapshot()), 250);
    return () => { unsub?.(); window.clearInterval(iv); };
  }, [active]);

  return { snapshot, nudge, clearNudge: () => setNudge(null) };
}
