import assert from 'node:assert/strict';
import { test } from 'node:test';
import { putSnapshotBlob, RequestTimeoutError } from './photo-snapshot-client';

// 挂住的形态:fetch 永不 settle。"上传偶发挂住"就是这种 —— 4 并发 worker + Promise.all,
// 只要一张 PUT 挂在 TCP 上,整轮永不结束,界面上"保存中"一直转。
test('putSnapshotBlob rejects instead of hanging when the PUT never settles', async (t) => {
  t.mock.method(globalThis, 'fetch', (() => new Promise(() => {})) as typeof fetch);
  const started = Date.now();
  await assert.rejects(
    () => putSnapshotBlob('https://put.test/hang', new Blob(['x']), { timeoutMs: 40, retries: 0 }),
    (error: unknown) => {
      assert.ok(error instanceof RequestTimeoutError, 'should surface as RequestTimeoutError');
      assert.equal((error as RequestTimeoutError).timeoutMs, 40);
      return true;
    },
  );
  assert.ok(Date.now() - started < 2_000, 'timeout must fire on its own timer');
});

test('putSnapshotBlob retries once after a timeout and succeeds', async (t) => {
  let call = 0;
  t.mock.method(globalThis, 'fetch', (async () => {
    call += 1;
    if (call === 1) return await new Promise(() => {}); // 第一次挂住
    return new Response('', { status: 200 });
  }) as typeof fetch);
  await putSnapshotBlob('https://put.test/retry', new Blob(['x']), { timeoutMs: 40, retries: 1 });
  assert.equal(call, 2, 'should have retried exactly once');
});

test('putSnapshotBlob does not retry on 4xx (expired signature is not transient)', async (t) => {
  let call = 0;
  t.mock.method(globalThis, 'fetch', (async () => {
    call += 1;
    return new Response('', { status: 403 });
  }) as typeof fetch);
  await assert.rejects(
    () => putSnapshotBlob('https://put.test/expired', new Blob(['x']), { timeoutMs: 40, retries: 1 }),
    /403/,
  );
  assert.equal(call, 1, '4xx must not be retried');
});
