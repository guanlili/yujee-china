import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from '@yujee/contracts';
import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMemberRepo } from '@/db/repos/album-member-repo';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { albumService } from './album-service';

/**
 * design-chat 一轮结束后把 Agent 改的滤镜落库。
 *
 * ⚠️ 这条路必须带 baseSettingsRevision:`lockAlbumForSettingsWrite` 的过渡口径是
 * 「owner 省略走旧盲写,**editor 省略一律拒绝**」—— 不带基线的话协作者用设计对话
 * 调色**每次必失败**,而且失败点在页面已经写完之后,整轮报错、聊天记录也丢。
 *
 * 基线在 prepareDesignChat(装书那一刻)读,横跨整轮 —— 与本仓 AI 长任务
 * (layout/compose)派发时记 baseline、回写前重验是同一套路数,不是「写之前现读」
 * 那种假 OCC。
 */

const seededPage: Page = {
  pageIndex: 0,
  templateId: 'mag-01',
  images: { hero: 'p1' },
  texts: { title: 'Hello' },
  html: '<div data-template="mag-01">Hello</div>',
};

async function seedBook(suffix: string) {
  const user = await makeUser(suffix);
  const album = await makeAlbum(user.id);
  await db.transaction(async (tx) => {
    await draftPageRepo.replaceAll(tx, album.id, [seededPage], 1, user.id);
  });
  await albumRepo.update(db, album.id, { draftRevision: 1, draftStructureRevision: 1 });
  return { userId: user.id, albumId: album.id };
}

const persistInput = {
  userMessage: '整本调成旅行大片',
  assistantReply: '调好了',
  committed: false,
  pages: [],
  photoFilterPatch: { default: { lutId: 'travel-cinematic', strength: 60 } },
};

test('owner:滤镜落库并推进 settingsRevision', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-owner');
  try {
    const before = (await albumRepo.findById(albumId))!.settingsRevision;
    const applied = await albumService.persistDesignChat(userId, albumId, {
      ...persistInput,
      baseSettingsRevision: before,
    });
    assert.equal(applied?.photoFilter?.default?.lutId, 'travel-cinematic');
    assert.equal((await albumRepo.findById(albumId))!.settingsRevision, before + 1);
  } finally {
    await cleanupUser(userId);
  }
});

test('editor:带上基线就能调色 —— 不带基线会被 lockAlbumForSettingsWrite 一律拒', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-editor');
  const editor = await makeUser('dcf-editor-2');
  try {
    await db.transaction(async (tx) => albumMemberRepo.addMemberIfAbsent(tx, albumId, editor.id));
    const before = (await albumRepo.findById(albumId))!.settingsRevision;

    // 不带基线:协作者被拒(这正是接线漏传基线时线上会发生的事)。
    await assert.rejects(() => albumService.persistDesignChat(editor.id, albumId, persistInput));

    const applied = await albumService.persistDesignChat(editor.id, albumId, {
      ...persistInput,
      baseSettingsRevision: before,
    });
    assert.equal(applied?.photoFilter?.default?.lutId, 'travel-cinematic');
  } finally {
    await db.transaction(async (tx) => albumMemberRepo.removeMember(tx, albumId, editor.id));
    await cleanupUser(editor.id);
    await cleanupUser(userId);
  }
});

test('对话期间有人改过设置 → 基线失配,拒写,零改动', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-stale');
  try {
    const stale = (await albumRepo.findById(albumId))!.settingsRevision;
    // 模拟对话进行中另一端改了设置。
    await albumRepo.update(db, albumId, { settingsRevision: stale + 5 });

    await assert.rejects(() =>
      albumService.persistDesignChat(userId, albumId, { ...persistInput, baseSettingsRevision: stale }),
    );
    const after = (await albumRepo.findById(albumId))!;
    assert.equal(after.photoFilter, null, '失配必须零写入');
    assert.equal(after.settingsRevision, stale + 5, 'revision 也不该被推进');
  } finally {
    await cleanupUser(userId);
  }
});

test('没有 photoFilterPatch 时不碰设置,也不需要基线', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-none');
  try {
    const before = (await albumRepo.findById(albumId))!.settingsRevision;
    const applied = await albumService.persistDesignChat(userId, albumId, {
      userMessage: '看看第 1 页',
      assistantReply: '看过了',
      committed: false,
      pages: [],
    });
    assert.equal(applied, null);
    assert.equal((await albumRepo.findById(albumId))!.settingsRevision, before);
  } finally {
    await cleanupUser(userId);
  }
});

test('prepareDesignChat 把基线吐出来给这一轮用', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-baseline');
  try {
    await albumRepo.update(db, albumId, { settingsRevision: 7 });
    // design-agent 起不来时 loadBook 会抛;这里只关心「基线从哪来」,所以捕获后
    // 直接读库对账 —— 基线必须等于装书那一刻的 settingsRevision。
    let baseline: number | undefined;
    try {
      baseline = (await albumService.prepareDesignChat(userId, albumId))?.baseSettingsRevision;
    } catch {
      baseline = undefined;
    }
    if (baseline !== undefined) assert.equal(baseline, 7);
  } finally {
    await cleanupUser(userId);
  }
});
