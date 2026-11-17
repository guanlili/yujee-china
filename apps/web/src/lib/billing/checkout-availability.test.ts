import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isProviderConfigured } from './checkout-availability';

// 生产踩过的坑:通道指向某家、而容器里那把钥匙一个都没有,于是页面照常显示「购买」,
// 用户点下去才拿到 503。这组测试锁住「缺任何一把钥匙都算未配置」这条判断 —— 现在只剩
// 支付宝一条通道,判据就是 app_id + 应用私钥 + 支付宝公钥。

function envOf(map: Record<string, string | undefined>) {
  return {
    ALIPAY_APP_ID: map.ALIPAY_APP_ID,
    ALIPAY_PRIVATE_KEY: map.ALIPAY_PRIVATE_KEY,
    ALIPAY_PUBLIC_KEY: map.ALIPAY_PUBLIC_KEY,
  };
}

test('alipay: 三把钥匙齐全才算可用', () => {
  assert.equal(isProviderConfigured('alipay', envOf({})), false);
  for (const missing of ['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY'] as const) {
    const partial: Record<string, string> = {
      ALIPAY_APP_ID: 'a',
      ALIPAY_PRIVATE_KEY: 'k',
      ALIPAY_PUBLIC_KEY: 'pub',
    };
    delete partial[missing];
    assert.equal(isProviderConfigured('alipay', envOf(partial)), false, `缺 ${missing} 应判不可用`);
  }
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
