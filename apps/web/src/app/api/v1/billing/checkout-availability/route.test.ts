// GET /api/v1/billing/checkout-availability —— 只给一个布尔,不能漏出别的。
//
// 这个接口对匿名访客开放(购买入口要在未登录的首页/定价区也能正常禁用),所以它
// 返回的字段必须经得起公开:provider 名、缺哪把钥匙、密钥片段,一个都不能有。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GET, dynamic } from './route';

test('返回体只有 enabled 一个布尔字段,不泄露 provider 或密钥', async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);

  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ['enabled'], '字段多了就可能泄露判定细节');
  assert.equal(typeof body.enabled, 'boolean');
});

test('不缓存 —— 凭据是部署期常量,但换了 env 不该继续返回旧值', () => {
  assert.equal(dynamic, 'force-dynamic');
});
