import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submitGeneration, UnauthorizedError } from './client';

test('submitGeneration throws UnauthorizedError for unauthorized responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } }, { status: 401 })) as typeof fetch;

  try {
    await assert.rejects(
      submitGeneration({
        requestId: '00000000-0000-4000-8000-000000000000',
        prompt: 'A family trip',
        language: 'en',
        photos: [{ photoId: 'photo-1', base64: 'data:image/jpeg;base64,abc', width: 1, height: 1 }],
      }),
      UnauthorizedError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
