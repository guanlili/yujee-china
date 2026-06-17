import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runInspectAdjustLoop,
  MAX_INSPECT_ROUNDS,
  type InspectAdjustDeps,
} from '@/components/album/editor-v2/draft-edit-orchestrator';
import type { DraftEditResult, InspectRenderResult } from '@/lib/album/authoring-client';

// #165 Phase 3: the inspect→adjust orchestration. We mock the three I/O deps and
// assert the full sequence (inspect → screenshot → inspect-render → follow-up
// draft-edit → imagePosWrite act), the 3-round cap, and the graceful-fail paths.

const CAP_REPLY = 'cap-reply';
const FAIL_REPLY = 'inspect-fail-reply';

function diagnosis(over: Partial<InspectRenderResult['diagnosis']> = {}): InspectRenderResult {
  return {
    diagnosis: {
      imageId: 'hero',
      problem: 'top clipped',
      suggestedDx: 0,
      suggestedDy: -10,
      suggestedScale: 1.1,
      confidence: 0.8,
      ...over,
    },
    assistantReply: 'vision says: nudge down',
  };
}

// A scripted postDraftEdit: returns the next queued response each call, and
// records every (pageIndex, message) it was called with.
function scriptedDraftEdit(responses: DraftEditResult[]) {
  const calls: { pageIndex: number; message: string }[] = [];
  let i = 0;
  const fn = async (pageIndex: number, message: string): Promise<DraftEditResult> => {
    calls.push({ pageIndex, message });
    const r = responses[i] ?? responses[responses.length - 1]!;
    i += 1;
    return r;
  };
  return { fn, calls };
}

function baseDeps(over: Partial<InspectAdjustDeps>): InspectAdjustDeps {
  return {
    postDraftEdit: async () => ({ kind: 'talk', assistantReply: 'hi' }),
    capturePageRender: async () => 'data:image/jpeg;base64,SHOT',
    postInspectRender: async () => diagnosis(),
    capReply: CAP_REPLY,
    inspectFailReply: FAIL_REPLY,
    ...over,
  };
}

test('talk → returns the talk result, no inspect calls', async () => {
  let captured = 0;
  const r = await runInspectAdjustLoop(2, 'what is this page?', baseDeps({
    postDraftEdit: async () => ({ kind: 'talk', assistantReply: 'it is the coast' }),
    capturePageRender: async () => { captured += 1; return 'x'; },
  }));
  assert.equal(r.kind, 'talk');
  assert.equal(r.assistantReply, 'it is the coast');
  assert.equal(captured, 0, 'no screenshot on a plain talk');
});

test('act(pageWrite) on the first turn passes straight through (no inspect)', async () => {
  const r = await runInspectAdjustLoop(1, 'warmer', baseDeps({
    postDraftEdit: async () => ({
      kind: 'act',
      assistantReply: 'done',
      pageWrite: { pageIndex: 1, texts: { body: 'warm' } },
    }),
  }));
  assert.equal(r.kind, 'act');
  assert.deepEqual(r.pageWrite, { pageIndex: 1, texts: { body: 'warm' } });
});

test('inspect → screenshot → inspect-render → follow-up draft-edit → imagePosWrite act', async () => {
  const script = scriptedDraftEdit([
    { kind: 'inspect', assistantReply: 'let me look', inspectRequest: { pageIndex: 1 } },
    { kind: 'act', assistantReply: 'nudged it down', imagePosWrite: { pageIndex: 1, imageId: 'hero', x: 50, y: 38, scale: 1.1 } },
  ]);
  const shots: number[] = [];
  const renders: { pageIndex: number; screenshot: string }[] = [];
  const rounds: number[] = [];

  const r = await runInspectAdjustLoop(1, 'the face is cut off', baseDeps({
    postDraftEdit: script.fn,
    capturePageRender: async (pi) => { shots.push(pi); return 'data:image/jpeg;base64,SHOT'; },
    postInspectRender: async (pi, _msg, shot) => { renders.push({ pageIndex: pi, screenshot: shot }); return diagnosis(); },
    onVisionRound: (round) => rounds.push(round),
  }));

  // Final result is the imagePosWrite act.
  assert.equal(r.kind, 'act');
  assert.deepEqual(r.imagePosWrite, { pageIndex: 1, imageId: 'hero', x: 50, y: 38, scale: 1.1 });

  // Exactly one inspect round: screenshot taken for page 1, forwarded to render.
  assert.deepEqual(shots, [1]);
  assert.equal(renders.length, 1);
  assert.equal(renders[0]!.pageIndex, 1);
  assert.equal(renders[0]!.screenshot, 'data:image/jpeg;base64,SHOT');
  assert.deepEqual(rounds, [1]);

  // Two draft-edit calls: the user message, then the threaded diagnosis observation.
  assert.equal(script.calls.length, 2);
  assert.equal(script.calls[0]!.message, 'the face is cut off');
  assert.match(script.calls[1]!.message, /\[inspection of page 1\]/);
  assert.match(script.calls[1]!.message, /imageId=hero/);
  assert.match(script.calls[1]!.message, /adjust_image_position/);
  // The follow-up draft-edit stays pinned to the same focused page.
  assert.equal(script.calls[1]!.pageIndex, 1);
});

