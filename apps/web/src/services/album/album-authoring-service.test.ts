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
      ending: { pageIndex: 99, templateId: 'mag-03', images: {}, texts: {} },
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

    // #151: the turn is persisted as album_messages (parity with chapter-chat),
    // but theme is album-global so these rows carry NO chapter_id. user message
    // only because a userMessage was supplied; assistant always, carrying usage.
    const all = await albumMessageRepo.findByAlbum(albumId);
    assert.equal(all.length, 2);
    assert.ok(all.every((m) => m.chapterId === null), 'theme messages must have null chapter_id');
    const themeUser = all.find((m) => m.role === 'user');
    const themeAsst = all.find((m) => m.role === 'assistant');
    assert.equal(themeUser?.content, 'make it warm');
    assert.equal(themeAsst?.content, 'How about a nostalgic vintage feel?');
    assert.ok(themeAsst?.usage, 'assistant theme message carries usage');
    // null chapter_id → invisible to the per-chapter history slice, so theme
    // chatter never pollutes any chapter-chat context.
    assert.equal((await albumMessageRepo.findRecentByAlbumChapter(albumId, 'ch1', 20)).length, 0);
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

// ── #162 draft-edit: render-first + pointed single-page edit, talk/act split ──
// Flat page order from getDraftSkeleton (and what locatePage walks): cover(0) →
// ch1.page(1) → ch2.page(2) → ending(3). draft-edit slices ONLY the focused page
// + its photos, then on 'act' merges pageWrite.texts into that one page.

test('draft-edit act → merges pageWrite into the focused page only, persists, writes 2 messages (+layout_patch)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('w162-act');
  try {
    const albumId = await seedDraftAlbum(user.id);
    let captured: { page: { pageIndex: number; texts: Record<string, string>; images: Record<string, string> }; photos: unknown[]; focusedPageIndex?: number } | undefined;
    t.mock.method(agentClient, 'draftEditV2', async (p: typeof captured) => {
      captured = p;
      return {
        kind: 'act' as const,
        assistantReply: 'Done — gave that page a warmer line.',
        pageWrite: { pageIndex: 1, texts: { body: 'The sun melted into the sea.' } },
        usage: USAGE,
      };
    });

    // focus flat page 1 = ch1's only page (images {hero:'p1'}).
    const res = await albumAuthoringService.submitDraftEditV2(user.id, albumId, {
      pageIndex: 1,
      userMessage: 'make this page warmer',
    });
    assert.equal(res.kind, 'act');
    assert.equal(res.pageWrite?.pageIndex, 1);
    assert.equal(res.pageWrite?.texts.body, 'The sun melted into the sea.');

    // payload sliced ONE page + its photos only; focusedPageIndex forwarded.
    assert.ok(captured);
    assert.equal(captured!.page.pageIndex, 1);
    assert.equal(captured!.focusedPageIndex, 1);
    assert.deepEqual(captured!.page.images, { hero: 'p1' });
    // only p1's analysis is sent (the page references p1); no base64 anywhere.
    assert.equal(captured!.photos.length, 1);
    assert.equal((captured!.photos[0] as { photoId: string }).photoId, 'p1');
    const serialized = JSON.stringify(captured);
    assert.equal(serialized.includes('base64'), false);
    assert.equal(serialized.includes('photoPool'), false, 'no whole tree sent');
    assert.equal(serialized.includes('chapters'), false, 'no whole tree sent');

    // merged into the draft tree: ONLY ch1's page changed.
    const album = await albumRepo.findById(albumId);
    const draft = reloadDraft(album!.draftJson);
    const ch1 = draft.chapters.find((c) => c.chapterId === 'ch1')!;
    const ch2 = draft.chapters.find((c) => c.chapterId === 'ch2')!;
    assert.equal(ch1.pages[0]!.texts.body, 'The sun melted into the sea.');
    assert.deepEqual(ch2.pages[0]!.texts, {}, 'ch2 page untouched');
    assert.deepEqual(draft.basePages.cover.texts, {}, 'cover untouched');
    assert.deepEqual(draft.basePages.ending.texts, {}, 'ending untouched');
    // image slot is preserved (slot-scoped TEXT merge only).
    assert.deepEqual(ch1.pages[0]!.images, { hero: 'p1' });

    // 2 album_messages (user + assistant); assistant carries the write as
    // layout_patch + usage, both tagged with ch1's chapter_id (page is in ch1).
    const msgs = await albumMessageRepo.findRecentByAlbumChapter(albumId, 'ch1', 20);
    assert.equal(msgs.length, 2);
    assert.ok(msgs.every((m) => m.chapterId === 'ch1'));
    const userMsg = msgs.find((m) => m.role === 'user');
    const asstMsg = msgs.find((m) => m.role === 'assistant');
    assert.equal(userMsg?.content, 'make this page warmer');
    assert.equal(asstMsg?.content, 'Done — gave that page a warmer line.');
    assert.ok(asstMsg?.usage, 'assistant row carries usage');
    const patch = asstMsg?.layoutPatch as Array<{ pageIndex: number; textsJson: Record<string, string> }> | null;
    assert.equal(patch?.[0]?.pageIndex, 1);
    assert.equal(patch?.[0]?.textsJson.body, 'The sun melted into the sea.');
  } finally {
    await cleanupUser(user.id);
  }
});

