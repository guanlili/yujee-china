// 购买入口是否可用 —— 服务端判定,结果传给客户端决定「显示购买按钮 / 显示未开通」。
//
// 背景:checkout 是 fail-closed 的 —— 缺密钥就 503。但页面还照常渲染价格和购买按钮,
// 用户点下去才拿到一句错误。对用户来说这叫「坏了的按钮」,不叫「暂未开通」。
//
// 判定口径:provider 指谁,就查谁那把钥匙(支付宝要 app_id + 私钥 + 支付宝公钥),
// 外加人民币价目 —— 价格没配同样走不通,所以一起算进「可用」。

import { env } from '@/lib/env';
import { ACTIVE_CHECKOUT_PROVIDER, type CheckoutProvider } from '@/config/pricing';

function hasAll(values: Array<string | undefined>): boolean {
  return values.every((v) => typeof v === 'string' && v.trim().length > 0);
}

/** 单个 provider 的凭据是否齐备(纯函数,便于测试)。 */
export function isProviderConfigured(
  provider: CheckoutProvider,
  e: Pick<
    typeof env,
    | 'ALIPAY_APP_ID'
    | 'ALIPAY_PRIVATE_KEY'
    | 'ALIPAY_PUBLIC_KEY'
  >,
): boolean {
  switch (provider) {
    case 'alipay':
      return hasAll([e.ALIPAY_APP_ID, e.ALIPAY_PRIVATE_KEY, e.ALIPAY_PUBLIC_KEY]);
    default:
      return false;
  }
}

/** 当前 provider 的凭据是否齐备。false = 不该给用户展示可点的购买入口。 */
export function isCheckoutConfigured(): boolean {
  return isProviderConfigured(ACTIVE_CHECKOUT_PROVIDER as CheckoutProvider, env);
}
