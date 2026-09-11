/**
 * appIdentity.ts — Fonte única de verdade da identidade do app Refract.
 *
 * PROBLEMA RESOLVIDO (drift de identidade):
 * `package.json` → `build.appId` é o bundle ID oficial do app empacotado
 * (electron-builder escreve esse valor no CFBundleIdentifier do Info.plist).
 * Histórico: o appId já foi `com.electron.meeting-notes` (stale de template
 * do Electron) e foi trocado para `com.joaolucas.refract`, mas código de
 * reparo TCC em ipcHandlers.ts continuava hardcodando o bundle ID antigo —
 * fazendo `tccutil reset` operar sobre uma identidade que não era a do app
 * real (bug concreto de TCC/macOS: permissões pareciam reparadas, mas o
 * reset ocorria sobre a entidade errada).
 *
 * REGRA: qualquer código que precise do bundle ID do app DEVE importar
 * daqui. Nunca hardcodar o literal em outro arquivo. `build.appId` em
 * package.json deve permanecer sincronizado — o teste
 * `electron/services/__tests__/AppIdentityTcc.test.mjs` verifica a
 * equivalência entre este módulo e package.json.
 */

/** Bundle ID oficial do app empacotado (== package.json build.appId). */
export const APP_BUNDLE_ID = 'com.joaolucas.refract';

/**
 * Bundle ID do binário Electron em modo dev (npm run app:dev). TCC registra
 * permissões de desenvolvimento sob esta identidade — não é um bug, é como
 * o macOS trata o binário de dev não-empacotado.
 */
export const DEV_BUNDLE_ID = 'com.github.Electron';

/**
 * Resolve o bundle ID correto para operações TCC (`tccutil reset`).
 *
 * - Empacotado: usa APP_BUNDLE_ID (== CFBundleIdentifier real do Info.plist,
 *   garantido pelo electron-builder via build.appId).
 * - Dev: usa DEV_BUNDLE_ID, pois é sob essa identidade que as permissões de
 *   desenvolvimento são registradas no TCC.
 *
 * Nota: trocar o bundle ID reseta TODAS as permissões TCC existentes
 * (macOS chaves permissões pelo bundle id) — não mudar APP_BUNDLE_ID sem
 * planejar o impacto (ver docs/engineering/MACOS_SIGNING_NOTARIZATION_CHECKLIST.md).
 */
export function resolveTccBundleId(isPackaged: boolean): {
  bundleId: string;
  usingDevFallback: boolean;
} {
  return isPackaged
    ? { bundleId: APP_BUNDLE_ID, usingDevFallback: false }
    : { bundleId: DEV_BUNDLE_ID, usingDevFallback: true };
}
