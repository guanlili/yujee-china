import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/client';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
import type { NewAgentJob } from '../../db/schema';
import { albumMessageRepo } from '../../db/repos/album-message-repo';
import { albumPageRepo } from '../../db/repos/album-page-repo';
import { draftPageRepo } from '../../db/repos/draft-page-repo';
import { albumRepo } from '../../db/repos/album-repo';
import { creditHoldRepo } from '../../db/repos/credit-hold-repo';
import { agentClient } from '../../lib/agent/agent-client';
import {
  cleanupUser,
  isDbReachable,
  makeAlbum,
  makeUser,
} from '../../db/repos/__test__/setup';
import { albumService, isDefaultAlbumTitle } from './album-service';
import { transientPagePhotoRefs } from './page-photo-refs';
import { jobService } from '../job/job-service';
import {
  V3InternalAgentDataResponse,
  type Page,
  type V3StoryDraft,
} from '@yujee/contracts';

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

// §3 2026-07 口径:坐标(lat/lng/GPS)任何形式仍严禁;城市级地名文字(place)已放开
// (V3Chapter.place,浏览器本地反查,坐标不出浏览器),故 place 不在禁键之列。
function hasForbiddenLocationKey(value: unknown): boolean {
  const forbidden = new Set(['location', 'gps', 'lat', 'lng', 'coordinates']);
  if (Array.isArray(value)) return value.some(hasForbiddenLocationKey);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, child]) => forbidden.has(key.toLowerCase()) || hasForbiddenLocationKey(child),
    );
  }
  return false;
}

// Sets up an AGENT_RUNNING album with a held credit and a RUNNING job whose
// startedAt is `startedAgoMs` in the past. Returns the ids for assertions.
// `kind` defaults to 'init' (the only kind that fails the album + releases the
// hold on sweep); pass 'compose'/'layout'/'add' to exercise the other branches.
async function runningAlbumWithJob(
  userId: string,
  startedAgoMs: number,
  kind?: NewAgentJob['kind'],
) {
  const album = await makeAlbum(userId);
  const hold = await creditHoldRepo.create(db, {
    userId,
    albumId: album.id,
    amount: 10,
    status: 'HOLDING',
  });
  await albumRepo.update(db, album.id, { creditHoldId: hold.id });
  const job = await agentJobRepo.create(db, {
    userId,
    albumId: album.id,
    requestId: `album-svc-${Date.now()}-${Math.round(startedAgoMs)}`,
    status: 'QUEUED',
    progress: 0,
    ...(kind ? { kind } : {}),
  });
  await agentJobRepo.update(db, job.id, {
    status: 'RUNNING',
    stage: 'vision',
    progress: 30,
    startedAt: new Date(Date.now() - startedAgoMs),
  });
  return { album, hold, job };
}


// C 方案:落库页面带烘出的 html;槽位断言剥掉它逐一比对。
function stripPagesHtml(pages: unknown): unknown {
  if (!Array.isArray(pages)) return pages;
  return pages.map((p) => {
    const { html: _html, ...rest } = p as Record<string, unknown>;
    return rest;
  });
}

test('getDetail: fresh RUNNING job → surfaces live stage/progress, no sweep', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('detail-fresh');
  try {
    const { album, hold } = await runningAlbumWithJob(user.id, 10 * 1000); // started 10s ago

    const detail = await albumService.getDetail(user.id, album.id);

    assert.equal(detail.album.status, 'AGENT_RUNNING');
    assert.deepEqual(detail.generation, { stage: 'vision', progress: 30 });
    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'HOLDING'); // untouched
  } finally {
    await cleanupUser(user.id);
  }
});

// 解耦后 select-layout 是独立 layout job,相册仍 EDITING;编辑器/轮询靠这里透出的
// stage=layout 知道排版还在跑,等 completed 落 pages —— 所以 EDITING 下也必须透出在跑
// layout job 的进度。
test('getDetail: EDITING album with a running layout job → surfaces layout stage/progress', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('detail-editing-layout');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story' });
    const job = await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId: `album-svc-layout-${Date.now()}`,
      status: 'QUEUED',
      progress: 0,
    });
    await agentJobRepo.update(db, job.id, {
      status: 'RUNNING',
      stage: 'layout',
      progress: 40,
      startedAt: new Date(), // 刚上报 → 不会被扫僵尸
    });

    const detail = await albumService.getDetail(user.id, album.id);
    assert.equal(detail.album.status, 'EDITING');
    assert.deepEqual(detail.generation, { stage: 'layout', progress: 40 });
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDetail: EDITING album with only a completed init job → generation stays null', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('detail-editing-idle');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story' });
    const job = await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId: `album-svc-init-${Date.now()}`,
      status: 'QUEUED',
      progress: 0,
    });
    await agentJobRepo.update(db, job.id, {
      status: 'COMPLETED',
      stage: 'wrap',
      progress: 100,
      completedAt: new Date(),
    });

    const detail = await albumService.getDetail(user.id, album.id);
    assert.equal(detail.generation, null, '采访态(无在跑 layout job)不该冒出 generation');
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDetail: stale RUNNING job → opportunistic sweep to FAILED + credit released', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('detail-stale');
  try {
    const { album, hold, job } = await runningAlbumWithJob(user.id, 60 * 60 * 1000); // 1h ago

    const detail = await albumService.getDetail(user.id, album.id);

    assert.equal(detail.album.status, 'FAILED');
    assert.equal(detail.generation, null);
    assert.match(detail.album.errorMessage ?? '', /timed out/i);

    const jobAfter = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(jobAfter?.status, 'FAILED');
    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'RELEASED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDetail: a job that started long ago but just reported progress is NOT swept (heartbeat)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('detail-heartbeat');
  try {
    const { album, hold, job } = await runningAlbumWithJob(user.id, 60 * 60 * 1000); // started 1h ago
    // A fresh progress callback refreshes startedAt — the liveness heartbeat.
    await jobService.handleProgress(job.requestId, 'skeleton', 80);

    const detail = await albumService.getDetail(user.id, album.id);

    assert.equal(detail.album.status, 'AGENT_RUNNING'); // NOT swept despite old start
    assert.deepEqual(detail.generation, { stage: 'skeleton', progress: 80 });
    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'HOLDING');
  } finally {
    await cleanupUser(user.id);
  }
});

test('sweepStaleJob: re-check under lock declines a job with a fresh heartbeat', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('sweep-recheck');
  try {
    const { album, hold, job } = await runningAlbumWithJob(user.id, 10 * 1000); // fresh: 10s ago

    const res = await jobService.sweepStaleJob(job.id, new Date());

    assert.deepEqual(res, { swept: false, releasedHold: false });
    assert.equal((await albumRepo.findById(album.id))?.status, 'AGENT_RUNNING');
    assert.equal((await creditHoldRepo.findById(hold.id))?.status, 'HOLDING');
  } finally {
    await cleanupUser(user.id);
  }
});

test('sweepStaleJob: compose job kind-aware timeout — 6min RUNNING not yet stale (12min compose default)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('sweep-compose-fresh');
  try {
    const { job } = await runningAlbumWithJob(user.id, 6 * 60 * 1000, 'compose'); // 6 min ago

    // No timeoutMs passed — must fall back to zombieTimeoutMsFor('compose') = 12 min,
    // not the 10 min cross-kind default. This is the regression the Important review
    // finding pinned: zombie-sweeper used to override this with a flat 10 min.
    const res = await jobService.sweepStaleJob(job.id, new Date());

    assert.deepEqual(res, { swept: false, releasedHold: false });
    const jobAfter = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(jobAfter?.status, 'RUNNING');
  } finally {
    await cleanupUser(user.id);
  }
});

