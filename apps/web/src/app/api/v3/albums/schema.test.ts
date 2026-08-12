import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BodySchema, RetryBodySchema } from './schema';

const SESSION = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const REQUEST_ID = '9f1c2f3e-0000-4000-8000-000000000001';
// 4 字节 JPEG 的 data URL,够过 V3AnalyzeImageDataUrl 的形状与体积校验。
const DATA_URL = `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`;

function photo(photoId: string, extra: Record<string, unknown> = {}) {
  return { photoId, width: 800, height: 600, ...extra };
}

function body(extra: Record<string, unknown>) {
  return { requestId: REQUEST_ID, language: 'zh', ...extra };
}

test('BodySchema(新式): 带 uploadSessionId、照片不带 base64 —— 通过', () => {
  const parsed = BodySchema.safeParse(
    body({ uploadSessionId: SESSION, photos: [photo('p1'), photo('p2')] }),
  );
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test('BodySchema(旧式过渡): 无 uploadSessionId、每张都带 base64 —— 仍然通过', () => {
  const parsed = BodySchema.safeParse(
    body({ photos: [photo('p1', { base64: DATA_URL }), photo('p2', { base64: DATA_URL })] }),
  );
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test('BodySchema: 既没有 uploadSessionId 也没有 base64 —— 拒', () => {
  const parsed = BodySchema.safeParse(body({ photos: [photo('p1')] }));
  assert.equal(parsed.success, false);
});

test('BodySchema: 旧式但只有一部分照片带 base64 —— 拒,不允许半截 body', () => {
  const parsed = BodySchema.safeParse(
    body({ photos: [photo('p1', { base64: DATA_URL }), photo('p2')] }),
  );
  assert.equal(parsed.success, false);
});

test('BodySchema: 两种模式混用(带 uploadSessionId 又内联 base64)—— 拒', () => {
  const parsed = BodySchema.safeParse(
    body({ uploadSessionId: SESSION, photos: [photo('p1', { base64: DATA_URL })] }),
  );
  assert.equal(parsed.success, false);
});

test('BodySchema: uploadSessionId 形状非法 —— 拒(它是 R2 key 的一段)', () => {
  const parsed = BodySchema.safeParse(
    body({ uploadSessionId: '../other-user', photos: [photo('p1')] }),
  );
  assert.equal(parsed.success, false);
});

test('BodySchema: 新式仍然拒绝重复 photoId', () => {
  const parsed = BodySchema.safeParse(
    body({ uploadSessionId: SESSION, photos: [photo('p1'), photo('p1')] }),
  );
  assert.equal(parsed.success, false);
});

test('BodySchema: 新式照片对象仍是 strict,塞坐标类字段直接拒', () => {
  const parsed = BodySchema.safeParse(
    body({ uploadSessionId: SESSION, photos: [photo('p1', { lat: 31.2, lng: 121.4 })] }),
  );
  assert.equal(parsed.success, false);
});

// /retry 这一期不改:它仍然把全书照片内联重发。给它单独一份严格 schema,免得
// 建书那份为了直传放开的 optional base64 顺带把 retry 的入参也放松了。
test('RetryBodySchema: 每张都带 base64 —— 通过', () => {
  const parsed = RetryBodySchema.safeParse(
    body({ photos: [photo('p1', { base64: DATA_URL })] }),
  );
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test('RetryBodySchema: 缺 base64 —— 拒(retry 尚未支持直传)', () => {
  const parsed = RetryBodySchema.safeParse(body({ photos: [photo('p1')] }));
  assert.equal(parsed.success, false);
});

test('RetryBodySchema: 带 uploadSessionId —— 拒(strict,别让人以为 retry 支持直传)', () => {
  const parsed = RetryBodySchema.safeParse(
    body({ uploadSessionId: SESSION, photos: [photo('p1', { base64: DATA_URL })] }),
  );
  assert.equal(parsed.success, false);
});
