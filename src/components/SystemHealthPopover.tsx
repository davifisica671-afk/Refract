import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  BrainCircuit,
  CalendarDays,
  ChevronRight,
  EyeOff,
  Mic,
  MonitorUp,
  RefreshCw,
  X,
  type LucideIcon,
} from 'lucide-react';

type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted';
type HealthTone = 'ready' | 'attention' | 'neutral' | 'loading';

interface HealthSnapshot {
  permissions: {
    microphone: PermissionState;
    screen: PermissionState;
    platform: string;
  } | null;
  sttProvider: string | null;
  llm: {
    provider: string;
    model: string;
  } | null;
  calendar: {
    connected: boolean;
    email?: string;
  } | null;
  undetectable: boolean | null;
}

interface HealthItem {
  id: string;
  icon: LucideIcon;
  label: string;
  detail: string;
  tone: HealthTone;
  actionLabel: string;
  onAction: () => void;
  pending?: boolean;
}

interface SystemHealthPopoverProps {
  onOpenSettings: (tab?: string) => void;
}

const INITIAL_SNAPSHOT: HealthSnapshot = {
  permissions: null,
  sttProvider: null,
  llm: null,
  calendar: null,
  undetectable: null,
};

const STT_LABELS: Record<string, string> = {
  none: 'Not configured',
  google: 'Google Speech',
  groq: 'Groq Whisper',
  openai: 'OpenAI Speech',
  deepgram: 'Deepgram',
  elevenlabs: 'ElevenLabs',
  azure: 'Azure Speech',
  ibmwatson: 'IBM Watson',
  soniox: 'Soniox',
  refract: 'Refract Pro',
  'local-whisper': 'Local Whisper',
};

const PROVIDER_LABELS: Record<string, string> = {
  ollama: 'Ollama',
  gemini: 'Gemini',
  custom: 'Custom provider',
  'codex-cli': 'Codex CLI',
  openai: 'OpenAI',
  groq: 'Groq',
  claude: 'Claude',
  deepseek: 'DeepSeek',
  refract: 'Refract',
};

const permissionDetail = (state: PermissionState | undefined, readyText: string) => {
  if (state === 'granted') return readyText;
  if (state === 'denied' || state === 'restricted') return 'Access blocked — review permission';
  if (state === 'not-determined') return 'Permission required before a session';
  return 'Unable to verify permission';
};

const compactModelName = (model: string) => {
  if (model.length <= 26) return model;
  return `${model.slice(0, 23)}…`;
};

const safeCall = async <T,>(call: (() => Promise<T>) | undefined): Promise<T | null> => {
  if (!call) return null;
  try {
    return await call();
  } catch {
    return null;
  }
};

function HealthRow({ item }: { item: HealthItem }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      className="system-health-row"
      data-tone={item.tone}
      onClick={item.onAction}
      disabled={item.pending}
      aria-label={`${item.label}: ${item.detail}. ${item.actionLabel}`}
    >
      <span className="system-health-row-icon" aria-hidden="true">
        <Icon size={15} strokeWidth={1.9} />
      </span>
      <span className="system-health-row-copy">
        <span className="system-health-row-title">
          <span className="system-health-dot" data-tone={item.tone} />
          {item.label}
        </span>
        <span className="system-health-row-detail">{item.detail}</span>
      </span>
      <span className="system-health-row-action">
        {item.pending ? <RefreshCw size={12} className="animate-spin" /> : item.actionLabel}
        {!item.pending && <ChevronRight size={12} />}
      </span>
    </button>
  );
}

