import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from '@yujee/contracts';
import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMemberRepo } from '@/db/repos/album-member-repo';
import { albumShareRepo } from '@/db/repos/album-share-repo';
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

// ── 分享快照护栏(B4)────────────────────────────────────────────────────────
// Agent 一句「整本调成旅行大片」会让全书 renderVersion 失配,已发布的分享页需要
// 重新备份全书(还撞 300 张上限)。按小雨拍板的「Agent 全权」:告知,不阻断。

// 已备份但**没分享**的书。护栏的两个条件(版本串真变了 + 存在已发布分享)必须
// 都测到:只用「没备份也没分享」的书当反例是假绿 —— 空备份集合会在查分享之前
// 就早退,把 existsByAlbum 那道闸整个跳过(mutation 实测:删掉那行仍 15/15 全绿)。
async function seedBackedUpBook(suffix: string, photoIds: string[]) {
  const seeded = await seedBook(suffix);
  await albumRepo.update(db, seeded.albumId, {
    photoSnapshot: {
      photoIds,
      renderVersions: Object.fromEntries(photoIds.map((id) => [id, 'pf-v1__original'])),
      updatedAt: new Date().toISOString(),
    },
  });
  return seeded;
}

async function seedSharedBook(suffix: string, photoIds: string[]) {
  const seeded = await seedBackedUpBook(suffix, photoIds);
  await db.transaction(async (tx) =>
    albumShareRepo.create(tx, {
      token: `agent-filter-${suffix}-${Date.now()}`,
      albumId: seeded.albumId,
      title: 'shared',
      snapshotJson: { pages: [], photoUrls: {}, boardBackground: null, locale: 'zh' },
    }),
  );
  return seeded;
}

