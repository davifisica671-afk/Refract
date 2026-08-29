export interface MotionTokens {
  fast: number;
  base: number;
  slow: number;
  easeOut: number[];
  easeIn: number[];
  spring: number[];
}

/** Forma consumível direto por `motion.div` do framer-motion. */
export interface MotionVariant {
  initial: Record<string, unknown>;
  animate: Record<string, unknown>;
  exit: Record<string, unknown>;
}

export interface GestureOpts {
  reducedMotion?: boolean;
}

export type GestureKind = 'chip' | 'surface' | 'chrome';

export const MOTION: MotionTokens;
export const STAGGER: { children: number; delay: number };
export const EXIT_RATIO: number;

export function exitDuration(enterMs: number): number;
export function gesture(kind: GestureKind, opts?: GestureOpts): MotionVariant;
export function staggerParent(opts?: GestureOpts): MotionVariant;