test('draft-edit act on cover (flat page 0) → slot-scoped text merge keeps other slots, photos []', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('w162-cover');
  try {
    const albumId = await seedDraftAlbum(user.id);
    // seed the cover with an existing slot so we can prove a slot-scoped merge.
    const seeded = reloadDraft((await albumRepo.findById(albumId))!.draftJson);
    seeded.basePages.cover.texts = { title: 'Old Title', subtitle: 'keep me' };
    await albumRepo.update(db, albumId, { draftJson: seeded });

    let captured: { photos: unknown[]; page: { images: Record<string, string> } } | undefined;
    t.mock.method(agentClient, 'draftEditV2', async (p: typeof captured) => {
      captured = p;
      return {
        kind: 'act' as const,
        assistantReply: 'Updated the title.',
        pageWrite: { pageIndex: 0, texts: { title: 'A Summer by the Sea' } },
        usage: USAGE,
      };
    });

    const res = await albumAuthoringService.submitDraftEditV2(user.id, albumId, {
      pageIndex: 0,
      userMessage: 'rename the cover',
    });
    // returned merged texts include BOTH the new title and the kept subtitle.
    assert.equal(res.pageWrite?.texts.title, 'A Summer by the Sea');
    assert.equal(res.pageWrite?.texts.subtitle, 'keep me');
    // cover has no images → photos array present but empty (no base64).
    assert.deepEqual(captured!.page.images, {});
    assert.equal(captured!.photos.length, 0);

    const draft = reloadDraft((await albumRepo.findById(albumId))!.draftJson);
    assert.equal(draft.basePages.cover.texts.title, 'A Summer by the Sea');
    assert.equal(draft.basePages.cover.texts.subtitle, 'keep me', 'untouched slot preserved');
    // cover is not in any chapter → messages carry NO chapter_id.
    const all = await albumMessageRepo.findByAlbum(albumId);
    assert.equal(all.length, 2);
    assert.ok(all.every((m) => m.chapterId === null), 'cover edit messages have null chapter_id');
  } finally {
    await cleanupUser(user.id);
  }
});

test('draft-edit talk → writes 2 messages, NO draft mutation', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('w162-talk');
  try {
    const albumId = await seedDraftAlbum(user.id);
    const before = JSON.stringify((await albumRepo.findById(albumId))!.draftJson);

    t.mock.method(agentClient, 'draftEditV2', async () => ({
      kind: 'talk' as const,
      assistantReply: 'This page is about the coast at sunset — want it warmer or punchier?',
      usage: USAGE,
    }));

    const res = await albumAuthoringService.submitDraftEditV2(user.id, albumId, {
      pageIndex: 1,
      userMessage: 'what is this page about?',
    });
    assert.equal(res.kind, 'talk');
    assert.equal(res.pageWrite, undefined);

    // draft_json byte-identical (no mutation on talk).
    const after = JSON.stringify((await albumRepo.findById(albumId))!.draftJson);
    assert.equal(after, before, 'talk must not mutate draft_json');

    // still 2 messages; assistant has NO layout_patch (nothing applied).
    const msgs = await albumMessageRepo.findRecentByAlbumChapter(albumId, 'ch1', 20);
    assert.equal(msgs.length, 2);
    const asst = msgs.find((m) => m.role === 'assistant');
    assert.equal(asst?.layoutPatch ?? null, null, 'talk assistant row has no patch');
  } finally {
    await cleanupUser(user.id);
  }
});

