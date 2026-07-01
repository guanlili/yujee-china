import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentClient } from './agent-client';
import type { V3ChapterChatRequest } from '@yujee/contracts';

// WP2.1 (#185): the Web-side load-bearing logic for POST /v3/chapter-chat is the
// agent-client method — it unwraps the agent's { ok, data } envelope and validates
// `data` against the V3ChapterChatResponse contract (two-end parity: v3.ts ↔
// schemas.py). The route itself is a thin auth + ownership forwarder. These tests
// mock fetch so no agent/network is needed.

const PAYLOAD: V3ChapterChatRequest = {
  albumId: 'alb_v3',
  language: 'en',
  chapter: {
    chapterId: 'ch_1',
    description: 'A spring trip.',
    accentColor: null,
    artFont: null,
    chapterContext: "",
    photos: [
      {
        photoId: 'p1',
        sceneDescription: 'beach',
        width: 800,
        height: 600,
        orientation: 'landscape',
        takenAt: null,
      },
    ],
  },
  pages: [{ pageIndex: 0, templateId: 'mag-13', images: { image: 'p1' }, texts: {} }],
  history: [],
  userMessage: 'tell me about it',
};

function mockFetch(t: { mock: { method: typeof import('node:test').mock.method } }, body: unknown, status = 200) {
  t.mock.method(globalThis, 'fetch', (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch);
}

test('chapterChatV3 unwraps a talk turn and validates the contract', async (t) => {
  mockFetch(t, {
    ok: true,
    data: {
      kind: 'talk',
      assistantReply: 'Tell me more.',
      usage: { durationMs: 5, models: { planning: 'deepseek-chat' } },
    },
  });
  const res = await agentClient.chapterChatV3(PAYLOAD);
  assert.equal(res.kind, 'talk');
  assert.equal(res.assistantReply, 'Tell me more.');
  assert.equal(res.pagesTexts, undefined);
  assert.equal(res.layoutPatch, undefined);
});

test('chapterChatV3 passes through a write turn pagesTexts', async (t) => {
  mockFetch(t, {
    ok: true,
    data: {
      kind: 'write',
      assistantReply: 'Done.',
      pagesTexts: [{ pageIndex: 0, texts: { title: 'Coast Days' } }],
      usage: { durationMs: 5, models: { planning: 'deepseek-chat' } },
    },
  });
  const res = await agentClient.chapterChatV3(PAYLOAD);
  assert.equal(res.kind, 'write');
  assert.deepEqual(res.pagesTexts, [{ pageIndex: 0, texts: { title: 'Coast Days' } }]);
});

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

test('chapterChatV3 throws AGENT_INVALID_OUTPUT on an off-contract response', async (t) => {
  mockFetch(t, { ok: true, data: { kind: 'nonsense', assistantReply: '' } });
  await assert.rejects(agentClient.chapterChatV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('chapterChatV3 throws AGENT_UNAUTHORIZED on a 401', async (t) => {
  mockFetch(t, { ok: false }, 401);
  await assert.rejects(agentClient.chapterChatV3(PAYLOAD), hasCode('AGENT_UNAUTHORIZED'));
});

test('chapterChatV3 throws AGENT_CHAT_FAILED on a non-ok envelope', async (t) => {
  mockFetch(t, { ok: false });
  await assert.rejects(agentClient.chapterChatV3(PAYLOAD), hasCode('AGENT_CHAT_FAILED'));
});
