import { test } from 'node:test';
import assert from 'node:assert/strict';

async function loadAgentClient() {
  process.env.AGENT_BASE_URL = 'http://agent.test';
  process.env.AGENT_SHARED_SECRET = 'dev_secret_test';
  return (await import('./agent-client')).agentClient;
}

function mockFetch(t: { mock: { method: typeof import('node:test').mock.method } }, body: unknown, status = 200) {
  const captured: { url?: string; body?: unknown } = {};
  t.mock.method(globalThis, 'fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = String(input);
    captured.body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch);
  return captured;
}

test('editChatV3 posts slim request and validates opId response', async (t) => {
  const agentClient = await loadAgentClient();
  const captured = mockFetch(t, {
    ok: true,
    data: {
      kind: 'edit',
      assistantReply: 'Updated.',
      patches: [{ pageIndex: 1, texts: { body: 'New' } }],
      opId: 'op_1',
      usage: { durationMs: 1, models: {} },
    },
  });
  const res = await agentClient.editChatV3({
    albumId: 'alb_1',
    language: 'en',
    userMessage: 'update',
    focus: { chapterId: 'c1', pageIndex: 1 },
    progress: { currentChapterId: 'c1', doneChapterIds: [] },
  });
  assert.equal(captured.url, 'http://agent.test/v3/edit-chat');
  assert.deepEqual(captured.body, {
    albumId: 'alb_1',
    language: 'en',
    userMessage: 'update',
    focus: { chapterId: 'c1', pageIndex: 1 },
    progress: { currentChapterId: 'c1', doneChapterIds: [] },
  });
  assert.equal(res.opId, 'op_1');
});

test('ackEditOp posts /internal/agent-ack and returns ok boolean', async (t) => {
  const agentClient = await loadAgentClient();
  const captured = mockFetch(t, { ok: true });
  const ok = await agentClient.ackEditOp({ opId: 'op_1' });
  assert.equal(captured.url, 'http://agent.test/internal/agent-ack');
  assert.deepEqual(captured.body, { opId: 'op_1' });
  assert.equal(ok, true);
});
