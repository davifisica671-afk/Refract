/**
 * Vocabulário de movimento do overlay — três gestos, um por tipo de objeto.
 *
 * Por que um módulo puro: os variants precisam ser idênticos entre componentes
 * (TopPill, ResizeToggle, RollingTranscript, DynamicActionBar, RefractInterface)
 * e testáveis sem React. Espelha os tokens --dur-* e --ease-* do index.css para
 * que CSS e framer-motion nunca divirjam.
 *
 * REGRA: só transform, opacity e filter. Nunca layout — a shell reflui por
 * frame durante a animação de largura 600↔780 sob `contain: layout style`
 * (RefractInterface.tsx:5694). Animar width/height/padding entraria em
 * conflito direto com esse reflow.
 */

/** Espelha --dur-* e --ease-* de src/index.css:144-149. */
export const MOTION = {
  fast: 120,
  base: 200,
  slow: 320,
  easeOut: [0.16, 1, 0.3, 1],
  easeIn: [0.32, 0, 0.67, 0],
  spring: [0.34, 1.56, 0.64, 1],
};

/** Cascata em ordem de leitura. O delay evita competir com a escala da shell. */
export const STAGGER = { children: 0.028, delay: 0.08 };

/** Saída sempre mais rápida que entrada — a filosofia que a shell já praticava. */
export const EXIT_RATIO = 0.65;

export function exitDuration(enterMs) {
  return Math.round(enterMs * EXIT_RATIO);
}

const ms = (n) => n / 1000;

const REDUCED = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: ms(MOTION.fast) } },
  exit: { opacity: 0, transition: { duration: ms(MOTION.fast) } },
};

const RECIPES = {
  // Efêmero e informativo: chega por escala, some encolhendo.
  chip: (enter = 160) => ({
    initial: { opacity: 0, scale: 0.92 },
    animate: {
      opacity: 1,
      scale: 1,
      transition: { duration: ms(enter), ease: MOTION.easeOut },
    },
    exit: {
      opacity: 0,
      scale: 0.96,
      transition: { duration: ms(exitDuration(enter)), ease: MOTION.easeIn },
    },
  }),

  // O gesto assinatura: a superfície CONDENSA em vez de aparecer.
  // O blur é o único não-compositável aqui — por isso fica restrito às
  // superfícies L1, que são poucas e cuja animação é curta. Nunca em lista,
  // nunca em bloco de código (o syntax highlight já é memoizado).
  surface: (enter = 260) => ({
    initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
    animate: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: ms(enter), ease: MOTION.easeOut },
    },
    exit: {
      opacity: 0,
      y: 4,
      transition: { duration: ms(exitDuration(enter)), ease: MOTION.easeIn },
    },
  }),

  // Cromo persistente: entra de cima, que é onde ele vive.
  chrome: (enter = 200) => ({
    initial: { opacity: 0, y: -4 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: ms(enter), ease: MOTION.spring },
    },
    exit: {
      opacity: 0,
      y: -4,
      transition: { duration: ms(exitDuration(enter)), ease: MOTION.easeIn },
    },
  }),
};

export function gesture(kind, { reducedMotion = false } = {}) {
  const recipe = RECIPES[kind];
  if (!recipe) {
    throw new Error(`overlayMotion: gesto desconhecido "${kind}"`);
  }
  return reducedMotion ? REDUCED : recipe();
}

export function staggerParent({ reducedMotion = false } = {}) {
  return {
    initial: {},
    animate: {
      transition: {
        staggerChildren: reducedMotion ? 0 : STAGGER.children,
        delayChildren: reducedMotion ? 0 : STAGGER.delay,
      },
    },
    exit: {},
  };
}
