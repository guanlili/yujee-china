import assert from 'node:assert/strict';
import { test } from 'node:test';

import { uploadAnalyzePreviews, type AnalyzeUploadDeps } from './analyze-upload';

function blob(bytes = 8): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

function photos(...ids: string[]): { photoId: string; blob: Blob }[] {
  return ids.map((photoId) => ({ photoId, blob: blob() }));
}

// 每张一个签名 URL,put 行为由调用方给的 handler 决定(默认全成功)。
function deps(
  put: AnalyzeUploadDeps['put'] = async () => {},
  sessionId = 'sess-1',
): AnalyzeUploadDeps {
  return {
    sign: async (photoIds) => ({
      sessionId,
      uploads: photoIds.map((photoId) => ({ photoId, putUrl: `https://r2.test/${photoId}` })),
    }),
    put,
  };
}

test('uploadAnalyzePreviews: 全部成功时保序返回 uploaded,failed 为空', async () => {
  const seen: string[] = [];
  const result = await uploadAnalyzePreviews({
    photos: photos('p1', 'p2', 'p3'),
    deps: deps(async (putUrl) => {
      seen.push(putUrl);
    }),
    concurrency: 1,
  });

  assert.equal(result.sessionId, 'sess-1');
  assert.deepEqual(result.uploadedPhotoIds, ['p1', 'p2', 'p3']);
  assert.deepEqual(result.failedPhotoIds, []);
  assert.deepEqual(seen, ['https://r2.test/p1', 'https://r2.test/p2', 'https://r2.test/p3']);
});

test('uploadAnalyzePreviews: 单张前两次失败、第三次成功,仍算上传成功', async () => {
  let attempts = 0;
  const result = await uploadAnalyzePreviews({
    photos: photos('p1'),
    deps: deps(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('network');
    }),
  });

  assert.equal(attempts, 3);
  assert.deepEqual(result.uploadedPhotoIds, ['p1']);
  assert.deepEqual(result.failedPhotoIds, []);
});

test('uploadAnalyzePreviews: 单张三次都失败时落进 failed,其余照常上传且不抛', async () => {
  const result = await uploadAnalyzePreviews({
    photos: photos('p1', 'bad', 'p2'),
    deps: deps(async (putUrl) => {
      if (putUrl.endsWith('/bad')) throw new Error('always fails');
    }),
    concurrency: 1,
  });

  assert.deepEqual(result.uploadedPhotoIds, ['p1', 'p2']);
  assert.deepEqual(result.failedPhotoIds, ['bad']);
});

test('uploadAnalyzePreviews: sign 失败直接抛出 —— 一张都没传,调用方必须看见', async () => {
  await assert.rejects(
    uploadAnalyzePreviews({
      photos: photos('p1'),
      deps: {
        sign: async () => {
          throw new Error('sign failed');
        },
        put: async () => {},
      },
    }),
    /sign failed/,
  );
});

test('uploadAnalyzePreviews: 进度回调分母是总张数,失败的也推进,最终走满', async () => {
  const ticks: [number, number][] = [];
  await uploadAnalyzePreviews({
    photos: photos('p1', 'bad', 'p3'),
    deps: deps(async (putUrl) => {
      if (putUrl.endsWith('/bad')) throw new Error('always fails');
    }),
    concurrency: 1,
    onProgress: (done, total) => ticks.push([done, total]),
  });

  assert.deepEqual(ticks[0], [0, 3]);
  assert.deepEqual(ticks[ticks.length - 1], [3, 3]);
});

test('uploadAnalyzePreviews: 并发不超过 concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  await uploadAnalyzePreviews({
    photos: photos('p1', 'p2', 'p3', 'p4', 'p5'),
    deps: deps(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    }),
    concurrency: 2,
  });

  assert.equal(peak, 2);
});

test('uploadAnalyzePreviews: 签名响应缺了某张时,该张记 failed 而不是静默丢', async () => {
  const result = await uploadAnalyzePreviews({
    photos: photos('p1', 'p2'),
    deps: {
      // 只签了 p1,p2 没回来 —— 服务端理论上不该这样,但绝不能当作"传成功了"。
      sign: async () => ({
        sessionId: 'sess-1',
        uploads: [{ photoId: 'p1', putUrl: 'https://r2.test/p1' }],
      }),
      put: async () => {},
    },
  });

  assert.deepEqual(result.uploadedPhotoIds, ['p1']);
  assert.deepEqual(result.failedPhotoIds, ['p2']);
});
