import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postChapterChat } from './authoring-client';
import { UnauthorizedError, CreditInsufficientError } from '@/lib/generation/client';

// 缺口#20: postChapterChat must POST the single-chapter slice the browser holds
// (chapterId + history + userMessage + focusedPageIndex) to the album's
// /api/v3/.../chapter-chat route, and unwrap the { ok, data } envelope. These mock
// fetch so no network/route is needed.

type Captured = { url: string; method?: string; body: unknown };

function mockFetch(t: { mock: { method: typeof import('node:test').mock.method } }, envelope: unknown, status = 200) {
  const captured: Captured = { url: '', body: undefined };
  t.mock.method(globalThis, 'fetch', (async (input: string, init?: RequestInit) => {
    captured.url = String(input);
    captured.method = init?.method;
    captured.body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(JSON.stringify(envelope), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch);
  return captured;
}

const TALK = {
  ok: true,
  data: { kind: 'talk', assistantReply: 'Tell me more.', usage: { durationMs: 1, models: {} } },
};

test('postChapterChat POSTs the single-chapter slice to /api/v3/albums/:id/chapter-chat', async (t) => {
  const captured = mockFetch(t, TALK);
  const res = await postChapterChat('alb_1', {
    language: 'en',
    chapterId: 'c2',
    history: [{ role: 'user', content: 'hi' }],
    userMessage: 'about it',
    focusedPageIndex: 3,
  });
  assert.equal(captured.url, '/api/v3/albums/alb_1/chapter-chat');
  assert.equal(captured.method, 'POST');
  // The browser sends ONLY the slim slice — no chapter node / pages (invariant 12).
  assert.deepEqual(captured.body, {
    language: 'en',
    chapterId: 'c2',
    history: [{ role: 'user', content: 'hi' }],
    userMessage: 'about it',
    focusedPageIndex: 3,
  });
  assert.equal(res.kind, 'talk');
  assert.equal(res.assistantReply, 'Tell me more.');
});

test('postChapterChat passes through a write turn (pagesTexts + nameOptions)', async (t) => {
  mockFetch(t, {
    ok: true,
    data: {
      kind: 'write',
      assistantReply: 'Done.',
      pagesTexts: [{ pageIndex: 0, texts: { headline: 'Coast Days' } }],
      nameOptions: ['Coast Days'],
      usage: { durationMs: 1, models: {} },
    },
  });
  const res = await postChapterChat('alb_1', {
    language: 'en',
    chapterId: 'c1',
    history: [],
    userMessage: 'write it',
  });
  assert.equal(res.kind, 'write');
  assert.deepEqual(res.pagesTexts, [{ pageIndex: 0, texts: { headline: 'Coast Days' } }]);
  assert.deepEqual(res.nameOptions, ['Coast Days']);
});

test('postChapterChat throws UnauthorizedError on a 401 envelope', async (t) => {
  mockFetch(t, { ok: false, error: { code: 'UNAUTHORIZED' } }, 401);
  await assert.rejects(
    postChapterChat('alb_1', { language: 'en', chapterId: 'c1', history: [], userMessage: 'hi' }),
    (e) => e instanceof UnauthorizedError,
  );
});

test('postChapterChat throws CreditInsufficientError on CREDIT_INSUFFICIENT', async (t) => {
  mockFetch(t, { ok: false, error: { code: 'CREDIT_INSUFFICIENT' } }, 402);
  await assert.rejects(
    postChapterChat('alb_1', { language: 'en', chapterId: 'c1', history: [], userMessage: 'hi' }),
    (e) => e instanceof CreditInsufficientError,
  );
});
