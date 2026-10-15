/**
 * Contrato com o backend de dados (`backend/src/index.ts`).
 *
 * O dado bruto do jogo vem do data-release (semente). Aqui mora só o ajuste:
 * o que os usuários corrigiram. O app aplica o patch por cima da semente.
 */

/** Um item que o classificador não reconheceu. */
export interface UnknownSignal {
  /** fingerprint do ícone visto (hash dos pixels da célula) */
  iconHash: string;
  /** id do slot onde apareceu, para agrupar reports do mesmo lugar */
  slotIndex: number;
  /** dimensões da célula, evita colisão entre resoluções */
  cellSize: number;
  /** contagem local de quantas vezes o usuário viu */
  seen: number;
  observedAt: string;
}

export type CorrectionField = 'name' | 'value' | 'tier' | 'type' | 'description';

export interface Correction {
  itemId: string;
  field: CorrectionField;
  value: string;
  locale: string;
  /**true se veio do backend (consolidado) e não é só local */
  fromCommunity?: boolean;
}

export interface CorrectionReport {
  itemId: string;
  field: CorrectionField;
  value: string;
  locale: string;
  note?: string;
}

export interface SubmitResult {
  ok: boolean;
  reportId?: string;
  status: 'approved' | 'pending';
  message: string;
}

/** Patch devolvido por `GET /v1/patch`. */
export interface DataPatch {
  /** timestamp da última correção — usar como `since` na próxima busca */
  version: string | null;
  count: number;
  items: Record<string, Record<string, Record<string, { value: string; weight: number }>>>;
}

export type EntitlementTier = 'free' | 'premium';

export interface Entitlement {
  tier: EntitlementTier;
  expiresAt: string | null;
  expiredFrom?: string | null;
}

/**
 * O que o premium destrava.
 *
 * Regra de projeto: o tier free é funcional. Premium compra conveniência
 * (sincronização, histórico, automação), nunca a capacidade de reconhecer item
 * — travar leitura de tela atrás de assinatura é o que a gente decided não fazer.
 */
export interface PremiumFeatures {
  /** sync de progresso e stash entre PCs. free: só local. */
  cloudSync: boolean;
  /** histórico de raids valorizado. free: só a sessão atual. */
  raidHistory: boolean;
  /** agendamento automático de correção/envio. free: envio manual. */
  autoSubmit: boolean;
  /** número máximo de correções enviadas por dia. */
  dailySubmissionQuota: number;
}

export const FREE_FEATURES: PremiumFeatures = {
  cloudSync: false,
  raidHistory: false,
  autoSubmit: false,
  dailySubmissionQuota: 50,
};

export const PREMIUM_FEATURES: PremiumFeatures = {
  cloudSync: true,
  raidHistory: true,
  autoSubmit: true,
  dailySubmissionQuota: 2000,
};

export function featuresFor(tier: EntitlementTier): PremiumFeatures {
  return tier === 'premium' ? PREMIUM_FEATURES : FREE_FEATURES;
}