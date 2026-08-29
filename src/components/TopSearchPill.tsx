import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, Sparkles, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * TopSearchPill.tsx
 * Barra de pesquisa no topo do launcher. Permite buscar reuniões, fazer consultas
 * ao AI ou buscas literais. Suporta navegação por teclado e animações de expansão.
 */

// ============================================
// Types
// ============================================

type PillState = 'idle' | 'focused' | 'typing' | 'results';

interface Meeting {
    id: string;
    title: string;
    date: string;
    summary?: string;
}

interface SearchResult {
    id: string;
    type: 'meeting';
    title: string;
    subtitle?: string;
    meetingId: string;
}

interface TopSearchPillProps {
    meetings: Meeting[];
    onAIQuery: (query: string) => void;
    onLiteralSearch: (query: string) => void;
    onOpenMeeting: (meetingId: string) => void;
    onExpansionChange?: (isExpanded: boolean) => void;
}

// ============================================
// Fuzzy Busca Auxiliar
// ============================================

function fuzzyMatch(text: string, query: string): boolean {
    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();

    // Simples contém corresponder para agora
    if (normalizedText.includes(normalizedQuery)) return true;

    // Correspondência fuzzy por caracteres
    // Removido para maior precisão — apenas retorna verdadeiro se houver
    // correspondência exata de substring (já verificado acima)
    return false;
}

function searchMeetings(meetings: Meeting[], query: string): SearchResult[] {
    if (!query.trim()) return [];

    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const meeting of meetings) {
        if (seen.has(meeting.id)) continue;

        // Verifica correspondência contra título e resumo
        const titleMatch = fuzzyMatch(meeting.title, query);
        const summaryMatch = meeting.summary && fuzzyMatch(meeting.summary, query);

        if (titleMatch || summaryMatch) {
            seen.add(meeting.id);
            results.push({
                id: meeting.id,
                type: 'meeting',
                title: meeting.title,
                subtitle: new Date(meeting.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                }),
                meetingId: meeting.id
            });
        }

        if (results.length >= 5) break;
    }

    return results;
}

// ============================================
// Principal Componente
// ============================================

