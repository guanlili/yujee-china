import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/client';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
import { albumMessageRepo } from '../../db/repos/album-message-repo';
import { albumPageRepo } from '../../db/repos/album-page-repo';
import { albumRepo } from '../../db/repos/album-repo';
import { creditHoldRepo } from '../../db/repos/credit-hold-repo';
import { agentClient } from '../../lib/agent/agent-client';
import {
  cleanupUser,
  isDbReachable,
  makeAlbum,
  makeUser,
} from '../../db/repos/__test__/setup';
import { albumService } from './album-service';
import { transientPagePhotoRefs } from './page-photo-refs';
import { jobService } from '../job/job-service';
import {
  V3InternalAgentDataResponse,
  type Page,
  type V3ChapterThemeChoice,
  type V3StoryDraft,
} from '@yujee/contracts';

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

function hasForbiddenLocationKey(value: unknown): boolean {
  const forbidden = new Set(['location', 'place', 'gps', 'lat', 'lng', 'coordinates']);
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
async function runningAlbumWithJob(userId: string, startedAgoMs: number) {
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
  });
  await agentJobRepo.update(db, job.id, {
    status: 'RUNNING',
    stage: 'vision',
    progress: 30,
    startedAt: new Date(Date.now() - startedAgoMs),
  });
  return { album, hold, job };
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
          description: 'first',
          accentColor: null,
          artFont: null,
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
            description: 'first',
            accentColor: null,
            artFont: null,
            photos: [{ photoId: 'p1', sceneDescription: 'sea', width: 800, height: 600, orientation: 'landscape' }],
          },
          {
            chapterId: 'c2',
            description: 'second',
            accentColor: null,
            artFont: null,
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
            description: 'first',
            accentColor: null,
            artFont: null,
            photos: [{ photoId: 'p1', sceneDescription: 'sea', width: 800, height: 600, orientation: 'landscape' }],
          },
          {
            chapterId: 'c2',
            description: 'second',
            accentColor: null,
            artFont: null,
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
      description: `chapter ${i + 1}`,
      accentColor: null,
      artFont: null,
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
    const afterFirst = await albumRepo.findById(albumId);
    assert.deepEqual(
      (afterFirst?.draftJson as { pages?: unknown } | null)?.pages,
      makePreviewPages(2),
      'chapter done wrapper must preserve preview pages',
    );

    const b = await albumService.markChapterDone(user.id, albumId, 'c2');
    assert.deepEqual(b.doneChapterIds, ['c1', 'c2']);
    assert.equal(b.currentChapterId, null); // all done
    assert.equal(b.allDone, true);
    assert.equal(b.stage, 'theme'); // 全章确定 → 进下一环
    assert.equal(b.exportUnlocked, true);

    // Persisted: re-reading shows theme + unlocked; status untouched (⟂ stage).
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'theme');
    assert.equal(reloaded?.status, 'EDITING'); // markChapterDone never touches status

    const p = await albumService.getStoryProgress(user.id, albumId);
    assert.equal(p.exportUnlocked, true);
    assert.equal(p.allDone, true);
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
    assert.equal(after.exportUnlocked, true);
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'cover');
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

test('applyTheme: writes per-chapter color/font into the tree + advances stage=cover', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp32-apply');
  try {
    const albumId = await seedThemeAlbum(user.id, 2);
    const res = await albumService.applyTheme(
      user.id,
      albumId,
      [
        { chapterId: 'c1', subject: 'Chapter One', accentColor: '#C0392B', artFont: 'script-elegant' },
        { chapterId: 'c2', subject: 'Chapter Two', accentColor: '#1F618D', artFont: 'sans-modern' },
      ] satisfies V3ChapterThemeChoice[],
      PATCH,
    );
    assert.equal(res.stage, 'cover'); // theme → cover
    assert.deepEqual(res.layoutPatch, PATCH); // patch handed back verbatim

    // Persisted: tree chapters carry the chosen color/font; stage=cover; status ⟂.
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'cover');
    assert.equal(reloaded?.status, 'EDITING'); // applyTheme never touches status
    const draft = reloaded?.draftJson as {
      tree: { chapters: Array<{ chapterId: string; accentColor: string | null; artFont: string | null }> };
      pages?: unknown;
    };
    // The theme patch (per-chapter subject→title + accent svg) is folded into
    // draft_json.pages so a reload/finalize keeps it (#236); non-patched pages stay verbatim.
    const previewPages = makePreviewPages(2);
    const expectedPages = [
      { ...previewPages[0]!, texts: { ...previewPages[0]!.texts, divider: '#C0392B', title: 'X' } },
      previewPages[1]!,
    ];
    assert.deepEqual(draft.pages, expectedPages, 'applyTheme folds the theme patch into draft_json pages');
    const byId = new Map(draft.tree.chapters.map((c) => [c.chapterId, c]));
    assert.equal(byId.get('c1')?.accentColor, '#C0392B');
    assert.equal(byId.get('c1')?.artFont, 'script-elegant');
    assert.equal(byId.get('c2')?.accentColor, '#1F618D');
    assert.equal(byId.get('c2')?.artFont, 'sans-modern');
  } finally {
    await cleanupUser(user.id);
  }
});

test('applyTheme: idempotent — re-applying from cover does not regress stage', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp32-idempotent');
  try {
    const albumId = await seedThemeAlbum(user.id, 1);
    const choices = [{ chapterId: 'c1', subject: 'Chapter One', accentColor: '#2ECC71', artFont: 'display-bold' }] satisfies V3ChapterThemeChoice[];
    await albumService.applyTheme(user.id, albumId, choices, PATCH); // → cover
    const again = await albumService.applyTheme(user.id, albumId, choices, PATCH);
    assert.equal(again.stage, 'cover'); // no regression / no double-advance
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'cover');
  } finally {
    await cleanupUser(user.id);
  }
});

