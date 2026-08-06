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

export type CheckoutProvider = 'creem' | 'waffo';
export const CHECKOUT_PROVIDERS = ['creem', 'waffo'] as const satisfies readonly CheckoutProvider[];
// Waffo 是主通道(2026-08 切换);creem 保留仅为 Phase 1 在途订单 webhook 兜底。
export const ACTIVE_CHECKOUT_PROVIDER = 'waffo' satisfies CheckoutProvider;
export type CheckoutLocale = 'en' | 'zh';
export type CheckoutSource = 'album' | 'create' | 'home';
export type CheckoutReturnContext = {
  locale?: CheckoutLocale;
  from?: CheckoutSource;
};

export type CreemProductEnvKey =
  | 'CREEM_PRODUCT_ID_PACK_1'
  | 'CREEM_PRODUCT_ID_PACK_4'
  | 'CREEM_PRODUCT_ID_PACK_10';

export type WaffoProductEnvKey =
  | 'WAFFO_PRODUCT_ID_PACK_1'
  | 'WAFFO_PRODUCT_ID_PACK_4'
  | 'WAFFO_PRODUCT_ID_PACK_10';

// ── Photo → credit accounting (SINGLE SOURCE OF TRUTH) ───────────────────────
// One credit covers up to PHOTOS_PER_CREDIT photos. A generation of N photos
// costs creditsForPhotos(N) credits, charged when the layout succeeds.
//
// This is the ONLY place the photos-per-credit threshold is defined. Billing
// math and UI copy ("1 credit = N photos") must derive from here, NEVER
// hardcode a number. The per-request analyze cap is a separate product knob.
//
// Re-denominated (2026-07-17): 1 credit = 1 photo. The old model charged a whole
// credit per batch of up to 20 photos (ceil(N/20)), which users found opaque
// ("why 1 credit whether I upload 3 or 20?"). Strict per-photo billing is
// clearer and fairer to small/repeat uploads. Dollars are unchanged: the $3
// entry pack now grants 20 credits (see ADDON_PACKS), still $3 for 20 photos.
// Existing balances/ledger/holds were multiplied ×20 in migration 0016. The
// landing FAQ and JSON-LD interpolate this constant, so it also drives copy.
export const PHOTOS_PER_CREDIT = 1;

// Typical page count for a full ~20-photo book once laid out. Public copy says
// "a book is usually 8–12 pages" — a descriptive range, NOT a promise, and NO
// longer tied to a single credit (a credit is now one photo). The layout decides
// the real count. Never phrase it as a guarantee.
export const PAGES_PER_CREDIT = { min: 8, max: 12 } as const;
export const PAGES_PER_CREDIT_LABEL = `${PAGES_PER_CREDIT.min}-${PAGES_PER_CREDIT.max}`;

// Credits charged for a generation of `photoCount` photos: ceil(N / PHOTOS_PER_CREDIT),
// floored at 1 so any non-empty upload always costs at least one credit. With
// PHOTOS_PER_CREDIT = 1 this is exactly N (strict per-photo).
export function creditsForPhotos(photoCount: number): number {
  return Math.max(1, Math.ceil(photoCount / PHOTOS_PER_CREDIT));
}

// Hard upper bound on photos accepted in a single generation request (init/add).
// Kept as its own product knob: billing still uses PHOTOS_PER_CREDIT, while the
// analyze entry accepts up to 100 photos per album request.
export const MAX_PHOTOS_PER_GENERATION = 100;

// DEPRECATED — the live charge path is per-photo via creditsForPhotos(photoCount);
// this flat "1 credit per album" constant is kept only so lingering imports
// compile. Remove once no call site references it.
export const CREDIT_COST_PER_ALBUM = 1;

// New users get a free welcome grant. Re-denominated to 20 (= 20 photos, one full
// starter book) when 1 credit became 1 photo. The users.credit_balance column
// default is aligned to this in schema.ts / migration 0016.
export const FREE_PLAN_CREDITS = 20;

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

// 三档一次性积分包。价格 $3/$10/$20 固定(Creem 产品),books 字段沿用旧名、语义是积分数。
// 2026-07-17 重定价:1 积分=1 张后,三档积分数 ×20 → 20/80/200(美元不变)。产品 id 走 env(主通道 Waffo,Creem 兜底)。
export const ADDON_PACKS = [
  { id: 'pack-1', books: 20, priceUsd: 3 },
  { id: 'pack-4', books: 80, priceUsd: 10 },
  { id: 'pack-10', books: 200, priceUsd: 20 },
] as const satisfies readonly CreditPack[];

export type AddonPackId = (typeof ADDON_PACKS)[number]['id'];

export const CREEM_PRODUCT_ENV_BY_PACK_ID: Record<AddonPackId, CreemProductEnvKey> = {
  'pack-1': 'CREEM_PRODUCT_ID_PACK_1',
  'pack-4': 'CREEM_PRODUCT_ID_PACK_4',
  'pack-10': 'CREEM_PRODUCT_ID_PACK_10',
};

export const WAFFO_PRODUCT_ENV_BY_PACK_ID: Record<AddonPackId, WaffoProductEnvKey> = {
  'pack-1': 'WAFFO_PRODUCT_ID_PACK_1',
  'pack-4': 'WAFFO_PRODUCT_ID_PACK_4',
  'pack-10': 'WAFFO_PRODUCT_ID_PACK_10',
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
