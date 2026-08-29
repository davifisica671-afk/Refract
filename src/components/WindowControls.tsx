import React, { useState, useEffect } from 'react';
import { Minus, X } from 'lucide-react';
import { isMac } from '../utils/platformUtils';

/**
 * WindowControls.tsx
 * Componente de botões de controle de janela (minimizar, maximizar, fechar).
 * Exibido apenas no Windows/Linux — no macOS, as luzes de tráfego nativas são usadas.
 */

/**
 * WindowControls — Botões customizados de minimizar / maximizar / fechar.
 * Retorna nulo imediatamente em macOS (as luzes de tráfego nativas são usadas lá).
 * O retorno nulo está não TOPO, antes de quaisquer hooks, satisfazendo as regras do React.
 */
const WindowControls: React.FC = () => {
  // Retorna nulo antecipadamente se estiver em macOS — antes que quaisquer hooks sejam chamados
  // NOTA: isMac é uma constante de nível de módulo avaliada uma vez não carregamento do módulo, então
  // é seguro usá-la como uma proteção de retorno antecipado (mesmo valor em toda renderização, não é hook).
  if (isMac) return null;

  // Hooks — apenas reachable em Windows / Linux
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let active = true;

    // Consulta o estado maximizado inicial (ex.: app reaberto enquanto maximizado)
    window.electronAPI?.windowIsMaximized().then((maximized: boolean) => {
      if (active) setIsMaximized(maximized);
    }).catch(() => {});

    const unsubscribe = window.electronAPI?.onWindowMaximizedChanged((maximized: boolean) => {
      setIsMaximized(maximized);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const handleMinimize = () => window.electronAPI?.windowMinimize();
  const handleMaximize = () => window.electronAPI?.windowMaximize();
  const handleClose = () => window.electronAPI?.windowClose();

  return (
    <div className="flex h-[40px]">
      <button
        onClick={handleMinimize}
        className="flex items-center justify-center w-[46px] h-full border-0 bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors duration-100"
        title="Minimize"
      >
        <Minus size={16} strokeWidth={1.5} />
      </button>
      <button
        onClick={handleMaximize}
        className="flex items-center justify-center w-[46px] h-full border-0 bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors duration-100"
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5" y="3" width="8" height="8" rx="0.5" />
            <path d="M3 5V11C3 11.5523 3.44772 12 4 12H10" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3.5" y="3.5" width="9" height="9" rx="0.5" />
          </svg>
        )}
      </button>
      <button
        onClick={handleClose}
        className="flex items-center justify-center w-[46px] h-full border-0 bg-transparent text-text-secondary hover:text-white hover:bg-red-500 transition-colors duration-100"
        title="Close"
      >
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
};

export default WindowControls;
