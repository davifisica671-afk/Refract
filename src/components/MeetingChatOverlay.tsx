import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStreamBuffer } from '../hooks/useStreamBuffer';
import { X, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { genMessageId } from '../utils/messageId';
import { RefractLogoMark } from './RefractLogoMark';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

/**
 * MeetingChatOverlay.tsx
 * Overlay de chat para busca em reuniões. Permite fazer perguntas sobre
 * uma reunião específica usando RAG (Retrieval-Augmented Generation) com
 * streaming de respostas em tempo real.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
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

// ============================================
// Types 
// ============================================

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
}

interface MeetingContext {
    id?: string;  // Obrigatório para consultas RAG
    title: string;
    summary?: string;
    keyPoints?: string[];
    actionItems?: string[];
    transcript?: Array<{ speaker: string; text: string; timestamp: number }>;
}

interface MeetingChatOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    meetingContext: MeetingContext;
    initialQuery?: string;
    onNewQuery: (query: string) => void;
}

type ChatState = 'idle' | 'opening' | 'waiting_for_llm' | 'streaming_response' | 'error' | 'closing';

// ============================================
// Typing Indicator Componente
// ============================================

const TypingIndicator: React.FC = () => {
    const isLightTheme = useResolvedTheme() === 'light';
    const isModernTheme = !!document.querySelector('[data-interface-theme="modern"]');
    const isGlassTheme = !!document.querySelector('[data-interface-theme="liquid-glass"]');
    const isWhiteDots = isModernTheme || isGlassTheme;
    const cardBgBorderClass = isLightTheme
        ? 'bg-emerald-500/10 backdrop-blur-md border border-emerald-500/20 text-emerald-900'
        : 'bg-emerald-600/20 backdrop-blur-md border border-emerald-500/30 text-emerald-100';

    return (
        <div className={`w-fit rounded-[20px] rounded-tl-[4px] px-[16.5px] py-[12.5px] ${cardBgBorderClass} my-2.5 flex items-center justify-center`}>
            <div className="flex items-center gap-1.5 py-0.5">
                {[0, 1, 2].map((i) => (
                    <motion.div
                        key={i}
                        className={`w-2 h-2 rounded-full ${isWhiteDots ? 'bg-white' : 'bg-emerald-400'}`}
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{
                            duration: 0.6,
                            repeat: Infinity,
                            delay: i * 0.15,
                            ease: "easeInOut"
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

// ============================================
// Mensagem Components
// ============================================

const UserMessage: React.FC<{ content: string }> = ({ content }) => (
    <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex justify-end mb-6"
    >
        <div className="bg-accent-primary text-white px-5 py-3 rounded-2xl rounded-tr-md max-w-[70%] text-[15px] leading-relaxed">
            {content}
        </div>
    </motion.div>
);

const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean }> = ({ content, isStreaming }) => {
    const [copied, setCopied] = useState(false);
    const isLightTheme = useResolvedTheme() === 'light';
    const cardBgBorderClass = isLightTheme
        ? 'bg-emerald-500/10 backdrop-blur-md border border-emerald-500/20 text-emerald-900'
        : 'bg-emerald-600/20 backdrop-blur-md border border-emerald-500/30 text-emerald-100';

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-start mb-6 w-full"
        >
            <div className={`w-full max-w-[85%] rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5`}>
                {/* Minimal Copy Button (não AI resposta hcabeçalho */}
                {!isStreaming && content && (
                    <div className="flex justify-end mb-2 select-none w-full">
                        <button
                            onClick={handleCopy}
                            className="flex items-center gap-1.5 text-[11px] text-text-tertiary hover:text-[#4ade80] transition-colors"
                        >
                            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                )}

                {/* Markdown Content com tight line height and spacing */}
                <div className="markdown-content">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false, errorColor: '#cc0000' }]]}
                        components={{
                            p: ({ node, ...props }: any) => <p className="mb-[6px] last:mb-0 leading-relaxed whitespace-pre-wrap text-[13.5px]" {...props} />,
                            a: ({ node, ...props }: any) => <a className="text-[#4ade80] hover:underline" {...props} />,
                            h1: ({ node, ...props }: any) => <h1 className="text-sm font-bold mt-2 mb-[4.5px] leading-relaxed uppercase tracking-wide" {...props} />,
                            h2: ({ node, ...props }: any) => <h2 className="text-xs font-bold mt-1.5 mb-[4.5px] leading-relaxed uppercase tracking-wide" {...props} />,
                            h3: ({ node, ...props }: any) => <h3 className="text-xs font-semibold mt-1.5 mb-[4.5px] leading-relaxed" {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc pl-4 mt-[4.5px] mb-[4.5px] space-y-0 leading-relaxed text-[13.5px]" {...props} />,
                            ol: ({ node, ...props }: any) => <ol className="list-decimal pl-4 mt-[4.5px] mb-[4.5px] space-y-0 leading-relaxed text-[13.5px]" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1 mb-[4.5px] last:mb-0 leading-relaxed text-[13.5px]" {...props} />,
                            pre: ({ children }: any) => <div className="not-prose mb-3 mt-1.5">{children}</div>,
                            code: ({ node, inline, className, children, ...props }: any) => {
                                const match = /language-(\w+)/.exec(className || '');
                                const isInline = inline ?? false;
                                const lang = match ? match[1] : '';

                                return !isInline ? (
                                    <div className="my-2 rounded-xl overflow-hidden border border-white/[0.08] shadow-lg bg-zinc-800/60 backdrop-blur-md">
                                        <div className="bg-white/[0.04] px-3 py-1 border-b border-white/[0.08]">
                                            <span className="text-[9px] uppercase tracking-widest font-semibold text-white/40 font-mono">
                                                {lang || 'CODE'}
                                            </span>
                                        </div>
                                        <div className="bg-transparent">
                                            <SyntaxHighlighter
                                                language={mapLanguageForPrism(lang, String(children))}
                                                style={vscDarkPlus}
                                                customStyle={{
                                                    margin: 0,
                                                    borderRadius: 0,
                                                    fontSize: '12px',
                                                    lineHeight: '1.45',
                                                    background: 'transparent',
                                                    padding: '12px',
                                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                }}
                                                wrapLongLines={true}
                                                showLineNumbers={true}
                                                lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: 'rgba(255,255,255,0.2)', textAlign: 'right', fontSize: '10px' }}
                                                {...props}
                                            >
                                                {String(children).replace(/\n$/, '')}
                                            </SyntaxHighlighter>
                                        </div>
                                    </div>
                                ) : (
                                    <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[12px] font-mono text-text-primary border border-border-subtle whitespace-pre-wrap" {...props}>
                                        {children}
                                    </code>
                                );
                            },
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                    {isStreaming && (
                        <motion.span
                            className="inline-block w-0.5 h-3.5 bg-[#fbbf24] ml-1 align-middle"
                            animate={{ opacity: [1, 0] }}
                            transition={{ duration: 0.5, repeat: Infinity }}
                        />
                    )}
                </div>
            </div>
        </motion.div>
    );
};

