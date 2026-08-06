import { WaffoPancake, verifyWebhook, type WebhookEvent, type WebhookEventData } from '@waffo/pancake-ts';
import { db } from '@/db/client';
import { userRepo } from '@/db/repos/user-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { creditService } from '@/services/credit/credit-service';
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

  async handleWebhook(rawBody: string, signature: string | null): Promise<void> {
    let event: WebhookEvent<WebhookEventData>;
    try {
      event = verifyWebhook<WebhookEventData>(rawBody, signature, { environment: env.WAFFO_ENV });
    } catch (e) {
      logger.warn({ err: String(e) }, 'waffo webhook signature failed');
      throw ERRORS.WEBHOOK_SIGNATURE_INVALID();
    }

    // 环境隔离:test 事件打到 prod(或反向)必须拒发积分。签名层通常已按环境公钥
    // 拦住,这里是密钥配置错误时的兜底。ack(不抛)以免 Waffo 无限重试。
    if (event.mode !== env.WAFFO_ENV) {
      logger.error({ eventMode: event.mode, expected: env.WAFFO_ENV, eventId: event.eventId }, 'waffo webhook env mismatch, ignored');
      return;
    }
    if (env.WAFFO_STORE_ID && event.storeId !== env.WAFFO_STORE_ID) {
      logger.error({ storeId: event.storeId, eventId: event.eventId }, 'waffo webhook store mismatch, ignored');
      return;
    }

    const externalEventId = `waffo:${event.eventId}`;
    const existing = await creditLedgerRepo.findByExternalEventId(externalEventId);
    if (existing) {
      logger.info({ eventId: event.eventId, type: event.eventType }, 'waffo webhook duplicate, skipped');
      return;
    }

    if (event.eventType !== 'order.completed') {
      logger.info({ type: event.eventType, eventId: event.eventId }, 'waffo webhook ignored');
      return;
    }

    const meta = event.data.orderMetadata ?? {};
    const userId = meta.userId;
    const packId = meta.packId;
    if (!userId || meta.kind !== 'pack' || !packId) {
      logger.warn({ eventId: event.eventId }, 'waffo order metadata incomplete');
      return;
    }
    const pack = ADDON_PACKS.find((p) => p.id === packId);
    if (!pack) {
      logger.warn({ eventId: event.eventId, packId }, 'waffo pack unknown');
      return;
    }

    const amountCents = Number.isFinite(Number(event.data.amount))
      ? Math.round(Number(event.data.amount) * 100)
      : Math.round(pack.priceUsd * 100);

    await db.transaction(async (tx) => {
      await creditService.applyDelta(tx, userId, pack.books, 'PURCHASE', {
        externalEventId,
        meta: {
          provider: 'waffo',
          order_id: event.data.orderId ?? null,
          pack_id: pack.id,
          amount_cents: amountCents,
        },
      });
    });

    logger.info({ userId, packId, books: pack.books, eventId: event.eventId }, 'waffo purchase credited');
  },
};