test('sweepStaleJob: compose job kind-aware timeout — 13min RUNNING is swept (past 12min compose default)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('sweep-compose-stale');
  try {
    const { job } = await runningAlbumWithJob(user.id, 13 * 60 * 1000, 'compose'); // 13 min ago

    const res = await jobService.sweepStaleJob(job.id, new Date());

    assert.deepEqual(res, { swept: true, releasedHold: false });
    const jobAfter = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(jobAfter?.status, 'FAILED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('sweepStaleJob: control — non-compose job kind still uses the 5min default and is swept at 6min', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('sweep-init-6min');
  try {
    const { job } = await runningAlbumWithJob(user.id, 6 * 60 * 1000, 'init'); // 6 min ago

    const res = await jobService.sweepStaleJob(job.id, new Date());

    assert.equal(res.swept, true);
    const jobAfter = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(jobAfter?.status, 'FAILED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('listByUser: stale RUNNING album is swept to FAILED on the list path too', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('list-stale');
  try {
    const { album, hold } = await runningAlbumWithJob(user.id, 60 * 60 * 1000);

    const rows = await albumService.listByUser(user.id);
    const row = rows.find((r) => r.id === album.id);
    assert.equal(row?.status, 'FAILED');

    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'RELEASED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('listByUser: includes only the first page cover data for card previews', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('list-cover-page');
  try {
    const album = await makeAlbum(user.id, { title: 'Cover Album' });
    await albumRepo.update(db, album.id, { status: 'EDITING', pageCount: 2 });
    await albumPageRepo.bulkInsert(db, [
      {
        albumId: album.id,
        pageIndex: 0,
        templateId: 'mag-01',
        imagesJson: { hero: 'photo-cover' },
        textsJson: { title: 'Cover Title' },
      },
      {
        albumId: album.id,
        pageIndex: 1,
        templateId: 'mag-02',
        imagesJson: { hero: 'photo-second' },
        textsJson: { title: 'Second Page' },
      },
    ]);

    const rows = await albumService.listByUser(user.id);
    const row = rows.find((r) => r.id === album.id);

    assert.deepEqual(row?.coverPage, {
      pageIndex: 0,
      templateId: 'mag-01',
      imagesJson: { hero: 'photo-cover' },
      textsJson: { title: 'Cover Title' },
      imagePosJson: {},
    });
    assert.equal(
      (row as { coverThumbnailUrl?: string | null } | undefined)?.coverThumbnailUrl,
      null,
      'list payload always exposes persisted derived cover URL, even before one is uploaded',
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('listByUser: coverless draft album exposes fallbackPhotoIds from its draft', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('list-cover-fallback');
  try {
    const album = await makeAlbum(user.id, { title: 'Draft Album' });
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      draftJson: {
        version: 'v3-story',
        tree: {
          chapters: [
            { chapterId: 'ch_1', photos: [{ photoId: 'p-tree-1' }, { photoId: 'p-tree-2' }] },
          ],
        },
        // 草稿已排版页的图槽优先于章节原图。
        pages: [{ templateId: 'mag-01', images: { hero: 'p-page-1' }, texts: {} }],
      },
    });

    const rows = await albumService.listByUser(user.id);
    const row = rows.find((r) => r.id === album.id);

    assert.equal(row?.coverPage, null);
    assert.deepEqual(row?.fallbackPhotoIds, ['p-page-1', 'p-tree-1', 'p-tree-2']);
  } finally {
    await cleanupUser(user.id);
  }
});

test('fallbackCoverPhotoIds: 残缺/非法草稿返回空,数量按 cap 截断、跨来源去重', () => {
  assert.deepEqual(albumService.fallbackCoverPhotoIds(null), []);
  assert.deepEqual(albumService.fallbackCoverPhotoIds('junk'), []);
  assert.deepEqual(albumService.fallbackCoverPhotoIds({ tree: {} }), []);
  const many = {
    tree: {
      chapters: [{ photos: Array.from({ length: 12 }, (_, i) => ({ photoId: `p${i}` })) }],
    },
  };
  assert.equal(albumService.fallbackCoverPhotoIds(many).length, 8);
  assert.deepEqual(
    albumService.fallbackCoverPhotoIds({
      tree: { chapters: [{ photos: [{ photoId: 'dup' }] }] },
      pages: [{ images: { a: 'dup' } }],
    }),
    ['dup'],
  );
});

test('updateTitle: renames an owned album (trimmed)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('title-rename');
  try {
    const album = await makeAlbum(user.id, { title: 'Old Title' });

    const result = await albumService.updateTitle(user.id, album.id, '  New Title  ');
    assert.equal(result.title, 'New Title');

    const after = await albumRepo.findById(album.id);
    assert.equal(after?.title, 'New Title');
  } finally {
    await cleanupUser(user.id);
  }
});

test('updateTitle: rejects a blank title', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('title-blank');
  try {
    const album = await makeAlbum(user.id, { title: 'Keep Me' });

    await assert.rejects(
      () => albumService.updateTitle(user.id, album.id, '   '),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
    const after = await albumRepo.findById(album.id);
    assert.equal(after?.title, 'Keep Me'); // unchanged
  } finally {
    await cleanupUser(user.id);
  }
});

test('updateTitle: rejects a non-owner with ALBUM_NOT_OWNED', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const owner = await makeUser('title-owner');
  const intruder = await makeUser('title-intruder');
  try {
    const album = await makeAlbum(owner.id, { title: 'Owned' });

    await assert.rejects(
      () => albumService.updateTitle(intruder.id, album.id, 'Hijacked'),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_OWNED',
    );
    const after = await albumRepo.findById(album.id);
    assert.equal(after?.title, 'Owned'); // unchanged
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
  }
});

// ── getDraftSkeleton — read-only RENDER projection of V3 draft_json ──

async function seedDraftAlbum(userId: string) {
  const album = await makeAlbum(userId);
  await albumRepo.update(db, album.id, {
    status: 'EDITING',
    stage: 'story',
    draftJson: {
      chapters: [
        {
          chapterId: 'c1',
          title: '',
          description: 'first',
          accentColor: null,
          artFont: null,
          chapterContext: "",
          place: '',
          keywords: [],
          photos: [{ photoId: 'p1', sceneDescription: 'sea', width: 800, height: 600, orientation: 'landscape' }],
        },
      ],
      pages: [
        { pageIndex: 0, templateId: 'mag-01', images: { hero: 'p1' }, texts: { title: 'Cover' } },
        { pageIndex: 1, templateId: 'mag-05', images: { hero: 'p1' }, texts: { body: 'First' } },
      ],
    },
  });
  return album.id;
}

test('getDraftSkeleton: still renders a V3 draft after PDF export marks it COMPLETED (layoutJson null)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('w10-v3-completed-draft');
  try {
    const albumId = await seedDraftAlbum(user.id);
    // PDF 导出把 V3 草稿相册标 COMPLETED,但 layoutJson 仍为 null、页面仍只在 draft_json。
    // 打开时必须仍能拿到 skeleton(否则书「消失」)——不因导出而丢草稿。
    await albumRepo.update(db, albumId, { status: 'COMPLETED' });

    const sk = await albumService.getDraftSkeleton(user.id, albumId);
    assert.ok(sk, 'a COMPLETED V3 draft album must still render its skeleton');
    assert.deepEqual(sk!.pages.map((p) => p.pageIndex), [0, 1]);
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDraftSkeleton: renders V3 tree+pages draft without dropping preview pages', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('w10-v3-skeleton');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: {
        chapters: [
          {
            chapterId: 'c1',
            title: '',
            description: 'first',
            accentColor: null,
            artFont: null,
            chapterContext: "",
            place: '',
            keywords: [],
            photos: [{ photoId: 'p1', sceneDescription: 'sea', width: 800, height: 600, orientation: 'landscape' }],
          },
          {
            chapterId: 'c2',
            title: '',
            description: 'second',
            accentColor: null,
            artFont: null,
            chapterContext: "",
            place: '',
            keywords: [],
            photos: [{ photoId: 'p2', sceneDescription: 'city', width: 600, height: 800, orientation: 'portrait' }],
          },
        ],
        pages: [
          { pageIndex: 0, templateId: 'mag-01', images: { hero: 'p1' }, texts: { title: 'Cover' } },
          { pageIndex: 1, templateId: 'mag-05', images: { hero: 'p1' }, texts: { body: 'First' } },
          { pageIndex: 2, templateId: 'mag-06', images: { hero: 'p2' }, texts: { body: 'Second' } },
          { pageIndex: 3, templateId: 'mag-20', images: {}, texts: { end: 'End' } },
        ],
      },
    });

    const sk = await albumService.getDraftSkeleton(user.id, album.id);
    assert.ok(sk);
    assert.deepEqual(sk!.pages.map((p) => p.pageIndex), [0, 1, 2, 3]);
    assert.deepEqual(
      sk!.pages.map((p) => p.kind),
      ['cover', 'chapter', 'chapter', 'ending'],
    );
    assert.equal(sk!.pages[1]!.chapterId, 'c1');
    assert.equal(sk!.pages[2]!.chapterId, 'c2');
    assert.deepEqual(
      sk!.chapters.map((ch) => ({ id: ch.chapterId, start: ch.pageStart, end: ch.pageEnd })),
      [
        { id: 'c1', start: 1, end: 2 },
        { id: 'c2', start: 2, end: 3 },
      ],
    );
    assert.equal(sk!.language, 'en');
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDraftSkeleton: V3 body-only preview keeps first/last pages mapped to chapters', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('w10-v3-body-only');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: {
        chapters: [
          {
            chapterId: 'c1',
            title: '',
            description: 'first',
            accentColor: null,
            artFont: null,
            chapterContext: "",
            place: '',
            keywords: [],
            photos: [{ photoId: 'p1', sceneDescription: 'sea', width: 800, height: 600, orientation: 'landscape' }],
          },
          {
            chapterId: 'c2',
            title: '',
            description: 'second',
            accentColor: null,
            artFont: null,
            chapterContext: "",
            place: '',
            keywords: [],
            photos: [{ photoId: 'p2', sceneDescription: 'city', width: 600, height: 800, orientation: 'portrait' }],
          },
        ],
        pages: [
          { pageIndex: 0, templateId: 'mag-05', images: { hero: 'p1' }, texts: { body: 'First' } },
          { pageIndex: 1, templateId: 'mag-06', images: { hero: 'p2' }, texts: { body: 'Second' } },
        ],
      },
    });

    const sk = await albumService.getDraftSkeleton(user.id, album.id);
    assert.ok(sk);
    assert.deepEqual(sk!.pages.map((p) => p.kind), ['chapter', 'chapter']);
    assert.deepEqual(sk!.pages.map((p) => p.chapterId), ['c1', 'c2']);
    assert.deepEqual(
      sk!.chapters.map((ch) => ({ id: ch.chapterId, start: ch.pageStart, end: ch.pageEnd })),
      [
        { id: 'c1', start: 0, end: 1 },
        { id: 'c2', start: 1, end: 2 },
      ],
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDraftSkeleton: null once finalized (layout_json set)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('w10-skeleton-final');
  try {
    const albumId = await seedDraftAlbum(user.id);
    await albumRepo.update(db, albumId, {
      layoutJson: { version: 1, style: 'warm-film', summary: '', photos: [], pages: [] },
    });
    const sk = await albumService.getDraftSkeleton(user.id, albumId);
    assert.equal(sk, null);
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDraftSkeleton: rejects a non-owner', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const owner = await makeUser('w10-skeleton-owner');
  const intruder = await makeUser('w10-skeleton-intruder');
  try {
    const albumId = await seedDraftAlbum(owner.id);
    await assert.rejects(
      () => albumService.getDraftSkeleton(intruder.id, albumId),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_OWNED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
  }
});

// ──────────────── ② 章节故事完成度闸门 (WP2.4 / #188) ────────────────

function makeStoryTree(n: number) {
  return {
    chapters: Array.from({ length: n }, (_, i) => ({
      chapterId: `c${i + 1}`,
      title: '',
      description: `chapter ${i + 1}`,
      accentColor: null,
      artFont: null,
      chapterContext: "",
      place: '',
      keywords: [],
      photos: [],
    })),
  };
}

function makePreviewPages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    pageIndex: i,
    templateId: 'mag-02',
    images: {},
    texts: { headline: `chapter ${i + 1}` },
  }));
}

// V3 story draft: current main stores the preview pages next to the tree
// (`{ chapters, pages }`) after analyze-completed. The album is put in EDITING +
// stage='story'.
async function seedStoryAlbum(userId: string, n: number) {
  const album = await makeAlbum(userId);
  const tree = makeStoryTree(n);
  const pages = makePreviewPages(n);
  await albumRepo.update(db, album.id, {
    status: 'EDITING',
    stage: 'story',
    draftJson: { ...tree, pages },
  });
  return album.id;
}

async function seedWrappedStoryAlbum(
  userId: string,
  chapters: number,
  opts: {
    pages?: Page[];
    done?: boolean;
    stage?: 'analysing' | 'story' | 'theme' | 'cover' | 'ready';
  } = {},
) {
  const album = await makeAlbum(userId);
  const tree = makeStoryTree(chapters);
  const chapterIds = tree.chapters.map((chapter) => chapter.chapterId);
  const pages = opts.pages ?? makePreviewPages(chapters);
  const wrapped: V3StoryDraft = {
    version: 'v3-story',
    tree,
    pages,
    progress: {
      currentChapterId: opts.done ? null : chapterIds[0] ?? null,
      doneChapterIds: opts.done ? chapterIds : [],
    },
  };
  await albumRepo.update(db, album.id, {
    status: 'EDITING',
    stage: opts.stage ?? (opts.done ? 'theme' : 'story'),
    draftJson: wrapped,
  });
  return { albumId: album.id, pages };
}

test('getStoryProgress: current tree+pages draft → first chapter current, none done, export locked', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp24-progress-bare');
  try {
    const albumId = await seedStoryAlbum(user.id, 3);
    const p = await albumService.getStoryProgress(user.id, albumId);
    assert.equal(p.stage, 'story');
    assert.deepEqual(p.chapterOrder, ['c1', 'c2', 'c3']);
    assert.deepEqual(p.doneChapterIds, []);
    assert.equal(p.currentChapterId, 'c1');
    assert.equal(p.allDone, false);
    assert.equal(p.exportUnlocked, false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('getStoryProgress: legacy bare tree remains readable', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp24-progress-bare');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: makeStoryTree(2),
    });
    const p = await albumService.getStoryProgress(user.id, album.id);
    assert.deepEqual(p.chapterOrder, ['c1', 'c2']);
    assert.equal(p.currentChapterId, 'c1');
    assert.equal(p.exportUnlocked, false);
  } finally {
    await cleanupUser(user.id);
  }
});

// 排版续跑止血:getStoryProgress 透出 layoutState —— 有在跑的 layout job(QUEUED/RUNNING)
// → 'running';否则最近一条 layout job FAILED → 'failed';都没有 → 'idle'。ChatPanel 重进
// 时据此决定"接着等 / 自动重排 / 不动"。
test('getStoryProgress: layoutState reflects the latest layout job (idle / running / failed)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp-layout-state');
  try {
    // idle:相册没有任何 layout job。
    const idleId = await seedStoryAlbum(user.id, 1);
    assert.equal((await albumService.getStoryProgress(user.id, idleId)).layoutState, 'idle');

    // running:有一个 QUEUED→RUNNING 的 layout job。
    const runningId = await seedStoryAlbum(user.id, 1);
    const runningJob = await agentJobRepo.create(db, {
      userId: user.id,
      albumId: runningId,
      requestId: `ls-run-${Date.now()}`,
      kind: 'layout',
      status: 'QUEUED',
      progress: 0,
    });
    await jobService.markRunning(db, runningJob.id);
    assert.equal((await albumService.getStoryProgress(user.id, runningId)).layoutState, 'running');

    // failed:没有在跑的 layout job,但最近一条 layout job 是 FAILED。
    const failedId = await seedStoryAlbum(user.id, 1);
    await agentJobRepo.create(db, {
      userId: user.id,
      albumId: failedId,
      requestId: `ls-fail-${Date.now()}`,
      kind: 'layout',
      status: 'FAILED',
      progress: 0,
    });
    assert.equal((await albumService.getStoryProgress(user.id, failedId)).layoutState, 'failed');
  } finally {
    await cleanupUser(user.id);
  }
});