// ============================================
// Principal Componente
// ============================================

const MeetingChatOverlay: React.FC<MeetingChatOverlayProps> = ({
    isOpen,
    onClose,
    meetingContext,
    initialQuery = '',
    // onNewQuery
}) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [chatState, setChatState] = useState<ChatState>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const streamBuffer = useStreamBuffer();

    // Envia a consulta inicial quando o overlay abre
    useEffect(() => {
        if (isOpen && initialQuery && messages.length === 0) {
            setChatState('opening');
            setTimeout(() => {
                submitQuestion(initialQuery);
            }, 100);
        }
    }, [isOpen, initialQuery]);

    // Escuta novas consultas do componente pai
    useEffect(() => {
        if (isOpen && initialQuery && messages.length > 0) {
            // Esta é a consulta de acompanhamento
            submitQuestion(initialQuery);
        }
    }, [initialQuery]);

    // Reseta o estado quando o overlay fecha
    useEffect(() => {
        if (!isOpen) {
            setChatState('idle');
            setMessages([]);
            setErrorMessage(null);
        }
    }, [isOpen]);

    // Manipulador da tecla ESC
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Manipulador de clique fora
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            handleClose();
        }
    }, []);

    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    // Constrói a string de contexto para o LLM
    const buildContextString = useCallback((): string => {
        const parts: string[] = [];

        parts.push(`MEETING: ${meetingContext.title}`);

        if (meetingContext.summary) {
            parts.push(`\nSUMMARY:\n${meetingContext.summary}`);
        }

        if (meetingContext.keyPoints?.length) {
            parts.push(`\nKEY POINTS:\n${meetingContext.keyPoints.map(p => `- ${p}`).join('\n')}`);
        }

        if (meetingContext.actionItems?.length) {
            parts.push(`\nACTION ITEMS:\n${meetingContext.actionItems.map(a => `- ${a}`).join('\n')}`);
        }

        if (meetingContext.transcript?.length) {
            const recentTranscript = meetingContext.transcript.slice(-20);
            const transcriptText = recentTranscript
                .map(t => `[${t.speaker === 'user' ? 'Me' : 'Them'}]: ${t.text}`)
                .join('\n');
            parts.push(`\nRECENT TRANSCRIPT:\n${transcriptText}`);
        }

        return parts.join('\n');
    }, [meetingContext]);

    // Envia pergunta usando streaming RAG
    const submitQuestion = useCallback(async (question: string) => {
        if (!question.trim() || chatState === 'waiting_for_llm' || chatState === 'streaming_response') return;

        const userMessage: Message = {
            id: genMessageId(),
            role: 'user',
            content: question
        };
        setMessages(prev => [...prev, userMessage]);
        setChatState('waiting_for_llm');
        setErrorMessage(null);

        // Rola para baixo quando o usuário envia mensagem
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        const assistantMessageId = genMessageId();

        try {
            // Adiciona atraso do indicador de digitação (200ms) - faz a IA parecer "pensativa"
            await new Promise(resolve => setTimeout(resolve, 200));

            // Cria placeholder de mensagem do assistente
            setMessages(prev => [...prev, {
                id: assistantMessageId,
                role: 'assistant',
                content: '',
                isStreaming: true
            }]);

            // Configura os listeners de streaming RAG (em lotes RAF para evitar re-renderizações por token)
            streamBuffer.reset();
            const tokenCleanup = window.electronAPI?.onRAGStreamChunk((data: { chunk: string }) => {
                setChatState('streaming_response');
                streamBuffer.appendToken(data.chunk, (content) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId
                            ? { ...msg, content }
                            : msg
                    ));
                });
            });

            const doneCleanup = window.electronAPI?.onRAGStreamComplete(() => {
                // Commit final — esvazia qualquer conteúdo restante no buffer
                const finalContent = streamBuffer.getBufferedContent();
                setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                        ? { ...msg, content: finalContent, isStreaming: false }
                        : msg
                ));
                setChatState('idle');
                streamBuffer.reset();
                tokenCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
            });

            const errorCleanup = window.electronAPI?.onRAGStreamError((data: { error: string }) => {
                console.error('[MeetingChat] RAG stream error:', data.error);
                setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                setErrorMessage("Couldn't get a response. Please try again.");
                setChatState('error');
                streamBuffer.reset();
                tokenCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
            });

            // Obtém o ID da reunião do contexto para consultas RAG
            const meetingId = meetingContext.id;

            if (meetingId) {
                // Usa consulta de reunião com RAG
                const result = await window.electronAPI?.ragQueryMeeting(meetingId, question);

                // Se RAG não estiver disponível (ou falhou), volta para o chat por janela de contexto
                if (result?.fallback) {
                    console.log("[MeetingChat] RAG unavailable, using context window fallback");
                    // Limpa os listeners RAG já que não os usaremos
                    tokenCleanup?.();
                    doneCleanup?.();
                    errorCleanup?.();

                    // Lógica de fallback
                    const contextString = buildContextString();
                    const systemPrompt = `You are recalling a specific meeting. Answer questions ONLY about this meeting. Be concise (2-4 sentences). Sound natural, like a human recalling. If information is not present, say so briefly. Never guess.

${contextString}`;

                    streamBuffer.reset();
                    const oldTokenCleanup = window.electronAPI?.onGeminiStreamToken((token: string) => {
                        setChatState('streaming_response');
                        streamBuffer.appendToken(token, (content) => {
                            setMessages(prev => prev.map(msg =>
                                msg.id === assistantMessageId
                                    ? { ...msg, content }
                                    : msg
                            ));
                        });
                    });

                    const oldDoneCleanup = window.electronAPI?.onGeminiStreamDone(() => {
                        const finalContent = streamBuffer.getBufferedContent();
                        setMessages(prev => prev.map(msg =>
                            msg.id === assistantMessageId
                                ? { ...msg, content: finalContent, isStreaming: false }
                                : msg
                        ));
                        streamBuffer.reset();
                        oldTokenCleanup?.();
                        oldDoneCleanup?.();
                        oldErrorCleanup?.();
                    });

                    const oldErrorCleanup = window.electronAPI?.onGeminiStreamError((error: string) => {
                        console.error('[MeetingChat] Gemini stream error (fallback):', error);
                        setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                        setErrorMessage("Couldn't get a response. Please check your settings.");
                        setChatState('error');
                        streamBuffer.reset();
                        oldTokenCleanup?.();
                        oldDoneCleanup?.();
                        oldErrorCleanup?.();
                    });

                    await window.electronAPI?.streamGeminiChat(
                        question,
                        undefined,
                        systemPrompt,
                        { skipSystemPrompt: true }
                    );
                }
            } else {
                // Sem ID de reunião, alternativa padrão
                const contextString = buildContextString();
                const systemPrompt = `You are recalling a specific meeting. Answer questions ONLY about this meeting. Be concise (2-4 sentences). Sound natural, like a human recalling. If information is not present, say so briefly. Never guess.

${contextString}`;

                // Muda para streaming Gemini (em lotes RAF)
                streamBuffer.reset();
                const oldTokenCleanup = window.electronAPI?.onGeminiStreamToken((token: string) => {
                    setChatState('streaming_response');
                    streamBuffer.appendToken(token, (content) => {
                        setMessages(prev => prev.map(msg =>
                            msg.id === assistantMessageId
                                ? { ...msg, content }
                                : msg
                        ));
                    });
                });

                const oldDoneCleanup = window.electronAPI?.onGeminiStreamDone(() => {
                    const finalContent = streamBuffer.getBufferedContent();
                    setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId
                            ? { ...msg, content: finalContent, isStreaming: false }
                            : msg
                    ));
                    setChatState('idle');
                    streamBuffer.reset();
                    oldTokenCleanup?.();
                    oldDoneCleanup?.();
                    oldErrorCleanup?.();
                });

                const oldErrorCleanup = window.electronAPI?.onGeminiStreamError((error: string) => {
                    console.error('[MeetingChat] Gemini stream error:', error);
                    setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                    setErrorMessage("Couldn't get a response. Please check your settings.");
                    setChatState('error');
                    streamBuffer.reset();
                    oldTokenCleanup?.();
                    oldDoneCleanup?.();
                    oldErrorCleanup?.();
                });

                await window.electronAPI?.streamGeminiChat(
                    question,
                    undefined,
                    systemPrompt,
                    { skipSystemPrompt: true }
                );
            }

        } catch (error) {
            console.error('[MeetingChat] Error:', error);
            setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
            setErrorMessage("Something went wrong. Please try again.");
            setChatState('error');
        }
    }, [chatState, buildContextString, meetingContext]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="absolute inset-0 z-40 flex flex-col justify-end"
                    onClick={handleBackdropClick}
                >
                    {/* Backdrop com desfoque */}
                    <motion.div
                        initial={{ backdropFilter: 'blur(0px)' }}
                        animate={{ backdropFilter: 'blur(8px)' }}
                        exit={{ backdropFilter: 'blur(0px)' }}
                        transition={{ duration: 0.16 }}
                        className="absolute inset-0 bg-black/40"
                    />

                    {/* Janela de Chat - se estende até o fundo, deixa espaço para a entrada */}
                    <motion.div
                        ref={chatWindowRef}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "85vh", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                            height: { type: "spring", stiffness: 300, damping: 30, mass: 0.8 },
                            opacity: { duration: 0.2 }
                        }}
                        className="relative mx-auto w-full max-w-[680px] mb-0 bg-bg-secondary rounded-t-[24px] border-t border-x border-border-subtle shadow-2xl overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Cabeçalho com botão de fechar */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
                            <div className="flex items-center gap-2 text-text-tertiary">
                                <RefractLogoMark size={14} className="opacity-50" />
                                <span className="text-[13px] font-medium">Search this meeting</span>
                            </div>
                            <button
                                onClick={handleClose}
                                className="p-2 transition-colors group"
                            >
                                <X size={16} className="text-text-tertiary group-hover:text-red-500 group-hover:drop-shadow-[0_0_8px_rgba(239,68,68,0.5)] transition-all duration-300" />
                            </button>
                        </div>

                        {/* Área de mensagens - rolável */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 pb-32 custom-scrollbar">
                            {messages.map((msg) => (
                                msg.role === 'user'
                                    ? <UserMessage key={msg.id} content={msg.content} />
                                    : <AssistantMessage key={msg.id} content={msg.content} isStreaming={msg.isStreaming} />
                            ))}

                            {chatState === 'waiting_for_llm' && <TypingIndicator />}

                            {errorMessage && (
                                <motion.div
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="text-[#FF6B6B] text-[13px] py-2"
                                >
                                    {errorMessage}
                                </motion.div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default MeetingChatOverlay;
