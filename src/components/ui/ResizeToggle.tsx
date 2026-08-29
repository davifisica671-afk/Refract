/**
 * ResizeToggle — Botão de redimensionamento do painel
 *
 * Componente de alternância (toggle) que permite expandir ou colapsar a largura
 * do painel principal. Posicionado como um elemento flutuante fixo no canto
 * superior direito da janela Electron, fora do corpo principal do painel.
 *
 * Por que fora do painel:
 *  - O painel principal possui overflow-hidden e cantos arredondados; um botão
 *    absoluto dentro dele seria recortado. Além disso, o usuário deseja um
 *    controle claramente destacado e independente — seguindo o mesmo padrão
 *    dos controles de janela do macOS posicionados fora da área de conteúdo.
 *  - A proteção de conteúdo do Electron (`setContentProtection`) se aplica a
 *    toda a BrowserWindow, então este elemento herda proteção contra captura
 *    de tela para funcionamento discreto (stealth).
 *  - Passagem transparente: o teste de hover no RefractInterface inclui o
 *    retângulo deste botão (via ref encaminhada), mantendo a janela interativa
 *    e preservando o caminho de passagem stealth quando indetectável.
 *
 * O botão usa `position: fixed`; seu `top`/`right` são controlados pelos
 * valores de movimento topOffset/rightOffset para acompanhar o canto superior
 * direito do card do PAINEL (que fica abaixo do TopPill), não o canto bruto
 * da janela. Retorna para a posição estática `top-3 right-3` quando esses
 * offsets não são fornecidos.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Maximize2, Minimize2 } from 'lucide-react';
import { forwardRef, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import type { OverlayAppearance } from '../../lib/overlayAppearance';

interface ResizeToggleProps {
  /** Verdadeiro quando o shell está em sua largura ampla — o botão então oferece "colapsar" */
  expanded: boolean;
  onToggle: () => void;
  appearance: OverlayAppearance;
  /** Espelha o data-interface-theme do painel para que as variáveis CSS de tema se apliquem corretamente */
  interfaceTheme?: string;
  /**
   * Valor de offset direito (motion value) em tempo real para que o botão acompanhe
   * o canto superior direito do painel enquanto a animação de largura ocorre.
   * Calculado no RefractInterface a partir da shellWidth ao vivo, posicionando
   * o botão no canal lateral logo fora da borda direita do painel.
   * Quando fornecido, substitui o posicionamento à direita do className.
   */
  rightOffset?: MotionValue<number>;
  /**
   * Valor de offset superior (motion value, em px do topo do viewport) para que o botão
   * se alinhe com a borda superior do card do PAINEL — que fica abaixo do TopPill + gap,
   * não no topo da janela. Medido a partir do retângulo do painel no RefractInterface.
   * Quando fornecido, substitui o posicionamento superior do className.
   */
  topOffset?: MotionValue<number>;
}

/**
 * Botão de redimensionamento independente que vive fora do corpo principal do painel
 * como uma cápsula flutuante fixa ancorada no canto superior direito da janela Electron.
 */
const ResizeToggle = forwardRef<HTMLButtonElement, ResizeToggleProps>(
  function ResizeToggle({ expanded, onToggle, appearance, interfaceTheme, rightOffset, topOffset }, ref) {
    const reduce = useReducedMotion();
    const [hovered, setHovered] = useState(false);

    return (
      <motion.button
        ref={ref}
        type="button"
        // preventDefault no mousedown para que clicar no botão não mova o foco
        // DOM para ele (nem desfoque a entrada de chat / app em primeiro plano do usuário).
        // A sobreposição é um NSPanel não ativante; um <button> normal ainda roubaria
        // o foco ao pressionar, perdendo o cursor na entrada de chat no meio de uma reunião.
        // Este é o padrão "botão de barra de ferramentas mantém o foco onde estava" —
        // o onClick ainda dispara normalmente porque apenas o efeito colateral padrão
        // de foco do mousedown é suprimido.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        aria-label={expanded ? 'Collapse panel width' : 'Expand panel width'}
        aria-pressed={expanded}
        title={expanded ? 'Collapse' : 'Expand'}
        data-interface-theme={interfaceTheme}
        className="no-drag fixed z-[9999] flex h-[28px] w-[28px] items-center justify-center overflow-hidden rounded-full overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
        style={{
          ...appearance.iconStyle,
          top: topOffset ?? 12,
          right: rightOffset ?? 12,
          border: '1px solid rgba(128,128,128,0.22)',
          backdropFilter: 'blur(12px) saturate(140%)',
          WebkitBackdropFilter: 'blur(12px) saturate(140%)',
        }}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
        animate={reduce ? { opacity: hovered ? 1 : 0.72 } : { opacity: hovered ? 1 : 0.72, scale: hovered ? 1.06 : 1 }}
        whileTap={reduce ? undefined : { scale: 0.92 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      >
        {/* Brilho de acabamento jelly-gloss */}
        <span className="pointer-events-none absolute inset-x-1 top-0.5 h-[45%] rounded-full bg-gradient-to-b from-white/20 to-white/0 blur-[0.5px]" />
        <span
          className="relative grid place-items-center"
          style={{ transform: 'translate(-0.5px, -0.5px)' }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={expanded ? 'collapse' : 'expand'}
              className="col-start-1 row-start-1 flex items-center justify-center"
              style={{ gridArea: '1 / 1' }}
              initial={reduce ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              transition={reduce ? { duration: 0 } : { duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
            >
              {expanded ? (
                <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.button>
    );
  },
);

export default ResizeToggle;
