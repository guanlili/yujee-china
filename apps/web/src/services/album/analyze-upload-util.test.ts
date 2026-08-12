import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ANALYZE_UPLOAD_CONTENT_TYPE,
  AnalyzeUploadSignBodySchema,
  analyzeUploadKey,
  ANALYZE_UPLOAD_MAX_BYTES,
  assembleAnalyzePhotos,
  isValidUploadSessionId,
  newUploadSessionId,
} from './analyze-upload-util';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';

const SESSION = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

// 三个 0xFF 字节 → base64 '////'。用可辨认的字节,断言才真的在看内容。
function bytesFor(photoId: string): Uint8Array {
  return new Uint8Array(Buffer.from(`bytes-of-${photoId}`, 'utf8'));
}

function expectedDataUrl(photoId: string): string {
  return `data:image/jpeg;base64,${Buffer.from(`bytes-of-${photoId}`, 'utf8').toString('base64')}`;
}

function fetchFromMap(map: Map<string, Uint8Array>) {
  return async (key: string) => map.get(key) ?? null;
}

function objectMap(...photoIds: string[]): Map<string, Uint8Array> {
  return new Map(photoIds.map((id) => [analyzeUploadKey('user-1', SESSION, id), bytesFor(id)]));
}

test('analyzeUploadKey: 按 userId/sessionId/photoId 三段命名,内容类型是 JPEG', () => {
  assert.equal(
    analyzeUploadKey('user-1', SESSION, 'p1'),
    `analyze-uploads/user-1/${SESSION}/p1.jpg`,
  );
  assert.equal(ANALYZE_UPLOAD_CONTENT_TYPE, 'image/jpeg');
});

test('analyzeUploadKey: photoId 路径穿越被挡在 key 之外', () => {
  assert.throws(() => analyzeUploadKey('user-1', SESSION, '../../etc/passwd'), /invalid photoId/);
  assert.throws(() => analyzeUploadKey('user-1', SESSION, 'a/b'), /invalid photoId/);
});

test('analyzeUploadKey: sessionId 形状不合法直接拒绝 —— 客户端回传的值不可信', () => {
  assert.throws(() => analyzeUploadKey('user-1', '../other-user', 'p1'), /invalid uploadSessionId/);
  assert.throws(() => analyzeUploadKey('user-1', 'not-a-uuid', 'p1'), /invalid uploadSessionId/);
});

test('isValidUploadSessionId: 只认 uuid 形状', () => {
  assert.equal(isValidUploadSessionId(SESSION), true);
  assert.equal(isValidUploadSessionId('abc'), false);
  assert.equal(isValidUploadSessionId(''), false);
  assert.equal(isValidUploadSessionId(undefined), false);
});

test('newUploadSessionId: 服务端自己发,形状自洽且不重复', () => {
  const a = newUploadSessionId();
  const b = newUploadSessionId();
  assert.equal(isValidUploadSessionId(a), true);
  assert.notEqual(a, b);
});

test('AnalyzeUploadSignBodySchema: 接受合法列表,拒绝空/超上限/重复/非法 id', () => {
  assert.equal(AnalyzeUploadSignBodySchema.safeParse({ photoIds: ['p1', 'p2'] }).success, true);
  assert.equal(AnalyzeUploadSignBodySchema.safeParse({ photoIds: [] }).success, false);
  assert.equal(AnalyzeUploadSignBodySchema.safeParse({ photoIds: ['p1', 'p1'] }).success, false);
  assert.equal(AnalyzeUploadSignBodySchema.safeParse({ photoIds: ['../bad'] }).success, false);
  assert.equal(
    AnalyzeUploadSignBodySchema.safeParse({
      photoIds: Array.from({ length: MAX_PHOTOS_PER_GENERATION + 1 }, (_, i) => `p${i}`),
    }).success,
    false,
  );
});

test('AnalyzeUploadSignBodySchema: 上限就是 MAX_PHOTOS_PER_GENERATION,不多不少', () => {
  assert.equal(
    AnalyzeUploadSignBodySchema.safeParse({
      photoIds: Array.from({ length: MAX_PHOTOS_PER_GENERATION }, (_, i) => `p${i}`),
    }).success,
    true,
  );
});

test('AnalyzeUploadSignBodySchema: strict —— 多带字段直接拒', () => {
  assert.equal(
    AnalyzeUploadSignBodySchema.safeParse({ photoIds: ['p1'], sessionId: SESSION }).success,
    false,
  );
});

