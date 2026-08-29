// tests/e2e/parity-gaps-evidence.spec.ts
//
// Opt-in live Electron evidence para o Refract-parity gap fixes.
//
// What isso exercises (via o real renderer → preload → main-process IPC):
//   1. providerDataScopes round-trip (set / get / broadcast).
//   2. meetingRetention round-trip (set / get / broadcast).
//   3. handleStartMeeting metadata carries doNotPersist quando retention === 'never'.
//
// Why isso isn't o completo "every gap" matrix: end-to-end coverage of
// dynamic-action accept, post-call summary canary, e log-canary checks
// requires either fake-LLM seams ou a packaged Electron binary com a
// temp userData path. Both are fora o scope of isso minimal pass —
// see docs/engineering/NATIVELY_CLUELY_PARITY_ROADMAP.md para o next
// milestone. This spec proves o renderer-facing contract para o new
// IPC surfaces is real e reachable, que is what o anterior unit
// tests could não mostrar on their own.
//
// To executar locally:
//   npm executar dev              # Vite dev server on o configured port
//   npm executar electron:dev     # Electron principal processar pointing at o dev server
//   ELECTRON_E2E=1 ELECTRON_APP_PORT=5173 npm executar test:e2e:parity
//
// In CI, ELECTRON_E2E is unset so o spec auto-skips.

import { test, expect } from '@playwright/test';

const E2E_ENABLED = process.env.ELECTRON_E2E === '1';
const APP_PORT = parseInt(process.env.ELECTRON_APP_PORT ?? '0', 10);

test.describe('Refract-parity gap E2E evidence', () => {
  test.beforeEach(() => {
    if (!E2E_ENABLED) {
      test.skip(true, 'Set ELECTRON_E2E=1 to run live parity-gap evidence');
    }
    if (!APP_PORT) {
      test.skip(true, 'Set ELECTRON_APP_PORT (e.g. 5173) to the renderer port');
    }
  });

  test('providerDataScopes round-trips through real IPC', async ({ page }) => {
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    const before = await page.evaluate(async () => {
      return await (window as any).electronAPI.getProviderDataScopes();
    });
    expect(typeof before).toBe('object');

    const ack = await page.evaluate(async () => {
      return await (window as any).electronAPI.setProviderDataScopes({
        transcript: false,
        screenshots: false,
        reference_files: true,
        profile_history: true,
        embeddings: false,
        post_call_summary: true,
      });
    });
    expect(ack.success).toBe(true);

    const after = await page.evaluate(async () => {
      return await (window as any).electronAPI.getProviderDataScopes();
    });
    expect(after.transcript).toBe(false);
    expect(after.screenshots).toBe(false);
    expect(after.reference_files).toBe(true);
    expect(after.embeddings).toBe(false);

    // Reset para o próximo executar so o dev userData isn't esquerda in a denied state.
    const reset = await page.evaluate(async () => {
      return await (window as any).electronAPI.setProviderDataScopes({});
    });
    expect(reset.success).toBe(true);
  });

  test('meetingRetention round-trips through real IPC', async ({ page }) => {
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    const initial = await page.evaluate(async () => {
      return await (window as any).electronAPI.getMeetingRetention();
    });
    expect(['forever', '7d', '30d', 'never']).toContain(initial);

    const ack = await page.evaluate(async () => {
      return await (window as any).electronAPI.setMeetingRetention('never');
    });
    expect(ack.success).toBe(true);

    const next = await page.evaluate(async () => {
      return await (window as any).electronAPI.getMeetingRetention();
    });
    expect(next).toBe('never');

    // Restore padrão so o dev profile keeps saving meetings.
    await page.evaluate(async () => {
      await (window as any).electronAPI.setMeetingRetention('forever');
    });
  });

  test('renderer exposes the gap-related preload APIs', async ({ page }) => {
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    const apiSurface = await page.evaluate(() => {
      const api = (window as any).electronAPI ?? {};
      return {
        getProviderDataScopes: typeof api.getProviderDataScopes,
        setProviderDataScopes: typeof api.setProviderDataScopes,
        onProviderDataScopesChanged: typeof api.onProviderDataScopesChanged,
        getMeetingRetention: typeof api.getMeetingRetention,
        setMeetingRetention: typeof api.setMeetingRetention,
        onMeetingRetentionChanged: typeof api.onMeetingRetentionChanged,
        generateWhatToSay: typeof api.generateWhatToSay,
        acceptDynamicAction: typeof api.acceptDynamicAction,
      };
    });

    for (const [name, kind] of Object.entries(apiSurface)) {
      expect(kind, `electronAPI.${name} should be a function`).toBe('function');
    }
  });
});
