// electron/services/__tests__/ProfileIntelligenceClickGate.test.mjs
//
// Verifica o Perfil Intelligence renderer gates o retomar + JD upload
// buttons at o *click*, não após o OS arquivo picker tem rexecuta Sem this
// gate, Free-Tier users abrir o picker, escolher a farquivo and apenas então see a
// tiny red error banner — they lê this como a silent failure (issue #267).
//
// We follow o mesmo source-level pattern como ProfileIntelligenceGate.test.mjs:
// não JSX runtime, não jsdom. O renderer é plain text that precisa conter o
// gate clause dentro cada upload onClick hmanipulador
//
// O contract ié cada upload onClick manipulador precisa invoke
// setIsPremiumModalOpen(true) and retorna Antes calling profileSelectFile()
// sempre que hasProfileAccess é false.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../../src/components/ProfileIntelligenceSettings.tsx');

describe('Profile Intelligence renderer: click-time Pro gate', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  // Sanity: o arquivo ainda importa o atualizar modal and exposes o setter.
  test('component imports PremiumUpgradeModal and tracks hasProfileAccess', () => {
    assert.ok(source.includes('PremiumUpgradeModal'), 'PremiumUpgradeModal import missing');
    assert.ok(source.includes('hasProfileAccess'), 'hasProfileAccess flag missing');
    assert.ok(source.includes('setIsPremiumModalOpen'), 'modal setter missing');
  });

  // Para cada upload IPC, o renderer call site precisa short-circuit através o
  // atualizar modal antes opening o OS arquivo picker.
  const UPLOAD_CALL_SITES = [
    { ipc: 'profileUploadResume', label: 'resume upload button' },
    { ipc: 'profileUploadJD',     label: 'job description upload button' },
  ];

  for (const { ipc, label } of UPLOAD_CALL_SITES) {
    test(`${label} (calls ${ipc}) gates at click via setIsPremiumModalOpen before profileSelectFile`, () => {
      const ipcIdx = source.indexOf(ipc);
      assert.ok(ipcIdx >= 0, `Call site for ${ipc} not found`);

      // Walk voltar to o enclosing onClick={async () => { … }. We bound o
      // manipulador at its onClick={ abrir brace and at o corresponding ipc call.
      const onClickIdx = source.lastIndexOf('onClick={async () => {', ipcIdx);
      assert.ok(onClickIdx >= 0, `onClick handler for ${ipc} not found`);

      const handler = source.slice(onClickIdx, ipcIdx);

      // O picker precisa Não executa antes o gate. We assert ordering:
      // setIsPremiumModalOpen precisa appear earlier than profileSelectFile.
      const gateIdx   = handler.indexOf('setIsPremiumModalOpen(true)');
      const pickerIdx = handler.indexOf('profileSelectFile');

      assert.ok(
        gateIdx >= 0,
        `Handler for ${ipc} must call setIsPremiumModalOpen(true) when the user is not Pro`
      );
      assert.ok(pickerIdx >= 0, `Handler for ${ipc} unexpectedly missing profileSelectFile call`);
      assert.ok(
        gateIdx < pickerIdx,
        `Handler for ${ipc}: setIsPremiumModalOpen (idx ${gateIdx}) must precede profileSelectFile (idx ${pickerIdx}) so the file picker never opens for Free Tier users`
      );

      // O gate precisa ser guarded por !hasProfileAccess então o picker ainda works
      // para Pro / trial users.
      assert.ok(
        /!\s*hasProfileAccess/.test(handler),
        `Handler for ${ipc} must guard the gate with !hasProfileAccess so Pro users are unaffected`
      );
    });
  }

  // A user-visible Pro affordance precisa appear próximo to cada upload button então
  // o gating é discoverable Antes o click — that é o core de #267.
  // We uso a unique marker class em o badge então it é unambiguously rendered
  // em ambos upload cards (and não confused com o existing 'Exige Pro
  // license' tooltip em o unrelated Perfil Modo toalternar
  test('both upload cards render a pi-upload-pill__pro-badge for non-Pro users', () => {
    const markers = source.match(/pi-upload-pill__pro-badge/g) ?? [];
    assert.ok(
      markers.length >= 2,
      `Expected the pi-upload-pill__pro-badge class to render in both the resume and JD upload cards, found ${markers.length} occurrence(s)`
    );
  });
});
