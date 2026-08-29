/**
 * Carregador do Módulo Premium
 *
 * Usa import.meta.glob do Vite para opcionalmente carregar componentes premium
 * do diretório premium/. Se a pasta premium/ para removida
 * (build de código aberto), os globs retornam objetos vazios e fallbacks
 * sem operação são usados em vez disso, sem erros de build.
 */
import React from 'react';

// ─── Fallbacks sem operação ────────────────────────────────────────────────
const NullComponent: React.FC<any> = () => null;

const nullAdCampaigns = (
  _planDetails: { isPremium: boolean; plan?: string; provider?: string },
  _hasProfile: boolean,
  _isAppReady: boolean,
  _appStartTime?: number,
  _lastMeetingEndTime?: number | null,
  _isProcessingMeeting?: boolean,
  _hasRefractApi?: boolean
) => ({
  activeAd: null as string | null,
  dismissAd: (_campaignId?: string) => {},
  previewAd: (_ad: any) => {},
});

// ─── Módulos premium via glob-import (objetos vazios quando premium/ está ausente) ──
const _premiumModal = import.meta.glob<any>(
  '../../premium/src/PremiumUpgradeModal.tsx',
  { eager: true }
);
const _profileVis = import.meta.glob<any>(
  '../../premium/src/ProfileVisualizer.tsx',
  { eager: true }
);
const _promoToaster = import.meta.glob<any>(
  '../../premium/src/PremiumPromoToaster.tsx',
  { eager: true }
);
const _profileToaster = import.meta.glob<any>(
  '../../premium/src/ProfileFeatureToaster.tsx',
  { eager: true }
);
const _jdToaster = import.meta.glob<any>(
  '../../premium/src/JDAwarenessToaster.tsx',
  { eager: true }
);
const _remoteCampaignToaster = import.meta.glob<any>(
  '../../premium/src/RemoteCampaignToaster.tsx',
  { eager: true }
);
const _adHook = import.meta.glob<any>(
  '../../premium/src/useAdCampaigns.ts',
  { eager: true }
);
const _negotiationCard = import.meta.glob<any>(
  '../../premium/src/NegotiationCoachingCard.tsx',
  { eager: true }
);
const _refractApiPromo = import.meta.glob<any>(
  '../../premium/src/RefractApiPromoToaster.tsx',
  { eager: true }
);
const _maxUltraUpgradeToaster = import.meta.glob<any>(
  '../../premium/src/MaxUltraUpgradeToaster.tsx',
  { eager: true }
);
const _modesSettings = import.meta.glob<any>(
  '../../premium/src/ModesSettings.tsx',
  { eager: true }
);

// ─── Função Auxiliar ──────────────────────────────────────────────────────────
function get<T>(mods: Record<string, any>, name: string, fallback: T): T {
  const mod = Object.values(mods)[0];
  return mod?.[name] ?? fallback;
}

// ─── Exportações (sempre seguro para importar) ─────────────────────────────────
export const PremiumUpgradeModal: React.FC<any> =
  get(_premiumModal, 'PremiumUpgradeModal', NullComponent);

export const ProfileVisualizer: React.FC<any> =
  get(_profileVis, 'ProfileVisualizer', NullComponent);

export const PremiumPromoToaster: React.FC<any> =
  get(_promoToaster, 'PremiumPromoToaster', NullComponent);

export const ProfileFeatureToaster: React.FC<any> =
  get(_profileToaster, 'ProfileFeatureToaster', NullComponent);

export const JDAwarenessToaster: React.FC<any> =
  get(_jdToaster, 'JDAwarenessToaster', NullComponent);

export const RemoteCampaignToaster: React.FC<any> =
  get(_remoteCampaignToaster, 'RemoteCampaignToaster', NullComponent);

export const useAdCampaigns: typeof nullAdCampaigns =
  get(_adHook, 'useAdCampaigns', nullAdCampaigns);

export const NegotiationCoachingCard: React.FC<any> =
  get(_negotiationCard, 'NegotiationCoachingCard', NullComponent);

export const RefractApiPromoToaster: React.FC<any> =
  get(_refractApiPromo, 'RefractApiPromoToaster', NullComponent);

export const MaxUltraUpgradeToaster: React.FC<any> =
  get(_maxUltraUpgradeToaster, 'MaxUltraUpgradeToaster', NullComponent);

export const ModesSettings: React.FC<any> =
  get(_modesSettings, 'default', NullComponent);
