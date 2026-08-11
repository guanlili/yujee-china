import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CompressedPhoto } from '@/lib/photo/compress';
import {
  clusterCompressedPhotos,
  compressedPhotosFromCache,
  selectLayoutRefsFromCompressed,
  submitSelectLayoutV3,
  submitAnalyzeV3,
  UnauthorizedError,
} from './client';

const compressed = (photoId: string, base64: string, w: number, h: number): CompressedPhoto => ({
  photoId,
  base64,
  width: w,
  height: h,
  takenAt: null,
  clusterGeo: null,
});

test('submitAnalyzeV3 throws UnauthorizedError for unauthorized responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } }, { status: 401 })) as typeof fetch;

  try {
    await assert.rejects(
      submitAnalyzeV3({
        requestId: '00000000-0000-4000-8000-000000000000',
        language: 'en',
        photos: [{ photoId: 'photo-1', base64: 'data:image/jpeg;base64,abc', width: 1, height: 1 }],
      }),
      UnauthorizedError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('submitAnalyzeV3 backs uploaded previews to cloud before returning the album', async (t) => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const entry = { photoId: 'photo-1', renderVersion: 'pf-v1__original' };
  t.mock.method(globalThis, 'fetch', (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string'
        ? JSON.parse(init.body)
        : init?.body;
    requests.push({ url, method, body });

    // 建书照片先直传 R2(见下方「直传」组测试),快照备份仍在建书之后。
    if (url === '/api/v3/albums/upload-urls') {
      return Response.json({
        ok: true,
        data: {
          sessionId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          uploads: (body as { photoIds: string[] }).photoIds.map((photoId) => ({
            photoId,
            putUrl: `https://analyze-put.test/${photoId}`,
          })),
        },
      });
    }
    if (url.startsWith('https://analyze-put.test/')) return new Response(null, { status: 200 });
    if (url === '/api/v3/albums') {
      return Response.json({
        ok: true,
        data: { albumId: 'album-1', requestId: 'request-1' },
      });
    }
    if (url.endsWith('/photo-snapshot-upload-url')) {
      return Response.json({
        ok: true,
        data: [{
          ...entry,
          putUrl: 'https://put.test/photo-1',
          r2Key: 'photo-snapshots/user/album-1/photo-1/pf-v1__original.jpg',
          publicUrl: 'https://cdn.test/photo-1/pf-v1__original.jpg',
        }],
      });
    }
    if (url === 'https://put.test/photo-1') return new Response(null, { status: 200 });
    if (url.endsWith('/photo-snapshot')) {
      return Response.json({
        ok: true,
        data: {
          photoIds: ['photo-1'],
          renderVersions: { 'photo-1': 'pf-v1__original' },
        },
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch);

  const result = await submitAnalyzeV3({
    requestId: 'request-1',
    language: 'en',
    photos: [{
      photoId: 'photo-1',
      base64: 'data:image/jpeg;base64,cHJldmlldy1ieXRlcw==',
      width: 800,
      height: 600,
    }],
  });

  assert.deepEqual(result, { albumId: 'album-1', requestId: 'request-1' });
  assert.deepEqual(
    requests.map(({ url, method }) => ({ url, method })),
    [
      { url: '/api/v3/albums/upload-urls', method: 'POST' },
      { url: 'https://analyze-put.test/photo-1', method: 'PUT' },
      { url: '/api/v3/albums', method: 'POST' },
      {
        url: '/api/v1/albums/album-1/photo-snapshot-upload-url',
        method: 'POST',
      },
      { url: 'https://put.test/photo-1', method: 'PUT' },
      { url: '/api/v1/albums/album-1/photo-snapshot', method: 'POST' },
    ],
  );
  assert.deepEqual(requests[3]!.body, { entries: [entry] });
  assert.ok(requests[4]!.body instanceof Blob);
  assert.equal(await (requests[4]!.body as Blob).text(), 'preview-bytes');
  assert.deepEqual(requests[5]!.body, { entries: [entry] });
});

test('submitSelectLayoutV3 posts refs to the browser-facing select-layout route', async () => {
  const originalFetch = globalThis.fetch;
  const captured: { url?: string; method?: string; body?: unknown } = {};
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    captured.url = String(input);
    captured.method = init?.method;
    captured.body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return Response.json({
      ok: true,
      data: { albumId: 'alb_1', requestId: 'layout-r1', accepted: true },
    });
  }) as typeof fetch;

  try {
    const result = await submitSelectLayoutV3('alb_1', {
      requestId: 'layout-r1',
      language: 'en',
      refs: { p1: 'data:image/jpeg;base64,AA==' },
    });

    assert.equal(captured.url, '/api/v3/albums/alb_1/select-layout');
    assert.equal(captured.method, 'POST');
    assert.deepEqual(captured.body, {
      requestId: 'layout-r1',
      language: 'en',
      refs: { p1: 'data:image/jpeg;base64,AA==' },
    });
    assert.deepEqual(result, { albumId: 'alb_1', requestId: 'layout-r1', accepted: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('compressedPhotosFromCache returns cached photos in requested order', () => {
  const cached = [
    compressed('b', 'data:image/jpeg;base64,b', 800, 600),
    compressed('a', 'data:image/jpeg;base64,a', 600, 800),
  ];

  assert.deepEqual(compressedPhotosFromCache(['a', 'b'], cached), [cached[1], cached[0]]);
});

test('compressedPhotosFromCache returns null when any requested photo is missing', () => {
  const cached = [compressed('a', 'data:image/jpeg;base64,a', 600, 800)];

  assert.equal(compressedPhotosFromCache(['a', 'b'], cached), null);
});

test('selectLayoutRefsFromCompressed returns photoId keyed transient data URLs', () => {
  assert.deepEqual(
    selectLayoutRefsFromCompressed([
      compressed('a', 'data:image/jpeg;base64,a', 800, 600),
      compressed('b', 'data:image/jpeg;base64,b', 600, 800),
    ]),
    {
      a: 'data:image/jpeg;base64,a',
      b: 'data:image/jpeg;base64,b',
    },
  );
});

test('clusterCompressedPhotos attaches clusterId and DROPS the transient geo (privacy)', () => {
  const inA = { ...compressed('a', 'data:image/jpeg;base64,a', 800, 600), takenAt: '2024-03-15T09:00:00', clusterGeo: { lat: 40.5, lng: -74 } };
  const inB = { ...compressed('b', 'data:image/jpeg;base64,b', 800, 600), takenAt: '2024-03-16T09:00:00', clusterGeo: { lat: 48.85, lng: 2.35 } };

  const out = clusterCompressedPhotos([inA, inB]);

  // Different days → two clusters, time-ordered.
  assert.equal(out[0].clusterId, 'c1');
  assert.equal(out[1].clusterId, 'c2');
  // The transient geo must NOT survive onto the photo sent to the Agent.
  for (const p of out) {
    assert.equal('clusterGeo' in p, false);
    const serialized = JSON.stringify(p);
    assert.equal(/lat|lng|geo|coord/i.test(serialized), false);
  }
});

// ── 建书照片直传 R2 ──────────────────────────────────────────────────────────
// 字节先 PUT 到 R2,POST /api/v3/albums 只带 uploadSessionId + 元数据。改造前把
// base64 内联进 body,27~50 张就撞 Vercel 的 FUNCTION_PAYLOAD_TOO_LARGE(413)。

function analyzeUploadFetchStub(
  requests: Array<{ url: string; method: string; body: unknown }>,
  opts: { failPuts?: string[] } = {},
) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    requests.push({ url, method, body });

    if (url === '/api/v3/albums/upload-urls') {
      const photoIds = (body as { photoIds: string[] }).photoIds;
      return Response.json({
        ok: true,
        data: {
          sessionId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          uploads: photoIds.map((photoId) => ({ photoId, putUrl: `https://put.test/${photoId}` })),
        },
      });
    }
    if (url.startsWith('https://put.test/')) {
      const photoId = url.slice('https://put.test/'.length);
      if (opts.failPuts?.includes(photoId)) return new Response(null, { status: 500 });
      return new Response(null, { status: 200 });
    }
    if (url === '/api/v3/albums') {
      return Response.json({ ok: true, data: { albumId: 'album-1', requestId: 'request-1' } });
    }
    // 快照备份链路照旧,这里一律放行,不是本组测试的关注点。
    if (url.endsWith('/photo-snapshot-upload-url')) {
      return Response.json({ ok: true, data: [] });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

test('submitAnalyzeV3(直传): 先签名、再逐张 PUT、最后建书,且 body 不含任何 base64', async (t) => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  t.mock.method(globalThis, 'fetch', analyzeUploadFetchStub(requests));

  const result = await submitAnalyzeV3({
    requestId: 'request-1',
    language: 'en',
    photos: [
      { photoId: 'p1', base64: 'data:image/jpeg;base64,YWFh', width: 800, height: 600 },
      { photoId: 'p2', base64: 'data:image/jpeg;base64,YmJi', width: 600, height: 800 },
    ],
  }, { skipCloudBackup: true });

  assert.deepEqual(result, { albumId: 'album-1', requestId: 'request-1' });

  const order = requests.map((r) => `${r.method} ${r.url}`);
  assert.equal(order[0], 'POST /api/v3/albums/upload-urls');
  assert.ok(order.slice(1, 3).every((o) => o.startsWith('PUT https://put.test/')));
  assert.equal(order[3], 'POST /api/v3/albums');

  const createBody = requests[3]!.body as {
    uploadSessionId: string;
    photos: Array<Record<string, unknown>>;
  };
  assert.equal(createBody.uploadSessionId, '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  assert.equal(
    createBody.photos.some((p) => 'base64' in p),
    false,
    '建书 body 里一个字节都不该有',
  );
  assert.deepEqual(createBody.photos.map((p) => p.photoId), ['p1', 'p2']);
  assert.equal(createBody.photos[0]!.width, 800);
});

test('submitAnalyzeV3(直传): PUT 的确实是解码后的 JPEG 字节', async (t) => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  t.mock.method(globalThis, 'fetch', analyzeUploadFetchStub(requests));

  await submitAnalyzeV3({
    requestId: 'request-1',
    language: 'en',
    photos: [{
      photoId: 'p1',
      base64: `data:image/jpeg;base64,${Buffer.from('preview-bytes').toString('base64')}`,
      width: 800,
      height: 600,
    }],
  }, { skipCloudBackup: true });

  const put = requests.find((r) => r.method === 'PUT')!;
  assert.ok(put.body instanceof Blob);
  assert.equal(await (put.body as Blob).text(), 'preview-bytes');
});

test('submitAnalyzeV3(直传): 有照片传不上去就抛 PhotosUploadFailedError,绝不建一本缺图的书', async (t) => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  t.mock.method(globalThis, 'fetch', analyzeUploadFetchStub(requests, { failPuts: ['p2'] }));

  await assert.rejects(
    submitAnalyzeV3({
      requestId: 'request-1',
      language: 'en',
      photos: [
        { photoId: 'p1', base64: 'data:image/jpeg;base64,YWFh', width: 800, height: 600 },
        { photoId: 'p2', base64: 'data:image/jpeg;base64,YmJi', width: 600, height: 800 },
      ],
    }, { skipCloudBackup: true }),
    (e: { name?: string; failedPhotoIds?: string[] }) => {
      assert.equal(e.name, 'PhotosUploadFailedError');
      assert.deepEqual(e.failedPhotoIds, ['p2']);
      return true;
    },
  );

  assert.equal(
    requests.some((r) => r.url === '/api/v3/albums'),
    false,
    '一张没传上就不该发建书请求',
  );
});

test('postJobs: 平台返回 text/plain 的 413 时,报人话而不是 JSON 解析错误', async (t) => {
  t.mock.method(globalThis, 'fetch', (async (input: string | URL) => {
    if (String(input) === '/api/v3/albums/upload-urls') {
      return new Response('Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE', {
        status: 413,
        headers: { 'content-type': 'text/plain' },
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch);

  await assert.rejects(
    submitAnalyzeV3({
      requestId: 'request-1',
      language: 'en',
      photos: [{ photoId: 'p1', base64: 'data:image/jpeg;base64,YWFh', width: 800, height: 600 }],
    }, { skipCloudBackup: true }),
    (e: Error) => {
      assert.doesNotMatch(e.message, /is not valid JSON/, '不该把 SyntaxError 甩给用户');
      assert.match(e.message, /413/);
      return true;
    },
  );
});

test('submitAnalyzeV3(直传): 服务端回 ANALYZE_UPLOAD_INCOMPLETE 时抛带张数的类型化错误,不把裸数字当文案', async (t) => {
  t.mock.method(globalThis, 'fetch', (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/v3/albums/upload-urls') {
      return Response.json({
        ok: true,
        data: {
          sessionId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          uploads: (JSON.parse(init!.body as string) as { photoIds: string[] }).photoIds.map(
            (photoId) => ({ photoId, putUrl: `https://put.test/${photoId}` }),
          ),
        },
      });
    }
    if (url.startsWith('https://put.test/')) return new Response(null, { status: 200 });
    if (url === '/api/v3/albums') {
      // 服务端只回个数(不回 photoId),见 ERRORS.ANALYZE_UPLOAD_INCOMPLETE。
      return Response.json(
        { ok: false, error: { code: 'ANALYZE_UPLOAD_INCOMPLETE', message: '2' } },
        { status: 409 },
      );
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch);

  await assert.rejects(
    submitAnalyzeV3({
      requestId: 'request-1',
      language: 'en',
      photos: [
        { photoId: 'p1', base64: 'data:image/jpeg;base64,YWFh', width: 800, height: 600 },
        { photoId: 'p2', base64: 'data:image/jpeg;base64,YmJi', width: 600, height: 800 },
      ],
    }, { skipCloudBackup: true }),
    (e: { name?: string; missingCount?: number; message?: string }) => {
      assert.equal(e.name, 'PhotosUploadIncompleteError');
      assert.equal(e.missingCount, 2);
      assert.notEqual(e.message, '2', '裸数字不能直接当用户文案');
      return true;
    },
  );
});

test('submitAnalyzeV3(直传): onUploadProgress 逐张推进,分母是总张数', async (t) => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  t.mock.method(globalThis, 'fetch', analyzeUploadFetchStub(requests));
  const ticks: [number, number][] = [];

  await submitAnalyzeV3({
    requestId: 'request-1',
    language: 'en',
    photos: [
      { photoId: 'p1', base64: 'data:image/jpeg;base64,YWFh', width: 800, height: 600 },
      { photoId: 'p2', base64: 'data:image/jpeg;base64,YmJi', width: 600, height: 800 },
    ],
  }, { skipCloudBackup: true, onUploadProgress: (done, total) => ticks.push([done, total]) });

  assert.deepEqual(ticks[0], [0, 2]);
  assert.deepEqual(ticks[ticks.length - 1], [2, 2]);
});
