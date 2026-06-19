import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentClient } from './agent-client';
import type { V3ApplyThemeRequest } from '@yujee/contracts';

// WP3.2 (#190): the Web-side load-bearing logic for POST /v3/apply-theme is the
// agent-client method — it unwraps the agent's { ok, data } envelope and validates
// `data` against the V3ApplyThemeResponse contract (two-end parity: v3.ts ↔
// schemas.py). The route is a thin auth + ownership forwarder that then persists the
// tree colors + advances stage=cover. These tests mock fetch so no agent/network is
// needed.

const PAYLOAD: V3ApplyThemeRequest = {
  albumId: 'alb_v3',
  language: 'en',
  theme: { subject: 'A Year Away', label: 'The Journey' },
  chapters: [{ chapterId: 'ch_1', accentColor: '#C0392B', artFont: 'script-elegant' }],
  pages: [{ pageIndex: 0, templateId: 'mag-13', images: { image: 'p1' }, texts: { title: 'Two' } }],
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

test('applyThemeV3 unwraps the page-level layoutPatch and validates', async (t) => {
  mockFetch(t, {
    ok: true,
    data: {
      layoutPatch: [{ pageIndex: 0, texts: { divider: '#C0392B', title: 'Two' } }],
      usage: { durationMs: 1, models: {} },
    },
  });
  const res = await agentClient.applyThemeV3(PAYLOAD);
  assert.equal(res.layoutPatch.length, 1);
  assert.equal(res.layoutPatch[0].pageIndex, 0);
  assert.equal(res.layoutPatch[0].texts?.divider, '#C0392B'); // svg filled with accent
});

test('applyThemeV3 rejects an empty layoutPatch (contract min(1))', async (t) => {
  mockFetch(t, {
    ok: true,
    data: { layoutPatch: [], usage: { durationMs: 1, models: {} } },
  });
  await assert.rejects(agentClient.applyThemeV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('applyThemeV3 throws AGENT_UNAUTHORIZED on a 401', async (t) => {
  mockFetch(t, { ok: false }, 401);
  await assert.rejects(agentClient.applyThemeV3(PAYLOAD), hasCode('AGENT_UNAUTHORIZED'));
});

test('applyThemeV3 maps agent 422 validation failures to AGENT_INVALID_OUTPUT', async (t) => {
  mockFetch(t, {
    detail: {
      ok: false,
      error: { code: 'AGENT_OUTPUT_VALIDATION', message: 'ambiguous multi-chapter apply-theme request' },
    },
  }, 422);
  await assert.rejects(agentClient.applyThemeV3(PAYLOAD), hasCode('AGENT_INVALID_OUTPUT'));
});

test('applyThemeV3 throws AGENT_CHAT_FAILED on a non-ok envelope', async (t) => {
  mockFetch(t, { ok: false });
  await assert.rejects(agentClient.applyThemeV3(PAYLOAD), hasCode('AGENT_CHAT_FAILED'));
});
