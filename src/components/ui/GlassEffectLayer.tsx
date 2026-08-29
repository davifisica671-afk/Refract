/**
 * GlassEffectLayer — bisel e brilho especular do modo liquid-glass
 *
 * NOTA DE PLATAFORMA (corrige o que este comentário afirmava antes): a janela
 * do overlay NÃO usa `vibrancy` (macOS) nem `backgroundMaterial: 'acrylic'`
 * (Win11), e não pode usar. A janela tem 780px de largura enquanto o painel
 * desenhado tem 600px — as margens laterais transparentes precisam ficar
 * invisíveis e click-through, e vibrancy/acrylic pintam a JANELA INTEIRA,
 * o que deixaria retângulos foscos visíveis nessas margens. Também não há
 * blur do desktop via CSS: `backdrop-filter` em janela transparente do
 * Electron não alcança o conteúdo atrás da janela.
 *
 * Consequência: o material de vidro se sustenta sozinho. O corpo (gradiente +
 * luz direcional + sombra) vive no CSS, em `.overlay-shell-surface::before`;
 * este componente desenha as camadas que precisam de vários anéis empilhados,
 * que os dois pseudo-elementos disponíveis não dão conta:
 *
 *   1. BISEL (estático, 3 anéis) — alpha decrescente do mais fino/brilhante
 *      ao mais largo/fraco. É a queda de luz da borda, o chanfro de uma placa
 *      grossa de vidro. É a assinatura que faltava nas fatias 7→11.
 *   2. ESPECULAR VIVO (2 anéis) — gradiente que rotaciona com o cursor
 *      (ângulo = 135 + mouseOffset.x × 1.2), com blends screen/overlay.
 *      É o que faz o vidro parecer vivo em vez de impresso. Limitado por RAF.
 *
 * Todos os anéis usam a técnica mask-composite (do liquid-glass-react): a
 * máscara recorta só a faixa de padding, então o brilho acompanha a
 * curvatura do canto em vez de virar um retângulo.
 */
import React, { type CSSProperties, useEffect, useRef, useState } from 'react';

export interface GlassEffectLayerProps {
    /** Ref para o elemento shell — usado para cálculo de offset relativo ao mouse. */
    parentRef: React.RefObject<HTMLElement | null>;
    /** Border-radius do shell em px — corresponde à geometria da máscara. */
    cornerRadius?: number;
}

/** Máscara que deixa visível apenas a faixa de `padding` (o anel). */
const RING_MASK: CSSProperties = {
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
};

/**
 * Bisel: três anéis concêntricos de alpha decrescente. Os deltas são pequenos
 * de propósito — saltos grandes produzem bandas concêntricas visíveis em vez
 * de uma queda contínua de luz.
 */
const BEVEL_RINGS: Array<{ pad: number; top: number; mid: number; bottom: number }> = [
    { pad: 9,   top: 0.038, mid: 0.012, bottom: 0.022 },
    { pad: 4,   top: 0.085, mid: 0.030, bottom: 0.045 },
    { pad: 1.5, top: 0.300, mid: 0.070, bottom: 0.140 },
];

const GlassEffectLayer: React.FC<GlassEffectLayerProps> = ({
    parentRef,
    cornerRadius = 24,
}) => {
    const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });
    const rafIdRef   = useRef<number | null>(null);
    const pendingRef = useRef({ x: 0, y: 0 });

    // Offset do mouse limitado por RAF (percentual do centro do elemento, faixa -50..50).
    useEffect(() => {
        const el = parentRef.current;
        if (!el) return;

        const update = () => {
            rafIdRef.current = null;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const cx = rect.left + rect.width  / 2;
            const cy = rect.top  + rect.height / 2;
            setMouseOffset({
                x: ((pendingRef.current.x - cx) / rect.width)  * 100,
                y: ((pendingRef.current.y - cy) / rect.height) * 100,
            });
        };
        const onMove = (e: MouseEvent) => {
            pendingRef.current.x = e.clientX;
            pendingRef.current.y = e.clientY;
            if (rafIdRef.current === null) rafIdRef.current = requestAnimationFrame(update);
        };

        document.addEventListener('mousemove', onMove);
        return () => {
            document.removeEventListener('mousemove', onMove);
            if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
        };
    }, [parentRef]);

    // Gradiente de brilho — valores extraídos diretamente do liquid-glass-react.
    // Alphas reduzidos frente à versão anterior: o hairline specular do topo
    // agora vem do CSS (::after), então manter os valores originais aqui
    // estourava o branco na borda superior.
    const gradAngle  = (135 + mouseOffset.x * 1.2).toFixed(2);
    const gradStop1  = Math.max(10, 33 + mouseOffset.y * 0.3).toFixed(2);
    const gradStop2  = Math.min(90, 66 + mouseOffset.y * 0.4).toFixed(2);
    const opacityA_1 = (0.06 + Math.abs(mouseOffset.x) * 0.004).toFixed(3);
    const opacityA_2 = (0.20 + Math.abs(mouseOffset.x) * 0.006).toFixed(3);
    const opacityB_1 = (0.15 + Math.abs(mouseOffset.x) * 0.004).toFixed(3);
    const opacityB_2 = (0.30 + Math.abs(mouseOffset.x) * 0.006).toFixed(3);

    const specularRing: CSSProperties = {
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        pointerEvents: 'none',
        borderRadius: `${cornerRadius}px`,
        padding: '1.5px',
        ...RING_MASK,
    };

    return (
        <>
            {/* BISEL estático — a queda de luz da borda (chanfro do vidro).
                Do mais largo/fraco ao mais fino/brilhante, para que a soma leia
                como uma rampa contínua e não como anéis separados. */}
            {BEVEL_RINGS.map(({ pad, top, mid, bottom }) => (
                <span
                    key={pad}
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 1,
                        pointerEvents: 'none',
                        borderRadius: `${cornerRadius}px`,
                        padding: `${pad}px`,
                        ...RING_MASK,
                        background:
                            `linear-gradient(to bottom, ` +
                            `rgba(255,255,255,${top}) 0%, ` +
                            `rgba(255,255,255,${mid}) 45%, ` +
                            `rgba(255,255,255,${bottom}) 100%)`,
                    }}
                />
            ))}

            {/* ESPECULAR VIVO 1 — mistura screen, baixa opacidade */}
            <span
                aria-hidden="true"
                style={{
                    ...specularRing,
                    mixBlendMode: 'screen',
                    opacity: 0.2,
                    background:
                        `linear-gradient(${gradAngle}deg, ` +
                        `rgba(255,255,255,0) 0%, ` +
                        `rgba(255,255,255,${opacityA_1}) ${gradStop1}%, ` +
                        `rgba(255,255,255,${opacityA_2}) ${gradStop2}%, ` +
                        `rgba(255,255,255,0) 100%)`,
                }}
            />

            {/* ESPECULAR VIVO 2 — mistura overlay, opacidade mais forte */}
            <span
                aria-hidden="true"
                style={{
                    ...specularRing,
                    mixBlendMode: 'overlay',
                    background:
                        `linear-gradient(${gradAngle}deg, ` +
                        `rgba(255,255,255,0) 0%, ` +
                        `rgba(255,255,255,${opacityB_1}) ${gradStop1}%, ` +
                        `rgba(255,255,255,${opacityB_2}) ${gradStop2}%, ` +
                        `rgba(255,255,255,0) 100%)`,
                }}
            />
        </>
    );
};

export default GlassEffectLayer;