test('markChapterDone: advances cursor; last chapter → stage=theme + export unlocked', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp24-confirm-flow');
  try {
    const albumId = await seedStoryAlbum(user.id, 2);

    const a = await albumService.markChapterDone(user.id, albumId, 'c1');
    assert.deepEqual(a.doneChapterIds, ['c1']);
    assert.equal(a.currentChapterId, 'c2'); // cursor moved to next not-done
    assert.equal(a.allDone, false);
    assert.equal(a.stage, 'story'); // not yet all done → stage unchanged
    assert.equal(a.exportUnlocked, false);
    // draft_pages 拆表(Phase 1a)Task 7:markChapterDone 不再搬运 pages —— 它现在只
    // 重写 envelope(envelopeJson)。`seedStoryAlbum` 这里手写的 legacy 裸树 pages 字段
    // 没有被静默丢弃:写回前先 ensureDraftPagesSeeded(全局写序无例外),把它们原样
    // 播种进 draft_pages 行,draftJson 才不再需要携带 pages 键(专门的 "legacy 播种"
    // 用例见下方,直接断言行内容 + revision 0→1;这里只钉 draftJson 形状本身)。
    const afterFirst = await albumRepo.findById(albumId);
    assert.equal(
      'pages' in (afterFirst!.draftJson as object),
      false,
      'markChapterDone 只重写 envelope,不再把 pages 搬回 draftJson(此时已经播种进 draft_pages 行)',
    );

    const b = await albumService.markChapterDone(user.id, albumId, 'c2');
    assert.deepEqual(b.doneChapterIds, ['c1', 'c2']);
    assert.equal(b.currentChapterId, null); // all done
    assert.equal(b.allDone, true);
    assert.equal(b.stage, 'theme'); // 全章确定 → 进下一环
    // 2026-07 收紧:设计(stage=ready)才是导出钥匙,全章 done 仅是必要条件。
    assert.equal(b.exportUnlocked, false);

    // Persisted: re-reading shows theme + unlocked; status untouched (⟂ stage).
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'theme');
    assert.equal(reloaded?.status, 'EDITING'); // markChapterDone never touches status

    const p = await albumService.getStoryProgress(user.id, albumId);
    assert.equal(p.exportUnlocked, false); // 设计未做,仍锁
    assert.equal(p.allDone, true);

    // 设计完成(stage=ready)后才解锁 —— 直接落 stage 模拟 applyDesign 的推进。
    await albumRepo.update(db, albumId, { stage: 'ready' });
    const afterDesign = await albumService.getStoryProgress(user.id, albumId);
    assert.equal(afterDesign.exportUnlocked, true);
  } finally {
    await cleanupUser(user.id);
  }
});

test('getStoryProgress: stale later stage does not unlock export unless every chapter is done', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp24-stage-not-enough');
  try {
    const albumId = await seedStoryAlbum(user.id, 2);
    await albumService.markChapterDone(user.id, albumId, 'c1');
    await albumRepo.update(db, albumId, { stage: 'cover' });

    const p = await albumService.getStoryProgress(user.id, albumId);
    assert.equal(p.stage, 'cover');
    assert.equal(p.allDone, false);
    assert.equal(p.exportUnlocked, false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('markChapterDone: idempotent re-confirm does not double-advance', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp24-idempotent');
  try {
    const albumId = await seedStoryAlbum(user.id, 2);
    await albumService.markChapterDone(user.id, albumId, 'c1');
    const again = await albumService.markChapterDone(user.id, albumId, 'c1');
    assert.deepEqual(again.doneChapterIds, ['c1']); // still just c1
    assert.equal(again.currentChapterId, 'c2');
    assert.equal(again.stage, 'story');
  } finally {
    await cleanupUser(user.id);
  }
});

test('markChapterDone: rejects confirming a later chapter before the current one', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp24-strict-order');
  try {
    const albumId = await seedStoryAlbum(user.id, 3);

    await assert.rejects(
      () => albumService.markChapterDone(user.id, albumId, 'c2'),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
    let p = await albumService.getStoryProgress(user.id, albumId);
    assert.deepEqual(p.doneChapterIds, []);
    assert.equal(p.currentChapterId, 'c1');
    assert.equal(p.exportUnlocked, false);

    await albumService.markChapterDone(user.id, albumId, 'c1');
    await assert.rejects(
      () => albumService.markChapterDone(user.id, albumId, 'c3'),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
    p = await albumService.getStoryProgress(user.id, albumId);
    assert.deepEqual(p.doneChapterIds, ['c1']);
    assert.equal(p.currentChapterId, 'c2');
    assert.equal(p.exportUnlocked, false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('markChapterDone: after gate opened (stage past story) is a no-op', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp24-postgate');
  try {
    const albumId = await seedStoryAlbum(user.id, 1);
    await albumService.markChapterDone(user.id, albumId, 'c1'); // → theme
    await albumRepo.update(db, albumId, { stage: 'cover' }); // user moved further on
    const after = await albumService.markChapterDone(user.id, albumId, 'c1');
    assert.equal(after.stage, 'cover'); // no regression
    assert.equal(after.exportUnlocked, false); // cover ≠ ready:设计未完成仍锁
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'cover');
  } finally {
    await cleanupUser(user.id);
  }
});

test('applyDesign: 派发 compose job(不再同步成稿),回调到达才推 stage story → ready', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('design-stage-ready');
  try {
    const { TEMPLATES } = await import('@yujee/contracts');
    const templates = Object.values(TEMPLATES) as Array<{ id: string; category?: string; texts?: unknown[] }>;
    const coverId = templates.find((tp) => tp.category === 'cover')!.id;
    const endingId = templates.find((tp) => tp.category === 'ending')!.id;

    const album = await makeAlbum(user.id);
    const tree = {
      chapters: [
        {
          chapterId: 'c1',
          title: '',
          description: 'chapter 1',
          accentColor: null,
          artFont: null,
          chapterContext: '',
          place: '',
          keywords: [],
          photos: [
            { photoId: 'p1', sceneDescription: '', width: 800, height: 600, orientation: 'landscape' },
          ],
        },
      ],
    };
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: {
        version: 'v3-story',
        tree,
        pages: makePreviewPages(1),
        // 故意留一章未 done:成稿回调应把现存章节全部记 done,
        // 导出闸门(allDone && ready)随之打开 —— 用户口径:选完封面导出即可用。
        progress: { currentChapterId: 'c1', doneChapterIds: [] },
      },
    });

    const submitted: unknown[] = [];
    t.mock.method(agentClient, 'submitComposeV3', async (payload: { requestId: string }) => {
      submitted.push(payload);
      return { requestId: payload.requestId };
    });

    const dispatched = await albumService.applyDesign(user.id, album.id, {
      language: 'zh',
      coverTemplateId: coverId,
      coverPhotoId: 'p1',
      endingTemplateId: endingId,
      endingPhotoId: 'p1',
      refs: { p1: 'data:image/jpeg;base64,AA==' },
    });

    // 派发只建 job + 提交,不组页、不推 stage —— 成稿要几十秒,同步接口撑不住。
    assert.equal(dispatched.accepted, true);
    assert.equal(submitted.length, 1);
    const midway = await albumRepo.findById(album.id);
    assert.equal(midway?.stage, 'story');
    const job = await agentJobRepo.findByRequestId(dispatched.requestId);
    assert.equal(job?.kind, 'compose');
    assert.equal(job?.status, 'RUNNING');

    // 回调到达 → 组页落库 + stage='ready'(唯一推进点)。
    await jobService.handleV3ComposeCompleted(
      dispatched.requestId,
      { coverTexts: { title: '我的一年' } },
      { durationMs: 1, models: {} },
    );

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.stage, 'ready'); // 设计完成 = 导出闸门钥匙
    const progress = await albumService.getStoryProgress(user.id, album.id);
    assert.equal(progress.exportUnlocked, true);
  } finally {
    await cleanupUser(user.id);
  }
});

test('markChapterDone: unknown chapterId → VALIDATION_FAILED', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp24-badchapter');
  try {
    const albumId = await seedStoryAlbum(user.id, 2);
    await assert.rejects(
      () => albumService.markChapterDone(user.id, albumId, 'nope'),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
  } finally {
    await cleanupUser(user.id);
  }
});

// draft_pages 拆表(Phase 1a)Task 7 回归守卫:markChapterDone 此前无锁、事务外读,
// 且把当时读到的 pages 整块搬回 draftJson —— 与并发的 updatePage(已切行级写)互吃时,
// 陈旧的搬运会把用户刚落的行级改动盖掉。现在 markChapterDone 只重写 envelope,从不
// 碰 draft_pages,行改动必须原封不动幸存;draft_revision 也不该跟着推进(页没变)。
test('markChapterDone: 先 updatePage 改一页,该页改动在 markChapterDone 之后完整幸存(不搬运/不覆盖 draft_pages 行,不推进 draftRevision)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('confirm-page-survive');
  try {
    const { albumId } = await seedWrappedStoryAlbum(user.id, 2, { stage: 'story' });

    await albumService.updatePage(user.id, albumId, 0, { textsJson: { headline: '编辑过的正文' } });

    const afterUpdate = await albumRepo.findById(albumId);
    const rowsAfterUpdate = await draftPageRepo.findByAlbum(albumId);
    const snapshot = rowsAfterUpdate.map((r) => ({
      pageIndex: r.pageIndex,
      version: r.version,
      updatedBy: r.updatedBy,
      page: r.page,
    }));

    const result = await albumService.markChapterDone(user.id, albumId, 'c1');
    assert.deepEqual(result.doneChapterIds, ['c1']);

    const afterConfirm = await albumRepo.findById(albumId);
    const rowsAfterConfirm = await draftPageRepo.findByAlbum(albumId);

    assert.equal(
      afterConfirm!.draftRevision,
      afterUpdate!.draftRevision,
      'markChapterDone 不 bump draft_revision(页没变)',
    );
    assert.deepEqual(
      rowsAfterConfirm.map((r) => ({ pageIndex: r.pageIndex, version: r.version, updatedBy: r.updatedBy, page: r.page })),
      snapshot,
      'markChapterDone 不搬运/不覆盖 draft_pages 行,updatePage 的改动逐字幸存',
    );
  } finally {
    await cleanupUser(user.id);
  }
});

// 回归守卫(code review round 2):brief 原文「不碰 draft_pages」与计划 Global
// Constraints「每个 draft 写事务固定次序:行锁 → ensureDraftPagesSeeded → …」冲突 ——
// 后者是全局无例外规则。若一本相册从未被任何行级写点摸过,它唯一一份页仍只活在
// legacy draftJson.pages 里、draft_pages 一行都没有;不先播种就直接做 envelope-only
// 覆盖会把这份页连根拔掉。这里直接构造这种「零行」形态(不经 updatePage 等会先播种
// 的方法),证明 markChapterDone 会先把它们播种进 draft_pages 再重写 envelope。
test('markChapterDone: 相册的页仍只活在 legacy draftJson.pages(draft_pages 零行,未经任何行级写点播种),先播种再重写 envelope,不连根拔掉这份页', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('confirm-legacy-seed');
  try {
    const album = await makeAlbum(user.id);
    const legacyPages = makePreviewPages(2);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(2),
      pages: legacyPages,
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    };
    // 手写落库(不经 updatePage/reorderPages/… 任何会先播种的写点)。
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });
    assert.equal(await draftPageRepo.countByAlbum(album.id), 0, 'sanity: 播种前确实没有行');

    const result = await albumService.markChapterDone(user.id, album.id, 'c1');
    assert.deepEqual(result.doneChapterIds, ['c1']);

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(
      'pages' in (reloaded!.draftJson as object),
      false,
      'envelope-only 重写:draftJson 不带 pages 键',
    );

    // 页没有被 envelope-only 重写连带抹掉 —— 懒播种把它们原样搬进了 draft_pages 行。
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, legacyPages.length, '两页都没丢');
    assert.deepEqual(rows.map((r) => r.page), legacyPages, '内容逐字节不变(播种不烘 html)');
    assert.equal(
      reloaded!.draftRevision,
      1,
      '首次播种把 revision 从 0 立到 1(与 T3/T5 懒播种同口径),不是 markChapterDone 自己推进的',
    );
    for (const row of rows) {
      assert.equal(row.version, 1);
      assert.equal(row.updatedBy, null, '播种是系统动作,不是这次确认章节的用户写入');
    }
  } finally {
    await cleanupUser(user.id);
  }
});

