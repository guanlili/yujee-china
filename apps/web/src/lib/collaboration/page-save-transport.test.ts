import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFetchPageSaveTransport } from './page-save-transport';

// 用假 fetch 驱动真实传输层,锁死响应映射口径(collab plan §7.5/§9.2)。
function withFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('transport: 200 成功透传 version/revision;legacy 无 version 串接为 null', async () => {
  const transport = createFetchPageSaveTransport('album-1');
  await withFetch(
    async (url, init) => {
      assert.match(String(url), /\/api\/v1\/albums\/album-1\/pages\/3$/);
      const body = JSON.parse(String(init!.body));
      assert.deepEqual(
        { images: body.imagesJson, bv: body.baseVersion },
        { images: { hero: 'p1' }, bv: 17 },
        '携带 baseVersion 与 patch 字段',
      );
      return jsonResponse(200, { ok: true, data: { updated: true, pageIndex: 3, version: 18, revision: 18 } });
    },
    async () => {
      const out = await transport.save(3, 17, { imagesJson: { hero: 'p1' } });
      assert.deepEqual(out, { ok: true, version: 18, revision: 18 });
    },
  );

  await withFetch(
    async () => jsonResponse(200, { ok: true, data: { updated: true } }),
    async () => {
      const out = await transport.save(0, null, { textsJson: { title: 'legacy' } });
      assert.deepEqual(out, { ok: true, version: null, revision: null }, 'legacy 盲写不编造 version');
    },
  );
});

test('transport: baseVersion 为 null 时 body 不含 baseVersion 字段(阶段A盲写)', async () => {
  const transport = createFetchPageSaveTransport('album-2');
  await withFetch(
    async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      assert.equal('baseVersion' in body, false);
      return jsonResponse(200, { ok: true, data: { updated: true } });
    },
    async () => {
      await transport.save(0, null, { textsJson: {} });
    },
  );
});

test('transport: 409 EDIT_CONFLICT → conflict 带服务端 currentVersion', async () => {
  const transport = createFetchPageSaveTransport('album-3');
  await withFetch(
    async () =>
      jsonResponse(409, {
        ok: false,
        error: {
          code: 'EDIT_CONFLICT',
          message: 'Page changed since it was loaded',
          details: { pageIndex: 3, currentVersion: 19, currentPage: { texts: {} } },
        },
      }),
    async () => {
      const out = await transport.save(3, 17, { textsJson: { title: 'x' } });
      assert.deepEqual(out, { ok: 'conflict', currentVersion: 19 });
    },
  );
});

test('transport: 409 REVISION_AHEAD → conflict(取不到页版本给 0,只能重载)', async () => {
  const transport = createFetchPageSaveTransport('album-4');
  await withFetch(
    async () =>
      jsonResponse(409, {
        ok: false,
        error: { code: 'REVISION_AHEAD', details: { since: 99, currentRevision: 42 } },
      }),
    async () => {
      const out = await transport.save(0, 1, { textsJson: {} });
      assert.deepEqual(out, { ok: 'conflict', currentVersion: 0 });
    },
  );
});

test('transport: 401/403 → forbidden(停止自动重试);其余错误/异常 → network', async () => {
  const transport = createFetchPageSaveTransport('album-5');
  await withFetch(
    async () => jsonResponse(403, { ok: false, error: { code: 'ALBUM_ACCESS_DENIED' } }),
    async () => {
      assert.deepEqual(await transport.save(0, 1, {}), { ok: 'error', kind: 'forbidden' });
    },
  );
  await withFetch(
    async () => jsonResponse(401, { ok: false, error: { code: 'UNAUTHORIZED' } }),
    async () => {
      assert.deepEqual(await transport.save(0, 1, {}), { ok: 'error', kind: 'forbidden' });
    },
  );
  await withFetch(
    async () => jsonResponse(500, { ok: false, error: { code: 'INTERNAL_ERROR' } }),
    async () => {
      assert.deepEqual(await transport.save(0, 1, {}), { ok: 'error', kind: 'network' });
    },
  );
  await withFetch(
    async () => {
      throw new TypeError('network down');
    },
    async () => {
      assert.deepEqual(await transport.save(0, 1, {}), { ok: 'error', kind: 'network' });
    },
  );
});
