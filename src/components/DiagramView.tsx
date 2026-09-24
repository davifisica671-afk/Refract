/**
 * DiagramView.tsx
 * Renderiza um bloco ```mermaid como SVG via `mermaid` (lazy) sanitizado com
 * DOMPurify. Qualquer erro (parse, render, import) cai no `fallback` — o
 * chamador (renderer `code` do intent `standard` em RefractInterface.tsx)
 * passa o MESMO <HighlightedCode .../> com todas as props exatas.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import DOMPurify from 'dompurify';

interface DiagramViewProps {
  code: string;
  isLightTheme: boolean;
  /** Renderizado durante o erro (e quando `code` está vazio). */
  fallback?: ReactNode;
}

export function DiagramView({ code, isLightTheme, fallback }: DiagramViewProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Id único por instância + contador por render: mermaid exige id exclusivo
  // por chamada de render (streaming re-renderiza a cada token).
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const renderCount = useRef(0);
  const hasSucceeded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!code.trim()) return;
    renderCount.current += 1;
    const renderId = `mermaid-${baseId}-${renderCount.current}`;
    const timer = setTimeout(() => {
      (async () => {
        try {
          // LAZY: mermaid nunca entra no chunk inicial (dynamic import).
          const { default: mermaid } = await import('mermaid');
          mermaid.initialize({ startOnLoad: false, theme: isLightTheme ? 'neutral' : 'dark' });
          const { svg: rawSvg } = await mermaid.render(renderId, code);
          if (!cancelled) {
            setSvg(DOMPurify.sanitize(rawSvg));
            hasSucceeded.current = true;
          }
        } catch {
          // Stale-while-revalidate: transient parse failures keep the last
          // good SVG; only fall back if render never succeeded.
          if (!cancelled && !hasSucceeded.current) setFailed(true);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, isLightTheme, baseId]);

  if (svg !== null) {
    return (
      <div
        role="img"
        aria-label="Mermaid diagram"
        className="my-3 rounded-xl border overflow-x-auto px-4 py-3 overlay-code-block-surface"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  if (!code.trim() || failed) return <>{fallback}</>;
  return (
    <div
      aria-busy="true"
      aria-label="Rendering diagram"
      className="my-3 rounded-xl border px-4 py-6 text-center text-[12px] opacity-60 animate-pulse overlay-code-block-surface overlay-text-muted"
    >
      Rendering diagram…
    </div>
  );
}
