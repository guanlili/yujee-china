/**
 * Single price source for marketing + billing.
 * B4 (billing) imports plans / addons / creditCostPerAlbum from here.
 *
 * Prices are USD (海外市场, yujeeai.com). CNY values from design-v1/design/pricing.html
 * were treated as placeholders. yearly amount is per-month when billed annually.
 */

export type PlanId = 'free' | 'pro' | 'studio';
export type BillingCycle = 'monthly' | 'yearly';

export interface PlanPrice {
  monthly: number;
  yearly: number;
}

export interface Plan {
  id: PlanId;
  nameKey: string;
  descKey: string;
  price: PlanPrice;
  currency: 'USD';
  creditsPerMonth: number;
  oneTimeCredits?: number;
  featureKeys: readonly string[];
  disabledFeatureKeys?: readonly string[];
  ctaKey: string;
  recommended?: boolean;
}

export interface CreditPack {
  id: string;
  credits: number;
  priceUsd: number;
}

export type CheckoutProvider = 'stripe' | 'creem';
export type CheckoutLocale = 'en' | 'zh';
export type CheckoutSource = 'album' | 'create' | 'home';
export type CheckoutReturnContext = {
  locale?: CheckoutLocale;
  from?: CheckoutSource;
};

export type CreemProductEnvKey =
  | 'CREEM_PRODUCT_ID_PACK_2400'
  | 'CREEM_PRODUCT_ID_PACK_4800'
  | 'CREEM_PRODUCT_ID_PACK_8000'
  | 'CREEM_PRODUCT_ID_PACK_16000';

export const CREDIT_COST_PER_ALBUM = 200;

export const FREE_PLAN_CREDITS = 1000;

export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    nameKey: 'plan.free.name',
    descKey: 'plan.free.desc',
    price: { monthly: 0, yearly: 0 },
    currency: 'USD',
    creditsPerMonth: 0,
    oneTimeCredits: FREE_PLAN_CREDITS,
    featureKeys: ['feat.unlimitedChat', 'feat.standard720p', 'feat.watermark'],
    disabledFeatureKeys: ['feat.commercial', 'feat.prioritySupport'],
    ctaKey: 'plan.cta.current',
  },
  {
    id: 'pro',
    nameKey: 'plan.pro.name',
    descKey: 'plan.pro.desc',
    price: { monthly: 12, yearly: 9 },
    currency: 'USD',
    creditsPerMonth: 4000,
    featureKeys: [
      'feat.unlimitedAi',
      'feat.hd1080p',
      'feat.noWatermark',
      'feat.commercial',
      'feat.support3day',
    ],
    ctaKey: 'plan.cta.pro',
    recommended: true,
  },
  {
    id: 'studio',
    nameKey: 'plan.studio.name',
    descKey: 'plan.studio.desc',
    price: { monthly: 39, yearly: 29 },
    currency: 'USD',
    creditsPerMonth: 18000,
    featureKeys: [
      'feat.unlimitedAi',
      'feat.hd1080p',
      'feat.noWatermark',
      'feat.commercial',
      'feat.support1v1',
      'feat.earlyAccess',
    ],
    ctaKey: 'plan.cta.studio',
  },
] as const;

export const ADDON_PACKS = [
  { id: 'pack-2400', credits: 2400, priceUsd: 3 },
  { id: 'pack-4800', credits: 4800, priceUsd: 6 },
  { id: 'pack-8000', credits: 8000, priceUsd: 10 },
  { id: 'pack-16000', credits: 16000, priceUsd: 18 },
] as const satisfies readonly CreditPack[];

export type AddonPackId = (typeof ADDON_PACKS)[number]['id'];

export const CREEM_PRODUCT_ENV_BY_PACK_ID: Record<AddonPackId, CreemProductEnvKey> = {
  'pack-2400': 'CREEM_PRODUCT_ID_PACK_2400',
  'pack-4800': 'CREEM_PRODUCT_ID_PACK_4800',
  'pack-8000': 'CREEM_PRODUCT_ID_PACK_8000',
  'pack-16000': 'CREEM_PRODUCT_ID_PACK_16000',
};

export function buildCheckoutReturnUrls(
  baseUrl: string,
  provider: CheckoutProvider,
  context: CheckoutReturnContext = {},
): { successUrl: string; cancelUrl: string } {
  const locale = context.locale ?? 'en';
  const build = (checkout: 'success' | 'cancel') => {
    const url = new URL(`/${locale}/credits`, baseUrl);
    url.searchParams.set('checkout', checkout);
    url.searchParams.set('provider', provider);
    if (context.from) url.searchParams.set('from', context.from);
    return url.toString();
  };

  return {
    successUrl: build('success'),
    cancelUrl: build('cancel'),
  };
}

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

export function planPriceFor(plan: Plan, cycle: BillingCycle): number {
  return cycle === 'yearly' ? plan.price.yearly : plan.price.monthly;
}

export function yearlyDiscountPercent(plan: Plan): number {
  if (plan.price.monthly === 0) return 0;
  return Math.round((1 - plan.price.yearly / plan.price.monthly) * 100);
}
