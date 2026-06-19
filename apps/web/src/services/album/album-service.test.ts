import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/client';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
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
import { jobService } from '../job/job-service';
import { AlbumDraft, type Page, type V3ChapterThemeChoice, type V3StoryDraft } from '@yujee/contracts';

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

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

// ── W10 (#140): getDraftSkeleton — read-only RENDER projection of draft_json ──

function makeDraft(): AlbumDraft {
  const tree = {
    version: 'v2' as const,
    meta: { style: 'warm-film' as const, language: 'en' as const },
    photoPool: [
      {
        photoId: 'p1',
        analysis: {
          photoId: 'p1',
          description: 'sunset',
          tags: ['sea'],
          quality: 'hero' as const,
          orientation: 'landscape' as const,
          peopleCount: '0' as const,
          scene: 'nature' as const,
          mood: 'warm' as const,
        },
        exif: { order: 0 },
        used: true,
      },
    ],
    basePages: {
      cover: { pageIndex: 0, templateId: 'mag-01', images: { hero: 'p1' }, texts: {} },
      ending: { pageIndex: 99, templateId: 'mag-03', images: {}, texts: {} },
    },
    chapters: [
      {
        chapterId: 'ch1',
        state: 'empty' as const,
        cluster: { label: 'The Coast', role: 'opening' as const },
        photoIds: ['p1'],
        askCount: 0,
        pages: [
          { pageIndex: 1, templateId: 'mag-02', images: { hero: 'p1' }, texts: {} },
          { pageIndex: 2, templateId: 'mag-03', images: {}, texts: {} },
        ],
      },
      {
        chapterId: 'ch2',
        state: 'skipped' as const,
        cluster: { label: 'The City', role: 'body' as const },
        photoIds: [],
        askCount: 2,
        pages: [{ pageIndex: 3, templateId: 'mag-04', images: {}, texts: {} }],
      },
    ],
  };
  return AlbumDraft.parse(tree);
}

async function seedDraftAlbum(userId: string) {
  const album = await makeAlbum(userId);
  await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: makeDraft() });
  return album.id;
}

test('getDraftSkeleton: flattens + re-indexes pages, slices chapters, passes meta', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('w10-skeleton');
  try {
    const albumId = await seedDraftAlbum(user.id);
    const sk = await albumService.getDraftSkeleton(user.id, albumId);
    assert.ok(sk, 'skeleton present in draft phase');

    // cover(0) → ch1 p(1) → ch1 p(2) → ch2 p(3) → ending(4): 5 pages, re-indexed.
    assert.equal(sk!.pages.length, 5);
    assert.deepEqual(sk!.pages.map((p) => p.pageIndex), [0, 1, 2, 3, 4]);
    assert.deepEqual(
      sk!.pages.map((p) => p.kind),
      ['cover', 'chapter', 'chapter', 'chapter', 'ending'],
    );
    // image map carried through as imagesJson (EditorPage shape for PagePreview).
    assert.equal(sk!.pages[0]!.imagesJson.hero, 'p1');

    // chapter slices index into the flat list; ch1 owns flat [1,3), ch2 [3,4).
    assert.equal(sk!.chapters.length, 2);
    assert.deepEqual(sk!.chapters[0], {
      chapterId: 'ch1',
      label: 'The Coast',
      role: 'opening',
      state: 'empty',
      askCount: 0,
      pageStart: 1,
      pageEnd: 3,
    });
    assert.equal(sk!.chapters[1]!.pageStart, 3);
    assert.equal(sk!.chapters[1]!.pageEnd, 4);
    assert.equal(sk!.chapters[1]!.state, 'skipped');

    assert.equal(sk!.theme, null);
    assert.equal(sk!.style, 'warm-film');
    assert.equal(sk!.language, 'en');
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
        { chapterId: 'c1', accentColor: '#C0392B', artFont: 'script-elegant' },
        { chapterId: 'c2', accentColor: '#1F618D', artFont: 'sans-modern' },
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
    assert.deepEqual(draft.pages, makePreviewPages(2), 'applyTheme must preserve V3 preview pages in draft_json');
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
    const choices = [{ chapterId: 'c1', accentColor: '#2ECC71', artFont: 'display-bold' }] satisfies V3ChapterThemeChoice[];
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
            { chapterId: 'c1', accentColor: '#C0392B', artFont: 'serif-classic' },
            { chapterId: 'ghost', accentColor: '#000000', artFont: 'sans-modern' },
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
          [{ chapterId: 'c1', accentColor: '#C0392B', artFont: 'serif-classic' }] satisfies V3ChapterThemeChoice[],
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
            { chapterId: 'c1', accentColor: '#C0392B', artFont: 'serif-classic' },
            { chapterId: 'c1', accentColor: '#1F618D', artFont: 'sans-modern' },
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
          [{ chapterId: 'c1', accentColor: '#C0392B', artFont: 'serif-classic' }] satisfies V3ChapterThemeChoice[],
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
