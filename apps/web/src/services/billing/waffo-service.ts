import { WaffoPancake } from '@waffo/pancake-ts';
import { userRepo } from '@/db/repos/user-repo';
import {
  ADDON_PACKS,
  WAFFO_PRODUCT_ENV_BY_PACK_ID,
  buildCheckoutReturnUrls,
  type CheckoutReturnContext,
  type AddonPackId,
} from '@/config/pricing';
import { env } from '@/lib/env';
import { AppError, ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';

// Waffo Pancake — 海外主通道 MoR(2026-08 替换 Creem)。沿用 applyDelta +
// external_event_id 幂等契约。与 Creem 的关键差异:Waffo 无 customer id 概念
// (checkout/webhook 都只有 buyerEmail),因此不读写 customers 表。

function getClient(): WaffoPancake {
  if (!env.WAFFO_MERCHANT_ID || !env.WAFFO_PRIVATE_KEY) throw ERRORS.BILLING_NOT_CONFIGURED();
  return new WaffoPancake({ merchantId: env.WAFFO_MERCHANT_ID, privateKey: env.WAFFO_PRIVATE_KEY });
}

function resolveWaffoProductId(packId: AddonPackId): string {
  const envKey = WAFFO_PRODUCT_ENV_BY_PACK_ID[packId];
  const productId = env[envKey];
  if (!productId) {
    logger.warn({ packId, envKey }, 'waffo product id missing');
    throw ERRORS.BILLING_NOT_CONFIGURED();
  }
  return productId;
}

export const waffoService = {
  async createPackCheckout(
    userId: string,
    packId: string,
    context: CheckoutReturnContext = {},
  ): Promise<{ url: string }> {
    const pack = ADDON_PACKS.find((p) => p.id === packId);
    if (!pack) throw ERRORS.VALIDATION_FAILED(`Unknown pack: ${packId}`);
    const client = getClient();
    const productId = resolveWaffoProductId(pack.id);
    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();

    const { successUrl } = buildCheckoutReturnUrls(env.WEB_BASE_URL, 'waffo', context);
    let session: { checkoutUrl: string };
    try {
      session = await client.checkout.createSession({
        productId,
        currency: 'USD',
        buyerEmail: user.email,
        successUrl,
        metadata: { userId, kind: 'pack', packId },
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      logger.warn({ err: String(e), packId }, 'waffo api error');
      throw ERRORS.BILLING_UPSTREAM_ERROR(502);
    }
    if (!session.checkoutUrl) throw ERRORS.INTERNAL_ERROR();
    return { url: session.checkoutUrl };
  },
};
