import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentClient } from './agent-client';
import type { V3RecommendRequest } from '@yujee/contracts';

const PAYLOAD: V3RecommendRequest = {
  albumId: 'alb_v3',
  language: 'en',
  fontHint: 'elegant serif',
  chapters: [
    {
      chapterId: 'ch_1',
      description: 'A spring trip to the coast.',
      photoDescs: ['sunlit beach', 'waves at sunset'],
      extractedColor: '#C8894A',
    },
    { chapterId: 'ch_2', description: 'A quiet evening in town.', photoDescs: ['lantern alley'] },
  ],
  analysisSummary: 'warm and nostalgic',
};

function mockFetch(t: { mock: { method: typeof import('node:test').mock.method } }, body: unknown, status = 200) {
  t.mock.method(globalThis, 'fetch', (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch);
}

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

function option(optionId: string, chapters: unknown[] = [
  { chapterId: 'ch_1', subject: 'Spring by the sea', accentColor: '#C2410C' },
  { chapterId: 'ch_2', subject: 'A coastal escape', accentColor: '#1E3A5F' },
]) {
  return {
    optionId,
    label: optionId,
    style: `${optionId} style`,
    artFont: 'script-elegant',
    chapters,
  };
}

function okRecommend(bookThemeOptions: unknown[]) {
  return {
    ok: true,
    data: {
      bookThemeOptions,
      assistantReply: 'x',
      usage: { durationMs: 5, models: {} },
    },
  };
}

test('recommendV3 unwraps three book theme options and validates chapter coverage', async (t) => {
  mockFetch(t, okRecommend([option('opt-1'), option('opt-2'), option('opt-3')]));
  const res = await agentClient.recommendV3(PAYLOAD);
  assert.equal(res.bookThemeOptions.length, 3);
  assert.equal(res.bookThemeOptions[0].optionId, 'opt-1');
  assert.deepEqual(
    res.bookThemeOptions[0].chapters.map((c) => c.chapterId),
    ['ch_1', 'ch_2'],
  );
  assert.equal(res.bookThemeOptions[0].chapters[0].accentColor, '#C2410C');
  assert.equal(res.bookThemeOptions[0].artFont, 'script-elegant');
});

test('recommendV3 rejects missing chapter coverage inside an option', async (t) => {
  mockFetch(t, okRecommend([
    option('opt-1', [{ chapterId: 'ch_1', accentColor: '#C2410C' }]),
    option('opt-2'),
    option('opt-3'),
  ]));
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('recommendV3 rejects extra chapter ids inside an option', async (t) => {
  mockFetch(t, okRecommend([
    option('opt-1', [
      { chapterId: 'ch_1', accentColor: '#C2410C' },
      { chapterId: 'ch_2', accentColor: '#1E3A5F' },
      { chapterId: 'ch_3', accentColor: '#2F855A' },
    ]),
    option('opt-2'),
    option('opt-3'),
  ]));
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('recommendV3 rejects duplicate chapter ids inside an option', async (t) => {
  mockFetch(t, okRecommend([
    option('opt-1', [
      { chapterId: 'ch_1', accentColor: '#C2410C' },
      { chapterId: 'ch_1', accentColor: '#1E3A5F' },
    ]),
    option('opt-2'),
    option('opt-3'),
  ]));
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('recommendV3 throws AGENT_INVALID_OUTPUT on an illegal artFont', async (t) => {
  mockFetch(t, okRecommend([{ ...option('opt-1'), artFont: 'comic-sans' }, option('opt-2'), option('opt-3')]));
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('recommendV3 throws AGENT_INVALID_OUTPUT on a non-hex accentColor', async (t) => {
  mockFetch(t, okRecommend([
    option('opt-1', [
      { chapterId: 'ch_1', accentColor: 'cornflowerblue' },
      { chapterId: 'ch_2', accentColor: '#1E3A5F' },
    ]),
    option('opt-2'),
    option('opt-3'),
  ]));
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('recommendV3 throws AGENT_UNAUTHORIZED on a 401', async (t) => {
  mockFetch(t, { ok: false }, 401);
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_UNAUTHORIZED'));
});

test('recommendV3 throws AGENT_CHAT_FAILED on a non-ok envelope', async (t) => {
  mockFetch(t, { ok: false });
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_CHAT_FAILED'));
});