test('applyTheme: rejects a choice for an unknown chapterId', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp32-unknown-ch');
  try {
    const albumId = await seedThemeAlbum(user.id, 1);
    await assert.rejects(
      () =>
        albumService.applyTheme(
          user.id,
          albumId,
          [
            { chapterId: 'c1', subject: 'Chapter One', accentColor: '#C0392B', artFont: 'serif-classic' },
            { chapterId: 'ghost', subject: 'A ghost chapter', accentColor: '#000000', artFont: 'sans-modern' },
          ] satisfies V3ChapterThemeChoice[],
          PATCH,
        ),
      isValidationFailed,
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('applyTheme: rejects missing chapter choices', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp32-missing-ch');
  try {
    const albumId = await seedThemeAlbum(user.id, 2);
    await assert.rejects(
      () =>
        albumService.applyTheme(
          user.id,
          albumId,
          [{ chapterId: 'c1', subject: 'Chapter One', accentColor: '#C0392B', artFont: 'serif-classic' }] satisfies V3ChapterThemeChoice[],
          PATCH,
        ),
      isValidationFailed,
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('applyTheme: rejects duplicate chapter choices', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp32-duplicate-ch');
  try {
    const albumId = await seedThemeAlbum(user.id, 1);
    await assert.rejects(
      () =>
        albumService.applyTheme(
          user.id,
          albumId,
          [
            { chapterId: 'c1', subject: 'Chapter One', accentColor: '#C0392B', artFont: 'serif-classic' },
            { chapterId: 'c1', subject: 'A duplicate', accentColor: '#1F618D', artFont: 'sans-modern' },
          ] satisfies V3ChapterThemeChoice[],
          PATCH,
        ),
      isValidationFailed,
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('applyTheme: rejects a non-owner', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const owner = await makeUser('wp32-owner');
  const intruder = await makeUser('wp32-intruder');
  try {
    const albumId = await seedThemeAlbum(owner.id, 1);
    await assert.rejects(
      () =>
        albumService.applyTheme(
          intruder.id,
          albumId,
          [{ chapterId: 'c1', subject: 'Chapter One', accentColor: '#C0392B', artFont: 'serif-classic' }] satisfies V3ChapterThemeChoice[],
          PATCH,
        ),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_OWNED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
  }
});

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

test('cover: advances stage cover→ready and hands the patch back', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp41-cover');
  try {
    const albumId = await seedCoverAlbum(user.id, 1);
    const res = await albumService.cover(user.id, albumId, COVER_PATCH);
    assert.equal(res.stage, 'ready'); // cover → ready
    assert.deepEqual(res.layoutPatch, COVER_PATCH); // patch handed back verbatim

    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'ready');
    assert.equal(reloaded?.status, 'EDITING'); // cover never touches status (⟂ stage)
  } finally {
    await cleanupUser(user.id);
  }
});

test('cover: skip (empty patch) still advances stage cover→ready (封面可跳过)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp41-skip');
  try {
    const albumId = await seedCoverAlbum(user.id, 1);
    const res = await albumService.cover(user.id, albumId, []); // skipped = empty patch
    assert.equal(res.stage, 'ready'); // skip does not block the gate (§4.5a)
    assert.deepEqual(res.layoutPatch, []);
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'ready');
  } finally {
    await cleanupUser(user.id);
  }
});

test('cover: skip from theme advances directly to ready (theme/cover may both be skipped)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp41-theme-skip');
  try {
    const albumId = await seedStoryAlbum(user.id, 1);
    await albumRepo.update(db, albumId, { stage: 'theme' });

    const res = await albumService.cover(user.id, albumId, []);

    assert.equal(res.stage, 'ready');
    assert.deepEqual(res.layoutPatch, []);
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'ready');
  } finally {
    await cleanupUser(user.id);
  }
});

test('cover: story-stage patch does not mutate draft pages or advance stage', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp41-story-noop');
  try {
    const originalPages: Page[] = [
      { pageIndex: 0, templateId: 'mag-02', images: { image: 'story-photo' }, texts: { title: 'Story preview' } },
      { pageIndex: 1, templateId: 'mag-05', images: { image: 'chapter-photo' }, texts: { body: 'Chapter' } },
    ];
    const { albumId } = await seedWrappedStoryAlbum(user.id, 1, {
      pages: originalPages,
      stage: 'story',
    });

    const res = await albumService.cover(user.id, albumId, COVER_PATCH);

    assert.equal(res.stage, 'story');
    assert.deepEqual(res.layoutPatch, COVER_PATCH);
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'story');
    assert.deepEqual((reloaded?.draftJson as V3StoryDraft | undefined)?.pages, originalPages);
  } finally {
    await cleanupUser(user.id);
  }
});

test('cover: idempotent — re-applying from ready does not regress stage', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp41-idempotent');
  try {
    const albumId = await seedCoverAlbum(user.id, 1);
    await albumService.cover(user.id, albumId, COVER_PATCH); // → ready
    const again = await albumService.cover(user.id, albumId, COVER_PATCH);
    assert.equal(again.stage, 'ready'); // no regression / no double-advance
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'ready');
  } finally {
    await cleanupUser(user.id);
  }
});

test('cover: rejects a non-owner', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const owner = await makeUser('wp41-owner');
  const intruder = await makeUser('wp41-intruder');
  try {
    const albumId = await seedCoverAlbum(owner.id, 1);
    await assert.rejects(
      () => albumService.cover(intruder.id, albumId, COVER_PATCH),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_OWNED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
  }
});

