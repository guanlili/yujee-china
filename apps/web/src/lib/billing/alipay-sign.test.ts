import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  alipayTimestamp,
  buildSignedUrl,
  canonicalString,
  signParams,
  verifyNotify,
} from './alipay-sign';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

test('canonicalString: 剔除 sign/sign_type,其余按字典序拼接', () => {
  assert.equal(
    canonicalString({ b: '2', sign: 'x', sign_type: 'RSA2', a: '1' }),
    'a=1&b=2',
  );
});

test('签名与验签闭环:同一组参数签出来能验证通过', () => {
  const params = { app_id: '2021000000', method: 'alipay.trade.page.pay', biz_content: '{"a":1}' };
  const sign = signParams(params, privateKey);
  assert.ok(sign.length > 0);
  assert.equal(verifyNotify({ ...params, sign }, publicKey), true);
});

test('验签:参数被篡改、缺 sign、公钥不对都必须拒绝', () => {
  const params = { out_trade_no: 'yj1', total_amount: '19.00' };
  const sign = signParams(params, privateKey);

  assert.equal(verifyNotify({ ...params, total_amount: '0.01', sign }, publicKey), false, '金额被改');
  assert.equal(verifyNotify({ ...params }, publicKey), false, '缺 sign');
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
    type: 'spki',
    format: 'pem',
  }) as string;
  assert.equal(verifyNotify({ ...params, sign }, other), false, '换了一把公钥');
});

test('buildSignedUrl: 参数全在 query 里,且带 sign 与 sign_type', () => {
  const url = buildSignedUrl(
    'https://openapi.alipay.com/gateway.do',
    { app_id: '2021000000', charset: 'utf-8', sign_type: 'RSA2', biz_content: '{}' },
    privateKey,
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('app_id'), '2021000000');
  assert.equal(parsed.searchParams.get('sign_type'), 'RSA2');
  assert.ok((parsed.searchParams.get('sign') ?? '').length > 0);

  // 把 query 读回来(不含 sign)重新验签,确保 URL 里拼的就是被签名的那组参数。
  const back: Record<string, string> = {};
  for (const [k, v] of parsed.searchParams) back[k] = v;
  assert.equal(verifyNotify(back, publicKey), true);
});

test('alipayTimestamp: 输出北京时间 YYYY-MM-DD HH:mm:ss', () => {
  // 2026-01-01T16:30:00Z = 北京时间 2026-01-02 00:30:00
  assert.equal(alipayTimestamp(new Date('2026-01-01T16:30:00Z')), '2026-01-02 00:30:00');
});