test('getStoryProgress: rejects a non-owner', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const owner = await makeUser('wp24-owner');
  const intruder = await makeUser('wp24-intruder');
  try {
    const albumId = await seedStoryAlbum(owner.id, 1);
    await assert.rejects(
      () => albumService.getStoryProgress(intruder.id, albumId),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_OWNED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
  }
});

// ── ③ 主题/章节色-应用 (WP3.2 / #190) ─────────────────────────────────────────

const PATCH = [{ pageIndex: 0, texts: { divider: '#C0392B', title: 'X' } }];
const isValidationFailed = (err: { code?: string }) => err.code === 'VALIDATION_FAILED';

// Put a seeded story album at stage='theme' (the state apply-theme runs from).
async function seedThemeAlbum(userId: string, n: number) {
  const albumId = await seedStoryAlbum(userId, n);
  await albumRepo.update(db, albumId, { stage: 'theme' });
  return albumId;
}

// ──────────────────────────── ④ 书籍设计 — cover (WP4.1 #192) ────────────────
// The cover layoutPatch is page-level (templateId/images/texts), distinct from the
// theme patch — it carries the auto-filled cover/ending design handed back to the
// browser. Cover never writes the tree (§3 树边界); it only advances stage cover→ready.
const COVER_PATCH = [
  { pageIndex: 0, templateId: 'mag-01', images: { image: 'p1' }, texts: { folio: '01' } },
];

// Put a seeded story album at stage='cover' (the state the cover step runs from).
async function seedCoverAlbum(userId: string, n: number) {
  const albumId = await seedStoryAlbum(userId, n);
  await albumRepo.update(db, albumId, { stage: 'cover' });
  return albumId;
}

// ───────── ⑤ 待导出 — finalize (WP5.1 #194) ────────────────────────────────

// ───────── ② 章节故事 — chapterChatTurn server slice (缺口#20) ──────────────
//
// The browser holds no authoring tree (invariant 12): it sends only chapterId +
// history + userMessage; the service re-slices draft_json into the single-chapter
// V3ChapterChatRequest. These lock the load-bearing slice (one chapter node + only
// THAT chapter's pages) and the turn pass-through.

// Two chapters, each with one photo + one page referencing that photo, so the
// per-chapter page membership (images→photoId) has something to slice.
async function seedChapterChatAlbum(userId: string) {
  const album = await makeAlbum(userId);
  const tree = {
    chapters: [
      {
        chapterId: 'c1',
        title: '',
        description: 'chapter one',
        accentColor: null,
        artFont: null,
        chapterContext: "",
        place: '',
        keywords: [],
        photos: [{ photoId: 'p1', sceneDescription: 'beach', width: 800, height: 600, orientation: 'landscape' as const, takenAt: null }],
      },
      {
        chapterId: 'c2',
        title: '',
        description: 'chapter two',
        accentColor: null,
        artFont: null,
        chapterContext: "",
        place: '',
        keywords: [],
        photos: [{ photoId: 'p2', sceneDescription: 'street', width: 600, height: 800, orientation: 'portrait' as const, takenAt: null }],
      },
    ],
  };
  const pages: Page[] = [
    { pageIndex: 0, templateId: 'mag-02', images: { image: 'p1' }, texts: { headline: 'one' } },
    { pageIndex: 1, templateId: 'mag-02', images: { image: 'p2' }, texts: { headline: 'two' } },
  ];
  const wrapped: V3StoryDraft = {
    version: 'v3-story',
    tree,
    pages,
    progress: { currentChapterId: 'c1', doneChapterIds: [] },
  };
  await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });
  return album.id;
}

const chatUsage = { durationMs: 1, models: { planning: 'deepseek-chat' } };

test('章标签优先读 title,老树降级 description,都空才 Group N', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('chapter-label-fallback');
  try {
    const album = await makeAlbum(user.id);
    const photo = {
      photoId: 'p1',
      sceneDescription: '',
      width: 800,
      height: 600,
      orientation: 'landscape' as const,
      takenAt: null,
    };
    const base = {
      accentColor: null,
      artFont: null,
      chapterContext: '',
      place: '',
      keywords: [],
    };
    const draft = {
      version: 'v3-story',
      tree: {
        chapters: [
          // 新树:章标识落 title,description 是写目录环节的位置(此时为空)。
          { chapterId: 'c1', title: '2024 年 03 月 11–14 日', description: '', ...base, photos: [photo] },
          // 老树:draft_json 里根本没有 title 键,只能降级读 description。
          { chapterId: 'c2', description: '旧章标题', ...base, photos: [{ ...photo, photoId: 'p2' }] },
          // 两者都空:兜底 Group N。
          { chapterId: 'c3', description: '', ...base, photos: [{ ...photo, photoId: 'p3' }] },
        ],
      },
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    };
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: draft as unknown as V3StoryDraft,
    });

    const summary = await albumService.getChapterSummary(user.id, album.id);
    assert.deepEqual(
      summary.chapters.map((c) => c.label),
      ['2024 年 03 月 11–14 日', '旧章标题', 'Group 3'],
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('getInternalAgentData page-info and chapter-search return scoped draft data without location leakage', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('internal-agent-data-read');
  try {
    const album = await makeAlbum(user.id);
    const draft: V3StoryDraft = {
      version: 'v3-story',
      tree: {
        chapters: [
          {
            chapterId: 'c1',
            title: '2024 年 03 月 02 日',
            description: 'coast morning',
            accentColor: null,
            artFont: null,
            chapterContext: "",
            place: '',
            keywords: [],
            photos: [
              {
                photoId: 'p1',
                sceneDescription: 'coast sunrise',
                width: 800,
                height: 600,
                orientation: 'landscape',
                takenAt: '2024-03-02T10:20:30',
              },
              {
                photoId: 'p2',
                sceneDescription: 'coast details',
                width: 600,
                height: 800,
                orientation: 'portrait',
                takenAt: null,
              },
            ],
          },
          {
            chapterId: 'c2',
            title: '',
            description: 'city gallery',
            accentColor: null,
            artFont: null,
            chapterContext: "",
            place: '',
            keywords: [],
            photos: [
              {
                photoId: 'p3',
                sceneDescription: 'gallery wall',
                width: 800,
                height: 600,
                orientation: 'landscape',
              },
            ],
          },
        ],
      },
      pages: [
        { pageIndex: 0, templateId: 'mag-01', images: { hero: 'p1' }, texts: { title: 'Cover' } },
        { pageIndex: 1, templateId: 'mag-03', images: { image: 'p1' }, texts: { title: 'One' } },
        { pageIndex: 2, templateId: 'mag-04', images: { image: 'p2' }, texts: { title: 'Two' } },
        { pageIndex: 3, templateId: 'mag-03', images: { image: 'p3' }, texts: { title: 'Three' } },
        { pageIndex: 4, templateId: 'mag-20', images: { hero: 'p1' }, texts: { end: 'End' } },
      ],
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: draft });

    const chapterInfo = await albumService.getInternalAgentData({
      type: 'page-info',
      albumId: album.id,
      scope: 'chapter',
      chapterId: 'c1',
    });
    assert.equal(V3InternalAgentDataResponse.safeParse(chapterInfo).success, true);
    if (chapterInfo.type !== 'page-info') assert.fail(`unexpected response type ${chapterInfo.type}`);
    assert.equal(chapterInfo.data.chapter.chapterId, 'c1');
    assert.deepEqual(chapterInfo.data.pages.map((page) => page.pageIndex), [1, 2]);
    assert.equal(hasForbiddenLocationKey(chapterInfo), false);

    const pageInfo = await albumService.getInternalAgentData({
      type: 'page-info',
      albumId: album.id,
      scope: 'page',
      chapterId: 'c1',
      pageIndex: 2,
    });
    assert.equal(V3InternalAgentDataResponse.safeParse(pageInfo).success, true);
    if (pageInfo.type !== 'page-info') assert.fail(`unexpected response type ${pageInfo.type}`);
    assert.deepEqual(pageInfo.data.pages.map((page) => page.pageIndex), [2]);

    const search = await albumService.getInternalAgentData({
      type: 'chapter-search',
      albumId: album.id,
      query: 'coast',
      limit: 5,
    });
    assert.equal(V3InternalAgentDataResponse.safeParse(search).success, true);
    if (search.type !== 'chapter-search') assert.fail(`unexpected response type ${search.type}`);
    // 命中靠 description + 照片描述;label 展示优先用 title(章标识)。
    assert.deepEqual(search.data.matches, [
      { chapterId: 'c1', pageIndexes: [1, 2], label: '2024 年 03 月 02 日', score: 3 },
    ]);

    // 章标识是拍摄日期派生的,不能进检索 haystack,否则搜「2024」会命中全部章节。
    const dateSearch = await albumService.getInternalAgentData({
      type: 'chapter-search',
      albumId: album.id,
      query: '2024',
      limit: 5,
    });
    if (dateSearch.type !== 'chapter-search') assert.fail(`unexpected response type ${dateSearch.type}`);
    assert.deepEqual(dateSearch.data.matches, []);

    const bookTree = await albumService.getInternalAgentData({
      type: 'book-tree',
      albumId: album.id,
      chapterId: 'c1',
      pageIndex: 2,
    });
    assert.equal(V3InternalAgentDataResponse.safeParse(bookTree).success, true);
    if (bookTree.type !== 'book-tree') assert.fail(`unexpected response type ${bookTree.type}`);
    assert.deepEqual(bookTree.data.progress, { currentChapterId: 'c1', doneChapterIds: [] });
    assert.equal(bookTree.data.focusedPageIndex, 2);
    assert.deepEqual(bookTree.data.chapters, [
      { chapterId: 'c1', label: '2024 年 03 月 02 日', pageIndexes: [1, 2], done: false },
      // c2 是老树形状(无 title):降级读 description。
      { chapterId: 'c2', label: 'city gallery', pageIndexes: [3], done: false },
    ]);
    assert.equal(bookTree.data.allDone, false);
    assert.equal(hasForbiddenLocationKey(bookTree), false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('getInternalAgentData page-photos returns registered transient refs without persisting base64', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('internal-page-photos');
  transientPagePhotoRefs.resetForTest();
  try {
    const album = await makeAlbum(user.id);
    const draft: V3StoryDraft = {
      version: 'v3-story',
      tree: {
        chapters: [
          {
            chapterId: 'c1',
            title: '',
            description: 'chapter one',
            accentColor: null,
            artFont: null,
            chapterContext: "",
            place: '',
            keywords: [],
            photos: [
              {
                photoId: 'p1',
                sceneDescription: 'coast morning',
                width: 800,
                height: 600,
                orientation: 'landscape',
                takenAt: '2024-03-02T10:20:30',
              },
              {
                photoId: 'p2',
                sceneDescription: 'window portrait',
                width: 600,
                height: 800,
                orientation: 'portrait',
                takenAt: null,
              },
              {
                photoId: 'p3',
                sceneDescription: 'unregistered detail',
                width: 700,
                height: 700,
                orientation: 'square',
              },
            ],
          },
          {
            chapterId: 'c2',
            title: '',
            description: 'chapter two',
            accentColor: null,
            artFont: null,
            chapterContext: "",
            place: '',
            keywords: [],
            photos: [
              {
                photoId: 'p4',
                sceneDescription: 'other chapter',
                width: 800,
                height: 600,
                orientation: 'landscape',
              },
            ],
          },
        ],
      },
      pages: [],
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: draft });

    assert.deepEqual(await albumService.getInternalAgentData({ type: 'page-photos', albumId: album.id, chapterId: 'c1' }), {
      type: 'page-photos',
      data: { photos: [] },
    });

    transientPagePhotoRefs.register({
      albumId: album.id,
      chapterId: 'c1',
      refs: {
        p1: 'data:image/jpeg;base64,AA==',
        p2: 'data:image/jpeg;base64,BB==',
        p4: 'data:image/jpeg;base64,OTHER==',
      },
    });

    assert.deepEqual(await albumService.getInternalAgentData({ type: 'page-photos', albumId: album.id, chapterId: 'c1' }), {
      type: 'page-photos',
      data: {
        photos: [
          {
            photoId: 'p1',
            ref200px: 'data:image/jpeg;base64,AA==',
            orientation: 'landscape',
            takenAt: '2024-03-02T10:20:30',
          },
          {
            photoId: 'p2',
            ref200px: 'data:image/jpeg;base64,BB==',
            orientation: 'portrait',
            takenAt: null,
          },
        ],
      },
    });

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(JSON.stringify(reloaded?.draftJson).includes('data:image'), false);

    transientPagePhotoRefs.clear(album.id, 'c1');
    assert.deepEqual(await albumService.getInternalAgentData({ type: 'page-photos', albumId: album.id, chapterId: 'c1' }), {
      type: 'page-photos',
      data: { photos: [] },
    });
  } finally {
    transientPagePhotoRefs.resetForTest();
    await cleanupUser(user.id);
  }
});

// ───────── ③④ theme/cover — recommendTheme / applyThemeTurn / coverTurn (缺口#20) ─────────
//
// The browser holds NO authoring tree / layout pages (invariant 12): it sends only its
// selections. The service re-slices draft_json SERVER-SIDE — recommend derives the
// per-chapter overview, apply-theme/cover the relevant pages. These lock the slice
// (browser-sent payload contains no tree/pages) + the read-only posture.

const fullUsage = {
  durationMs: 1,
  visionCallCount: 0,
  planningInputTokens: 0,
  planningOutputTokens: 0,
  repairAttempts: 0,
  models: {},
};

// One chapter with a photo + a themable page (mag-13 has variableDecor slots), plus a
// cover + ending page with no chapter photo so the cover re-slice has 相关页 to pull from.
async function seedThemeCoverAlbum(userId: string) {
  const album = await makeAlbum(userId);
  const tree = {
    chapters: [
      {
        chapterId: 'c1',
        title: '',
        description: 'a sunlit week by the coast',
        extractedColor: '#C8894A',
        accentColor: null,
        artFont: null,
        chapterContext: "",
        place: '',
        keywords: [],
        photos: [
          { photoId: 'p1', sceneDescription: 'beach at dawn', width: 800, height: 600, orientation: 'landscape' as const, takenAt: null },
        ],
      },
    ],
  };
  const pages: Page[] = [
    // cover (mag-01) + ending (mag-20) carry no chapter photo → cover step's 相关页;
    // the interior page (mag-05, has variableDecor) references p1 → chapter c1's themable page.
    { pageIndex: 0, templateId: 'mag-01', images: { hero: 'cover-photo' }, texts: { title: 'Cover' } },
    { pageIndex: 1, templateId: 'mag-05', images: { image: 'p1' }, texts: { title: 'One' } },
    { pageIndex: 2, templateId: 'mag-20', images: {}, texts: { end: 'The End' } },
  ];
  const wrapped: V3StoryDraft = {
    version: 'v3-story',
    tree,
    pages,
    progress: { currentChapterId: 'c1', doneChapterIds: [] },
  };
  await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'theme', draftJson: wrapped });
  return album.id;
}