test('cover: persists patched draft pages so finalize sends cover design', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp51-cover-finalize-pages');
  try {
    const originalPages: Page[] = [
      {
        pageIndex: 0,
        templateId: 'mag-02',
        images: { image: 'pre-cover-photo', stale: 'old-photo' },
        texts: { title: 'Pre-cover', stale: 'old copy' },
        imagePos: { image: { x: 20, y: 80, scale: 1.4 } },
      },
      { pageIndex: 1, templateId: 'mag-05', images: { image: 'chapter-photo' }, texts: { body: 'Chapter' } },
    ];
    const { albumId } = await seedWrappedStoryAlbum(user.id, 1, {
      pages: originalPages,
      done: true,
      stage: 'cover',
    });
    const before = await albumRepo.findById(albumId);
    const beforeDraft = before?.draftJson as V3StoryDraft;
    const coverPatch = [
      {
        pageIndex: 0,
        templateId: 'mag-01',
        images: { image: 'cover-photo' },
        texts: { folio: '01', title: 'Cover after design' },
      },
    ];
    const expectedPages: Page[] = [
      {
        pageIndex: 0,
        templateId: 'mag-01',
        images: { image: 'cover-photo' },
        texts: { folio: '01', title: 'Cover after design' },
      },
      originalPages[1]!,
    ];

    const coverRes = await albumService.cover(user.id, albumId, coverPatch);
    assert.equal(coverRes.stage, 'ready');
    assert.deepEqual(coverRes.layoutPatch, coverPatch);

    const afterCover = await albumRepo.findById(albumId);
    const afterCoverDraft = afterCover?.draftJson as V3StoryDraft;
    assert.equal(afterCover?.stage, 'ready');
    assert.deepEqual(afterCoverDraft.pages, expectedPages);
    assert.deepEqual(afterCoverDraft.tree, beforeDraft.tree);
    assert.deepEqual(afterCoverDraft.progress, beforeDraft.progress);

    let payload: { pages?: unknown } = {};
    t.mock.method(agentClient, 'finalizeV3', async (p: Parameters<typeof agentClient.finalizeV3>[0]) => {
      payload = { pages: p.pages };
      return {
        layout: {
          magazine: { title: 'Cover based', style: 'warm-film', language: 'en' },
          photos: [],
          pages: p.pages,
        },
        usage: { durationMs: 1, models: {} },
      };
    });

    await albumService.finalize(user.id, albumId, 'en');
    assert.deepEqual(payload.pages, expectedPages);
  } finally {
    await cleanupUser(user.id);
  }
});

// ───────── ⑤ 待导出 — finalize (WP5.1 #194) ────────────────────────────────

test('finalize: uses draft_json.pages even when album_pages differs', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp51-finalize-page-source');
  try {
    const albumPages = [
      { pageIndex: 0, templateId: 'mag-02', images: { hero: 'draft-photo-1' }, texts: { title: 'Draft page' } },
    ];
    const { albumId } = await seedWrappedStoryAlbum(user.id, 1, { pages: albumPages, done: true });
    await albumPageRepo.bulkInsert(db, [
      {
        albumId,
        pageIndex: 0,
        templateId: 'mag-99',
        imagesJson: { hero: 'persisted-photo' },
        textsJson: { title: 'Persisted page' },
      },
    ]);

    let payload: { pages?: unknown } = {};
    t.mock.method(agentClient, 'finalizeV3', async (p: Parameters<typeof agentClient.finalizeV3>[0]) => {
      payload = { pages: p.pages };
      return {
        layout: {
          magazine: { title: 'Draft based', style: 'warm-film', language: 'en' },
          photos: [],
          pages: albumPages,
        },
        usage: { durationMs: 1, models: {} },
      };
    });

    const res = await albumService.finalize(user.id, albumId, 'en');
    assert.deepEqual(res.layout.pages, albumPages);
    assert.deepEqual(payload.pages, albumPages);
  } finally {
    await cleanupUser(user.id);
  }
});

