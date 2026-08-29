/**
 * ============================================================
 * SISTEMA DE APARÊNCIA DO OVERLAY (JANELA FLUTUANTE)
 * ============================================================
 * 
 * Este arquivo controla toda a aparência visual do overlay do Refract,
 * que é a janela flutuante que aparece sobre outras aplicações durante
 * reuniões. O overlay pode ter diferentes níveis de opacidade e
 * seguir o tema (claro/escuro) do sistema.
 * 
 * CONCEITOS CHAVE:
 * 
 * 1. OPACIDADE:
 *    - Controla o quão "transparente" o overlay é
 *    - Mínimo: 35% (OVERLAY_OPACITY_MIN)
 *    - Máximo: 100% (OVERLAY_OPACITY_MAX)
 *    - Padrão: 80% no tema escuro, 70% no tema claro
 *    - Usuário pode ajustar nas configurações
 * 
 * 2. TEMAS:
 *    - 'dark': Fundo escuro, texto claro (padrão)
 *    - 'light': Fundo claro, texto escuro
 *    - 'liquid-glass': Efeito de vidro líquido (usa CSS, não inline styles)
 * 
 * 3. ESTILOS INLINE:
 *    - Cada elemento do overlay (shell, pill, transcript, etc.)
 *      tem um conjunto de estilos inline que mudam com a opacidade
 *    - Isso permite transições suaves quando o usuário ajusta a opacidade
 * 
 * 4. BLUR (DESSFOCO):
 *    - O overlay usa backdrop-filter: blur() para criar o efeito de
 *      vidro fosco sobre o conteúdo de fundo
 *    - A intensidade do blur varia com a opacidade
 * ============================================================
 */

// ============================================================
// IMPORTAÇÕES
// ============================================================
import type React from 'react'; // Tipo React para React.CSSProperties

// ============================================================
// TIPOS
// ============================================================

/**
 * Tipo que representa os temas disponíveis para o overlay.
 * - 'light': Tema claro (fundo branco/azulado)
 * - 'dark': Tema escuro (fundo preto/cinza)
 */
export type OverlayTheme = 'light' | 'dark';

/**
 * Interface que define todos os estilos inline do overlay.
 * Cada propriedade é um objeto React.CSSProperties que pode ser
 * aplicado diretamente a um elemento JSX via prop style.
 */
export interface OverlayAppearance {
    shellStyle: React.CSSProperties;     // Estilo do container principal do overlay
    pillStyle: React.CSSProperties;      // Estilo das "pílulas" (botões/etiquetas arredondados)
    transcriptStyle: React.CSSProperties; // Estilo da área de transcrição
    subtleStyle: React.CSSProperties;    // Estilo para elementos sutis (bordas, divisórios)
    chipStyle: React.CSSProperties;      // Estilo dos "chips" (etiquetas pequenas)
    inputStyle: React.CSSProperties;     // Estilo dos campos de entrada de texto
    controlStyle: React.CSSProperties;   // Estilo dos controles (botões, toggles)
    iconStyle: React.CSSProperties;      // Estilo dos ícones
    codeBlockStyle: React.CSSProperties; // Estilo dos blocos de código
    codeHeaderStyle: React.CSSProperties; // Estilo dos cabeçalhos de código
    dividerStyle: React.CSSProperties;   // Estilo dos divisórios/separadores
}

// ============================================================
// FUNÇÕES UTILITÁRIAS
// ============================================================

/**
 * Limita um valor entre um mínimo e máximo.
 * Útil para garantir que a opacidade esteja dentro de limites seguros.
 * 
 * @param value - Valor a ser limitado
 * @param min - Valor mínimo permitido
 * @param max - Valor máximo permitido
 * @returns Valor dentro do intervalo [min, max]
 */
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Interpola linearmente entre dois valores.
 * Usado para suavizar transições de estilo.
 * 
 * @param min - Valor mínimo
 * @param max - Valor máximo
 * @param value - Fator de interpolação (0 = min, 1 = max)
 * @returns Valor interpolado
 */
