'use client';

// 购买入口的错误话术收口。
//
// 后端在支付通道未配置时 fail-closed 返 503 BILLING_NOT_CONFIGURED,message 是给
// 运维看的英文（"Billing provider not configured"）。直接把它甩给用户,他会看到一句
// 看不懂的英文技术错误,还以为自己操作错了 —— 而真实情况是产品侧还没开通收款。
// 这里把 503 单独翻译成「暂不可购买」,其余错误仍用上游 message 或调用方兜底。

import type { SafeFetchError } from '@/lib/safe-fetch-json';
import { pick } from '@/lib/i18n/pick';
import type { Locale } from '@/lib/i18n/routing';

const UNCONFIGURED: { zh: string; en: string } = {
  zh: '支付通道尚未开通，暂时无法下单。开通后会在这里提示。',
  en: 'Payments aren’t enabled yet, so checkout can’t start. We’ll surface it here once it goes live.',
};

/** 503 = 通道未配置(缺密钥或未切 provider),与网络故障区分开。 */
export function checkoutErrorMessage(err: SafeFetchError, locale: Locale, fallback: string): string {
  if (err.status === 503) return pick(locale, UNCONFIGURED);
  return err.message ?? fallback;
}