test('finalize: throws VALIDATION_FAILED when draft_json.pages is missing or empty', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp51-finalize-no-pages');
  try {
    const { albumId } = await seedWrappedStoryAlbum(user.id, 1, { pages: [], done: true });
    let called = false;
    t.mock.method(agentClient, 'finalizeV3', async () => {
      called = true;
      return {
        layout: {
          magazine: { title: 'Should not run', style: 'warm-film', language: 'en' },
          photos: [],
          pages: [],
        },
        usage: { durationMs: 1, models: {} },
      };
    });

    await assert.rejects(() => albumService.finalize(user.id, albumId, 'en'), hasCode('VALIDATION_FAILED'));
    assert.equal(called, false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('finalize: does not call agent finalize when not all story chapters are done', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('wp51-finalize-gate');
  try {
    const albumId = await seedStoryAlbum(user.id, 2);
    let called = false;
    t.mock.method(agentClient, 'finalizeV3', async () => {
      called = true;
      return {
        layout: {
          magazine: { title: 'Should not run', style: 'warm-film', language: 'en' },
          photos: [],
          pages: [{ pageIndex: 0, templateId: 'mag-01', images: { hero: 'x' }, texts: {} }],
        },
        usage: { durationMs: 1, models: {} },
      };
    });

    await assert.rejects(() => albumService.finalize(user.id, albumId, 'en'), hasCode('VALIDATION_FAILED'));
    assert.equal(called, false);
  } finally {
    await cleanupUser(user.id);
  }
});

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
        description: 'chapter one',
        accentColor: null,
        artFont: null,
        photos: [{ photoId: 'p1', sceneDescription: 'beach', width: 800, height: 600, orientation: 'landscape' as const, takenAt: null }],
      },
      {
        chapterId: 'c2',
        description: 'chapter two',
        accentColor: null,
        artFont: null,
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

test('chapterChatTurn: slices ONLY the named chapter node + its pages to the agent', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('gap20-slice');
  try {
    const albumId = await seedChapterChatAlbum(user.id);
    const seen: Parameters<typeof agentClient.chapterChatV3>[0][] = [];
    t.mock.method(agentClient, 'chapterChatV3', async (p: Parameters<typeof agentClient.chapterChatV3>[0]) => {
      seen.push(p);
      return { kind: 'talk' as const, assistantReply: 'Tell me more.', usage: chatUsage };
    });

    await albumService.chapterChatTurn(user.id, albumId, {
      language: 'en',
      chapterId: 'c2',
      history: [],
      userMessage: 'about chapter two',
      focusedPageIndex: 1,
    });

    assert.equal(seen.length, 1, 'agent must be called once');
    const payload = seen[0]!;
    assert.equal(payload.albumId, albumId);
    // single-chapter slice: only c2's node, not the whole tree.
    assert.equal(payload.chapter.chapterId, 'c2');
    assert.deepEqual(payload.chapter.photos.map((ph) => ph.photoId), ['p2']);
    // only c2's page (the one whose image references p2) is forwarded.
    assert.deepEqual(payload.pages.map((pg) => pg.pageIndex), [1]);
    assert.equal(payload.userMessage, 'about chapter two');
    assert.equal(payload.focusedPageIndex, 1);
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
            description: 'coast morning',
            accentColor: null,
            artFont: null,
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
            description: 'city gallery',
            accentColor: null,
            artFont: null,
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
    assert.deepEqual(search.data.matches, [
      { chapterId: 'c1', pageIndexes: [1, 2], label: 'coast morning', score: 3 },
    ]);
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
            description: 'chapter one',
            accentColor: null,
            artFont: null,
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
            description: 'chapter two',
            accentColor: null,
            artFont: null,
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

test('chapterChatTurn: passes a write turn through verbatim + never mutates draft_json', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('gap20-passthrough');
  try {
    const albumId = await seedChapterChatAlbum(user.id);
    const before = (await albumRepo.findById(albumId))?.draftJson;
    t.mock.method(agentClient, 'chapterChatV3', async () => ({
      kind: 'write' as const,
      assistantReply: 'Done.',
      pagesTexts: [{ pageIndex: 0, texts: { headline: 'Coast Days' } }],
      nameOptions: ['Coast Days', 'By the Sea'],
      usage: chatUsage,
    }));

    const res = await albumService.chapterChatTurn(user.id, albumId, {
      language: 'en',
      chapterId: 'c1',
      history: [],
      userMessage: 'write it',
    });
    assert.equal(res.kind, 'write');
    assert.deepEqual(res.pagesTexts, [{ pageIndex: 0, texts: { headline: 'Coast Days' } }]);
    assert.deepEqual(res.nameOptions, ['Coast Days', 'By the Sea']);
    // The chat turn NEVER writes draft_json (browser mirrors patches; stage advances
    // only via markChapterDone). The persisted draft is byte-identical afterwards.
    const after = (await albumRepo.findById(albumId))?.draftJson;
    assert.deepEqual(after, before);
  } finally {
    await cleanupUser(user.id);
  }
});

test('chapterChatTurn: persists successful user and assistant turns with the chapter id', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('gap20-history-persist');
  try {
    const albumId = await seedChapterChatAlbum(user.id);
    t.mock.method(agentClient, 'chapterChatV3', async () => ({
      kind: 'talk' as const,
      assistantReply: 'What happened next?',
      usage: chatUsage,
    }));

    await albumService.chapterChatTurn(user.id, albumId, {
      language: 'en',
      chapterId: 'c1',
      history: [],
      userMessage: 'We went to the beach.',
    });

    const rows = await albumMessageRepo.findRecentByAlbumChapter(albumId, 'c1', 20);
    assert.deepEqual(
      rows.map((m) => ({ role: m.role, content: m.content, chapterId: m.chapterId })),
      [
        { role: 'user', content: 'We went to the beach.', chapterId: 'c1' },
        { role: 'assistant', content: 'What happened next?', chapterId: 'c1' },
      ],
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('chapterChatTurn: restores same-chapter DB history when the browser sends empty history', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('gap20-history-restore');
  try {
    const albumId = await seedChapterChatAlbum(user.id);
    await albumMessageRepo.create(db, {
      albumId,
      userId: user.id,
      chapterId: 'c2',
      role: 'user',
      content: 'This was the market day.',
    });
    await albumMessageRepo.create(db, {
      albumId,
      userId: user.id,
      chapterId: 'c2',
      role: 'assistant',
      content: 'Who was with you there?',
    });
    await albumMessageRepo.create(db, {
      albumId,
      userId: user.id,
      chapterId: 'c1',
      role: 'user',
      content: 'Different chapter should not leak.',
    });

    const seen: Parameters<typeof agentClient.chapterChatV3>[0][] = [];
    t.mock.method(agentClient, 'chapterChatV3', async (p: Parameters<typeof agentClient.chapterChatV3>[0]) => {
      seen.push(p);
      return { kind: 'talk' as const, assistantReply: 'Tell me more.', usage: chatUsage };
    });

    await albumService.chapterChatTurn(user.id, albumId, {
      language: 'en',
      chapterId: 'c2',
      history: [],
      userMessage: 'My sister was.',
    });

    assert.deepEqual(seen[0]!.history, [
      { role: 'user', content: 'This was the market day.' },
      { role: 'assistant', content: 'Who was with you there?' },
    ]);
  } finally {
    await cleanupUser(user.id);
  }
});

test('chapterChatTurn: unknown chapterId throws VALIDATION_FAILED before any agent call', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('gap20-bad-chapter');
  try {
    const albumId = await seedChapterChatAlbum(user.id);
    let called = false;
    t.mock.method(agentClient, 'chapterChatV3', async () => {
      called = true;
      return { kind: 'talk' as const, assistantReply: 'x', usage: chatUsage };
    });

    await assert.rejects(
      () => albumService.chapterChatTurn(user.id, albumId, {
        language: 'en',
        chapterId: 'nope',
        history: [],
        userMessage: 'hi',
      }),
      hasCode('VALIDATION_FAILED'),
    );
    assert.equal(called, false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('editChatTurn applies pagesTexts patches and acks after album transaction', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('edit-chat-atomic');
  try {
    const albumId = await seedStoryAlbum(user.id, 2);
    const calls: string[] = [];
    t.mock.method(agentClient, 'editChatV3', async () => ({
      kind: 'edit' as const,
      assistantReply: 'Updated.',
      pagesTexts: [{ pageIndex: 0, texts: { headline: 'Coast Days' } }],
      patches: [{ pageIndex: 1, texts: { body: 'Sea air' } }],
      progressDecision: { chapterDone: true },
      opId: 'op_1',
      usage: chatUsage,
    }));
    t.mock.method(agentClient, 'ackEditOp', async ({ opId }: { opId: string }) => {
      calls.push(opId);
      return true;
    });

    const res = await albumService.editChatTurn(user.id, albumId, {
      language: 'en',
      chapterId: 'c1',
      userMessage: 'write and finish',
      focusedPageIndex: 1,
    });

    assert.equal(res.opId, 'op_1');
    assert.deepEqual(calls, ['op_1']);
    const draft = (await albumRepo.findById(albumId))!.draftJson as V3StoryDraft;
    assert.equal(draft.pages?.[0]?.texts.headline, 'Coast Days');
    assert.equal(draft.pages?.[1]?.texts.body, 'Sea air');
    assert.deepEqual(draft.progress.doneChapterIds, ['c1']);
    assert.equal(draft.progress.currentChapterId, 'c2');
  } finally {
    await cleanupUser(user.id);
  }
});

test('editChatTurn keeps committed album changes when ack fails after the transaction', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('edit-chat-ack-fails-after-commit');
  try {
    const albumId = await seedStoryAlbum(user.id, 2);
    t.mock.method(agentClient, 'editChatV3', async () => ({
      kind: 'edit' as const,
      assistantReply: 'Updated, but ack will fail.',
      pagesTexts: [{ pageIndex: 0, texts: { headline: 'Committed Before Ack' } }],
      patches: [{ pageIndex: 1, texts: { body: 'This survives ack failure' } }],
      progressDecision: { chapterDone: true },
      opId: 'op_ack_after_commit',
      usage: chatUsage,
    }));
    t.mock.method(agentClient, 'ackEditOp', async () => {
      throw new Error('agent ack unavailable');
    });

    await assert.rejects(
      () =>
        albumService.editChatTurn(user.id, albumId, {
          language: 'en',
          chapterId: 'c1',
          userMessage: 'write and finish',
          focusedPageIndex: 1,
        }),
      /agent ack unavailable/,
    );

    const draft = (await albumRepo.findById(albumId))!.draftJson as V3StoryDraft;
    assert.equal(draft.pages?.[0]?.texts.headline, 'Committed Before Ack');
    assert.equal(draft.pages?.[1]?.texts.body, 'This survives ack failure');
    assert.deepEqual(draft.progress.doneChapterIds, ['c1']);
    assert.equal(draft.progress.currentChapterId, 'c2');
  } finally {
    await cleanupUser(user.id);
  }
});

test('editChatTurn never writes Web album_messages history', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('edit-chat-no-web-history');
  try {
    const albumId = await seedStoryAlbum(user.id, 1);
    t.mock.method(agentClient, 'editChatV3', async () => ({
      kind: 'talk' as const,
      assistantReply: 'Tell me more.',
      patches: [],
      opId: 'op_talk',
      usage: chatUsage,
    }));
    t.mock.method(agentClient, 'ackEditOp', async () => true);

    await albumService.editChatTurn(user.id, albumId, {
      language: 'en',
      chapterId: 'c1',
      userMessage: 'hello',
    });

    const rows = await albumMessageRepo.findRecentByAlbumChapter(albumId, 'c1', 20);
    assert.deepEqual(rows, []);
  } finally {
    await cleanupUser(user.id);
  }
});

test('editChatTurn maps advanceTo theme to album stage only after chapter progress write', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('edit-chat-theme');
  try {
    const albumId = await seedStoryAlbum(user.id, 1);
    t.mock.method(agentClient, 'editChatV3', async () => ({
      kind: 'talk' as const,
      assistantReply: 'Ready for theme.',
      patches: [],
      progressDecision: { chapterDone: true, advanceTo: 'theme' as const },
      opId: 'op_theme',
      usage: chatUsage,
    }));
    t.mock.method(agentClient, 'ackEditOp', async () => true);

    await albumService.editChatTurn(user.id, albumId, {
      language: 'en',
      chapterId: 'c1',
      userMessage: 'done',
    });

    const album = await albumRepo.findById(albumId);
    const draft = album?.draftJson as V3StoryDraft;
    assert.equal(album?.stage, 'theme');
    assert.deepEqual(draft.progress.doneChapterIds, ['c1']);
    assert.equal(draft.progress.currentChapterId, null);
  } finally {
    await cleanupUser(user.id);
  }
});

test('editChatTurn ignores advanceTo theme until every chapter is done', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('edit-chat-theme-gate');
  try {
    const albumId = await seedStoryAlbum(user.id, 2);
    t.mock.method(agentClient, 'editChatV3', async () => ({
      kind: 'talk' as const,
      assistantReply: 'First chapter done.',
      patches: [],
      progressDecision: { chapterDone: true, advanceTo: 'theme' as const },
      opId: 'op_theme_early',
      usage: chatUsage,
    }));
    t.mock.method(agentClient, 'ackEditOp', async () => true);

    await albumService.editChatTurn(user.id, albumId, {
      language: 'en',
      chapterId: 'c1',
      userMessage: 'done',
    });

    const album = await albumRepo.findById(albumId);
    const draft = album?.draftJson as V3StoryDraft;
    assert.equal(album?.stage, 'story');
    assert.deepEqual(draft.progress.doneChapterIds, ['c1']);
    assert.equal(draft.progress.currentChapterId, 'c2');
  } finally {
    await cleanupUser(user.id);
  }
});

test('editChatTurn rejects chapterDone for a non-current chapter', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('edit-chat-current-guard');
  try {
    const { albumId } = await seedWrappedStoryAlbum(user.id, 2, { stage: 'story' });
    let acked = false;
    t.mock.method(agentClient, 'editChatV3', async () => ({
      kind: 'talk' as const,
      assistantReply: 'Skipped ahead.',
      patches: [],
      progressDecision: { chapterDone: true },
      opId: 'op_wrong_chapter',
      usage: chatUsage,
    }));
    t.mock.method(agentClient, 'ackEditOp', async () => {
      acked = true;
      return true;
    });

    await assert.rejects(
      () =>
        albumService.editChatTurn(user.id, albumId, {
          language: 'en',
          chapterId: 'c2',
          userMessage: 'done',
        }),
      hasCode('VALIDATION_FAILED'),
    );

    const album = await albumRepo.findById(albumId);
    const draft = album?.draftJson as V3StoryDraft;
    assert.equal(acked, false);
    assert.equal(album?.stage, 'story');
    assert.deepEqual(draft.progress.doneChapterIds, []);
    assert.equal(draft.progress.currentChapterId, 'c1');
  } finally {
    await cleanupUser(user.id);
  }
});

test('editChatTurn supports case4 append page patch at next pageIndex', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('edit-chat-append');
  try {
    const albumId = await seedStoryAlbum(user.id, 1);
    t.mock.method(agentClient, 'editChatV3', async () => ({
      kind: 'edit' as const,
      assistantReply: 'Added a page.',
      patches: [{ pageIndex: 1, templateId: 'mag-03', images: { image: 'p1' }, texts: { title: 'More' } }],
      opId: 'op_append',
      usage: chatUsage,
    }));
    t.mock.method(agentClient, 'ackEditOp', async () => true);

    await albumService.editChatTurn(user.id, albumId, {
      language: 'en',
      chapterId: 'c1',
      userMessage: 'change layout and add page',
    });

    const draft = (await albumRepo.findById(albumId))!.draftJson as V3StoryDraft;
    assert.equal(draft.pages?.some((page) => page.pageIndex === 1 && page.templateId === 'mag-03'), true);
  } finally {
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
        description: 'a sunlit week by the coast',
        accentColor: null,
        artFont: null,
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

test('recommendTheme: re-slices the per-chapter overview server-side (no base64, text only)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('gap20-recommend');
  try {
    const albumId = await seedThemeCoverAlbum(user.id);
    const seen: Parameters<typeof agentClient.recommendV3>[0][] = [];
    t.mock.method(agentClient, 'recommendV3', async (p: Parameters<typeof agentClient.recommendV3>[0]) => {
      seen.push(p);
      return {
        chapterColors: [{ chapterId: 'c1', subject: 'By the Sea', accentColor: '#1F618D', artFont: 'sans-modern' }],
        assistantReply: 'Some themes.',
        usage: fullUsage,
      };
    });

    const res = await albumService.recommendTheme(user.id, albumId, { language: 'en', userMessage: 'warmer' });

    assert.equal(seen.length, 1);
    const payload = seen[0]!;
    assert.equal(payload.albumId, albumId);
    assert.equal(payload.userMessage, 'warmer');
    // Server re-sliced the overview from draft_json: chapterId + description + photo descs.
    assert.deepEqual(payload.chapters, [
      { chapterId: 'c1', description: 'a sunlit week by the coast', photoDescs: ['beach at dawn'] },
    ]);
    assert.equal(res.chapterColors[0]!.subject, 'By the Sea');
  } finally {
    await cleanupUser(user.id);
  }
});

test('applyThemeTurn: re-slices only the chapter themable pages + persists tree color/stage', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('gap20-apply');
  try {
    const albumId = await seedThemeCoverAlbum(user.id);
    const seen: Parameters<typeof agentClient.applyThemeV3>[0][] = [];
    t.mock.method(agentClient, 'applyThemeV3', async (p: Parameters<typeof agentClient.applyThemeV3>[0]) => {
      seen.push(p);
      return {
        layoutPatch: [{ pageIndex: 1, texts: { divider: '#C0392B' } }],
        assistantReply: 'Brushed.',
        usage: fullUsage,
      };
    });

    const res = await albumService.applyThemeTurn(user.id, albumId, {
      language: 'en',
      chapters: [{ chapterId: 'c1', subject: 'By the Sea', accentColor: '#C0392B', artFont: 'script-elegant' }],
    });

    assert.equal(seen.length, 1, 'one agent call per chapter with themable pages');
    // The browser sent NO pages; the service re-sliced ONLY c1's themable page (mag-13 #1).
    assert.deepEqual(seen[0]!.pages.map((pg) => pg.pageIndex), [1]);
    assert.equal(seen[0]!.chapters[0]!.chapterId, 'c1');

    assert.equal(res.stage, 'cover'); // theme → cover
    assert.deepEqual(res.layoutPatch, [{ pageIndex: 1, texts: { divider: '#C0392B' } }]);

    // Persisted: c1's node carries the chosen color/font; stage=cover; status ⟂.
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'cover');
    assert.equal(reloaded?.status, 'EDITING');
    const draft = reloaded?.draftJson as { tree: { chapters: Array<{ chapterId: string; accentColor: string | null; artFont: string | null }> } };
    const c1 = draft.tree.chapters.find((c) => c.chapterId === 'c1');
    assert.equal(c1?.accentColor, '#C0392B');
    assert.equal(c1?.artFont, 'script-elegant');
  } finally {
    await cleanupUser(user.id);
  }
});

test('coverTurn: re-slices the cover/ending pages server-side + folds patch into draft pages', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('gap20-cover');
  try {
    const albumId = await seedThemeCoverAlbum(user.id);
    await albumRepo.update(db, albumId, { stage: 'cover' });
    const seen: Parameters<typeof agentClient.coverV3>[0][] = [];
    t.mock.method(agentClient, 'coverV3', async (p: Parameters<typeof agentClient.coverV3>[0]) => {
      seen.push(p);
      return {
        layoutPatch: [{ pageIndex: 0, templateId: 'mag-01', images: { hero: 'cover-photo' }, texts: { title: 'My Book' } }],
        assistantReply: 'Cover filled.',
        needsUserInput: false,
        usage: fullUsage,
      };
    });

    const res = await albumService.coverTurn(user.id, albumId, {
      language: 'en',
      coverTemplateId: 'mag-01',
      endingTemplateId: 'mag-20',
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.coverTemplateId, 'mag-01');
    // The browser sent NO pages; the service re-sliced the non-chapter pages (cover #0 + ending #2).
    assert.deepEqual(seen[0]!.pages.map((pg) => pg.pageIndex).sort(), [0, 2]);

    assert.equal(res.stage, 'ready'); // cover → ready
    assert.deepEqual(res.layoutPatch, [
      { pageIndex: 0, templateId: 'mag-01', images: { hero: 'cover-photo' }, texts: { title: 'My Book' } },
    ]);
    // Persisted: the cover patch is folded into draft_json.pages so finalize sends it.
    const reloaded = await albumRepo.findById(albumId);
    const draft = reloaded?.draftJson as V3StoryDraft;
    assert.equal(draft.pages?.[0]?.texts.title, 'My Book');
  } finally {
    await cleanupUser(user.id);
  }
});

test('coverTurn: a chosen cover/ending photo is swapped into the page sent to the agent', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('cover-photo-swap');
  try {
    const albumId = await seedThemeCoverAlbum(user.id);
    await albumRepo.update(db, albumId, { stage: 'cover' });
    const seen: Parameters<typeof agentClient.coverV3>[0][] = [];
    t.mock.method(agentClient, 'coverV3', async (p: Parameters<typeof agentClient.coverV3>[0]) => {
      seen.push(p);
      return { layoutPatch: [], assistantReply: 'ok', usage: fullUsage };
    });

    await albumService.coverTurn(user.id, albumId, {
      language: 'en',
      coverTemplateId: 'mag-01',
      endingTemplateId: 'mag-20',
      coverPhotoId: 'p1', // change the cover hero from the seeded 'cover-photo' to 'p1'
      endingPhotoId: 'p1', // and put p1 on the ending hero too
    });

    assert.equal(seen.length, 1);
    // Relevant pages are the cover (#0) and ending (#2); the chosen photo replaces each
    // page's single hero VALUE (cover_v3 re-assigns slot keys to the chosen template).
    const byIndex = new Map(seen[0]!.pages.map((pg) => [pg.pageIndex, pg]));
    assert.deepEqual(Object.values(byIndex.get(0)!.images), ['p1']);
    assert.deepEqual(Object.values(byIndex.get(2)!.images), ['p1']);
    // The persisted draft pages are untouched by the swap (it only affects the agent call).
    const reloaded = await albumRepo.findById(albumId);
    const draft = reloaded?.draftJson as V3StoryDraft;
    assert.deepEqual(draft.pages?.[0]?.images, { hero: 'cover-photo' });
  } finally {
    await cleanupUser(user.id);
  }
});

