import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '@/lib/env';
import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { creditHoldRepo } from '@/db/repos/credit-hold-repo';
import { jobService } from '@/services/job/job-service';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { POST } from './route';

// End-to-end through the actual callback entrypoint: AGENT_SHARED_SECRET auth,
// V2Callback parse, the jobKind/requestId cross-check, and dispatch to the right
// jobService branch. rebuild-tech-plan.md §1.1 / §11.

const DRAFT = {
  version: 'v2',
  meta: { style: 'warm-film', language: 'en' },
  photoPool: [],
  basePages: {
    cover: { pageIndex: 0, templateId: 'mag-01', images: {}, texts: {} },
    ending: { pageIndex: 1, templateId: 'mag-03', images: {}, texts: {} },
  },
  chapters: [],
};
const LAYOUT = {
  magazine: { title: 'Routed Story', style: 'warm-film', language: 'en' },
  photos: [],
  pages: [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: {} }],
};
const USAGE = { durationMs: 1, models: {} };

function post(payload: unknown, secret: string = env.AGENT_SHARED_SECRET) {
  return POST(
    new Request('http://web.test/api/v2/internal/job-progress', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

async function seed(userId: string, kind: 'init' | 'finalize', draftJson?: unknown) {
  const album = await makeAlbum(userId);
  if (draftJson !== undefined) await albumRepo.update(db, album.id, { draftJson });
  const hold = await creditHoldRepo.create(db, { userId, albumId: album.id, amount: 10, status: 'HOLDING' });
  await albumRepo.update(db, album.id, { creditHoldId: hold.id });
  const requestId = `route-${kind}-${Date.now()}-${Math.round(performance.now())}`;
  await jobService.createV2(db, { userId, albumId: album.id, requestId, kind });
  return { albumId: album.id, holdId: hold.id, requestId };
}

test('rejects a wrong shared secret with 401', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const res = await post({ requestId: 'x', jobKind: 'init', event: 'failed', error: { code: 'X', message: 'm' } }, 'wrong');
  assert.equal(res.status, 401);
});

test('unknown requestId → accepted:false, nothing written', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const res = await post({ requestId: 'no-such-req', jobKind: 'finalize', event: 'completed', layout: LAYOUT, usage: USAGE });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data, { accepted: false });
});

test('init/completed routes to the init branch → draft_json + EDITING', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('route-init');
  try {
    const { albumId, requestId } = await seed(user.id, 'init');
    const res = await post({ requestId, jobKind: 'init', event: 'completed', draftTree: DRAFT, usage: USAGE });
    assert.equal((await res.json()).data.accepted, true);

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING');
    assert.deepEqual(album?.draftJson, DRAFT);
    assert.equal(album?.layoutJson, null);
  } finally {
    await cleanupUser(user.id);
  }
});

test('finalize/completed routes to the finalize branch → layout_json, no charge (§6.7 charge-at-init)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('route-final');
  try {
    const { albumId, holdId, requestId } = await seed(user.id, 'finalize', DRAFT);
    const res = await post({ requestId, jobKind: 'finalize', event: 'completed', layout: LAYOUT, usage: USAGE });
    assert.equal((await res.json()).data.accepted, true);

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING');
    assert.ok(album?.layoutJson);
    // Finalize re-renders only — the charge already settled at init, so it must not touch the hold.
    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING');
  } finally {
    await cleanupUser(user.id);
  }
});

test('jobKind mismatch (finalize payload to an init job) is dropped, no DB change', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('route-mismatch');
  try {
    const { albumId, holdId, requestId } = await seed(user.id, 'init');
    // init job, finalize-shaped completed payload → route must drop it.
    const res = await post({ requestId, jobKind: 'finalize', event: 'completed', layout: LAYOUT, usage: USAGE });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { accepted: false });

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'AGENT_RUNNING', 'mismatched callback must not advance the album');
    assert.equal(album?.layoutJson, null);
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'QUEUED');
    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING');
  } finally {
    await cleanupUser(user.id);
  }
});
