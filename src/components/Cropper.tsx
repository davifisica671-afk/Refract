import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Crosshair } from 'lucide-react';

/**
 * Componente Cropper fornece a interface visual para selecionar uma área da tela.
 *
 * NOTAS DE DESIGN:
 * 1. UI Indetectável: Em vez de usar cursores do sistema (como cursor: crosshair), que
 *    são visíveis em compartilhamentos de tela, usamos 'cursor: default' e desenhamos guias
 *    personalizados não Canvas. Como a janela é protegida, esses guias são invisíveis para os espectadores.
 * 2. Reinício de Estado: O componente ouve eventos IPC 'reset-cropper' porque a
 *    janela é reutilizada (Windows) e não é desmontada entre capturas.
 * 3. Consciente do Tema: Suporta temas claro/escuro para UX consistente.
 * 4. mouseUp também é tratado não nível da janela (via useEffect) então arrastar fora do
 *    viewport ainda completa a seleção em vez de deixá-la presa.
 */
const Cropper: React.FC = () => {
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    const [currentPos, setCurrentPos] = useState<{ x: number, y: number } | null>(null);
    const [hudPosition, setHudPosition] = useState<{ x: number, y: number } | null>(null);
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const hudRef = useRef<HTMLDivElement>(null);
    // Armazena a largura do HUD uma vez medida; usado para calcular o deslocamento de centralização
    const hudWidthRef = useRef<number>(320);
    // Refs espelhos para startPos/currentPos para que os manipuladores não nível da janela possam acessar valores atuais
    const startPosRef = useRef<{ x: number, y: number } | null>(null);
    const currentPosRef = useRef<{ x: number, y: number } | null>(null);

    const MIN_SELECTION_SIZE = 5;

    // Mantém refs sincronizados com o estado (necessário para o manipulador mouseup não nível da janela)
    useEffect(() => { startPosRef.current = startPos; }, [startPos]);
    useEffect(() => { currentPosRef.current = currentPos; }, [currentPos]);

    // Theme detection
    useEffect(() => {
        const detectTheme = () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') as 'dark' | 'light' || 'dark';
            setTheme(currentTheme);
        };
        detectTheme();
        const observer = new MutationObserver(detectTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    // Commit o selection — used por ambos div.onMouseUp e janela mouseup
    const commitSelection = useCallback((sp: { x: number, y: number } | null, cp: { x: number, y: number } | null) => {
        if (!sp || !cp) return;
        const x = Math.min(sp.x, cp.x);
        const y = Math.min(sp.y, cp.y);
        const width = Math.abs(cp.x - sp.x);
        const height = Math.abs(cp.y - sp.y);
        if (width > MIN_SELECTION_SIZE && height > MIN_SELECTION_SIZE) {
            (window as any).electronAPI.cropperConfirmed({ x, y, width, height });
        } else {
            setStartPos(null);
            setCurrentPos(null);
        }
    }, []);

    // Manipulador de reinício + bootstrap IPC + listeners de eventos globais
    useEffect(() => {
        // Mede a largura do HUD uma vez que é montado e visível.
        // Usamos ResizeObserver (não MutationObserver em childList) porque o elemento HUD
        // já contém seus filhos quando é renderizado pela primeira vez — MutationObserver
        // com childList nunca dispararia após a renderização inicial
        let resizeObs: ResizeObserver | null = null;
        if (hudRef.current) {
            resizeObs = new ResizeObserver((entries) => {
                const entry = entries[0];
                if (entry) {
                    const w = entry.contentRect.width;
                    if (w > 0) {
                        hudWidthRef.current = w;
                    }
                }
            });
            resizeObs.observe(hudRef.current);
        }

        // IPC: ouvir o sinal de reinício do processo principal
        const cleanupIpc = (window as any).electronAPI.onResetCropper((data: { hudPosition: { x: number; y: number } }) => {
            setStartPos(null);
            setCurrentPos(null);
            const halfWidth = hudWidthRef.current / 2;
            setHudPosition({
                x: data.hudPosition.x - halfWidth,
                y: data.hudPosition.y
            });
        });

        // ESC para cancelar
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                (window as any).electronAPI.cropperCancelled();
                setStartPos(null);
                setCurrentPos(null);
            }
        };

        // Mouseup não nível da janela: dispara mesmo se o cursor saiu dos limites do componente não meio do arrasto.
        // Isso impede que o arrasto fique "preso" se o usuário soltar fora da
        const handleWindowMouseUp = () => {
            commitSelection(startPosRef.current, currentPosRef.current);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('mouseup', handleWindowMouseUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('mouseup', handleWindowMouseUp);
            cleanupIpc();
            resizeObs?.disconnect();
        };
    }, [commitSelection]);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault(); // prevenir text selection
        setStartPos({ x: e.clientX, y: e.clientY });
        setCurrentPos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (startPos) {
            setCurrentPos({ x: e.clientX, y: e.clientY });
        }
    };

    // O manipulador não nível do div é mantido por completude; o trabalho real é não manipulador da janela
    const handleMouseUp = useCallback(() => {
        // A propagação também acionará o manipulador não nível da janela
        // Sem operação aqui — o manipulador da janela faz o commit.
    }, []);

    // Renderização do Canvas — consciente de DPI
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = window.innerWidth;
        const cssHeight = window.innerHeight;

        // Dimensões em pixels físicos — previne canvas borrado em telas HiDPI/Retina
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;
        // Canvas elemento stays at CSS pixel size
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Scale todos drawing ops para corresponder physical pixels
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssWidth, cssHeight);

        // Background overlay
        ctx.fillStyle = theme === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.12)';
        ctx.fillRect(0, 0, cssWidth, cssHeight);

        if (startPos && currentPos) {
            const x = Math.min(startPos.x, currentPos.x);
            const y = Math.min(startPos.y, currentPos.y);
            const w = Math.abs(currentPos.x - startPos.x);
            const h = Math.abs(currentPos.y - startPos.y);

            // Limpa a área selecionada (mostra através da tela)
            ctx.clearRect(x, y, w, h);

            // Borda interna sutil na área selecionada
            ctx.strokeStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

            // Cantos — desenhados em pixels CSS, escala DPR aplicada via setTransform
            const cornerSize = 14;
            ctx.strokeStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const drawCorner = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.lineTo(x3, y3);
                ctx.stroke();
            };

            drawCorner(x, y + cornerSize, x, y, x + cornerSize, y);
            drawCorner(x + w - cornerSize, y, x + w, y, x + w, y + cornerSize);
            drawCorner(x + w, y + h - cornerSize, x + w, y + h, x + w - cornerSize, y + h);
            drawCorner(x + cornerSize, y + h, x, y + h, x, y + h - cornerSize);
        }
    }, [startPos, currentPos, theme]);

    const isLightTheme = theme === 'light';

    return (
        <div
            className="w-screen h-screen cursor-default overflow-hidden bg-transparent select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
        >
            <canvas ref={canvasRef} className="block pointer-events-none" />

            {/* Clean HUD — shown apenas quando não actively dragging */}
            {!startPos && hudPosition && (
                <div
                    ref={hudRef}
                    className="absolute pointer-events-none animate-fade-in-up"
                    style={{
                        left: hudPosition.x,
                        top: hudPosition.y
                    }}
                >
                    <div
                        className="flex items-center gap-3 px-4 py-2 rounded-full"
                        style={{
                            background: isLightTheme
                                ? 'rgba(255, 255, 255, 0.9)'
                                : 'rgba(28, 28, 32, 0.92)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            border: isLightTheme
                                ? '1px solid rgba(0, 0, 0, 0.06)'
                                : '1px solid rgba(255, 255, 255, 0.08)',
                            boxShadow: isLightTheme
                                ? '0 4px 24px -4px rgba(0, 0, 0, 0.12)'
                                : '0 4px 24px -4px rgba(0, 0, 0, 0.4)',
                        }}
                    >
                        <div
                            className="flex items-center justify-center w-7 h-7 rounded-lg"
                            style={{ background: 'rgba(59, 130, 246, 0.15)' }}
                        >
                            <Crosshair className="w-4 h-4" style={{ color: '#3b82f6' }} />
                        </div>

                        <span
                            className="text-sm font-medium"
                            style={{
                                color: isLightTheme ? '#000000' : '#ffffff',
                                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                            }}
                        >
                            Select area
                        </span>

                        <div
                            className="h-4 w-px mx-1"
                            style={{
                                background: isLightTheme
                                    ? 'rgba(0, 0, 0, 0.1)'
                                    : 'rgba(255, 255, 255, 0.15)'
                            }}
                        />

                        <div className="flex items-center gap-1.5">
                            <span
                                className="text-[10px] font-medium uppercase tracking-wider"
                                style={{
                                    color: isLightTheme
                                        ? 'rgba(0, 0, 0, 0.5)'
                                        : 'rgba(255, 255, 255, 0.5)'
                                }}
                            >
                                ESC
                            </span>
                            <span
                                className="text-[10px]"
                                style={{
                                    color: isLightTheme
                                        ? 'rgba(0, 0, 0, 0.4)'
                                        : 'rgba(255, 255, 255, 0.4)'
                                }}
                            >
                                to cancel
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Cropper;
