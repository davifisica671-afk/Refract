/**
 * DynamicActionBar.tsx
 *
 * Barra de ações dinâmicas ao vivo no estilo Refract.
 * Inscreve-se em eventos de ações dinâmicas do processo principal,
 * deduplica por ID, expira cartões obsoletos e renderiza até maxVisible cartões.
 * A tecla Tab aceita o cartão primário (de maior prioridade).
 */
import type { DynamicActionPayload } from '@/types/electron';
import { AnimatePresence } from 'framer-motion';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DynamicActionCard } from './DynamicActionCard';

interface Props {
  // Chamado quando o user accepts (ou hits Tab em o prprimário Parent deve
  // kick fora o live answer stream using action.promptInstruction.
  onAcceptAction: (action: DynamicActionPayload) => void;
  // Optional: max actions para keep visible. Limite estilo Refract de 3.
  maxVisible?: number;
  // Optional: como longo actions stay visible sem user interaction (ms).
  // Servidor side já expires; isso é o renderer-side cap.
  staleAfterMs?: number;
}

// DynamicActionBar — Linha de cards de ação ao vivo estilo Refract
// Subscribes para intelligence-dynamic-action events de o principal pprocesso
// dedupes por id, expires stale cards, e renderiza para cima para maxVisible cards.
// Tab keypress accepts o primário (highest-priority) card.
export const DynamicActionBar: React.FC<Props> = ({
  onAcceptAction,
  maxVisible = 3,
  staleAfterMs = 60_000,
}) => {
  const [actions, setActions] = useState<DynamicActionPayload[]>([]);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const handleIncoming = useCallback(
    (action: DynamicActionPayload) => {
      setActions((prev) => {
        // Dedupe por id (engine tem já deduped at backend, mas renderer
        // pode recebe late-arriving duplicates após a janela restore).
        if (prev.some((a) => a.id === action.id)) return prev;
        // Ordenar por priority desc, então createdAt desc (newer primeiro quando tied).
        const next = [...prev, action]
          .filter((a) => Date.now() - a.createdAt < staleAfterMs)
          .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
        return next.slice(0, maxVisible * 2); // keep a pequeno buffer past o visible cap
      });
    },
    [staleAfterMs, maxVisible],
  );

  const dismiss = useCallback((id: string) => {
    setActions((prev) => prev.filter((a) => a.id !== id));
    window.electronAPI?.dismissDynamicAction?.(id).catch(() => {
      /* swallow */
    });
  }, []);

  const accept = useCallback(
    async (action: DynamicActionPayload) => {
      // Optimistically remover de o barra então o user obtém immediate feedback.
      setActions((prev) => prev.filter((a) => a.id !== action.id));
      try {
        await window.electronAPI?.acceptDynamicAction?.(action.id);
      } catch {
        /* swallow — o pai answer flow é o fonte de truth */
      }
      onAcceptAction(action);
    },
    [onAcceptAction],
  );

  // Inscrever para push de principal processo
  useEffect(() => {
    const off = window.electronAPI?.onIntelligenceDynamicAction?.((data) => {
      if (data?.action) handleIncoming(data.action);
    });
    return () => {
      try {
        off?.();
      } catch {
        /* ignorar */
      }
    };
  }, [handleIncoming]);

  // Keyboard: Tab accepts primário
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const visible = actionsRef.current.slice(0, maxVisible);
      if (visible.length === 0) return;
      // Don't hijack Tab se focar é em an editable elemento — o user é typing.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      }
      e.preventDefault();
      void accept(visible[0]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accept, maxVisible]);

  // Periodic stale prune (cheap) — apenas executa quando actions exist
  useEffect(() => {
    if (actions.length === 0) return;
    const t = setInterval(() => {
      setActions((prev) => {
        if (prev.length === 0) return prev;
        return prev.filter((a) => Date.now() - a.createdAt < staleAfterMs);
      });
    }, 5_000);
    return () => clearInterval(t);
  }, [staleAfterMs, actions.length]);

  const visible = useMemo(() => actions.slice(0, maxVisible), [actions, maxVisible]);

  if (visible.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-1.5 px-3 pt-1 pb-1 w-full"
      data-testid="dynamic-action-bar"
      aria-label="Suggested actions"
    >
      <AnimatePresence initial={false}>
        {visible.map((a, i) => (
          <DynamicActionCard
            key={a.id}
            action={a}
            isPrimary={i === 0}
            onAccept={accept}
            onDismiss={dismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
