import { db } from '@/db/client';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { creditService } from '@/services/credit/credit-service';
import {
  ADDON_PACKS,
  ALIPAY_PACK_PRICE_CNY,
  buildCheckoutReturnUrls,
  type AddonPackId,
  type CheckoutReturnContext,
} from '@/config/pricing';
import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { alipayTimestamp, buildSignedUrl, verifyNotify } from '@/lib/billing/alipay-sign';

// 支付宝 · 电脑网站支付(alipay.trade.page.pay)。国内通道,与 Waffo/Creem 的
// MoR 模型不同:钱直接进商户的支付宝账户,我们需要自己去支付宝后台签约、下载
// 密钥,并自行处理退款与对账。因此这里的契约是"生成跳转 URL + 校验异步通知",
// 入账复用 applyDelta + external_event_id 幂等索引,与海外通道完全一致。

const GATEWAYS = {
  sandbox: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
  prod: 'https://openapi.alipay.com/gateway.do',
} as const;

type AlipayConfig = {
  appId: string;
  privateKey: string;
  publicKey: string;
  gateway: string;
};

/**
 * 三把配置缺一不可。缺任何一把时按未配置处理(fail-closed 503),绝不发一个
 * 签不出来的 URL 出去——用户点了会看到支付宝的"验签失败"页,比 503 更难排查。
 */
function getConfig(): AlipayConfig {
  const { ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY, ALIPAY_PUBLIC_KEY } = env;
  if (!ALIPAY_APP_ID || !ALIPAY_PRIVATE_KEY || !ALIPAY_PUBLIC_KEY) {
    throw ERRORS.BILLING_NOT_CONFIGURED();
  }
  return {
    appId: ALIPAY_APP_ID,
    privateKey: ALIPAY_PRIVATE_KEY,
    publicKey: ALIPAY_PUBLIC_KEY,
    gateway: GATEWAYS[env.ALIPAY_ENV],
  };
}

