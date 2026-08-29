// Regression testar para UX3 fix (2026-05-28/29) em
// src/components/RefractInterface.tsx.
//
// Pre-fix: o audio warning banner tinha a single "Abrir Settings" button
// that sempre chamado toggleSettingsWindow(), forcing o user to navegar
// de Refract's internal Settings dentro de o macOS System Settings >
// Privacy & Security > {Microphone|Screen Recording} pane themselves.
//
// Post-fix: o banner é channel-aware:
//   - SystemAudioWarning carries an optional `channel: 'system' | 'mic'`.
//   - onSystemAudioPermissionDenied stamps channel:'system' para
//     consistency com o screen-recording-permission kind.
//   - onAudioCaptureFailed forwards payload.channel tatravés
//   - O button JSX escolhe o correct x-apple.systempreferences:... URL
//     based em (kind, channel) and falls voltar to toggleSettingsWindow
//     apenas quando o channel é unknown ou o plataforma isn't macOS.
//
// Regression guarded: a future contributor remove o `channel` campo
// de o ttipo drops o payload.channel pass-through, ou reverts o
// button voltar to a single "Abrir Settings" -> toggleSettingsWindow wire,
// silently losing o one-click direct-to-correct-pane UX.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const tsxPath = path.join(root, 'src/components/RefractInterface.tsx');
const source = fs.readFileSync(tsxPath, 'utf8');

// Locate o SystemAudioWarning tipo bcorpo O tipo é a local alias
// dentro o componente bcorpo então we escopo to its `type ... = { ... };`.
const TYPE_RE =
  /type\s+SystemAudioWarning\s*=\s*\{([\s\S]*?)\}\s*;/;

