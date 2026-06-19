import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runExportWithRetry,
  buildExportFailureLog,
  ExportError,
  MAX_EXPORT_ATTEMPTS,
} from './export-retry-util';

// WP5.3 / §4.5d 验收:① 自动重试恰好 ≤3 次(第 3 次仍失败才弹框,成功则停)
// ② 连续 3 次失败触发 onExhausted(弹框 + 日志)各一次 ③ 成功路径不弹框
// ④ 导出成功/失败均不触积分(本模块零 creditService —— 见下「无积分」断言)
// ⑤ 日志不含敏感字段(base64 / GPS / place)。

test('MAX_EXPORT_ATTEMPTS = 3(§4.5d 最多 3 次)', () => {
  assert.equal(MAX_EXPORT_ATTEMPTS, 3);
});

test('成功:第一次就成功 → attempts=1,不调 onExhausted(不弹框)', async () => {
  let attemptCount = 0;
  let exhaustedCalls = 0;
  const res = await runExportWithRetry(
    async () => { attemptCount++; /* 成功 */ },
    { onExhausted: () => { exhaustedCalls++; } },
  );
  assert.deepEqual(res, { ok: true, attempts: 1 });
  assert.equal(attemptCount, 1, '成功即停,不再重试');
  assert.equal(exhaustedCalls, 0, '成功路径绝不弹框');
});

test('成功:前 2 次失败、第 3 次成功 → 恰好试 3 次,attempts=3,不弹框', async () => {
  let attemptCount = 0;
  let exhaustedCalls = 0;
  const res = await runExportWithRetry(
    async (n) => { attemptCount++; if (n < 3) throw new Error('flaky'); },
    { onExhausted: () => { exhaustedCalls++; } },
  );
  assert.deepEqual(res, { ok: true, attempts: 3 });
  assert.equal(attemptCount, 3, '失败重试,第 3 次成功');
  assert.equal(exhaustedCalls, 0, '只要最终成功就不弹框');
});

test('失败:连续 3 次失败 → 恰好试 3 次,onExhausted 调用一次(弹框 + 日志各一次)', async () => {
  let attemptCount = 0;
  let exhaustedCalls = 0;
  let seenAttempts = -1;
  let modalShown = 0;
  let logsWritten = 0;
  const res = await runExportWithRetry(
    async () => { attemptCount++; throw new ExportError('upload', 'R2 PUT 500', 500); },
    {
      onExhausted: (_lastError, attempts) => {
        exhaustedCalls++;
        seenAttempts = attempts;
        // 调用点(EditorPort)在 onExhausted 里恰好做这两件事:落日志 + 弹框。
        logsWritten++;
        modalShown++;
      },
    },
  );
  assert.equal(res.ok, false);
  assert.equal(attemptCount, 3, '重试上限就是 3 次,不会试第 4 次');
  assert.equal(exhaustedCalls, 1, 'onExhausted 恰好一次');
  assert.equal(seenAttempts, 3);
  assert.equal(logsWritten, 1, '错误日志恰好落一次');
  assert.equal(modalShown, 1, '安抚弹框恰好弹一次');
});

test('失败:从不试超过 maxAttempts 次(默认 3)', async () => {
  let attemptCount = 0;
  await runExportWithRetry(
    async () => { attemptCount++; throw new Error('always fails'); },
    { onExhausted: () => {} },
  );
  assert.equal(attemptCount, MAX_EXPORT_ATTEMPTS);
});