/** 单号:支付宝要求同一商户下唯一,且是账务对账的主键。 */
function newOutTradeNo(): string {
  return `yj${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export type AlipayNotifyParams = Record<string, string>;

/** 异步通知里透传的订单归属(userId/packId)。 */
type PassbackPayload = { userId?: string; packId?: string; locale?: string; from?: string };

/**
 * passback_params 是支付宝原样回传的字段,受签名保护,因此可信。但它也可能被
 * 拼成非法 JSON(极端情况下支付宝截断),解析失败一律当"无法归属"处理。
 */
function parsePassback(params: AlipayNotifyParams): PassbackPayload | null {
  const raw = params.passback_params;
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as PassbackPayload;
  } catch {
    try {
      return JSON.parse(raw) as PassbackPayload;
    } catch {
      return null;
    }
  }
}

export const alipayService = {
  async createPackCheckout(
    userId: string,
    packId: string,
    context: CheckoutReturnContext = {},
  ): Promise<{ url: string }> {
    const pack = ADDON_PACKS.find((p) => p.id === packId);
    if (!pack) throw ERRORS.VALIDATION_FAILED(`Unknown pack: ${packId}`);
    const config = getConfig();
    const priceCny = ALIPAY_PACK_PRICE_CNY[pack.id as AddonPackId];
    if (!priceCny) throw ERRORS.BILLING_NOT_CONFIGURED();

    // 电脑网站支付需要同步回跳(return_url)和异步通知(notify_url)两个地址。
    // 回跳只负责用户体验,入账一律等异步通知——用户关掉页面也不会丢单。
    const { successUrl } = buildCheckoutReturnUrls(env.WEB_BASE_URL, 'alipay', context);
    const notifyUrl = `${env.WEB_BASE_URL}/api/webhooks/alipay`;

    const bizContent = JSON.stringify({
      out_trade_no: newOutTradeNo(),
      product_code: 'FAST_INSTANT_TRADE_PAY',
      total_amount: priceCny.toFixed(2),
      subject: `Yujee ${pack.books} credits`,
      // 半小时内未支付自动关单,避免用户第二天用旧链接付款造成对账困惑。
      timeout_express: '30m',
      passback_params: encodeURIComponent(JSON.stringify({ ...context, userId, packId: pack.id })),
    });

    const params: Record<string, string> = {
      app_id: config.appId,
      method: 'alipay.trade.page.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: alipayTimestamp(),
      version: '1.0',
      notify_url: notifyUrl,
      return_url: successUrl,
      biz_content: bizContent,
    };

    return { url: buildSignedUrl(config.gateway, params, config.privateKey) };
  },

  /**
   * 异步通知。返回 void 表示"已受理",路由层回字面量 success;
   * 任何异常向上抛,路由层回 failure,支付宝会按自己的策略重试。
   */
  async handleWebhook(rawBody: string): Promise<void> {
    const config = getConfig();
    const params = Object.fromEntries(new URLSearchParams(rawBody));

    if (!verifyNotify(params, config.publicKey)) {
      logger.warn({ outTradeNo: params.out_trade_no }, 'alipay notify signature failed');
      throw ERRORS.WEBHOOK_SIGNATURE_INVALID();
    }
    // 验签只证明"这是支付宝发的",还要确认"发给我们这一家":app_id 必须是我们,
    // 配了 seller_id 时收款方也必须是我们。
    if (params.app_id !== config.appId) {
      logger.error({ appId: params.app_id }, 'alipay notify app_id mismatch, ignored');
      return;
    }
    if (env.ALIPAY_SELLER_ID && params.seller_id !== env.ALIPAY_SELLER_ID) {
      logger.error({ sellerId: params.seller_id }, 'alipay notify seller_id mismatch, ignored');
      return;
    }

    // 只有这两个状态代表钱已到账(TRADE_FINISHED 是不允许退款的终态)。
    // WAIT_BUYER_PAY / TRADE_CLOSED 都 ack 掉但不入账。
    if (params.trade_status !== 'TRADE_SUCCESS' && params.trade_status !== 'TRADE_FINISHED') {
      logger.info({ status: params.trade_status, outTradeNo: params.out_trade_no }, 'alipay notify non-success status, ignored');
      return;
    }

    const passback = parsePassback(params);
    const pack = ADDON_PACKS.find((p) => p.id === passback?.packId);
    if (!passback?.userId || !pack) {
      logger.error({ outTradeNo: params.out_trade_no }, 'alipay notify passback incomplete, cannot attribute order');
      return;
    }

    // 金额核对:以我们自己定的 CNY 价为准,通知里的金额只用来核对。不一致说明
    // 商品被改价或有人拿别的商品的钱来换积分——不入账,留 error 日志人工处理。
    const expected = ALIPAY_PACK_PRICE_CNY[pack.id as AddonPackId];
    const paid = Number(params.total_amount);
    if (!Number.isFinite(paid) || Math.round(paid * 100) !== expected * 100) {
      logger.error(
        { outTradeNo: params.out_trade_no, paid: params.total_amount, expected },
        'alipay notify amount mismatch, refused to credit',
      );
      return;
    }

    // trade_no 是支付宝侧的唯一交易号,重试时不变,天然适合做幂等键。
    const externalEventId = `alipay:${params.trade_no}`;
    const existing = await creditLedgerRepo.findByExternalEventId(externalEventId);
    if (existing) {
      logger.info({ tradeNo: params.trade_no }, 'alipay notify duplicate, skipped');
      return;
    }

    await db.transaction(async (tx) => {
      await creditService.applyDelta(tx, passback.userId as string, pack.books, 'PURCHASE', {
        externalEventId,
        meta: {
          provider: 'alipay',
          order_id: params.out_trade_no ?? null,
          pack_id: pack.id,
          amount_cents: Math.round(paid * 100),
          currency: 'CNY',
        },
      });
    });

    logger.info(
      { userId: passback.userId, packId: pack.id, books: pack.books, tradeNo: params.trade_no },
      'alipay purchase credited',
    );
  },
};