const TopSearchPill: React.FC<TopSearchPillProps> = ({
    meetings,
    onAIQuery,
    onLiteralSearch,
    onOpenMeeting,
    onExpansionChange
}) => {
    const [state, setState] = useState<PillState>('idle');
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Notifica o componente pai sobre mudanças de expansão
    useEffect(() => {
        onExpansionChange?.(state !== 'idle');
    }, [state, onExpansionChange]);

    // Calcula os resultados da busca
    const sessionResults = useMemo(() => {
        if (state !== 'results' || !query.trim()) return [];
        return searchMeetings(meetings, query);
    }, [meetings, query, state]);

    // Total de itens selecionáveis: 2 (seção Explorar) + sessões
    const totalItems = 2 + sessionResults.length;

    // Transições de estado
    const open = useCallback(() => {
        setState('focused');
        setTimeout(() => inputRef.current?.focus(), 50);
    }, []);

    const close = useCallback(() => {
        setState('idle');
        // Atrasa limpeza da consulta para permitir que a animação de saída complete
        setTimeout(() => {
            setQuery('');
            setSelectedIndex(-1);
        }, 150);
        inputRef.current?.blur();
    }, []);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);
        setSelectedIndex(-1);

        if (value.trim()) {
            setState('results');
        } else {
            setState('focused');
        }
    }, []);

    const handleSelect = useCallback((index: number) => {
        if (index === 0) {
            // AI Consulta
            onAIQuery(query);
            close();
        } else if (index === 1) {
            // Literal busca
            onLiteralSearch(query);
            close();
        } else {
            // Sessão result
            const sessionIndex = index - 2;
            const result = sessionResults[sessionIndex];
            if (result) {
                onOpenMeeting(result.meetingId);
                close();
            }
        }
    }, [query, sessionResults, onAIQuery, onLiteralSearch, onOpenMeeting, close]);

    // Tratamento de teclado
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // ⌘K para abrir
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                if (state === 'idle') {
                    open();
                } else {
                    close();
                }
                return;
            }

            if (state === 'idle') return;

            // ESC para fechar
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
                return;
            }

            // Arrow navigation
            if (state === 'results') {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex(prev => Math.max(prev - 1, -1));
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSelect(selectedIndex);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [state, open, close, selectedIndex, totalItems, handleSelect]);

    // Clique fora para fechar
    useEffect(() => {
        if (state === 'idle') return;

        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                close();
            }
        };

        // Atraso para prevenir fechamento imediato ao clicar para abrir
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [state, close]);

    const isExpanded = state !== 'idle';
    const showResults = state === 'results' && query.trim();

    return (
        <>
            {/* Backdrop desfocar overlay */}
            {createPortal(
                <AnimatePresence>
                    {isExpanded && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="fixed inset-0 bg-black/35 backdrop-blur-[6px] z-[90]"
                            onClick={close}
                        />
                    )}
                </AnimatePresence>,
                document.body
            )}

            {/* Busca Pill Container */}
            <div
                ref={containerRef}
                className="absolute left-1/2 -translate-x-1/2 top-[7px] no-drag z-40"
            >
                <div className="relative">
                    <motion.div
                        initial={false}
                        animate={{
                            width: isExpanded ? 500 : 360,
                        }}
                        transition={{
                            type: "spring",
                            stiffness: 150,
                            damping: 25
                        }}
                        className="relative transform-gpu"
                    >
                        {/* Principal Pill */}
                        <div className="relative">
                            <div
                                className="search-command relative overflow-hidden rounded-[11px]"
                            >
                                {/* Entrada Linha */}
                                <div
                                    className="relative flex items-center"
                                    onClick={() => state === 'idle' && open()}
                                >
                                    <div className="absolute left-3 flex items-center pointer-events-none">
                                        <Search size={14} className="text-text-tertiary" />
                                    </div>
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={query}
                                        onChange={handleInputChange}
                                        onFocus={() => state === 'idle' && setState('focused')}
                                        className={`
                                        w-full bg-transparent
                                        h-[28px] pl-9 pr-4
                                        text-[13px] text-text-primary
                                        placeholder-text-tertiary
                                        focus:outline-none
                                        ${state === 'idle' ? 'cursor-default' : 'cursor-text'}
                                    `}
                                        placeholder="Search or ask anything..."
                                    />
                                </div>

                                {/* Results Panel */}
                                <AnimatePresence>
                                    {showResults && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{
                                                type: "spring",
                                                stiffness: 150,
                                                damping: 25,
                                                opacity: { duration: 0.3 }
                                            }}
                                            className="overflow-hidden"
                                        >
                                            <div className="w-[500px]">
                                                <div className="border-t border-border-muted py-2">
                                                    {/* Explore Section */}
                                                    <div className="px-3 py-1">
                                                        <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                                            Explore
                                                        </div>

                                                        {/* Opção de Consulta AI */}
                                                        <motion.button
                                                            initial={{ opacity: 0, scale: 0.95 }}
                                                            animate={{ opacity: 1, scale: 1 }}
                                                            transition={{ duration: 0.2 }}
                                                            data-selected={selectedIndex === 0}
                                                            className={`
                                                            search-command-result w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-left
                                                            ${selectedIndex === 0
                                                                    ? 'bg-bg-item-active'
                                                                    : 'hover:bg-bg-item-hover'
                                                                }
                                                        `}
                                                            onClick={() => handleSelect(0)}
                                                            onMouseEnter={() => setSelectedIndex(0)}
                                                        >
                                                            <div className="w-6 h-6 rounded-md bg-accent-primary/15 border border-accent-primary/20 flex items-center justify-center shrink-0">
                                                                <Sparkles size={12} className="text-accent-primary" />
                                                            </div>
                                                            <span className="text-[13px] text-text-primary truncate">
                                                                {query}
                                                            </span>
                                                        </motion.button>

                                                        {/* Opção de Busca Literal */}
                                                        <motion.button
                                                            initial={{ opacity: 0, scale: 0.95 }}
                                                            animate={{ opacity: 1, scale: 1 }}
                                                            transition={{ duration: 0.2 }}
                                                            data-selected={selectedIndex === 1}
                                                            className={`
                                                            search-command-result w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-left
                                                            ${selectedIndex === 1
                                                                    ? 'bg-bg-item-active'
                                                                    : 'hover:bg-bg-item-hover'
                                                                }
                                                        `}
                                                            onClick={() => handleSelect(1)}
                                                            onMouseEnter={() => setSelectedIndex(1)}
                                                        >
                                                            <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0">
                                                                <Search size={12} className="text-text-secondary" />
                                                            </div>
                                                            <span className="text-[13px] text-text-secondary">
                                                                Search for <span className="text-text-primary">"{query}"</span>
                                                            </span>
                                                        </motion.button>
                                                    </div>

                                                    {/* Sessions Section */}
                                                    {sessionResults.length > 0 && (
                                                        <div className="px-3 py-1 mt-1">
                                                            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                                                Sessions
                                                            </div>

                                                            <AnimatePresence initial={false} mode="popLayout">
                                                                {sessionResults.map((result, index) => (
                                                                    <motion.button
                                                                        layout="position"
                                                                        key={result.id}
                                                                        initial={{ opacity: 0, height: 0 }}
                                                                        animate={{ opacity: 1, height: 'auto' }}
                                                                        exit={{ opacity: 0, height: 0 }}
                                                                        transition={{ duration: 0.2 }}
                                                                        data-selected={selectedIndex === index + 2}
                                                                        className={`
                                                                        search-command-result w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-left
                                                                        ${selectedIndex === index + 2
                                                                                ? 'bg-bg-item-active'
                                                                                : 'hover:bg-bg-item-hover'
                                                                            }
                                                                    `}
                                                                        onClick={() => handleSelect(index + 2)}
                                                                        onMouseEnter={() => setSelectedIndex(index + 2)}
                                                                    >
                                                                        <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0">
                                                                            <FileText size={12} className="text-text-secondary" />
                                                                        </div>
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="text-[13px] text-text-primary truncate">
                                                                                {result.title}
                                                                            </div>
                                                                            {result.subtitle && (
                                                                                <div className="text-[11px] text-text-tertiary">
                                                                                    {result.subtitle}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </motion.button>
                                                                ))}
                                                            </AnimatePresence>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </motion.div>
                </div >
            </div >
        </>
    );
};

export default TopSearchPill;
