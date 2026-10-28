import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendAspectRatio, createKexiangProvider, nearestRatio } from './kexiang';
import { ImageGenError } from './types';

interface CallLog {
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * 按请求次序回放响应的假 fetch,同时记录每次调用的 url/headers/body。
 * 生图链路是严格顺序的:创建 → 轮询(0..n 次) → 下载。
 */
function scriptedFetch(responses: Array<{ status?: number; json?: unknown; bytes?: Uint8Array; contentType?: string }>) {
  const calls: CallLog[] = [];
  let index = 0;
  const impl = (async (url: unknown, init?: RequestInit) => {
    const step = responses[Math.min(index, responses.length - 1)];
    index += 1;
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const body = step.bytes
      ? new Response(step.bytes as unknown as BodyInit, {
          status: step.status ?? 200,
          headers: { 'content-type': step.contentType ?? 'image/jpeg' },
        })
      : new Response(step.json === undefined ? '' : JSON.stringify(step.json), {
          status: step.status ?? 200,
          headers: { 'content-type': step.json === undefined ? 'text/plain' : 'application/json' },
        });
    return body as Response;
  }) as typeof fetch;
  return { impl, calls };
}

test('happy path:创建→轮询→下载,比例进 prompt、原始 key 走 x-api-key', async () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const { impl, calls } = scriptedFetch([
    { json: { id: 88, task_status: 'pending' } },
    { json: { id: 88, task_status: 'running' } },
    { json: { id: 88, task_status: 'success', service_output: { imgUrl: 'https://oss.example/img.png' } } },
    { bytes: pngBytes, contentType: 'image/png' },
  ]);
  const provider = createKexiangProvider({ apiKey: 'raw-key', fetchImpl: impl, pollDeadlineMs: 10_000, pollIntervalMs: 1 });

  const image = await provider.generate({ prompt: '湖边的落日', width: 1200, height: 1600 });

  assert.deepEqual(image.bytes, pngBytes);
  assert.equal(image.mime, 'image/png');

  const [create, poll1, , download] = calls;
  assert.equal(create.url.endsWith('/user_task/asyncCreateWithCost'), true);
  assert.equal(create.headers['x-api-key'], 'raw-key');
  assert.equal(create.headers.authorization, undefined);
  const userInput = (create.body as { user_input: Record<string, unknown> }).user_input;
  assert.equal(userInput.modelName, 'SeeDream4.5');
  assert.equal(userInput.watermark, false);
  assert.equal(userInput.size, '2K');
  assert.match(String(userInput.prompt), /湖边的落日。画面比例 3:4$/);
  assert.equal(poll1.url.endsWith('/user_task/get/passAuth/88'), true);
  assert.equal(download.url, 'https://oss.example/img.png');
});

test('任务失败:failReason 命中安全词 → safety;其他 → upstream', async () => {
  const safety = scriptedFetch([
    { json: { id: 1 } },
    { json: { task_status: 'failed', service_output: { failReason: '内容涉嫌违规' } } },
  ]);
  await assert.rejects(
    createKexiangProvider({ apiKey: 'k', fetchImpl: safety.impl }).generate({ prompt: 'p', width: 100, height: 100 }),
    (e: unknown) => e instanceof ImageGenError && e.kind === 'safety',
  );

  const upstream = scriptedFetch([
    { json: { id: 2 } },
    { json: { task_status: 'failed', service_output: { failReason: 'upstream timeout' } } },
  ]);
  await assert.rejects(
    createKexiangProvider({ apiKey: 'k', fetchImpl: upstream.impl }).generate({ prompt: 'p', width: 100, height: 100 }),
    (e: unknown) => e instanceof ImageGenError && e.kind === 'upstream',
  );
});

test('success 却没有图 → empty;轮询超时 → upstream', async () => {
  const empty = scriptedFetch([{ json: { id: 1 } }, { json: { task_status: 'success', service_output: {} } }]);
  await assert.rejects(
    createKexiangProvider({ apiKey: 'k', fetchImpl: empty.impl }).generate({ prompt: 'p', width: 100, height: 100 }),
    (e: unknown) => e instanceof ImageGenError && e.kind === 'empty',
  );

  const stuck = scriptedFetch([{ json: { id: 1 } }, { json: { task_status: 'running' } }]);
  await assert.rejects(
    createKexiangProvider({ apiKey: 'k', fetchImpl: stuck.impl, pollDeadlineMs: 0 }).generate({
      prompt: 'p',
      width: 100,
      height: 100,
    }),
    (e: unknown) => e instanceof ImageGenError && e.kind === 'upstream' && /deadline/.test(e.message),
  );
});

test('创建 HTTP 400(余额不足/鉴权类)→ upstream,消息透传', async () => {
  const { impl } = scriptedFetch([{ status: 400, json: { code: 400, msg: '余额不足' } }]);
  await assert.rejects(
    createKexiangProvider({ apiKey: 'k', fetchImpl: impl }).generate({ prompt: 'p', width: 100, height: 100 }),
    (e: unknown) => e instanceof ImageGenError && e.kind === 'upstream' && /余额不足/.test(e.message),
  );
});

test('nearestRatio:可归约用精确比,离谱大数贴常用比', () => {
  assert.equal(nearestRatio(1200, 1600), '3:4');
  assert.equal(nearestRatio(1600, 1200), '4:3');
  assert.equal(nearestRatio(1000, 1000), '1:1');
  assert.equal(nearestRatio(1667, 2500), '2:3');
  assert.equal(nearestRatio(1920, 1080), '16:9');
  assert.equal(appendAspectRatio('落日', 1200, 1600), '落日。画面比例 3:4');
});
