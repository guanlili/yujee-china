import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isProviderConfigured } from './checkout-availability';

// 生产踩过的坑:ACTIVE_CHECKOUT_PROVIDER 指向 waffo,而容器里一个 WAFFO_* 都没有。
// checkout 是 fail-closed 的,于是页面照常显示「购买」,用户点下去才拿到 503。
// 这组测试锁住「缺任何一把钥匙都算未配置」这条判断。

const WAFFO_KEYS = ['WAFFO_MERCHANT_ID', 'WAFFO_STORE_ID', 'WAFFO_PRIVATE_KEY'] as const;

function envOf(map: Record<string, string | undefined>) {
  return {
    WAFFO_MERCHANT_ID: map.WAFFO_MERCHANT_ID,
    WAFFO_STORE_ID: map.WAFFO_STORE_ID,
    WAFFO_PRIVATE_KEY: map.WAFFO_PRIVATE_KEY,
    CREEM_API_KEY: map.CREEM_API_KEY,
    CREEM_PRODUCT_ID_PACK_1: map.CREEM_PRODUCT_ID_PACK_1,
    ALIPAY_APP_ID: map.ALIPAY_APP_ID,
    ALIPAY_PRIVATE_KEY: map.ALIPAY_PRIVATE_KEY,
    ALIPAY_PUBLIC_KEY: map.ALIPAY_PUBLIC_KEY,
  };
}

test('waffo: 三把钥匙齐全才算可用', () => {
  assert.equal(isProviderConfigured('waffo', envOf({})), false);
  for (const missing of WAFFO_KEYS) {
    const partial: Record<string, string> = {
      WAFFO_MERCHANT_ID: 'm',
      WAFFO_STORE_ID: 's',
      WAFFO_PRIVATE_KEY: 'k',
    };
    delete partial[missing];
    assert.equal(isProviderConfigured('waffo', envOf(partial)), false, `缺 ${missing} 应判不可用`);
  }
  assert.equal(
    isProviderConfigured(
      'waffo',
      envOf({ WAFFO_MERCHANT_ID: 'm', WAFFO_STORE_ID: 's', WAFFO_PRIVATE_KEY: 'k' }),
    ),
    true,
  );
});

test('creem: API key 与 product id 都要有', () => {
  assert.equal(isProviderConfigured('creem', envOf({})), false);
  assert.equal(isProviderConfigured('creem', envOf({ CREEM_API_KEY: 'k' })), false);
  assert.equal(isProviderConfigured('creem', envOf({ CREEM_PRODUCT_ID_PACK_1: 'p' })), false);
  assert.equal(
    isProviderConfigured('creem', envOf({ CREEM_API_KEY: 'k', CREEM_PRODUCT_ID_PACK_1: 'p' })),
    true,
  );
});

test('alipay: 应用私钥与支付宝公钥缺一不可', () => {
  assert.equal(isProviderConfigured('alipay', envOf({})), false);
  assert.equal(isProviderConfigured('alipay', envOf({ ALIPAY_APP_ID: 'a' })), false);
  assert.equal(
    isProviderConfigured('alipay', envOf({ ALIPAY_APP_ID: 'a', ALIPAY_PRIVATE_KEY: 'k' })),
    false,
  );
  assert.equal(
    isProviderConfigured(
      'alipay',
      envOf({ ALIPAY_APP_ID: 'a', ALIPAY_PRIVATE_KEY: 'k', ALIPAY_PUBLIC_KEY: 'pub' }),
    ),
    true,
  );
});

test('空白字符串等于没配(防止只填了占位)', () => {
  assert.equal(
    isProviderConfigured(
      'alipay',
      envOf({ ALIPAY_APP_ID: 'a', ALIPAY_PRIVATE_KEY: '   ', ALIPAY_PUBLIC_KEY: 'pub' }),
    ),
    false,
  );
});