// ── 内容采集(采访)写回:saveChapterContexts ──────────────────────────────────
function twoChapterDraft(): V3StoryDraft {
  return {
    version: 'v3-story',
    tree: {
      chapters: [
        {
          chapterId: 'c1',
          title: '',
          description: 'coast morning',
          accentColor: null,
          artFont: null,
          chapterContext: '',
          place: '',
          keywords: [],
          photos: [
            { photoId: 'p1', sceneDescription: 'coast', width: 800, height: 600, orientation: 'landscape', takenAt: null },
          ],
        },
        {
          chapterId: 'c2',
          title: '',
          description: 'city gallery',
          accentColor: null,
          artFont: null,
          chapterContext: '',
          place: '',
          keywords: [],
          photos: [
            { photoId: 'p2', sceneDescription: 'gallery', width: 600, height: 800, orientation: 'portrait', takenAt: null },
          ],
        },
      ],
    },
    progress: { doneChapterIds: [], currentChapterId: 'c1' },
  };
}

test('saveChapterContexts writes chapterContext into the matching chapters, leaves others empty', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('save-chapter-context');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { draftJson: twoChapterDraft() });

    const result = await albumService.saveChapterContexts(user.id, album.id, [
      { chapterId: 'c1', chapterContext: '时间：2024/03/02  地点：杭州\n（用户原话）奶奶生日。' },
    ]);
    assert.deepEqual(result.savedChapterIds, ['c1']);

    const after = await albumRepo.findById(album.id);
    const tree = (after!.draftJson as V3StoryDraft).tree;
    const c1 = tree.chapters.find((c) => c.chapterId === 'c1')!;
    const c2 = tree.chapters.find((c) => c.chapterId === 'c2')!;
    assert.match(c1.chapterContext, /奶奶生日/);
    assert.equal(c2.chapterContext, ''); // 未提交的章保持空(可跳过)
    // 隐私:写进 draft 的 chapterContext 不含任何坐标键/字段。
    assert.equal(hasForbiddenLocationKey(tree), false);
  } finally {
    await cleanupUser(user.id);
  }
});

// 采访对话历史必须完整可重建:三条问句气泡各自独立落库(非 join 成一条)、用户回答在后,
// 且 seq 严格递增 —— loadHistory 按 seq(追加序 = 用户操作序)稳定还原「问1→问2→问3→答」。
// seq 由 repo.create 分配,不再依赖 created_at(同事务 defaultNow 会塌成同一刻)。这是
// 「采访信息作为对话历史留在面板」的存储侧保证。
test('saveChapterContexts persists interview bubbles as separate, strictly seq-ordered messages', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('save-interview-msgs');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { draftJson: twoChapterDraft() });

    const questions = ['When and where?', 'Who was with you?', 'What made it special?'];
    const messages = [
      ...questions.map((q) => ({ chapterId: 'c1', role: 'assistant' as const, content: q })),
      { chapterId: 'c1', role: 'user' as const, content: 'Kyoto, summer 2024, with my sister.' },
    ];
    await albumService.saveChapterContexts(
      user.id,
      album.id,
      [{ chapterId: 'c1', chapterContext: 'Kyoto 2024' }],
      messages,
    );

    // findByAlbum orders by seq asc — the exact source loadHistory reads.
    const rows = await albumMessageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 4, 'three question bubbles + one answer, each a separate row (not joined)');

    // 三条问句是独立行且保持原序(不是一条塞了 \n 的合并气泡)。
    const ai = rows.filter((r) => r.role === 'assistant');
    assert.deepEqual(ai.map((r) => r.content), questions);
    // 回答排在三条问句之后。
    assert.equal(rows[3]?.role, 'user');
    assert.match(rows[3]!.content, /my sister/);

    // seq 严格递增(追加序 = 用户操作序),保证刷新后顺序稳定 —— 不再靠 created_at 凑序。
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(
        rows[i]!.seq > rows[i - 1]!.seq,
        `message ${i} must have a strictly greater seq than message ${i - 1}`,
      );
    }
  } finally {
    await cleanupUser(user.id);
  }
});

test('saveChapterContexts caps chapterContext at 500 chars and rejects unknown/duplicate chapterIds', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('save-chapter-context-guards');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { draftJson: twoChapterDraft() });

    // 超长裁到 500。
    await albumService.saveChapterContexts(user.id, album.id, [
      { chapterId: 'c1', chapterContext: 'x'.repeat(700) },
    ]);
    const after = await albumRepo.findById(album.id);
    const c1 = (after!.draftJson as V3StoryDraft).tree.chapters.find((c) => c.chapterId === 'c1')!;
    assert.equal(c1.chapterContext.length, 500);

    // 未知章 => VALIDATION_FAILED。
    await assert.rejects(
      () => albumService.saveChapterContexts(user.id, album.id, [{ chapterId: 'nope', chapterContext: 'x' }]),
      hasCode('VALIDATION_FAILED'),
    );
    // 重复章 => VALIDATION_FAILED。
    await assert.rejects(
      () =>
        albumService.saveChapterContexts(user.id, album.id, [
          { chapterId: 'c1', chapterContext: 'a' },
          { chapterId: 'c1', chapterContext: 'b' },
        ]),
      hasCode('VALIDATION_FAILED'),
    );
  } finally {
    await cleanupUser(user.id);
  }
});

// draft_pages 拆表(Phase 1a)Task 7 回归守卫:saveChapterContexts 此前用 findOwned
// (无锁)在事务外读 album,再在独立事务里整块重写 draftJson,顺带把当时读到的 pages
// 原样搬运回去 —— 与并发的 updatePage(已切行级写)互吃时,陈旧的搬运会把用户刚落的
// 行级改动盖掉。现在行锁 + envelope-only 重写,从不碰 draft_pages,行改动必须原封
// 不动幸存;draft_revision 也不该跟着推进(页没变)。
test('saveChapterContexts: 先 updatePage 改一页,该页改动在 saveChapterContexts 之后完整幸存(不搬运/不覆盖 draft_pages 行,不推进 draftRevision)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('save-ctx-page-survive');
  try {
    const { albumId } = await seedWrappedStoryAlbum(user.id, 2, { stage: 'story' });

    await albumService.updatePage(user.id, albumId, 0, { textsJson: { headline: '编辑过的正文' } });

    const afterUpdate = await albumRepo.findById(albumId);
    const rowsAfterUpdate = await draftPageRepo.findByAlbum(albumId);
    const snapshot = rowsAfterUpdate.map((r) => ({
      pageIndex: r.pageIndex,
      version: r.version,
      updatedBy: r.updatedBy,
      page: r.page,
    }));

    const result = await albumService.saveChapterContexts(user.id, albumId, [
      { chapterId: 'c1', chapterContext: '章节背景采访' },
    ]);
    assert.deepEqual(result.savedChapterIds, ['c1']);

    const afterSave = await albumRepo.findById(albumId);
    const rowsAfterSave = await draftPageRepo.findByAlbum(albumId);

    assert.equal(
      afterSave!.draftRevision,
      afterUpdate!.draftRevision,
      'saveChapterContexts 不 bump draft_revision(页没变)',
    );
    assert.deepEqual(
      rowsAfterSave.map((r) => ({ pageIndex: r.pageIndex, version: r.version, updatedBy: r.updatedBy, page: r.page })),
      snapshot,
      'saveChapterContexts 不搬运/不覆盖 draft_pages 行,updatePage 的改动逐字幸存',
    );

    // chapterContext 确实写进树里 —— 功能没有随着摘除 pages 搬运一起退化。
    const tree = (afterSave!.draftJson as {
      tree: { chapters: { chapterId: string; chapterContext: string }[] };
    }).tree;
    assert.equal(tree.chapters.find((c) => c.chapterId === 'c1')!.chapterContext, '章节背景采访');
    assert.equal('pages' in (afterSave!.draftJson as object), false, 'envelope-only 重写,不写回 pages 键');
  } finally {
    await cleanupUser(user.id);
  }
});

