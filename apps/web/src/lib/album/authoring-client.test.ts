import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  postChapterChat,
  postRecommend,
  postApplyTheme,
  postCover,
} from './authoring-client';
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

// ─── ③ recommend / apply-theme (缺口#20) ───
// The browser sends ONLY its language/selection — never the chapter overview or layout
// pages (invariant 12). The Web route re-slices draft_json server-side.

const RECOMMEND = {
  ok: true,
  data: {
    bookThemeOptions: [
      {
        optionId: 'opt-1',
        artFont: 'script-elegant',
        chapters: [{ chapterId: 'c1', subject: 'A Year Away', accentColor: '#C0392B' }],
      },
      {
        optionId: 'opt-2',
        artFont: 'serif-classic',
        chapters: [{ chapterId: 'c1', accentColor: '#1E3A5F' }],
      },
      {
        optionId: 'opt-3',
        artFont: 'display-bold',
        chapters: [{ chapterId: 'c1', accentColor: '#2F855A' }],
      },
    ],
    assistantReply: 'Here are some themes.',
    usage: { durationMs: 1, models: {} },
  },
};

test('postRecommend POSTs only {language} (no chapter overview) to /recommend', async (t) => {
  const captured = mockFetch(t, RECOMMEND);
  const res = await postRecommend('alb_1');
  assert.equal(captured.url, '/api/v3/albums/alb_1/recommend');
  assert.equal(captured.method, 'POST');
  assert.deepEqual(captured.body, { language: 'en' }); // no chapters/analysisSummary
  assert.equal(res.bookThemeOptions[0]!.chapters[0]!.subject, 'A Year Away');
  assert.equal(res.bookThemeOptions[0]!.chapters[0]!.accentColor, '#C0392B');
});

test('postRecommend forwards an optional free-text nudge', async (t) => {
  const captured = mockFetch(t, RECOMMEND);
  await postRecommend('alb_1', 'warmer please');
  assert.deepEqual(captured.body, { language: 'en', userMessage: 'warmer please' });
});

test('postRecommend forwards an optional font hint', async (t) => {
  const captured = mockFetch(t, RECOMMEND);
  await postRecommend('alb_1', undefined, 'classic serif');
  assert.deepEqual(captured.body, { language: 'en', fontHint: 'classic serif' });
});

const APPLY = {
  ok: true,
  data: {
    stage: 'cover',
    layoutPatch: [{ pageIndex: 1, textsJson: { divider: '#C0392B' } }],
    assistantReply: 'Applied.',
  },
};

test('postApplyTheme POSTs only the SELECTIONS (per-chapter主题/色/字体), no pages', async (t) => {
  const captured = mockFetch(t, APPLY);
  const res = await postApplyTheme('alb_1', {
    chapters: [{ chapterId: 'c1', subject: 'A Year Away', accentColor: '#C0392B', artFont: 'script-elegant' }],
  });
  assert.equal(captured.url, '/api/v3/albums/alb_1/apply-theme');
  assert.deepEqual(captured.body, {
    language: 'en',
    chapters: [{ chapterId: 'c1', subject: 'A Year Away', accentColor: '#C0392B', artFont: 'script-elegant' }],
  });
  assert.equal(res.stage, 'cover');
  assert.deepEqual(res.layoutPatch, [{ pageIndex: 1, textsJson: { divider: '#C0392B' } }]);
});

// ─── ④ cover (缺口#20) ───

test('postCover POSTs only the template SELECTIONS to /cover', async (t) => {
  const captured = mockFetch(t, {
    ok: true,
    data: { stage: 'ready', layoutPatch: [{ pageIndex: 0, templateId: 'mag-01' }] },
  });
  const res = await postCover('alb_1', { coverTemplateId: 'mag-01', endingTemplateId: 'mag-20' });
  assert.equal(captured.url, '/api/v3/albums/alb_1/cover');
  assert.deepEqual(captured.body, {
    language: 'en',
    coverTemplateId: 'mag-01',
    endingTemplateId: 'mag-20',
  });
  assert.equal(res.stage, 'ready');
});

test('postCover forwards transient thumbnails and cover chat context to /cover', async (t) => {
  const captured = mockFetch(t, {
    ok: true,
    data: { stage: 'cover', layoutPatch: [], assistantReply: 'Which mood?', needsUserInput: true },
  });
  const res = await postCover('alb_1', {
    coverTemplateId: 'mag-01',
    coverPhotoId: 'p1',
    endingPhotoId: 'p2',
    coverPhoto: 'data:image/jpeg;base64,cover',
    endingPhoto: 'data:image/jpeg;base64,ending',
    userMessage: 'make it quieter',
    history: [{ role: 'assistant', content: 'Do you want a quiet cover?' }],
  });

  assert.deepEqual(captured.body, {
    language: 'en',
    coverTemplateId: 'mag-01',
    coverPhotoId: 'p1',
    endingPhotoId: 'p2',
    coverPhoto: 'data:image/jpeg;base64,cover',
    endingPhoto: 'data:image/jpeg;base64,ending',
    userMessage: 'make it quieter',
    history: [{ role: 'assistant', content: 'Do you want a quiet cover?' }],
  });
  assert.equal(res.needsUserInput, true);
});

test('postCover skip (no selection) sends just {language} and accepts an empty patch', async (t) => {
  const captured = mockFetch(t, { ok: true, data: { stage: 'ready', layoutPatch: [] } });
  const res = await postCover('alb_1', {});
  assert.deepEqual(captured.body, { language: 'en' }); // 跳过 = no template ids
  assert.deepEqual(res.layoutPatch, []); // §4.4 跳过=空, never an error
  assert.equal(res.stage, 'ready');
});

test('postApplyTheme throws UnauthorizedError on a 401 envelope', async (t) => {
  mockFetch(t, { ok: false, error: { code: 'UNAUTHORIZED' } }, 401);
  await assert.rejects(
    postApplyTheme('alb_1', {
      chapters: [{ chapterId: 'c1', subject: 'x', accentColor: '#000000', artFont: 'sans-modern' }],
    }),
    (e) => e instanceof UnauthorizedError,
  );
});
