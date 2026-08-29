import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION,
  STAGGER,
  EXIT_RATIO,
  exitDuration,
  gesture,
  staggerParent,
} from '../overlayMotion.mjs';

describe('overlayMotion', () => {
  describe('exitDuration', () => {
    test('saída é 65% da entrada, arredondada', () => {
      assert.equal(exitDuration(260), 169);
      assert.equal(exitDuration(200), 130);
      assert.equal(exitDuration(160), 104);
    });
    test('EXIT_RATIO é a única fonte da regra', () => {
      assert.equal(EXIT_RATIO, 0.65);
      assert.equal(exitDuration(1000), Math.round(1000 * EXIT_RATIO));
    });
  });

  describe('gesture("chip")', () => {
    const g = gesture('chip');
    test('entra por escala, nunca por deslocamento', () => {
      assert.equal(g.initial.scale, 0.92);
      assert.equal(g.initial.opacity, 0);
      assert.equal('y' in g.initial, false);
    });
    test('sai encolhendo', () => {
      assert.equal(g.exit.scale, 0.96);
    });
    test('não usa filter (custo desnecessário em elemento pequeno)', () => {
      assert.equal('filter' in g.initial, false);
    });
  });

  describe('gesture("surface")', () => {
    const g = gesture('surface');
    test('entra deslocando e condensando (o gesto assinatura)', () => {
      assert.equal(g.initial.y, 8);
      assert.equal(g.initial.filter, 'blur(4px)');
      assert.equal(g.animate.filter, 'blur(0px)');
    });
    test('a saída é mais rápida que a entrada', () => {
      assert.ok(g.exit.transition.duration < g.animate.transition.duration);
    });
  });

  describe('gesture("chrome")', () => {
    test('entra de cima, coerente com onde vive', () => {
      assert.equal(gesture('chrome').initial.y, -4);
    });
  });

  describe('reducedMotion', () => {
    for (const kind of ['chip', 'surface', 'chrome']) {
      test(`"${kind}" colapsa para fade puro de 120ms`, () => {
        const g = gesture(kind, { reducedMotion: true });
        assert.deepEqual(Object.keys(g.initial), ['opacity']);
        assert.equal(g.animate.transition.duration, 0.12);
        assert.equal(g.exit.transition.duration, 0.12);
      });
    }
    test('o stagger some sob reducedMotion', () => {
      assert.equal(staggerParent({ reducedMotion: true }).animate.transition.staggerChildren, 0);
    });
  });

  describe('staggerParent', () => {
    test('usa as constantes declaradas', () => {
      const p = staggerParent();
      assert.equal(p.animate.transition.staggerChildren, STAGGER.children);
      assert.equal(p.animate.transition.delayChildren, STAGGER.delay);
    });
    test('a cascata inteira cabe em ~200ms para 6 filhos', () => {
      const total = (STAGGER.delay + STAGGER.children * 6) * 1000;
      assert.ok(total <= 260, `cascata de ${total}ms é lenta demais`);
    });
  });

  describe('validação de entrada', () => {
    test('gesto desconhecido falha alto, não silenciosamente', () => {
      assert.throws(() => gesture('bogus'), /gesto desconhecido/i);
    });
  });

  test('as durações base batem com os tokens CSS --dur-*', () => {
    assert.deepEqual(
      { fast: MOTION.fast, base: MOTION.base, slow: MOTION.slow },
      { fast: 120, base: 200, slow: 320 },
    );
  });
});