// 回归守卫(code review round 2):brief 原文「不碰 draft_pages」与计划 Global
// Constraints「每个 draft 写事务固定次序:行锁 → ensureDraftPagesSeeded → …」冲突 ——
// 后者是全局无例外规则,且这个写点在「加照片后再采访」链路上真实可达(ChatPanel
// waitForAppendChapters → finishInterview → POST /chapter-context)。若一本相册从未
// 被任何行级写点摸过,它唯一一份页仍只活在 legacy draftJson.pages 里、draft_pages
// 一行都没有;不先播种就直接做 envelope-only 覆盖会把这份页连根拔掉。这里直接构造
// 这种「零行」形态(不经 updatePage 等会先播种的方法),证明 saveChapterContexts 会
// 先把它们播种进 draft_pages 再重写 envelope。
test('saveChapterContexts: 相册的页仍只活在 legacy draftJson.pages(draft_pages 零行,未经任何行级写点播种),先播种再重写 envelope,不连根拔掉这份页', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('save-ctx-legacy-seed');
  try {
    const album = await makeAlbum(user.id);
    const legacyPages = makePreviewPages(2);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(2),
      pages: legacyPages,
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    };
    // 手写落库(不经 updatePage/reorderPages/… 任何会先播种的写点)。
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });
    assert.equal(await draftPageRepo.countByAlbum(album.id), 0, 'sanity: 播种前确实没有行');

    const result = await albumService.saveChapterContexts(user.id, album.id, [
      { chapterId: 'c1', chapterContext: '章节背景采访' },
    ]);
    assert.deepEqual(result.savedChapterIds, ['c1']);

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(
      'pages' in (reloaded!.draftJson as object),
      false,
      'envelope-only 重写:draftJson 不带 pages 键',
    );

    // 页没有被 envelope-only 重写连带抹掉 —— 懒播种把它们原样搬进了 draft_pages 行。
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, legacyPages.length, '两页都没丢');
    assert.deepEqual(rows.map((r) => r.page), legacyPages, '内容逐字节不变(播种不烘 html)');
    assert.equal(
      reloaded!.draftRevision,
      1,
      '首次播种把 revision 从 0 立到 1(与 T3/T5 懒播种同口径),不是 saveChapterContexts 自己推进的',
    );
    for (const row of rows) {
      assert.equal(row.version, 1);
      assert.equal(row.updatedBy, null, '播种是系统动作,不是这次采访的用户写入');
    }
  } finally {
    await cleanupUser(user.id);
  }
});

// ── updatePage 的 C 方案分叉:draft 相册的手工编辑必须落页真相(html)──────────
// 此前 updatePage 无条件写 album_pages 表,而 authoring 读/AI/导出只认草稿页
// (含 html)—— 手工编辑全部进了一张没人读的表,刷新即回退。draft_pages 拆表
// (Phase 1a)后,草稿页真相从 albums.draft_json.pages 迁到 draft_pages 行,断言
// 改经 draftPageRepo 读回;html patch 语义本身逐字未变。
test('updatePage(draft 相册):文本/图位/样式全部落 draft_pages 行,且同步进 html 真相', async () => {
  const user = await makeUser('wp-updatepage-draft');
  try {
    const album = await makeAlbum(user.id);
    const tree = makeStoryTree(1);
    const html =
      '<div data-template="mag-01">' +
      '<img data-image-slot="image" src="{{IMG_SRC:image}}" style="object-fit:cover;object-position:50% 50%" />' +
      '<div data-text-key="title" style="font-size:36px">OLD TITLE</div>' +
      '</div>';
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree,
      pages: [
        {
          pageIndex: 0,
          templateId: 'mag-01',
          images: { image: 'p1' },
          texts: { title: 'OLD TITLE' },
          html,
        } as Page,
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: wrapped,
      coverThumbnailR2Key: `cover-thumbs/${user.id}/${album.id}/old.jpg`,
      coverThumbnailUrl: 'https://cdn.yujee.test/old.jpg',
    });

    await albumService.updatePage(user.id, album.id, 0, {
      textsJson: { title: '新标题' },
      imagePosJson: { image: { x: 30, y: 70, scale: 1.4 } },
      textStyles: { title: { 'font-size': '48px', 'font-weight': '700' } },
    });

    const after = await albumRepo.findById(album.id);
    // draft_pages 拆表(Phase 1a):页真相迁行,读回改经 draftPageRepo(不再是
    // draftJson.pages —— updatePage 已不写它)。
    const rows = await draftPageRepo.findByAlbum(album.id);
    const page = rows.find((r) => r.pageIndex === 0)!.page as Page & { html?: string };
    assert.equal(page.texts.title, '新标题');
    assert.deepEqual(page.imagePos, { image: { x: 30, y: 70, scale: 1.4 } });
    // html 真相同步:AI(derivePageTexts)和导出读的就是它,不同步等于白改。
    assert.match(page.html!, /新标题/);
    assert.doesNotMatch(page.html!, /OLD TITLE/);
    assert.match(page.html!, /font-size:48px/);
    assert.match(page.html!, /font-weight:700/);
    assert.match(page.html!, /object-position:30% 70%/);
    assert.match(page.html!, /transform:scale\(1\.4\)/);
    assert.match(page.html!, /\{\{IMG_SRC:image\}\}/, 'IMG_SRC token 保留,显示时才解析');
    assert.equal(after?.coverThumbnailR2Key, null, 'draft cover page edits clear the stale cover key');
    assert.equal(after?.coverThumbnailUrl, null, 'draft cover page edits clear the stale cover URL');
  } finally {
    await cleanupUser(user.id);
  }
});

// imagePos patch 失配(槽锚点不在 html 里等)不允许触发整页重烘:重烘会把手工
// 背景/字色和 AI 配色从库里一起抹掉(2026-08-02 用户上报「导出丢手工样式」的根因)。
// 图片位置是装饰性行内样式,失配只是这一笔不生效,html 真相必须原样保留。
test('updatePage(draft 相册):imagePos patch 失配保留 html 真相,不整页重烘', async () => {
  const user = await makeUser('wp-updatepage-imagepos-null');
  try {
    const album = await makeAlbum(user.id);
    const tree = makeStoryTree(1);
    // 手工痕迹:页根背景色 + 标题字色 —— 重烘会丢的东西。
    const html =
      '<div data-template="mag-01" style="background-color:#f3ead8">' +
      '<img data-image-slot="image" src="{{IMG_SRC:image}}" style="object-fit:cover" />' +
      '<div data-text-key="title" style="color:#8b2f2f">TITLE</div>' +
      '</div>';
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree,
      pages: [
        {
          pageIndex: 0,
          templateId: 'mag-01',
          images: { image: 'p1' },
          texts: { title: 'TITLE' },
          html,
        } as Page,
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: wrapped,
    });

    // 'ghost' 槽在 html 里没有对应 <img> 锚点 → patchHtmlImagePos 必然失配。
    await albumService.updatePage(user.id, album.id, 0, {
      imagePosJson: { ghost: { x: 10, y: 20, scale: 1.5 } },
    });

    const rows = await draftPageRepo.findByAlbum(album.id);
    const page = rows.find((r) => r.pageIndex === 0)!.page as Page & { html?: string };
    assert.equal(page.html, html, 'html 真相必须原样保留(手工背景/字色不能因一笔图位失配被重烘抹掉)');
    assert.deepEqual(page.imagePos, { ghost: { x: 10, y: 20, scale: 1.5 } }, '数据层照常落库');
  } finally {
    await cleanupUser(user.id);
  }
});

test('updatePage(draft 相册):pageStyle 把书页背景色写进页根 html + COMPLETED→EDITING', async () => {
  const user = await makeUser('wp-updatepage-pagebg');
  try {
    const album = await makeAlbum(user.id);
    const tree = makeStoryTree(1);
    const html =
      '<div data-template="mag-01" style="width:794px;height:1123px;background:#fff">' +
      '<div data-text-key="title" style="color:#111">T</div></div>';
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree,
      pages: [
        { pageIndex: 0, templateId: 'mag-01', images: {}, texts: { title: 'T' }, html } as Page,
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    // 导出后的书:COMPLETED + 有草稿。设背景色是一次「改动」,状态须退回 EDITING。
    await albumRepo.update(db, album.id, { status: 'COMPLETED', stage: 'story', draftJson: wrapped });

    await albumService.updatePage(user.id, album.id, 0, {
      pageStyle: { 'background-color': 'rgba(20, 30, 40, 0.4)' },
    });

    const after = await albumRepo.findById(album.id);
    assert.equal(after?.status, 'EDITING');
    const rows = await draftPageRepo.findByAlbum(album.id);
    const page = rows.find((r) => r.pageIndex === 0)!.page as Page & { html?: string };
    // 背景色进页根,内部文字元素不受影响。
    assert.match(page.html!, /background-color:rgba\(20, 30, 40, 0\.4\)/);
    assert.match(page.html!, /<div data-text-key="title" style="color:#111">/);

    // 无背景:移除 background-color,回落模板默认 background:#fff。
    await albumService.updatePage(user.id, album.id, 0, {
      pageStyle: { 'background-color': null },
    });
    const clearedRows = await draftPageRepo.findByAlbum(album.id);
    const clearedPage = clearedRows.find((r) => r.pageIndex === 0)!.page as Page & { html?: string };
    assert.doesNotMatch(clearedPage.html!, /background-color/);
    assert.match(clearedPage.html!, /background:#fff/);
  } finally {
    await cleanupUser(user.id);
  }
});

test('updatePage(draft 相册):html 锚点失配 → 整页重烘,新文本仍然可见', async () => {
  const user = await makeUser('wp-updatepage-rebake');
  try {
    const album = await makeAlbum(user.id);
    const tree = makeStoryTree(1);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree,
      pages: [
        {
          pageIndex: 0,
          templateId: 'mag-01',
          images: {},
          // html 里根本没有 body 槽的锚点(模拟槽位漂移/手工版面被破坏)。
          texts: { title: 'T', body: '' },
          html: '<div data-template="mag-01"><div data-text-key="title">T</div></div>',
        } as Page,
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    await albumService.updatePage(user.id, album.id, 0, {
      textsJson: { title: 'T', body: '正文来了' },
    });

    const rows = await draftPageRepo.findByAlbum(album.id);
    const page = rows.find((r) => r.pageIndex === 0)!.page as Page & { html?: string };
    assert.equal(page.texts.body, '正文来了');
    // 宁可整页重烘也不显示旧内容:重烘后的 html 必须带新文本。
    assert.match(page.html!, /正文来了/);
  } finally {
    await cleanupUser(user.id);
  }
});

// updatePage 的读必须烘 html(loadStoryDraft bake:true),不能 bake:false —— 一个从
// 未落过 html 的草稿页(存量/story 阶段的预览页)如果读回来 html 是 undefined,
// textStyles/pageStyle 的补丁函数(patchHtmlTextStyle/patchHtmlPageStyle)全部因为
// `html !== null` 守卫被跳过,收尾的 bakePageHtml 只认 templateId/texts/images/
// imagePos 四个字段重烘 —— textStyles/pageStyle 除了活在 html 字符串里的行内样式,
// 没有任何 Page 数据字段能承载它们,补丁就这样在 {updated:true} 的假象下静默消失。
// 这条测试永久钉住旧 readStoryDraft 的「读时烘」语义:loadStoryDraft 必须 bake:true。
test('updatePage(draft 相册,页从未烘过 html):textStyles/pageStyle 补丁必须真的烘进新生成的 html,不能静默丢', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-updatepage-nohtml-style');
  try {
    const album = await makeAlbum(user.id);
    const tree = makeStoryTree(1);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree,
      pages: [
        // 故意不带 html:模拟 analyze/select-layout 刚产出、还没被任何写路径烘过
        // 的预览页(makePreviewPages 同款形状)。
        { pageIndex: 0, templateId: 'mag-01', images: {}, texts: { title: 'T', label: '', body: '' } } as Page,
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    await albumService.updatePage(user.id, album.id, 0, {
      textStyles: { title: { 'font-size': '48px' } },
      pageStyle: { 'background-color': 'rgba(1, 2, 3, 0.5)' },
    });

    const rows = await draftPageRepo.findByAlbum(album.id);
    const page = rows.find((r) => r.pageIndex === 0)!.page as Page & { html?: string };
    assert.ok(page.html, '从未烘过 html 的页,updatePage 后必须落到一份真实 html(不能是 undefined)');
    assert.match(page.html!, /font-size:48px/, 'textStyles 补丁必须烘进 html,不能因为读时不烘而静默丢');
    assert.match(page.html!, /background-color:rgba\(1, 2, 3, 0\.5\)/, 'pageStyle 补丁同理必须烘进 html');
  } finally {
    await cleanupUser(user.id);
  }
});

// ── updatePage 切 draft_pages 行级写(Phase 1a Task 3)───────────────────────
// legacy 相册(只有 draftJson.pages,draft_pages 还没有行)第一次 updatePage 必须
// 先懒播种全书行(不只是被改的那一页),被改的行 version 推到本次新 draftRevision、
// updatedBy 是操作用户;没被碰的行留在播种时打的版本(1)、updatedBy 仍是 null
// (系统写入,不是某个用户)—— 这是 Phase 1b 页锁/CAS 要用的地基,这里先立住不变式。
test('updatePage(legacy 相册,draft_pages 尚无行):首次调用自动播种全书行;目标行 version 推进到新 draftRevision 且 updatedBy=userId,其余行留在种子版本且 updatedBy=null', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-updatepage-seed');
  try {
    const { albumId, pages } = await seedWrappedStoryAlbum(user.id, 3);
    assert.equal((await draftPageRepo.findByAlbum(albumId)).length, 0, '播种前 draft_pages 无行');

    await albumService.updatePage(user.id, albumId, 1, {
      textsJson: { headline: '更新后的正文' },
    });

    const rows = await draftPageRepo.findByAlbum(albumId);
    assert.equal(rows.length, pages.length, '首次 updatePage 播种全书行,不只是被改的那一页');

    const after = await albumRepo.findById(albumId);
    assert.ok(after);
    const touched = rows.find((r) => r.pageIndex === 1);
    assert.ok(touched);
    assert.equal(touched!.version, after!.draftRevision, '目标行 version === album.draftRevision');
    assert.equal(touched!.updatedBy, user.id, '目标行 updatedBy === userId');
    assert.equal(touched!.page.texts.headline, '更新后的正文');

    const others = rows.filter((r) => r.pageIndex !== 1);
    assert.equal(others.length, pages.length - 1);
    for (const row of others) {
      assert.equal(row.version, 1, '未被本次改动的行保持播种版本(1),不随目标行一起推进');
      assert.equal(row.updatedBy, null, '播种行 updatedBy 仍是系统写入(null)');
    }
  } finally {
    await cleanupUser(user.id);
  }
});

// ── reorderPages:整页交换的原子落库(2026-08-01 整页交换设计)──────────────────
// 逐页 PATCH 表达不了整页交换:body 不收 templateId/html,且大↔对页的块对调会让
// 中间每一页平移,逐页写既不原子又会在中间态撞 html 逐笔 patch。所以是一个端点、
// 一个事务、一份完整置换(perm[newIndex] = oldIndex)。

function reorderFixturePage(pageIndex: number, templateId: string, mark: string): Page {
  return {
    pageIndex,
    templateId,
    images: {},
    texts: { title: mark },
    html: `<div data-template="${templateId}"><div data-text-key="title">${mark}</div></div>`,
  } as Page;
}

test('reorderPages(draft 相册):按置换重排 draft_pages 行,pageIndex 重写 0..n-1,整条记录跟着走;所有行 version 推进到新 revision;pageCount 收口', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-reorder-draft');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'COMPLETED', stage: 'story', draftJson: wrapped });

    await albumService.reorderPages(user.id, album.id, [0, 2, 1]);

    const after = await albumRepo.findById(album.id);
    const rows = await draftPageRepo.findByAlbum(album.id);
    const pages = rows.map((r) => r.page as Page & { html?: string; texts: Record<string, string> });
    assert.deepEqual(
      pages.map((p) => [p.pageIndex, p.texts.title]),
      [
        [0, 'COVER'],
        [1, 'B'],
        [2, 'A'],
      ],
      '顺序按置换重排(读回从 draft_pages 行读,不再是 draft_json.pages),pageIndex 重写连续',
    );
    // 整页交换搬整条记录:html 原样跟着走,不重烘、不逐字段拆搬。
    assert.match(pages[1]!.html!, />B</);
    assert.match(pages[2]!.html!, /A/);
    assert.equal(after?.status, 'EDITING', '重排是一次编辑,COMPLETED 须退回 EDITING');
    assert.equal(after?.pageCount, 3, 'pageCount 收口点一:置换后与行数一致');
    for (const row of rows) {
      assert.equal(row.version, after!.draftRevision, `第 ${row.pageIndex} 行 version 必须等于新 draftRevision`);
    }
  } finally {
    await cleanupUser(user.id);
  }
});