test('draft-edit → unknown page index rejects; ownership guard rejects', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const owner = await makeUser('w162-owner');
  const intruder = await makeUser('w162-intruder');
  try {
    const albumId = await seedDraftAlbum(owner.id);
    // out-of-range flat index (only 0..3 exist) → VALIDATION_FAILED.
    await assert.rejects(
      () => albumAuthoringService.submitDraftEditV2(owner.id, albumId, { pageIndex: 99, userMessage: 'hi' }),
      (e) => (e as { code?: string }).code === 'VALIDATION_FAILED',
    );
    // wrong user → ALBUM_NOT_OWNED.
    await assert.rejects(
      () => albumAuthoringService.submitDraftEditV2(intruder.id, albumId, { pageIndex: 1, userMessage: 'hi' }),
      (e) => (e as { code?: string }).code === 'ALBUM_NOT_OWNED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
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

// ── #165 Phase 3: draft-edit inspect/imagePosWrite + inspect-render ──

test('draft-edit act → imagePosWrite folds {x,y,scale} into the page imagePos, persists', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('w165-pos');
  try {
    const albumId = await seedDraftAlbum(user.id);
    t.mock.method(agentClient, 'draftEditV2', async () => ({
      kind: 'act' as const,
      assistantReply: 'Nudged the photo down a touch.',
      imagePosWrite: { pageIndex: 1, imageId: 'hero', x: 50, y: 35, scale: 1.2 },
      usage: USAGE,
    }));

    const res = await albumAuthoringService.submitDraftEditV2(user.id, albumId, {
      pageIndex: 1,
      userMessage: 'the face is cut off, move it down',
    });
    assert.equal(res.kind, 'act');
    assert.equal(res.pageWrite, undefined, 'no copy write on a position adjust');
    assert.deepEqual(res.imagePosWrite, { pageIndex: 1, imageId: 'hero', x: 50, y: 35, scale: 1.2 });

    // persisted into draft_json: ONLY ch1's page imagePos.hero changed.
    const draft = reloadDraft((await albumRepo.findById(albumId))!.draftJson);
    const ch1 = draft.chapters.find((c) => c.chapterId === 'ch1')!;
    const ch2 = draft.chapters.find((c) => c.chapterId === 'ch2')!;
    assert.deepEqual(ch1.pages[0]!.imagePos, { hero: { x: 50, y: 35, scale: 1.2 } });
    assert.equal(ch2.pages[0]!.imagePos, undefined, 'ch2 page untouched');
    assert.deepEqual(ch1.pages[0]!.texts, {}, 'a position move does not change copy');

    // assistant message carries the position write as an imagePosJson patch.
    const msgs = await albumMessageRepo.findRecentByAlbumChapter(albumId, 'ch1', 20);
    assert.equal(msgs.length, 2);
    const asst = msgs.find((m) => m.role === 'assistant');
    const patch = asst?.layoutPatch as Array<{ pageIndex: number; imagePosJson?: Record<string, unknown> }> | null;
    assert.equal(patch?.[0]?.pageIndex, 1);
    assert.deepEqual(patch?.[0]?.imagePosJson, { hero: { x: 50, y: 35, scale: 1.2 } });
  } finally {
    await cleanupUser(user.id);
  }
});

test('draft-edit inspect → returns inspectRequest, NO draft mutation, NO messages', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('w165-inspect');
  try {
    const albumId = await seedDraftAlbum(user.id);
    const before = JSON.stringify((await albumRepo.findById(albumId))!.draftJson);
    t.mock.method(agentClient, 'draftEditV2', async () => ({
      kind: 'inspect' as const,
      assistantReply: 'Let me take a look at that page…',
      inspectRequest: { pageIndex: 1 },
      usage: USAGE,
    }));

    const res = await albumAuthoringService.submitDraftEditV2(user.id, albumId, {
      pageIndex: 1,
      userMessage: 'is the photo cropped weird?',
    });
    assert.equal(res.kind, 'inspect');
    assert.deepEqual(res.inspectRequest, { pageIndex: 1 });

    // The inspect turn is unfinished: no draft mutation, and NO messages written
    // (the follow-up draft-edit records the round).
    const after = JSON.stringify((await albumRepo.findById(albumId))!.draftJson);
    assert.equal(after, before, 'inspect must not mutate draft_json');
    const msgs = await albumMessageRepo.findByAlbum(albumId);
    assert.equal(msgs.length, 0, 'inspect writes no messages');
  } finally {
    await cleanupUser(user.id);
  }
});

test('inspect-render → slices ONE page + its photos, forwards screenshot, returns diagnosis, persists nothing', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('w165-irender');
  try {
    const albumId = await seedDraftAlbum(user.id);
    const before = JSON.stringify((await albumRepo.findById(albumId))!.draftJson);
    const SHOT = 'data:image/jpeg;base64,/9j/THIS-IS-A-FAKE-SCREENSHOT';
    let captured: { page: { pageIndex: number; images: Record<string, string> }; photos: unknown[]; screenshot: string } | undefined;
    t.mock.method(agentClient, 'inspectRenderV2', async (p: typeof captured) => {
      captured = p;
      return {
        diagnosis: {
          imageId: 'hero',
          problem: 'the subject is cut off at the top',
          suggestedDx: 0,
          suggestedDy: -12,
          suggestedScale: 1.1,
          confidence: 0.8,
        },
        assistantReply: 'The top of the subject is clipped — I can nudge it down.',
        usage: USAGE,
      };
    });

    const res = await albumAuthoringService.submitInspectRenderV2(user.id, albumId, {
      pageIndex: 1,
      userMessage: 'is the photo cropped weird?',
      screenshot: SHOT,
    });
    assert.equal(res.diagnosis.imageId, 'hero');
    assert.equal(res.diagnosis.suggestedDy, -12);

    // payload: ONE page slice + only that page's photos; screenshot forwarded.
    assert.ok(captured);
    assert.equal(captured!.page.pageIndex, 1);
    assert.deepEqual(captured!.page.images, { hero: 'p1' });
    assert.equal(captured!.photos.length, 1);
    assert.equal((captured!.photos[0] as { photoId: string }).photoId, 'p1');
    assert.equal(captured!.screenshot, SHOT, 'screenshot forwarded verbatim');
    // No whole tree leaves Web.
    const serialized = JSON.stringify({ ...captured, screenshot: '<redacted>' });
    assert.equal(serialized.includes('photoPool'), false, 'no whole tree sent');
    assert.equal(serialized.includes('chapters'), false, 'no whole tree sent');

    // NOTHING persisted: draft_json untouched, no messages, screenshot not stored.
    const after = JSON.stringify((await albumRepo.findById(albumId))!.draftJson);
    assert.equal(after, before, 'inspect-render must not mutate draft_json');
    assert.equal(after.includes('FAKE-SCREENSHOT'), false, 'screenshot never persisted');
    const msgs = await albumMessageRepo.findByAlbum(albumId);
    assert.equal(msgs.length, 0, 'inspect-render writes no messages');
  } finally {
    await cleanupUser(user.id);
  }
});

test('inspect-render → unknown page rejects; ownership guard rejects', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const owner = await makeUser('w165-irender-owner');
  const intruder = await makeUser('w165-irender-intruder');
  try {
    const albumId = await seedDraftAlbum(owner.id);
    await assert.rejects(
      () => albumAuthoringService.submitInspectRenderV2(owner.id, albumId, { pageIndex: 99, userMessage: 'hi', screenshot: 'data:,x' }),
      (e) => (e as { code?: string }).code === 'VALIDATION_FAILED',
    );
    await assert.rejects(
      () => albumAuthoringService.submitInspectRenderV2(intruder.id, albumId, { pageIndex: 1, userMessage: 'hi', screenshot: 'data:,x' }),
      (e) => (e as { code?: string }).code === 'ALBUM_NOT_OWNED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
  }
});