test('caps inspect rounds at MAX_INSPECT_ROUNDS and stops with a talk message', async () => {
  // The model NEVER converges — it keeps asking to inspect.
  let draftEditCalls = 0;
  let renderCalls = 0;
  const r = await runInspectAdjustLoop(1, 'fix it', baseDeps({
    postDraftEdit: async () => {
      draftEditCalls += 1;
      return { kind: 'inspect', assistantReply: 'again', inspectRequest: { pageIndex: 1 } };
    },
    postInspectRender: async () => { renderCalls += 1; return diagnosis(); },
  }));

  assert.equal(r.kind, 'talk');
  assert.equal(r.assistantReply, CAP_REPLY);
  // Vision is bounded: at most MAX_INSPECT_ROUNDS inspect-render calls, never infinite.
  assert.equal(renderCalls, MAX_INSPECT_ROUNDS);
  assert.equal(MAX_INSPECT_ROUNDS, 3);
  // draft-edit fires once per round + the initial turn (then the cap short-circuits).
  assert.equal(draftEditCalls, MAX_INSPECT_ROUNDS + 1);
});

test('graceful: inspect-render throw degrades to a talk message (never hangs)', async () => {
  const r = await runInspectAdjustLoop(1, 'fix it', baseDeps({
    postDraftEdit: async () => ({ kind: 'inspect', assistantReply: 'look', inspectRequest: { pageIndex: 1 } }),
    postInspectRender: async () => { throw new Error('agent 502'); },
  }));
  assert.equal(r.kind, 'talk');
  assert.equal(r.assistantReply, FAIL_REPLY);
});

test('graceful: capturePageRender throw degrades to a talk message', async () => {
  const r = await runInspectAdjustLoop(1, 'fix it', baseDeps({
    postDraftEdit: async () => ({ kind: 'inspect', assistantReply: 'look', inspectRequest: { pageIndex: 1 } }),
    capturePageRender: async () => { throw new Error('html2canvas blew up'); },
  }));
  assert.equal(r.kind, 'talk');
  assert.equal(r.assistantReply, FAIL_REPLY);
});

test('graceful: "unable to inspect" (null imageId) degrades to the inspect reply', async () => {
  const r = await runInspectAdjustLoop(1, 'fix it', baseDeps({
    postDraftEdit: async () => ({ kind: 'inspect', assistantReply: 'look', inspectRequest: { pageIndex: 1 } }),
    postInspectRender: async () => ({
      diagnosis: { imageId: null, problem: 'cannot tell', suggestedDx: 0, suggestedDy: 0, suggestedScale: 1, confidence: 0 },
      assistantReply: 'I cannot see a problem here.',
    }),
  }));
  assert.equal(r.kind, 'talk');
  assert.equal(r.assistantReply, 'I cannot see a problem here.');
});

test('auth errors propagate (loop must not swallow a login redirect)', async () => {
  const authErr = Object.assign(new Error('unauthorized'), { isAuthError: true });
  await assert.rejects(
    () => runInspectAdjustLoop(1, 'fix it', baseDeps({
      postDraftEdit: async () => ({ kind: 'inspect', assistantReply: 'look', inspectRequest: { pageIndex: 1 } }),
      postInspectRender: async () => { throw authErr; },
    })),
    (e) => e === authErr,
  );
});
