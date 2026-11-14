import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alipayService } from './alipay-service';
import { AppError } from '@/lib/api/error-codes';
import { ADDON_PACKS, ALIPAY_PACK_PRICE_CNY } from '@/config/pricing';

// 这些用例刻意不配任何 ALIPAY_* env:验的是"没配好就不放行"的 fail-closed 行为,
// 以及配置之外的输入校验。真实入账链路(applyDelta + 幂等索引)已由
// credit-service 的测试覆盖,这里不重复搭 DB。

test('createPackCheckout: 未配置密钥时返回 BILLING_NOT_CONFIGURED', async () => {
  await assert.rejects(
    () => alipayService.createPackCheckout('u1', 'pack-1', { locale: 'zh' }),
    (e: unknown) => e instanceof AppError && e.code === 'BILLING_NOT_CONFIGURED',
  );
});

test('createPackCheckout: 未知 packId 先于配置检查被拒(VALIDATION_FAILED)', async () => {
  await assert.rejects(
    () => alipayService.createPackCheckout('u1', 'pack-999', { locale: 'zh' }),
    (e: unknown) => e instanceof AppError && e.code === 'VALIDATION_FAILED',
  );
});

test('handleWebhook: 未配置支付宝公钥时拒绝受理', async () => {
  await assert.rejects(
    () => alipayService.handleWebhook('trade_status=TRADE_SUCCESS'),
    (e: unknown) => e instanceof AppError && e.code === 'BILLING_NOT_CONFIGURED',
  );
});

test('CNY 价目覆盖每一档,且与美元档位同序(小到大)', () => {
  const cny = ADDON_PACKS.map((p) => ALIPAY_PACK_PRICE_CNY[p.id]);
  assert.equal(cny.length, ADDON_PACKS.length);
  assert.ok(cny.every((v) => Number.isFinite(v) && v > 0));
  assert.deepEqual([...cny].sort((a, b) => a - b), cny);
});
