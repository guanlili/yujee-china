/**
 * Single price source for marketing + billing.
 * B4 (billing) imports plans / addons / creditCostPerAlbum from here.
 *
 * Per-book pricing (#97): one internal credit unit = one book. Each addon pack
 * grants whole books; one memoir costs CREDIT_COST_PER_ALBUM = 1 unit. The
 * internal `credit_*` identifiers stay for migration safety — only the unit
 * semantics changed.
 *
 * Prices are USD (海外市场, yujeeai.com).
 */

export type PlanId = 'free';

export interface Plan {
  id: PlanId;
  nameKey: string;
  descKey: string;
  currency: 'USD';
  oneTimeCredits?: number;
  featureKeys: readonly string[];
  ctaKey: string;
}

export interface CreditPack {
  id: string;
  books: number;
  priceUsd: number;
}

export type CheckoutProvider = 'creem';
export const CHECKOUT_PROVIDERS = ['creem'] as const satisfies readonly CheckoutProvider[];
export const ACTIVE_CHECKOUT_PROVIDER = 'creem' satisfies CheckoutProvider;
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

// One memoir = one book = one internal credit unit.
export const CREDIT_COST_PER_ALBUM = 1;

// New users get one free book.
export const FREE_PLAN_CREDITS = 1;

export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    nameKey: 'plan.free.name',
    descKey: 'plan.free.desc',
    currency: 'USD',
    oneTimeCredits: FREE_PLAN_CREDITS,
    featureKeys: ['feat.unlimitedChat', 'feat.export'],
    ctaKey: 'plan.cta.current',
  },
] as const;

// Pack ids and prices are fixed Creem products — never change them. Only the
// granted book count changed from the old credit amounts (#97).
export const ADDON_PACKS = [
  { id: 'pack-2400', books: 1, priceUsd: 3 },
  { id: 'pack-4800', books: 2, priceUsd: 6 },
  { id: 'pack-8000', books: 4, priceUsd: 10 },
  { id: 'pack-16000', books: 8, priceUsd: 18 },
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