test('reorderPages:置换校验 —— 长度不符/非双射/移动 cover 类目页,一律 VALIDATION_FAILED', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-reorder-invalid');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    const rejects = (perm: number[]) =>
      assert.rejects(
        albumService.reorderPages(user.id, album.id, perm),
        (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
      );
    await rejects([0, 1]); // 长度不符
    await rejects([0, 1, 1]); // 非双射
    await rejects([2, 1, 0]); // mag-01 是 cover:锚定页不许动(服务端二次把关,不只靠前端置灰)
  } finally {
    await cleanupUser(user.id);
  }
});

test('reorderPages(无 draft 存量相册):album_pages 行按置换重写 pageIndex', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-reorder-legacy');
  try {
    const album = await makeAlbum(user.id);
    await albumPageRepo.bulkInsert(db, [
      { albumId: album.id, pageIndex: 0, templateId: 'mag-01', imagesJson: {}, textsJson: { title: 'COVER' } },
      { albumId: album.id, pageIndex: 1, templateId: 'mag-03', imagesJson: { a: 'p1' }, textsJson: { title: 'A' } },
      { albumId: album.id, pageIndex: 2, templateId: 'mag-05', imagesJson: {}, textsJson: { title: 'B' } },
    ]);

    await albumService.reorderPages(user.id, album.id, [0, 2, 1]);

    const rows = await albumPageRepo.findByAlbum(db, album.id);
    assert.deepEqual(
      rows.map((r) => [r.pageIndex, (r.textsJson as Record<string, string>).title]),
      [
        [0, 'COVER'],
        [1, 'B'],
        [2, 'A'],
      ],
    );
    assert.deepEqual(rows[2]!.imagesJson, { a: 'p1' }, '整行内容原样跟着走');
  } finally {
    await cleanupUser(user.id);
  }
});

// ── reorderPages 的路由判定必须与 updatePage(Task 3)用同一个 loadStoryDraft
// 依据 ────────────────────────────────────────────────────────────────────
// Task 3 之后 updatePage 只写 draft_pages 行,不再回写 draftJson.pages —— 被
// updatePage 摸过的相册,draftJson.pages 从此是陈旧快照。如果 reorderPages 还照
// 旧代码那样直接读 draftJson.pages 来判定「有没有草稿」、取源数据,重排时就会用
// 陈旧文案覆盖掉 updatePage 刚写的新文案。这个用例钉住这条误路由回归。
test('reorderPages 路由判定必须与 updatePage 一致:先 updatePage 改一页文案再 reorder,改动必须幸存(不能被陈旧 draftJson.pages 覆盖)', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-reorder-misroute-guard');
  try {
    const { albumId } = await seedWrappedStoryAlbum(user.id, 1, {
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-05', 'B'),
      ],
    });
    assert.equal(
      (await draftPageRepo.findByAlbum(albumId)).length,
      0,
      '此时 draft_pages 尚无行,只有 legacy draftJson.pages',
    );

    await albumService.updatePage(user.id, albumId, 1, { textsJson: { title: '改动幸存' } });

    // updatePage 已经播种全书行并只改了目标行,draftJson.pages 从此是陈旧快照
    // (Task 3:envelope 不重写,pages 不再进 draftJson)。
    const stale = await albumRepo.findById(albumId);
    const staleDraft = stale?.draftJson as { pages: Array<{ texts: { title: string } }> };
    assert.equal(staleDraft.pages[1]?.texts.title, 'A', 'sanity: draftJson.pages 确实没跟着 updatePage 更新');

    await albumService.reorderPages(user.id, albumId, [0, 2, 1]);

    const rows = await draftPageRepo.findByAlbum(albumId);
    const movedToIndex2 = rows.find((r) => r.pageIndex === 2)!;
    assert.equal(
      (movedToIndex2.page as Page & { texts: Record<string, string> }).texts.title,
      '改动幸存',
      'reorder 必须重排 updatePage 写入行级表的最新内容,不能读陈旧 draftJson.pages 覆盖回去',
    );
  } finally {
    await cleanupUser(user.id);
  }
});

// ── deletePage:删除书页(2026-08-03 设计:docs/specs/2026-08-03-delete-page-design.md)──
// 只删内页,图片随页移除不回流;余页 pageIndex 重排 0..n-1;pageCount 收口;
// COMPLETED → EDITING。校验失败一律 VALIDATION_FAILED 且不落库。

test('deletePage(draft 相册):删内页后行数-1,pageIndex 连续,整条记录跟着走;version 推进;pageCount 收口;COMPLETED 退回 EDITING', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-delete-draft');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'COMPLETED', stage: 'story', draftJson: wrapped });

    await albumService.deletePage(user.id, album.id, 1);

    const after = await albumRepo.findById(album.id);
    const rows = await draftPageRepo.findByAlbum(album.id);
    const pages = rows.map((r) => r.page as Page & { html?: string; texts: Record<string, string> });
    assert.deepEqual(
      pages.map((p) => [p.pageIndex, p.texts.title]),
      [
        [0, 'COVER'],
        [1, 'B'],
      ],
      '被删页消失,余页 pageIndex 重排连续',
    );
    assert.match(pages[1]!.html!, />B</, '余页整条记录原样跟着走,html 不重烘');
    assert.equal(after?.status, 'EDITING', '删页是一次编辑,COMPLETED 须退回 EDITING');
    assert.equal(after?.pageCount, 2, 'pageCount 收口:删后与行数一致');
    for (const row of rows) {
      assert.equal(row.version, after!.draftRevision, `第 ${row.pageIndex} 行 version 必须等于新 draftRevision`);
    }
  } finally {
    await cleanupUser(user.id);
  }
});

test('deletePage(draft 相册):双宽内页(spread 模板)同样可删', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-delete-spread');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-54', 'S'), // mag-54: interior + spread:true
        reorderFixturePage(3, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    await albumService.deletePage(user.id, album.id, 2);

    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.deepEqual(
      rows.map((r) => [(r.page as Page).pageIndex, ((r.page as Page).texts as Record<string, string>).title]),
      [
        [0, 'COVER'],
        [1, 'A'],
        [2, 'B'],
      ],
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('deletePage:拒绝 —— 删 cover 类目页/删最后一张内页/越界,一律 VALIDATION_FAILED 且不落库', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-delete-invalid');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'ONLY'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    const rejects = (idx: number) =>
      assert.rejects(albumService.deletePage(user.id, album.id, idx), hasCode('VALIDATION_FAILED'));
    await rejects(0); // cover 类目:锚定页不许删(服务端二次把关,不只靠前端置灰)
    await rejects(1); // 最后一张内页:拒绝删到内页数为 0
    await rejects(9); // 越界
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.notEqual(rows.length, 1, '拒绝路径不落库(事务回滚:要么 0 行要么播种后的 2 行,绝不会剩 1 行)');
  } finally {
    await cleanupUser(user.id);
  }
});

