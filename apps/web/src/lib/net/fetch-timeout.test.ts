import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeadlineError, isTimeoutError, withDeadline } from './fetch-timeout';

// 这些工具是 2026-11-09 导出卡死事故的产物:请求挂住时,上层永远不会进入失败分支。
// 这里只测纯逻辑(不碰真实网络),保证「到点一定变成可捕获的失败」。

test('withDeadline 到点 reject 成 DeadlineError', async () => {
  const never = new Promise<void>(() => {});
  await assert.rejects(withDeadline(never, 20, 'slowThing'), (e: unknown) => {
    assert.ok(e instanceof DeadlineError);
    assert.equal(e.label, 'slowThing');
    return true;
  });
});

test('withDeadline 按期返回时不改变结果', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), 500, 'fast'), 'ok');
});

test('withDeadline 原 promise 失败时原样透传错误', async () => {
  const boom = new Error('boom');
  await assert.rejects(withDeadline(Promise.reject(boom), 500, 'fail'), (e: unknown) => e === boom);
});

test('isTimeoutError 同时认 DeadlineError 与 AbortError', () => {
  assert.equal(isTimeoutError(new DeadlineError('x', 1)), true);
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assert.equal(isTimeoutError(abort), true);
  assert.equal(isTimeoutError(new Error('nope')), false);
});
