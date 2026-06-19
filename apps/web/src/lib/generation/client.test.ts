import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generationPhotosFromCache, submitAnalyzeV3, UnauthorizedError } from './client';

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

test('generationPhotosFromCache returns cached photos in requested order', () => {
  const cached = [
    { photoId: 'b', base64: 'data:image/jpeg;base64,b', width: 800, height: 600 },
    { photoId: 'a', base64: 'data:image/jpeg;base64,a', width: 600, height: 800 },
  ];

  assert.deepEqual(generationPhotosFromCache(['a', 'b'], cached), [cached[1], cached[0]]);
});

test('generationPhotosFromCache returns null when any requested photo is missing', () => {
  const cached = [{ photoId: 'a', base64: 'data:image/jpeg;base64,a', width: 600, height: 800 }];

  assert.equal(generationPhotosFromCache(['a', 'b'], cached), null);
});
