import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { r2 } from '../../lib/r2/r2-client';
import { analyzeUploadService } from './analyze-upload-service';

/* 建书前的中转链路(书还不存在,按 userId+sessionId 组织):
   1. 不建书、不扣分、不写库 —— 中途放弃只在 R2 留几个待过期对象。
   2. 游客上限在这层就卡住(20 张),否则这个端点就是「纯写 R2」的白嫖通道。
   3. collect 少一张就 ANALYZE_UPLOAD_INCOMPLETE —— 静默缺图会让上游拿到残缺素材。 */

const TTL_SECONDS = 30 * 60;

test('signUpload: 每次新 session,key 带 userId/sessionId,TLL 30 分钟', async (t) => {
  const calls: { key: string; contentType: string; ttl: number }[] = [];
  t.mock.method(r2, 'signPutUrl', async (key: string, contentType: string, ttl = 300) => {
    calls.push({ key, contentType, ttl });
    return 'https://put.example/signed';
  });
  const userId = randomUUID();
  const p1 = randomUUID();
  const p2 = randomUUID();

  const r1 = await analyzeUploadService.signUpload(userId, [p1, p2]);
  assert.ok(/^[0-9a-f-]{36}$/.test(r1.sessionId), 'sessionId 是 uuid');
  assert.equal(r1.uploads.length, 2);
  for (const u of r1.uploads) {
    assert.equal(u.putUrl, 'https://put.example/signed');
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.key, `analyze-uploads/${userId}/${r1.sessionId}/${p1}.jpg`, 'key 按 userId/session 组织');
  assert.equal(calls[0]!.contentType, 'image/jpeg');
  assert.equal(calls[0]!.ttl, TTL_SECONDS, '弱网 100 张也得够用,给 30 分钟');

  const r2r = await analyzeUploadService.signUpload(userId, [p1]);
  assert.notEqual(r2r.sessionId, r1.sessionId, '每次换批都是新 session');
});

test('signUpload: 游客 > 20 张被 403;恰好 20 张与正式用户 21 张都放行', async (t) => {
  t.mock.method(r2, 'signPutUrl', async () => 'https://put.example/signed');
  const userId = randomUUID();
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID());

  await assert.rejects(
    analyzeUploadService.signUpload(userId, ids(21), { isAnonymous: true }),
    (e: unknown) => (e as { code?: string }).code === 'ANON_PHOTO_LIMIT',
    '游客 21 张必须卡住',
  );
  const ok20 = await analyzeUploadService.signUpload(userId, ids(20), { isAnonymous: true });
  assert.equal(ok20.uploads.length, 20, '游客恰好 20 张放行');
  const ok21 = await analyzeUploadService.signUpload(userId, ids(21));
  assert.equal(ok21.uploads.length, 21, '正式用户不受游客上限约束');
});

test('collect: 全到齐拼 data URL;少一张抛 ANALYZE_UPLOAD_INCOMPLETE', async (t) => {
  t.mock.method(r2, 'getObject', async (key: string) => {
    // 约定:p2 没传上来 → null;其余返回非空字节。
    if (key.includes('no-such')) return null;
    return Uint8Array.from([0xff, 0xd8, 0xff]);
  });
  const userId = randomUUID();
  const sessionId = randomUUID();
  const p1 = randomUUID();
  const p2 = randomUUID();
  const meta = (photoId: string) => ({ photoId, width: 800, height: 600 });

  const ok = await analyzeUploadService.collect(userId, sessionId, [meta(p1)]);
  assert.equal(ok.length, 1);
  assert.equal(ok[0]!.base64, 'data:image/jpeg;base64,/9j/', 'data URL 前缀与 base64 正确');
  assert.equal(ok[0]!.width, 800);

  // p2 用「含 no-such 的合法 uuid」? uuid 不带字母串 —— 用 enumerate key 的方式
  // 模拟缺图:把 getObject 换成按 photoId 判定。
  t.mock.method(r2, 'getObject', async (key: string) => (key.includes(p2) ? null : Uint8Array.from([1])));
  await assert.rejects(
    analyzeUploadService.collect(userId, sessionId, [meta(p1), meta(p2)]),
    (e: unknown) => (e as { code?: string }).code === 'ANALYZE_UPLOAD_INCOMPLETE',
    '少一张必须失败,不能静默缺图',
  );
});

test('signUpload: 空数组/重复 photoId 被 VALIDATION_FAILED 拦下(route 之外不信任调用方)', async (t) => {
  t.mock.method(r2, 'signPutUrl', async () => 'https://put.example/signed');
  await assert.rejects(
    analyzeUploadService.signUpload(randomUUID(), []),
    (e: unknown) => (e as { code?: string }).code === 'VALIDATION_FAILED',
    '至少一张',
  );
  const dup = randomUUID();
  await assert.rejects(
    analyzeUploadService.signUpload(randomUUID(), [dup, dup]),
    (e: unknown) => (e as { code?: string }).code === 'VALIDATION_FAILED',
    '重复 photoId 会撞同一个 key,必须拦',
  );
});
