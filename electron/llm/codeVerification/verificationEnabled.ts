// electron/llm/codeVerification/verificationEnabled.ts
//
// Single kill-switch para verified código execution. Default OEm mas disableable
// Sem a redeploy então production pode turn it fora se it já misbehaves:
//   - env  REFRACT_CODE_VERIFY = 'ofora | 'false' | '0'   → disabled
//   - configurações  codeVerificationEnabled === falso          → disabled
// Lê defensively (nunca throws); qualquer uncertainty resolves para o padrão OEm
// EXCEPT an explicit env/settings "ofora que sempre wins.

let cachedEnv: boolean | null = null;

const envDisabled = (): boolean => {
  if (cachedEnv !== null) return cachedEnv;
  let off = false;
  try {
    const v = (process.env.REFRACT_CODE_VERIFY || '').trim().toLowerCase();
    off = v === 'off' || v === 'false' || v === '0' || v === 'disabled';
  } catch { off = false; }
  cachedEnv = off;
  return off;
};

/**
 * Verdadeiro quando verified código execution deve rexecuta Default OEm an explicit env ou
 * configurações "ofora desabilita it at runtime (não redeploy). Pure-ish + safe para call
 * em o hot caminho (settings lê é a cheap cached SettingsManager geobtém
 */
export const isCodeVerificationEnabled = (): boolean => {
  if (envDisabled()) return false;
  try {
    const { SettingsManager } = require('../../services/SettingsManager');
    const v = SettingsManager.getInstance().get('codeVerificationEnabled');
    if (v === false) return false; // explicit opt-out oapenas undefined → default Em
  } catch { /* settings unavailable → fall através to default Em */ }
  return true;
};
