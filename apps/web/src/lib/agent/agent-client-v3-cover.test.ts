import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentClient } from './agent-client';
import type { V3CoverRequestInput } from '@yujee/contracts';

// WP4.1 (#192): the Web-side load-bearing logic for POST /v3/cover is the agent-client
// method — it unwraps the agent's { ok, data } envelope and validates `data` against the
// V3CoverResponse contract (two-end parity: v3.ts ↔ schemas.py). Unlike apply-theme, the
// cover layoutPatch may be EMPTY (§4.4 跳过=空), so an empty patch must be ACCEPTED. The
// route is a thin auth + ownership forwarder that then advances stage=ready. These tests
// mock fetch so no agent/network is needed.

const PAYLOAD: V3CoverRequestInput = {
  albumId: 'alb_v3',
  language: 'en',
  coverTemplateId: 'mag-01',
  endingTemplateId: null,
  pages: [{ pageIndex: 0, templateId: 'mag-08', images: { image: 'p1' }, texts: {} }],
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

test('coverV3 unwraps the page-level layoutPatch and validates', async (t) => {
  mockFetch(t, {
    ok: true,
    data: {
      layoutPatch: [{ pageIndex: 0, templateId: 'mag-01', images: { image: 'p1' }, texts: { folio: '01' } }],
      usage: { durationMs: 1, models: {} },
    },
  });
  const res = await agentClient.coverV3(PAYLOAD);
  assert.equal(res.layoutPatch.length, 1);
  assert.equal(res.layoutPatch[0].pageIndex, 0);
  assert.equal(res.layoutPatch[0].templateId, 'mag-01');
});

test('coverV3 ACCEPTS an empty layoutPatch (§4.4 跳过=空, no min(1))', async (t) => {
  mockFetch(t, {
    ok: true,
    data: { layoutPatch: [], usage: { durationMs: 1, models: {} } },
  });
  const res = await agentClient.coverV3({ ...PAYLOAD, coverTemplateId: null });
  assert.deepEqual(res.layoutPatch, []); // skip = empty patch, NOT an error
});

test('coverV3 throws AGENT_UNAUTHORIZED on a 401', async (t) => {
  mockFetch(t, { ok: false }, 401);
  await assert.rejects(agentClient.coverV3(PAYLOAD), hasCode('AGENT_UNAUTHORIZED'));
});

test('coverV3 throws AGENT_CHAT_FAILED on a non-ok envelope', async (t) => {
  mockFetch(t, { ok: false });
  await assert.rejects(agentClient.coverV3(PAYLOAD), hasCode('AGENT_CHAT_FAILED'));
});
