// src/components/onboarding/PermissionsOnboardingFull.tsx
//
// Página de permissões de primeira inicialização em tela cheia. Usa um layout premium de painel dividido:
// - Esquerda: Controles de permissão com estilo macOS, título elegante,
//   e alternâncias de alta fidelidade estilo iOS que animam com física.
// - Direita: Guia visual com mockup autêntico de diálogo macOS, mockup de
//   Preferências do Sistema, e cursor animado demonstrando como alternar permissões.
//
// Refinado com princípios de Design Engineering de Emil Kowalski.

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, Monitor, Mic, Lightbulb, Check, AlertCircle, ArrowRight, Lock } from 'lucide-react';
import { RefractLogoMark } from '../RefractLogoMark';
import refractIcon from '../icon.png';

const STORAGE_KEY  = 'refract_perms_shown_v1';

interface Props {
  isOpen:    boolean;
  onDismiss: () => void;
}

type PermStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'loading';

// ─── Design Tokens (Premium & Crafted) ────────────────────────
const COLORS = {
  pureSurface: '#FFFFFF',
  charcoalInk: '#18181B',
  mutedSteel:  '#71717A',
  lightBg:     '#F4F5F8',
  rule:        'rgba(0,0,0,0.06)',
  iosGreen:    '#34D399',
  iosGray:     '#E9E9EA',
  activeBlue:  '#007AFF',
};

const SPRING_EASE = [0.23, 1, 0.32, 1] as [number, number, number, number];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const itemVariants = {
  hidden:  { opacity: 0, y: 16, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: SPRING_EASE } },
};

// ─── Custom iOS-style Alternar Trocar Componente ──────────────────
const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled }) => {
  const reduced = useReducedMotion();
  return (
    <div
      onClick={(e) => {
        e.stopPropagation(); // Prevenir linha click collision
        if (!disabled) onChange();
      }}
      style={{
        width: '44px',
        height: '26px',
        borderRadius: '13px',
        backgroundColor: checked ? COLORS.iosGreen : '#E5E7EB',
        padding: '2px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        boxShadow: checked ? '0 0 12px rgba(52,211,153,0.25)' : 'none',
        transition: 'background-color 200ms cubic-bezier(0.23, 1, 0.32, 1)',
      }}
    >
      <motion.div
        layout
        animate={{ x: checked ? 18 : 0 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }}
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '11px',
          backgroundColor: '#F7F8FA',
          boxShadow: '0 2px 5px rgba(0,0,0,0.16), 0 1px 1px rgba(0,0,0,0.08)',
        }}
      />
    </div>
  );
};

// ─── High-Fidelity Permissão Linha Componente ────────────────────
function PermRow({
  icon: Icon,
  label,
  description,
  checked,
  onToggle,
  hasBadge = false,
}: {
  icon:        React.ElementType;
  label:       string;
  description: string;
  checked:     boolean;
  onToggle:    () => void;
  hasBadge?:   boolean;
}) {
  return (
    <motion.div
      variants={itemVariants}
      onClick={onToggle}
      whileHover={{ scale: 1.01, borderColor: 'rgba(0,0,0,0.1)' }}
      whileTap={{ scale: 0.985 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '18px 20px',
        borderRadius: '16px',
        background: '#FFFFFF',
        border: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.01)',
        cursor: 'pointer',
        transition: 'border-color 200ms, transform 150ms cubic-bezier(0.23, 1, 0.32, 1)',
      }}
    >
      {/* Icon bem */}
      <div style={{
        width: '44px',
        height: '44px',
        borderRadius: '12px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: checked ? 'rgba(52,211,153,0.08)' : '#F4F5F7',
        border: `1.5px solid ${checked ? 'rgba(52,211,153,0.15)' : 'rgba(0,0,0,0.02)'}`,
        position: 'relative',
        transition: 'background-color 200ms, border-color 200ms',
      }}>
        <Icon size={20} strokeWidth={2} color={checked ? COLORS.iosGreen : COLORS.charcoalInk} />
        
        {/* Overlay Green Tick Badge */}
        {hasBadge && checked && (
          <div style={{
            position: 'absolute',
            bottom: '-3px',
            right: '-3px',
            width: '15px',
            height: '15px',
            borderRadius: '50%',
            background: COLORS.iosGreen,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #FFFFFF',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}>
            <Check size={9} strokeWidth={4.5} color="#FFFFFF" />
          </div>
        )}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14.5px',
          fontWeight: 600,
          color: COLORS.charcoalInk,
          letterSpacing: '-0.01em',
          fontFamily: "'Inter', sans-serif"
        }}>
          {label}
        </div>
        <div style={{
          fontSize: '12.5px',
          color: COLORS.mutedSteel,
          marginTop: '3px',
          fontFamily: "'Inter', sans-serif",
          lineHeight: 1.4,
        }}>
          {description}
        </div>
      </div>

      {/* iOS Alternar Trocar */}
      <div style={{ flexShrink: 0 }}>
        <ToggleSwitch checked={checked} onChange={onToggle} />
      </div>
    </motion.div>
  );
}

