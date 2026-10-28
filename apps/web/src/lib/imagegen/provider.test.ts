import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveImageProvider } from './provider';

/** 用假 fetch 抓 seedream 实际发出的 Authorization 头,验证 key 的优先级。 */
async function captureAuthHeader(env: Parameters<typeof resolveImageProvider>[0]): Promise<string> {
  const originalFetch = globalThis.fetch;
  let authHeader = '';
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    if (headers?.authorization) authHeader = headers.authorization;
    return new Response(JSON.stringify({ data: [{ url: 'https://example.test/img.png' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const provider = resolveImageProvider(env);
    assert.ok(provider, 'provider should resolve with a key present');
    await provider.generate({ prompt: 'test', width: 1024, height: 1024 });
    return authHeader;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('按 IMAGE_PROVIDER 选家', () => {
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' })?.name, 'gemini');
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'ark', ARK_API_KEY: 'a' })?.name, 'ark');
});

test('选中的那家没有 key 就返回 null —— 生图入口据此关掉,而不是运行时炸', () => {
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'gemini' }), null);
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'ark' }), null);
});

test('不回落到另一家 —— 生产误配了 key 也不能悄悄把用户的图发去另一个国家', () => {
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'gemini', ARK_API_KEY: 'a' }), null);
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'ark', GEMINI_API_KEY: 'g' }), null);
});

test('ark 生图 key:ARK_IMAGE_API_KEY 优先,未配时回落 ARK_API_KEY(兼容未切换环境)', async () => {
  assert.equal(
    await captureAuthHeader({ IMAGE_PROVIDER: 'ark', ARK_IMAGE_API_KEY: 'img-key', ARK_API_KEY: 'relay-key' }),
    'Bearer img-key',
  );
  assert.equal(await captureAuthHeader({ IMAGE_PROVIDER: 'ark', ARK_API_KEY: 'relay-key' }), 'Bearer relay-key');
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'ark' }), null);
});