test('日志脱敏:buildExportFailureLog 只含非敏感字段(无 base64 / GPS / place)', () => {
  // 负载只保留枚举/状态码/相册 id/白名单 reason,不展开原始对象,
  // 不带任何图片/坐标/地名字段。
  const err = new ExportError('upload', 'R2 PUT 403 Forbidden', 403);
  const log = buildExportFailureLog(err, { albumId: 'album-123', attempts: 3 });

  assert.equal(log.event, 'pdf_export_failed');
  assert.equal(log.albumId, 'album-123');
  assert.equal(log.phase, 'upload');
  assert.equal(log.status, 403);
  assert.equal(log.attempts, 3);
  assert.equal(log.reason, 'upload_http_403');

  // 禁区字段一律不存在(§3 隐私)。
  const keys = Object.keys(log);
  const forbidden = ['base64', 'image', 'images', 'photo', 'photos', 'dataUrl', 'gps', 'lat', 'lng', 'lon', 'place', 'location', 'exif'];
  for (const k of keys) {
    assert.ok(!forbidden.includes(k.toLowerCase()), `日志不得含敏感字段: ${k}`);
  }
});

test('日志脱敏:原始错误里的 base64 data URL 不进入结构化日志', () => {
  const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';
  const log = buildExportFailureLog(
    new ExportError('render', `canvas export failed: ${dataUrl}`),
    { albumId: 'a', attempts: 3 },
  );
  const serialized = JSON.stringify(log);

  assert.equal(log.reason, 'render_failed');
  assert.ok(!serialized.includes('data:image/jpeg;base64'), '日志不得包含 data URL');
  assert.ok(!serialized.includes('/9j/4AAQSkZJRgABAQAAAQABAAD'), '日志不得包含 base64 payload');
});

test('日志脱敏:原始错误里的 GPS/lat/lng/place/地名不进入结构化日志', () => {
  const placeName = 'Eiffel Tower';
  const log = buildExportFailureLog(
    new ExportError('upload', `upload failed GPS lat=48.8584 lng=2.2945 place=${placeName}`),
    { albumId: 'a', attempts: 3 },
  );
  const serialized = JSON.stringify(log);

  assert.equal(log.reason, 'upload_failed');
  for (const sensitive of ['GPS', 'lat', 'lng', 'place', placeName, '48.8584', '2.2945']) {
    assert.ok(!serialized.includes(sensitive), `日志不得包含原始敏感片段: ${sensitive}`);
  }
});

test('日志:render 环节失败 → phase=render,无 status', () => {
  const log = buildExportFailureLog(new ExportError('render', 'renderToBuffer failed'), { albumId: 'a', attempts: 3 });
  assert.equal(log.phase, 'render');
  assert.equal(log.reason, 'render_failed');
  assert.equal('status' in log, false, 'render 失败没有 HTTP status');
});

test('日志:非 ExportError(未知错误)→ phase=unknown,reason=unknown_error 且不记录 message', () => {
  const log = buildExportFailureLog(new Error('boom'), { albumId: 'a', attempts: 3 });
  const serialized = JSON.stringify(log);

  assert.equal(log.phase, 'unknown');
  assert.equal(log.reason, 'unknown_error');
  assert.ok(!serialized.includes('boom'), '未知错误不得记录原始 message');
});

test('不碰积分:retry/日志模块零 creditService 依赖(源码静态自证)', async () => {
  // 守门测试:本模块及其测试都**不**引用任何 creditService / cost / settle / release /
  // charge。导出成功或失败都不动积分(§5;积分早在 init 成功时已扣)。这里读自身源码做
  // 静态断言,避免日后有人在重试路径里误加扣费调用。
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const here = fileURLToPath(import.meta.url);
  const raw = readFileSync(here.replace(/\.test\.ts$/, '.ts'), 'utf8');
  // 注释里会善意提到 "creditService"(说明本模块刻意不碰积分),先剥掉注释只看真代码,
  // 避免误报 —— 我们要抓的是真实调用,不是文字说明。
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/^\s*\/\/.*$/gm, ''); // 行注释
  for (const banned of ['creditService', 'creditsService', '.settle(', '.release(', '.cost(', '.charge(']) {
    assert.ok(!code.includes(banned), `导出重试模块不得出现积分调用: ${banned}`);
  }
});
