/**
 * RefractInterface.tsx
 * Componente principal da interface de sobreposição (overlay) do Refract.
 * Fornece chat em tempo real com streaming de respostas, transcrição rolatte,
 * contexto de página do navegador, atalhos de teclado e múltiplos modos
 * de interação (o que responder, esclarecer, perguntas de acompanhamento, etc.).
 */
import {
  ArrowRight,
  ChevronDown,
  Code,
  Copy,
  Check,
  Globe,
  HelpCircle,
  Image,
  Lightbulb,
  List,
  MessageSquare,
  Mic,
  Pencil,
  PointerOff,
  RefreshCw,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react';
import {
  mergeRollingTranscriptFinal,
  mergeRollingTranscriptPartial,
} from '../../electron/utils/rollingTranscriptState';
import { categorizeSttError } from '../lib/sttErrorMapper';

import type { SkillSummary } from '../types/electron';

function SkillPicker({
  skills,
  selectedIndex,
  anchorEl,
  onSelect,
}: {
  skills: SkillSummary[];
  selectedIndex: number;
  anchorEl: HTMLElement | null;
  onSelect: (s: SkillSummary) => void;
}) {
  const rect = anchorEl?.getBoundingClientRect();
  if (!rect) return null;
  const style: React.CSSProperties = {
    position: 'fixed',
    left: rect.left,
    bottom: window.innerHeight - rect.top + 6,
    width: rect.width,
    zIndex: 9999,
  };
  return (
    <div style={style} className="rounded-xl border border-border-subtle bg-bg-card shadow-xl overflow-hidden max-h-48 overflow-y-auto">
      {skills.map((skill, i) => (
        <button
          key={skill.id}
          onMouseDown={(e) => { e.preventDefault(); onSelect(skill); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${i === selectedIndex ? 'bg-accent-primary/15 text-text-primary' : 'hover:bg-bg-subtle/50 text-text-secondary'}`}
        >
          <span className="text-[11px] font-mono text-amber-400 shrink-0">/{skill.id}</span>
          <span className="text-[11px] truncate flex-1">{skill.description}</span>
        </button>
      ))}
    </div>
  );
}

/** Intents que mostram conteúdo de resposta do LLM — fixa o painel de chat no primeiro token de streaming */
const ANSWER_PANEL_INTENTS = new Set([
  'what_to_answer',
  'chat',
  'recap',
  'clarify',
  'follow_up_questions',
  'shorten',
]);

const CardCopyButton = ({
  text,
  onCopy,
  isLightTheme,
  isModernTheme: _isModernTheme,
  isGlassTheme: _isGlassTheme,
}: {
  text: string;
  onCopy: (text: string) => void;
  isLightTheme?: boolean;
  isModernTheme?: boolean;
  isGlassTheme?: boolean;
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    onCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buttonColorClass = isLightTheme
    ? 'text-slate-400 hover:text-slate-700'
    : 'text-slate-500 hover:text-slate-200';

  return (
    <button
      onClick={handleCopy}
      className={`p-1 transition-colors duration-200 flex items-center justify-center ${buttonColorClass}`}
      title="Copy answer"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
};

import React, {
  startTransition as reactStartTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  collapseConsecutiveDuplicateSystemMessages,
  shouldDedupeOverlayAction,
} from '../lib/overlayActionDedup.mjs';
import { shouldDedupeManualSubmit } from '../lib/overlaySubmitDedup.mjs';
import {
  applyWhatToAnswerNullFeedbackMessages,
  finalizeStreamingByIntentMessages,
  prepareIntelligenceStreamPlaceholderMessages,
  discardStreamingByIntentMessages,
} from '../lib/overlayMessagePersistence.mjs';
import {
  resolveCgEventTapAvailable,
  shouldBlockFocus as shouldBlockStealthFocus,
  shouldFireStealthTapStart,
} from '../lib/overlayStealthFocusGuards.mjs';
import {
  shouldEagerExpandForCodeToken,
  shouldHoldEagerCodeExpansion,
} from '../lib/overlayCodeExpansion.mjs';
import {
  // OVERLAY_RESIZE_EASE (o bezier) é intentionally Não imported haqui o
  // live largura channel agora uses OVERLAY_RESIZE_SPRING para velocity-continuous,
  // interrupt-safe scroll-driven retargeting. O bezier remains exported de
  // o easing módulo para its pure/tested deterministic samplers.
  OVERLAY_RESIZE_DURATION_MS,
  OVERLAY_RESIZE_SPRING,
} from '../../electron/utils/overlayResizeEasing.mjs';
import { shouldAcceptIntelligenceIpc } from '../lib/overlayIntelligenceGeneration.mjs';
import { shouldUseStreamingCodeUi } from '../lib/overlayStreamingCodeUi.mjs';
import { widthDerivedScrollMax, verticalScrollCap } from '../lib/overlayScrollBudget.mjs';
import { resolveChatStreamToken, resolveChatStreamDone, resolveLiveAnswerBatch } from '../lib/chatStreamGuard.mjs';
import { isPointerOverContent } from '../lib/overlayHoverHitTest.mjs';
import {
  applyFirstStreamingToken,
  commitStreamingFlush,
  finalizeImperativeStreamMessages,
  shouldFlushPreviousStream,
} from '../lib/streamingTokenQueue.mjs';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';

SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('ts', typescript);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('rs', rust);
SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('c++', cpp);
SyntaxHighlighter.registerLanguage('csharp', csharp);
SyntaxHighlighter.registerLanguage('cs', csharp);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('markup', markup);
SyntaxHighlighter.registerLanguage('html', markup);
// importar { ModelSelector } de './ui/ModelSelector'; // REMOVED
import 'katex/dist/katex.min.css';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { genMessageId } from '../utils/messageId';
import { useShortcuts } from '../hooks/useShortcuts';
import { analytics, detectProviderType } from '../lib/analytics/analytics.service';
import type { MeetingInterfaceTheme } from '../lib/meetingInterfaceTheme';
import {
  getGlassOverlayAppearance,
  getOverlayAppearance,
  OVERLAY_OPACITY_DEFAULT,
} from '../lib/overlayAppearance';
import { NegotiationCoachingCard } from '../premium';
import type { DynamicActionPayload } from '../types/electron';
import { getCodexCliModelDisplayName } from '../utils/modelUtils';
import { getModifierSymbol, isMac } from '../utils/platformUtils';
import { DynamicActionBar } from './dynamic-actions/DynamicActionBar';
import GlassEffectLayer from './ui/GlassEffectLayer';
import PresenceCoachHUD from './PresenceCoachHUD';
import ResizeToggle from './ui/ResizeToggle';
import RollingTranscript from './ui/RollingTranscript';
import TopPill from './ui/TopPill';

// PERF: arrays de plugins elevados. ReactMarkdown recebe `remarkPlugins` e
// `rehypePlugins` como novos arrays literais se definidos inline no local de
// chamada — isso derrota seu bailout interno de renderização porque a identidade
// do array de plugins muda a cada renderização. Arrays no escopo do módulo são
// estáveis para sempre e compartilhados por toda renderização do ReactMarkdown
// neste componente
const REMARK_PLUGINS = [remarkGfm, remarkMath];
// KaTeX permissivo: nunca lança erro em math malformado (ex: `$$` vazio ou `$`
// desbalanceado); renderiza o span problemático em cor de erro em vez de deixar
// propagar saída corrompida caractere por caractere em toda a resposta.
const REHYPE_PLUGINS: any[] = [[rehypeKatex, { throwOnError: false, strict: false, errorColor: '#cc0000' }]];

import { DOM_CONTEXT_MAX_CHARS } from '../constants/domCapture';

interface Message {
  id: string;
  role: 'user' | 'system' | 'interviewer';
  text: string;
  isStreaming?: boolean;
  hasScreenshot?: boolean;
  screenshotPreview?: string;
  isCode?: boolean;
  intent?: string;
  // Código verificado: define quando o código nesta mensagem passou N testes
  // executados (renderer mostra um pequeno badge "✓ verificado"). undefined = não
  // verificado ainda — nunca mostramos o badge especulativamente.
  codeVerified?: { passed: number; total: number; language: string };
  // Marca uma mensagem que foi publicada como a CORREÇÃO de uma resposta errada anterior.
  isCorrection?: boolean;
  correctionNote?: string;
  isNegotiationCoaching?: boolean;
  negotiationCoachingData?: {
    tacticalNote: string;
    exactScript: string;
    showSilenceTimer: boolean;
    phase: string;
    theirOffer: number | null;
    yourTarget: number | null;
    currency: string;
  };
}

interface RefractInterfaceProps {
  onEndMeeting?: () => void;
  overlayOpacity?: number;
  interfaceTheme?: MeetingInterfaceTheme;
}

const buildConversationContextFromMessages = (items: Message[]): string =>
  items
    .filter((m) => m.role !== 'user' || !m.hasScreenshot)
    .map(
      (m) =>
        `${m.role === 'interviewer' ? 'Interviewer' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`,
    )
    .slice(-20)
    .join('\n');

// PERF: HighlightedCode renderiza um único bloco de código delimitado. Elevado
// para o escopo do módulo e envolto em React.memo então re-renderizações do pai
// não re-tokenizam blocos de código existentes. SyntaxHighlighter (Prism) não tem
// bailout interno de renderização — sem isso, cada token de streaming re-executa
// Prism sobre todo bloco de código no histórico. Os objetos customStyle /
// lineNumberStyle também estão no escopo do módulo então sua identidade
// referencial permanece estável também
const HC_CUSTOM_STYLE = {
  margin: 0,
  borderRadius: 0,
  fontSize: '13px',
  lineHeight: '1.6',
  background: 'transparent',
  padding: '16px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

interface HighlightedCodeProps {
  code: string;
  lang: string;
  isLightTheme: boolean;
  codeTheme: any;
  codeBlockClass: string;
  codeHeaderClass: string;
  codeHeaderTextClass: string;
  codeLineNumberColor: string;
  appearance: any;
  isModernTheme?: boolean;
  isGlassTheme?: boolean;
}

const mapLanguageForPrism = (lang: string, code: string): string => {
  if (!lang) {
    if (code.includes('def ') || code.includes('import ') || code.includes('elif ') || code.includes('print(') || code.includes(':\n')) {
      return 'python';
    }
    return 'javascript';
  }
  const lower = lang.toLowerCase().trim();
  const mapper: Record<string, string> = {
    'js': 'javascript',
    'javascript': 'javascript',
    'ts': 'typescript',
    'typescript': 'typescript',
    'py': 'python',
    'python': 'python',
    'rb': 'ruby',
    'ruby': 'ruby',
    'sh': 'bash',
    'bash': 'bash',
    'shell': 'bash',
    'zsh': 'bash',
    'go': 'go',
    'golang': 'go',
    'rs': 'rust',
    'rust': 'rust',
    'cs': 'csharp',
    'csharp': 'csharp',
    'cpp': 'cpp',
    'c++': 'cpp',
    'h': 'cpp',
    'c': 'c',
    'java': 'java',
    'kt': 'kotlin',
    'kotlin': 'kotlin',
    'swift': 'swift',
    'yml': 'yaml',
    'yaml': 'yaml',
    'xml': 'markup',
    'html': 'markup',
    'svg': 'markup',
    'json': 'json',
    'css': 'css',
    'md': 'markdown',
    'markdown': 'markdown',
    'sql': 'sql',
  };
  return mapper[lower] || lower;
};

const HighlightedCode = React.memo(
  function HighlightedCode({
    code,
    lang,
    codeTheme,
    codeBlockClass,
    codeHeaderClass,
    codeHeaderTextClass,
    codeLineNumberColor,
    appearance,
    isModernTheme,
    isGlassTheme,
  }: HighlightedCodeProps) {
    const isSpecialTheme = isModernTheme || isGlassTheme;
    return (
      <div
        className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`}
        style={isSpecialTheme ? undefined : appearance.codeBlockStyle}
      >
        {/* Cabeçalho Minimalista Apple */}
        <div
          className={`px-3 py-1.5 border-b ${codeHeaderClass}`}
          style={isSpecialTheme ? undefined : appearance.codeHeaderStyle}
        >
          <span
            className={`text-[10px] uppercase tracking-widest font-semibold font-mono ${codeHeaderTextClass}`}
          >
            {lang || 'CODE'}
          </span>
        </div>
        {/* Sem quebra — rolagem horizontal: o layout das linhas de código permanece
                estável enquanto o canvas cresce/encolhe. Sem isso, linhas quebradas
                re-fluxam a cada tick da mola, a altura do bloco treme e o conteúdo
                abaixo desloca. */}
        <div className="bg-transparent overflow-x-auto">
          <SyntaxHighlighter
            language={mapLanguageForPrism(lang, code)}
            style={codeTheme}
            customStyle={HC_CUSTOM_STYLE}
            wrapLongLines={false}
            showLineNumbers={true}
            lineNumberStyle={{
              minWidth: '2.5em',
              paddingRight: '1.2em',
              color: codeLineNumberColor,
              textAlign: 'right',
              fontSize: '11px',
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  },
  (prev, next) =>
    // codeTheme / codeBlockClass / appearance são todos theme-derived; checking
    // appearance (a useMemo'd ref) covers them transitively.
    prev.code === next.code &&
    prev.lang === next.lang &&
    prev.appearance === next.appearance &&
    prev.isModernTheme === next.isModernTheme &&
    prev.isGlassTheme === next.isGlassTheme,
);

// PERF: MessageRow renderiza um balão de mensagem de chat. Escopo do módulo +
// React.memo então re-renderizações do pai NÃO re-renderizam todas as mensagens
// anteriores — apenas a linha de streaming cuja referência `msg` realmente mudou
// é reconciliada.
//
// A combinação de (este memo) + (HighlightedCode memo) + (coalescência de tokens
// rAF) + (componentes ReactMarkdown elevados) elimina a tempestade de
// re-renderização de streaming: mensagens anteriores permanecem estruturalmente
// idênticas entre renderizações e saem deste limite preservando suas subárvores
// inteiras de Markdown / blocos de código, incluindo a tokenização Prism custosa.
//
// Contrato de identidade estável para o comparador funcionar de verdade:
//   - msg: setMessages sempre retorna um novo array mas o objeto por mensagem
//     preserva identidade para linhas que não mudam (o padrão de streaming
//     faz `[...prev]` então muta apenas `prev.length - 1`). Então === em msg
//     detecta corretamente "esta linha não mudou."
//   - appearance: useMemo'd no pai em [overlayOpacity, isLightTheme].
//   - onCopy / renderMessageText: useCallback'd no pai.
interface MessageRowProps {
  msg: Message;
  isLightTheme: boolean;
  appearance: any;
  onCopy: (text: string) => void;
  renderMessageText: (msg: Message) => React.ReactNode;
}
const formatProviderLabel = (provider?: string | null): string => {
  if (!provider) return 'not set';
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const getSttSummary = (
  userStatus: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio',
  interviewerStatus: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio',
  userProvider: string,
  interviewerProvider: string,
  notConfigured: boolean,
  userError?: string | null,
  interviewerError?: string | null,
): { label: string; tone: 'ok' | 'warn' | 'error'; detail: string } => {
  if (notConfigured) {
    return {
      label: 'STT not configured',
      tone: 'error',
      detail: 'Open Audio settings to select a provider',
    };
  }
  if (userStatus === 'failed' || interviewerStatus === 'failed') {
    const parts: string[] = [];
    if (userStatus === 'failed' && userError) parts.push(`Mic: ${userError}`);
    if (interviewerStatus === 'failed' && interviewerError) parts.push(`System: ${interviewerError}`);
    return {
      label: 'STT needs attention',
      tone: 'error',
      detail: parts.length > 0 ? parts.join(' · ') : `${formatProviderLabel(userProvider)} mic · ${formatProviderLabel(interviewerProvider)} system`,
    };
  }
  if (userStatus === 'reconnecting' || interviewerStatus === 'reconnecting') {
    return {
      label: 'STT reconnecting',
      tone: 'warn',
      detail: `${formatProviderLabel(userProvider)} mic · ${formatProviderLabel(interviewerProvider)} system`,
    };
  }
  if (userStatus === 'awaiting-audio' || interviewerStatus === 'awaiting-audio') {
    return {
      label: 'Listening for audio…',
      tone: 'warn',
      detail: `${formatProviderLabel(userProvider)} mic · ${formatProviderLabel(interviewerProvider)} system`,
    };
  }
  return {
    label: 'STT healthy',
    tone: 'ok',
    detail: `${formatProviderLabel(userProvider)} mic · ${formatProviderLabel(interviewerProvider)} system`,
  };
};

const getStatusToneClass = (tone: 'ok' | 'warn' | 'error'): string => {
  if (tone === 'error') return 'text-rose-600 dark:text-rose-300 border-rose-500/20 bg-rose-500/10';
  if (tone === 'warn')
    return 'text-amber-600 dark:text-amber-300 border-amber-500/20 bg-amber-500/10';
  return 'text-emerald-600 dark:text-emerald-300 border-emerald-500/20 bg-emerald-500/10';
};

// Rótulo de provedor compacto para o "pill de contexto da página" (ex: "example.com"),
// removendo o www. inicial. Retorna undefined para URL ausente/inalterável.
const hostnameFromUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
};

// Smart Browser Contexto v2 — label de chip específico por categoria. Volta para
// o host + "página pronta" para capturas legado de string simples (sem envelope de categoria).
const CATEGORY_CHIP_LABEL: Record<string, string> = {
  coding_problem: 'Coding problem',
  coding_editor: 'Coding editor',
  interview_assessment: 'Coding assessment',
  developer_docs: 'Developer docs',
  job_description: 'Job description',
  google_docs_visible: 'Google Docs',
  notes: 'Notes',
  article: 'Article',
};
const pageContextChipLabel = (pc: {
  title: string;
  url?: string;
  category?: string;
  platform?: string;
  partial?: boolean;
}): string => {
  const host = hostnameFromUrl(pc.url) || pc.title;
  if (!pc.category || pc.category === 'unknown') {
    return pc.partial ? `${host} · partial — capture manually?` : `${host} · page ready`;
  }
  const base = CATEGORY_CHIP_LABEL[pc.category] || 'Page context';
  const bits = [base];
  if (pc.platform) bits.push(pc.platform);
  // Para problemas de codificação o título da página geralmente é o nome do
  // problema — mostra ele.
  if ((pc.category === 'coding_problem' || pc.category === 'interview_assessment') && pc.title) {
    const t = pc.title.replace(/\s*[-–|·].*$/, '').trim(); // strip "- LeetCode" suffix
    if (t && t.length <= 40) bits.push(t);
  }
  // Sinal honesto de captura parcial informa ao usuário que a captura automática
  // era fina então ele pode pegar manualmente (selecionar o código ou pressionar
  // o atalho de captura).
  if (pc.partial) bits.push('partial — capture manually?');
  return bits.join(' · ');
};

const subtleSurfaceClass = 'overlay-subtle-surface';

const MessageRow = React.memo(
  function MessageRow({
    msg,
    isLightTheme,
    appearance: _appearance,
    onCopy: _onCopy,
    renderMessageText,
  }: MessageRowProps) {
    const isCodeMsg = msg.role === 'system' && (msg.isCode || msg.text.includes('```'));
    // bubbleMaxClass: balões do usuário são mais compactos; sistema + código usam a mesma largura.
    const bubbleMaxClass =
      msg.role === 'user'
        ? 'max-w-[72%] px-[13.6px] py-[10.2px]'
        : msg.role === 'system'
        ? 'max-w-[85%] p-0'
        : 'max-w-[85%] px-4 py-3';
    return (
      <div className="w-full" {...(isCodeMsg ? { 'data-code-msg': 'true' } : {})}>
        <div
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`
              ${bubbleMaxClass} text-[15px] leading-relaxed relative group whitespace-pre-wrap
              ${
                msg.role === 'user'
                  ? isLightTheme
                    ? 'bg-blue-500/10 backdrop-blur-md border border-blue-500/20 text-blue-900 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                    : 'bg-blue-600/20 backdrop-blur-md border border-blue-500/30 text-blue-100 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                  : ''
              }
              ${
                msg.role === 'system'
                  ? 'overlay-text-primary font-normal'
                  : ''
              }
              ${msg.role === 'interviewer' ? 'overlay-text-muted italic pl-0 text-[14px]' : ''}
            `}
            style={undefined}
          >
            {msg.role === 'interviewer' && (
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider overlay-text-muted">
                Interviewer
                {msg.isStreaming && (
                  <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                )}
              </div>
            )}
            {msg.role === 'user' && msg.hasScreenshot && (
              <div
                className={`flex items-center gap-1 text-[10px] opacity-70 mb-1 border-b pb-1 ${isLightTheme ? 'border-black/10' : 'border-white/10'}`}
              >
                <Image className="w-2.5 h-2.5" />
                <span>Screenshot attached</span>
              </div>
            )}
            {/* Cabeçalho de correção: esta mensagem corrige uma resposta errada anterior. */}
            {msg.role === 'system' && msg.isCorrection && (
              <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-amber-500">
                <span aria-hidden>↻</span>
                <span>Corrected answer{msg.correctionNote ? ` — ${msg.correctionNote}` : ''}</span>
              </div>
            )}
            {renderMessageText(msg)}
            {/* Badge verificado: o código nesta mensagem passou nos testes executados. */}
            {msg.role === 'system' && msg.codeVerified && (
              <div className="flex items-center gap-1 mt-1.5 text-[10px] font-medium text-green-500" title={`Ran ${msg.codeVerified.total} test case(s) successfully`}>
                <span aria-hidden>✓</span>
                <span>
                  {msg.codeVerified.language === 'verified'
                    ? 'verified by running the code'
                    : `verified · ${msg.codeVerified.passed}/${msg.codeVerified.total} test case${msg.codeVerified.total === 1 ? '' : 's'} passed`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.msg === next.msg &&
    prev.isLightTheme === next.isLightTheme &&
    prev.appearance === next.appearance &&
    prev.renderMessageText === next.renderMessageText &&
    prev.onCopy === next.onCopy,
);

const RefractInterface: React.FC<RefractInterfaceProps> = ({
  onEndMeeting,
  overlayOpacity = OVERLAY_OPACITY_DEFAULT,
  interfaceTheme = 'default',
}) => {
  const isLightTheme = useResolvedTheme() === 'light';
  const isGlassTheme = interfaceTheme === 'liquid-glass';
  const isModernTheme = interfaceTheme === 'modern';
  const shellRef = React.useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([]);
  const [skillPickerIndex, setSkillPickerIndex] = useState(0);
  const { shortcuts, isShortcutPressed } = useShortcuts();
  const [messages, setMessages] = useState<Message[]>([]);
  // Keep o histórico de chat visível uma vez que uma resposta chega até
  // limpeza explícita / reinício de sessão
  const [answerPanelPinned, setAnswerPanelPinned] = useState(false);
  const answerPanelPinnedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  // 'awaiting-audio' é o estado inicial correto do STT — ainda não produziu
  // uma transcrição, então não podemos declarar "conectado" (verde) apenas porque
  // o app foi iniciado. Mostrar verde antes de verificar áudio ao vivo mascara o
  // modo de falha TCC zero-fill onde permissões parecem concedidas mas nenhum
  // áudio realmente flui.
  const [sttUserStatus, setSttUserStatus] = useState<
    'connected' | 'reconnecting' | 'failed' | 'awaiting-audio'
  >('awaiting-audio');
  const [sttUserError, setSttUserError] = useState<string>('');
  const [sttUserProvider, setSttUserProvider] = useState<string>('');
  const [sttInterviewerStatus, setSttInterviewerStatus] = useState<
    'connected' | 'reconnecting' | 'failed' | 'awaiting-audio'
  >('awaiting-audio');
  const [sttInterviewerError, setSttInterviewerError] = useState<string>('');
  const [sttInterviewerProvider, setSttInterviewerProvider] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [conversationContext, setConversationContext] = useState<string>('');
  const [isManualRecording, setIsManualRecording] = useState(false);
  const isRecordingRef = useRef(false); // Ref para rastrear estado de gravação (evita closure obsoleto)
  const [manualTranscript, setManualTranscript] = useState('');
  const manualTranscriptRef = useRef<string>('');
  const [showTranscript, setShowTranscript] = useState(() => {
    const stored = localStorage.getItem('refract_interviewer_transcript');
    return stored !== 'false';
  });
  const [autoScroll, setAutoScroll] = useState(() => {
    const stored = localStorage.getItem('refract_auto_scroll');
    return stored === 'true';
  });

  // Estado de Analytics
  const requestStartTimeRef = useRef<number | null>(null);

  // Página de contexto do navegador capturada (da extensão companion
  // Latent como attachedContext: armazenada para a próxima resposta e
  // exibida como pill de status então a captura é visível, depois limpa
  // em uso / descarte / timeout. Declarada aqui — antes dos efeitos de
  // ponte DOM abaixo que a referenciam.
  const [pageContext, setPageContext] = useState<{
    title: string;
    url?: string;
    chars: number;
    at: number;
    // Smart Browser Contexto v2 — quando o envelope estruturado chega, o chip
    // mostra o label específico da categoria (ex: "Problema de codificação · LeetCode · Two Sum").
    category?: import('../types/electron').BrowserContextCategory;
    platform?: string;
    // Verdadeiro quando o extractor perdeu os campos essenciais (captura fina) — o
    // chip fica âmbar e convida a captura manual em vez de fingir que está completo.
    // `missing` lista o que não foi capturado (para o tooltip).
    partial?: boolean;
    missing?: string[];
  } | null>(null);

  // O envelope estruturado (Smart Browser Contexto v2) que chegou com a última
  // página de contexto, se houver. Guardado em ref então sobrevive re-renderizações
  // e é consumido uma vez (limpo) quando a requisição de resposta o lê.
  const capturedEnvelopeRef = useRef<import('../types/electron').ContextEnvelope | null>(null);

  // Seletor multi-aba: quando o usuário quer escolher qual aba do navegador
  // capturar (ex: a seleção automática pegou a errada), pedimos à extensão
  // suas abas abertas e mostramos uma lista compacta. null = fechado; [] = carregando/vazio.
  const [tabPicker, setTabPicker] = useState<Array<{ id: number; title: string; url: string }> | null>(null);
  const [tabPickerLoading, setTabPickerLoading] = useState(false);

  const openTabPicker = useCallback(async () => {
    setTabPickerLoading(true);
    setTabPicker([]);
    try {
      const res = await window.electronAPI?.phoneMirrorListTabs?.();
      setTabPicker(res?.tabs ?? []);
    } catch {
      setTabPicker([]);
    } finally {
      setTabPickerLoading(false);
    }
  }, []);

  const pickTab = useCallback(async (tabId: number) => {
    setTabPicker(null);
    try {
      await window.electronAPI?.phoneMirrorCaptureTab?.(tabId);
    } catch (_) {
      /* o desktop registra o motivo; o chip aparecerá em sucesso */
    }
  }, []);

  /**
   * BROWSER DOM CONTEXT INTEGRATION
   * ═════════════════════════════════════════════════════════════════
   *
   * This propriedade acts as a secure bridge entre o companion browser
   * extension e o Refract LLM pipeline. The extension captures the
   * ativo browser tab's DOM structure e writes it para isso property,
   * que is então passed através o secure sanitization pipeline before
   * being included in o LLM prompt.
   * 
   * FORMAT & CONSTRAINTS:
   *   - Type:     String apenas (non-strings rejected com warning)
   *   - Max Size: DOM_CONTEXT_MAX_CHARS = 25,000 characters
   *   - Content:  HTML structure ou plain texto representation of visible DOM
   *   - Encoding: UTF-8 (HTML entities escaped by PromptAssembler)
   * 
   * SECURITY PROPERTIES:
   *   - Configurable: falso (locked contra external tampering)
   *   - Trust Level:  UNTRUSTED_SCREEN (treated as user-controllable evidence)
   *   - Sanitized:   HTML escape + prompt injection detection + opcional redaction
   * 
   * LIFECYCLE:
   *   1. Companion browser extension POSTs DOM para PhoneMirrorService (HTTP /dom)
   *   2. PhoneMirrorService receives, validates pairing token, caps size, e broadcasts para renderer via IPC
   *   3. Renderer receives IPC 'dom-context-received' evento e sets window.lastCapturedDOM securely
   *   4. handleWhatToSay() reads o value
   *   5. Value is immediately cleared para prevent stale DOM leaking
   *   6. DOM passes através escapeUserContent() + escapePromptInjection()
   *   7. If injection detected, DOM block is optionally fully redacted
   *   8. Sanitized DOM included in PromptAssembler context packet
   * 
   * RATE LIMITS / SIZE BUDGETS:
   *   - Per-request max:    25,000 chars (auto-truncated)
   *   - LLM token budget:   6,000 tokens (enforced in buildDomContextBlock)
   *   - Escape overhead:    ~1.2x (HTML entities expand size)
   * 
   * EXAMPLE EXTENSION CODE:
   * 
   *   // In your companion browser extension background/content script:
   *   const capturedDOM = document.documentElement.innerHTML;
   *   fetch('http://localhost:<port>/dom?t=<token>', {
   *     method: 'POST',
   *     headers: { 'Content-Type': 'application/json' },
   *     body: JSON.stringify({ dom: capturedDOM })
   *   });
   */
  useEffect(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'lastCapturedDOM');
    // Se já definido em janela com segurança (configurable: false da uma
    // definição anterior), pula a redefinição para evitar TypeError sob
    // configurable: false, mas preserva o comportamento de limpeza na reinicialização.
    if (descriptor && descriptor.configurable === false) {
      return () => {
        try {
          (window as any).lastCapturedDOM = '';
        } catch (_) {}
      };
    }

    // Remove limpa qualquer propriedade pre-plantada configurable para prevenir conflitos
    if (descriptor) {
      try {
        delete (window as any).lastCapturedDOM;
      } catch (_) {}
    }

    let lastCapturedDOM = '';
    try {
      Object.defineProperty(window, 'lastCapturedDOM', {
        get() {
          return lastCapturedDOM;
        },
        set(value) {
          if (typeof value === 'string') {
            lastCapturedDOM = value.substring(0, DOM_CONTEXT_MAX_CHARS);
          } else {
            console.warn('[Security] Rejected non-string assignment to window.lastCapturedDOM');
          }
        },
        enumerable: true,
        configurable: false, // Trancado com segurança para prevenir adulteração por scripts externos
      });
    } catch (error: any) {
      console.warn('[Security] window.lastCapturedDOM definition skipped:', error?.message || error);
    }

    return () => {
      try {
        (window as any).lastCapturedDOM = '';
      } catch (_) {}
    };
  }, []);

  // Escuta eventos de ponte cross-process seguros da extensão companion do navegador.
  // O desktop entrega (dom, meta?) — armazena o DOM para a próxima resposta E
  // exibe um "pill de contexto de página" então a captura é visível para o usuário
  // (caso contrário o DOM fica invisível em window.lastCapturedDOM até ser consumido).
  useEffect(() => {
    let unsubDom: (() => void) | undefined;
    try {
      unsubDom = window.electronAPI?.onDomContextReceived?.((dom, meta, envelope) => {
        (window as any).lastCapturedDOM = dom;
        // Armazena o envelope estruturado (Smart Browser Contexto v2) então handleWhatToSay
        // pode incluí-lo na requisição de resposta junto com a string legada domContext
        capturedEnvelopeRef.current = envelope ?? null;
        if (typeof dom === 'string' && dom.trim().length > 0) {
          setPageContext({
            title: meta?.title?.trim() || hostnameFromUrl(meta?.url) || 'Captured page',
            url: meta?.url,
            chars: dom.length,
            at: Date.now(),
            category: envelope?.category,
            platform: envelope?.meta?.platform,
            partial: envelope?.meta?.partial,
            missing: envelope?.meta?.missing,
          });
        }
      });
    } catch (e) {
      console.warn('[Security] Failed to register onDomContextReceived listener:', e);
    }

    return () => {
      if (unsubDom) {
        try {
          unsubDom();
        } catch (_) {}
      }
    };
  }, []);

  // Expira automaticamente o pill de contexto de página capturado se nunca for
  // consumido. O DOM em si é limpo em uso (handleWhatToSay) ou descarte;
  // isso é apenas para o pill não permanecer indefinidamente após a captura
  // que o usuário não terminou de usar.
  useEffect(() => {
    if (!pageContext) return;
    const timer = setTimeout(() => {
      setPageContext(null);
      try {
        if (typeof (window as any).lastCapturedDOM === 'string') {
          (window as any).lastCapturedDOM = '';
        }
      } catch (_) {}
    }, 90_000);
    return () => clearTimeout(timer);
  }, [pageContext]);

  // Sincroniza configuração de transcrição
  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('refract_interviewer_transcript');
      setShowTranscript(stored !== 'false');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Sincroniza configuração de auto-scroll
  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('refract_auto_scroll');
      setAutoScroll(stored === 'true');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Auto-scroll para o fundo em toda atualização de mensagens quando a alternativa
  // está habilitada. 'auto' (instantâneo) em vez de 'smooth' é intencional: tokens
  // de streaming disparam este efeito dezenas de vezes por segundo; smooth
  // reiniciaria a animação a cada vez e nunca chegaria ao fundo, produzindo
  // perseguição/tremor visível.
  useEffect(() => {
    if (!autoScroll) return;
    if (messages.length === 0) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, autoScroll]);

  const hasActiveSystemAnswer = useMemo(
    () =>
      messages.some(
        (m) =>
          m.role === 'system' &&
          (m.isStreaming || (typeof m.text === 'string' && m.text.trim().length > 0)),
      ),
    [messages],
  );

  // Fixa automaticamente uma vez que qualquer linha de resposta do sistema exista
  // (streaming ou completa) então uma chamada perdida pinAnswerPanel() não pode
  // colapsar o painel de chat no meio de uma resposta.
  useEffect(() => {
    if (hasActiveSystemAnswer) {
      answerPanelPinnedRef.current = true;
      setAnswerPanelPinned(true);
    }
  }, [hasActiveSystemAnswer]);

  useEffect(() => {
    answerPanelPinnedRef.current = answerPanelPinned;
  }, [answerPanelPinned]);

  const [rollingTranscript, setRollingTranscript] = useState(''); // Para a barra de texto rolatte do entrevistador
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false); // Rastreia se está falando ativamente
  // Debounce de ticks parciais do STT então linhas de resposta/solução não são
  // inundadas com re-renderizações.
  const rollingPartialDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRollingPartialRef = useRef<string | null>(null);
  const interviewerSpeakingRef = useRef(false);
  const pinAnswerPanelRef = useRef<() => void>(() => {});
  const [voiceInput, setVoiceInput] = useState(''); // Entrada de voz acumulada do usuário
  const voiceInputRef = useRef<string>(''); // Ref para captura em handlers assíncronos
  const textInputRef = useRef<HTMLInputElement>(null); // Ref para foco da entrada
  const isStealthRef = useRef<boolean>(false); // Rastreia se a próxima expansão deve ser sigilosa
  // Guardas de flicker na inicialização (restaurados de 2de1b62, revertidos por 18b139b):
  //  - isExpandedEffectInitializedRef: pula a primeira execução do efeito de
  //    sincronização de visibilidade então o mount-time isExpanded=true não dispara
  //    showWindow() e re-entra em switchToOverlay() (setBounds duplo + flash de foco)
  //    além da trocar main.startMeeting() já realizada.
  //  - hasRenderedExpandedRef: suprime a animação de entrada de escala/translate do
  //    shell no primeiro conteúdo renderizado (é o momento em que a janela do SO
  //    está simultaneamente ajustando seus limites, então a interpolação de
  //    transformação pareceria um tremor). Re-expansões após montagem ainda animam.
  const isExpandedEffectInitializedRef = useRef(false);
  const hasRenderedExpandedRef = useRef(false);
  // Estado de digitação sigilosa CGEventTap. Impulsionado por IPC do main; a ref
  // reflete o estado então o manipulador de tecla capturada pode sair cedo sem
  // depender do ciclo de renderização do React para sinais.
  const [stealthTapActive, setStealthTapActive] = useState<boolean>(false);
  const stealthTapActiveRef = useRef<boolean>(false);
  // Verdadeiro quando o caminho de engajamento sigiloso por clique é seguro.
  // Falso quando um IME (Pinyin / Hangul / Kanji / …) está habilitado no
  // macOS HIToolbox: o tap captura abaixo do IME então a composição nunca
  // alcança a caixa de chat. Resolvido uma vez na montagem via IPC (padrão
  // verdadeiro então non-macOS / falha de probe volta para comportamento existente).
  const stealthAutoEngageOkRef = useRef<boolean>(true);
  // Verdadeiro quando CGEventTap está disponível nesta plataforma. Padrão falso
  // então a entrada permanece clicável até que a disponibilidade seja confirmada.
  const isCgEventTapAvailableRef = useRef<boolean>(false);
  // Ref do último manipulador então o ouvinte de tecla capturada (montado com [] deps)
  // chama o closure ATUAL de handleManualSubmit — não o capturado no primeiro
  // render que lê inputValue="" e faz noop silencioso no submit.
  // Atualizado em cada render abaixo
  const handleManualSubmitRef = useRef<() => void>(() => {});
  /** Bloqueia envios digitados concorrentes (clique duplo / repetição de tecla) antes que o estado React atualize */
  const manualSubmitInFlightRef = useRef(false);
  const lastManualSubmitRef = useRef<{ text: string; atMs: number } | null>(null);
  /** Bloqueia chamadas LLM de ações rápidas duplicadas (Esclarecer, Acompanhamento, Brainstorm, Resposta). */
  const overlayActionInFlightRef = useRef(new Set<string>());
  const lastOverlayActionRef = useRef<{ key: string; atMs: number } | null>(null);
  // Definido quando o usuário tentou engajar o tap mas Acessibilidade ainda não
  // foi concedida. Renderiza o banner de permissão inline então nunca falhamos
  // silenciosamente — o onboarding é nosso diferencial UX; replicamos isso.
  const [stealthPermissionMissing, setStealthPermissionMissing] = useState<boolean>(false);
  // Definido quando o KeybindManager relata que o atalho global de digitação
  // sigilosa falhou ao registrar (o SO já o possui — comum com Cmd+Shift+Space
  // se outro app o reivindicou, ou com o alternador de fonte de entrada do
  // macOS em algumas configurações). Armazena o acelerador tentado então o
  // banner pode dizer ao usuário exatamente o que conflitou.
  const [stealthHotkeyConflict, setStealthHotkeyConflict] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resizeToggleRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rafDimUpdateRef = useRef<number | null>(null);
  const codeExpandedRef = useRef(false);
  // Conjunto quando tokens de streaming provaram que a linha atual é código antes
  // do React ter montado uma linha [data-code-msg]. Enquanto verdadeiro, o scanner
  // de visibilidade não deve imediatamente contradizer a expansão ansiosa e
  // agendar o colapso
  const eagerCodeExpansionHoldRef = useRef(false);
  const animationControlsRef = useRef<ReturnType<typeof animate> | null>(null);
  // Honora a configuração de acessibilidade "Reduzir Movimento" do SO (WCAG 2.3.3).
  // Quando o usuário prefere movimento reduzido, SNAP a largura do shell em vez
  // de animá-la com mola — mesmo estado final, viagem animada zero. A ref (não
  // estado então o streaming-hot startTransition lê sem re-render; atualizada ao
  // vivo pelo ouvinte matchMedia abaixo então alternar a configuração do SO
  // surte efeito sem reiniciar o app.
  const prefersReducedMotionRef = useRef(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  // Prazo de relógio de parede até que a animação de largura CSS esteja rodando.
  // A janela do SO tem LARGURA FIXA (OVERLAY_WINDOW_WIDTH = 780) e nunca redimensiona
  // em largura; apenas o painel CSS anima 600↔780 centralizado dentro dela. Mas
  // mudança de largura CSS refluxa a ALTURA do conteúdo a cada quadro, disparando
  // o ResizeObserver ~60×, e a altura setBounds a cada um re-rasteriza a janela
  // de fundo transparente com desfoque → flicker. Então enquanto estamos antes
  // deste prazo, a reportagem de altura do próprio ResizeObserver é SUPRIMIDA;
  // a animação de largura em vez disso conduz um canal de altura ÚNICO com
  // TAXA LIMITADA (~30fps) + um settle autoritativo no onComplete (ver startTransition).
  // (Largura nunca é reportada como qualquer coisa além do fixo 780, então não há
  // setBounds de largura para suprimir — esse é o objetivo da correção.)
  //
  // Um PRAZO AUTODESTRUTIVO (não um booleano limpo por onComplete do framer) é
  // deliberado: framer's onEnd para não disparar onComplete, então o booleano poderia
  // permanecer verdadeiro para sempre em uma animação interrompida/redirecionada e
  // congelar permanentemente a reportagem de altura. O prazo expira sozinho para
  // 0 para liberar imediatamente (reinicialização de sessão).
  const heightReportSuppressedUntilRef = useRef(0);
  // Gate de estabilidade para transições de visibilidade de código. Rola a ~60Hz;
  // isso debounca o scanner então blocos de código cintilando pela borda do
  // viewport durante rolagem rápida não disparam a transição a cada quadro.
  // A animação de largura é agora uma MOLA interrompível-segura que redireciona
  // com continuidade de velocidade (então o re-disparo em voo não trava mais —
  // era o stutter de reinício bezier antigo), mas o gate ainda vale: agrupa
  // cruzamentos rápidos de borda em uma direção comprometida e evita churn
  // desnecessário de animate(). A visibilidade pendente precisa manter seu novo
  // estado por STABILITY_MS antes de comprometermos.
  const stableVisibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVisibilityRef = useRef<boolean | null>(null);
  // Sticky-bottom através expand/contrair. Capturado no início de cada
  // transição: se o chat estava rolado para (ou dentro de 8px do) fundo,
  // o loop rAF fixa scrollTop para o fundo em cada quadro da mola então o
  // fundo da conversa permanece visualmente fixo enquanto scrollMaxH cresce.
  // o iMessage faz o mesmo quando sua janela redimensiona.
  const wasAtBottomRef = useRef<boolean>(true);
  // Captura dados de onCaptureAndProcess antes do estado React esvaziar então
  // handleWhatToSay() pode acessar até no React 18 concurrent mode (onde
  // um setTimeout(0) simples pode disparar antes setAttachedContext fazer flush).
  const pendingCaptureRef = useRef<{ path: string; preview: string } | null>(null);

  // Estado de Contexto Latente (Screenshots anexados mas não enviados)
  const [attachedContext, setAttachedContext] = useState<Array<{ path: string; preview: string }>>(
    [],
  );

  // Estado de Configurações com Persistência
  const [isUndetectable, setIsUndetectable] = useState(false);
  const [hideChatHidesWidget, setHideChatHidesWidget] = useState(() => {
    const stored = localStorage.getItem('refract_hideChatHidesWidget');
    return stored ? stored === 'true' : true;
  });

  // Nome do modo ativo (exibido como badge perto do botão Modos)
  const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);
  const [llmProviderLabel, setLlmProviderLabel] = useState<string>('unknown');
  const [llmPrivacyLabel, setLlmPrivacyLabel] = useState<string | null>(null);
  const [screenContextStatus, setScreenContextStatus] = useState<
    'not_available' | 'available' | 'failed'
  >('not_available');
  const [latestUsedImageInput, setLatestUsedImageInput] = useState(false);
  // Proveniência Vision-first — populado da resposta do generateWhatToSay
  const [latestVisionProviderUsed, setLatestVisionProviderUsed] = useState<string | undefined>(
    undefined,
  );
  const [latestVisionModelUsed, setLatestVisionModelUsed] = useState<string | undefined>(undefined);
  const [latestVisionFailureReason, setLatestVisionFailureReason] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    // Carrega o nome do modo ativo inicial
    window.electronAPI
      ?.modesGetActive?.()
      .then((mode: { name: string } | null) => setActiveModeLabel(mode?.name ?? null))
      .catch(() => {});
    // Atualização ao vivo sempre que o modo é ativado/desativado
    const unsub = window.electronAPI?.onModeChanged?.(
      (data: { id: string | null; name: string | null }) => {
        setActiveModeLabel(data.name);
      },
    );
    return () => unsub?.();
  }, []);

  useEffect(() => {
    window.electronAPI?.skillsRefresh?.()
      .then((list: SkillSummary[]) => setAvailableSkills(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadLlmRoute = async () => {
      const config = await window.electronAPI?.getCurrentLlmConfig?.().catch(() => null);
      if (!mounted || !config) return;
      setLlmProviderLabel(formatProviderLabel(config.provider));
      setLlmPrivacyLabel(
        config.provider === 'ollama' || config.provider === 'codex-cli'
          ? 'Local/private route'
          : config.provider === 'custom'
            ? 'Custom endpoint route'
            : null,
      );
    };
    loadLlmRoute();
    const unsub = window.electronAPI?.onModelChanged?.(() => {
      loadLlmRoute();
    });
    return () => {
      mounted = false;
      unsub?.();
    };
  }, []);

  // Estado de seleção de modelo
  const [currentModel, setCurrentModel] = useState<string>('gemini-3-flash-preview');

  // Modo de Botão de Ação Dinâmico (Recap vs Brainstorm)
  const [actionButtonMode, setActionButtonMode] = useState<'recap' | 'brainstorm'>('recap');

  useEffect(() => {
    // Carrega modo persistido
    window.electronAPI
      ?.getActionButtonMode?.()
      ?.then((mode: 'recap' | 'brainstorm') => {
        if (mode) setActionButtonMode(mode);
      })
      .catch(() => {});

    // Escuta mudanças ao vivo do SettingsPopup / IPC
    const unsubscribe = window.electronAPI?.onActionButtonModeChanged?.(
      (mode: 'recap' | 'brainstorm') => {
        setActionButtonMode(mode);
      },
    );
    return () => {
      unsubscribe?.();
    };
  }, []);

  const useDarkCodeTheme = !isLightTheme || isGlassTheme || isModernTheme;
  const codeTheme = useDarkCodeTheme ? vscDarkPlus : oneLight;
  const codeLineNumberColor = useDarkCodeTheme ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.35)';
  const appearance = useMemo(
    () =>
      isGlassTheme
        ? getGlassOverlayAppearance()
        : getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'),
    [overlayOpacity, isLightTheme, isGlassTheme],
  );
  const overlayPanelClass = 'overlay-text-primary';
  const codeBlockClass = 'overlay-code-block-surface';
  const codeHeaderClass = 'overlay-code-header-surface';
  const codeHeaderTextClass = 'overlay-text-muted';
  const quickActionClass = 'overlay-chip-surface overlay-text-interactive';
  const inputClass = `${isLightTheme ? 'focus:ring-black/10' : 'focus:ring-white/10'} overlay-input-surface overlay-input-text`;
  const controlSurfaceClass = 'overlay-control-surface overlay-text-interactive';

  // PERF: eleva o mapeamento de `components` do ReactMarkdown para todos os intents
  // de streaming dentro de um único useMemo então sua identidade é estável entre
  // renderizações. Cada <ReactMarkdown components={{...}}> inline criaria um novo
  // objeto literal por renderização — derrotando o bailout interno do ReactMarkdown.
  //
  // Todos os 6 ramos de intent de mensagem fazem streaming de tokens (o IntelligenceEngine emite:
  //   - standard:              bolhas de texto do sistema simples (fallback de renderização
  //   - codeText:              partes de texto dentro da bolha de código
  //   - whatToAnswerText:      corpo do cartão `what_to_answer` (suggested_answer_token;
  //                            tema esmeralda)
  //   - recapText:             corpo do `recap` (recap_token; tema índigo)
  //   - followUpQuestionsText: corpo do `follow_up_questions`
  //                            (follow_up_questions_token; tema âmbar)
  //   - shortenText:           corpo do `shorten` — IMPORTANTE: shorten faz streaming
  //                            via refined_answer_token com intent='shorten'
  //                            (IntelligenceEngine.ts:406, disparado por
  //                            handleFollowUp('shorten') na linha 2657);
  //                            tema ciano.
  //
  // Nenhum intent é renderizado com um literal `components={{...}}` inline.
  const mdComponents = useMemo(
    () => ({
      standard: {
        p: ({ node, ...props }: any) => (
          <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px] whitespace-pre-wrap" {...props} />
        ),
        strong: ({ node, ...props }: any) => (
          <strong className="font-bold opacity-100 overlay-text-strong" {...props} />
        ),
        em: ({ node, ...props }: any) => (
          <em className="italic opacity-90 overlay-text-secondary" {...props} />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        code: ({ node, inline, className, children, ...props }: any) => {
          const match = /language-(\w+)/.exec(className || '');
          const isInline = inline ?? !match;
          if (!isInline) {
            const lang = match ? match[1] : '';
            const code = String(children).replace(/\n$/, '');
            return (
              <HighlightedCode
                code={code}
                lang={lang}
                isLightTheme={isLightTheme}
                codeTheme={codeTheme}
                codeBlockClass={codeBlockClass}
                codeHeaderClass={codeHeaderClass}
                codeHeaderTextClass={codeHeaderTextClass}
                codeLineNumberColor={codeLineNumberColor}
                appearance={appearance}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            );
          }
          return (
            <code
              className={`overlay-inline-code-surface rounded px-1 py-0.5 text-[13px] font-mono ${isLightTheme ? 'text-slate-800' : ''}`}
              {...props}
            >
              {children}
            </code>
          );
        },
        a: ({ node, ...props }: any) => (
          <a
            className="underline hover:opacity-80"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          />
        ),
      },
      codeText: {
        p: ({ node, ...props }: any) => (
          <p className="mb-[2.5px] last:mb-0 leading-[1.45] whitespace-pre-wrap text-[14px]" {...props} />
        ),
        strong: ({ node, ...props }: any) => (
          <strong className="font-bold opacity-100 overlay-text-strong" {...props} />
        ),
        em: ({ node, ...props }: any) => (
          <em className="italic overlay-text-secondary" {...props} />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        h1: ({ node, ...props }: any) => (
          <h1 className="text-[15px] font-bold mb-[2.5px] mt-1.5 leading-[1.45] overlay-text-strong uppercase tracking-wide" {...props} />
        ),
        h2: ({ node, ...props }: any) => (
          <h2 className="text-[13px] font-bold mb-[2.5px] mt-1 leading-[1.45] overlay-text-strong uppercase tracking-wide" {...props} />
        ),
        h3: ({ node, ...props }: any) => (
          <h3 className="text-[13px] font-semibold mb-[2.5px] mt-1 leading-[1.45] overlay-text-primary" {...props} />
        ),
        code: ({ node, ...props }: any) => (
          <code
            className="overlay-inline-code-surface rounded px-1 py-0.5 text-[13px] font-mono whitespace-pre-wrap"
            {...props}
          />
        ),
        blockquote: ({ node, ...props }: any) => (
          <blockquote
            className={`border-l-2 pl-3 italic my-1 ${isLightTheme ? 'border-slate-300 text-slate-600' : 'border-slate-700 text-slate-400'}`}
            {...props}
          />
        ),
        a: ({ node, ...props }: any) => (
          <a
            className="hover:underline text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          />
        ),
      },
      whatToAnswerText: {
        p: ({ node, ...props }: any) => <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className="font-bold opacity-100 overlay-text-strong"
            {...props}
          />
        ),
        em: ({ node, ...props }: any) => (
          <em
            className="italic opacity-90 overlay-text-secondary"
            {...props}
          />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
      },
      recapText: {
        p: ({ node, ...props }: any) => <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className="font-bold opacity-100 overlay-text-strong"
            {...props}
          />
        ),
        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />,
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
      },
      followUpQuestionsText: {
        p: ({ node, ...props }: any) => <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className="font-bold opacity-100 overlay-text-strong"
            {...props}
          />
        ),
        ul: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />,
        ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />,
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
      },
      shortenText: {
        p: ({ node, ...props }: any) => <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className="font-bold opacity-100 overlay-text-strong"
            {...props}
          />
        ),
        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />,
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
      },
    }),
    [isLightTheme],
  );

  // ── Mola de expansão de código ────────────────────────────────────────────────
  // Arquitetura: a janela do SO tem LARGURA FIXA (780) durante toda sua vida útil;
  // apenas o painel CSS anima 600↔780, centralizado dentro dela. Então o movimento
  // de largura é PURAMENTE do lado do renderer — não há setBounds nativo por
  // quadro e a origem X da janela nunca se move (TopPill permanece pixel-estável,
  // sem re-raster de desfoque).
  //
  // `shellWidth` é a MotionValue conduzida por OVERLAY_RESIZE_SPRING e vinculada
  // diretamente ao `width` CSS do painel. O conteúdo refluxa para a largura real
  // do painel em cada quadro (correto em cada largura intermediária — sem
  // clip/scale/transform). Apenas a ALTURA flui para o SO, via o ResizeObserver /
  // reportShellSize (e um canal com taxa limitada durante a interpolação);
  // reportShellSize lê shellWidth.get() então a altura que reporta sempre
  // corresponde à largura atual do painel.
  const SHELL_WIDTH_COLLAPSED = 600;
  // O painel EXPANDIDO é intencionalmente MAIS ESTREITO que a janela do SO (732 < 780).
  // A janela é fixa em 780 (OVERLAY_WINDOW_WIDTH abaixo) desacoplando o painel
  // dela deixa um gutter permanente de ~24px em cada lado até quando expandido, que
  // é o espaço que o botão flutuante de redimensionar precisa para manter seu gap
  // de canto no estado expandido (quando o painel preenchia a janela de borda a
  // borda não havia gutter, então o botão era forçado para dentro sobre o painel
  // — o bug reportado).
  const SHELL_WIDTH_EXPANDED = 732;
  // A janela overlay do SO tem LARGURA FIXA durante toda sua vida visível. A
  // janela é criada/mostrada nesta largura e nunca redimensiona em largura; o
  // painel CSS anima 600↔732 centralizado dentro dela (mx-auto). Isso precisa
  // combinar com WindowHelper.OVERLAY_DEFAULT_WIDTH. Manter a largura da janela
  // fixa significa que sua origem X nunca se move então o TopPill é pixel-estável
  // e não há re-raster de janela transparente por quadro. É INTENCIONALMENTE mais
  // largo que SHELL_WIDTH_EXPANDED então o gutter lateral sempre existe para o
  // alternador de redimensionamento
  const OVERLAY_WINDOW_WIDTH = 780;
  const shellWidth = useMotionValue(SHELL_WIDTH_COLLAPSED);
  // Orçamento vertical máximo para a área de rolagem do chat. Padrão Infinity =
  // "ainda não medido / sem limite", então o máximo estético derivado da largura
  // se aplica até sabermos a altura de exibição. measureVerticalCap (abaixo)
  // define o valor real: floor(workArea.height*0.9) - chrome, espelhando o
  // clamp do processo principal em WindowHelper.setOverlayDimensionsCentered.
  // Mantém a altura total do conteúdo ≤ o orçamento que a janela do SO receberá,
  // então o rodapé (seletor de modelo / configurações / envio) nunca é cortado
  // abaixo da borda clamped da janela.
  const verticalCap = useMotionValue(Infinity);
  // scrollMaxH é a ALTURA MÁXIMA do viewport do chat, derivada do valor de
  // movimento LIVE `shellWidth` (a largura real animando do painel) subtraído do
  // orçamento vertical medido. Vinculá-lo à largura ao vivo significa que a
  // área de rolagem curta/comprida cresce/encolhe EM PASSO com o painel enquanto
  // a mola executa (widthDerivedScrollMax: 320px colapsado → 560px expandido),
  // então a região visível do chat acompanha o tamanho do painem quadro a quadro.
  // É um valor de movimento vinculado ao estilo então atualiza sem re-render do React.
  const scrollMaxH = useTransform([shellWidth, verticalCap], ([w, cap]: number[]) =>
    // Pass o real collapsed/expanded painel widths então o 320→560 scroll-height
    // ramp reaches its max at o actual expanded largura (732), não o padrão 780.
    Math.min(
      widthDerivedScrollMax(w, {
        collapsedWidth: SHELL_WIDTH_COLLAPSED,
        expandedWidth: SHELL_WIDTH_EXPANDED,
      }),
      cap,
    ),
  );
  // O alternador flutuante de redimensionar percorre o CANTO superior direito
  // do painel ao longo da bissetriz de 45° desse canto, com um pequeno gap
  // do corpo quando há espaço. Seu centro é deslocado do ponto do canto pela
  // MESMA distância `d` em ambos os eixos, o que o mantém exatamente na
  // diagonal de 45° em todo estado (uma versão anterior limitava apenas o
  // horizontal quando expandido → deslocamentos desiguais → fora da diagonal,
  // o bug reportado).
  //
  // Ponto do canto em coordenadas do viewport:
  //   • x: o painel está centralizado na janela de largura fixa OVERLAY_WINDOW_WIDTH,
  //     então sua borda direita fica a M = (OVERLAY_WINDOW_WIDTH - shellWidth) / 2 px
  //     da borda direita da janela (M = 90 colapsado → 0 expandido). Usamos o
  //     shellWidth AO VIVO então o botão acompanha o canto a cada quadro da mola.
  //   • y: a borda superior medida do painel (panelTop, via measureButtonTop()).
  //
  // `d` = deslocamento diagonal com sinal do CENTRO do botão do canto, medido
  // para fora (em direção ao canto superior direito da janela = para cima e direita):
  //   • Desejado: +GAP, então o botão fica GAP px fora do canto no gutter
  //     — o espaço entre corpo e botão que o usuário pediu
  //   • Restrição: o botão precisa permanecer na tela. O espaço para fora à
  //     direita é M (a largura do gutter); ir mais corta pela borda da janela.
  //     Então limitamos d em (M - BTN/2 - EDGE_MARGIN). Quando expandido M→0
  //     esse limite é NEGATIVO, então d vira negativo e o botão se aninha
  //     PARA DENTRO ao longo da mesma diagonal (igual em ambos os eixos) —
  //     ainda na linha de 45°, apenas dentro do canto em vez de fora dele.
  // center-x de janela direito = M - d  → direito = (M - d) - BTN/2
  // center-y de janela topo   = panelTop - d → topo = (panelTop - d) - BTN/2
  const RESIZE_BTN_SIZE = 28; // combina com ResizeToggle's w-[28px]
  const RESIZE_BTN_DIAGONAL_GAP = 8; // gap para fora do canto quando há espaço
  const RESIZE_BTN_EDGE_MARGIN = 2; // mantém o botão na tela quando expandido
  // Deslocamento diagonal `d`, compartilhado por ambos os eixos então o botão
  // sempre fica na bissetriz de 45°. Limitado pelo gutter disponível então
  // nunca corta pela janela.
  const resizeBtnDiagonalOffset = useTransform(shellWidth, (w) => {
    const m = (OVERLAY_WINDOW_WIDTH - w) / 2;
    return Math.min(RESIZE_BTN_DIAGONAL_GAP, m - RESIZE_BTN_SIZE / 2 - RESIZE_BTN_EDGE_MARGIN);
  });
  const buttonRight = useTransform([shellWidth, resizeBtnDiagonalOffset], ([w, d]: number[]) =>
    (OVERLAY_WINDOW_WIDTH - w) / 2 - d - RESIZE_BTN_SIZE / 2,
  );
  // Âncora vertical. `panelTopMV` guarda a borda superior medida do cartão do
  // painel (relativa ao viewport), definida por measureButtonTop(). O botão é
  // position:fixed, mas o cartão do painel NÃO está no topo da janela — fica
  // abaixo do TopPill + gap de 8px (mais quaisquer pills de status / banners)
  // então esse deslocamento é dinâmico e medido de shellRef. O TOPO do painel
  // NÃO se move durante a animação de largura (apenas sua largura muda então
  // atualizar no layout change — não por quadro — é suficiente.
  // Initial guess covers TopPill(~36) + gap(8). buttonTop aplica o Mesmo
  // diagonal offset `d` como buttonRight (subtracted, desde para cima = em direção a o window
  // top) então o botão centro stays em o corner's 45° bisector em todo sestado
  const panelTopMV = useMotionValue(44);
  const buttonTop = useTransform([panelTopMV, resizeBtnDiagonalOffset], ([top, d]: number[]) =>
    top - d - RESIZE_BTN_SIZE / 2,
  );

  // isExpanded mirror para closures dentro refs/observers que precisa não
  // re-bind em todo talternar
  const isExpandedRef = useRef(true);

  // ── Manual largura sobrescrever ─────────────────────────────────────────────────
  // O shell largura é normalmente owned por o auto-resize machinery
  // (checkCodeVisibility scroll-scan + queueToken eager-expand). Quando o user
  // clicks o manual redimensionar alternar we pin o largura e Suspender auto-resize então
  // o two don't fight (e.g. user colapsa enquanto código é on-screen → scanner
  // iria instantly re-expand). O sobrescrever é a ref porque o streaming hot
  // caminho (200–400 tok/s) lê it dentro queueToken/checkCodeVisibility and
  // precisa não acionar re-renders. O button's ícone é driven separately por
  // `isShellWide` (derived de o live width), não de isso osobrescrever
  //
  // Cleared oem (a) sessão rreinicia (b) o primeiro token de o Próximo answer
  // stream — então a manual pin aplica para THIS answer, e o próximo question obtém
  // fresh auto-behaviour. Não cleared em rolar (that iria spring it voltar abrir
  // o moment o user nudges o wheel — o exact fight we're killing).
  const manualWidthOverrideRef = useRef<number | null>(null);
  // `isShellWide` drives o redimensionar button's ícone (MMaximizar ↔ MinMinimizar It é
  // derived de o live shellWidth motion valor crossing o midpoint, então it
  // self-reconciles para Ambos manual toggles e automatic code-expansion — o
  // ícone sempre reflects o real largura não matter quem drove it. O subscription
  // flips isso at maioria uma vez por transição (baixo frequency), então it's render-safe
  // até though o underlying motion valor atualiza todo frame.
  const [isShellWide, setIsShellWide] = useState(false);

  useEffect(() => {
    // Carrega o persisted padrão modelo (não o runtime mmodelo
    // Cada novo meeting inicia com o padrão de settings
    if (window.electronAPI?.getDefaultModel) {
      window.electronAPI
        .getDefaultModel()
        .then((result: any) => {
          if (result && result.model) {
            setCurrentModel(result.model);
            // Também define o runtime modelo para o default
            window.electronAPI.setModel(result.model).catch(() => {});
          }
        })
        .catch((err: any) => console.error('Failed to fetch default model:', err));
    }
  }, []);

  const handleModelSelect = (modelId: string) => {
    setCurrentModel(modelId);
    // Session-only: atualiza runtime mas don't persist como default
    window.electronAPI
      .setModel(modelId)
      .catch((err: any) => console.error('Failed to set model:', err));
  };

  // Ouvir para padrão modelo changes de Settings
  useEffect(() => {
    if (!window.electronAPI?.onModelChanged) return;
    const unsubscribe = window.electronAPI.onModelChanged((modelId: string) => {
      setCurrentModel((prev) => (prev === modelId ? prev : modelId));
    });
    return () => unsubscribe();
  }, []);

  // Global Estado Sincronizar
  useEffect(() => {
    // Busca initial estado
    if (window.electronAPI?.getUndetectable) {
      window.electronAPI.getUndetectable().then(setIsUndetectable).catch(() => {});
    }

    if (window.electronAPI?.onUndetectableChanged) {
      const unsubscribe = window.electronAPI.onUndetectableChanged((state) => {
        setIsUndetectable(state);
      });
      return () => unsubscribe();
    }
  }, []);

  // Persist Settings
  useEffect(() => {
    localStorage.setItem('refract_undetectable', String(isUndetectable));
    localStorage.setItem('refract_hideChatHidesWidget', String(hideChatHidesWidget));
  }, [isUndetectable, hideChatHidesWidget]);

  // Mouse Passthrough Estado
  const [isMousePassthrough, setIsMousePassthrough] = useState(false);
  useEffect(() => {
    window.electronAPI
      ?.getOverlayMousePassthrough?.()
      .then(setIsMousePassthrough)
      .catch(() => {});
    const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v) =>
      setIsMousePassthrough(v),
    );
    return () => unsub?.();
  }, []);

  // Audio capture / screen-recording aviso banner. Two distinct IPC
  // events feed o mesmo banner surface mas exigir diferente title and
  // aação o macOS screen-recording-permission denial points at o
  // OS Privacy pane, enquanto generic audio-capture failures (no-chunks
  // watchdog, TCC zero-fill, terminal STT inicializar failure, SCK errors) são
  // cross-platform e deve abrir Refract's próprio Settings. Bundling
  // ambos sob a hardcoded "Screen Recording Permissão Denied" title
  // com an x-apple.systempreferences ação era issue #252: em Windows
  // o audio-capture-failed caminho fired, o user saw a macOS-only title
  // e o Abrir Settings botão handed Windows shell a URI scheme it
  // couldn't resolver (Microsoft Armazenamento popup).
  // UX3: `channel` lets o banner botão deep-link para o direito macOS
  // System Settings pane (Microphone vs Screen Recording) em vez disso de apenas
  // opening Refract's internal Settings, que é one extra click and
  // doesn't actually take o user para o system pane they need.
  type SystemAudioWarning = {
    kind: 'screen-recording-permission' | 'audio-capture-failure';
    message: string;
    channel?: 'system' | 'mic';
  };
  const [systemAudioWarning, setSystemAudioWarning] = useState<SystemAudioWarning | null>(null);
  // Transient, informational notice quando o mic é auto-switched (e.g. a
  // Bluetooth mic que iria soltar para low-quality HFP "call mmodo — capture é
  // moved para o built-in mic enquanto o BT device stays em high-quality A2DP
  // para playback). Distinct de systemAudioWarning (failures); isso é a
  // success/info mensagem que auto-dismisses.
  const [audioNotice, setAudioNotice] = useState<string | null>(null);
  // UX2: in-flight proteger para o "Repair Permissions" botão então a double-click
  // can't disparar two concurrent tccutil sequences (cujo second-arriving resposta
  // iria clobber o first's banner mid-render).
  const [tccRepairing, setTccRepairing] = useState(false);
  useEffect(() => {
    const unsub = window.electronAPI?.onSystemAudioPermissionDenied?.((message: string) => {
      // screen-recording-permission é implicitly system-channel (it's o
      // Screen Recording TCC pane). Conjunto channel para consistency então o
      // button-resolution logic tem a único fonte de truth.
      setSystemAudioWarning({ kind: 'screen-recording-permission', message, channel: 'system' });
      setIsExpanded(true); // Force overlay abrir então user sees o warning
    });
    return () => unsub?.();
  }, []);

  // Audio-input auto-switch notice (mic rerouted para avoid Bluetooth HFP, ou to
  // resolver a same-device input/output conflict). O trocar happens durante
  // audio (re)configuration, que pode executa antes isMeetingActive flips, então
  // isso subscription é sempre oem Auto-dismisses após a poucos seconds.
  useEffect(() => {
    const unsub = window.electronAPI?.onAudioInputAutoSwitched?.((payload) => {
      const msg = payload.message
        ?? (payload.reason === 'bluetooth-hfp-avoided'
          ? `Using ${payload.to} for better quality while ${payload.from} plays audio.`
          : payload.reason === 'same-device-conflict'
            ? `Switched microphone to ${payload.to} so system audio can be captured.`
            : payload.to
              ? `Microphone switched to ${payload.to}.`
              : 'Microphone quality is degraded.');
      console.log('[RefractInterface] Audio input auto-switched:', payload);
      setAudioNotice(msg);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!audioNotice) return;
    const t = setTimeout(() => setAudioNotice(null), 6000);
    return () => clearTimeout(t);
  }, [audioNotice]);

  useEffect(() => {
    const unsub = window.electronAPI?.onAudioCaptureFailed?.((payload) => {
      // Surface ambos 'system' e 'mic' failures. Earlier código dropped o
      // 'mic' channel sob o assumption que STT status iria surface
      // mic problems, mas stt-status apenas reports WebSocket estado — quando
      // TCC tem silently zero-filled o mic, o WS stays "connected"
      // enquanto audio é dead silence, então o user saw a green status com
      // não transcript e não banner. O main-process zero-fill detector
      // emite o direito payload (channel:'mic', stuck:true, mic-zero-fill
      // memensagem we apenas precisa para exibir it.
      //
      // Apenas surface terminal failures ou o stuck sinal — transient
      // recovery attempts shouldn't spam o banner desde recovery
      // tipicamente succeeds dentro de ~1.5s.
      if (payload.terminal || payload.stuck) {
        setSystemAudioWarning({
          kind: 'audio-capture-failure',
          message: payload.message,
          channel: payload.channel,
        });
        setIsExpanded(true);
      }
    });
    return () => unsub?.();
  }, []);

  // PR #173: STT não configured aviso — shown quando provedor é 'nnenhum durante a meeting
  const [sttNotConfigured, setSttNotConfigured] = useState(false);
  useEffect(() => {
    let mounted = true;
    // Verifica atual STT configuração em montar
    window.electronAPI
      ?.getSttProvider?.()
      .then((provider: string) => {
        if (mounted) setSttNotConfigured(provider === 'none');
      })
      .catch(() => {});

    // Ouvir para live configuração changes (e.g. user salva a chave em Settings enquanto meeting é active)
    const unsub = window.electronAPI?.onSttConfigChanged?.(
      (data: { configured: boolean; provider: string }) => {
        if (mounted) setSttNotConfigured(!data.configured);
      },
    );
    return () => {
      mounted = false;
      unsub?.();
    };
  }, []);

  // Keep o closure-free isExpanded mirror em ssincronizar
  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  // Live-track o OS "Reduzir Motion" preferência então toggling it aplica sem
  // an app restart. startTransition lê prefersReducedMotionRef synchronously.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => {
      prefersReducedMotionRef.current = e.matches;
    };
    prefersReducedMotionRef.current = mql.matches;
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Single canonical size-reporter. Width é Sempre o fixed OVERLAY_WINDOW_WIDTH
  // (o OS janela nunca width-resizes — o CSS painel animates dentro it), então
  // isso é effectively a height-only reporter; altura é de o
  // ResizeObserver-measured conteúdo rect. Centered IPC keeps o
  // TopPill's horizontal centro invariant através resizes.
  const reportShellSize = useCallback(() => {
    if (!contentRef.current) return;
    // offsetHeight é o LAYOUT (untransformed) border-box height. We precisa Não
    // uso getBoundingClientRect().height haqui que Retorna o POST-transform
    // box, então o shell's escalar 0.95→1 / y 20→0 entry animação iria feed a
    // continuously-changing altura dentro de isso OS-resize channel, e o native
    // setBounds() iria chase o CSS transforma frame-by-frame em a separate
    // clock — o startup shake. Layout altura é immune para descendant
    // ttransforma então genuine conteúdo growth ainda flows através enquanto o
    // entry flourish stays purely compositor-side.
    // O OS janela é a FIXED WIDTH (OVERLAY_WINDOW_WIDTH = 780) e nunca
    // width-resizes — Sempre report que fixed width, nunca o live in-between
    // CSS shell width. This makes setOverlayDimensionsCentered see widthDelta 0
    // em todo call, então o window's X origin nunca mover (não sideways jump) and
    // o centered setBounds becomes a pure height-only, top-anchored resize.
    // Height é content-driven e keeps flowing através isso mesmo call.
    const width = OVERLAY_WINDOW_WIDTH;
    const height = contentRef.current.offsetHeight;
    if (process.env.NODE_ENV === 'development') {
      const scrollEl = scrollContainerRef.current;
      console.log('[overlay-resize] reportShellSize', {
        width,
        height,
        attachedContextCount: attachedContext.length,
        scrollClientHeight: scrollEl?.clientHeight,
        scrollScrollHeight: scrollEl?.scrollHeight,
        screenAvailHeight: window.screen?.availHeight,
      });
    }
    const api = window.electronAPI as any;
    if (api?.updateContentDimensionsCentered) {
      api.updateContentDimensionsCentered({ width, height });
    } else {
      window.electronAPI?.updateContentDimensions({ width, height });
    }
  }, [attachedContext.length, OVERLAY_WINDOW_WIDTH]);

  // Calcula o vertical budget cap para o chat rolar area e push it dentro de
  // o `verticalCap` motion valor (que scrollMaxH mins contra o
  // width-derived max). Sem this, o chat rolar max era width-only
  // (320→560), então em a curto exibir expanded visão + an attached screenshot
  // made total conteúdo exceed o main-process clamp (workArea.height*0.9);
  // o OS janela era clamped mas o overflow-hidden shell laid fora taller,
  // cropping o rodapé (modelo selector / configurações / senvia abaixo o edge.
  //
  // chrome = total conteúdo altura − o rolar viewport's Próprio cliente height.
  // This é todo non-scroll pixel (TopPill+gap, status pills, rápido actions,
  // entrada area, attached-screenshot strip, frodapé paddings). It é invariant
  // sob scroll-height changes, então feeding it voltar para bound o rolar height
  // é não circular. availHeight uses o exibir o janela sits oem
  const measureVerticalCap = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    const contentEl = contentRef.current;
    // Não chat painel mounted → nada para cap; let o largura bound aaplica
    if (!scrollEl || !contentEl) {
      verticalCap.set(Infinity);
      return;
    }
    const availHeight = typeof window !== 'undefined' ? window.screen?.availHeight ?? 0 : 0;
    const chromeHeight = contentEl.offsetHeight - scrollEl.clientHeight;
    const nextCap = verticalScrollCap({ availHeight, chromeHeight });
    if (process.env.NODE_ENV === 'development') {
      console.log('[overlay-resize] measureVerticalCap', {
        availHeight,
        chromeHeight,
        contentOffsetHeight: contentEl.offsetHeight,
        scrollClientHeight: scrollEl.clientHeight,
        nextCap,
        attachedContextCount: attachedContext.length,
      });
    }
    verticalCap.set(nextCap);
  }, [attachedContext.length, verticalCap]);

  // Measure o painel card's topo edge (viewport-relative) dentro de panelTopMV então o
  // floating redimensionar alternar pode ride o panel's TOP-RIGHT CORNER, não o window
  // top. O painel sits abaixo o TopPill + 8px gap (and qualquer status pills /
  // aviso banners que push it mais doabaixo então isso offset é dynamic. We lê
  // shellRef (o rounded painel cartão itsi mesmo não contentRef (o whole pilha
  // incluindo o TopPill). We armazenamento o RAW topo edge haqui buttonTop aplica o
  // diagonal offset + BTN/2 centering. getBoundingClientRect().top é
  // viewport-relative, que what it position:fixed `top` wants. O panel's TOP
  // faz não mover durante a largura animação (apenas its largura dofaz então measuring em
  // layout change — não por frame — é correto e cheap.
  const measureButtonTop = useCallback(() => {
    const shellEl = shellRef.current;
    if (!shellEl) return;
    const top = shellEl.getBoundingClientRect().top;
    if (top > 0) panelTopMV.set(Math.round(top));
  }, [panelTopMV]);

  // NOTE: o antigo per-frame "chase" subscriber que pushed o live shell width
  // para setBounds todo frame é GONE. O OS janela é a fixed largura (780) para
  // its whole lifetime, então lá é nada para chase — o painel animates
  // 600↔780 purely renderer-side (CSS `width` bound para o shellWidth spring),
  // com não native largura redimensionar at atodos Apenas HEIGHT flows para o OS, via
  // reportShellSize / o ResizeObserver.

  // ResizeObserver: rAF-debounced então o spring pode atualiza altura sem
  useLayoutEffect(() => {
    if (!contentRef.current) return;

    const observer = new ResizeObserver(() => {
      if (rafDimUpdateRef.current) cancelAnimationFrame(rafDimUpdateRef.current);
      rafDimUpdateRef.current = requestAnimationFrame(() => {
        rafDimUpdateRef.current = null;
        // Ordenar matters: re-derive o vertical cap de atual chrome FPrimeiro
        // então o rolar area absorbs qualquer overflow, então report o (já
        // bounded) conteúdo altura para o OS. If o cap shrinks o srolar
        // o observador fires novamente e isso self-converges em ≤2 frames; chrome
        // altura é scroll-invariant, então lá é não feedback loop.
        measureVerticalCap();
        // Re-anchor o floating redimensionar talternar qualquer coisa que changes content
        // altura acima o painel (status pills, aviso banners, an attached
        // screenshot strip) shifts o panel's topo edge, então o button's `top`
        // precisa follow. Cheap rect rlê não por width-frame.
        measureButtonTop();
        // FLICKER GProteger durante o CSS largura tween o painel largura changes todo
        // frame, que reflows conteúdo altura todo frame e fires isso observador
        // ~60×; cada reportShellSize() iria fazer a native altura setBounds, and
        // todo setBounds re-rasterizes o transparent backdrop-blur janela →
        // o flicker. measureVerticalCap acima keeps o rolar area bounded
        // meanwhile; o único authoritative altura settle é deferred para o
        // transition's onComplete (one setBounds, não one por frame).
        if (Date.now() < heightReportSuppressedUntilRef.current) {
          return;
        }
        reportShellSize();
      });
    });

    observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
      if (rafDimUpdateRef.current) {
        cancelAnimationFrame(rafDimUpdateRef.current);
        rafDimUpdateRef.current = null;
      }
    };
  }, [reportShellSize, measureVerticalCap, measureButtonTop]);

  // ── Hover-gated click-through para o fixed-width window's transparent margins
  // O OS janela é a fixed 780px amplo mas o painted painel é apenas 600px quando
  // collapsed, leaving ~90px transparent margins cada side. Those margins precisa
  // pass clicks Através para o app batrás não swallow them. We hit-test o
  // ponteiro contra o painted conteúdo rect e tell o principal processo se
  // o janela deve capture clicks (ponteiro sobre panel) ou ser click-through
  // (ponteiro sobre a margin). O principal processo gates isso em o master stealth
  // passthrough — quando stealth é em o janela stays completamente click-through
  // independentemente de hover (see WindowHelper.syncOverlayInteractionPolicy). We apenas
  // IPC em Estado CHANGE (debounced), e report mouseleave como "fora panel".
  useEffect(() => {
    const api = window.electronAPI as any;
    if (typeof api?.setOverlayInteractiveRegion !== 'function') return;

    // nulo = unknown (force primeiro report). Tracks o último valor we sent então we
    // apenas round-trip para o principal processo quando o over/off-panel estado flips.
    let lastSent: boolean | null = null;

    const send = (overContent: boolean) => {
      if (lastSent === overContent) return;
      lastSent = overContent;
      api.setOverlayInteractiveRegion(overContent);
    };

    const evaluate = (x: number, y: number) => {
      const rect = contentRef.current?.getBoundingClientRect();
      // Também keep o janela interactive quando o ponteiro é sobre o floating
      // redimensionar alternar (que lives fora de contentRef como a fixed pill).
      const btnRect = resizeToggleRef.current?.getBoundingClientRect();
      send(
        isPointerOverContent(rect ?? null, x, y) ||
        isPointerOverContent(btnRect ?? null, x, y),
      );
    };

    const onMove = (e: MouseEvent) => evaluate(e.clientX, e.clientY);
    // Ponteiro esquerda o janela entirely → definitely sobre a margem / ofora de
    const onLeave = () => send(false);

    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);

    // Initial report: até o ponteiro actually enters o painted panel, o
    // janela deve ser click-through então o transparent area é nunca a dead
    // click. O primeiro real mousemove dentro o painel flips it para interactive.
    send(false);

    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      // Restore o interactive padrão em desmontar então a future montar (ou o
      // main-process default) é não esquerda stuck em click-through.
      api.setOverlayInteractiveRegion(true);
    };
  }, []);

  // attachedContext (screenshots add/remove) e initial-sizing safety:
  // ambos re-derive o vertical cap (a screenshot strip grows chrome) and
  // re-run o canonical reporter — não mais "o que largura deve I uso direito
  // noagora branching contra animação flags.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      measureVerticalCap();
      measureButtonTop();
      reportShellSize();
    });
    return () => cancelAnimationFrame(id);
  }, [attachedContext, reportShellSize, measureVerticalCap, measureButtonTop]);

  useEffect(() => {
    const timer = setTimeout(() => {
      measureVerticalCap();
      measureButtonTop();
      reportShellSize();
    }, 600);
    return () => clearTimeout(timer);
  }, [reportShellSize, measureVerticalCap, measureButtonTop]);

  // ── Code-expansion (renderer-only largura spring, fixed-width window) ──────────
  // O FIX: o OS janela é a FIXED WIDTH (OVERLAY_WINDOW_WIDTH = 780) para its
  // entire visible lifetime, e o painel é centered (mx-auto) dentro it. Lá
  // é Não largura setBounds durante o interaction at atodos O expand/contract
  // travel é a renderer-only CSS `width` animation: o `shellWidth` spring é
  // bound para o panel's `width` style, então o conteúdo reflows (text re-wrap +
  // código re-layout) para o real painel largura em todo frame e é correto at
  // todo in-between largura — não clipping, não phantom layout width, não transforma
  // distortion. Per-frame reflow cost é held abaixo por `contain: layout style` em
  // o shell (scopes o reflow) + memoized syntax highlighting (a largura change
  // re-wraps sem re-tokenizing).
  //
  // WPor que o anterior two attempts shifted o window's X origin durante o
  // animação (to keep o painel centered como o janela largura changed). Mas
  // Chromium faz Não synchronize a programmatic setBounds com o renderer's
  // paint em macOS, então para one frame o antigo framebuffer (painted at o old
  // origin) era shown at o novo shifted origin → o TopPill snapped sideways,
  // e repeating que por frame Era o flicker. Com a fixed janela largura o
  // X origin nunca mmove sentão
  //   • TopPill (centered em o fixed window) é pixel-stable — zero jump.
  //   • Não per-frame largura setBounds → não transparent-blur re-raster — zero flicker.
  //
  // Apenas HEIGHT ainda flows para o OS (content/streaming growth), via a
  // height-only, top-anchored setBounds — que faz não mover X. Durante o CSS
  // largura animação o altura reflows todo frame, então o ResizeObserver's próprio
  // reporting é SUPPRESSED (heightReportSuppressedUntilRef) e o animation
  // em vez disso drives altura isi mesmo rate-limited para ~30fps (see startTransition),
  // com a final authoritative settle at onComplete.
  const resizeOverlayWindowCentered = useCallback(
    (height: number) => {
      if (height <= 0) return;
      // Width é Sempre o fixed janela largura → widthDelta 0 em o principal
      // processo → X nunca mmove isso colapsa para a pure height-only resize.
      const api = window.electronAPI as any;
      if (api?.updateContentDimensionsCentered) {
        api.updateContentDimensionsCentered({ width: OVERLAY_WINDOW_WIDTH, height });
      } else {
        window.electronAPI?.updateContentDimensions({ width: OVERLAY_WINDOW_WIDTH, height });
      }
    },
    [OVERLAY_WINDOW_WIDTH],
  );

  // Re-pin o chat para o fundo para o atual frame (iMessage-style sticky
  // bottom). Hoisted fora de o animação retorno de chamada então ambos o spring's
  // per-frame onUpdate e o reduced-motion snap caminho share one definition.
  // A único layout lê + único wescreve não forced flush.
  const pinScrollBottomIfNeeded = useCallback(() => {
    if (!wasAtBottomRef.current) return;
    const c = scrollContainerRef.current;
    if (c) c.scrollTop = c.scrollHeight - c.clientHeight;
  }, []);

  const startTransition = useCallback(
    (targetWidth: number) => {
      codeExpandedRef.current = targetWidth === SHELL_WIDTH_EXPANDED;

      const fromWidth = Math.round(shellWidth.get());

      // iMessage-style sticky bottom. Capture o user's rolar intent nagora
      // antes scrollMaxH inicia changing. If they eram at (ou nperto o
      // bottom, we keep them pinned lá por todo o animação então growing
      // viewport altura doesn't reveal stale history abaixo o visible chat.
      const container = scrollContainerRef.current;
      if (container) {
        const distanceFromBottom =
          container.scrollHeight - (container.scrollTop + container.clientHeight);
        wasAtBottomRef.current = distanceFromBottom <= 8;
      }

      // Não meaningful largura change: nada para animate, não native resize.
      if (Math.abs(targetWidth - fromWidth) <= 1) {
        if (animationControlsRef.current) animationControlsRef.current.stop();
        animationControlsRef.current = null;
        // Snap o live largura para o alvo então o box rests at o exact width.
        shellWidth.set(targetWidth);
        return;
      }

      // ACCESSIBILITY (WCAG 2.3.3): honor "Reduzir Motion" — snap para o alvo
      // largura com não animated travel, então settle altura ouma vez Não suppression
      // janela necessário porque lá é não multi-frame tween para proteger acontra
      if (prefersReducedMotionRef.current) {
        if (animationControlsRef.current) animationControlsRef.current.stop();
        animationControlsRef.current = null;
        heightReportSuppressedUntilRef.current = 0;
        // Snap o largura para o alvo com não animated travel; conteúdo reflows
        // uma vez para o final width.
        shellWidth.set(targetWidth);
        pinScrollBottomIfNeeded();
        const h = contentRef.current?.offsetHeight ?? 0;
        if (h > 0) resizeOverlayWindowCentered(h);
        return;
      }

      // Suprimir o ResizeObserver's próprio per-frame HEIGHT reporting para o
      // whole animation: o live `width` animação reflows conteúdo altura todo
      // frame, então o ResizeObserver fires ~60× e cada altura setBounds iria
      // re-raster o transparent backdrop-blur janela → flicker. (Lá é Não
      // largura setBounds para suprimir — o janela largura é fixed.) Em vez disso o
      // animação drives a single, RATE-LIMITED altura channel babaixo O
      // deadline Estende em todo (re)trigger então a mid-flight rolar retarget
      // keeps o observador suppressed através o blended motion; a generous tail
      // covers o spring's settle past visualDuration. Self-expiring então an
      // interrupted spring pode nunca wedge reporting ofora
      heightReportSuppressedUntilRef.current =
        Date.now() + OVERLAY_RESIZE_DURATION_MS + 260;

      // Height channel para o animation. O chat rolar viewport's max-height
      // é derived de o LIVE largura (widthDerivedScrollMax: 320px collapsed →
      // 560px expanded), então it ramps para cima com o spring em EExpandir If we apenas
      // settled altura at onComplete o OS janela iria stay curto para o whole
      // expandir e CLIP o fundo de o growing conteúdo até it jumped at o
      // etermina Então we track altura durante o animation, bmas
      //   • driven de o spring's onUpdate (mesmo frame it lê offsetHeight
      //     fde então o janela edge e o painel são computed de one
      //     consistent layout, nunca a frame apart);
      //   • rate-limited para ~30fps (33ms) então a altura step de streaming growth
      //     mid-tween stays abaixo perception;
      //   • integer-deduped, então a stable altura issues não redundant setBounds
      //     (não needless desfocar re-raster).
      // 30fps stays bem sob 60fps, então it faz não reintroduce o per-frame
      // native setBounds que o suppression machinery exists para pprevenir
      let lastHeightReportAt = 0;
      let lastReportedHeight = -1;
      const HEIGHT_REPORT_INTERVAL_MS = 33; // ~30fps

      // WIDTH SPRING em o renderer clock (600↔780 dentro o fixed window). Por que
      // a spring em vez disso de o antigo duration+bezier tween:
      //
      //   O rolar scanner re-fires startTransition sempre que a código block
      //   crosses o viewport edge durante a srolar A duration+bezier RESTARTS
      //   de progresso 0 (zero velocity) at o atual largura em cada re-fire,
      //   então a rolar através mixed code/text stacked velocity discontinuities
      //   = o perceived stutter. We deliberately Fazer Não chamar .stpara antes
      //   re-issuing: framer-motion lê o motion value's CURRENT velocity
      //   e retargets o spring in-flight, blending consecutive expandir /
      //   contract scans dentro de one continuous motion. stpara iria zero that
      //   velocity e reintroduce o hitch, então it é reserved para o
      //   no-op / reduced-motion / desmontar paths oapenas
      //
      //   bounce:0 (critically damped, see OVERLAY_RESIZE_SPRING) significa an
      //   uninterrupted executa tem Não overshoot e lê identically para o old
      //   drawer tween. Qualquer micro-overshoot durante an interrupted retarget é
      //   renderer-only (it nudges o CSS width, nunca a native largura setBounds —
      //   o janela largura é fixed), então it é safe.
      animationControlsRef.current = animate(shellWidth, targetWidth, {
        ...OVERLAY_RESIZE_SPRING,
        onUpdate: () => {
          pinScrollBottomIfNeeded();
          const now = Date.now();
          if (now - lastHeightReportAt < HEIGHT_REPORT_INTERVAL_MS) return;
          const h = contentRef.current?.offsetHeight ?? 0;
          if (h <= 0 || h === lastReportedHeight) return;
          lastHeightReportAt = now;
          lastReportedHeight = h;
          resizeOverlayWindowCentered(h);
        },
        onComplete: () => {
          animationControlsRef.current = null;
          // Hand reporting voltar para normal Primeiro então o settle abaixo actually
          // fires (o ResizeObserver early-returns enquanto suppression é live).
          heightReportSuppressedUntilRef.current = 0;
          // Authoritative HEIGHT settle: one setBounds para o final, exact
          // conteúdo altura após o largura (and portanto o width-derived
          // rolar max) tem completamente settled — guarantees o final frame é exact
          // até se o último rate-limited sample landed a poucos px scurto
          const settledHeight = contentRef.current?.offsetHeight ?? 0;
          resizeOverlayWindowCentered(settledHeight);
        },
      });
    },
    [shellWidth, SHELL_WIDTH_EXPANDED, resizeOverlayWindowCentered, pinScrollBottomIfNeeded],
  );

  // Manual redimensionar talternar Lê o LIVE shell largura (não codeExpandedRef) então it
  // toggles correctly até mid-tween, pins o chosen largura como a manual sobrescrever
  // (suspending auto-resize), e animates através o Mesmo startTransition caminho
  // o auto-machinery uses — então manual e automatic expansion são visually
  // identical (ambos CSS-only noagora
  const handleManualResizeToggle = useCallback(() => {
    const current = Math.round(shellWidth.get());
    const target =
      current >= SHELL_WIDTH_EXPANDED ? SHELL_WIDTH_COLLAPSED : SHELL_WIDTH_EXPANDED;
    manualWidthOverrideRef.current = target;
    startTransition(target);
  }, [shellWidth, startTransition, SHELL_WIDTH_COLLAPSED, SHELL_WIDTH_EXPANDED]);

  // Derivar o resize-button ícone estado de o live shell width. Subscribing
  // para o motion valor (em vez than tracking cada startTransition caller)
  // significa o ícone é correto para manual toggles AND automatic code-expansion
  // com one fonte de truth. setState apenas fires quando o booleano actually
  // flips, então isso é ≤1 renderizar por transição despite per-frame largura uatualiza
  useEffect(() => {
    const midpoint = (SHELL_WIDTH_COLLAPSED + SHELL_WIDTH_EXPANDED) / 2;
    const sync = (w: number) => setIsShellWide((prev) => (prev === w >= midpoint ? prev : w >= midpoint));
    sync(shellWidth.get());
    const unsubscribe = shellWidth.on('change', sync);
    return () => unsubscribe();
  }, [shellWidth, SHELL_WIDTH_COLLAPSED, SHELL_WIDTH_EXPANDED]);

  // Scan [data-code-msg] elements e verifica se qualquer intersect o rolar container
  // viewport. Chamado em todo rolar evento e após todo messages uatualiza
  // Uses a stability gate: o visibility precisa hold its novo estado para
  // STABILITY_MS antes a transição fires. This filtra fora o rapid
  // visible↔invisible flicker que occurs quando a código block crosses o
  // viewport edge durante a fast srolar batching it dentro de a único committed
  // direction. (O largura spring retargets smoothly se a transição faz fire
  // mid-flight, então o gate é não longer o apenas thing standing entre fast
  // rolar e stutter — mas it ainda avoids redundant animate() churn.)
  const STABILITY_MS = 120;
  const checkCodeVisibility = useCallback(() => {
    // Enquanto o user tem manually pinned a width, auto-resize é completamente
    // suspended — o scanner precisa não contradict o manual choice. Cleared em
    // sessão reinicia e em o primeiro token de o próximo stream (see queueToken).
    if (manualWidthOverrideRef.current !== null) return;

    const container = scrollContainerRef.current;

    // Rolar container unmounted (sessão reinicia / messages cleared) — force
    // contraction então o shell Retorna para its collapsed width. Pular enquanto o
    // answer painel é pinned: transient unmounts durante STT/layout churn precisa
    // não colapsar o shell e flash o answer block.
    if (!container) {
      if (answerPanelPinnedRef.current) return;
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      pendingVisibilityRef.current = null;
      if (codeExpandedRef.current) startTransition(SHELL_WIDTH_COLLAPSED);
      return;
    }

    const codeEls = container.querySelectorAll('[data-code-msg]');
    let visible = false;
    if (codeEls.length > 0) {
      // O real código linha agora exists, então visibility scanning pode take ownership
      // anovamente This restores scroll-away contraction após o pre-DOM eager
      // expansion gap tem passed.
      eagerCodeExpansionHoldRef.current = false;
      const cRect = container.getBoundingClientRect();
      for (const el of codeEls) {
        const r = el.getBoundingClientRect();
        if (r.bottom > cRect.top && r.top < cRect.bottom) {
          visible = true;
          break;
        }
      }
    }

    if (
      shouldHoldEagerCodeExpansion({
        hasCodeElements: codeEls.length > 0,
        hasVisibleCodeElement: visible,
        eagerExpansionHold: eagerCodeExpansionHoldRef.current,
      })
    ) {
      visible = true;
    }

    // Já em o correto estado — claro qualquer pendente change então a
    // mid-flight tween isn't interrupted por a stale timer firing.
    if (visible === codeExpandedRef.current) {
      pendingVisibilityRef.current = null;
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      return;
    }

    // Estado change detected. If we're já waiting em o Mesmo pending
    // change, let o timer continue ticking — don't reinicia it em todo
    // rolar frame, ou fast rolar iria nunca let o timer fire.
    if (pendingVisibilityRef.current === visible) return;

    pendingVisibilityRef.current = visible;
    if (stableVisibilityTimerRef.current) clearTimeout(stableVisibilityTimerRef.current);
    stableVisibilityTimerRef.current = setTimeout(() => {
      stableVisibilityTimerRef.current = null;
      const target = pendingVisibilityRef.current;
      pendingVisibilityRef.current = null;
      if (target !== null && target !== codeExpandedRef.current) {
        startTransition(target ? SHELL_WIDTH_EXPANDED : SHELL_WIDTH_COLLAPSED);
      }
    }, STABILITY_MS);
  }, [startTransition, SHELL_WIDTH_COLLAPSED, SHELL_WIDTH_EXPANDED]);

  // Re-check após todo messages atualiza (catches mid-stream código fences).
  useEffect(() => {
    const raf = requestAnimationFrame(() => checkCodeVisibility());
    return () => cancelAnimationFrame(raf);
  }, [messages, checkCodeVisibility]);

  // Re-attach rolar ouvinte sempre que messages change — o rolar container
  // é conditionally rendered então scrollContainerRef.current é nulo at mmontar
  //
  // O visibility verifica faz layout lê (querySelectorAll +
  // getBoundingClientRect em todo código elelemento Running it synchronously
  // em todo rolar evento forces a layout esvaziar mid-scroll-frame, que
  // mostra para cima como texto jitter durante fast scrolls. rAF-coalescing it garante
  // at maioria one verifica por frame e lets o lê happen at o natural
  // post-scroll layout point em o frame lifecycle.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        checkCodeVisibility();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [messages, checkCodeVisibility]);

  // Cancelar todos in-flight assíncrono work em udesmontar
  useEffect(() => {
    return () => {
      animationControlsRef.current?.stop();
      animationControlsRef.current = null;
      heightReportSuppressedUntilRef.current = 0;
      if (rafDimUpdateRef.current) {
        cancelAnimationFrame(rafDimUpdateRef.current);
        rafDimUpdateRef.current = null;
      }
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      pendingVisibilityRef.current = null;
      eagerCodeExpansionHoldRef.current = false;
      // PERF: cancelar qualquer pendente token-flush RAF então we don't tentar to
      // setState em an unmounted ccomponente
      if (tokenBufRef.current.raf !== null) {
        cancelAnimationFrame(tokenBufRef.current.raf);
        tokenBufRef.current.raf = null;
        tokenBufRef.current.text = '';
      }
      // Também reinicia imperative streaming refs em desmontar então stale DOM
      // nó refs don't disparar após o componente é gone.
      streamingNodeRef.current = null;
      streamingTextRef.current = '';
      streamingMsgIdRef.current = null;
      streamingIntentRef.current = null;
      streamingRenderModeRef.current = 'imperative';
      if (streamingCodeRafRef.current !== null) {
        cancelAnimationFrame(streamingCodeRafRef.current);
        streamingCodeRafRef.current = null;
      }
      if (rollingPartialDebounceRef.current !== null) {
        clearTimeout(rollingPartialDebounceRef.current);
        rollingPartialDebounceRef.current = null;
      }
      pendingRollingPartialRef.current = null;
    };
  }, []);
  // ────────────────────────────────────────────────────────────────────────

  // Build conversation contexto de messages
  useEffect(() => {
    setConversationContext(buildConversationContextFromMessages(messages));
  }, [messages]);

  // Ouvir para configurações janela visibility changes
  useEffect(() => {
    if (!window.electronAPI?.onSettingsVisibilityChange) return;
    const unsubscribe = window.electronAPI.onSettingsVisibilityChange((isVisible) => {
      setIsSettingsOpen(isVisible);
    });
    return () => unsubscribe();
  }, []);

  // Sincronizar Window Visibility com Expanded Estado
  useEffect(() => {
    // Primeiro executa é o mount-time isExpanded=true. main.startMeeting() tem
    // já shown o overlay via switchToOverlay(); calling showWindow()
    // aqui iria re-enter switchToOverlay() (a segundo setBounds + focufocar
    // producing o startup focar flash. Pular it exatamente ouma vez O
    // `ensure-expanded` IPC manipulador ainda define isStealthRef antes qualquer depois
    // expansion, então stealth é preserved.
    if (!isExpandedEffectInitializedRef.current) {
      isExpandedEffectInitializedRef.current = true;
      isStealthRef.current = false;
      return;
    }

    if (isExpanded) {
      // Guardado com ?. — durante churn de HMR / reload o preload pode não ter
      // reinjetado window.electronAPI ainda, e a chamada crua derrubava o
      // overlay ("Cannot read properties of undefined (reading 'showWindow')").
      window.electronAPI?.showWindow?.(isStealthRef.current);
      isStealthRef.current = false; // Reinicia voltar to default
    } else {
      // Slight atrasar para permitir animação para clean para cima se needed, though immediate é safer para click-through
      // Using setTimeout para garante o renderizar cycle completa primeiro
      // Increased para 400ms para permitir "contract para bottom" exit animação para finaliza
      setTimeout(() => window.electronAPI?.hideWindow?.(), 400);
    }
  }, [isExpanded]);

  // Keyboard shortcut para alternar expanded estado (via Principal PProcesso
  useEffect(() => {
    if (!window.electronAPI?.onToggleExpand) return;
    const unsubscribe = window.electronAPI.onToggleExpand(() => {
      setIsExpanded((prev) => !prev);
    });
    return () => unsubscribe();
  }, []);

  // Garante overlay é expanded quando requested por principal processo (e.g. após switching para overlay momodo
  // IMPORTANT: define isStealthRef antes setIsExpanded então que se isExpanded era false, o
  // isExpanded efeito fires showWindow(true) em vez disso de showWindow(false). Sem this,
  // ensure-expanded em a collapsed overlay iria acionar show()+focus(), breaking stealth.
  useEffect(() => {
    if (!window.electronAPI?.onEnsureExpanded) return;
    const unsubscribe = window.electronAPI.onEnsureExpanded(() => {
      isStealthRef.current = true;
      setIsExpanded(true);
    });
    return () => unsubscribe();
  }, []);

  // Sessão Reinicia Listener - Limpa UI quando a NEW meeting inicia
  useEffect(() => {
    if (!window.electronAPI?.onSessionReset) return;
    const unsubscribe = window.electronAPI.onSessionReset(() => {
      console.log('[RefractInterface] Resetting session state...');
      window.electronAPI?.cancelChatStream?.();
      chatStreamIdRef.current = null;
      requestStartTimeRef.current = null;
      setMessages([]);
      eagerCodeExpansionHoldRef.current = false;
      answerPanelPinnedRef.current = false;
      setAnswerPanelPinned(false);

      // ─── Colapsar O CODE-WIDTH EXPANSION SYNCHRONOUSLY ───────────────────
      // O overlay window/renderer é reused através meetings (nunca
      // destroyed), então o Anterior meeting's expanded coding/answer visão —
      // its amplo shell largura e o deferred visibility machinery — survives
      // dentro de o próximo meeting. Clearing `messages` acima é não enough: o
      // shell apenas contracts depois via checkCodeVisibility (rAF → 120ms
      // stability gate → 0.7s spring), então em reiniciar o user briefly sees o
      // antigo meeting at its expanded largura antes it "ratualiza a segundo ou
      // two ldepois Snap tudo voltar para o collapsed baseline Agora então o
      // primeiro paint de o novo meeting é já clean.
      //
      // We touch o code-width estado (shellWidth / codeExpandedRef), Não
      // isExpanded — isExpanded é o vertical content-shown flag cujo
      // mounted padrão (tverdadeiro é já correto para a fresh meeting, and
      // setIsExpanded(false) iria acionar hideWindow() (see o [isExpanded]
      // effect), wrongly hiding a just-started meeting.
      if (animationControlsRef.current) {
        animationControlsRef.current.stop();
        animationControlsRef.current = null;
      }
      codeExpandedRef.current = false;
      // Limpa qualquer manual largura pin então o novo meeting's auto-resize takes osobre
      // Forgetting isso iria silently desabilitar code-expansion para o entire
      // próximo meeting se o user tinha manually collapsed em o anterior one.
      manualWidthOverrideRef.current = null;
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      pendingVisibilityRef.current = null;
      // Release qualquer height-report suppression de an in-flight tween.
      heightReportSuppressedUntilRef.current = 0;
      // Imperative .sedefine (não animate) — não transient frame. O OS window
      // stays fixed at OVERLAY_WINDOW_WIDTH, então snapping o shell largura voltar to
      // collapsed é a renderer-only largura reinicia (content reflows uma vez para o
      // fresh meeting) com não native redimensionar e não sideways motion.
      shellWidth.set(SHELL_WIDTH_COLLAPSED);
      setInputValue('');
      setAttachedContext([]);
      setManualTranscript('');
      setVoiceInput('');
      setIsProcessing(false);
      if (rollingPartialDebounceRef.current !== null) {
        clearTimeout(rollingPartialDebounceRef.current);
        rollingPartialDebounceRef.current = null;
      }
      pendingRollingPartialRef.current = null;
      setRollingTranscript('');
      setIsInterviewerSpeaking(false);
      interviewerSpeakingRef.current = false;
      // Reinicia STT status para 'awaiting-audio' em sessão rreinicia O anterior
      // session's 'connected' estado precisa não carry sobre dentro de a novo meeting
      // antes we've verified live audio é flowing em o novo pipeline.
      setSttUserStatus('awaiting-audio');
      setSttInterviewerStatus('awaiting-audio');
      setSttUserError('');
      setSttInterviewerError('');
      // Optionally reinicia conexão status se needed, mas conexão persists

      // Track novo conversation/session se applicable?
      // Actually 'app_opened' é global, 'assistant_started' é overlay.
      // Talvez 'conversation_started' eevento
      analytics.trackConversationStarted();
    });
    return () => unsubscribe();
  }, []);

  const handleScreenshotAttach = (data: { path: string; preview: string }) => {
    setIsExpanded(true);
    setAttachedContext((prev) => {
      // Prevenir duplicates e cap at 5
      if (prev.some((s) => s.path === data.path)) return prev;
      const updated = [...prev, data];
      return updated.slice(-5); // Keep último 5
    });
  };

  // STT Status ouvinte — precisa survive isExpanded changes.
  // If registered dentro o [isExpanded] effect, events são dropped durante cleanup.
  useEffect(() => {
    return window.electronAPI.onSttStatusChanged((data) => {
      if (data.channel === 'user') {
        setSttUserStatus(data.state);
        setSttUserProvider(data.provider);
        if (data.error) setSttUserError(data.error);
        if (data.state === 'connected') setSttUserError('');
      } else if (data.channel === 'interviewer') {
        setSttInterviewerStatus(data.state);
        setSttInterviewerProvider(data.provider);
        if (data.error) setSttInterviewerError(data.error);
        if (data.state === 'connected') setSttInterviewerError('');
      }
    });
  }, []);

  // ── PERF: streaming-token rAF coalescing ─────────────────────────────────
  // Token streams (LLM answers) used para chamar setMessages Por TToken Groq
  // emite ~200–400 tok/s, então a 400-token answer triggered 400 React renderiza
  // — cada one cloning o messages array e re-rendering todo prior rlinha
  //
  // ── Imperative Streaming (Opção 2: RAF-throttled markdown) ──────────────
  //
  // Arquitetura overview:
  //   • queueToken() escreve cada token directly para DOM via ref.textContent
  //     — zero React renderiza por ttoken A pendente RAF agenda a markdown
  //     renderizar (via marked + DOMPurify) at para cima para 60fps então o user sees
  //     formatted saída por todo o sstream
  //   • Apenas o Primeiro token de a novo stream calls setMessages() para montar
  //     o bubble. O bubble's ref-callback wires streamingNodeRef.
  //   • flushToken() reinicia o imperative refs então o final-answer
  //     setMessages() takes ownership de o rendered linha via React.
  //   • tokenBufRef é kept para o legacy sentinel/negotiation-coaching caminho
  //     e para o limpeza efeito aacima
  //
  // Tradeoff: marked analisa o Completo accumulated texto cada RAF tick (não
  // incremental). Em practice isso é <1ms para típico LLM responses and
  // invisible at 60fps. If a resposta grows além ~20 KB we pode throttle
  // o RAF para todo outro frame.
  // ─────────────────────────────────────────────────────────────────────────

  // Legacy buffer kept para sentinel/negotiation-coaching reinicia pcaminho
  const tokenBufRef = useRef<{ intent: string; text: string; raf: number | null }>({
    intent: '',
    text: '',
    raf: null,
  });

  // Imperative streaming refs
  const streamingNodeRef   = useRef<HTMLDivElement | null>(null);
  const streamingTextRef   = useRef<string>('');
  const streamingMsgIdRef  = useRef<string | null>(null);
  const streamingIntentRef = useRef<string | null>(null);
  const streamingRafRef    = useRef<number | null>(null);
  const streamingRenderModeRef = useRef<'imperative' | 'react-code'>('imperative');
  const streamingCodeRafRef = useRef<number | null>(null);
  // Active chat stream id (audit finding #3). O principal processo emite chat tokens
  // em one channel de ambos o desktop e phone-mirror paths; isso lets nós soltar
  // tokens/done de a superseded sstream nulo = não id adopted ainda (back-compat).
  const chatStreamIdRef = useRef<number | null>(null);
  // Active LIVE-ANSWER generation id (audit finding #3, fucompleto O live what-to-
  // answer caminho streams em `intelligence-token-batch` (kind='suggested_answer')
  // keyed apenas em intent, então two back-to-back live answers share o mesmo intent
  // e a superseded answer's already-queued batch poderia mescla dentro de o new
  // answer's bubble. Cada item agora carries a generationId; resolveLiveAnswerBatch
  // (mesmo "newest wins" política como chatStreamGuard) drops items de an older
  // generation. nulo = não id adopted ainda (id-less items são sempre accepted →
  // backward compatible com o code-hint / brainstorm streams que omit it).
  const liveAnswerGenIdRef = useRef<number | null>(null);

  // HAuxiliar renderizar accumulated markdown para o streaming DOM nó via RAF.
  // Chamado após todo token wescreve Agenda at maioria one RAF por frame.
  const scheduleMarkdownRender = useCallback(() => {
    if (streamingRafRef.current !== null) return; // já pending
    streamingRafRef.current = requestAnimationFrame(() => {
      streamingRafRef.current = null;
      const node = streamingNodeRef.current;
      if (!node || !streamingTextRef.current) return;
      // marked.parse é sincronizar e fast (<1ms para típico LLM chunks).
      // DOMPurify strips qualquer script/event-handler injection.
      const rawHtml = marked.parse(streamingTextRef.current, { async: false }) as string;
      node.innerHTML = DOMPurify.sanitize(rawHtml);
    });
  }, []);

  const scheduleStreamingCodeRender = useCallback(() => {
    if (streamingCodeRafRef.current !== null) return;
    streamingCodeRafRef.current = requestAnimationFrame(() => {
      streamingCodeRafRef.current = null;
      const msgId = streamingMsgIdRef.current;
      const text = streamingTextRef.current;
      const intent = streamingIntentRef.current;
      if (!msgId || !text) return;
      setMessages((prev) => {
        const idx = prev.findLastIndex((m) => m.id === msgId);
        if (idx === -1) return prev;
        const row = prev[idx];
        if (row.text === text && row.isStreaming && row.intent === intent) return prev;
        const updated = [...prev];
        updated[idx] = { ...row, text, intent: intent ?? row.intent, isStreaming: true };
        return updated;
      });
    });
  }, []);

  // queueToken: imperative DOM escreve por token + RAF markdown rrenderizar
  // Apenas o Primeiro token de a stream calls setMessages (to montar o bubble).
  // Subsequente tokens bypass React entirely — zero re-renders mid-stream.
  const queueToken = useCallback((intent: string, token: string) => {
    // If a novo stream intent arrives enquanto one é active, esvaziar o current
    // stream dentro de React estado então o rows don't bleed dentro de cada ooutro
    if (
      shouldFlushPreviousStream(
        streamingIntentRef.current,
        intent,
        streamingMsgIdRef.current,
      )
    ) {
      const prevText = streamingTextRef.current;
      const prevId   = streamingMsgIdRef.current;
      // Wipe imperative innerHTML antes nulling o nó ref então o anterior
      // stream's marked.parse saída doesn't pilha sob o novo intent's
      // finalized React renderizar (mesmo raiz cause como o flushToken cleanup).
      if (streamingNodeRef.current) streamingNodeRef.current.innerHTML = '';
      streamingNodeRef.current  = null;
      streamingTextRef.current  = '';
      streamingMsgIdRef.current = null;
      streamingIntentRef.current = null;
      streamingRenderModeRef.current = 'imperative';
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
      if (streamingCodeRafRef.current !== null) {
        cancelAnimationFrame(streamingCodeRafRef.current);
        streamingCodeRafRef.current = null;
      }
      reactStartTransition(() => {
        setMessages((prev) => {
          const idx = prev.findLastIndex((m) => m.id === prevId);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], text: prevText, isStreaming: false };
            return updated;
          }
          return prev;
        });
      });
    }

    // Primeiro token de a NEW stream (id não ainda reserved) → relinquish qualquer manual
    // largura pin então isso answer obtém fresh auto-resize behaviour. Feito antes o
    // eager-expand verifica abaixo então a novo coding answer pode ainda grow o shell.
    if (streamingMsgIdRef.current === null && manualWidthOverrideRef.current !== null) {
      manualWidthOverrideRef.current = null;
    }

    const shouldUseReactCodeUi = shouldUseStreamingCodeUi(intent, token, streamingTextRef.current);
    if (shouldEagerExpandForCodeToken(intent, token, streamingTextRef.current)) {
      eagerCodeExpansionHoldRef.current = true;
      // Respect a manual largura pin: don't auto-grow se o user chose a width.
      if (manualWidthOverrideRef.current === null && !codeExpandedRef.current) {
        startTransition(SHELL_WIDTH_EXPANDED);
      }
    }
    if (shouldUseReactCodeUi) {
      streamingRenderModeRef.current = 'react-code';
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
      if (streamingNodeRef.current) {
        streamingNodeRef.current.innerHTML = '';
      }
    }

    streamingTextRef.current += token;
    streamingIntentRef.current = intent;

    if (streamingMsgIdRef.current !== null) {
      if (streamingRenderModeRef.current === 'react-code') {
        scheduleStreamingCodeRender();
        return;
      }
      // Mid-stream: escreve directly para DOM, agendar markdown rrenderizar
      if (streamingNodeRef.current) {
        // Fast pcaminho atualiza textContent imediatamente então o user sees o
        // novo character sem waiting para o RAF, então let o RAF
        // atualizar it para rendered HTML. This gives sub-frame latency para
        // plain texto e up-to-60fps latency para markdown.
        streamingNodeRef.current.textContent = streamingTextRef.current;
      }
      scheduleMarkdownRender();
      return;
    }

    // Primeiro ttoken synchronously reserve o streaming id Antes o transition
    // e define o ref iimediatamente Rationale: setMessages aqui é wrapped em
    // reactStartTransition (deferred), mas a `suggested_answer` finalize that
    // arrives em o próximo IPC tick executa a non-transition setState que React
    // prioritises sobre o pendente transition. Sem a synchronously-set
    // ref, finalize iria não see o streaming row's id, fall através para its
    // findLastIndex fallback, e qualquer um clobber a prior answer ou anexar a
    // duplicate linha (o duplicate-answer bug). Com o ref pre-reserved,
    // finalize qualquer um atualiza o linha em place (já mounted) ou — via o
    // idempotent append-by-id caminho em finalizeStreamingByIntentMessages —
    // cria o linha com isso id então o late montar encontra e mescla em vez disso
    // de duplicating.
    const reservedId = genMessageId();
    streamingMsgIdRef.current = reservedId;
    streamingIntentRef.current = intent;
    if (ANSWER_PANEL_INTENTS.has(intent)) {
      pinAnswerPanelRef.current();
    }
    reactStartTransition(() => {
      setMessages((prev) => {
        // Sempre uso o synchronously-reserved id. Fazer Não busca para an
        // existing abrir same-intent linha para "reuse" — que cria a race
        // com finalize: se finalize fires entre o synchronous ref
        // assignment e isso reducer running, it captures `reservedId`;
        // se isso reducer então realigned o ref para an orphan row's id,
        // finalize's idempotent append-with-`reservedId` iria cria a
        // separate vazio linha enquanto o orphan absorbed o token texto →
        // two visible rows. Anchoring isso commit para `reservedId`
        // eliminates que race entirely.
        //
        // To prevenir stale isStreaming=true same-intent rows de a prior
        // stream leaking dentro de o UI (rendered forever como a typing-dots
        // bubble), seal them haqui `prepareIntelligenceStreamPlaceholder`
        // já seals em its pcaminho isso é para queueToken-only flows
        // que don't pre-create a placeholder.
        const sealed = prev.some(
          (m) =>
            m.role === 'system' &&
            m.isStreaming &&
            m.intent === intent &&
            m.id !== reservedId,
        )
          ? prev.map((m) =>
              m.role === 'system' &&
              m.isStreaming &&
              m.intent === intent &&
              m.id !== reservedId
                ? { ...m, isStreaming: false }
                : m,
            )
          : prev;
        return applyFirstStreamingToken(sealed, {
          id: reservedId,
          token,
          intent,
        });
      });
    });
    scheduleMarkdownRender();
  }, [scheduleMarkdownRender, startTransition, SHELL_WIDTH_EXPANDED]);

  // registerStreamingNode: ref-callback wired para o streaming bubble's div.
  // Chamado por React quando o nó mounts/unmounts.
  const registerStreamingNode = useCallback((msgId: string, el: HTMLDivElement | null) => {
    if (msgId !== streamingMsgIdRef.current) return;
    streamingNodeRef.current = el;
    if (el && streamingTextRef.current) {
      // Push qualquer texto que arrived antes o DOM nó era ready.
      el.textContent = streamingTextRef.current;
      scheduleMarkdownRender();
    }
  }, [scheduleMarkdownRender]);

  const flushToken = useCallback(() => {
    // Cancelar qualquer pendente markdown RAF — o final-answer setMessages é
    // sobre para take ownership de o linha com completamente rendered content.
    if (streamingRafRef.current !== null) {
      cancelAnimationFrame(streamingRafRef.current);
      streamingRafRef.current = null;
    }
    const text = streamingTextRef.current;
    const msgId = streamingMsgIdRef.current;
    const node = streamingNodeRef.current;
    if (!msgId) {
      // Limpa qualquer imperative conteúdo então a transitional re-render doesn't
      // leave stale markdown stacked debaixo o próximo rrenderizar O key="streaming"
      // em o streaming div deve já cause an udesmontar mas isso é an
      // explicit belt-and-suspenders limpeza para paths que bypass o strocar
      if (node) node.innerHTML = '';
      streamingNodeRef.current = null;
      streamingTextRef.current = '';
      streamingIntentRef.current = null;
      streamingRenderModeRef.current = 'imperative';
      eagerCodeExpansionHoldRef.current = false;
      if (streamingCodeRafRef.current !== null) {
        cancelAnimationFrame(streamingCodeRafRef.current);
        streamingCodeRafRef.current = null;
      }
      return;
    }
    // Placeholder com não tokens ainda — keep refs wired então queueToken faz não spawn rows.
    if (!text) {
      return;
    }
    // Reinicia imperative refs Antes setMessages então o streaming short-circuit
    // em renderMessageText é não longer ativo quando React re-renders o rlinha
    // Fazer Não blank node.innerHTML haqui o user é já looking at this
    // streamed DOM. React vai desmontar key="streaming" durante o mesmo commit;
    // clearing it antes que commit cria o visible finalization flicker.
    streamingNodeRef.current = null;
    streamingTextRef.current = '';
    streamingMsgIdRef.current = null;
    streamingIntentRef.current = null;
    streamingRenderModeRef.current = 'imperative';
    if (streamingCodeRafRef.current !== null) {
      cancelAnimationFrame(streamingCodeRafRef.current);
      streamingCodeRafRef.current = null;
    }
    // Keep eagerCodeExpansionHoldRef até o finalized React linha mounts; o
    // visibility scanner limpa it como logo como it sees a real [data-code-msg].
    // Não wrapped em startTransition — ordering precisa hold.
    setMessages((prev) => commitStreamingFlush(prev, msgId, text));
  }, []);

  const tryBeginOverlayAction = useCallback((actionKey: string): boolean => {
    if (overlayActionInFlightRef.current.has(actionKey)) return false;
    const nowMs = Date.now();
    const last = lastOverlayActionRef.current;
    if (
      shouldDedupeOverlayAction({
        actionKey,
        lastActionKey: last?.key ?? null,
        lastAtMs: last?.atMs ?? null,
        nowMs,
      })
    ) {
      return false;
    }
    overlayActionInFlightRef.current.add(actionKey);
    lastOverlayActionRef.current = { key: actionKey, atMs: nowMs };
    return true;
  }, []);

  const endOverlayAction = useCallback((actionKey: string) => {
    overlayActionInFlightRef.current.delete(actionKey);
    // Limpa o dedupe stamp uma vez o ação tem completamente completed. O stamp apenas
    // exists para colapsar a near-simultaneous double-fire de o Mesmo tacionar o
    // in-flight Conjunto já blocks verdadeiro concurrency. Leaving it define meant a
    // COMPLETED ação kept dedupe-blocking o user's próximo intentional press para
    // para cima para 5s — making o hotkey feel dead (part de o "O que para answer faz
    // nnada P0). A press após completion é fresh intent e precisa go tatravés
    if (lastOverlayActionRef.current?.key === actionKey) {
      lastOverlayActionRef.current = null;
    }
  }, []);

  const cancelActiveChatStream = useCallback(() => {
    window.electronAPI?.cancelChatStream?.();
    chatStreamIdRef.current = null;
    requestStartTimeRef.current = null;
    setIsProcessing(false);
    flushToken();
    tokenBufRef.current.intent = '';
    tokenBufRef.current.text = '';
    if (tokenBufRef.current.raf !== null) {
      cancelAnimationFrame(tokenBufRef.current.raf);
      tokenBufRef.current.raf = null;
    }
  }, [flushToken]);

  const resetChatState = useCallback(() => {
    cancelActiveChatStream();
    setMessages([]);
    answerPanelPinnedRef.current = false;
    setAnswerPanelPinned(false);
    lastManualSubmitRef.current = null;
    manualSubmitInFlightRef.current = false;
  }, [cancelActiveChatStream]);

  const finalizeStreamingByIntent = useCallback(
    (intent: string, text: string) => {
      // Cross-flow gproteger O global `streamingMsgIdRef` pode ter sido
      // reassigned por a DIFFERENT stream entre quando isso finalize's
      // evento era emitted (engine side) e quando it arrives aqui (renderer
      // side). Sem a cverifica a late `what_to_answer` finalize iria
      // capture qualquer que seja id atualmente lives em o ref — e se a manual
      // chat submit tinha apenas installed its próprio placeholder, o byId
      // caminho em `finalizeStreamingByIntentMessages` iria silently
      // sobrescrever o chat placeholder com o stale WTA payload (user
      // perceives "my chat mensagem got eaten").
      //
      // Two layers:
      //   1. `shouldAcceptIntelligenceIpc` rejects o específico WTA-over-chat
      //      pattern entirely — late WTA precisa não clobber an ativo chat.
      //   2. Para qualquer outro intent mismatch (e.g. follow-up landing sobre a
      //      clarify placeholder), pass `null` para streamingMsgId então o
      //      finalize falls através para o by-intent busca em
      //      `finalizeStreamingByIntentMessages`, que apenas atualiza
      //      isStreaming=true rows de o Mesmo intent. Cross-intent rows
      //      são esquerda untouched.
      const activeStreamIntent = streamingIntentRef.current;
      const hasActiveOpenStream = streamingMsgIdRef.current != null;
      if (
        !shouldAcceptIntelligenceIpc({
          eventIntent: intent,
          activeStreamIntent,
          hasActiveOpenStream,
        })
      ) {
        return;
      }
      const streamingMsgId =
        activeStreamIntent === intent ? streamingMsgIdRef.current : null;
      const bufferedText = streamingMsgId ? streamingTextRef.current : '';

      if (streamingMsgId && bufferedText) {
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        streamingNodeRef.current = null;
        streamingTextRef.current = '';
        streamingMsgIdRef.current = null;
        streamingIntentRef.current = null;
        streamingRenderModeRef.current = 'imperative';
        if (streamingCodeRafRef.current !== null) {
          cancelAnimationFrame(streamingCodeRafRef.current);
          streamingCodeRafRef.current = null;
        }
        setMessages((prev) =>
          finalizeImperativeStreamMessages(prev, {
            msgId: streamingMsgId,
            intent,
            bufferedText,
            finalText: text,
          }),
        );
        return;
      }

      flushToken();
      setMessages((prev) =>
        finalizeStreamingByIntentMessages(
          prev,
          intent,
          text,
          () => genMessageId(),
          streamingMsgId,
        ),
      );
    },
    [flushToken],
  );

  const pinAnswerPanel = useCallback(() => {
    answerPanelPinnedRef.current = true;
    setAnswerPanelPinned(true);
  }, []);
  pinAnswerPanelRef.current = pinAnswerPanel;

  const prepareIntelligenceStreamPlaceholder = useCallback(
    (intent: string) => {
      flushToken();
      tokenBufRef.current.intent = '';
      tokenBufRef.current.text = '';
      if (tokenBufRef.current.raf !== null) {
        cancelAnimationFrame(tokenBufRef.current.raf);
        tokenBufRef.current.raf = null;
      }
      const placeholderId = genMessageId();
      streamingMsgIdRef.current = placeholderId;
      streamingIntentRef.current = intent;
      streamingTextRef.current = '';
      streamingNodeRef.current = null;
      streamingRenderModeRef.current = 'imperative';
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
      if (streamingCodeRafRef.current !== null) {
        cancelAnimationFrame(streamingCodeRafRef.current);
        streamingCodeRafRef.current = null;
      }
      pinAnswerPanel();
      setMessages((prev) =>
        prepareIntelligenceStreamPlaceholderMessages(prev, intent, placeholderId),
      );
    },
    [flushToken, pinAnswerPanel],
  );

  const displayMessages = useMemo(
    () => collapseConsecutiveDuplicateSystemMessages(messages),
    [messages],
  );
  // ──────────────────────────────────────────────────────────────────────────

  const applyRollingPartialPreview = useCallback((partialText: string) => {
    pendingRollingPartialRef.current = partialText;
    if (rollingPartialDebounceRef.current !== null) {
      clearTimeout(rollingPartialDebounceRef.current);
    }
    rollingPartialDebounceRef.current = setTimeout(() => {
      rollingPartialDebounceRef.current = null;
      const text = pendingRollingPartialRef.current;
      pendingRollingPartialRef.current = null;
      if (text == null) return;
      setRollingTranscript((prev) => mergeRollingTranscriptPartial(prev, text));
    }, 80);
  }, []);

  const flushRollingPartialPreview = useCallback(() => {
    if (rollingPartialDebounceRef.current !== null) {
      clearTimeout(rollingPartialDebounceRef.current);
      rollingPartialDebounceRef.current = null;
    }
    const text = pendingRollingPartialRef.current;
    pendingRollingPartialRef.current = null;
    if (text != null) {
      setRollingTranscript((prev) => mergeRollingTranscriptPartial(prev, text));
    }
  }, []);

  // Conectar para Native Audio Backend — deps precisa Não incluir isExpanded (see clarify effect).
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Conexão Status
    window.electronAPI
      .getNativeAudioStatus()
      .then((status) => {
        setIsConnected(status.connected);
      })
      .catch(() => setIsConnected(false));

    cleanups.push(
      window.electronAPI.onNativeAudioConnected(() => {
        setIsConnected(true);
      }),
    );
    cleanups.push(
      window.electronAPI.onNativeAudioDisconnected(() => {
        setIsConnected(false);
      }),
    );

    // Real-time Transcripts
    cleanups.push(
      window.electronAPI.onNativeAudioTranscript((transcript) => {
        // Quando Answer botão é active, capture USER transcripts para voice entrada
        // Uso ref para avoid stale closure issue
        if (isRecordingRef.current && transcript.speaker === 'user') {
          if (transcript.final) {
            // Accumulate final transcripts
            setVoiceInput((prev) => {
              const updated = prev + (prev ? ' ' : '') + transcript.text;
              voiceInputRef.current = updated;
              return updated;
            });
            setManualTranscript(''); // Limpa partial preview
            manualTranscriptRef.current = '';
          } else {
            // Mostrar live parcial transcript
            setManualTranscript(transcript.text);
            manualTranscriptRef.current = transcript.text;
          }
          return; // Don't adiciona to messages enquanto recording
        }

        // Ignorar user mic transcripts quando não recording
        // Apenas interviewer (system audio) transcripts deve appear em chat
        if (transcript.speaker === 'user') {
          return; // Pular user mic entrada - apenas relevant quando Answer button é active
        }

        // Apenas mostrar interviewer (system audio) transcripts em rolling bar
        if (transcript.speaker !== 'interviewer') {
          return; // Safety verifica para qualquer outro speaker types
        }

        // Rotea para rolling transcript barra — partials debounced; finals commit iimediatamente
        if (!transcript.final) {
          if (!interviewerSpeakingRef.current) {
            interviewerSpeakingRef.current = true;
            setIsInterviewerSpeaking(true);
          }
          applyRollingPartialPreview(transcript.text);
          return;
        }

        flushRollingPartialPreview();
        interviewerSpeakingRef.current = false;
        setIsInterviewerSpeaking(false);
        setRollingTranscript((prev) => mergeRollingTranscriptFinal(prev, transcript.text));

        setTimeout(() => {
          setIsInterviewerSpeaking(false);
        }, 3000);
      }),
    );

    // AI Suggestions de native audio (legacy)
    cleanups.push(
      window.electronAPI.onSuggestionProcessingStart(() => {
        setIsProcessing(true);
        setIsExpanded(true);
      }),
    );

    cleanups.push(
      window.electronAPI.onSuggestionGenerated((data) => {
        setIsProcessing(false);
        pinAnswerPanel();
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: data.suggestion,
          },
        ]);
      }),
    );

    cleanups.push(
      window.electronAPI.onSuggestionError((err) => {
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `Error: ${err.error}`,
          },
        ]);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {
        pinAnswerPanel();
        // Coaching agora arrives via onIntelligenceNegotiationCoaching apenas —
        // sentinel detection em isso stream tem sido removed.
        queueToken('what_to_answer', data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
        setIsProcessing(false);
        pinAnswerPanel();
        finalizeStreamingByIntent('what_to_answer', data.answer);
      }),
    );

    // Orphaned-scaffold fix: a WTA stream que showed a coding scaffold ended
    // com não final answer (superseded / declined / errored). Soltar o abrir
    // scaffold linha então o user nunca sees a permanent "Working onem card.
    // Limpa streaming refs Primeiro (mesmo ordering rationale como o null-feedback
    // pcaminho então a late token batch can't anexar para a linha we're removing.
    cleanups.push(
      window.electronAPI.onIntelligenceSuggestedAnswerDiscard?.(() => {
        setIsProcessing(false);
        if (streamingNodeRef.current) streamingNodeRef.current.innerHTML = '';
        streamingNodeRef.current = null;
        streamingTextRef.current = '';
        streamingMsgIdRef.current = null;
        streamingIntentRef.current = null;
        streamingRenderModeRef.current = 'imperative';
        eagerCodeExpansionHoldRef.current = false;
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        if (streamingCodeRafRef.current !== null) {
          cancelAnimationFrame(streamingCodeRafRef.current);
          streamingCodeRafRef.current = null;
        }
        setMessages((prev) => discardStreamingByIntentMessages(prev, 'what_to_answer'));
      }) ?? (() => {}),
    );

    // Verified código execution: o shown código passed its executed testar cases.
    // Anexar a ✓ badge para o maioria recente assistant (system) mensagem — mas Apenas
    // se it é ainda o Último mmensagem If a newer user turn arrived desde (o
    // último linha é a user/interviewer memensagem isso badge belongs para a nagora
    // superseded answer, então we soltar it em vez than badge o wrong rlinha (O
    // engine também guards por generationId; isso é o renderer-side backstop.)
    cleanups.push(
      window.electronAPI.onIntelligenceCodeVerified?.((data) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'system') return prev; // superseded por a newer turn
          const next = [...prev];
          next[next.length - 1] = { ...last, codeVerified: { passed: data.passed, total: data.total, language: data.language } };
          return next;
        });
      }) ?? (() => {}),
    );

    // Verified código execution: o shown código FAILED e a (re-verified) fix era
    // produced. Substituir o wrong answer Em PLACE (mesmo markdown coding card, mesmo
    // fformata então o compact overlay doesn't grow — o user sempre termina em o
    // CORRECT code, marked com a pequeno "corrected" cabeçalho + ✓ verified badge.
    // Apenas substituir quando o wrong cartão é ainda o Último mensagem (mesmo
    // supersession proteger como o badge); se a newer turn arrived, anexar em vez disso
    // então a genuine correction é nunca silently dropped.
    cleanups.push(
      window.electronAPI.onIntelligenceCodeCorrection?.((data) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const corrected = {
            text: data.answer,
            isCode: true,
            isCorrection: true,
            correctionNote: data.note,
            codeVerified: data.reVerified ? { passed: 1, total: 1, language: 'verified' } : undefined,
          };
          if (last && last.role === 'system' && !last.isStreaming) {
            // In-place strocar keep o mesmo mensagem id então React reuses o rlinha
            const next = [...prev];
            next[next.length - 1] = { ...last, ...corrected };
            return next;
          }
          // Superseded / não a finalized system linha → anexar (nunca lose o fix).
          return [...prev, { id: `correction-${Date.now()}`, role: 'system', ...corrected }];
        });
      }) ?? (() => {}),
    );

    // Sprint 9: time-batched token channel — único subscription that
    // unrolls a kind-tagged items array para o existing queueToken pcaminho
    // O 5 per-token channels (intelligence-suggested-answer-token,
    // intelligence-refined-answer-token, etetc são não longer sendo sent
    // por main.ts para these streams — their handlers acima são agora inert
    // safety nets e apenas disparar se alguns outro código caminho emite them.
    cleanups.push(
      window.electronAPI.onIntelligenceTokenBatch((data) => {
        const { kind, items } = data;
        if (!items || items.length === 0) return;
        if (kind === 'suggested_answer') {
          pinAnswerPanel();
          for (const it of items) {
            // #3 (fucompleto soltar tokens belonging para a superseded live answer então a
            // stale batch (já queued em principal quando a newer answer started)
            // can't mescla dentro de o novo same-intent ('what_to_answer') bubble.
            // id-less items (code-hint/brainstorm/older bconstrói são sempre kept.
            const decision = resolveLiveAnswerBatch(
              liveAnswerGenIdRef.current,
              (it as any).generationId,
            );
            liveAnswerGenIdRef.current = decision.activeId;
            if (!decision.accept) continue;
            queueToken('what_to_answer', (it as any).token);
          }
        } else if (kind === 'refined_answer') {
          for (const it of items) queueToken((it as any).intent, (it as any).token);
        } else if (kind === 'recap') {
          for (const it of items) queueToken('recap', (it as any).token);
        } else if (kind === 'clarify') {
          for (const it of items) queueToken('clarify', (it as any).token);
        } else if (kind === 'follow_up_questions') {
          for (const it of items) queueToken('follow_up_questions', (it as any).token);
        }
      }),
    );

    // Sprint 7: dedicated negotiation-coaching channel.
    // O engine agora intercepts o coaching sentinel server-side and
    // emite isso evento Em vez disso de suggested_answer / suggested_answer_token.
    // Renderer não longer precisa JSON.parse-per-token detection (o
    // existing prefix-gated detection paths acima são kept como defense-
    // in-depth — they são inert porque o engine nunca envia sentinel
    // tokens através suggested_answer anymore).
    cleanups.push(
      window.electronAPI.onIntelligenceNegotiationCoaching((data) => {
        // Flush qualquer pendente streamed tokens antes swapping o streaming
        // linha para um cartão de coaching; caso contrário, o texto缓冲ado por rAF seria
        // appended para o cartão row's vazio texto após isso setMessages.
        flushToken();
        setIsProcessing(false);
        const coaching = data.payload;
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          // If a what_to_answer streaming linha é em flight, substituir it
          // com o coaching cartão então o user doesn't see two bubbles.
          if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
            const updated = [...prev];
            updated[prev.length - 1] = {
              ...lastMsg,
              text: '',
              isStreaming: false,
              isNegotiationCoaching: true,
              negotiationCoachingData: coaching,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: '',
              intent: 'what_to_answer',
              isNegotiationCoaching: true,
              negotiationCoachingData: coaching,
            },
          ];
        });
      }),
    );

    // STREAMING: Refinement
    cleanups.push(
      window.electronAPI.onIntelligenceRefinedAnswerToken((data) => {
        // PERF: rAF-coalesce per-token estado uatualiza
        queueToken(data.intent, data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceRefinedAnswer((data) => {
        setIsProcessing(false);
        finalizeStreamingByIntent(data.intent, data.answer);
      }),
    );

    // STREAMING: Recap
    cleanups.push(
      window.electronAPI.onIntelligenceRecapToken((data) => {
        queueToken('recap', data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceRecap((data) => {
        setIsProcessing(false);
        finalizeStreamingByIntent('recap', data.summary);
      }),
    );

    // STREAMING: Follow-Up Questions (Rendered como mmensagem Ou específico UI?)
    // Atualmente interface tipicamente renderiza follow-up Qs como a mensagem ou botão uatualiza
    // Vamos assumir mensagem por agora baseado não tratamento existente de .follow_up_questions_update.
    // Mas waguardar existing manipular apenas define sestado
    // Vamos verificar como .follow_up_questions_update. era tratado.
    // It era handled separate locally em isso componente mtalvez
    // Ah, I precisa para see o existing ouvinte para 'onIntelligenceFollowUpQuestionsUpdate'

    // Vamos implementar streaming de tokens para isso de qualquer forma, provavelmente atualiza o balão da mensagem
    // Ou it pode ser atualiza a specialized "Suggested Questions" area.
    // Assuming it's a mensagem para consistency com "Copilot" approach.

    cleanups.push(
      window.electronAPI.onIntelligenceFollowUpQuestionsToken((data) => {
        queueToken('follow_up_questions', data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceFollowUpQuestionsUpdate((data) => {
        setIsProcessing(false);
        finalizeStreamingByIntent('follow_up_questions', data.questions);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceClarify((data) => {
        setIsProcessing(false);
        finalizeStreamingByIntent('clarify', data.clarification);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceManualStarted(() => {
        setIsExpanded(true);
        setIsProcessing(true);
        prepareIntelligenceStreamPlaceholder('chat');
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceManualResult((data) => {
        setIsProcessing(false);
        finalizeStreamingByIntent('chat', `🎯 **Answer:**\n\n${data.answer}`);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceError((data) => {
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `❌ Error (${data.mode}): ${data.error}`,
          },
        ]);
      }),
    );
    return () => {
      if (rollingPartialDebounceRef.current !== null) {
        clearTimeout(rollingPartialDebounceRef.current);
        rollingPartialDebounceRef.current = null;
      }
      cleanups.forEach((fn) => fn());
    };
  }, [queueToken, flushToken, applyRollingPartialPreview, flushRollingPartialPreview, pinAnswerPanel, finalizeStreamingByIntent, prepareIntelligenceStreamPlaceholder]);

  // Stable mount-only efeito para screenshot listeners.
  // These Precisa Não ser dentro o [isExpanded] efeito — quando a screenshot é
  // taken, `switchToOverlay` fires `ensure-expanded` que pode flip isExpanded
  // de false→true, triggering o [isExpanded] efeito cleanup. If `screenshot-taken`
  // arrives durante que desmontagem gap o evento é silently dropped (mesmo issue
  // como clarify streaming listeners beabaixo handleScreenshotAttach apenas uses stable
  // useState setters então a mount-only closure é safe haqui
  useEffect(() => {
    const cleanupTaken = window.electronAPI.onScreenshotTaken(handleScreenshotAttach);
    const cleanupAttached = window.electronAPI.onScreenshotAttached?.(handleScreenshotAttach);
    return () => {
      cleanupTaken?.();
      cleanupAttached?.();
    };
  }, []);

  // Rápido Actions - Updated para uso novo Intelligence APIs

  // PERF: useCallback então o referência é stable entre rrenderiza MessageRow
  // (memoized babaixo recebe isso como a prop; sem a stable identity its
  // memo comparator iria nunca corresponder e o bailout iria não fire.
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    analytics.trackCopyAnswer();
    // Optional: Acionar a pequeno notificação ou estado change para visual feedback
  }, []);

  const handleWhatToSay = async (promptInstruction?: string | React.MouseEvent) => {
    if (!tryBeginOverlayAction('what_to_say')) {
      // O press era blocked porque a prior 'what_to_say' é ainda streaming.
      // Surface a brief hint em vez disso de silently fazendo nnada então a blocked
      // press é nunca indistinguishable de a crash / dead hotkey.
      setMessages((prev) => [
        ...prev,
        { id: genMessageId(), role: 'system', text: 'Still finishing the previous answer — one moment…' },
      ]);
      return;
    }
    const dynamicPromptInstruction =
      typeof promptInstruction === 'string' ? promptInstruction : undefined;
    setIsExpanded(true);
    setIsProcessing(true);
    // Capture e claro attached imagem ccontexto
    // Também mescla em qualquer screenshot de o capture-and-process shortcut that
    // arrived via pendingCaptureRef antes o React estado esvaziar (React 18 fix).
    const pending = pendingCaptureRef.current;
    let currentAttachments = attachedContext;
    if (pending && !currentAttachments.some((s) => s.path === pending.path)) {
      currentAttachments = [...currentAttachments, pending].slice(-5);
    }

    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      // Mostrar o attached imagem em chat Primeiro — question cartão precisa appear antes AI resposta
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: 'What should I say about this?',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      // Rolar para fundo quando user envia mensagem
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    // Cria AI resposta placeholder Após user mensagem então thinking dots + resposta
    // appear Abaixo o screenshot question cartão (não acima it)
    prepareIntelligenceStreamPlaceholder('what_to_answer');
    analytics.trackCommandExecuted('what_to_say');

    try {
      // Smart Browser Contexto v2 — just-in-time auto-attach. If Não manual contexto
      // é já captured, ask o extensão para o best auto contexto (it apenas
      // attaches a high-confidence coding page; sensitive/unknown pages são
      // skipped). Manual contexto Sempre wins: we apenas executa isso quando lastCapturedDOM
      // é empty, e o requisição resolves rapidamente com attached:false quando lá
      // é nada para aanexar então o answer é nunca blocked. O captured DOM (if
      // aqualquer arrives via onDomContextReceived → window.lastCapturedDOM, que we
      // re-read abaixo — reusing o proven domContext seam.
      const hasManualContext =
        typeof (window as any).lastCapturedDOM === 'string' &&
        (window as any).lastCapturedDOM.trim().length > 0;
      if (!hasManualContext) {
        try {
          await window.electronAPI.phoneMirrorRequestAutoContext?.();
        } catch {
          /* auto-context é best-effort — nunca block o answer */
        }
      }

      // Safe para lê synchronously direito após o await aacima o extension's
      // SW awaits o /dom POST (que fires o `dom-context-received` IPC →
      // define window.lastCapturedDOM) Antes it emite o `done` ack que resolves
      // phoneMirrorRequestAutoContext(). Então por haqui an auto-captured DOM tem
      // já landed — não extra settle atrasar needed.
      const rawDomContext = (window as any).lastCapturedDOM;
      const domContext =
        typeof rawDomContext === 'string' && rawDomContext.trim().length > 0
          ? rawDomContext.substring(0, DOM_CONTEXT_MAX_CHARS)
          : undefined;

      // O structured envelope (if aqualquer que arrived com isso capture. Consumed
      // ouma vez alongside o legacy sstring então cleared.
      const domContextEnvelope = domContext ? capturedEnvelopeRef.current ?? undefined : undefined;

      // Limpa o captured DOM imediatamente após reading it para garante stale DOM contexto
      // de prior pages é nunca re-sent em subsequente rsolicita
      if (typeof (window as any).lastCapturedDOM === 'string') {
        (window as any).lastCapturedDOM = '';
      }
      capturedEnvelopeRef.current = null;
      // Retire o "Page ccontexto pill o moment o contexto é actually consumed,
      // então o lifecycle rlê capture → pill appears → answer → pill disappears.
      if (domContext) setPageContext(null);

      if (domContext) {
        console.debug(`[DOM Context] Forwarding captured active-tab DOM structure (${domContext.length} chars)`);
      }

      const options =
        dynamicPromptInstruction || domContext
          ? {
              ...(dynamicPromptInstruction ? { promptInstruction: dynamicPromptInstruction } : {}),
              ...(domContext ? { domContext } : {}),
              ...(domContextEnvelope ? { domContextEnvelope } : {}),
            }
          : undefined;

      // Pass imagePath se attached
      const result = await window.electronAPI.generateWhatToSay(
        undefined,
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
        options,
      );
      setScreenContextStatus(result.screenContextStatus || 'not_available');
      setLatestUsedImageInput(Boolean(result.usedImageInput));
      setLatestVisionProviderUsed(result.visionProviderUsed);
      setLatestVisionModelUsed(result.visionModelUsed);
      setLatestVisionFailureReason(result.visionFailureReason);
      if (result.answer == null) {
        const feedback =
          result.error ??
          'Could not generate an answer yet. Wait a few seconds after speech and try again.';
        // CRITICAL ORDERING: claro streaming refs e wipe imperative DOM
        // Antes o `setMessages` que commits o null-feedback. O old
        // ordenar chamado `flushToken()` primeiro — que exits early quando
        // `streamingTextRef.current === ''` (o placeholder hasn't received
        // tokens), leaving refs WIRED. If a stray late `suggested_answer_token`
        // batch arrives entre o early-return e o ref limpa babaixo
        // `queueToken`'s mid-stream caminho executa e appends fragment texto to
        // o linha que apenas got o feedback — producing
        // "Poderia não gera an answer yetainda <stray fragment>".
        //
        // Por clearing refs fprimeiro qualquer concurrent token batch sees a nulo ref
        // e takes o first-token branch em vez disso (que mounts its próprio
        // rolinha o null-feedback `setMessages` é então unambiguous.
        if (streamingNodeRef.current) streamingNodeRef.current.innerHTML = '';
        streamingNodeRef.current = null;
        streamingTextRef.current = '';
        streamingMsgIdRef.current = null;
        streamingIntentRef.current = null;
        streamingRenderModeRef.current = 'imperative';
        eagerCodeExpansionHoldRef.current = false;
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        if (streamingCodeRafRef.current !== null) {
          cancelAnimationFrame(streamingCodeRafRef.current);
          streamingCodeRafRef.current = null;
        }
        setMessages((prev) => applyWhatToAnswerNullFeedbackMessages(prev, feedback));
        pinAnswerPanel();
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
      pinAnswerPanel();
    } finally {
      endOverlayAction('what_to_say');
      setIsProcessing(false);
    }
  };

  const handleFollowUp = async (intent: string = 'rephrase') => {
    const actionKey = `follow_up:${intent}`;
    if (!tryBeginOverlayAction(actionKey)) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder(intent);
    analytics.trackCommandExecuted('follow_up_' + intent);

    try {
      await window.electronAPI.generateFollowUp(intent);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction(actionKey);
      setIsProcessing(false);
    }
  };

  const handleRecap = async () => {
    if (!tryBeginOverlayAction('recap')) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder('recap');
    analytics.trackCommandExecuted('recap');

    try {
      await window.electronAPI.generateRecap();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('recap');
      setIsProcessing(false);
    }
  };

  const handleFollowUpQuestions = async () => {
    if (!tryBeginOverlayAction('follow_up_questions')) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder('follow_up_questions');
    analytics.trackCommandExecuted('suggest_questions');

    try {
      await window.electronAPI.generateFollowUpQuestions();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('follow_up_questions');
      setIsProcessing(false);
    }
  };

  const handleClarify = async () => {
    if (!tryBeginOverlayAction('clarify')) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder('clarify');
    analytics.trackCommandExecuted('clarify');

    try {
      await window.electronAPI.generateClarify();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('clarify');
      setIsProcessing(false);
    }
  };

  const handleCodeHint = async () => {
    // In-flight proteger (todo outro overlay ação tem one). Sem it a rapid
    // double-press de o code-hint hotkey spawned two concurrent IPC/LLM streams;
    // engine generation-id supersession aborted o older one, mas ambos fired.
    if (!tryBeginOverlayAction('code_hint')) {
      setMessages((prev) => [
        ...prev,
        { id: genMessageId(), role: 'system', text: 'Still generating the code hint — one moment…' },
      ]);
      return;
    }
    setIsExpanded(true);
    setIsProcessing(true);
    pinAnswerPanel();

    const currentAttachments = attachedContext;
    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      // Mostrar o attached imagem em chat
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: 'Give me a code hint for this',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      // Rolar para fundo quando user envia mensagem
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    try {
      await window.electronAPI.generateCodeHint(
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
      );
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('code_hint');
      setIsProcessing(false);
    }
  };

  const handleBrainstorm = async () => {
    if (!tryBeginOverlayAction('brainstorm')) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder('what_to_answer');
    analytics.trackCommandExecuted('brainstorm');

    const currentAttachments = attachedContext;
    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      // Mostrar o attached imagem em chat
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: 'Brainstorm with this context',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      // Rolar para fundo quando user envia mensagem
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    try {
      await window.electronAPI.generateBrainstorm(
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
      );
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('brainstorm');
      setIsProcessing(false);
    }
  };
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Stream Token — rAF-coalesced via queueToken (mesmo caminho como intelligence streams).
    // streamId proteger (audit finding #3): soltar tokens de a superseded chat stream então
    // a phone-mirror ou stale desktop stream can't bleed dentro de o ativo bubble. Tokens
    // sem a streamId (back-compat) são sempre accepted.
    cleanups.push(
      window.electronAPI.onGeminiStreamToken((token, meta) => {
        const decision = resolveChatStreamToken(chatStreamIdRef.current, meta?.streamId);
        chatStreamIdRef.current = decision.activeId;
        if (!decision.accept) return;
        queueToken('chat', token);
      }),
    );

    // Stream Feito
    cleanups.push(
      window.electronAPI.onGeminiStreamDone((data) => {
        // Ignorar a feito de a superseded stream (audit finding #3) então it can't
        // tear abaixo a newer stream's rlinha A feito sem a streamId é honored
        // (back-compat). Em an honored feito we claro o adopted id.
        const doneDecision = resolveChatStreamDone(chatStreamIdRef.current, data?.streamId);
        chatStreamIdRef.current = doneDecision.activeId;
        if (!doneDecision.honor) return;
        const pendingText = streamingTextRef.current;
        const pendingMsgId = streamingMsgIdRef.current;
        // finalText é define Apenas quando o backend's coding validate→repair changed
        // o streamed answer — it authoritatively Substitui o streamed linha text
        // (in-place, por id) então o user sees o corrected six-section markdown.
        // Absent em o comum case, onde o streamed tokens já stand.
        const finalText = data?.finalText;
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        if (streamingCodeRafRef.current !== null) {
          cancelAnimationFrame(streamingCodeRafRef.current);
          streamingCodeRafRef.current = null;
        }
        streamingNodeRef.current = null;
        streamingTextRef.current = '';
        streamingMsgIdRef.current = null;
        streamingIntentRef.current = null;
        streamingRenderModeRef.current = 'imperative';
        setIsProcessing(false);

        // Calcula latency se we ter a inicia time
        let latency = 0;
        if (requestStartTimeRef.current) {
          latency = Date.now() - requestStartTimeRef.current;
          requestStartTimeRef.current = null;
        }

        // Track Usage
        analytics.trackModelUsed({
          model_name: currentModel,
          provider_type: detectProviderType(currentModel),
          latency_ms: latency,
        });

        setMessages((prev) => {
          const idx =
            pendingMsgId != null ? prev.findLastIndex((m) => m.id === pendingMsgId) : -1;
          const target = idx !== -1 ? prev[idx] : prev[prev.length - 1];
          if (target && target.role === 'system') {
            const text = finalText || target.text || pendingText;
            if (!text) return prev;
            const isCode =
              text.includes('```') || text.includes('def ') || text.includes('function ');
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = { ...target, text, isStreaming: false, isCode };
              return updated;
            }
            return [...prev.slice(0, -1), { ...target, text, isStreaming: false, isCode }];
          }
          return prev;
        });
      }),
    );

    // Stream Error
    cleanups.push(
      window.electronAPI.onGeminiStreamError((error) => {
        flushToken();
        setIsProcessing(false);
        requestStartTimeRef.current = null; // Limpa timer em error
        // Symmetry com o feito hmanipulador release o adopted chat stream id então o
        // próximo stream inicia clean (audit finding #3). Safe today porque ids são
        // monotonic, mas keeps token/done/error ref management consistent.
        chatStreamIdRef.current = null;
        setMessages((prev) => {
          // Append erro para o atual mensagem ou adiciona novo one?
          // Vamos adicionar um novo bloco de erro se o anterior estiver confuso,
          // ou apenas atualiza sstatus
          // Ideally we want para mostrar parcial resposta AND o error.
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.isStreaming) {
            const updated = [...prev];
            updated[prev.length - 1] = {
              ...lastMsg,
              isStreaming: false,
              text: lastMsg.text + `\n\n[Error: ${error}]`,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: `❌ Error: ${error}`,
            },
          ];
        });
      }),
    );

    // Phone-initiated chat: principal processo streams tokens via gemini-stream-*; this
    // evento adiciona o user turn + streaming placeholder antes tokens arrive.
    cleanups.push(
      window.electronAPI.onPhoneMirrorIncomingChat(({ message }) => {
        flushToken();
        requestStartTimeRef.current = Date.now();
        const userId = genMessageId();
        const placeholderId = `${userId}-reply`;
        streamingMsgIdRef.current = placeholderId;
        streamingIntentRef.current = 'chat';
        streamingTextRef.current = '';
        streamingNodeRef.current = null;
        setMessages((prev) => [
          ...prev,
          { id: userId, role: 'user', text: message },
          {
            id: placeholderId,
            role: 'system',
            text: '',
            intent: 'chat',
            isStreaming: true,
          },
        ]);
        setIsExpanded(true);
        setIsProcessing(true);
        pinAnswerPanel();
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
      }),
    );

    // JIT RAG Stream listeners (para live meeting RAG responses)
    if (window.electronAPI.onRAGStreamChunk) {
      cleanups.push(
        window.electronAPI.onRAGStreamChunk((data: { chunk: string }) => {
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
              const updated = [...prev];
              updated[prev.length - 1] = {
                ...lastMsg,
                text: lastMsg.text + data.chunk,
                isCode: (lastMsg.text + data.chunk).includes('```'),
              };
              return updated;
            }
            return prev;
          });
        }),
      );
    }

    if (window.electronAPI.onRAGStreamComplete) {
      cleanups.push(
        window.electronAPI.onRAGStreamComplete(() => {
          setIsProcessing(false);
          requestStartTimeRef.current = null;
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
              return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
            }
            if (lastMsg && lastMsg.isStreaming) {
              const updated = [...prev];
              updated[prev.length - 1] = { ...lastMsg, isStreaming: false };
              return updated;
            }
            return prev;
          });
        }),
      );
    }

    if (window.electronAPI.onRAGStreamError) {
      cleanups.push(
        window.electronAPI.onRAGStreamError((data: { error: string }) => {
          setIsProcessing(false);
          requestStartTimeRef.current = null;
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.isStreaming) {
              const updated = [...prev];
              updated[prev.length - 1] = {
                ...lastMsg,
                isStreaming: false,
                text: lastMsg.text + `\n\n[RAG Error: ${data.error}]`,
              };
              return updated;
            }
            return prev;
          });
        }),
      );
    }

    return () => cleanups.forEach((fn) => fn());
  }, [currentModel, queueToken, flushToken]); // Garante tracking captures correct modelo

  const handleAnswerNow = async () => {
    if (isManualRecording) {
      if (!tryBeginOverlayAction('answer_now')) return;
      try {
        // Para recording - envia accumulated voice entrada para Gemini
        isRecordingRef.current = false;
        setIsManualRecording(false);
        setManualTranscript('');

        window.electronAPI
          .finalizeMicSTT()
          .catch((err) => console.error('[RefractInterface] Failed to send finalizeMicSTT:', err));

        const currentAttachments = attachedContext;
        setAttachedContext([]);

        const question = (
          voiceInputRef.current +
          (manualTranscriptRef.current ? ' ' + manualTranscriptRef.current : '')
        ).trim();
        setVoiceInput('');
        voiceInputRef.current = '';
        setManualTranscript('');
        manualTranscriptRef.current = '';

        if (!question && currentAttachments.length === 0) {
          if (sttUserStatus === 'failed' && sttUserError) {
            const errCat = categorizeSttError(sttUserError);
            setMessages((prev) => [
              ...prev,
              {
                id: genMessageId(),
                role: 'system',
                text: `❌ ${errCat.title}: ${errCat.body}`,
              },
            ]);
          } else if (sttUserStatus === 'reconnecting') {
            setMessages((prev) => [
              ...prev,
              {
                id: genMessageId(),
                role: 'system',
                text: '⏳ STT is reconnecting, try again in a moment.',
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: genMessageId(),
                role: 'system',
                text: '⚠️ No speech detected. Try speaking closer to your microphone.',
              },
            ]);
          }
          return;
        }

        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'user',
            text: question,
            hasScreenshot: currentAttachments.length > 0,
            screenshotPreview: currentAttachments[0]?.preview,
          },
        ]);

        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        const placeholderId = genMessageId();
        streamingMsgIdRef.current = placeholderId;
        streamingIntentRef.current = 'chat';
        streamingTextRef.current = '';
        streamingNodeRef.current = null;
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        pinAnswerPanel();
        setMessages((prev) => [
          ...prev,
          {
            id: placeholderId,
            role: 'system',
            text: '',
            intent: 'chat',
            isStreaming: true,
          },
        ]);

        setIsProcessing(true);

        try {
          let prompt = '';

          if (currentAttachments.length > 0) {
            prompt = `You are a helper. The user has provided a screenshot and a spoken question/command.
User said: "${question}"

Instructions:
1. Analyze the screenshot in the context of what the user said.
2. Provide a direct, helpful answer.
3. Be concise.`;
          } else {
            const ragResult = await window.electronAPI.ragQueryLive?.(question);
            if (ragResult?.success) {
              return;
            }

            prompt = `You are a real-time interview assistant. The user just repeated or paraphrased a question from their interviewer.
Instructions:
1. Extract the core question being asked
2. Provide a clear, concise, and professional answer that the user can say out loud
3. Keep the answer conversational but informative (2-4 sentences ideal)
4. Do NOT include phrases like "The question is..." - just give the answer directly
5. Format for speaking out loud, not for reading

Provide only the answer, nothing else.`;
          }

          requestStartTimeRef.current = Date.now();
          await window.electronAPI.streamGeminiChat(
            question,
            currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
            prompt,
            { skipSystemPrompt: true },
          );
        } catch (err) {
          setIsProcessing(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.isStreaming && last.text === '') {
              return prev.slice(0, -1).concat({
                id: genMessageId(),
                role: 'system',
                text: `❌ Error starting stream: ${err}`,
              });
            }
            return [
              ...prev,
              {
                id: genMessageId(),
                role: 'system',
                text: `❌ Error: ${err}`,
              },
            ];
          });
        }
      } finally {
        endOverlayAction('answer_now');
      }
    } else {
      // Inicia recording - reinicia voice entrada estado
      setVoiceInput('');
      voiceInputRef.current = '';
      setManualTranscript('');
      isRecordingRef.current = true; // Atualiza ref imediatamente
      setIsManualRecording(true);

      // Garante native audio é connected
      try {
        // Native audio é agora managed por principal processo
        // await window.electronAPI.invoke('native-audio-connect');
      } catch (err) {
        // Já connected, that's fine
      }
    }
  };

  const selectSkill = useCallback((skill: SkillSummary) => {
    const prefix = inputValue.startsWith('$') ? '$' : '/';
    setInputValue(`${prefix}${skill.id} `);
    setSkillPickerIndex(0);
    textInputRef.current?.focus();
  }, [inputValue]);

  const handleManualSubmit = async () => {
    if (!inputValue.trim() && attachedContext.length === 0) return;

    const userText = inputValue.trim();
    const nowMs = Date.now();
    if (manualSubmitInFlightRef.current) return;
    const last = lastManualSubmitRef.current;
    if (
      shouldDedupeManualSubmit({
        text: userText,
        lastText: last?.text ?? null,
        lastAtMs: last?.atMs ?? null,
        nowMs,
      })
    ) {
      return;
    }
    manualSubmitInFlightRef.current = true;
    lastManualSubmitRef.current = { text: userText, atMs: nowMs };

    const currentAttachments = attachedContext;
    const conversationContextForSubmit = buildConversationContextFromMessages(messages);

    // Limpa inputs imediatamente
    setInputValue('');
    setAttachedContext([]);

    // Seal qualquer in-flight streaming rows de a anterior turn antes we
    // anexar o novo user mensagem + placeholder. Sem this, o rAF
    // token coalescer (queueToken) pode anexar tokens de o próximo stream
    // para o prior linha sempre que o streaming intent matches —
    // surfacing como o próximo answer starting mid-sentence com leftover
    // texto de o anterior turn. Também esvaziar qualquer tokens ainda pending
    // em o rAF buffer então they land em o prior rlinha não o novo one.
    flushToken();
    tokenBufRef.current.intent = '';
    tokenBufRef.current.text = '';
    if (tokenBufRef.current.raf !== null) {
      cancelAnimationFrame(tokenBufRef.current.raf);
      tokenBufRef.current.raf = null;
    }
    setMessages((prev) =>
      prev.some((m) => m.isStreaming)
        ? prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        : prev,
    );

    setMessages((prev) => [
      ...prev,
      {
        id: genMessageId(),
        role: 'user',
        text: userText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : ''),
        hasScreenshot: currentAttachments.length > 0,
        screenshotPreview: currentAttachments[0]?.preview,
      },
    ]);

    // Rolar para fundo quando user envia mensagem
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);

    // Adiciona placeholder para streaming resposta — wire queueToken para isso linha então
    // o primeiro gemini-stream-token faz não spawn a segundo streaming bubble.
    const placeholderId = genMessageId();
    streamingMsgIdRef.current = placeholderId;
    streamingIntentRef.current = 'chat';
    streamingTextRef.current = '';
    streamingNodeRef.current = null;
    streamingRenderModeRef.current = 'imperative';
    if (streamingRafRef.current !== null) {
      cancelAnimationFrame(streamingRafRef.current);
      streamingRafRef.current = null;
    }
    if (streamingCodeRafRef.current !== null) {
      cancelAnimationFrame(streamingCodeRafRef.current);
      streamingCodeRafRef.current = null;
    }
    setMessages((prev) => [
      ...prev,
      {
        id: placeholderId,
        role: 'system',
        text: '',
        intent: 'chat',
        isStreaming: true,
      },
    ]);

    setIsExpanded(true);
    setIsProcessing(true);
    pinAnswerPanel();

    try {
      // JIT RAG pre-flight: tentar para uso indexed meeting contexto primeiro
      if (currentAttachments.length === 0) {
        const ragResult = await window.electronAPI.ragQueryLive?.(userText || '');
        if (ragResult?.success) {
          // JIT RAG handled it — resposta streamed via rag:stream-chunk events
          return;
        }
      }

      // Pass imagePath se attached, AND conversation contexto
      requestStartTimeRef.current = Date.now();
      await window.electronAPI.streamGeminiChat(
        userText || 'Analyze this screenshot',
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
        conversationContextForSubmit, // Pass freshly-derived contexto então "answer this" works
      );
    } catch (err) {
      setIsProcessing(false);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.isStreaming && last.text === '') {
          // remover o vazio placeholder
          return prev.slice(0, -1).concat({
            id: genMessageId(),
            role: 'system',
            text: `❌ Error starting stream: ${err}`,
          });
        }
        return [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `❌ Error: ${err}`,
          },
        ];
      });
    } finally {
      manualSubmitInFlightRef.current = false;
    }
  };

  // Atualiza o latest-handler ref em todo renderizar então o captured-key
  // ouvinte (mounted com [] deps) calls o CURRENT closure, não a
  // stale snapshot de primeiro rrenderizar
  handleManualSubmitRef.current = handleManualSubmit;

  const clearChat = () => {
    resetChatState();
  };

  // PERF: useCallback então MessageRow's memo comparator pode rely em a stable
  // função identity. Deps são o things o closure actually lê that
  // pode change: tema + memoized markdown components + memoized appearance.
  // setMessages é a stable React setter e isLightTheme drives ambos o
  // outro deps então its inclusion é majoritariamente defensive.
  const renderMessageText = useCallback(
    (msg: Message) => {
      const cardBgBorderClass = isLightTheme
        ? 'bg-slate-100/70 backdrop-blur-md border border-slate-200/50 text-slate-900 shadow-sm'
        : 'bg-zinc-800/60 backdrop-blur-md border border-zinc-700/40 text-zinc-100 shadow-md';

      const labelColorClass = isLightTheme ? 'text-slate-500' : 'text-slate-400';
      const headerBorderClass = isLightTheme ? 'border-b pb-1.5 border-black/5' : 'border-b pb-1.5 border-white/5';

      // ── Imperative streaming short-circuit ──────────────────────────────
      // Enquanto o mensagem é mid-stream, renderizar a plain div com a ref então
      // queueToken pode escreve rendered markdown HTML directly para o DOM nó
      // sem going através React reconciliation.
      // Em stream completion, flushToken() reinicia streamingMsgIdRef e o
      // próximo renderizar falls através para o normal intent-specific caminho babaixo
      const isActiveReactCodeStream =
        msg.id === streamingMsgIdRef.current && streamingRenderModeRef.current === 'react-code';
      if (msg.isStreaming && msg.role === 'system' && !msg.isNegotiationCoaching && !isActiveReactCodeStream) {
        if (msg.id === streamingMsgIdRef.current) {
          // CRITICAL: key="streaming" forces React para Desmontar isso div (taking
          // o imperative innerHTML com it) quando o linha transitions para o
          // finalized "Code Solution" / "Say this" / eetc branches babaixo Those
          // branches retorna a div com não chave — React sees diferente keys and
          // mounts a fresh DOM nó em vez disso de reusing isso one.
          //
          // Sem o kchave React reuses o mesmo <div> através o streaming
          // e finalized JSX (mesmo ttipo mesmo position). O fiber's filho lista
          // says []  (o streaming JSX tem não children), então em reconciliation
          // React APPENDS o novo finalized children para qualquer que seja innerHTML o
          // imperative caminho wrote — o user sees o streaming markdown
          // STACKED em topo de o React-rendered "Code Solution" tárvore que é
          // exatamente o duplicate-answer bug.
          const isThinking = !msg.text;
          return (
            <div
              key="streaming"
              ref={(el) => registerStreamingNode(msg.id, el)}
              className={`${
                isThinking
                  ? 'w-fit px-[16.5px] py-[12.5px]'
                  : 'w-full p-[14px_18px]'
              } rounded-[20px] rounded-tl-[4px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 markdown-content whitespace-pre-wrap text-[14.5px] leading-relaxed`}
            >
              {/*
               * Typing-dots indicator INSIDE o streaming bubble. Renders
               * enquanto não tokens have arrived yet (text === ''). When o first
               * token lands, queueToken's mid-stream caminho does
               *   streamingNodeRef.current.textContent = streamingTextRef.current
               * que REPLACES these React-rendered children com a texto node,
               * e o subsequent RAF replaces que com marked.parse HTML.
               *
               * React's fiber still thinks o children are these dots — but
               * because we nunca re-trigger o streaming branch with
               * diferente JSX enquanto texto is flowing, não reconciliation kicks
               * in e o imperative DOM persists. Once o linha finalizes,
               * key="streaming" causes a completo unmount, so o dots-vs-text
               * discrepancy nunca causes a reconciliation conflict.
               *
               * Placing o dots INSIDE o bubble (instead of as a separate
               * pill abaixo o mensagem list) gives o classic messaging
               * "typing indicator" UX — o dots appear where o answer
               * will, então smoothly hand off para o answer text.
               */}
              {!msg.text && (
                <div className="flex gap-1.5 items-center py-0.5">
                  <div
                    className={`w-2 h-2 ${isLightTheme ? 'bg-slate-400' : 'bg-white'} rounded-full animate-bounce`}
                    style={{ animationDelay: '0ms' }}
                  />
                  <div
                    className={`w-2 h-2 ${isLightTheme ? 'bg-slate-400' : 'bg-white'} rounded-full animate-bounce`}
                    style={{ animationDelay: '150ms' }}
                  />
                  <div
                    className={`w-2 h-2 ${isLightTheme ? 'bg-slate-400' : 'bg-white'} rounded-full animate-bounce`}
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
              )}
            </div>
          );
        }
        // Handoff gap após flushToken(): imperative ref cleared mas React tem
        // não ainda reconciled — keep showing accumulated texto em vez disso de blank.
        if (msg.text) {
          return (
            <div key="streaming" className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 markdown-content whitespace-pre-wrap text-[14.5px] leading-relaxed`}>{msg.text}</div>
          );
        }
      }
      // ────────────────────────────────────────────────────────────────────

      // Negotiation coaching cartão takes priority
      if (msg.isNegotiationCoaching && msg.negotiationCoachingData) {
        return (
          <NegotiationCoachingCard
            {...msg.negotiationCoachingData}
            phase={msg.negotiationCoachingData.phase as any}
            interfaceTheme={interfaceTheme}
            isLightTheme={isLightTheme}
            onSilenceTimerEnd={() => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === msg.id
                    ? {
                        ...m,
                        negotiationCoachingData: m.negotiationCoachingData
                          ? { ...m.negotiationCoachingData, showSilenceTimer: false }
                          : undefined,
                      }
                    : m,
                ),
              );
            }}
          />
        );
      }

      // Code-containing messages obtém special styling
      // We divide por código blocks para keep o "Code Solution" UI intact para o código parts
      // Mas uso ReactMarkdown para o texto parts ao redor it
      if (msg.isCode || (msg.role === 'system' && msg.text.includes('```'))) {
        const parts = msg.text.split(/(```[\s\S]*?(?:```|$))/g);
        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="space-y-2 text-[14.5px] leading-relaxed">
              {parts.map((part, i) => {
                if (part.startsWith('```')) {
                  const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);
                  if (match || part.startsWith('```')) {
                    const lang = match && match[1] ? match[1] : 'python';
                    const code = (match && match[2]
                      ? match[2]
                      : part.replace(/^```\w*\s*/, '').replace(/```$/, '')).trim();
                    return (
                      <HighlightedCode
                        key={i}
                        code={code}
                        lang={lang}
                        isLightTheme={isLightTheme}
                        codeTheme={codeTheme}
                        codeBlockClass={codeBlockClass}
                        codeHeaderClass={codeHeaderClass}
                        codeHeaderTextClass={codeHeaderTextClass}
                        codeLineNumberColor={codeLineNumberColor}
                        appearance={appearance}
                        isModernTheme={isModernTheme}
                        isGlassTheme={isGlassTheme}
                      />
                    );
                  }
                }
                // Regular texto - Renderizar com Markdown
                return (
                  <div key={i} className="markdown-content">
                    <ReactMarkdown
                      remarkPlugins={REMARK_PLUGINS}
                      rehypePlugins={REHYPE_PLUGINS}
                      components={mdComponents.codeText}
                    >
                      {part}
                    </ReactMarkdown>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // Custom Styled Labels (Shorten, Recap, Follow-up) - também uso Markdown para content
      if (msg.intent === 'shorten') {
        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed markdown-content">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.shortenText}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      if (msg.intent === 'recap') {
        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed markdown-content">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.recapText}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      if (msg.intent === 'follow_up_questions') {
        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed markdown-content">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.followUpQuestionsText}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      if (msg.intent === 'what_to_answer') {
        // Divide texto por código blocks (Handle unclosed blocks at EOF)
        const parts = msg.text.split(/(```[\s\S]*?(?:```|$))/g);

        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed">
              {parts.map((part, i) => {
                if (part.startsWith('```')) {
                  // Robust matching: gerencia unclosed blocks para streaming (```...$)
                  const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);

                  // Fallback logic: se it inicia com ticks, treat como código (até se unclosed)
                  if (match || part.startsWith('```')) {
                    const lang = match && match[1] ? match[1] : 'python';
                    let code = '';

                    if (match && match[2]) {
                      code = match[2].trim();
                    } else {
                      // Manual strip se regex failed
                      code = part
                        .replace(/^```\w*\s*/, '')
                        .replace(/```$/, '')
                        .trim();
                    }

                    return (
                      <HighlightedCode
                        key={i}
                        code={code}
                        lang={lang}
                        isLightTheme={isLightTheme}
                        codeTheme={codeTheme}
                        codeBlockClass={codeBlockClass}
                        codeHeaderClass={codeHeaderClass}
                        codeHeaderTextClass={codeHeaderTextClass}
                        codeLineNumberColor={codeLineNumberColor}
                        appearance={appearance}
                        isModernTheme={isModernTheme}
                        isGlassTheme={isGlassTheme}
                      />
                    );
                  }
                }
                // Regular texto - Renderizar Markdown
                return (
                  <div key={i} className="markdown-content">
                    <ReactMarkdown
                      remarkPlugins={REMARK_PLUGINS}
                      rehypePlugins={REHYPE_PLUGINS}
                      components={mdComponents.whatToAnswerText}
                    >
                      {part}
                    </ReactMarkdown>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // Fallback para geral system/chat messages para garante they maintain cartão structure após streaming termina
      if (msg.role === 'system' && !msg.isNegotiationCoaching) {
        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed markdown-content">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.standard}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      // Standard Text Messages (e.g. de User ou Interviewer)
      // We ainda want basic markdown suportar aqui também
      return (
        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={mdComponents.standard}
          >
            {msg.text}
          </ReactMarkdown>
        </div>
      );
    },
    [isLightTheme, mdComponents, appearance],
  );

  // We uso a ref para hold o latest handlers para avoid re-binding o evento ouvinte em todo renderizar
  const handlersRef = useRef({
    handleWhatToSay,
    handleFollowUp,
    handleFollowUpQuestions,
    handleRecap,
    handleAnswerNow,
    handleClarify,
    handleCodeHint,
    handleBrainstorm,
  });

  // Atualiza ref em todo renderizar então o evento ouvinte sempre acesso latest state/props
  handlersRef.current = {
    handleWhatToSay,
    handleFollowUp,
    handleFollowUpQuestions,
    handleRecap,
    handleAnswerNow,
    handleClarify,
    handleCodeHint,
    handleBrainstorm,
  };

  useEffect(() => {
    // ── Continuous, frame-rate-independent rolar com momentum ──
    // Velocity é integrated contra real elapsed time então 60Hz, 120Hz, and
    // dropped-frame paths todos produce o mesmo physical speed. Enquanto a chave
    // é held we ease velocity para cima para TERMINAL; em release we decay it
    // exponentially, que what it makes o para feel weighted em vez disso de
    // snapped. Sub-pixel motion é preserved via a fractional accumulator,
    // e we escreve `scrollTop` directly para bypass qualquer browser scroll-behavior
    // smoothing que iria fight o loop.
    const TERMINAL_VELOCITY = 1400; // px/s at completo hold
    const ACCEL_SECONDS = 0.18; // time to reach terminal de rest
    const DECAY_HALF_LIFE = 0.09; // seconds para velocity to halve após release
    const DECAY_K = Math.LN2 / DECAY_HALF_LIFE;
    const MIN_VELOCITY = 6; // px/s — snap to 0 abaixo this
    const MAX_FRAME_DT = 0.05; // clamp to absorb tab-throttle hiccups

    let direction: -1 | 0 | 1 = 0; // -1 upara cima 0 idle, 1 abaixo (ou ambos up+down → 0)
    let upHeld = false;
    let downHeld = false;
    let velocity = 0; // signed px/s
    let positionFraction = 0; // sub-pixel accumulator
    let lastTs = 0;
    let rafId: number | null = null;

    const recomputeDirection = () => {
      direction = upHeld === downHeld ? 0 : upHeld ? -1 : 1;
    };

    const tick = (ts: number) => {
      const container = scrollContainerRef.current;
      if (!container) {
        rafId = null;
        lastTs = 0;
        return;
      }
      if (lastTs === 0) lastTs = ts;
      const dt = Math.min((ts - lastTs) / 1000, MAX_FRAME_DT);
      lastTs = ts;

      if (direction !== 0) {
        const target = direction * TERMINAL_VELOCITY;
        const step = (TERMINAL_VELOCITY / ACCEL_SECONDS) * dt;
        if (Math.abs(target - velocity) <= step) velocity = target;
        else velocity += Math.sign(target - velocity) * step;
      } else {
        velocity *= Math.exp(-DECAY_K * dt);
        if (Math.abs(velocity) < MIN_VELOCITY) velocity = 0;
      }

      // Cache layout lê uma vez por frame, então a único scrollTop wescreve
      const maxScroll = container.scrollHeight - container.clientHeight;
      const current = container.scrollTop;
      const move = velocity * dt + positionFraction;
      const intMove = Math.trunc(move);
      positionFraction = move - intMove;

      if (intMove !== 0) {
        let next = current + intMove;
        if (next <= 0) {
          next = 0;
          if (velocity < 0) {
            velocity = 0;
            positionFraction = 0;
          }
        } else if (next >= maxScroll) {
          next = maxScroll;
          if (velocity > 0) {
            velocity = 0;
            positionFraction = 0;
          }
        }
        if (next !== current) container.scrollTop = next;
      }

      if (direction !== 0 || velocity !== 0) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
        lastTs = 0;
        positionFraction = 0;
      }
    };

    const startScrollLoop = () => {
      if (rafId === null) rafId = requestAnimationFrame(tick);
    };
    const releaseScroll = () => {
      upHeld = false;
      downHeld = false;
      recomputeDirection();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const {
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm,
      } = handlersRef.current;

      // Chat Shortcuts (SEscopo Local para Chat/Overlay ugeralmente mas we permitir them aqui se focused)
      if (isShortcutPressed(e, 'whatToAnswer')) {
        e.preventDefault();
        handleWhatToSay();
      } else if (isShortcutPressed(e, 'clarify')) {
        e.preventDefault();
        handleClarify();
      } else if (isShortcutPressed(e, 'followUp')) {
        e.preventDefault();
        handleFollowUpQuestions();
      } else if (isShortcutPressed(e, 'dynamicAction4')) {
        e.preventDefault();
        if (actionButtonMode === 'brainstorm') {
          handleBrainstorm();
        } else {
          handleRecap();
        }
      } else if (isShortcutPressed(e, 'answer')) {
        e.preventDefault();
        handleAnswerNow();
      } else if (isShortcutPressed(e, 'codeHint')) {
        e.preventDefault();
        handleCodeHint();
      } else if (isShortcutPressed(e, 'brainstorm')) {
        e.preventDefault();
        handleBrainstorm();
      } else if (isShortcutPressed(e, 'scrollUp')) {
        e.preventDefault();
        upHeld = true;
        recomputeDirection();
        startScrollLoop();
      } else if (isShortcutPressed(e, 'scrollDown')) {
        e.preventDefault();
        downHeld = true;
        recomputeDirection();
        startScrollLoop();
      } else if (isShortcutPressed(e, 'moveWindowUp') || isShortcutPressed(e, 'moveWindowDown')) {
        // Prevenir padrão scrolling quando moving window
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Users tipicamente lift o modifier (Cmd/Ctrl) fprimeiro então releasing
      // qualquer um it ou o arrow termina o hold e lets momentum decay.
      if (e.key === 'ArrowUp') {
        upHeld = false;
        recomputeDirection();
      } else if (e.key === 'ArrowDown') {
        downHeld = false;
        recomputeDirection();
      } else if (e.key === 'Meta' || e.key === 'Control') {
        releaseScroll();
      }
    };

    // Window desfocar swallows keyup; reinicia para avoid stuck scrolling.
    const handleBlur = () => releaseScroll();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isShortcutPressed]);

  // General Global Shortcuts (Rebindable)
  // We ouvir aqui para manipular them quando o janela é focused (renderer side)
  // Global shortcuts (quando janela blurred) são handled por Principal processo -> GlobalShortcuts
  // Mas Principal processo events pode ser não reach aqui se we don't louvir ou we want unified handling.
  // Actually, KeybindManager registra global shortcuts. If they são registered como global,
  // Electron pode ser consume them antes they reach haqui
  // 'toggle-app' é Global.
  // 'toggle-visibility' é Não Global em padrão configuração (isGlobal: false), então it depends em ffocar
  // Então we Precisa ouvir para them haqui

  const generalHandlersRef = useRef({
    toggleVisibility: () => window.electronAPI.toggleWindow(),
    processScreenshots: handleWhatToSay,
    resetCancel: async () => {
      if (isProcessing) {
        cancelActiveChatStream();
      } else {
        await window.electronAPI.resetIntelligence();
        resetChatState();
        setAttachedContext([]);
        setInputValue('');
      }
    },
    toggleMousePassthrough: () => {
      const newState = !isMousePassthrough;
      setIsMousePassthrough(newState);
      window.electronAPI?.setOverlayMousePassthrough?.(newState);
    },
    takeScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeScreenshot();
        if (data && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering screenshot:', err);
      }
    },
    selectiveScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeSelectiveScreenshot();
        if (data && !data.cancelled && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering selective screenshot:', err);
      }
    },
  });

  // Atualiza ref
  generalHandlersRef.current = {
    toggleVisibility: () => window.electronAPI.toggleWindow(),
    processScreenshots: handleWhatToSay,
    resetCancel: async () => {
      if (isProcessing) {
        cancelActiveChatStream();
      } else {
        await window.electronAPI.resetIntelligence();
        resetChatState();
        setAttachedContext([]);
        setInputValue('');
      }
    },
    toggleMousePassthrough: () => {
      const newState = !isMousePassthrough;
      setIsMousePassthrough(newState);
      window.electronAPI?.setOverlayMousePassthrough?.(newState);
    },
    takeScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeScreenshot();
        if (data && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering screenshot:', err);
      }
    },
    selectiveScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeSelectiveScreenshot();
        if (data && !data.cancelled && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering selective screenshot:', err);
      }
    },
  };

  useEffect(() => {
    const handleGeneralKeyDown = (e: KeyboardEvent) => {
      const handlers = generalHandlersRef.current;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (isShortcutPressed(e, 'toggleVisibility')) {
        // Sempre permitir toggling visibility
        e.preventDefault();
        handlers.toggleVisibility();
      } else if (isShortcutPressed(e, 'processScreenshots')) {
        if (!isInput) {
          e.preventDefault();
          handlers.processScreenshots();
        }
        // If entrada focused, let padrão behavior (Enter) happen ou manipular it via onKeyDown em Entrada
      } else if (isShortcutPressed(e, 'resetCancel')) {
        e.preventDefault();
        handlers.resetCancel();
      } else if (isShortcutPressed(e, 'takeScreenshot')) {
        e.preventDefault();
        handlers.takeScreenshot();
      } else if (isShortcutPressed(e, 'selectiveScreenshot')) {
        e.preventDefault();
        handlers.selectiveScreenshot();
      } else if (isShortcutPressed(e, 'toggleMousePassthrough')) {
        e.preventDefault();
        handlers.toggleMousePassthrough();
      }
    };

    window.addEventListener('keydown', handleGeneralKeyDown);
    return () => window.removeEventListener('keydown', handleGeneralKeyDown);
  }, [isShortcutPressed]);

  // Global "Capture & PProcesso shortcut manipulador (issue #90)
  // Registered separately então it sempre tem o latest handlersRef via stable ref aacesso
  // Principal processo takes o screenshot e envia "capture-and-process" com path+preview;
  // we anexar o screenshot para contexto e imediatamente acionar AI analysis.
  useEffect(() => {
    if (!window.electronAPI.onCaptureAndProcess) return;
    const unsubscribe = window.electronAPI.onCaptureAndProcess((data) => {
      setIsExpanded(true);

      // Armazenamento screenshot em a stable ref Antes updating React sestado
      // This fixes o React 18 concurrent modo timing race onde setTimeout(0)
      // poderia disparar antes setAttachedContext tinha flushed, leaving handleWhatToSay
      // com an vazio attachedContext e causing silent failures.
      pendingCaptureRef.current = data;

      setAttachedContext((prev) => {
        if (prev.some((s) => s.path === data.path)) return prev;
        return [...prev, data].slice(-5);
      });

      // Uso requestAnimationFrame então we aguardar para at menos one paint cycle —
      // mais reliable than setTimeout(0) sob React 18 concurrent scheduling.
      // O ref guarantees handleWhatToSay tem o screenshot independentemente de
      // se o estado atualiza tem flushed yainda
      requestAnimationFrame(() => {
        try {
          handlersRef.current.handleWhatToSay();
        } finally {
          pendingCaptureRef.current = null;
        }
      });
    });
    return unsubscribe;
  }, []);

  // Inertial-scroll engine. Cada globalShortcut disparar kicks velocity em one
  // axis; a único RAF loop integrates posição com friction. A lone tap
  // glides ~250ms então decays; rapid taps sustain motion. Needed porque
  // Carbon HotKey em macOS faz não auto-repeat com Cmd held, então naive
  // per-fire scrollBy(100px) produces stuttery, taps-only motion.
  const inertialScrollRef = useRef<{
    kick: (axis: 'vert' | 'horiz', direction: -1 | 1) => void;
  } | null>(null);

  useEffect(() => {
    const KICK_VELOCITY = 900; // px/s added por press
    const TERMINAL_VELOCITY = 3200; // px/s clamp
    const FRICTION_HALF_LIFE = 0.16; // seconds para velocity to halve
    const MIN_VELOCITY = 8; // px/s — snap to zero abaixo
    const MAX_FRAME_DT = 0.05; // clamp para tab-throttle hiccups

    const state = {
      raf: null as number | null,
      lastTs: 0,
      vert: { vel: 0, target: null as HTMLElement | null, frac: 0 },
      horiz: { vel: 0, target: null as HTMLElement | null, frac: 0 },
    };

    const resolveHorizontalTarget = (container: HTMLElement): HTMLElement | null => {
      const containerRect = container.getBoundingClientRect();
      const containerCenter = (containerRect.top + containerRect.bottom) / 2;

      const preElements = container.querySelectorAll('pre');
      let best: HTMLElement | null = null;
      let bestDistance = Infinity;

      preElements.forEach((pre) => {
        // Walk para cima de <pre> até we encontra o actual horizontal scroller.
        // Markdown renderers frequentemente encapsular <pre> em a div que holds overflow-x.
        let scroller: HTMLElement | null = pre as HTMLElement;
        while (scroller && scroller !== container) {
          if (scroller.scrollWidth > scroller.clientWidth + 1) break;
          scroller = scroller.parentElement;
        }
        if (!scroller || scroller === container) return;
        if (scroller.scrollWidth <= scroller.clientWidth + 1) return;

        const rect = scroller.getBoundingClientRect();
        if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) return;

        const distance = Math.abs((rect.top + rect.bottom) / 2 - containerCenter);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = scroller;
        }
      });

      return best;
    };

    const tick = (ts: number) => {
      if (state.lastTs === 0) state.lastTs = ts;
      const dt = Math.min((ts - state.lastTs) / 1000, MAX_FRAME_DT);
      state.lastTs = ts;
      const decay = Math.pow(0.5, dt / FRICTION_HALF_LIFE);

      const stepAxis = (axis: 'vert' | 'horiz') => {
        const a = state[axis];
        if (Math.abs(a.vel) < MIN_VELOCITY || !a.target) {
          a.vel = 0;
          a.frac = 0;
          a.target = null;
          return false;
        }
        const move = a.vel * dt + a.frac;
        const intMove = Math.trunc(move);
        a.frac = move - intMove;
        if (intMove !== 0) {
          if (axis === 'vert') a.target.scrollTop += intMove;
          else a.target.scrollLeft += intMove;
        }
        a.vel *= decay;
        return true;
      };

      const vertActive = stepAxis('vert');
      const horizActive = stepAxis('horiz');

      if (vertActive || horizActive) {
        state.raf = requestAnimationFrame(tick);
      } else {
        state.raf = null;
        state.lastTs = 0;
      }
    };

    const kick = (axis: 'vert' | 'horiz', direction: -1 | 1) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      let target: HTMLElement | null;
      if (axis === 'vert') {
        target = container;
      } else {
        target = resolveHorizontalTarget(container);
        // Não visible scrollable código block → no-op em vez than scrolling
        // an off-screen one ou shaking o chat container sideways.
        if (!target) return;
      }

      const a = state[axis];
      // Reverter direction: reinicia em vez than fight existing momentum.
      if (a.target !== target || Math.sign(a.vel) === -direction) {
        a.vel = 0;
        a.frac = 0;
      }
      a.target = target;
      const next = a.vel + direction * KICK_VELOCITY;
      a.vel = Math.max(-TERMINAL_VELOCITY, Math.min(TERMINAL_VELOCITY, next));

      if (state.raf === null) state.raf = requestAnimationFrame(tick);
    };

    inertialScrollRef.current = { kick };

    return () => {
      if (state.raf !== null) cancelAnimationFrame(state.raf);
      inertialScrollRef.current = null;
    };
  }, []);

  // Stealth Global Shortcuts Manipulador
  // Ouvir para shortcuts triggered quando o app é em o background
  useEffect(() => {
    if (!window.electronAPI.onGlobalShortcut) return;
    const unsubscribe = window.electronAPI.onGlobalShortcut(({ action }) => {
      const handlers = handlersRef.current;
      const generalHandlers = generalHandlersRef.current;

      isStealthRef.current = true;

      if (action === 'whatToAnswer') handlers.handleWhatToSay();
      else if (action === 'shorten') handlers.handleFollowUp('shorten');
      else if (action === 'followUp') handlers.handleFollowUpQuestions();
      else if (action === 'recap') handlers.handleRecap();
      else if (action === 'dynamicAction4') {
        if (actionButtonMode === 'brainstorm') handlers.handleBrainstorm();
        else handlers.handleRecap();
      } else if (action === 'answer') handlers.handleAnswerNow();
      else if (action === 'clarify') handlers.handleClarify();
      else if (action === 'codeHint') handlers.handleCodeHint();
      else if (action === 'brainstorm') handlers.handleBrainstorm();
      else if (action === 'scrollUp') inertialScrollRef.current?.kick('vert', -1);
      else if (action === 'scrollDown') inertialScrollRef.current?.kick('vert', 1);
      else if (action === 'scrollLeft') inertialScrollRef.current?.kick('horiz', -1);
      else if (action === 'scrollRight') inertialScrollRef.current?.kick('horiz', 1);
      else if (action === 'focusInput') {
        // Stealth-focus o chat ientrada o panel-type overlay (macOS) é
        // já chave sem activating o app. We apenas precisa o entrada
        // elemento para ser o ativo DOM alvo então keystrokes land em it.
        // Defer para próximo frame então an expand-from-collapsed tem time to
        // montar o entrada antes .fofocar rexecuta
        setIsExpanded(true);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => textInputRef.current?.focus());
        });
      } else if (action === 'processScreenshots') generalHandlers.processScreenshots();
      else if (action === 'resetCancel') generalHandlers.resetCancel();
      else if (action === 'takeScreenshot') generalHandlers.takeScreenshot();
      else if (action === 'selectiveScreenshot') generalHandlers.selectiveScreenshot();

      // Safety reinicia se it didn't acionar an expansion
      setTimeout(() => {
        isStealthRef.current = false;
      }, 500);
    });
    return unsubscribe;
  }, []);

  // ── Tap de teclado stealth (CGEventTap) — caminho de entrada de grau Refract ──
  //
  // Quando o OS-level tap é engaged (toggled por Cmd/Ctrl+Shift+Space),
  // todo keystroke é captured Antes o foreground app sees it and
  // forwarded haqui We anexar `chars` directly para inputValue sem já
  // touching DOM focar — o chat entrada nunca tem para ser o ativo eelemento
  // então o painel nunca tem para ser o chave window. Zoom/browser stays como o
  // OS frontmost+key application por todo o entire typing ssessão
  //
  // HID virtual keycodes referenced abaixo (stable através layouts):
  //   36 = RRetorna  48 = Tab,  51 = Exclui (Backspace),  53 = Esc,
  //   76 = Numpad Enter,  123 = Left,  124 = RDireito  125 = DAbaixo  126 = UPara cima
  useEffect(() => {
    if (!window.electronAPI?.onStealthTapState || !window.electronAPI?.onStealthKeyCaptured) return;

    // Effect-scoped flag define quando Esc é observed em o captured-key
    // sstream Suppresses non-Esc events que pode ter sido queued por o
    // worker thread antes o user pressed Esc. Cleared em cada new
    // active=true estado evento (a novo tap sesessão Hoisted aqui então ambos
    // listeners see o mesmo binding.
    let escSuppressUntilNextActive = false;

    const unsubState = window.electronAPI.onStealthTapState(({ active, reason }) => {
      stealthTapActiveRef.current = active;
      setStealthTapActive(active);
      if (active) {
        isCgEventTapAvailableRef.current = true;
        // Auto-expand o overlay então o user pode see o que they're
        // typing. We fazer Não chamar .fofocar — o whole point de o
        // tap é para avoid window-level ffocar
        isStealthRef.current = true;
        setIsExpanded(true);
        setStealthPermissionMissing(false);
        escSuppressUntilNextActive = false;
      }
      if (!active && reason === 'permission') {
        isCgEventTapAvailableRef.current = false;
        setStealthPermissionMissing(true);
      }
    });

    const unsubKey = window.electronAPI.onStealthKeyCaptured((ev) => {
      // CONTRACT Com RUST: keyboard_tap.rs pass-through filtrar (R3)
      // Retorna o evento unmodified para Qualquer system-modifier chave
      // (Cmd / Ctrl / Opção / Fn) e para Todos F-keys, então o OS
      // routes those normalmente para o foreground app. Consequence:
      // (ev.flags & CMD) é Nunca verdadeiro haqui nenhum é OPT ou CTRL.
      // O anterior round tinha Cmd+Enter / Cmd+Backspace / Cmd+A /
      // Option+Backspace branches — todos dead código sob R3. Removed
      // para prevenir a falso sense de feature ssuportar se Rust já
      // changes o filtrar para entregar Cmd events, those branches
      // precisa para ser REINTRODUCED com explicit testing, não
      // resurrected de a TODO.

      // Esc handled independentemente de ativo estado (principal processo broadcasts
      // it Antes stopping o tap, então we obtém aqui enquanto ainda active;
      // see StealthKeyboardManager.handleCapturedKey ordering).
      if (ev.isKeyDown && ev.keyCode === 53) {
        setInputValue('');
        escSuppressUntilNextActive = true;
        return;
      }

      // Belt-and-braces claro de o Esc-suppress flag em o primeiro
      // chave evento de a novo ssessão Estado e captured-key arrive em
      // separate IPC channels e ordering através channels é Não
      // guaranteed — se o primeiro keystroke de a novo sessão arrives
      // antes o state-active broadcast, o suprimir flag (define por
      // o Esc anterior) ainda seria verdadeiro e a tecla seria
      // dropped. We re-check o ref (que o estado ouvinte flips
      // synchronously em receipt): se o ref é agora tverdadeiro isso é a
      // legitimate new-session keystroke → claro suprimir e proceed.
      if (escSuppressUntilNextActive && stealthTapActiveRef.current) {
        console.warn(
          '[stealth] cross-channel race resolved by ref check — captured-key arrived before state event',
        );
        escSuppressUntilNextActive = false;
      }
      if (escSuppressUntilNextActive) return; // soltar late-arriving keys após Esc
      if (!stealthTapActiveRef.current) return; // ignorar outro events após para
      if (!ev.isKeyDown) return; // we apenas act em keyDown

      switch (ev.keyCode) {
        case 36: // Retorna
        case 76: // Numpad Enter
          handleManualSubmitRef.current();
          window.electronAPI.stealthTapStop().catch(() => {});
          return;
        case 51: // Backspace — exclui one char
          setInputValue((prev) => prev.slice(0, -1));
          return;
        // ROUND 4 FIX (#6): Tab (48) e arrows (123-126) used to
        // ser no-op'd haqui They're agora passed através at o Rust
        // layer (keyboard_tap.rs F-key whitelist) então they reach o
        // user's foreground app nnormalmente Removing o dead cases
        // keeps o contract honest: isso trocar apenas sees text-
        // worthy keys + Backspace + Enter. If anyone já changes
        // o Rust filtrar para entregar Tab anovamente decide explicitly
        // o que deve fazer aqui em vez de copiar e colar uma operação nula.
      }

      // Append printable chars. CGEventKeyboardGetUnicodeString já
      // honors o ativo layout, dead keys, e IME — we don't precisa to
      // re-derive characters de keyCode + modifiers ourselves. Filtrar
      // shift-only modifier (it's já encoded em o chars).
      if (
        ev.chars &&
        ev.chars.length > 0 &&
        ev.chars !== '\r' &&
        ev.chars !== '\n' &&
        ev.chars !== '\t'
      ) {
        setInputValue((prev) => prev + ev.chars);
      }
    });

    return () => {
      unsubState();
      unsubKey();
    };
  }, []);

  // ── Stealth hotkey registration-failure ouvinte ──
  //
  // KeybindManager fires isso quando globalShortcut.register() Retorna false
  // (o OS ou outro app owns o accelerator). Sem surfacing it,
  // o user presses o hotkey, nada happens, e they assume o
  // stealth feature é broken. We filtrar para o stealth-typing keybind
  // e renderizar an inline banner pointing para Settings → Shortcuts.
  useEffect(() => {
    if (!window.electronAPI?.onKeybindRegistrationFailed) return;
    const unsubscribe = window.electronAPI.onKeybindRegistrationFailed(({ id, accelerator }) => {
      if (id !== 'chat:focusInput') return;
      setStealthHotkeyConflict(accelerator);
    });
    return unsubscribe;
  }, []);

  // ── Click-to-activate: engage CGEventTap em chat-input click apenas
  //    (opt-IN mmodelo ──
  //
  // ROUND 3 FIX (#1): anteriormente isso ouvinte engaged o tap em Qualquer
  // mousedown em qualquer lugar em o overlay (opt-OUT via data-stealth-ignore).
  // That modelo broke hard: clicking o Settings botão engaged o tap,
  // então Settings opened e o user couldn't tipo their API chave (tap
  // intercepted at OS nível → keystrokes went para Refract's read-only
  // chat inentrada Worse, todo NEW botão added para o overlay era a
  // regression risk — forgetting `data-stealth-ignore` re-introduced o
  // bug silently.
  //
  // Inverted para opt-IN: tap Apenas engages quando o user clicks an elemento
  // marked com `data-stealth-engage="true"` (o chat entrada wrwrapper
  // Buttons executa their normal onClick handlers sem engaging o tap.
  // Two paths ainda let o user inicia typing stealth-style:
  //   • Click o chat entrada → tap engages → DOM focar blocked → tipo
  //   • Press o activation hotkey (Cmd/Ctrl+Shift+Space) → tap engages
  //
  // mousedown (não click) então we engage Antes o entrada iria caso contrário
  // take DOM focar — preventing o painel de becoming chave window, que
  // é o precise evento coding-interview platforms detect via bdesfocar
  useEffect(() => {
    const stealthTapShouldAutoEngage = window.electronAPI?.stealthTapShouldAutoEngage;
    const stealthTapAvailable = window.electronAPI?.stealthTapStart;
    if (!stealthTapAvailable) return;

    // Resolve o IME-safety política uma vez at mmontar Enquanto o promise é em
    // flight we keep o padrão (tverdadeiro então users em plain ASCII layouts
    // see não behaviour change. O probe executa em o principal processo via
    // `defaults read com.apple.HIToolbox`; see electron/services/
    // ImeDetector.ts para o reason isso gate exists at atodos
    // Probe para IME estado (Pinyin, Hangul, Kanji). Result refines
    // stealthAutoEngageOkRef de its safe-true default; we fazer Não
    // precisa para re-check CGEventTap availability aqui — o synchronous
    // window.electronAPI.platform proteger acima já covers that.
    if (stealthTapShouldAutoEngage) {
      stealthTapShouldAutoEngage()
        .then((ok) => {
          stealthAutoEngageOkRef.current = !!ok;
        })
        .catch(() => {
          /* fail abrir — keep padrão */
        });
    }

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const isStealthEngageTarget = Boolean(target?.closest?.('[data-stealth-engage="true"]'));
      if (
        !shouldFireStealthTapStart({
          stealthTapActive: stealthTapActiveRef.current,
          stealthAutoEngageOk: stealthAutoEngageOkRef.current,
          isStealthEngageTarget,
        })
      ) {
        return;
      }
      if (!isCgEventTapAvailableRef.current) return;
      window.electronAPI.stealthTapStart().catch((err) => {
        console.warn('[stealth] tap start IPC failed', err);
      });
    };

    const onFocusRefresh = () => {
      window.electronAPI?.stealthTapRefreshIme?.();
    };

    document.addEventListener('mousedown', onMouseDown, true); // capture fase
    window.addEventListener('focus', onFocusRefresh);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('focus', onFocusRefresh);
    };
  }, []);

  // ── ModelSelector click-outside fechar ──
  //
  // ROUND 3 FIX (#4): substitui o dead `on('blur')` manipulador em o
  // ModelSelectorWindowHelper. Com NSPanel-nonactivating o mmodelo
  // selector janela pode nunca become chave em click, então its desfocar listener
  // nunca fires e o dropdown stays abrir forever. We fechar it aqui
  // por firing an IPC em todo overlay mousedown EXCEPT clicks em o
  // alternar botão si mesmo (que iria race com toggleWindow's open/close
  // logic). Principal processo no-ops o IPC se modelo selector é já
  // closed.
  useEffect(() => {
    if (!window.electronAPI?.modelSelectorCloseIfOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-model-selector-toggle="true"]')) return;
      window.electronAPI.modelSelectorCloseIfOpen().catch(() => {});
    };
    document.addEventListener('mousedown', onMouseDown, true); // capture fase
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, []);

  // ── Input-click DOM-focus block ──
  //
  // Quando o user clicks o chat ientrada o browser tries para focar o
  // <ientrada eelemento That focar promotes o NSPanel para chave janela —
  // que fires window.onblur em qualquer que seja app era anteriormente focused
  // (ZAmpliar browser, IDE). preventDefault() em mousedown blocks o focar
  // tentar entirely. O acima mousedown ouvinte tem já fired
  // stealthTapStart() em capture pfase então por o time we obtém haqui o
  // tap é engaging e DOM focar é não longer o typing pcaminho
  const blockInputFocus = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    if (
      !shouldBlockStealthFocus({
        stealthAutoEngageOk: stealthAutoEngageOkRef.current,
        isCgEventTapAvailable: isCgEventTapAvailableRef.current,
      })
    ) {
      return;
    }
    e.preventDefault();
    // Don't desfocar an already-focused elemento — que si mesmo fires events.
    if (document.activeElement === textInputRef.current) {
      textInputRef.current?.blur();
    }
  }, []);

  // ── Derived STT status para o rolling transcript indicator (interviewer channel) ──
  const interviewerSttIndicatorStatus = sttInterviewerStatus;
  // Strip consecutive erro count de exibir — mostrar apenas em expanded diagnostics
  const interviewerSttIndicatorError = sttInterviewerError?.replace(
    /\s*\(\d+ consecutive errors\):?/gi,
    '',
  );
  const sttSummary = getSttSummary(
    sttUserStatus,
    sttInterviewerStatus,
    sttUserProvider,
    sttInterviewerProvider,
    sttNotConfigured,
    sttUserError,
    sttInterviewerError,
  );
  const showAnswerPanel =
    messages.length > 0 || isManualRecording || isProcessing || answerPanelPinned;
  // Apenas surface o STT pill para genuine problems (config error, failed, ou a
  // dropped-then-reconnecting channel). O neutral 'awaiting-audio' estado
  // ("Listening para audio…") é intentionally suppressed — it added a pill em
  // todo launch e made o topo section look padded vs. o prior bbuild
  // Quando an audio-capture-failure banner é showing, it já conveys o
  // hard failure com actionable UI (repair botão + system-settings deep
  // lilinkar Surfacing o STT "needs attention" erro pill at o mesmo time é
  // o mesmo status em two surfaces — let o richer banner próprio o erro and
  // suprimir o redundant error-tone pill. Reconnecting indication ainda mostra
  // (o banner apenas fires em terminal/stuck, não transient reconnects).
  const audioFailureBannerActive = systemAudioWarning?.kind === 'audio-capture-failure';
  const shouldShowSttSummaryPill =
    (sttSummary.tone === 'error' && !audioFailureBannerActive) ||
    sttUserStatus === 'reconnecting' ||
    sttInterviewerStatus === 'reconnecting';
  // Se o vision chip vai renderizar (mirrors o IIFE's early-return guproteger
  const visionPillFailed = screenContextStatus === 'failed' || !!latestVisionFailureReason;
  const visionPillSucceeded =
    (latestUsedImageInput || screenContextStatus === 'available') && !visionPillFailed;
  // Suppressed: vision pill ("Vision: prprovedor é não necessário em o UI.
  const showVisionPill = false;
  // Gate o whole status-pill linha em having at menos one pill. Caso contrário o
  // vazio linha ainda reserved pt-3+pb-1, leaving a visible gap acima o rolling
  // transcript em launch (não modo yainda STT pill suppressed, não vision/llm).
  // Suppressed: modo label pill é não necessário em o UI.
  // Suppressed: LLM privacy label pill é não necessário em o UI.
  // Suppressed: vision pill ("Vision: prprovedor é não necessário em o UI.
  const hasStatusPill = shouldShowSttSummaryPill || !!pageContext;
  const statusPillBaseClass = `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium shadow-sm backdrop-blur-xl ${isLightTheme ? 'bg-white/55 border-black/10' : 'bg-black/20 border-white/10'}`;

  // Suprimir o shell's scale/translate entry animação até it tem rendered
  // expanded at menos uma vez (define via onAnimationComplete). Em o primeiro content
  // renderizar o OS janela é ainda settling its bounds, então animating
  // escalar 0.95→1 / y 20→0 iria feed o size-reporter a moving box e lê como
  // a shake. `false` tells Framer Motion para montar at o `animate` estado com não
  // enter transition. Re-expansions após montar obtém o completo animation.
  const expandedMotionInitial = hasRenderedExpandedRef.current
    ? { opacity: 0, y: 8, scale: 0.97 }
    : false;
  const markExpandedRendered = useCallback(() => {
    hasRenderedExpandedRef.current = true;
  }, []);

  const copyDiagnostics = async () => {
    const version = import.meta.env.VITE_APP_VERSION || 'unknown';
    const [arch, osVersion] = await Promise.all([
      window.electronAPI?.getArch?.().catch(() => 'unknown'),
      window.electronAPI?.getOsVersion?.().catch(() => 'unknown'),
    ]);
    const userCat = sttUserError ? categorizeSttError(sttUserError) : null;
    const interviewerCat = sttInterviewerError ? categorizeSttError(sttInterviewerError) : null;
    const report = [
      '## STT Diagnostic Report',
      `App Version: ${version}`,
      `Platform: ${osVersion} (${arch})`,
      `---`,
      `Microphone Provider: ${sttUserProvider}`,
      `Microphone Status: ${sttUserStatus}`,
      userCat ? `Microphone Category: ${userCat.title} [${userCat.category}]` : '',
      `Microphone Error: ${sttUserError || 'N/A'}`,
      `---`,
      `System Audio Provider: ${sttInterviewerProvider}`,
      `System Audio Status: ${sttInterviewerStatus}`,
      interviewerCat
        ? `System Audio Category: ${interviewerCat.title} [${interviewerCat.category}]`
        : '',
      `System Audio Error: ${sttInterviewerError || 'N/A'}`,
      `Timestamp: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  };

  // Skill picker: derived de inputValue — abrir quando o user types / ou $ followed
  // apenas por word chars (não space yeainda Fecha automatically uma vez a space é typed.
  const skillPickerQuery = (() => {
    const m = inputValue.match(/^[/$]([A-Za-z0-9_-]*)$/);
    return m ? m[1].toLowerCase() : null;
  })();
  const filteredSkills = skillPickerQuery !== null
    ? availableSkills.filter(
        (s) => s.id.includes(skillPickerQuery) || s.name.toLowerCase().includes(skillPickerQuery),
      )
    : [];
  const clampedPickerIndex = Math.min(skillPickerIndex, Math.max(0, filteredSkills.length - 1));

  return (
    <>
    {/* Standalone resize toggle — fixed to the top-right corner of the Electron
        window, completely outside the main panel body. Inherits screen-capture
        protection from the BrowserWindow's setContentProtection. The hover
        hit-test in the useEffect above includes this button's rect so hovering
        it keeps the window interactive; stealth passthrough still wins when
        undetectable mode is on (syncOverlayInteractionPolicy in WindowHelper
        ORs the master passthrough flag). Only rendered once there's content. */}
    {messages.length > 0 && (
      <ResizeToggle
        ref={resizeToggleRef}
        expanded={isShellWide}
        onToggle={handleManualResizeToggle}
        appearance={appearance}
        interfaceTheme={isGlassTheme ? 'liquid-glass' : isModernTheme ? 'modern' : undefined}
        rightOffset={buttonRight}
        topOffset={buttonTop}
      />
    )}
    <div
      ref={contentRef}
      data-interface-theme={isGlassTheme ? 'liquid-glass' : isModernTheme ? 'modern' : 'default'}
      className="overlay-workspace flex flex-col items-center w-fit mx-auto h-fit min-h-0 bg-transparent p-0 rounded-[22px] font-sans gap-2 overlay-text-primary"
    >
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={expandedMotionInitial}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              // Enter: ligeiramente longer, pure ease-out então o moment you're
              // watching (o arrival) decelerates smoothly. easeInOut delayed
              // o front half e lê como sluggish.
              transition: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
            }}
            exit={{
              opacity: 0,
              y: 6,
              scale: 0.98,
              // Exit faster than enter (asymmetric timing = responsive feel) com
              // an ease-in então it accelerates longe em vez disso de lingering.
              transition: { duration: 0.22, ease: [0.32, 0, 0.67, 0] },
            }}
            onAnimationComplete={markExpandedRendered}
            className="flex flex-col items-center gap-2 w-full"
          >
            {/* Presence Coach — HUD de comunicação ao vivo (100% local).
                Fora do shell (overflow-hidden + contain clipavam acima dele).
                Irmão da TopPill, alinhado à direita. Clicar na pílula abre o
                recap sob demanda. active enquanto o overlay está montado. */}
            <div className="self-end no-drag">
              <PresenceCoachHUD active={true} />
            </div>
            <TopPill
              expanded={isExpanded}
              onToggle={() => setIsExpanded(!isExpanded)}
              onQuit={() => (onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp())}
              appearance={appearance}
              onLogoClick={() => window.electronAPI?.setWindowMode?.('launcher')}
            />
            <motion.div
              ref={shellRef}
              className={`overlay-premium-shell relative max-w-full backdrop-blur-2xl border rounded-[22px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
              style={{
                ...appearance.shellStyle,
                // O painel largura é bound para o LIVE `shellWidth` motion vvalor
                // animated 600↔780 por OVERLAY_RESIZE_SPRING. O conteúdo reflows
                // (text re-wrap + código re-layout) para o real painel largura em todo
                // frame, então it é sempre correto at todo in-between largura — lá
                // é não clipping, não phantom layout width, não transforma distortion.
                // O OS janela stays a fixed OVERLAY_WINDOW_WIDTH (780) e o
                // painel é centered (mx-auto) dentro it, então isso largura change nunca
                // touches a native setBounds e o X origin nunca mmove
                //
                // O cost de reflowing por frame é held abaixo por keeping cada
                // reflow cheap: `contain: layout style` scopes it para isso subtree
                // (beabaixo e syntax highlighting é memoized em o código String +
                // language então a largura change re-wraps texto sem re-tokenizing.
                width: shellWidth,
                // cconter layout/style isolates isso box's layout/style de o
                // ancestor chain então o per-frame largura reflow (and qualquer content
                // growth) faz não dirty layout para cima para o document — o reflow é
                // SCOPED para isso subtree. Não `size` (iria para o box sizing to
                // its conteúdo e break offsetHeight reporting); Não `paint` (iria
                // clip o backdrop-blur, que precisa keep working).
                contain: 'layout style',
              }}
            >
              {isGlassTheme && <GlassEffectLayer parentRef={shellRef} cornerRadius={22} />}

              {hasStatusPill && (
              <div className="relative no-drag flex flex-wrap items-center justify-center gap-1.5 px-4 pt-3 pb-1">
                {shouldShowSttSummaryPill && (
                  <div
                    className={`${statusPillBaseClass} ${getStatusToneClass(sttSummary.tone)}`}
                    title={sttSummary.detail}
                  >
                    <Mic className="h-3 w-3 opacity-70" />
                    <span>{sttSummary.label}</span>
                  </div>
                )}
                {pageContext && (
                  <div
                    className={`${statusPillBaseClass} ${getStatusToneClass(pageContext.partial ? 'warn' : 'ok')} pr-1.5`}
                    title={
                      pageContext.partial
                        ? `Only part of this page could be read automatically${
                            pageContext.missing?.length ? ` (missing: ${pageContext.missing.join(', ')})` : ''
                          }. Highlight the relevant text or press the capture hotkey to capture it manually.`
                        : pageContext.url
                          ? `${pageContext.url} · ${pageContext.chars.toLocaleString()} chars · used on your next answer`
                          : `${pageContext.chars.toLocaleString()} chars · used on your next answer`
                    }
                  >
                    <Globe className="h-3 w-3 opacity-70" />
                    <span className="max-w-[220px] truncate">
                      {pageContextChipLabel(pageContext)}
                    </span>
                    <button
                      type="button"
                      aria-label="Pick a different browser tab"
                      title="Capture a different tab"
                      className="ml-0.5 rounded-full p-0.5 opacity-60 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity"
                      onClick={() => { void openTabPicker(); }}
                    >
                      <List className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Dismiss captured page context"
                      className="ml-0.5 rounded-full p-0.5 opacity-60 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity"
                      onClick={() => {
                        setPageContext(null);
                        try {
                          if (typeof (window as any).lastCapturedDOM === 'string') {
                            (window as any).lastCapturedDOM = '';
                          }
                        } catch (_) {}
                      }}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )}
              </div>
              )}

              {/* Multi-tab picker — escolher que abrir browser tab to capture. */}
              {tabPicker !== null && (
                <div className="relative no-drag mx-4 mt-1 mb-1 rounded-[12px] border border-white/10 bg-black/30 backdrop-blur-xl p-2 shadow-sm">
                  <div className="flex items-center justify-between px-1 pb-1.5">
                    <span className="text-[11px] font-medium overlay-text-primary">
                      {tabPickerLoading ? 'Finding open tabs…' : 'Pick a tab to capture'}
                    </span>
                    <button
                      type="button"
                      aria-label="Close tab picker"
                      className="rounded-full p-0.5 opacity-60 hover:opacity-100 hover:bg-white/10 transition-opacity"
                      onClick={() => setTabPicker(null)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {!tabPickerLoading && tabPicker.length === 0 && (
                    <div className="px-1 py-1 text-[10px] overlay-text-muted">
                      No capturable tabs — is the browser open and the extension connected?
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 max-h-44 overflow-y-auto">
                    {tabPicker.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { void pickTab(t.id); }}
                        className="text-left px-2 py-1.5 rounded-md text-[11px] overlay-text-primary hover:bg-white/10 transition-colors"
                        title={t.url}
                      >
                        <span className="block truncate">{t.title || t.url}</span>
                        <span className="block truncate text-[9px] overlay-text-muted">
                          {hostnameFromUrl(t.url) || t.url}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* System Audio / Screen Recording Warning Banner */}
              {systemAudioWarning && (
                <div className="flex items-center justify-between mx-4 mt-3 mb-1 px-3.5 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-[12px] shadow-sm relative no-drag group/warning">
                  <div className="flex flex-col gap-1 pr-3">
                    <div className="flex items-center gap-2 text-[12.5px] text-yellow-600 dark:text-yellow-400/90 font-medium leading-tight">
                      <div className="shrink-0 p-1 bg-yellow-500/20 rounded-full">
                        <svg
                          className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                          />
                        </svg>
                      </div>
                      <span>
                        {systemAudioWarning.kind === 'screen-recording-permission'
                          ? 'Screen Recording Permission Denied'
                          : 'Audio Capture Issue'}
                      </span>
                    </div>
                    <p className="text-[11px] text-yellow-600/70 dark:text-yellow-400/60 leading-snug pl-[26px]">
                      {systemAudioWarning.message}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/*
                      UX3: deep-link to the correct macOS System Settings pane
                      based on the failure channel. Pre-fix the mic-zero-fill /
                      mic-denied path opened Refract's internal Settings,
                      which then required the user to read the message, alt-tab
                      to System Settings, navigate to Privacy & Security, find
                      Microphone, and toggle Refract. Now one click takes them
                      directly to the right pane. Falls back to internal
                      Settings on Windows or when channel is unknown.
                    */}
                    {(() => {
                      const wantsScreenCapturePane =
                        systemAudioWarning.kind === 'screen-recording-permission' ||
                        systemAudioWarning.channel === 'system';
                      const wantsMicrophonePane =
                        systemAudioWarning.kind === 'audio-capture-failure' &&
                        systemAudioWarning.channel === 'mic';
                      const deepLinkUrl = !isMac
                        ? null
                        : wantsScreenCapturePane
                        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
                        : wantsMicrophonePane
                        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
                        : null;
                      return (
                        <>
                          <button
                            onClick={() => {
                              if (deepLinkUrl) {
                                window.electronAPI.openExternal(deepLinkUrl);
                              } else {
                                // Windows / unknown channel: fall voltar para internal Settings.
                                window.electronAPI?.toggleSettingsWindow?.();
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-700 dark:text-yellow-500 text-[11px] font-semibold transition-all active:scale-95 border border-yellow-500/20 shadow-sm"
                            title={
                              deepLinkUrl
                                ? wantsMicrophonePane
                                  ? 'Open macOS Microphone privacy settings'
                                  : 'Open macOS Screen Recording privacy settings'
                                : 'Open Refract Settings'
                            }
                          >
                            {deepLinkUrl
                              ? wantsMicrophonePane
                                ? 'Open Mic Settings'
                                : 'Open Screen Settings'
                              : 'Open Settings'}
                          </button>
                          {/*
                            UX2: in-app TCC repair button. macOS only.
                            Shows when the banner is from a TCC-related failure
                            (any audio-capture-failure path or screen-recording
                            permission denial). The dominant root cause of
                            "permissions granted but no transcription" is TCC
                            cdhash drift across rebuilds; this button gives the
                            user a one-click recovery without having to know
                            about tccutil or terminal commands. After reset
                            the user must fully quit (Cmd+Q) and reopen.
                          */}
                          {isMac && (
                            <button
                              onClick={async () => {
                                if (tccRepairing) return; // in-flight proteger
                                setTccRepairing(true);
                                try {
                                  const result = await window.electronAPI?.repairTccPermissions?.();
                                  if (result) {
                                    // Mostrar o returned mensagem via o existing
                                    // banner; user pode dismiss quando ready.
                                    setSystemAudioWarning({
                                      kind: 'audio-capture-failure',
                                      message: result.message,
                                      channel: systemAudioWarning.channel,
                                    });
                                  }
                                } catch (err) {
                                  console.warn('[UI] repair-tcc-permissions failed:', err);
                                } finally {
                                  setTccRepairing(false);
                                }
                              }}
                              disabled={tccRepairing}
                              className="px-3 py-1.5 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-700 dark:text-yellow-500 text-[11px] font-medium transition-all active:scale-95 border border-yellow-500/15 disabled:opacity-60 disabled:cursor-not-allowed"
                              title="Reset macOS permission entries for Refract (you will need to grant them again after relaunch)"
                            >
                              {tccRepairing ? 'Resetting…' : 'Repair Permissions'}
                            </button>
                          )}
                        </>
                      );
                    })()}
                    <button
                      onClick={() => setSystemAudioWarning(null)}
                      className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-yellow-600/50 hover:text-yellow-700 dark:text-yellow-500/50 dark:hover:text-yellow-400 transition-colors absolute top-1 right-1 opacity-0 group-hover/warning:opacity-100"
                      title="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              {/* PR #173: STT Não Configured Warning Banner */}
              {sttNotConfigured && (
                <div className="flex items-center justify-between mx-4 mt-3 mb-1 px-3.5 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-[12px] shadow-sm relative no-drag group/stt-warning">
                  <div className="flex flex-col gap-1 pr-3">
                    <div className="flex items-center gap-2 text-[12.5px] text-orange-600 dark:text-orange-400/90 font-medium leading-tight">
                      <div className="shrink-0 p-1 bg-orange-500/20 rounded-full">
                        <svg
                          className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                          />
                        </svg>
                      </div>
                      <span>Transcription Not Configured</span>
                    </div>
                    <p className="text-[11px] text-orange-600/70 dark:text-orange-400/60 leading-snug pl-[26px]">
                      No STT provider selected. Open Settings → Audio to pick one.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        window.electronAPI?.toggleSettingsWindow?.();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-700 dark:text-orange-500 text-[11px] font-semibold transition-all active:scale-95 border border-orange-500/20 shadow-sm"
                    >
                      Open Settings
                    </button>
                    <button
                      onClick={() => setSttNotConfigured(false)}
                      className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-orange-600/50 hover:text-orange-700 dark:text-orange-500/50 dark:hover:text-orange-400 transition-colors absolute top-1 right-1 opacity-0 group-hover/stt-warning:opacity-100"
                      title="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              {/* Fase 3 — Linha de cards de ação dinâmica (gatilhos ao vivo estilo Refract).
                                Appears between status pills and rolling transcript so users see
                                actionable suggestions in their primary scan path. Bar self-hides
                                when no actions are present. */}
              <DynamicActionBar
                onAcceptAction={(action: DynamicActionPayload) => {
                  void handleWhatToSay(action.promptInstruction);
                }}
              />

              {/* Rolling Transcript Bar — live transcript + on-demand diagnostics
                  for hard failures. Reconnecting/awaiting-audio status is owned by
                  the top status pill, so the bar no longer mounts for those (which
                  also avoids an empty bar / duplicated status text). */}
              {showTranscript && rollingTranscript ? (
                <RollingTranscript
                  text={rollingTranscript}
                  isActive={isInterviewerSpeaking}
                  surfaceStyle={appearance.transcriptStyle}
                  interviewerChannel={{
                    status: interviewerSttIndicatorStatus,
                    error: interviewerSttIndicatorError,
                    provider: sttInterviewerProvider,
                  }}
                  microphoneChannel={{
                    status: sttUserStatus,
                    error: sttUserError,
                    provider: sttUserProvider,
                  }}
                />
              ) : null}

              {/* Chat History - Apenas mostrar if lá são messages Ou active states */}
              {showAnswerPanel && (
                <motion.div
                  ref={scrollContainerRef}
                  className="relative z-10 flex-1 overflow-y-auto p-4 space-y-3 no-drag isolate"
                  layout={false}
                  style={{ scrollbarWidth: 'none', maxHeight: scrollMaxH }}
                >
                  {/* Every row spans the full inner width of the scroll
                                        container, which itself rides the shell's animated
                                        width. Bubble max-widths are percentages so the text
                                        and code grow with the canvas — same as iMessage /
                                        Mail when their windows resize. Reflow during the
                                        700 ms tween is gentle (≈0.3 px / frame width delta)
                                        and reads as the canvas "breathing", not jitter.
                                        The other polish (sticky bottom, stable code line
                                        layout via wrapLongLines:false, stability gate that
                                        suppresses transitions during scroll) keeps the
                                        motion calm.

                                        Each row is rendered through React.memo'd MessageRow
                                        so a setMessages on the streaming row does NOT
                                        re-render every prior message — bailout fires on
                                        identity equality (msg, theme, callbacks). */}
                  {displayMessages.map((msg: Message) => (
                    <MessageRow
                      key={msg.id}
                      msg={msg}
                      isLightTheme={isLightTheme}
                      appearance={appearance}
                      onCopy={handleCopy}
                      renderMessageText={renderMessageText}
                    />
                  ))}

                  {/* Active Recording Estado com Live Transcription */}
                  {isManualRecording && (
                    <div className="flex flex-col items-end gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {/* Live transcription preview */}
                      {(manualTranscript || voiceInput) && (
                        <div className="max-w-[85%] px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-[18px] rounded-tr-[4px]">
                          <span className="text-[13px] text-emerald-300">
                            {voiceInput}
                            {voiceInput && manualTranscript ? ' ' : ''}
                            {manualTranscript}
                          </span>
                        </div>
                      )}
                      <div className="px-3 py-2 flex gap-1.5 items-center bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                        <div
                          className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: '0ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                        <span className="text-[10px] text-emerald-400/70 ml-1">Listening...</span>
                      </div>
                    </div>
                  )}

                  {/*
                   * Bouncing-dots "AI is thinking" indicator. Gated on
                   * `!hasStreamingPlaceholder` so it nunca co-exists com a
                   * streaming system linha — que MessageRow already renders as
                   * a visible vazio bubble (subtleSurfaceClass + borda +
                   * rounded-[18px] + px-4 py-3). Without o gate, o user
                   * sees TWO thinking bubbles during o wait: o empty
                   * placeholder above, o dots pill below.
                   *
                   * Once o primeiro token arrives o placeholder fills with
                   * text; once finalize fires `setIsProcessing(false)` clears
                   * isso indicator. The gate keeps a único visible "thinking"
                   * affordance throughout o entire pre-answer phase.
                   */}
                  {isProcessing &&
                    !displayMessages.some(
                      (m) => m.role === 'system' && m.isStreaming,
                    ) && (
                    <div className="flex justify-start">
                      <div
                        className="px-3 py-2 flex gap-1.5 overlay-subtle-surface rounded-full border"
                        style={appearance.subtleStyle}
                      >
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: '0ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </motion.div>
              )}

              {/* Rápido Actions - Minimal & Clean */}
              <div
                className={`overlay-quick-actions flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 overflow-x-hidden ${rollingTranscript && showTranscript ? 'pt-1' : 'pt-3'}`}
              >
                <button
                  type="button"
                  onClick={handleWhatToSay}
                  className={`overlay-quick-action flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  <Pencil className="w-3 h-3 opacity-70" /> What to answer?
                </button>
                <button
                  type="button"
                  onClick={handleClarify}
                  className={`overlay-quick-action flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  <MessageSquare className="w-3 h-3 opacity-70" /> Clarify
                </button>
                <button
                  type="button"
                  onClick={actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap}
                  className={`overlay-quick-action flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  {actionButtonMode === 'brainstorm' ? (
                    <>
                      <Lightbulb className="w-3 h-3 opacity-70" /> Brainstorm
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3 h-3 opacity-70" /> Recap
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleFollowUpQuestions}
                  className={`overlay-quick-action flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  <HelpCircle className="w-3 h-3 opacity-70" /> Follow Up Question
                </button>
                <button
                  type="button"
                  onClick={handleAnswerNow}
                  className={`overlay-quick-action flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all active:scale-95 duration-200 interaction-base interaction-press min-w-[74px] whitespace-nowrap shrink-0 ${
                    isManualRecording
                      ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                      : 'overlay-chip-surface overlay-text-interactive'
                  }`}
                  style={isManualRecording ? undefined : appearance.chipStyle}
                >
                  {isManualRecording ? (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Zap className="w-3 h-3 opacity-70" /> Answer
                    </>
                  )}
                </button>
              </div>

              {/* Entrada Area */}
              <div className="overlay-composer px-3.5 pb-3.5 pt-0">
                {/* Latent Contexto Preview (Attached Screenshot) */}
                {attachedContext.length > 0 && (
                  <div
                    className={`mb-2 rounded-lg p-2 transition-all duration-200 border ${subtleSurfaceClass}`}
                    style={appearance.subtleStyle}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium overlay-text-primary">
                        {attachedContext.length} screenshot{attachedContext.length > 1 ? 's' : ''}{' '}
                        attached
                      </span>
                      <button
                        onClick={() => setAttachedContext([])}
                        className="p-1 rounded-full transition-colors overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                        title="Remove all"
                        style={appearance.iconStyle}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto max-w-full pb-1">
                      {attachedContext.map((ctx, idx) => (
                        <div key={ctx.path} className="relative group/thumb flex-shrink-0">
                          <img
                            src={ctx.preview}
                            alt={`Screenshot ${idx + 1}`}
                            className={`h-10 w-auto rounded border ${isLightTheme ? 'border-black/15' : 'border-white/20'}`}
                          />
                          <button
                            onClick={() =>
                              setAttachedContext((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                            title="Remove"
                          >
                            <X className="w-2.5 h-2.5 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] overlay-text-muted">
                      Ask a question or click Answer
                    </span>
                  </div>
                )}

                {/* Stealth hotkey conflict banner — shown if globalShortcut.register()
                                    failed for chat:focusInput (typically because the configured
                                    activation hotkey is already claimed by another app or by the
                                    OS). Click-to-activate still works (mousedown listener is
                                    independent of the hotkey), but the user can rebind in Settings. */}
                {stealthHotkeyConflict && (
                  <div
                    className="mb-2 px-3 py-2 rounded-xl border border-rose-400/40 bg-rose-500/10 text-[11px] flex items-center gap-2"
                    data-stealth-ignore="true"
                  >
                    <span className="overlay-text-primary flex-1">
                      Stealth typing hotkey{' '}
                      <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-[10px]">
                        {stealthHotkeyConflict}
                      </kbd>{' '}
                      is already in use. Click the input to activate, or rebind in Settings.
                    </span>
                    <button
                      onClick={() => window.electronAPI.openSettingsTab('keybinds')}
                      className="px-2 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 transition-colors text-[11px] font-medium overlay-text-primary whitespace-nowrap"
                      data-stealth-ignore="true"
                    >
                      Rebind
                    </button>
                    <button
                      onClick={() => setStealthHotkeyConflict(null)}
                      className="px-1.5 py-1 rounded-md hover:bg-white/10 transition-colors text-[11px] overlay-text-muted"
                      aria-label="Dismiss"
                      data-stealth-ignore="true"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* Stealth tap permission banner — shown only when the user
                                    pressed the activation hotkey but Accessibility wasn't
                                    granted. macOS-only: Accessibility is a TCC concept that
                                    doesn't exist on Windows, and the underlying CGEventTap
                                    Rust module ships only in the Darwin binary. Gating here
                                    is belt-and-suspenders on top of the native-side gate. */}
                {isMac && stealthPermissionMissing && (
                  <div
                    className="mb-2 px-3 py-2 rounded-xl border border-amber-400/40 bg-amber-500/10 text-[11px] flex items-center gap-2"
                    data-stealth-ignore="true"
                  >
                    <span className="overlay-text-primary flex-1">
                      Stealth typing needs Accessibility access. Grant it in System Settings, then
                      restart Refract.
                    </span>
                    <button
                      onClick={() => window.electronAPI.stealthTapOpenSettings()}
                      className="px-2 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 transition-colors text-[11px] font-medium overlay-text-primary whitespace-nowrap"
                      data-stealth-ignore="true"
                    >
                      Open Settings
                    </button>
                    <button
                      onClick={() => setStealthPermissionMissing(false)}
                      className="px-1.5 py-1 rounded-md hover:bg-white/10 transition-colors text-[11px] overlay-text-muted"
                      aria-label="Dismiss"
                      data-stealth-ignore="true"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* data-stealth-engage marks this subtree as
                                    the ONLY clickable region that engages the
                                    CGEventTap. See the click-to-activate
                                    useEffect (~line 2840) for the opt-IN
                                    rationale — buttons elsewhere in the
                                    overlay no longer accidentally engage the
                                    tap and break inputs in Settings/Model
                                    Selector windows. */}
                <div className="relative group" data-stealth-engage="true">
                  <input
                    ref={textInputRef}
                    data-testid="overlay-chat-input"
                    type="text"
                    aria-label="Ask Refract"
                    value={inputValue}
                    onChange={(e) => { setInputValue(e.target.value); setSkillPickerIndex(0); }}
                    onKeyDown={(e) => {
                      if (filteredSkills.length > 0 && skillPickerQuery !== null) {
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSkillPickerIndex((i) => Math.max(0, i - 1));
                          return;
                        }
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSkillPickerIndex((i) => Math.min(filteredSkills.length - 1, i + 1));
                          return;
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setInputValue('');
                          return;
                        }
                        if (e.key === 'Tab' || (e.key === 'Enter' && !e.repeat)) {
                          e.preventDefault();
                          selectSkill(filteredSkills[clampedPickerIndex]);
                          return;
                        }
                      }
                      if (e.key !== 'Enter' || e.repeat) return;
                      e.preventDefault();
                      handleManualSubmit();
                    }}
                    // Block native DOM focar em click — o painel becoming
                    // chave janela é exatamente o sinal coding-interview
                    // platforms observar para via window.onblur em o parent.
                    // mousedown ouvinte (capture pfase já engaged
                    // o CGEventTap, então typing routes através que pcaminho
                    onMouseDown={blockInputFocus}
                    readOnly={stealthTapActive}
                    className={`overlay-chat-input w-full border focus:ring-1 rounded-[13px] pl-3.5 pr-10 py-2.5 focus:outline-none transition-all duration-200 ease-sculpted text-[13px] leading-relaxed ${inputClass} ${stealthTapActive ? 'ring-2 ring-emerald-400/30 border-emerald-400/40 shadow-[0_0_12px_rgba(52,211,153,0.15)]' : ''}`}
                    style={appearance.inputStyle}
                  />

                  {/* Skill picker — portal then it escapes o overflow-hidden shell */}
                  {filteredSkills.length > 0 && skillPickerQuery !== null &&
                    createPortal(
                      <SkillPicker
                        skills={filteredSkills}
                        selectedIndex={clampedPickerIndex}
                        anchorEl={textInputRef.current}
                        onSelect={selectSkill}
                      />,
                      document.body,
                    )
                  }

                  {/* Custom Rich Placeholder */}
                  {!inputValue && (
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] overlay-text-muted">
                      <span>Ask anything on screen or conversation, or</span>
                      <div className="flex items-center gap-1 opacity-80">
                        {(
                          shortcuts.selectiveScreenshot || [getModifierSymbol('cmd'), 'Shift', 'H']
                        ).map((key, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <span className="text-[10px]">+</span>}
                            <kbd
                              className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center overlay-control-surface overlay-text-secondary"
                              style={appearance.controlStyle}
                            >
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                      <span>for selective screenshot</span>
                    </div>
                  )}

                  {!inputValue && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none opacity-20">
                      <span className="text-[10px]">↵</span>
                    </div>
                  )}
                </div>

                {/* Bottom Linha */}
                <div className="overlay-composer-toolbar flex items-center justify-between mt-2.5 px-0.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-model-selector-toggle="true"
                      aria-label="Select AI model"
                      title="Select AI model"
                      onClick={(e) => {
                        // Calcula posição para detached window
                        if (!contentRef.current) return;
                        const contentRect = contentRef.current.getBoundingClientRect();
                        const buttonRect = e.currentTarget.getBoundingClientRect();
                        const GAP = 8;

                        const x = window.screenX + buttonRect.left;
                        const y = window.screenY + contentRect.bottom + GAP;

                        window.electronAPI.toggleModelSelector({ x, y, activate: false });
                      }}
                      className={`
                                                overlay-model-control
                                                flex items-center gap-2 px-3 py-1.5
                                                border rounded-lg transition-colors
                                                text-xs font-medium w-[140px]
                                                interaction-base interaction-press
                                                ${controlSurfaceClass}
                                            `}
                      style={appearance.controlStyle}
                    >
                      <span className="truncate min-w-0 flex-1">
                        {(() => {
                          const m = currentModel;
                          const codexCliName = getCodexCliModelDisplayName(m);
                          if (codexCliName) return codexCliName;
                          if (m.startsWith('ollama-')) return m.replace('ollama-', '');
                          if (m === 'gemini-3.5-flash') return 'Gemini 3.5 Flash';
                          if (m === 'gemini-3.1-flash-lite') return 'Gemini 3.1 Flash Lite';
                          if (m === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
                          if (m === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
                          if (m === 'gpt-5.4') return 'GPT 5.4';
                          if (m === 'claude-sonnet-4-6') return 'Sonnet 4.6';
                          return m;
                        })()}
                      </span>
                      <ChevronDown size={14} className="shrink-0 transition-transform" />
                    </button>

                    <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />

                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Open overlay settings"
                        title="Overlay settings"
                        onClick={(e) => {
                          if (isSettingsOpen) {
                            // If oabrir apenas fechar it (alternar vai manipular logic mas we pode ser explicit ou apenas talternar
                            // Actually toggle-settings-window gerencia hiding se visible, então logic é smesmo
                            window.electronAPI.toggleSettingsWindow();
                            return;
                          }

                          if (!contentRef.current) return;

                          const contentRect = contentRef.current.getBoundingClientRect();
                          const buttonRect = e.currentTarget.getBoundingClientRect();
                          const POPUP_WIDTH = 270; // Matches SettingsWindowHelper actual width
                          const GAP = 8; // Mesmo gap como entre TopPill and principal corpo (gap-2 = 8px)

                          // X: Left-aligned relative para o Settings Button
                          const x = window.screenX + buttonRect.left;

                          // Y: Abaixo o principal conteúdo + gap
                          const y = window.screenY + contentRect.bottom + GAP;

                          window.electronAPI.toggleSettingsWindow({ x, y });
                        }}
                        className={`
                                            w-7 h-7 flex items-center justify-center rounded-lg
                                            interaction-base interaction-press
                                            ${
                                              isSettingsOpen
                                                ? 'overlay-icon-surface overlay-icon-surface-hover overlay-text-primary'
                                                : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'
                                            }
                                        `}
                        style={appearance.iconStyle}
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Mouse Passthrough Alternar */}
                    <div className="relative">
                      <button
                        type="button"
                        aria-label={isMousePassthrough ? 'Disable mouse passthrough' : 'Enable mouse passthrough'}
                        aria-pressed={isMousePassthrough}
                        title={isMousePassthrough ? 'Disable mouse passthrough' : 'Enable mouse passthrough'}
                        onClick={() => {
                          const newState = !isMousePassthrough;
                          setIsMousePassthrough(newState);
                          window.electronAPI?.setOverlayMousePassthrough?.(newState);
                        }}
                        className={`
                                                    w-7 h-7 flex items-center justify-center rounded-lg
                                                    interaction-base interaction-press
                                                    ${
                                                      isMousePassthrough
                                                        ? 'overlay-icon-surface overlay-icon-surface-hover text-sky-400 opacity-100'
                                                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'
                                                    }
                                                `}
                        style={appearance.iconStyle}
                      >
                        <PointerOff className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label="Send message"
                    onClick={handleManualSubmit}
                    disabled={!inputValue.trim()}
                    className={`
                                    overlay-send-button
                                    w-7 h-7 rounded-full flex items-center justify-center
                                    interaction-base interaction-press
                                    ${
                                      inputValue.trim()
                                        ? 'bg-[#007AFF] text-white shadow-lg shadow-blue-500/20 hover:bg-[#0071E3]'
                                        : 'overlay-icon-surface overlay-text-muted cursor-not-allowed'
                                    }
                                `}
                    style={inputValue.trim() ? undefined : appearance.iconStyle}
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  );
};

export default RefractInterface;
