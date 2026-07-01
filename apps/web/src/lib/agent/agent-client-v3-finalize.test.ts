import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentClient } from './agent-client';
import type { V3FinalizeRequest } from '@yujee/contracts';

// WP5.1 (#194): the Web-side load-bearing logic for POST /v3/finalize is the
// agent-client method — it unwraps the agent's { ok, data } envelope and validates
// `data` against the V3FinalizeResponse contract. Unlike other v3 sync endpoints,
// finalize treats transport and non-422 failures as AGENT_INTERNAL_ERROR while 422
// AGENT_OUTPUT_VALIDATION maps to AGENT_INVALID_OUTPUT.

const PAYLOAD: V3FinalizeRequest = {
  albumId: 'alb_v3',
  language: 'en',
  tree: {
    chapters: [
      {
        chapterId: 'ch_1',
        description: 'A spring trip.',
        accentColor: null,
        artFont: null,
        chapterContext: "",
        photos: [{ photoId: 'p1', sceneDescription: 'beach', width: 800, height: 600, orientation: 'landscape' }],
      },
    ],
  },
  pages: [{ pageIndex: 0, templateId: 'mag-08', images: { image: 'p1' }, texts: { title: 'Two' } }],
};

function mockFetch(t: { mock: { method: typeof import('node:test').mock.method } }, body: unknown, status = 200) {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  ) as typeof fetch;
}

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

test('finalizeV3 unwraps the flat AlbumLayoutPlan and validates', async (t) => {
  mockFetch(t, {
    ok: true,
    data: {
      layout: {
        magazine: { title: 'A Summer Album', style: 'warm-film', language: 'en' },
        photos: [],
        pages: [{ pageIndex: 0, templateId: 'mag-08', images: { image: 'p1' }, texts: { title: 'Two' } }],
      },
      usage: { durationMs: 1, models: {} },
    },
  });
  const res = await agentClient.finalizeV3(PAYLOAD);
  assert.equal(res.layout.pages.length, 1);
  assert.equal(res.layout.pages[0]!.pageIndex, 0);
  assert.equal(res.layout.pages[0]!.templateId, 'mag-08');
});

test('finalizeV3 maps fetch failures to AGENT_INTERNAL_ERROR', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => {
      throw new Error('agent host is down');
    },
  );
  await assert.rejects(agentClient.finalizeV3(PAYLOAD), hasCode('AGENT_INTERNAL_ERROR'));
});

test('finalizeV3 maps malformed success JSON to AGENT_INTERNAL_ERROR', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  await assert.rejects(agentClient.finalizeV3(PAYLOAD), hasCode('AGENT_INTERNAL_ERROR'));
});

test('finalizeV3 maps null success JSON to AGENT_INTERNAL_ERROR', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('null', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  await assert.rejects(agentClient.finalizeV3(PAYLOAD), hasCode('AGENT_INTERNAL_ERROR'));
});

test('finalizeV3 maps non-422 HTTP to AGENT_INTERNAL_ERROR', async (t) => {
  mockFetch(t, { ok: false }, 500);
  await assert.rejects(agentClient.finalizeV3(PAYLOAD), hasCode('AGENT_INTERNAL_ERROR'));
});

test('finalizeV3 maps non-ok envelope to AGENT_INTERNAL_ERROR', async (t) => {
  mockFetch(t, { ok: false });
  await assert.rejects(agentClient.finalizeV3(PAYLOAD), hasCode('AGENT_INTERNAL_ERROR'));
});

test('finalizeV3 maps 422 AGENT_OUTPUT_VALIDATION to AGENT_INVALID_OUTPUT', async (t) => {
  mockFetch(t, {
    detail: {
      error: {
        code: 'AGENT_OUTPUT_VALIDATION',
        message: 'ambiguous multi-chapter finalize request',
      },
    },
  }, 422);
  await assert.rejects(agentClient.finalizeV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});