test('applyAgentPhotoFilter: 书有已发布分享时,返回 warning 说明会失配', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedSharedBook('shared-warn', ['p1', 'p2']);
  try {
    const rev = (await albumRepo.findById(albumId))!.settingsRevision;
    const result = await applyAgentPhotoFilter(
      userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev,
    );
    assert.ok(result.warnings.some((w) => w.includes('分享')), result.warnings.join(' | '));
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 没有分享时不产生噪音 warning', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  // 已备份、版本串确实会变 —— 唯一不 warning 的理由就是这本书没分享过。
  const { userId, albumId } = await seedBackedUpBook('unshared-quiet', ['p1', 'p2']);
  try {
    const rev = (await albumRepo.findById(albumId))!.settingsRevision;
    const result = await applyAgentPhotoFilter(
      userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev,
    );
    assert.deepEqual(result.warnings, []);
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: warning 不阻断写入', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedSharedBook('shared-nonblocking', ['p1']);
  try {
    const rev = (await albumRepo.findById(albumId))!.settingsRevision;
    const result = await applyAgentPhotoFilter(
      userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev,
    );
    assert.equal(result.warnings.length > 0, true);
    // 小雨拍板 Agent 全权:告知,不阻断。
    assert.equal((await albumRepo.findById(albumId))!.photoFilter?.default?.lutId, 'night-film');
    assert.equal(result.settingsRevision, rev + 1);
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 只改了不影响 renderVersion 的东西时不 warning', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedSharedBook('shared-noop', ['p1']);
  try {
    let rev = (await albumRepo.findById(albumId))!.settingsRevision;
    rev = (await applyAgentPhotoFilter(
      userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev,
    )).settingsRevision;

    // (a) 原样重放同一个 patch:每张照片的版本串逐字节不变 → 别吓唬用户。
    const replay = await applyAgentPhotoFilter(
      userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev,
    );
    assert.deepEqual(replay.warnings, [], replay.warnings.join(' | '));

    // (b) 只动一张**不在备份集合里**的照片:分享页压根不引用它,同样不该 warning。
    const unrelated = await applyAgentPhotoFilter(
      userId, albumId, { overrides: { not_in_snapshot: null } }, replay.settingsRevision,
    );
    assert.deepEqual(unrelated.warnings, [], unrelated.warnings.join(' | '));
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 开抠图同样让备份失配,要 warning(__cut1 尾段)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedSharedBook('shared-cutout', ['p1']);
  try {
    const rev = (await albumRepo.findById(albumId))!.settingsRevision;
    const result = await applyAgentPhotoFilter(userId, albumId, { cutouts: { p1: true } }, rev);
    assert.ok(result.warnings.some((w) => w.includes('分享')), result.warnings.join(' | '));
  } finally {
    await cleanupUser(userId);
  }
});

// ── 同值重写必须是空操作 ────────────────────────────────────────────────────
// 派生物清理和 COMPLETED→EDITING 都是**无条件**做的,所以用户再问一句「确认下调色」
// 让 Agent 把同一份滤镜再写一遍,PDF 链接和封面缩略图就凭空消失了。
test('applyAgentPhotoFilter: 同值重写不清 PDF/封面、不把 COMPLETED 打回 EDITING、不推进 revision', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-noop');
  try {
    const rev0 = (await albumRepo.findById(albumId))!.settingsRevision;
    await applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev0);
    // 落完滤镜之后再挂上派生物,模拟「调完色又导出过一次」的书。
    await albumRepo.update(db, albumId, {
      status: 'COMPLETED',
      pdfUrl: 'https://cdn.yujee.test/book.pdf',
      pdfR2Key: `pdfs/${userId}/${albumId}.pdf`,
      coverThumbnailUrl: 'https://cdn.yujee.test/cover.jpg',
      coverThumbnailR2Key: `cover-thumbs/${userId}/${albumId}.jpg`,
    });
    const before = (await albumRepo.findById(albumId))!;

    const result = await applyAgentPhotoFilter(
      userId,
      albumId,
      { default: { lutId: 'night-film', strength: 50 } },
      before.settingsRevision,
    );

    const after = (await albumRepo.findById(albumId))!;
    assert.equal(after.settingsRevision, before.settingsRevision, '没变就别推进 revision');
    assert.equal(after.pdfUrl, 'https://cdn.yujee.test/book.pdf');
    assert.equal(after.pdfR2Key, before.pdfR2Key);
    assert.equal(after.coverThumbnailUrl, 'https://cdn.yujee.test/cover.jpg');
    assert.equal(after.coverThumbnailR2Key, before.coverThumbnailR2Key);
    assert.equal(after.status, 'COMPLETED', '没改任何像素,不该把书打回 EDITING');
    // 返回的仍是库里那份权威状态,调用方照常拿得到。
    assert.equal(result.photoFilter?.default?.lutId, 'night-film');
    assert.equal(result.settingsRevision, before.settingsRevision);
    assert.deepEqual(result.warnings, []);
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: strength 归一化之后才判同值(52 与 50 归一后同值)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-noop-quantize');
  try {
    const rev0 = (await albumRepo.findById(albumId))!.settingsRevision;
    await applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev0);
    const before = (await albumRepo.findById(albumId))!;
    await applyAgentPhotoFilter(
      userId, albumId, { default: { lutId: 'night-film', strength: 52 } }, before.settingsRevision,
    );
    assert.equal((await albumRepo.findById(albumId))!.settingsRevision, before.settingsRevision);
  } finally {
    await cleanupUser(userId);
  }
});

test('applyAgentPhotoFilter: 真的变了就照常写(同值短路不能把正常写入也吞掉)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedBook('agent-filter-noop-negative');
  try {
    const rev0 = (await albumRepo.findById(albumId))!.settingsRevision;
    await applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev0);
    const before = (await albumRepo.findById(albumId))!;
    await applyAgentPhotoFilter(
      userId, albumId, { default: { lutId: 'night-film', strength: 70 } }, before.settingsRevision,
    );
    const after = (await albumRepo.findById(albumId))!;
    assert.equal(after.settingsRevision, before.settingsRevision + 1);
    assert.equal(after.photoFilter?.default?.strength, 70);
  } finally {
    await cleanupUser(userId);
  }
});
