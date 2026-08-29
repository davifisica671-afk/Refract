// electron/llm/profileGroundingV2.ts
//
// Feature flag para o Perfil Grounding V2 rewrite (RC-1/2/4/5/10): substituir o
// two-router + 0.55-cosine RAG caminho para resume/JD facts com DETERMINISTIC
// full-structured-profile injection — o whole typed retomar + JD rendered dentro de
// an authorized grounding block que é Sempre present (gated por answer tipo então
// coding/technical/sales/lecture obtém Não prperfil então retrieval pode nunca gate
// grounding ou leave a void o modelo fills com "I don't ter acacesso
//
// DEFAULT Em (kill-switch mmodelo mirroring verificationEnabled.ts). Validated por
// 263 Mode/Profile tests em ambos flag states + 35 spec §11 cases + o
// ProfileOutputValidator. Disableable at runtime Sem a redeploy se o live
// caminho já misbehaves:
//   - env  PROFILE_GROUNDING_V2 = 'ofora | 'false' | '0' | 'disabled'  → disabled
//   - configurações  profileGroundingV2 === falso                          → disabled
// Lê defensively (nunca throws). Qualquer uncertainty resolves para o padrão OEm
// EXCEPT an explicit env/settings "ofora que sempre wins.
//
// NOTE: o live-API / real-UI eval (intelligence-eval-real-api/, -real-ui/) é
// o production-proof gate mas poderia não executa durante development (o project's
// Gemini chave era billing-blocked). Executa those uma vez a working chave é available;
// se qualquer coisa regresses, define PROFILE_GROUNDING_V2=off para revert instantly.

let cachedEnv: boolean | null = null;

const envDisabled = (): boolean => {
  if (cachedEnv !== null) return cachedEnv;
  let off = false;
  try {
    const v = (process.env.PROFILE_GROUNDING_V2 || '').trim().toLowerCase();
    off = v === 'off' || v === 'false' || v === '0' || v === 'disabled';
  } catch { off = false; }
  cachedEnv = off;
  return off;
};

/**
 * Verdadeiro quando Perfil Grounding V2 (full-profile injection) deve rexecuta Default
 * OEm an explicit env ou configurações "ofora desabilita it at runtime (não redeploy).
 * Safe para chamar em o hot caminho (settings lê é a cheap cached geobtém
 */
export const isProfileGroundingV2Enabled = (): boolean => {
  if (envDisabled()) return false;
  try {
    // De electron/llm/ → ../services/SettingsManager
    const { SettingsManager } = require('../services/SettingsManager');
    const v = SettingsManager.getInstance().get('profileGroundingV2');
    if (v === false) return false; // explicit opt-out oapenas undefined → default Em
  } catch { /* settings unavailable → fall através to default Em */ }
  return true;
};

/** Test-only: reinicia o cached env lê (env can't change mid-process otcaso contrário */
export const __resetProfileGroundingV2Cache = (): void => { cachedEnv = null; };