// ── 2026-08-03 线上事故回归:「保存成功但刷新消失」。写点(T3-T5)已切 draft_pages
// 行,而编辑器读点(getDraftSkeleton)仍读 legacy draftJson.pages —— 用户改完刷新,
// 读回的是拆表前的陈旧快照,所有编辑不可见。读点必须走 loadStoryDraft(行优先)。
test('getDraftSkeleton 读行级真相:updatePage/deletePage 之后再读必须看见改动', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-skeleton-rows');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    await albumService.updatePage(user.id, album.id, 1, { textsJson: { title: '编辑必须活过刷新' } });
    const afterEdit = await albumService.getDraftSkeleton(user.id, album.id);
    assert.equal(
      afterEdit?.pages[1]?.textsJson.title,
      '编辑必须活过刷新',
      '改文字后重新读 skeleton 必须看见新文案(不能读 legacy 陈旧快照)',
    );

    await albumService.deletePage(user.id, album.id, 1);
    const afterDelete = await albumService.getDraftSkeleton(user.id, album.id);
    assert.equal(afterDelete?.pages.length, 2, '删页后重新读 skeleton 页数必须变少');
    assert.equal(afterDelete?.pages[1]?.textsJson.title, 'B', '幸存页顺延');
  } finally {
    await cleanupUser(user.id);
  }
});

// updatePage 与 deletePage 同一条线上契约(pageIndex 字段):稀疏字段相册上按数组
// 下标解析时,字段值若恰好落在数组范围内会**静默改错页**(比报错更危险)。
test('updatePage:按 pageIndex 字段解析 —— 稀疏字段(0/129/132)相册改的是字段=129 那页,不是数组第 129/1 位', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-update-sparse');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(129, 'mag-03', 'A'),
        reorderFixturePage(132, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    await albumService.updatePage(user.id, album.id, 129, { textsJson: { title: '改动落在正确的页' } });

    const rows = await draftPageRepo.findByAlbum(album.id);
    const byField = new Map(rows.map((r) => [(r.page as Page).pageIndex, r.page as Page & { texts: Record<string, string> }]));
    assert.equal(byField.get(129)?.texts.title, '改动落在正确的页', '字段=129 的页被改');
    assert.equal(byField.get(0)?.texts.title, 'COVER', '封面原样');
    assert.equal(byField.get(132)?.texts.title, 'B', '其余页原样');
  } finally {
    await cleanupUser(user.id);
  }
});

// ── 2026-08-03 线上 400 复盘:/pages/[idx] 的线上契约是页对象的 pageIndex **字段**
// (桌面 data-page-index 写 String(lp.pageIndex)、pageByIndex 按字段 find、移动端
// persistPage(page.pageIndex))。存量相册的字段可能不连续(线上见 129/132),服务端
// 按数组下标解析会越界/错位。deletePage 必须按字段解析;删后重编号 0..n-1 顺带把
// 这类相册洗回连续(自愈)。
test('deletePage:按 pageIndex 字段解析(不是数组下标)—— 字段不连续(0/129/132)的存量相册照样删对页并重编号', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-delete-sparse');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(129, 'mag-03', 'A'),
        reorderFixturePage(132, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    // 前端发的是字段值 129(不是数组下标 1)。
    await albumService.deletePage(user.id, album.id, 129);

    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.deepEqual(
      rows.map((r) => [(r.page as Page).pageIndex, ((r.page as Page).texts as Record<string, string>).title]),
      [
        [0, 'COVER'],
        [1, 'B'],
      ],
      '删掉字段=129 的那页;余页重编号 0..n-1(稀疏相册被洗回连续)',
    );

    // 不存在的字段值(哪怕它是合法数组下标)必须明确拒绝,不能静默删错页。
    await assert.rejects(albumService.deletePage(user.id, album.id, 77), hasCode('VALIDATION_FAILED'));
  } finally {
    await cleanupUser(user.id);
  }
});

test('deletePage(无 draft 存量相册):album_pages 行过滤后 pageIndex 重写,整行内容原样', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-delete-legacy');
  try {
    const album = await makeAlbum(user.id);
    await albumPageRepo.bulkInsert(db, [
      { albumId: album.id, pageIndex: 0, templateId: 'mag-01', imagesJson: {}, textsJson: { title: 'COVER' } },
      { albumId: album.id, pageIndex: 1, templateId: 'mag-03', imagesJson: { a: 'p1' }, textsJson: { title: 'A' } },
      { albumId: album.id, pageIndex: 2, templateId: 'mag-05', imagesJson: { b: 'p2' }, textsJson: { title: 'B' } },
    ]);

    await albumService.deletePage(user.id, album.id, 1);

    const rows = await albumPageRepo.findByAlbum(db, album.id);
    assert.deepEqual(
      rows.map((r) => [r.pageIndex, (r.textsJson as Record<string, string>).title]),
      [
        [0, 'COVER'],
        [1, 'B'],
      ],
    );
    assert.deepEqual(rows[1]!.imagesJson, { b: 'p2' }, '整行内容原样跟着走');
  } finally {
    await cleanupUser(user.id);
  }
});

// ── persistDesignChat:设计对话提交切 draft_pages 行级写(Phase 1a Task 6)────────
// Agent 每轮整书回放全部 pages(move_pages 会增删页,不是逐页 PATCH),所以落库
// 仍是整书 replaceAll,与 reorderPages 同一种「行锁 → seeded → replaceAll(userId)
// + pageCount 收口 → envelope-only 重写」次序,只是源数据来自 Agent 而不是本地
// 置换计算。

test('persistDesignChat(committed=true):全书页替换落 draft_pages 行,所有行 version 推进到新 draftRevision、updatedBy=发起人;pageCount 跟随新页数(3→2,模拟 move_pages 删页);COMPLETED 退回 EDITING', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-designchat-replace');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'COMPLETED', stage: 'story', draftJson: wrapped });
    assert.equal((await draftPageRepo.findByAlbum(album.id)).length, 0, '提交前 draft_pages 尚无行(懒播种)');

    const newPages = [
      { pageIndex: 0, templateId: 'mag-01', images: {}, texts: { title: 'NEWCOVER' } },
      { pageIndex: 1, templateId: 'mag-03', images: {}, texts: { title: 'NEWA' } },
    ];
    await albumService.persistDesignChat(user.id, album.id, {
      userMessage: '把第二页删了',
      assistantReply: '好的,已经删掉了',
      committed: true,
      pages: newPages,
    });

    const after = await albumRepo.findById(album.id);
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.deepEqual(
      rows.map((r) => [(r.page as Page).pageIndex, (r.page as Page & { texts: Record<string, string> }).texts.title]),
      [
        [0, 'NEWCOVER'],
        [1, 'NEWA'],
      ],
      '读回从 draft_pages 行读(整书替换,不是逐页 patch)',
    );
    assert.equal(after?.pageCount, 2, 'pageCount 收口点三:move_pages 增删页后与行数一致');
    assert.equal(after?.status, 'EDITING', '设计对话提交是一次编辑,COMPLETED 须退回 EDITING');
    for (const row of rows) {
      assert.equal(row.version, after!.draftRevision, `第 ${row.pageIndex} 行 version 必须等于新 draftRevision`);
      assert.equal(row.updatedBy, user.id, `第 ${row.pageIndex} 行 updatedBy 必须是发起对话的用户`);
    }
  } finally {
    await cleanupUser(user.id);
  }
});

// design-agent 的写工具只动数组顺序、不改页对象的 pageIndex 字段(move_pages 的
// album-move-pages-tool.test.ts 锁死逐字节不变;delete_page 同口径)。拆表后
// replaceAll 按 page.pageIndex 落行、读回按 pageIndex 排序 —— persistDesignChat
// 必须按数组位置重编号,否则挪页/删页在落库时被旧 pageIndex 静默还原(用户看到
// AI 说"挪好了",刷新后原样弹回)。这个用例钉住这条回归。
test('persistDesignChat:数组序是真相 —— 带陈旧 pageIndex 的乱序 pages(模拟 move_pages)落库后行序=数组序,pageIndex 重编号 0..n-1', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-designchat-order');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    // move_pages 挪 A 到 B 后:数组序 [COVER, B, A],但页对象 pageIndex 原样(0, 2, 1)。
    await albumService.persistDesignChat(user.id, album.id, {
      userMessage: '把 A 挪到 B 后面',
      assistantReply: '挪好了',
      committed: true,
      pages: [
        { pageIndex: 0, templateId: 'mag-01', images: {}, texts: { title: 'COVER' } },
        { pageIndex: 2, templateId: 'mag-05', images: {}, texts: { title: 'B' } },
        { pageIndex: 1, templateId: 'mag-03', images: {}, texts: { title: 'A' } },
      ],
    });

    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.deepEqual(
      rows.map((r) => [(r.page as Page).pageIndex, (r.page as Page & { texts: Record<string, string> }).texts.title]),
      [
        [0, 'COVER'],
        [1, 'B'],
        [2, 'A'],
      ],
      '行序必须跟数组序(挪页幸存),pageIndex 重编号连续',
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('persistDesignChat(committed=true):envelope 沿用锁内最新 tree/progress/design(含 pageBackground),draftJson 不再写回 pages 键', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-designchat-envelope');
  try {
    const { albumId } = await seedWrappedStoryAlbum(user.id, 2, { done: true });
    const design = { fonts: { body: 'serif' }, colors: { accent: '#ff0000' }, pageBackground: '#FBF8F1' };
    const before = await albumRepo.findById(albumId);
    await albumRepo.update(db, albumId, {
      draftJson: { ...(before!.draftJson as Record<string, unknown>), design },
    });

    const newPages = [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: { headline: 'X' } }];
    await albumService.persistDesignChat(user.id, albumId, {
      userMessage: '换个书页底色',
      assistantReply: '好的,已经刷新了底色',
      committed: true,
      pages: newPages,
    });

    const after = await albumRepo.findById(albumId);
    const draft = after!.draftJson as {
      version: string;
      tree: unknown;
      progress: unknown;
      design?: unknown;
      pages?: unknown;
    };
    assert.equal('pages' in draft, false, 'pages 真相已迁 draft_pages,envelope 不再重写 pages 键');
    assert.deepEqual(draft.design, design, 'design(含 pageBackground)原样保留锁内最新,不因整书替换页而丢失');

    const rows = await draftPageRepo.findByAlbum(albumId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.updatedBy, user.id);
  } finally {
    await cleanupUser(user.id);
  }
});

test('persistDesignChat(committed=true):相册没有 V3 story draft → VALIDATION_FAILED,不落库', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-designchat-noguard');
  try {
    const album = await makeAlbum(user.id); // draftJson 仍是 null

    await assert.rejects(
      albumService.persistDesignChat(user.id, album.id, {
        userMessage: '',
        assistantReply: '',
        committed: true,
        pages: [],
      }),
      hasCode('VALIDATION_FAILED'),
    );
    assert.equal((await draftPageRepo.findByAlbum(album.id)).length, 0, '拒绝路径不落库');
  } finally {
    await cleanupUser(user.id);
  }
});

test('persistDesignChat(committed=false):只读轮次不落 draft_pages/不动 pageCount/draftJson', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-designchat-uncommitted');
  try {
    const { albumId } = await seedWrappedStoryAlbum(user.id, 1);
    const before = await albumRepo.findById(albumId);

    await albumService.persistDesignChat(user.id, albumId, {
      userMessage: '这页配色好看吗',
      assistantReply: '我觉得可以再暖一点',
      committed: false,
      pages: [],
    });

    assert.equal((await draftPageRepo.findByAlbum(albumId)).length, 0, '未提交轮次不落 draft_pages 行');
    const after = await albumRepo.findById(albumId);
    assert.equal(after?.pageCount, before?.pageCount, 'pageCount 不变');
    assert.deepEqual(after?.draftJson, before?.draftJson, 'draftJson 不变');
  } finally {
    await cleanupUser(user.id);
  }
});

test('isDefaultAlbumTitle: 系统默认书名视为「用户没起名」', () => {
  assert.equal(isDefaultAlbumTitle('My Memoir'), true);
  assert.equal(isDefaultAlbumTitle('我的故事'), true);
  assert.equal(isDefaultAlbumTitle('  My Memoir  '), true);
  assert.equal(isDefaultAlbumTitle('海边那年'), false);
  assert.equal(isDefaultAlbumTitle(''), true);
});
