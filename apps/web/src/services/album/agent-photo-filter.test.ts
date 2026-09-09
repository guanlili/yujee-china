import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from '@yujee/contracts';
import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMemberRepo } from '@/db/repos/album-member-repo';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { applyAgentPhotoFilter } from './agent-photo-filter';

// design-agent 的滤镜写入 seam。滤镜在 albums.photo_filter 走 settingsRevision,
// 页面在 draft_pages 走页面 version —— 两套 OCC 各走各的,这个 seam 只碰前者。

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

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

async function readBack(albumId: string) {
  const album = (await albumRepo.findById(albumId))!;
  const pages = await draftPageRepo.findByAlbum(albumId);
  return { album, pages };
}

test('applyAgentPhotoFilter: 滤镜写入走 settingsRevision,不碰页面 version', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-rev');
  try {
    const before = await readBack(albumId);
    await applyAgentPhotoFilter(
      userId,
      albumId,
      { default: { lutId: 'travel-cinematic', strength: 60 } },
      before.album.settingsRevision,
    );
    const after = await readBack(albumId);
    assert.equal(after.album.settingsRevision, before.album.settingsRevision + 1);
    assert.equal(after.album.photoFilter?.default?.lutId, 'travel-cinematic');
    // 页面那条 OCC 一动不动:version 和 draftRevision/draftStructureRevision 都不许变。
    assert.equal(after.pages[0]!.version, before.pages[0]!.version);
    assert.deepEqual(after.pages[0]!.page, before.pages[0]!.page);
    assert.equal(after.album.draftRevision, before.album.draftRevision);
    assert.equal(after.album.draftStructureRevision, before.album.draftStructureRevision);
    assert.deepEqual(after.album.draftJson, before.album.draftJson);
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: settingsRevision 失配 409,零写入', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-conflict');
  try {
    await applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'retro-film', strength: 40 } }, 0);
    const before = await readBack(albumId);

    await assert.rejects(
      () => applyAgentPhotoFilter(userId, albumId, { default: null }, before.album.settingsRevision - 1),
      hasCode('SETTINGS_CONFLICT'),
    );

    const after = await readBack(albumId);
    assert.deepEqual(after.album.photoFilter, before.album.photoFilter);
    assert.equal(after.album.settingsRevision, before.album.settingsRevision);
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 关抠图是删键,存储里绝不出现 false', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-cutout');
  try {
    const rev0 = (await albumRepo.findById(albumId))!.settingsRevision;
    const on = await applyAgentPhotoFilter(userId, albumId, { cutouts: { p1: true, p2: true } }, rev0);
    assert.deepEqual((await albumRepo.findById(albumId))!.photoFilter?.cutouts, { p1: true, p2: true });

    await applyAgentPhotoFilter(userId, albumId, { cutouts: { p1: null } }, on.settingsRevision);
    const raw = JSON.stringify((await albumRepo.findById(albumId))!.photoFilter);
    assert.ok(!raw.includes('false'), 'cutouts 只认 true,关掉是删键');
    assert.ok(!raw.includes('"p1"'), '关掉的 photoId 不留在存储里');
    assert.ok(raw.includes('"p2"'), '没被关的那张要留着');
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 全关之后连 cutouts 这个壳一起删掉', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-cutout-shell');
  try {
    const rev0 = (await albumRepo.findById(albumId))!.settingsRevision;
    const on = await applyAgentPhotoFilter(userId, albumId, { cutouts: { p1: true } }, rev0);
    const off = await applyAgentPhotoFilter(userId, albumId, { cutouts: { p1: null } }, on.settingsRevision);
    assert.equal(off.photoFilter?.cutouts, undefined, '不留空对象');
    assert.equal((await albumRepo.findById(albumId))!.photoFilter?.cutouts, undefined);
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: strength 过 quantizeStrength', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-strength');
  try {
    const rev0 = (await albumRepo.findById(albumId))!.settingsRevision;
    const result = await applyAgentPhotoFilter(
      userId,
      albumId,
      { default: { lutId: 'retro-film', strength: 63 }, overrides: { p1: { lutId: 'night-film', strength: 22 } } },
      rev0,
    );
    assert.equal(result.photoFilter?.default?.strength, 65);
    assert.equal(result.photoFilter?.overrides?.p1?.strength, 20);
    const stored = (await albumRepo.findById(albumId))!.photoFilter;
    assert.equal(stored?.default?.strength, 65);
    assert.equal(stored?.overrides?.p1?.strength, 20);
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: patch 是合并不是整替 —— 没提到的维度原样保留', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-merge');
  try {
    let rev = (await albumRepo.findById(albumId))!.settingsRevision;
    rev = (await applyAgentPhotoFilter(
      userId, albumId,
      { default: { lutId: 'retro-film', strength: 40 }, overrides: { p1: null }, cutouts: { p9: true } },
      rev,
    )).settingsRevision;

    // 只改 overrides:default 和 cutouts 必须原样留着。
    const merged = await applyAgentPhotoFilter(
      userId, albumId,
      { overrides: { p2: { lutId: 'night-film', strength: 50 } } },
      rev,
    );
    assert.equal(merged.photoFilter?.default?.lutId, 'retro-film');
    assert.deepEqual(merged.photoFilter?.cutouts, { p9: true });
    assert.equal(merged.photoFilter?.overrides?.p1, null, '显式 null 覆盖(原片)要保留');
    assert.equal(merged.photoFilter?.overrides?.p2?.lutId, 'night-film');
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 非成员被拒', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-stranger');
  const stranger = await makeUser('agent-filter-stranger-2');
  try {
    const rev = (await albumRepo.findById(albumId))!.settingsRevision;
    await assert.rejects(
      () => applyAgentPhotoFilter(stranger.id, albumId, { default: null }, rev),
      hasCode('ALBUM_ACCESS_DENIED'),
    );
    assert.equal((await albumRepo.findById(albumId))!.settingsRevision, rev);
  } finally {
    await cleanupUser(stranger.id);
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 协作者(editor)可写,但省略基线一律拒', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-editor');
  const editor = await makeUser('agent-filter-editor-2');
  try {
    await db.transaction(async (tx) => albumMemberRepo.addMemberIfAbsent(tx, albumId, editor.id));
    const rev = (await albumRepo.findById(albumId))!.settingsRevision;

    // 可选 schema 下唯一的协同并发防线:editor 省略基线一律拒绝。
    await assert.rejects(
      () => applyAgentPhotoFilter(editor.id, albumId, { default: null }, undefined),
      hasCode('VALIDATION_FAILED'),
    );
    const ok = await applyAgentPhotoFilter(
      editor.id, albumId, { default: { lutId: 'fuji-clear', strength: 30 } }, rev,
    );
    assert.equal(ok.photoFilter?.default?.lutId, 'fuji-clear');
  } finally {
    await db.transaction(async (tx) => albumMemberRepo.removeMember(tx, albumId, editor.id));
    await cleanupUser(editor.id);
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 不认识的 lutId 在写库之前就被拒,零写入', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-bad-lut');
  try {
    const rev = (await albumRepo.findById(albumId))!.settingsRevision;
    await assert.rejects(
      () => applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'not-a-lut', strength: 50 } } as never, rev),
      hasCode('VALIDATION_FAILED'),
    );
    const after = (await albumRepo.findById(albumId))!;
    assert.equal(after.photoFilter, null);
    assert.equal(after.settingsRevision, rev);
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 改滤镜清掉 PDF/封面派生物(与 updatePhotoFilter 同口径)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-derivatives');
  try {
    await albumRepo.update(db, albumId, {
      status: 'COMPLETED',
      pdfUrl: 'https://cdn.yujee.test/book.pdf',
      pdfR2Key: `pdfs/${userId}/${albumId}.pdf`,
      coverThumbnailUrl: 'https://cdn.yujee.test/cover.jpg',
      coverThumbnailR2Key: `cover-thumbs/${userId}/${albumId}.jpg`,
    });
    const rev = (await albumRepo.findById(albumId))!.settingsRevision;
    await applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev);

    const after = (await albumRepo.findById(albumId))!;
    assert.equal(after.pdfUrl, null);
    assert.equal(after.pdfR2Key, null);
    assert.equal(after.coverThumbnailUrl, null);
    assert.equal(after.coverThumbnailR2Key, null);
    assert.equal(after.status, 'EDITING');
  } finally {
    await cleanupUser(userId);
  }
});
