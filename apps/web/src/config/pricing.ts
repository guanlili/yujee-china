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

// ── Photo → credit accounting (SINGLE SOURCE OF TRUTH) ───────────────────────
// One credit covers up to PHOTOS_PER_CREDIT photos. A generation of N photos
// costs creditsForPhotos(N) credits, charged when the layout succeeds.
//
// This is the ONLY place the photos-per-credit threshold is defined. Billing
// math and UI copy ("1 credit = N photos") must derive from here, NEVER
// hardcode a number. The per-request analyze cap is a separate product knob.
//
// Confirmed product rule (2026-07-14): 20 photos per credit. At the $3 entry
// pack (1 credit) that is $3 per 20 photos, which still clears cost. The landing
// FAQ and JSON-LD interpolate this constant, so changing it also changes the
// public copy.
export const PHOTOS_PER_CREDIT = 20;

// What PHOTOS_PER_CREDIT photos typically becomes once laid out. Public copy says
// "1 credit = N photos, usually 8–12 pages" — a descriptive range, NOT a promise:
// the layout decides the real count. Never phrase it as a guarantee.
export const PAGES_PER_CREDIT = { min: 8, max: 12 } as const;
export const PAGES_PER_CREDIT_LABEL = `${PAGES_PER_CREDIT.min}-${PAGES_PER_CREDIT.max}`;

// Credits charged for a generation of `photoCount` photos: ceil(N / PHOTOS_PER_CREDIT),
// floored at 1 so any non-empty upload always costs at least one credit.
export function creditsForPhotos(photoCount: number): number {
  return Math.max(1, Math.ceil(photoCount / PHOTOS_PER_CREDIT));
}

// Hard upper bound on photos accepted in a single generation request (init/add).
// Kept as its own product knob: billing still uses PHOTOS_PER_CREDIT, while the
// analyze entry accepts up to 100 photos per album request.
export const MAX_PHOTOS_PER_GENERATION = 100;

// DEPRECATED — kept only so existing imports compile until the per-photo charge
// is wired in. The flat "1 credit per album" model is being replaced by
// creditsForPhotos(photoCount); remove this once all call sites are migrated.
export const CREDIT_COST_PER_ALBUM = 1;

// New users get one free credit.
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
