/**
 * TopPill — Cápsula de controle superior do painel
 *
 * Componente flutuante centralizado no topo da janela que contém os controles
 * principais da interface: botão de logo, botão de expandir/colapsar o painel,
 * e botão de encerrar (quit). É a barra de ferramentas principal da sobreposição,
 * projetada para ser discreta e não intrusiva.
 */
import { ChevronUp, ChevronDown } from "lucide-react";
import icon from "../icon.png";
import type { OverlayAppearance } from "../../lib/overlayAppearance";

interface TopPillProps {
    expanded: boolean;
    onToggle: () => void;
    onQuit: () => void;
    appearance: OverlayAppearance;
    onLogoClick?: () => void;
}

export default function TopPill({
    expanded,
    onToggle,
    onQuit,
    appearance,
    onLogoClick,
}: TopPillProps) {
    return (
        <div className="flex justify-center select-none z-50">
            <div
                className="
          draggable-area
          flex items-center gap-2
          rounded-full
          border
          overlay-pill-surface overlay-top-pill
          backdrop-blur-md
          px-1.5 py-1.5
          transition-all duration-300 ease-sculpted
        "
                style={appearance.pillStyle}
            >
                <div className="draggable-area">
                    {/* BOTÃO DE LOGO */}
                    <button
                        type="button"
                        onClick={onLogoClick}
                        aria-label="Open Refract"
                        title="Open Refract"
                        className={`
              w-7 h-7
              rounded-full
              overlay-icon-surface
              overlay-icon-surface-hover
              overlay-top-pill-control
              flex items-center justify-center
              relative overflow-hidden
              interaction-base interaction-press
            `}
                        style={appearance.iconStyle}
                    >
                        <img
                            src={icon}
                            alt="Refract"
                            className="w-[24px] h-[24px] object-contain opacity-95 scale-105 force-black-icon"
                            draggable="false"
                            onDragStart={(e) => e.preventDefault()}
                        />
                    </button>
                </div>

                {/* SEGMENTO CENTRAL */}
                <button
                    type="button"
                    onClick={onToggle}
                    aria-label={expanded ? 'Hide overlay' : 'Show overlay'}
                    title={expanded ? 'Hide overlay' : 'Show overlay'}
                    className={`
            flex items-center gap-2
            group
            px-3 py-1
            rounded-full
            backdrop-blur-md
            overlay-chip-surface
            overlay-top-pill-toggle
            overlay-text-interactive
            text-[12px]
            font-medium
            border
            interaction-base interaction-hover interaction-press
          `}
                    style={appearance.chipStyle}
                >
                    <span className="opacity-70 group-hover:opacity-100 transition-opacity duration-200">
                        {expanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                        )}
                    </span>
                    <span className="tracking-wide opacity-80 group-hover:opacity-100">{expanded ? "Hide" : "Show"}</span>
                </button>

                {/* BOTÃO DE ENCERRAR (QUIT) */}
                <button
                    type="button"
                    onClick={onQuit}
                    aria-label="End meeting"
                    title="End meeting"
                    className={`
            w-7 h-7
            rounded-full
            overlay-icon-surface
            overlay-top-pill-control overlay-top-pill-stop
            overlay-text-primary
            flex items-center justify-center
            interaction-base interaction-press
            hover:bg-red-500/10 hover:text-red-400
          `}
                    style={appearance.iconStyle}
                >
                    <div className="w-2.5 h-2.5 rounded-[2.5px] bg-current opacity-75 transition-all duration-200" />
                </button>
            </div>
        </div>
    );
}