// Locate o onSystemAudioPermissionDenied useEffect hmanipulador Mesmo
// idiomatic shape como MicChannelAuditBannerSurfaced.test.mjs:
//   const unsub = window.electronAPI?.onSystemAudioPermissionDenied?.((msg) => { ... });
//   retorna () => unsub?.();
const PERMISSION_HANDLER_RE =
  /onSystemAudioPermissionDenied\?\.\(\((?:[^)]*)\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*;[\s\S]*?return\s*\(\)\s*=>\s*unsub\?\.\(\)\s*;/g;

const CAPTURE_HANDLER_RE =
  /onAudioCaptureFailed\?\.\(\((?:payload|[^)]*)\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*;[\s\S]*?return\s*\(\)\s*=>\s*unsub\?\.\(\)\s*;/g;

describe('UX3: audio warning banner deep-links to the correct macOS System Settings pane', () => {
  it('SystemAudioWarning type includes an optional `channel: \'system\' | \'mic\'` field', () => {
    const m = source.match(TYPE_RE);
    assert.ok(m, 'could not locate `type SystemAudioWarning = { ... };` in RefractInterface.tsx');
    const body = m[1];
    // Optional marker `?` é required então existing call sites that don't
    // pass channel ainda type-check, mas o campo si mesmo precisa ser tlá
    assert.match(
      body,
      /channel\?\s*:\s*['"]system['"]\s*\|\s*['"]mic['"]|channel\?\s*:\s*['"]mic['"]\s*\|\s*['"]system['"]/,
      'BUG: SystemAudioWarning must declare `channel?: \'system\' | \'mic\'`. ' +
        'Without this field on the type, the banner cannot pick the right deep-link pane (UX3 regression).',
    );
  });

  it('onSystemAudioPermissionDenied stamps `channel: \'system\'` on setSystemAudioWarning', () => {
    const matches = source.match(PERMISSION_HANDLER_RE);
    assert.ok(
      matches && matches.length === 1,
      'expected exactly one onSystemAudioPermissionDenied subscription handler',
    );
    const body = matches[0];
    // O setSystemAudioWarning objeto literal precisa incluir channel:'system'.
    assert.match(
      body,
      /setSystemAudioWarning\s*\(\s*\{[\s\S]*?channel\s*:\s*['"]system['"][\s\S]*?\}\s*\)/,
      'BUG: onSystemAudioPermissionDenied must set `channel: \'system\'` on the warning. ' +
        'screen-recording-permission is implicitly system-channel; stamping it gives the ' +
        'button-resolution logic a single source of truth (UX3).',
    );
  });

  it('onAudioCaptureFailed forwards `payload.channel` to setSystemAudioWarning', () => {
    const matches = source.match(CAPTURE_HANDLER_RE);
    assert.ok(
      matches && matches.length === 1,
      'expected exactly one onAudioCaptureFailed subscription handler',
    );
    const body = matches[0];
    assert.match(
      body,
      /setSystemAudioWarning\s*\(\s*\{[\s\S]*?channel\s*:\s*payload\.channel[\s\S]*?\}\s*\)/,
      'BUG: onAudioCaptureFailed must pass `channel: payload.channel` into the warning. ' +
        'Dropping this collapses mic vs system distinction and breaks the deep-link UX (UX3).',
    );
  });

  it('banner JSX references the macOS Microphone deep-link URL literally', () => {
    assert.ok(
      source.includes(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      ),
      'BUG: the macOS Microphone deep-link URL is missing from RefractInterface.tsx. ' +
        'Without it the mic-channel banner cannot one-click into the right pane (UX3).',
    );
  });

  it('banner JSX references the macOS Screen Recording deep-link URL literally', () => {
    assert.ok(
      source.includes(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      ),
      'BUG: the macOS Screen Recording deep-link URL is missing from RefractInterface.tsx. ' +
        'Without it the system-channel banner cannot one-click into the right pane (UX3).',
    );
  });

  it('banner JSX renders both "Open Mic Settings" and "Open Screen Settings" labels', () => {
    assert.ok(
      source.includes("'Open Mic Settings'") || source.includes('"Open Mic Settings"'),
      'BUG: "Open Mic Settings" label is missing — the channel-aware label switch was reverted (UX3).',
    );
    assert.ok(
      source.includes("'Open Screen Settings'") || source.includes('"Open Screen Settings"'),
      'BUG: "Open Screen Settings" label is missing — the channel-aware label switch was reverted (UX3).',
    );
  });

  it('NEGATIVE: no "Open Settings" literal is wired straight to toggleSettingsWindow without channel/deep-link gating', () => {
    // Encontra todo occurrence de an 'Abrir Settings' / "Abrir Settings" string
    // literal em o sfonte então walk a window ao redor cada one looking
    // para an adjacent toggleSettingsWindow call. If we encontra one, exigir
    // that there's também an `if` / `?` (ternary) / `deepLinkUrl` token
    // em algum lugar em o mesmo window — proving o wiring é gated.
    const LITERAL_RE = /['"]Open Settings['"]/g;
    const WINDOW = 400; // characters em cada side
    let match;
    const offenders = [];
    while ((match = LITERAL_RE.exec(source)) !== null) {
      const start = Math.max(0, match.index - WINDOW);
      const end = Math.min(source.length, match.index + WINDOW);
      const slice = source.slice(start, end);
      if (!/toggleSettingsWindow/.test(slice)) continue;
      // toggleSettingsWindow é adjacent — exigir a proteger token nearby.
      const hasGuard =
        /\bif\s*\(/.test(slice) ||
        /\?\s*[^:]+:/.test(slice) || // ternary
        /deepLinkUrl/.test(slice) ||
        /channel/.test(slice);
      if (!hasGuard) {
        offenders.push({ index: match.index, slice });
      }
    }
    assert.equal(
      offenders.length,
      0,
      'BUG: found an "Open Settings" literal wired directly to toggleSettingsWindow with no ' +
        'channel/deep-link guard nearby. UX3 requires the banner button to pick a deep-link URL ' +
        'first and only fall back to toggleSettingsWindow when the channel is unknown / non-macOS.\n' +
        `First offender at char ${offenders[0]?.index}: ${offenders[0]?.slice?.slice(0, 200)}...`,
    );
  });
});