// ─── Principal PermissionsOnboardingFull Componente ───────────────────
export const PermissionsOnboardingFull: React.FC<Props> = ({ isOpen, onDismiss }) => {
  const [platform,   setPlatform]   = useState<string>('darwin');
  const [micStatus,  setMicStatus]  = useState<PermStatus>('loading');
  const [scrStatus,  setScrStatus]  = useState<PermStatus>('loading');
  const [requesting, setRequesting] = useState(false);
  const [assistActive, setAssistActive] = useState(true);
  const [canClick, setCanClick] = useState(false);
  const reduced = useReducedMotion() ?? false;

  const refreshStatus = useCallback(async () => {
    try {
      const p = await window.electronAPI?.checkPermissions?.();
      if (!p) return;
      setPlatform(p.platform);
      setMicStatus(p.microphone as PermStatus);
      setScrStatus(p.screen     as PermStatus);
    } catch {
      setMicStatus('not-determined');
      setScrStatus('not-determined');
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setCanClick(false);
      return;
    }
    refreshStatus();
    // Safety cooldown para prevenir evento bubbling/double-clicks de Greetings transition
    const timer = setTimeout(() => {
      setCanClick(true);
    }, 600); 
    return () => clearTimeout(timer);
  }, [isOpen, refreshStatus]);

  // Re-check quando janela regains focar (user returned de System Preferences)
  useEffect(() => {
    if (micStatus === 'loading' || scrStatus === 'loading') return;
    const onFocus = () => refreshStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [micStatus, scrStatus, refreshStatus]);

  const handleMicRequest = async () => {
    if (!canClick) return;
    setRequesting(true);
    await window.electronAPI?.requestMicPermission?.();
    await refreshStatus();
    setRequesting(false);
  };

  const openScreenSettings = () => {
    if (!canClick) return;
    if (platform !== 'darwin') return;
    window.electronAPI?.openExternal?.('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  };

  const handleDismiss = () => {
    if (!canClick) return;
    localStorage.setItem(STORAGE_KEY, '1');
    window.electronAPI?.onboardingSetFlag?.('permsShown', true).catch(() => {});
    onDismiss();
  };

  if (!isOpen) return null;

  const allGranted = platform === 'darwin'
    ? micStatus === 'granted' && scrStatus === 'granted'
    : micStatus === 'granted';

  // Dynamic botão configurations based em ativo configura estado
  const getButtonConfig = () => {
    if (platform === 'darwin' && scrStatus !== 'granted') {
      return {
        label: 'Open screen settings',
        action: openScreenSettings,
        active: true,
      };
    }
    if (micStatus !== 'granted') {
      return {
        label: requesting ? 'Requesting access…' : 'Request microphone access',
        action: handleMicRequest,
        active: !requesting,
      };
    }
    return {
      label: 'All set — continue',
      action: handleDismiss,
      active: true,
    };
  };

  const btnConfig = getButtonConfig();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.3 } }}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          backgroundColor: '#FFFFFF',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          display: 'flex',
        }}
      >
        {/* CSS KEYFRAME ANIMATIONS Para O Direito PANEL VISUAL GUIDE */}
        <style>{`
          @keyframes mouseMove {
            0% { transform: translate(250px, 175px) scale(1); }
            12% { transform: translate(250px, 175px) scale(1); }
            38% { transform: translate(278px, 118px) scale(1); }      /* Mover to ampliar alternar */
            42% { transform: translate(278px, 118px) scale(0.84); }   /* Click abaixo */
            46% { transform: translate(278px, 118px) scale(1); }      /* Release */
            72% { transform: translate(278px, 118px) scale(1); }      /* Hover estado */
            92% { transform: translate(250px, 175px) scale(1); }      /* Retorna home */
            100% { transform: translate(250px, 175px) scale(1); }
          }

          @keyframes zoomToggleActive {
            0%, 41% { background-color: rgba(255,255,255,0.12); }
            42%, 73% { background-color: #34D399; }
            74%, 100% { background-color: rgba(255,255,255,0.12); }
          }

          @keyframes zoomToggleThumb {
            0%, 41% { transform: translateX(0); }
            42%, 73% { transform: translateX(12px); }
            74%, 100% { transform: translateX(0); }
          }
        `}</style>

        {/* ── LEFT PANEL: Permissions Controla ── */}
        <div
          className="relative flex flex-col items-center justify-center w-full lg:w-[50%] h-full p-12 bg-[#F7F8FA] overflow-hidden"
          style={{ borderRight: '1px solid rgba(0,0,0,0.04)' }}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="w-full max-w-[440px] flex flex-col justify-between h-full py-6"
          >
            {/* Top Bar Pular Button */}
            <motion.div variants={itemVariants} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <button 
                onClick={handleDismiss} 
                aria-label="Skip for now"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: COLORS.mutedSteel,
                  fontFamily: "'Inter', sans-serif",
                  padding: '6px 12px',
                  borderRadius: '8px',
                  opacity: 0.6,
                  transition: 'opacity 150ms, background 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.backgroundColor = '#F4F5F7'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                Skip for now
              </button>
            </motion.div>

            {/* Core Info & Title */}
            <div style={{ margin: 'auto 0' }}>
              <motion.h2
                variants={itemVariants}
                style={{
                  fontSize: '36px',
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                  color: COLORS.charcoalInk,
                  lineHeight: 1.25,
                  margin: '0 0 12px',
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                Let's get you set up
              </motion.h2>
              <motion.p
                variants={itemVariants}
                style={{
                  fontSize: '15.5px',
                  color: COLORS.mutedSteel,
                  lineHeight: 1.6,
                  margin: '0 0 36px',
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                Allow Refract the following system accesses to enable premium recording, real-time assist tools, and seamless audio transcriptions.
              </motion.p>

              {/* High-Fidelity Permissão lista items */}
              <motion.div variants={itemVariants} style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '36px' }}>
                
                {/* Item 1: Assist Alternar */}
                <PermRow
                  icon={Lightbulb}
                  label="Allow Refract to assist"
                  description="Refract can prompt you to start taking notes when you join a meeting."
                  checked={assistActive}
                  onToggle={() => setAssistActive(!assistActive)}
                  hasBadge={true}
                />

                {/* Item 2: Microphone Permissão */}
                <PermRow
                  icon={Mic}
                  label="Allow Refract to hear you"
                  description="Refract needs to capture your voice to transcribe your meetings in real-time."
                  checked={micStatus === 'granted'}
                  onToggle={micStatus !== 'granted' ? handleMicRequest : () => {}}
                  hasBadge={true}
                />

                {/* Item 3: Screen Capture Permissão */}
                <PermRow
                  icon={Monitor}
                  label="Allow Refract to see your screen"
                  description="Refract can answer questions about what you're viewing."
                  checked={scrStatus === 'granted'}
                  onToggle={openScreenSettings}
                />

              </motion.div>
            </div>

            {/* Bottom Primário CTA */}
            <motion.div variants={itemVariants}>
              <motion.button
                onClick={(e) => {
                  if (!canClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                  }
                  btnConfig.action();
                }}
                disabled={!btnConfig.active || !canClick}
                whileHover={canClick ? { scale: 1.01 } : {}}
                whileTap={canClick ? { scale: 0.98 } : {}}
                style={{
                  width: '100%',
                  height: '52px',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: (btnConfig.active && canClick) ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '0 24px',
                  background: btnConfig.active ? '#346DE6' : '#E5E7EB',
                  opacity: canClick ? 1 : 0.85,
                  boxShadow: btnConfig.active
                    ? '0 8px 24px rgba(37,99,235,0.24), inset 0 1px 0 rgba(255,255,255,0.16)'
                    : 'none',
                  transition: 'background 200ms, box-shadow 200ms, opacity 200ms, transform 150ms cubic-bezier(0.23, 1, 0.32, 1)',
                  fontFamily: "'Inter', sans-serif",
                  fontSize: '15.5px',
                  fontWeight: 600,
                  color: btnConfig.active ? '#FFFFFF' : '#9CA3AF',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <span style={{ position: 'relative', zIndex: 20 }}>{btnConfig.label}</span>
                <ArrowRight size={18} strokeWidth={2.5} color={btnConfig.active ? '#FFFFFF' : '#9CA3AF'} style={{ position: 'relative', zIndex: 20 }} />
              </motion.button>
              
            </motion.div>
          </motion.div>
        </div>

        {/* ── Direito PANEL: Visual Guide (High-Fidelity macOS Mockups) ── */}
        <div
          className="hidden lg:flex flex-col relative items-center justify-center overflow-hidden w-[50%] h-full"
          style={{ backgroundColor: COLORS.lightBg }}
        >
          {/* Subtle 48px por 48px Grid Pattern */}
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            pointerEvents: 'none',
            backgroundImage: `
              linear-gradient(to right, rgba(0,0,0,0.02) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(0,0,0,0.02) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
            backgroundPosition: 'center',
          }} />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.7, ease: SPRING_EASE }}
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: '100%',
              maxWidth: '380px',
            }}
          >
            {/* 1. macOS System Dialog Mockup */}
            <div style={{
              width: '350px',
              backgroundColor: '#FFFFFF',
              borderRadius: '16px',
              padding: '20px',
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}>
              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                {/* Refract App Icon com camera bem */}
                <div style={{
                  width: '42px',
                  height: '42px',
                  position: 'relative',
                  flexShrink: 0,
                }}>
                  <img
                    src={refractIcon}
                    alt="Refract Icon"
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '10px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                    }}
                  />
                  {/* Pequeno red recording dot overlay */}
                  <div style={{
                    position: 'absolute',
                    bottom: '-2px',
                    right: '-2px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    backgroundColor: '#EF4444',
                    border: '2px solid #FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#FFFFFF' }} />
                  </div>
                </div>

                {/* Dialog Content */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{
                    fontSize: '12.5px',
                    fontWeight: 650,
                    color: COLORS.charcoalInk,
                    lineHeight: 1.35,
                    fontFamily: "'Inter', sans-serif",
                  }}>
                    "Refract" would like to record this computer's screen and audio.
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: COLORS.mutedSteel,
                    lineHeight: 1.4,
                    fontFamily: "'Inter', sans-serif",
                  }}>
                    Grant access to this application in Privacy & Security settings, located in System Settings.
                  </div>
                </div>
              </div>

              {/* Ação Buttons dentro Dialog */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={openScreenSettings}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    backgroundColor: '#F3F4F6',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: COLORS.charcoalInk,
                    cursor: 'pointer',
                    fontFamily: "'Inter', sans-serif",
                    transition: 'background 150ms',
                  }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#E5E7EB'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = '#F3F4F6'}
                >
                  Open System Settings
                </button>
                <button
                  onClick={handleDismiss}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    backgroundColor: COLORS.activeBlue,
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#FFFFFF',
                    cursor: 'pointer',
                    fontFamily: "'Inter', sans-serif",
                    transition: 'opacity 150ms',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  Deny
                </button>
              </div>
            </div>

            {/* Subtle Divider Line */}
            <div style={{
              width: '80%',
              height: '1px',
              backgroundColor: 'rgba(0,0,0,0.06)',
              margin: '28px 0',
            }} />

            {/* 2. macOS System Settings Panel Mockup (com animated alternar trocar and cursor) */}
            <div style={{
              width: '350px',
              backgroundColor: '#FFFFFF',
              borderRadius: '16px',
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.02)',
              padding: '18px',
              position: 'relative',
            }}>
              {/* Settings Cabeçalho */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: COLORS.charcoalInk }}>
                  Screen & System Audio Recording
                </div>
                <div style={{ fontSize: '9.5px', color: COLORS.mutedSteel, lineHeight: 1.3 }}>
                  Allow the applications below to record the content of your screen and audio, even while using other applications.
                </div>
              </div>

              {/* Simulated Apps Lista */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* App Linha 1: 1Password */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: 0.55 }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" style={{ borderRadius: '5px', flexShrink: 0, backgroundColor: '#0E2F5C', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                    <circle cx="12" cy="12" r="7" fill="none" stroke="#3D86FC" strokeWidth="1.5" />
                    <circle cx="12" cy="12" r="5" fill="#3D86FC" />
                    <circle cx="12" cy="10.5" r="1.5" fill="#FFFFFF" />
                    <path d="M11 10.5H13V15.5H11V10.5Z" fill="#FFFFFF" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: 550, color: COLORS.charcoalInk, flex: 1 }}>1Password</span>
                  <div style={{ width: '28px', height: '16px', borderRadius: '8px', backgroundColor: '#34D399', padding: '1px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#FFFFFF' }} />
                  </div>
                </div>

                {/* App Linha 2: Slack */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: 0.55 }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" style={{ borderRadius: '5px', flexShrink: 0, backgroundColor: '#FFFFFF', padding: '2.5px', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                    <path d="M5.04 15.12a2.52 2.52 0 1 1-2.52-2.52h2.52v2.52z" fill="#36C5F0" />
                    <path d="M6.3 15.12a2.52 2.52 0 0 1 5.04 0v5.04a2.52 2.52 0 0 1-5.04 0v-5.04z" fill="#36C5F0" />
                    <path d="M8.88 5.04a2.52 2.52 0 1 1 2.52-2.52v2.52H8.88z" fill="#2EB67D" />
                    <path d="M8.88 6.3a2.52 2.52 0 0 1 0 5.04H3.84a2.52 2.52 0 0 1 0-5.04h5.04z" fill="#2EB67D" />
                    <path d="M18.96 8.88a2.52 2.52 0 1 1 2.52 2.52h-2.52V8.88z" fill="#ECB22E" />
                    <path d="M17.7 8.88a2.52 2.52 0 0 1-5.04 0V3.84a2.52 2.52 0 0 1 5.04 0v5.04z" fill="#ECB22E" />
                    <path d="M15.12 18.96a2.52 2.52 0 1 1-2.52 2.52v-2.52h2.52z" fill="#E01E5A" />
                    <path d="M15.12 17.7a2.52 2.52 0 0 1 0-5.04h5.04a2.52 2.52 0 0 1 0 5.04h-5.04z" fill="#E01E5A" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: 550, color: COLORS.charcoalInk, flex: 1 }}>Slack</span>
                  <div style={{ width: '28px', height: '16px', borderRadius: '8px', backgroundColor: '#34D399', padding: '1px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#FFFFFF' }} />
                  </div>
                </div>

                {/* App Linha 3: Refract (Active!) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <img
                    src={refractIcon}
                    alt="Refract"
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '5px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '11px', fontWeight: 650, color: COLORS.charcoalInk, flex: 1 }}>Refract</span>
                  <div style={{
                    width: '28px',
                    height: '16px',
                    borderRadius: '8px',
                    backgroundColor: '#34D399',
                    padding: '1px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    boxShadow: '0 0 6px rgba(52,211,153,0.3)',
                  }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#FFFFFF' }} />
                  </div>
                </div>

                {/* App Linha 4: ampliar (Animated alternar rolinha */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" style={{ borderRadius: '5px', flexShrink: 0, backgroundColor: '#2D8CFF', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                    <path d="M6 8.5C6 7.67157 6.67157 7 7.5 7H13.5C14.3284 7 15 7.67157 15 8.5V15.5C15 16.3284 14.3284 17 13.5 17H7.5C6.67157 17 6 16.3284 6 15.5V8.5Z" fill="white" />
                    <path d="M16 10L18.5 8C18.7761 7.77909 19 7.97541 19 8.33333V15.6667C19 16.0246 18.7761 16.2209 18.5 16L16 14V10Z" fill="white" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: 550, color: COLORS.charcoalInk, flex: 1 }}>zoom</span>
                  
                  {/* iOS trocar that animates com CSS */}
                  <div 
                    style={{
                      width: '28px',
                      height: '16px',
                      borderRadius: '8px',
                      padding: '1px',
                      display: 'flex',
                      alignItems: 'center',
                      position: 'relative',
                      animation: 'zoomToggleActive 4s infinite ease-in-out',
                    }}
                  >
                    <div 
                      style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '50%',
                        backgroundColor: '#FFFFFF',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                        animation: 'zoomToggleThumb 4s infinite ease-in-out',
                      }} 
                    />
                  </div>
                </div>

                {/* App Linha 5: Google Chrome */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: 0.55 }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" style={{ borderRadius: '5px', flexShrink: 0, backgroundColor: '#FFFFFF', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                    <path d="M12 0C7.4 0 3.4 2.6 1.4 6.4L6.9 16L12 8H23.5C22.3 3.3 17.6 0 12 0Z" fill="#EA4335" />
                    <path d="M6.9 16L1.4 6.4C0.5 8.1 0 10 0 12C0 17.6 4.1 22.2 9.5 23.8L15 14.3L6.9 16Z" fill="#34A853" />
                    <path d="M15 14.3L9.5 23.8C10.3 23.9 11.1 24 12 24C17.6 24 22.3 20.2 23.5 15.2L15 14.3Z" fill="#FBBC05" />
                    <path d="M12 7C9.2 7 7 9.2 7 12C7 14.8 9.2 17 12 17C14.8 17 17 14.8 17 12C17 9.2 14.8 7 12 7Z" fill="#FFFFFF" />
                    <path d="M12 8.5C10.1 8.5 8.5 10.1 8.5 12C8.5 13.9 10.1 15.5 12 15.5C13.9 15.5 15.5 13.9 15.5 12C15.5 10.1 13.9 8.5 12 8.5Z" fill="#4285F4" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: 550, color: COLORS.charcoalInk, flex: 1 }}>Google Chrome</span>
                  <div style={{ width: '28px', height: '16px', borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.12)', padding: '1px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#FFFFFF' }} />
                  </div>
                </div>
              </div>

              {/* Animated macOS Mouse Cursor pointing & clicking */}
              <div
                style={{
                  position: 'absolute',
                  top: '0px',
                  left: '0px',
                  zIndex: 10,
                  pointerEvents: 'none',
                  animation: 'mouseMove 4s infinite ease-in-out',
                }}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}>
                  <path d="M4.5 3V20.5L9.5 15.5L14 23L17.5 21L13 14L19 13.5L4.5 3Z" fill="black" stroke="white" strokeWidth="2.2" strokeLinejoin="miter"/>
                </svg>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
