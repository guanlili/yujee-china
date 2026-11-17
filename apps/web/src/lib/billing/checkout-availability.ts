// 购买入口是否可用 —— 服务端判定,结果传给客户端决定「显示购买按钮 / 显示未开通」。
//
// 背景:checkout 是 fail-closed 的 —— 缺密钥就 503。但页面还照常渲染价格和购买按钮,
// 用户点下去才拿到一句错误。生产就是这个状态:ACTIVE_CHECKOUT_PROVIDER 指向 waffo,
// 而容器里一个 WAFFO_* 变量都没有。对用户来说这叫「坏了的按钮」,不叫「暂未开通」。
//
// 判定口径:provider 指谁,就查谁那把钥匙。产品 id 也查 —— Waffo/Creem 的价格是
// 后台配置的 product,缺了同样走不通(会拿不到 checkout URL)。

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
    | 'WAFFO_MERCHANT_ID'
    | 'WAFFO_STORE_ID'
    | 'WAFFO_PRIVATE_KEY'
    | 'CREEM_API_KEY'
    | 'CREEM_PRODUCT_ID_PACK_1'
    | 'ALIPAY_APP_ID'
    | 'ALIPAY_PRIVATE_KEY'
    | 'ALIPAY_PUBLIC_KEY'
  >,
): boolean {
  switch (provider) {
    case 'waffo':
      return hasAll([e.WAFFO_MERCHANT_ID, e.WAFFO_STORE_ID, e.WAFFO_PRIVATE_KEY]);
    case 'creem':
      return hasAll([e.CREEM_API_KEY, e.CREEM_PRODUCT_ID_PACK_1]);
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