test('assembleAnalyzePhotos: 按输入顺序回填 JPEG data URL', async () => {
  const photos = await assembleAnalyzePhotos({
    userId: 'user-1',
    sessionId: SESSION,
    photos: [
      { photoId: 'p1', width: 800, height: 600 },
      { photoId: 'p2', width: 600, height: 800 },
    ],
    fetchObject: fetchFromMap(objectMap('p1', 'p2')),
  });

  assert.deepEqual(
    photos.map((p) => p.photoId),
    ['p1', 'p2'],
  );
  assert.equal(photos[0]!.base64, expectedDataUrl('p1'));
  assert.equal(photos[1]!.base64, expectedDataUrl('p2'));
  assert.equal(photos[0]!.width, 800);
  assert.equal(photos[1]!.height, 800);
});

test('assembleAnalyzePhotos: takenAt / clusterId 原样透传,未给就不出现在结果里', async () => {
  const photos = await assembleAnalyzePhotos({
    userId: 'user-1',
    sessionId: SESSION,
    photos: [
      { photoId: 'p1', width: 800, height: 600, takenAt: '2026-08-10T12:00:00Z', clusterId: 'c1' },
      { photoId: 'p2', width: 800, height: 600 },
    ],
    fetchObject: fetchFromMap(objectMap('p1', 'p2')),
  });

  assert.equal(photos[0]!.takenAt, '2026-08-10T12:00:00Z');
  assert.equal(photos[0]!.clusterId, 'c1');
  assert.equal('takenAt' in photos[1]!, false);
  assert.equal('clusterId' in photos[1]!, false);
});

test('assembleAnalyzePhotos: 有照片没落到 R2 时抛 ANALYZE_UPLOAD_INCOMPLETE,只报个数不报 id', async () => {
  await assert.rejects(
    assembleAnalyzePhotos({
      userId: 'user-1',
      sessionId: SESSION,
      photos: [
        { photoId: 'p1', width: 800, height: 600 },
        { photoId: 'p2', width: 800, height: 600 },
        { photoId: 'p3', width: 800, height: 600 },
      ],
      // p2/p3 没传上来
      fetchObject: fetchFromMap(objectMap('p1')),
    }),
    (e: { code?: string; status?: number; message?: string }) => {
      assert.equal(e.code, 'ANALYZE_UPLOAD_INCOMPLETE');
      assert.equal(e.status, 409);
      assert.equal(e.message, '2');
      return true;
    },
  );
});

test('assembleAnalyzePhotos: 并发不超过 concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const map = objectMap('p1', 'p2', 'p3', 'p4', 'p5');
  await assembleAnalyzePhotos({
    userId: 'user-1',
    sessionId: SESSION,
    photos: ['p1', 'p2', 'p3', 'p4', 'p5'].map((photoId) => ({ photoId, width: 8, height: 8 })),
    concurrency: 2,
    fetchObject: async (key) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return map.get(key) ?? null;
    },
  });

  assert.equal(peak, 2);
});

test('assembleAnalyzePhotos: 单张超过 800KB 直接拒 —— 与旧内联路径的 V3AnalyzeImageDataUrl 同一道闸', async () => {
  const oversized = new Uint8Array(ANALYZE_UPLOAD_MAX_BYTES + 1);
  await assert.rejects(
    assembleAnalyzePhotos({
      userId: 'user-1',
      sessionId: SESSION,
      photos: [{ photoId: 'p1', width: 800, height: 600 }],
      fetchObject: async () => oversized,
    }),
    (e: { code?: string; status?: number }) => {
      assert.equal(e.code, 'PHOTO_TOO_LARGE');
      assert.equal(e.status, 413);
      return true;
    },
  );
});

test('assembleAnalyzePhotos: 正好 800KB 放行(边界不是排他的)', async () => {
  const photos = await assembleAnalyzePhotos({
    userId: 'user-1',
    sessionId: SESSION,
    photos: [{ photoId: 'p1', width: 800, height: 600 }],
    fetchObject: async () => new Uint8Array(ANALYZE_UPLOAD_MAX_BYTES),
  });
  assert.equal(photos.length, 1);
});

test('assembleAnalyzePhotos: 读 R2 抛「非缺失」错误时原样上抛,不伪装成缺图', async () => {
  const boom = Object.assign(new Error('R2 is down'), { name: 'ServiceUnavailable' });
  await assert.rejects(
    assembleAnalyzePhotos({
      userId: 'user-1',
      sessionId: SESSION,
      photos: [{ photoId: 'p1', width: 800, height: 600 }],
      fetchObject: async () => {
        throw boom;
      },
    }),
    /R2 is down/,
  );
});