export function SystemHealthPopover({ onOpenSettings }: SystemHealthPopoverProps) {
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<HealthSnapshot>(INITIAL_SNAPSHOT);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    const requestId = ++requestIdRef.current;
    setIsRefreshing(true);

    const [permissions, sttProvider, llm, calendar, undetectable] = await Promise.all([
      safeCall(api?.checkPermissions ? () => api.checkPermissions() : undefined),
      safeCall(api?.getSttProvider ? () => api.getSttProvider() : undefined),
      safeCall(api?.getCurrentLlmConfig ? () => api.getCurrentLlmConfig() : undefined),
      safeCall(api?.getCalendarStatus ? () => api.getCalendarStatus() : undefined),
      safeCall(api?.getUndetectable ? () => api.getUndetectable() : undefined),
    ]);

    if (requestId !== requestIdRef.current) return;

    setSnapshot({
      permissions,
      sttProvider,
      llm: llm ? { provider: llm.provider, model: llm.model } : null,
      calendar,
      undetectable,
    });
    setLastChecked(Date.now());
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh();

    const api = window.electronAPI;
    const cleanups = [
      api?.onUndetectableChanged?.(() => { void refresh(); }),
      api?.onModelChanged?.(() => { void refresh(); }),
      api?.onSttConfigChanged?.(() => { void refresh(); }),
      api?.onCredentialsChanged?.(() => { void refresh(); }),
    ];

    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);

    return () => {
      requestIdRef.current += 1;
      window.removeEventListener('focus', onFocus);
      cleanups.forEach((cleanup) => cleanup?.());
    };
  }, [refresh]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh]);

  const microphoneReady = snapshot.permissions?.microphone === 'granted';
  const screenReady = snapshot.permissions?.screen === 'granted';
  const sttReady = Boolean(snapshot.sttProvider && snapshot.sttProvider !== 'none');
  const llmReady = Boolean(snapshot.llm?.model);
  const hasInitialData = Object.values(snapshot).some((value) => value !== null);

  const coreIssueCount = [microphoneReady, screenReady, sttReady, llmReady]
    .filter((ready) => !ready).length;
  const overallTone: HealthTone = isRefreshing && !hasInitialData
    ? 'loading'
    : coreIssueCount === 0
      ? 'ready'
      : 'attention';
  const overallLabel = overallTone === 'loading'
    ? 'Checking system…'
    : coreIssueCount === 0
      ? 'Ready for a session'
      : `${coreIssueCount} ${coreIssueCount === 1 ? 'item needs' : 'items need'} attention`;

  const toneFor = (ready: boolean, known: boolean): HealthTone => {
    if (!known && isRefreshing) return 'loading';
    return ready ? 'ready' : 'attention';
  };

  const openSettings = useCallback((tab: string) => {
    setIsOpen(false);
    onOpenSettings(tab);
  }, [onOpenSettings]);

  const requestMicrophone = useCallback(async () => {
    if (microphoneReady) {
      openSettings('audio');
      return;
    }
    setPendingAction('microphone');
    await safeCall(window.electronAPI?.requestMicPermission
      ? () => window.electronAPI.requestMicPermission()
      : undefined);
    await refresh();
    setPendingAction(null);
  }, [microphoneReady, openSettings, refresh]);

  const openScreenAccess = useCallback(() => {
    if (screenReady) {
      openSettings('general');
      return;
    }
    if (window.electronAPI?.platform === 'darwin') {
      void window.electronAPI.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
      return;
    }
    openSettings('general');
  }, [openSettings, screenReady]);

  const enableUndetectable = useCallback(async () => {
    if (snapshot.undetectable) {
      openSettings('general');
      return;
    }
    setPendingAction('privacy');
    await safeCall(window.electronAPI?.setUndetectable
      ? () => window.electronAPI.setUndetectable(true)
      : undefined);
    await refresh();
    setPendingAction(null);
  }, [openSettings, refresh, snapshot.undetectable]);

  const items: HealthItem[] = [
    {
      id: 'microphone',
      icon: Mic,
      label: 'Microphone',
      detail: permissionDetail(snapshot.permissions?.microphone, 'Access granted'),
      tone: toneFor(microphoneReady, snapshot.permissions !== null),
      actionLabel: microphoneReady ? 'Audio' : 'Allow',
      onAction: () => { void requestMicrophone(); },
      pending: pendingAction === 'microphone',
    },
    {
      id: 'screen',
      icon: MonitorUp,
      label: 'Screen access',
      detail: permissionDetail(snapshot.permissions?.screen, 'Ready for visual context'),
      tone: toneFor(screenReady, snapshot.permissions !== null),
      actionLabel: screenReady ? 'Review' : 'Open',
      onAction: openScreenAccess,
    },
    {
      id: 'transcription',
      icon: Activity,
      label: 'Transcription',
      detail: snapshot.sttProvider
        ? (STT_LABELS[snapshot.sttProvider] || snapshot.sttProvider)
        : 'Unable to verify provider',
      tone: toneFor(sttReady, snapshot.sttProvider !== null),
      actionLabel: sttReady ? 'Audio' : 'Configure',
      onAction: () => openSettings('audio'),
    },
    {
      id: 'intelligence',
      icon: BrainCircuit,
      label: 'Intelligence',
      detail: snapshot.llm
        ? `${PROVIDER_LABELS[snapshot.llm.provider] || snapshot.llm.provider} · ${compactModelName(snapshot.llm.model)}`
        : 'Unable to verify model',
      tone: toneFor(llmReady, snapshot.llm !== null),
      actionLabel: llmReady ? 'Models' : 'Configure',
      onAction: () => openSettings('ai-providers'),
    },
    {
      id: 'calendar',
      icon: CalendarDays,
      label: 'Calendar',
      detail: snapshot.calendar?.connected
        ? (snapshot.calendar.email || 'Connected')
        : 'Not connected · optional',
      tone: snapshot.calendar === null && isRefreshing
        ? 'loading'
        : snapshot.calendar?.connected
          ? 'ready'
          : 'neutral',
      actionLabel: snapshot.calendar?.connected ? 'Manage' : 'Connect',
      onAction: () => openSettings('calendar'),
    },
    {
      id: 'privacy',
      icon: EyeOff,
      label: 'Privacy',
      detail: snapshot.undetectable
        ? 'Hidden from screen capture'
        : 'Visible to screen capture · optional',
      tone: snapshot.undetectable === null && isRefreshing
        ? 'loading'
        : snapshot.undetectable
          ? 'ready'
          : 'neutral',
      actionLabel: snapshot.undetectable ? 'Manage' : 'Enable',
      onAction: () => { void enableUndetectable(); },
      pending: pendingAction === 'privacy',
    },
  ];

  return (
    <div ref={rootRef} className="system-health-root no-drag">
      <button
        type="button"
        className="refract-topbar-button system-health-trigger flex items-center justify-center text-text-secondary"
        data-tone={overallTone}
        title={`System health: ${overallLabel}`}
        aria-label={`System health: ${overallLabel}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="system-health-popover"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Activity size={18} strokeWidth={1.8} />
        <span className="system-health-trigger-dot" data-tone={overallTone} aria-hidden="true" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            id="system-health-popover"
            role="dialog"
            aria-label="System health"
            className="system-health-popover"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 7, scale: 0.975 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.985 }}
            transition={{ duration: reducedMotion ? 0.01 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="system-health-header">
              <div className="system-health-summary-icon" data-tone={overallTone} aria-hidden="true">
                <Activity size={17} strokeWidth={1.9} />
              </div>
              <div className="system-health-summary-copy" aria-live="polite">
                <span className="system-health-eyebrow">System health</span>
                <strong>{overallLabel}</strong>
              </div>
              <div className="system-health-header-actions">
                <button
                  type="button"
                  className="system-health-icon-button"
                  onClick={() => { void refresh(); }}
                  aria-label="Refresh system health"
                  title="Refresh"
                >
                  <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                </button>
                <button
                  type="button"
                  className="system-health-icon-button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close system health"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="system-health-list">
              {items.map((item) => <HealthRow key={item.id} item={item} />)}
            </div>

            <div className="system-health-footer">
              <span>{lastChecked ? 'Checked just now' : 'Waiting for system status'}</span>
              <button type="button" onClick={() => openSettings('general')}>
                All settings
                <ChevronRight size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
