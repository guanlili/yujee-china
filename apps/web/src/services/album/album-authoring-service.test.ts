import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMessageRepo } from '@/db/repos/album-message-repo';
import { agentClient } from '@/lib/agent/agent-client';
import { albumAuthoringService } from '@/services/album/album-authoring-service';
import { AlbumDraft } from '@yujee/contracts';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { ERRORS } from '@/lib/api/error-codes';

// W9 (#139) acceptance: the synchronous authoring loop (theme + chapter-chat).
//  - theme merges into draft_json.meta.theme (+ basePages.cover if returned).
//  - chapter-chat merges into the named chapter (pages.texts / brief / state /
//    askCount++), writes two album_messages (chapter_id), bumps updated_at, and
//    touches ONLY that chapter.
//  - ownership / draft-phase guards reject.
// The agent calls (themeV2 / chapterChatV2) are mocked — DB merge is what we assert.

const USAGE = {
  durationMs: 10,
  visionCallCount: 0,
  planningInputTokens: 0,
  planningOutputTokens: 0,
  repairAttempts: 0,
  models: {},
};

// A minimal-but-valid authoring tree: 2 chapters, a couple of photos, skeleton
// pages with empty texts so chapter-chat can fill them.
function makeDraft(): AlbumDraft {
  const tree = {
    version: 'v2' as const,
    meta: { style: 'warm-film' as const, language: 'en' as const, promptHint: 'a trip' },
    photoPool: [
      {
        photoId: 'p1',
        analysis: {
          photoId: 'p1',
          description: 'a sunset over the sea',
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
      {
        photoId: 'p2',
        analysis: {
          photoId: 'p2',
          description: 'a city street at night',
          tags: ['city'],
          quality: 'detail' as const,
          orientation: 'portrait' as const,
          peopleCount: '1' as const,
          scene: 'city' as const,
          mood: 'quiet' as const,
        },
        exif: { order: 1 },
        used: true,
      },
    ],
    basePages: {
      cover: { pageIndex: 0, templateId: 'mag-01', images: {}, texts: {} },
      ending: { pageIndex: 99, templateId: 'mag-17', images: {}, texts: {} },
    },
    chapters: [
      {
        chapterId: 'ch1',
        state: 'empty' as const,
        cluster: { label: 'The Coast', role: 'opening' as const, place: 'Big Sur' },
        photoIds: ['p1'],
        askCount: 0,
        pages: [{ pageIndex: 1, templateId: 'mag-02', images: { hero: 'p1' }, texts: {} }],
      },
      {
        chapterId: 'ch2',
        state: 'empty' as const,
        cluster: { label: 'The City', role: 'body' as const },
        photoIds: ['p2'],
        askCount: 0,
        pages: [{ pageIndex: 2, templateId: 'mag-03', images: { hero: 'p2' }, texts: {} }],
      },
    ],
  };
  // sanity: the fixture is a valid contract tree (would catch drift at authoring time).
  return AlbumDraft.parse(tree);
}

async function seedDraftAlbum(userId: string) {
  const album = await makeAlbum(userId);
  await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: makeDraft() });
  return album.id;
}

function reloadDraft(raw: unknown): AlbumDraft {
  return AlbumDraft.parse(raw);
}

