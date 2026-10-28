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

/** kexiang 任务 API 用 x-api-key **原始 key**(无 Bearer、无 sk-),抓它发出的头。 */
async function captureXApiKeyHeader(env: Parameters<typeof resolveImageProvider>[0]): Promise<string> {
  const originalFetch = globalThis.fetch;
  let header = '';
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers['x-api-key']) header = headers['x-api-key'];
    const path = String(url);
    if (path.includes('asyncCreateWithCost')) {
      return new Response(JSON.stringify({ id: 1, task_status: 'pending' }), { status: 200 });
    }
    if (path.includes('passAuth')) {
      return new Response(
        JSON.stringify({ task_status: 'success', service_output: { imgUrl: 'https://example.test/i.png' } }),
        { status: 200 },
      );
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
  try {
    const provider = resolveImageProvider(env);
    assert.ok(provider, 'provider should resolve with a key present');
    await provider.generate({ prompt: 'test', width: 1024, height: 1024 });
    return header;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('kexiang 生图:复用 ARK_API_KEY 并剥 sk- 前缀;KEXIANG_API_KEY 优先', async () => {
  assert.equal(await captureXApiKeyHeader({ IMAGE_PROVIDER: 'kexiang', ARK_API_KEY: 'sk-relay' }), 'relay');
  assert.equal(
    await captureXApiKeyHeader({ IMAGE_PROVIDER: 'kexiang', KEXIANG_API_KEY: 'dedicated', ARK_API_KEY: 'sk-relay' }),
    'dedicated',
  );
});

test('kexiang 没有任何 key → null;不回落到别家 key', () => {
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'kexiang', GEMINI_API_KEY: 'g' }), null);
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'kexiang', ARK_IMAGE_API_KEY: 'volcano' }), null);
});