test('coverTurn: forwards transient cover assets, user context, and derived coverPhotoDesc without persisting base64', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('cover-transient');
  try {
    const albumId = await seedThemeCoverAlbum(user.id);
    await albumRepo.update(db, albumId, { stage: 'cover' });
    const coverPhoto = 'data:image/jpeg;base64,cover-thumb';
    const endingPhoto = 'data:image/jpeg;base64,ending-thumb';
    const history = [{ role: 'assistant' as const, content: 'Do you want it warm?' }];
    const seen: Parameters<typeof agentClient.coverV3>[0][] = [];
    t.mock.method(agentClient, 'coverV3', async (p: Parameters<typeof agentClient.coverV3>[0]) => {
      seen.push(p);
      return { layoutPatch: [], assistantReply: 'ok', usage: fullUsage };
    });

    await albumService.coverTurn(user.id, albumId, {
      language: 'en',
      coverTemplateId: 'mag-01',
      endingTemplateId: 'mag-20',
      coverPhotoId: 'p1',
      endingPhotoId: 'p1',
      coverPhoto,
      endingPhoto,
      userMessage: 'make the cover warmer',
      history,
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.coverPhoto, coverPhoto);
    assert.equal(seen[0]!.endingPhoto, endingPhoto);
    assert.equal(seen[0]!.coverPhotoDesc, 'beach at dawn');
    assert.equal(seen[0]!.userMessage, 'make the cover warmer');
    assert.deepEqual(seen[0]!.history, history);

    const reloaded = await albumRepo.findById(albumId);
    const persistedDraft = JSON.stringify(reloaded?.draftJson);
    assert.equal(persistedDraft.includes('data:image/jpeg;base64'), false);
    assert.equal(persistedDraft.includes('cover-thumb'), false);
    assert.equal(persistedDraft.includes('ending-thumb'), false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('coverTurn: forwards the selected book artFont from the draft tree to the agent', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('cover-art-font');
  try {
    const albumId = await seedThemeCoverAlbum(user.id);
    const album = await albumRepo.findById(albumId);
    const draft = album?.draftJson as V3StoryDraft;
    await albumRepo.update(db, albumId, {
      stage: 'cover',
      draftJson: {
        ...draft,
        tree: {
          chapters: draft.tree.chapters.map((chapter) =>
            chapter.chapterId === 'c1'
              ? { ...chapter, accentColor: '#C0392B', artFont: 'display-bold' }
              : chapter,
          ),
        },
      },
    });
    const seen: Parameters<typeof agentClient.coverV3>[0][] = [];
    t.mock.method(agentClient, 'coverV3', async (p: Parameters<typeof agentClient.coverV3>[0]) => {
      seen.push(p);
      return { layoutPatch: [], assistantReply: 'ok', usage: fullUsage };
    });

    await albumService.coverTurn(user.id, albumId, {
      language: 'en',
      coverTemplateId: 'mag-01',
      endingTemplateId: 'mag-20',
    });

    assert.equal(seen.length, 1);
    assert.equal((seen[0] as { artFont?: unknown }).artFont, 'display-bold');
  } finally {
    await cleanupUser(user.id);
  }
});

test('coverTurn: needsUserInput true returns the agent patch but does not call cover or mutate draft/stage', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('cover-needs-input');
  try {
    const albumId = await seedThemeCoverAlbum(user.id);
    await albumRepo.update(db, albumId, { stage: 'cover' });
    const before = (await albumRepo.findById(albumId))?.draftJson;
    const patch = [{ pageIndex: 0, templateId: 'mag-01', texts: { title: 'Draft direction' } }];
    t.mock.method(agentClient, 'coverV3', async () => ({
      layoutPatch: patch,
      assistantReply: 'Which mood should the cover use?',
      needsUserInput: true,
      usage: fullUsage,
    }));
    let coverCalled = false;
    t.mock.method(albumService, 'cover', async () => {
      coverCalled = true;
      return { stage: 'ready', layoutPatch: [] };
    });

    const res = await albumService.coverTurn(user.id, albumId, {
      language: 'en',
      coverTemplateId: 'mag-01',
    });

    assert.equal(coverCalled, false);
    assert.equal(res.stage, 'cover');
    assert.equal(res.assistantReply, 'Which mood should the cover use?');
    assert.deepEqual(res.layoutPatch, patch);
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'cover');
    assert.deepEqual(reloaded?.draftJson, before);
  } finally {
    await cleanupUser(user.id);
  }
});

test('coverTurn: skip (no template ids) = empty patch, advances stage, never errors', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('gap20-cover-skip');
  try {
    const albumId = await seedThemeCoverAlbum(user.id);
    await albumRepo.update(db, albumId, { stage: 'cover' });
    const before = (await albumRepo.findById(albumId))?.draftJson;
    t.mock.method(agentClient, 'coverV3', async () => ({
      layoutPatch: [], // §4.4 跳过=空
      assistantReply: undefined,
      usage: fullUsage,
    }));

    const res = await albumService.coverTurn(user.id, albumId, { language: 'en' });

    assert.equal(res.stage, 'ready'); // skip does not block the gate
    assert.deepEqual(res.layoutPatch, []);
    // Empty patch → draft pages untouched (only stage moved).
    const reloaded = await albumRepo.findById(albumId);
    assert.equal(reloaded?.stage, 'ready');
    assert.deepEqual(
      (reloaded?.draftJson as V3StoryDraft).pages,
      (before as V3StoryDraft).pages,
      'skip must not mutate draft pages',
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('recommendTheme / applyThemeTurn / coverTurn: reject a non-owner before any agent call', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const owner = await makeUser('gap20-owner');
  const intruder = await makeUser('gap20-intruder');
  try {
    const albumId = await seedThemeCoverAlbum(owner.id);
    let called = false;
    t.mock.method(agentClient, 'recommendV3', async () => { called = true; throw new Error('unreached'); });
    t.mock.method(agentClient, 'applyThemeV3', async () => { called = true; throw new Error('unreached'); });
    t.mock.method(agentClient, 'coverV3', async () => { called = true; throw new Error('unreached'); });

    await assert.rejects(
      () => albumService.recommendTheme(intruder.id, albumId, { language: 'en' }),
      hasCode('ALBUM_NOT_OWNED'),
    );
    await assert.rejects(
      () => albumService.applyThemeTurn(intruder.id, albumId, {
        language: 'en',
        chapters: [{ chapterId: 'c1', subject: 'x', accentColor: '#000000', artFont: 'sans-modern' }],
      }),
      hasCode('ALBUM_NOT_OWNED'),
    );
    await assert.rejects(
      () => albumService.coverTurn(intruder.id, albumId, { language: 'en' }),
      hasCode('ALBUM_NOT_OWNED'),
    );
    assert.equal(called, false, 'ownership gate must precede every agent call');
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
  }
});