test('theme → merges agent theme into draft_json.meta.theme + cover', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('w9-theme');
  try {
    const albumId = await seedDraftAlbum(user.id);
    let captured: unknown;
    t.mock.method(agentClient, 'themeV2', async (p: unknown) => {
      captured = p;
      return {
        theme: {
          subject: 'A Summer Road Trip',
          tone: 'nostalgic',
          style: 'vintage-print' as const,
        },
        cover: { templateId: 'mag-cover-A', texts: { title: 'Our Trip' }, heroPhotoId: 'p1' },
        themeOptions: [
          { subject: 'A Summer Road Trip', label: 'Summer Road Trip' },
          { subject: 'City Nights', label: 'City Nights', style: 'bold-contrast' as const },
        ],
        assistantReply: 'How about a nostalgic vintage feel?',
        usage: USAGE,
      };
    });

    const res = await albumAuthoringService.submitThemeV2(user.id, albumId, {
      userMessage: 'make it warm',
    });
    assert.equal(res.theme?.subject, 'A Summer Road Trip');
    // themeOptions pass straight through to the browser…
    assert.equal(res.themeOptions?.length, 2);
    assert.equal(res.themeOptions?.[1]?.label, 'City Nights');

    // overview built from the tree, no base64, photo descs sliced in.
    const sent = captured as { clustersOverview: Array<{ chapterId: string; photoDescs: string[] }> };
    assert.equal(sent.clustersOverview.length, 2);
    assert.deepEqual(sent.clustersOverview[0]!.photoDescs, ['a sunset over the sea']);

    const album = await albumRepo.findById(albumId);
    const draft = reloadDraft(album!.draftJson);
    assert.equal(draft.meta.theme?.subject, 'A Summer Road Trip');
    assert.equal(draft.meta.theme?.style, 'vintage-print');
    // cover merged: templateId/texts replaced, heroPhotoId → images.hero.
    assert.equal(draft.basePages.cover.templateId, 'mag-cover-A');
    assert.equal(draft.basePages.cover.texts.title, 'Our Trip');
    assert.equal(draft.basePages.cover.images.hero, 'p1');
    // …but are NOT persisted into draft_json (invariant 12 — display-only).
    assert.equal('themeOptions' in (draft.meta as Record<string, unknown>), false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('chapter-chat → merges into the named chapter, writes 2 album_messages with chapter_id, bumps updated_at, touches only that chapter', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('w9-chat');
  try {
    const albumId = await seedDraftAlbum(user.id);
    const before = await albumRepo.findById(albumId);
    const updatedBefore = before!.updatedAt.getTime();
    // ensure a measurable updated_at delta.
    await new Promise((r) => setTimeout(r, 10));

    t.mock.method(agentClient, 'chapterChatV2', async () => ({
      assistantReply: 'Tell me more about the beach.',
      chapterBrief: { userWords: 'we watched the sunset', mood: 'calm' },
      state: 'brief_ready' as const,
      pagesTexts: [{ pageIndex: 1, texts: { body: 'The sun melted into the sea.' } }],
      nameOptions: ['Waves Thinning Time', 'Wind from the Sea'],
      usage: USAGE,
    }));

    const res = await albumAuthoringService.submitChapterChatV2(user.id, albumId, {
      chapterId: 'ch1',
      userMessage: 'we watched the sunset together',
    });
    assert.equal(res.state, 'brief_ready');
    assert.equal(res.chapterId, 'ch1');
    // nameOptions pass straight through to the browser.
    assert.deepEqual(res.nameOptions, ['Waves Thinning Time', 'Wind from the Sea']);

    const album = await albumRepo.findById(albumId);
    const draft = reloadDraft(album!.draftJson);
    const ch1 = draft.chapters.find((c) => c.chapterId === 'ch1')!;
    const ch2 = draft.chapters.find((c) => c.chapterId === 'ch2')!;

    // merged into ch1: page texts, brief, state, askCount++.
    assert.equal(ch1.pages[0]!.texts.body, 'The sun melted into the sea.');
    assert.equal(ch1.brief?.userWords, 'we watched the sunset');
    assert.equal(ch1.state, 'brief_ready');
    assert.equal(ch1.askCount, 1);
    // nameOptions are display-only: NOT persisted into the chapter (invariant 12).
    assert.equal('nameOptions' in (ch1 as Record<string, unknown>), false);
    assert.equal(ch1.cluster.label, 'The Coast'); // chapter title (cluster label) unchanged.
    // ch2 untouched.
    assert.equal(ch2.state, 'empty');
    assert.equal(ch2.askCount, 0);
    assert.deepEqual(ch2.pages[0]!.texts, {});

    // two album_messages with chapter_id = ch1, roles user + assistant. (They
    // share a created_at within the tx, so don't assert a tie-break order.)
    const msgs = await albumMessageRepo.findRecentByAlbumChapter(albumId, 'ch1', 20);
    assert.equal(msgs.length, 2);
    assert.ok(msgs.every((m) => m.chapterId === 'ch1'));
    const userMsg = msgs.find((m) => m.role === 'user');
    const asstMsg = msgs.find((m) => m.role === 'assistant');
    assert.equal(userMsg?.content, 'we watched the sunset together');
    assert.equal(asstMsg?.content, 'Tell me more about the beach.');
    // no messages leaked onto ch2.
    assert.equal((await albumMessageRepo.findRecentByAlbumChapter(albumId, 'ch2', 20)).length, 0);

    // updated_at bumped (W7c expiry depends on it).
    assert.ok(album!.updatedAt.getTime() > updatedBefore, 'updated_at must advance');
  } finally {
    await cleanupUser(user.id);
  }
});

test('chapter-chat → resends only this chapter history; advances askCount each turn', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('w9-history');
  try {
    const albumId = await seedDraftAlbum(user.id);
    const seenHistories: number[] = [];
    let seenPhotoCount = -1;
    t.mock.method(agentClient, 'chapterChatV2', async (p: { history: unknown[]; chapter: { photos: unknown[] } }) => {
      seenHistories.push(p.history.length);
      seenPhotoCount = p.chapter.photos.length;
      return { assistantReply: 'ok', state: 'asking' as const, usage: USAGE };
    });

    await albumAuthoringService.submitChapterChatV2(user.id, albumId, {
      chapterId: 'ch1',
      userMessage: 'first',
    });
    await albumAuthoringService.submitChapterChatV2(user.id, albumId, {
      chapterId: 'ch1',
      userMessage: 'second',
    });

    // turn 1 sees empty history; turn 2 sees the 2 rows from turn 1.
    assert.deepEqual(seenHistories, [0, 2]);
    // only ch1's used photo analysis is sent (1 photo), no base64.
    assert.equal(seenPhotoCount, 1);

    const album = await albumRepo.findById(albumId);
    const ch1 = reloadDraft(album!.draftJson).chapters.find((c) => c.chapterId === 'ch1')!;
    assert.equal(ch1.askCount, 2);
  } finally {
    await cleanupUser(user.id);
  }
});

test('ownership + draft-phase guards reject', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const owner = await makeUser('w9-owner');
  const intruder = await makeUser('w9-intruder');
  try {
    const albumId = await seedDraftAlbum(owner.id);

    // wrong user → ALBUM_NOT_OWNED.
    await assert.rejects(
      () => albumAuthoringService.submitThemeV2(intruder.id, albumId, {}),
      (e) => e === ERRORS.ALBUM_NOT_OWNED() || (e as { code?: string }).code === 'ALBUM_NOT_OWNED',
    );

    // not in draft phase (still AGENT_RUNNING, no draft) → ALBUM_NOT_EDITABLE.
    const running = await makeAlbum(owner.id);
    await assert.rejects(
      () => albumAuthoringService.submitChapterChatV2(owner.id, running.id, {
        chapterId: 'ch1',
        userMessage: 'hi',
      }),
      (e) => (e as { code?: string }).code === 'ALBUM_NOT_EDITABLE',
    );

    // unknown chapter → VALIDATION_FAILED.
    await assert.rejects(
      () => albumAuthoringService.submitChapterChatV2(owner.id, albumId, {
        chapterId: 'nope',
        userMessage: 'hi',
      }),
      (e) => (e as { code?: string }).code === 'VALIDATION_FAILED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
  }
});
