import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAY_THEMES, isValidOverlayTheme } from '../overlayThemeList.mjs';

describe('overlayThemeList', () => {
  test('lista contém exatamente os 5 temas (ordem estável)', () => {
    assert.deepEqual(OVERLAY_THEMES, ['default', 'liquid-glass', 'modern', 'aurora', 'mono']);
  });

  test('isValidOverlayTheme aceita os 5 temas válidos', () => {
    for (const theme of ['default', 'liquid-glass', 'modern', 'aurora', 'mono']) {
      assert.equal(isValidOverlayTheme(theme), true, `esperava true para '${theme}'`);
    }
  });

  test('isValidOverlayTheme rejeita valores legados e inválidos', () => {
    for (const legacy of ['', null, undefined, 'glass', 'Glass', 'DEFAULT', 'Modern', 'dark', 'light', 0, 42, {}, []]) {
      assert.equal(isValidOverlayTheme(legacy), false, `esperava false para ${JSON.stringify(legacy)}`);
    }
  });
});
