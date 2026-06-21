import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentClient } from './agent-client';
import type { V3RecommendRequest } from '@yujee/contracts';

// WP3.1 (#189): the Web-side load-bearing logic for POST /v3/recommend is the
// agent-client method — it unwraps the agent's { ok, data } envelope and validates
// `data` against the V3RecommendResponse contract (two-end parity: v3.ts ↔
// schemas.py). The route itself is a thin auth + ownership forwarder. These tests
// mock fetch so no agent/network is needed.

const PAYLOAD: V3RecommendRequest = {
  albumId: 'alb_v3',
  language: 'en',
  chapters: [
    {
      chapterId: 'ch_1',
      description: 'A spring trip to the coast.',
      photoDescs: ['sunlit beach', 'waves at sunset'],
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

test('recommendV3 unwraps per-chapter colors + subjects and validates', async (t) => {
  mockFetch(t, {
    ok: true,
    data: {
      chapterColors: [
        { chapterId: 'ch_1', subject: 'Spring by the sea', accentColor: '#C2410C', artFont: 'script-elegant' },
        { chapterId: 'ch_2', subject: 'A coastal escape', accentColor: '#1E3A5F', artFont: 'serif-classic' },
      ],
      assistantReply: 'Here are a few picks.',
      usage: { durationMs: 5, visionCallCount: 1, models: { vision: 'gpt-5.5-mini' } },
    },
  });
  const res = await agentClient.recommendV3(PAYLOAD);
  assert.equal(res.chapterColors.length, 2);
  assert.equal(res.chapterColors[0].subject, 'Spring by the sea');
  assert.deepEqual(
    res.chapterColors.map((c) => c.chapterId),
    ['ch_1', 'ch_2'],
  );
  assert.equal(res.chapterColors[0].accentColor, '#C2410C');
  assert.equal(res.chapterColors[0].artFont, 'script-elegant');
});

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

function okRecommend(chapterColors: unknown[]) {
  return {
    ok: true,
    data: {
      chapterColors,
      assistantReply: 'x',
      usage: { durationMs: 5, models: {} },
    },
  };
}

test('recommendV3 rejects missing chapter color coverage', async (t) => {
  mockFetch(t, okRecommend([
    { chapterId: 'ch_1', subject: 'Spring by the sea', accentColor: '#C2410C', artFont: 'script-elegant' },
  ]));
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('recommendV3 rejects extra chapter color ids', async (t) => {
  mockFetch(t, okRecommend([
    { chapterId: 'ch_1', subject: 'Spring by the sea', accentColor: '#C2410C', artFont: 'script-elegant' },
    { chapterId: 'ch_2', subject: 'Evening in town', accentColor: '#1E3A5F', artFont: 'serif-classic' },
    { chapterId: 'ch_3', subject: 'An extra chapter', accentColor: '#2F855A', artFont: 'sans-modern' },
  ]));
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('recommendV3 rejects duplicate chapter color ids', async (t) => {
  mockFetch(t, okRecommend([
    { chapterId: 'ch_1', subject: 'Spring by the sea', accentColor: '#C2410C', artFont: 'script-elegant' },
    { chapterId: 'ch_1', subject: 'A duplicate', accentColor: '#1E3A5F', artFont: 'serif-classic' },
  ]));
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('recommendV3 throws AGENT_INVALID_OUTPUT on an illegal artFont', async (t) => {
  mockFetch(t, {
    ok: true,
    data: {
      // comic-sans is not an ArtFontPack member — the contract must reject it.
      chapterColors: [{ chapterId: 'ch_1', subject: 'Spring by the sea', accentColor: '#C2410C', artFont: 'comic-sans' }],
      assistantReply: 'x',
      usage: { durationMs: 5, models: {} },
    },
  });
  await assert.rejects(agentClient.recommendV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('recommendV3 throws AGENT_INVALID_OUTPUT on a non-hex accentColor', async (t) => {
  mockFetch(t, {
    ok: true,
    data: {
      chapterColors: [{ chapterId: 'ch_1', subject: 'Spring by the sea', accentColor: 'cornflowerblue', artFont: 'serif-classic' }],
      assistantReply: 'x',
      usage: { durationMs: 5, models: {} },
    },
  });
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
