import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ImageGenError } from './types';
import { createGeminiProvider, nearestAspectRatio } from './gemini';

type Captured = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, captured?: Captured[]) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    captured?.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

const PIXEL = 'iVBORw0KGgo=';
const OK_BODY = {
  candidates: [
    { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PIXEL } }] }, finishReason: 'STOP' },
  ],
};

function provider(fetchImpl: typeof fetch) {
  return createGeminiProvider({ apiKey: 'k', fetchImpl });
}

test('成功时把 inlineData 解成字节 —— Gemini 直接回图,没有第二趟下载', async () => {
  const out = await provider(fakeFetch(200, OK_BODY)).generate({
    prompt: 'a surface', width: 1448, height: 2048,
  });
  assert.equal(out.mime, 'image/png');
  assert.deepEqual(Buffer.from(out.bytes).toString('base64'), PIXEL);
});

test('请求里声明只要图 —— 少了 responseModalities 会回一段文字而不是图', async () => {
  const captured: Captured[] = [];
  await provider(fakeFetch(200, OK_BODY, captured)).generate({
    prompt: 'a surface', width: 1448, height: 2048,
  });
  const body = JSON.parse(String(captured[0]!.init.body));
  assert.deepEqual(body.generationConfig.responseModalities, ['IMAGE']);
  assert.equal(body.contents[0].parts[0].text, 'a surface');
});

test('宽高换算成最接近的官方宽高比 —— Gemini 不收像素尺寸', async () => {
  // 794×1123 的页面比例是 0.707,夹在 2:3(0.667)和 3:4(0.75)中间,略近 2:3。
  assert.equal(nearestAspectRatio(1448, 2048), '2:3');
  assert.equal(nearestAspectRatio(1024, 1024), '1:1');
  assert.equal(nearestAspectRatio(1920, 1080), '16:9');
});

test('换算结果真的发给了上游,不是算完丢掉', async () => {
  const captured: Captured[] = [];
  await provider(fakeFetch(200, OK_BODY, captured)).generate({
    prompt: 'a', width: 1920, height: 1080,
  });
  const body = JSON.parse(String(captured[0]!.init.body));
  assert.equal(body.generationConfig.imageConfig.aspectRatio, '16:9');
});

test('api key 走 header,不拼进 URL —— URL 会进日志和错误上报', async () => {
  const captured: Captured[] = [];
  await provider(fakeFetch(200, OK_BODY, captured)).generate({ prompt: 'a', width: 1024, height: 1024 });
  assert.doesNotMatch(captured[0]!.url, /k/);
  assert.equal((captured[0]!.init.headers as Record<string, string>)['x-goog-api-key'], 'k');
});

test('被安全策略拦下时报 safety —— 这类要退积分且不计免费重生成次数', async () => {
  const err = await provider(fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } }))
    .generate({ prompt: 'x', width: 1024, height: 1024 })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ImageGenError);
  assert.equal(err.kind, 'safety');
});

test('候选以 IMAGE_SAFETY 收场也算 safety,不是「上游坏了」', async () => {
  const err = await provider(fakeFetch(200, { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }))
    .generate({ prompt: 'x', width: 1024, height: 1024 })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ImageGenError);
  assert.equal(err.kind, 'safety');
});

test('5xx 报 upstream —— 这类可以重试', async () => {
  const err = await provider(async () => new Response('bad gateway', { status: 502 }))
    .generate({ prompt: 'x', width: 1024, height: 1024 })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ImageGenError);
  assert.equal(err.kind, 'upstream');
});

test('回了内容但一个图片 part 都没有,报 empty,不返回空字节', async () => {
  const err = await provider(fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'sorry' }] } }] }))
    .generate({ prompt: 'x', width: 1024, height: 1024 })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ImageGenError);
  assert.equal(err.kind, 'empty');
});
