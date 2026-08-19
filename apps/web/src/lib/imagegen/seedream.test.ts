import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSeedreamProvider } from './seedream';
import { ImageGenError } from './types';

type Captured = { url: string; init: RequestInit };

const IMAGE_URL = 'https://tos.example/img.jpeg';
const PIXELS = new Uint8Array([1, 2, 3, 4]);

const OK_BODY = {
  model: 'doubao-seedream-4-0-250828',
  data: [{ url: IMAGE_URL, size: '1448x2048' }],
  usage: { generated_images: 1, output_tokens: 11584 },
};

/** 生图返回 JSON,图片 URL 返回字节 —— 一个 fake 同时扮演这两跳。 */
function fakeFetch(apiStatus: number, apiBody: unknown, captured?: Captured[], imageStatus = 200) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    captured?.push({ url: href, init: init ?? {} });
    if (href === IMAGE_URL) {
      return new Response(imageStatus === 200 ? PIXELS : 'nope', { status: imageStatus });
    }
    return new Response(JSON.stringify(apiBody), {
      status: apiStatus,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function provider(fetchImpl: typeof fetch) {
  return createSeedreamProvider({ apiKey: 'ark-test', fetchImpl });
}

test('出图后把图片字节取回来 —— Ark 只给 URL,provider 负责下载', async () => {
  const out = await provider(fakeFetch(200, OK_BODY)).generate({
    prompt: 'a surface', width: 1448, height: 2048,
  });
  assert.deepEqual(Array.from(out.bytes), Array.from(PIXELS));
  assert.equal(out.mime, 'image/jpeg');
  assert.equal(out.outputTokens, 11584);
});

test('回报上游实际出图的尺寸 —— 抬过像素下限之后就不等于我们请求的那个了', async () => {
  const out = await provider(fakeFetch(200, OK_BODY)).generate({
    prompt: 'a', width: 212, height: 402,
  });
  // OK_BODY 里 Ark 回的 size 是 1448x2048,不是请求的 212x402。
  assert.equal(out.width, 1448);
  assert.equal(out.height, 2048);
});

test('关掉水印 —— 带水印的图印进用户的书里就废了', async () => {
  const captured: Captured[] = [];
  await provider(fakeFetch(200, OK_BODY, captured)).generate({
    prompt: 'a surface', width: 1448, height: 2048,
  });
  const body = JSON.parse(String(captured[0]!.init.body));
  assert.equal(body.watermark, false);
  assert.equal(body.size, '1448x2048');
  assert.equal(body.prompt, 'a surface');
});

test('尺寸低于 Ark 的像素下限时抬到下限 —— 实测低于 921600 直接 InvalidParameter', async () => {
  const captured: Captured[] = [];
  await provider(fakeFetch(200, OK_BODY, captured)).generate({ prompt: 'a', width: 212, height: 402 });
  const body = JSON.parse(String(captured[0]!.init.body));
  const [w, h] = String(body.size).split('x').map(Number);
  assert.ok(w! * h! >= 921600, `${body.size} 低于下限`);
  assert.ok(Math.abs(w! / h! - 212 / 402) < 0.02, '抬尺寸时把宽高比改坏了');
});

test('内容安全类错误报 safety,不跟上游故障混为一谈', async () => {
  const err = await provider(fakeFetch(400, { error: { code: 'SensitiveContentDetected', message: 'nope' } }))
    .generate({ prompt: 'x', width: 1448, height: 2048 })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ImageGenError);
  assert.equal(err.kind, 'safety');
});

test('其余上游错误报 upstream', async () => {
  const err = await provider(fakeFetch(404, { error: { code: 'InvalidEndpointOrModel.NotFound', message: 'x' } }))
    .generate({ prompt: 'x', width: 1448, height: 2048 })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ImageGenError);
  assert.equal(err.kind, 'upstream');
});

test('图片下载失败也算 upstream —— 别把半张图当成功', async () => {
  const err = await provider(fakeFetch(200, OK_BODY, undefined, 503))
    .generate({ prompt: 'x', width: 1448, height: 2048 })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ImageGenError);
  assert.equal(err.kind, 'upstream');
});

test('响应里没有图片时报 empty', async () => {
  const err = await provider(fakeFetch(200, { data: [] }))
    .generate({ prompt: 'x', width: 1448, height: 2048 })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ImageGenError);
  assert.equal(err.kind, 'empty');
});
