import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentClient } from './agent-client';
import type { SelectLayoutRequest } from '@yujee/contracts';

const PAYLOAD: SelectLayoutRequest = {
  requestId: 'layout-r1',
  callbackUrl: 'http://localhost:3000/api/v3/internal/job-progress',
  language: 'en',
  chapters: [
    {
      chapterId: 'ch_1',
      structureHint: 'coast morning',
      photos: [
        {
          photoId: 'p1',
          ref200px: 'data:image/jpeg;base64,AA==',
          orientation: 'landscape',
          takenAt: '2024-03-15T08:30:00',
        },
      ],
    },
  ],
};

function mockFetch(t: { mock: { method: typeof import('node:test').mock.method } }, status = 202) {
  const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
  t.mock.method(globalThis, 'fetch', (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify({ ok: true, data: { requestId: PAYLOAD.requestId, accepted: true } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch);
  return calls;
}

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

test('submitSelectLayoutV3 posts to the async select-layout endpoint without candidates', async (t) => {
  const calls = mockFetch(t);

  await agentClient.submitSelectLayoutV3(PAYLOAD);

  assert.equal(calls[0]!.url.endsWith('/v3/select-layout'), true);
  assert.equal(calls[0]!.headers.get('X-Request-Id'), PAYLOAD.requestId);
  assert.equal(JSON.stringify(calls[0]!.body).includes('candidates'), false);
  assert.deepEqual(calls[0]!.body, PAYLOAD);
});

test('submitSelectLayoutV3 maps validation rejection', async (t) => {
  mockFetch(t, 400);
  await assert.rejects(agentClient.submitSelectLayoutV3(PAYLOAD), hasCode('VALIDATION_FAILED'));
});