const mix = (min: number, max: number, value: number) => min + ((max - min) * value);

// ============================================================
// CONSTANTES DE OPACIDADE
// ============================================================

/** Opacidade mínima permitida (35%) - overlay muito transparente */
export const OVERLAY_OPACITY_MIN = 0.35;

/** Opacidade máxima permitida (100%) - overlay totalmente opaco */
export const OVERLAY_OPACITY_MAX = 1;

/**
 * @obsoto Use getDefaultOverlayOpacity() para o padrão baseado no tema atual.
 * Padrão antigo de opacidade (65%) - mantido apenas para compatibilidade.
 */
export const OVERLAY_OPACITY_DEFAULT = 0.65;

/** Padrão de opacidade para o tema escuro (80%) - mais opaco para melhor legibilidade */
export const OVERLAY_OPACITY_DEFAULT_DARK = 0.80;

/** Padrão de opacidade para o tema claro (70%) - menos opaco para combinar com fundo claro */
export const OVERLAY_OPACITY_DEFAULT_LIGHT = 0.70;

/**
 * Retorna o padrão correto de opacidade baseado no tema atualmente ativo.
 * 
 * LÓGICA:
 * - Tema escuro → 80% (mais opaco para legibilidade sobre fundos escuros)
 * - Tema claro → 70% (menos opaco para não sobrepor muito o fundo claro)
 * 
 * @returns Número entre 0 e 1 representando a opacidade padrão
 */
export const getDefaultOverlayOpacity = (): number =>
    document.documentElement.getAttribute('data-theme') === 'light'
        ? OVERLAY_OPACITY_DEFAULT_LIGHT  // Tema claro: 70%
        : OVERLAY_OPACITY_DEFAULT_DARK;  // Tema escuro: 80%

/**
 * Limita a opacidade entre os valores mínimo e máximo permitidos.
 * 
 * @param opacity - Opacidade desejada
 * @returns Opacidade limitada ao intervalo [0.35, 1.0]
 */
export const clampOverlayOpacity = (opacity: number) => clamp(opacity, OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX);

/**
 * Normaliza a opacidade para um valor entre 0 e 1.
 * Usado internamente para calcular a "força" visual dos estilos.
 * 
 * @param opacity - Opacidade bruta (0.35 a 1.0)
 * @returns Valor normalizado (0.0 a 1.0)
 */
const normalizeOpacity = (opacity: number) =>
    (clampOverlayOpacity(opacity) - OVERLAY_OPACITY_MIN) / (OVERLAY_OPACITY_MAX - OVERLAY_OPACITY_MIN);

/**
 * Escala um valor dentro de um intervalo baseado na força (intensidade).
 * Usado para calcular valores de estilo que variam com a opacidade.
 * 
 * @param min - Valor mínimo do resultado
 * @param max - Valor máximo do resultado
 * @param strength - Fator de intensidade (0 a 1)
 * @param ease - Fator de suavização (padrão: 1 = linear)
 * @returns Valor escalado entre min e max
 */
const scale = (min: number, max: number, strength: number, ease = 1) =>
    mix(min, max, Math.pow(clamp(strength, 0, 1), ease));

// ============================================================
// FUNÇÃO PRINCIPAL: getOverlayAppearance
// ============================================================

