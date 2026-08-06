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

// 唯一读 event.data 内部形状的地方(orderMetadata/packId 查表)。Waffo 的信封字段
// (id/eventId/mode/storeId/eventType)由投递框架保证存在,但 data 是更松散的业务
// payload,历史上出现过缺字段/改版。调用方把这段包在 try/catch 里,只吞这里可能
// 抛出的 TypeError——不吞 DB/网络层的基础设施异常(那些要向上抛,让 Waffo 重试)。
function resolveOrderTarget(
  event: WebhookEvent<WebhookEventData>,
): { userId: string; pack: (typeof ADDON_PACKS)[number] } | null {
  const meta = event.data.orderMetadata ?? {};
  const userId = meta.userId;
  const packId = meta.packId;
  if (!userId || meta.kind !== 'pack' || !packId) {
    logger.warn({ eventId: event.eventId }, 'waffo order metadata incomplete');
    return null;
  }
  const pack = ADDON_PACKS.find((p) => p.id === packId);
  if (!pack) {
    logger.warn({ eventId: event.eventId, packId }, 'waffo pack unknown');
    return null;
  }
  return { userId, pack };
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

    // eventId 缺失时幂等键会退化成 `waffo:${undefined}`——第一单入账后,所有后续
    // 事件都会被当成同一条重复记录静默吞掉。必须在算出幂等键之前拦住。
    if (!event.eventId) {
      logger.error({ storeId: event.storeId, eventType: event.eventType }, 'waffo webhook missing eventId, ignored');
      return;
    }

    // 环境隔离:test 事件打到 prod(或反向)必须拒发积分。签名层通常已按环境公钥
    // 拦住,这里是密钥配置错误时的兜底。ack(不抛)以免 Waffo 无限重试。
    if (event.mode !== env.WAFFO_ENV) {
      logger.error({ eventMode: event.mode, expected: env.WAFFO_ENV, eventId: event.eventId }, 'waffo webhook env mismatch, ignored');
      return;
    }
    // store 门是 webhook 的租户边界安全控制,fail-closed:未配置 WAFFO_STORE_ID 与
    // 配置了却不匹配,都必须拒收——不是"配了才校验"的可选项。旧版
    // `env.WAFFO_STORE_ID && event.storeId !== env.WAFFO_STORE_ID` 在漏配时直接放行
    // 任何店的事件,等同于关掉这道门。两个分支分别 error 日志,方便区分"忘配"和
    // "配错"。
    if (!env.WAFFO_STORE_ID) {
      logger.error({ eventId: event.eventId }, 'waffo webhook WAFFO_STORE_ID not configured, rejecting all events (fail-closed)');
      return;
    }
    if (event.storeId !== env.WAFFO_STORE_ID) {
      logger.error({ storeId: event.storeId, expected: env.WAFFO_STORE_ID, eventId: event.eventId }, 'waffo webhook store mismatch, ignored');
      return;
    }

    if (event.eventType !== 'order.completed') {
      logger.info({ type: event.eventType, eventId: event.eventId }, 'waffo webhook ignored');
      return;
    }

    // 幂等键含 eventType:SDK 随包 docs/webhook-guide.md「Retry Mechanism」小节明确
    // 唯一性是 eventType+eventId 的组合("The same business event (same eventType +
    // eventId) creates only one delivery record"),eventId 单独不保证跨事件类型唯一
    // (比如 refund 事件继承订单侧 ID)。eventType 过滤挪到这行之前,同时也省掉了非
    // order.completed 事件本不需要的一次幂等 DB 读。格式从 `waffo:${eventId}` 改成
    // 三段式不需要迁移:Waffo 是这条分支第一次上线的通道,main 上不存在任何用旧格式
    // 写过的 credit_ledger 行。
    const externalEventId = `waffo:${event.eventType}:${event.eventId}`;
    // 幂等探测是真实的 DB 读。它抛出的非 AppError 异常(连接重置/超时等基础设施
    // 故障)必须照常向上抛——路由层会变成 500,Waffo 收到后重试,幂等索引保证重试
    // 不会重复入账。绝不能在这里吞成 ack,否则一次 DB 瞬断就会让真实付款永久丢单。
    const existing = await creditLedgerRepo.findByExternalEventId(externalEventId);
    if (existing) {
      logger.info({ eventId: event.eventId, type: event.eventType }, 'waffo webhook duplicate, skipped');
      return;
    }

    // 验签后 event.data 的内部形状不再受我们控制(Waffo 那头发错包 / 改版)。这一小段
    // (resolveOrderTarget)全靠属性访问,非 AppError 异常(比如 data 整体缺失导致的
    // TypeError)当"畸形毒丸包"处理:吞掉 ack,避免 Waffo 对同一坏包无限重试,只留
    // 一行 error 日志排查。保护范围刻意收窄到这一段——不覆盖下面的 db.transaction/
    // applyDelta,那些的异常必须能向上抛(见上面幂等探测的注释,同一个道理)。
    let target: { userId: string; pack: (typeof ADDON_PACKS)[number] } | null;
    try {
      target = resolveOrderTarget(event);
    } catch (e) {
      if (e instanceof AppError) throw e;
      logger.error(
        { err: String(e), eventId: event.eventId },
        'waffo webhook payload malformed after verification, acked to avoid poison-payload retry storm',
      );
      return;
    }
    if (!target) return; // 已在 resolveOrderTarget 内部按分支 warn 过(metadata 不全 / pack 未知)
    const { userId, pack } = target;

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

    logger.info({ userId, packId: pack.id, books: pack.books, eventId: event.eventId }, 'waffo purchase credited');
  },
};
