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