/**
 * Gera todos os estilos inline do overlay baseado na opacidade e tema.
 * 
 * COMO FUNCIONA:
 * 1. Calcula a "força" visual baseada na opacidade normalizada
 * 2. Para cada tema (light/dark), gera estilos para cada elemento
 * 3. Usa funções matemáticas (pow, mix, scale) para criar transições suaves
 * 
 * ELEMENTOS ESTILIZADOS:
 * - shellStyle: Container principal (fundo, borda, blur)
 * - pillStyle: Botões/etiquetas arredondadas
 * - transcriptStyle: Área de transcrição de áudio
 * - subtleStyle: Elementos sutis
 * - chipStyle: Etiquetas pequenas
 * - inputStyle: Campos de entrada
 * - controlStyle: Controles interativos
 * - iconStyle: Ícones
 * - codeBlockStyle: Blocos de código
 * - codeHeaderStyle: Cabeçalhos de código
 * - dividerStyle: Separadores
 * 
 * @param opacity - Opacidade atual do overlay (0.35 a 1.0)
 * @param theme - Tema atual ('light' ou 'dark')
 * @returns Objeto com todos os estilos inline para o overlay
 */
export const getOverlayAppearance = (opacity: number, theme: OverlayTheme): OverlayAppearance => {
    // Calcular a "força" visual baseada na opacidade
    const strength = normalizeOpacity(opacity);
    
    // Força da superfície (quase linear com opacidade)
    const surfaceStrength = Math.pow(strength, 1.02);
    
    // Força do blur (ligeiramente não-linear para suavidade)
    const blurStrength = Math.pow(strength, 0.94);

    // ============================================================
    // TEMA CLARO
    // ============================================================
    if (theme === 'light') {
        return {
            shellStyle: {
                backgroundColor: `rgba(248, 249, 252, ${scale(0.44, 0.96, surfaceStrength)})`,
                borderColor: `rgba(17, 24, 39, ${scale(0.055, 0.1, surfaceStrength)})`,
                backdropFilter: `blur(${scale(10, 24, blurStrength)}px) saturate(165%)`,
                WebkitBackdropFilter: `blur(${scale(10, 24, blurStrength)}px) saturate(165%)`,
            },
            pillStyle: {
                backgroundColor: `rgba(250, 251, 253, ${scale(0.42, 0.94, surfaceStrength)})`,
                borderColor: `rgba(17, 24, 39, ${scale(0.05, 0.095, surfaceStrength)})`,
                backdropFilter: `blur(${scale(8, 20, blurStrength)}px) saturate(160%)`,
                WebkitBackdropFilter: `blur(${scale(8, 20, blurStrength)}px) saturate(160%)`,
            },
            transcriptStyle: {
                backgroundColor: 'transparent', // Transparente na transcrição
                borderBottomColor: 'transparent',
                backdropFilter: 'none',
                WebkitBackdropFilter: 'none',
            },
            subtleStyle: {
                backgroundColor: `rgba(255, 255, 255, ${scale(0.22, 0.72, surfaceStrength)})`,
                borderColor: `rgba(17, 24, 39, ${scale(0.045, 0.085, surfaceStrength)})`,
            },
            chipStyle: {
                backgroundColor: `rgba(255, 255, 255, ${scale(0.28, 0.72, surfaceStrength)})`,
                borderColor: `rgba(17, 24, 39, ${scale(0.045, 0.085, surfaceStrength)})`,
            },
            inputStyle: {
                backgroundColor: `rgba(255, 255, 255, ${scale(0.34, 0.8, surfaceStrength)})`,
                borderColor: `rgba(17, 24, 39, ${scale(0.05, 0.09, surfaceStrength)})`,
            },
            controlStyle: {
                backgroundColor: `rgba(255, 255, 255, ${scale(0.28, 0.72, surfaceStrength)})`,
                borderColor: `rgba(17, 24, 39, ${scale(0.045, 0.085, surfaceStrength)})`,
            },
            iconStyle: {
                backgroundColor: `rgba(255, 255, 255, ${scale(0.24, 0.66, surfaceStrength)})`,
            },
            codeBlockStyle: {
                backgroundColor: `rgba(245, 249, 255, ${scale(0.06, 0.94, surfaceStrength)})`,
                borderColor: `rgba(30, 64, 175, ${scale(0.07, 0.15, surfaceStrength)})`,
            },
            codeHeaderStyle: {
                backgroundColor: `rgba(236, 244, 255, ${scale(0.08, 0.96, surfaceStrength)})`,
                borderBottomColor: `rgba(30, 64, 175, ${scale(0.08, 0.16, surfaceStrength)})`,
            },
            dividerStyle: {
                backgroundColor: `rgba(30, 64, 175, ${scale(0.08, 0.16, surfaceStrength)})`,
            },
        };
    }

    // ============================================================
    // TEMA ESCURO (PADRÃO)
    // ============================================================
    return {
        shellStyle: {
            backgroundColor: `rgba(14, 16, 22, ${scale(0.46, 0.96, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.085, 0.145, surfaceStrength)})`,
            backdropFilter: `blur(${scale(12, 28, blurStrength)}px) saturate(155%)`,
            WebkitBackdropFilter: `blur(${scale(12, 28, blurStrength)}px) saturate(155%)`,
        },
        pillStyle: {
            backgroundColor: `rgba(14, 16, 22, ${scale(0.42, 0.94, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.08, 0.14, surfaceStrength)})`,
            backdropFilter: `blur(${scale(10, 24, blurStrength)}px) saturate(150%)`,
            WebkitBackdropFilter: `blur(${scale(10, 24, blurStrength)}px) saturate(150%)`,
        },
        transcriptStyle: {
            backgroundColor: 'transparent',
            borderBottomColor: 'transparent',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
        },
        subtleStyle: {
            backgroundColor: `rgba(255, 255, 255, ${scale(0.035, 0.075, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.055, 0.095, surfaceStrength)})`,
        },
        chipStyle: {
            backgroundColor: `rgba(255, 255, 255, ${scale(0.055, 0.105, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.055, 0.095, surfaceStrength)})`,
        },
        inputStyle: {
            backgroundColor: `rgba(255, 255, 255, ${scale(0.065, 0.12, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.065, 0.11, surfaceStrength)})`,
        },
        controlStyle: {
            backgroundColor: `rgba(255, 255, 255, ${scale(0.05, 0.1, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.055, 0.1, surfaceStrength)})`,
        },
        iconStyle: {
            backgroundColor: `rgba(255, 255, 255, ${scale(0.045, 0.095, surfaceStrength)})`,
        },
        codeBlockStyle: {
            backgroundColor: `rgba(35, 40, 50, ${scale(0.24, 0.96, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.05, 0.1, surfaceStrength)})`,
        },
        codeHeaderStyle: {
            backgroundColor: `rgba(48, 53, 64, ${scale(0.22, 0.94, surfaceStrength)})`,
            borderBottomColor: `rgba(255, 255, 255, ${scale(0.05, 0.1, surfaceStrength)})`,
        },
        dividerStyle: {
            backgroundColor: `rgba(255, 255, 255, ${scale(0.06, 0.12, surfaceStrength)})`,
        },
    };
};

/**
 * Retorna objetos inline-style VAZIOS para o tema liquid-glass.
 * 
 * POR QUE VAZIO?
 * O tema liquid-glass é controlado inteiramente por CSS (não inline styles).
 * A variável CSS [data-interface-theme="liquid-glass"] aplicada no elemento
 * pai controla todo o estilo visual via seletores CSS.
 * 
 * Isso permite que o efeito de vidro líquido seja implementado apenas
 * com CSS, sem precisar de lógica JavaScript complexa.
 * 
 * @returns Objeto com todas as propriedades de estilo vazias
 */
export const getGlassOverlayAppearance = (): OverlayAppearance => ({
    shellStyle: {},
    pillStyle: {},
    transcriptStyle: {},
    subtleStyle: {},
    chipStyle: {},
    inputStyle: {},
    controlStyle: {},
    iconStyle: {},
    codeBlockStyle: {},
    codeHeaderStyle: {},
    dividerStyle: {},
});
