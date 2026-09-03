import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../db/client';
import { albumRepo } from '../../db/repos/album-repo';
import { draftPageRepo } from '../../db/repos/draft-page-repo';
import { albumMemberRepo } from '../../db/repos/album-member-repo';
import { albumEditLinkRepo } from '../../db/repos/album-edit-link-repo';
import { albumPhotoRepo } from '../../db/repos/album-photo-repo';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
import {
  cleanupUser,
  isDbReachable,
  makeAlbum,
  makeUser,
} from '../../db/repos/__test__/setup';
import {
  albumCapabilities,
  captureJobBaseline,
  collaborationService,
  findBaselineStaleReason,
  invitationReadiness,
} from './collaboration-service';
import { albumService } from '../album/album-service';
import { photoOriginalService } from '../album/photo-original-service';
import type { Page } from '@yujee/contracts';

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

const seededPage: Page = {
  pageIndex: 0,
  templateId: 'mag-01',
  images: { hero: 'photo-1' },
  texts: { title: 'Hello' },
  html: '<div data-template="mag-01">Hello</div>',
};

// V3 可协同相册:getDraftSkeleton 可解析(draftJson 树 + EDITING + layoutJson
// null)+ draft_pages 已播种 ≥1 行。手工把行和 revision/structureRevision 都摆成
// 真实播种路径的终态(ensureDraftPagesSeeded 落盘后的形状),createEditLink 的
// 「已播种」门槛与 getChanges 的结构判定都依赖这个状态。
async function makeCollabReadyAlbum(ownerId: string) {
  const album = await makeAlbum(ownerId);
  await albumRepo.update(db, album.id, {
    status: 'EDITING',
    draftRevision: 1,
    draftStructureRevision: 1,
    draftJson: {
      chapters: [
        {
          chapterId: 'c1',
          title: '',
          description: 'first',
          accentColor: null,
          artFont: null,
          chapterContext: '',
          place: '',
          keywords: [],
          photos: [
            { photoId: 'photo-1', sceneDescription: 'sea', width: 800, height: 600, orientation: 'landscape' },
          ],
        },
      ],
    },
  });
  await db.transaction(async (tx) => {
    await draftPageRepo.replaceAll(tx, album.id, [seededPage], 1, ownerId);
    // 页面引用的 photo-1 登记 uploaded —— editor 只能依赖服务器原图(§13),
    // 「就绪」fixture 必须过照片门槛。
    await albumPhotoRepo.upsertMany(tx, album.id, [{ photoId: 'photo-1', status: 'uploaded' }]);
  });
  return album;
}

// ── albumCapabilities(能力模型/collab plan §5)────────────────────────────────
test('albumCapabilities: owner/editor 七项创作能力齐全,仅 owner 有治理能力', () => {
  const creator = ['editContent', 'editStructure', 'editSettings', 'uploadPhotos', 'runAI', 'export', 'createShare'] as const;
  const ownerOnly = ['manageMembers', 'deleteAlbum', 'transferOwnership'] as const;

  const owner = albumCapabilities('owner');
  const editor = albumCapabilities('editor');

  for (const cap of creator) {
    assert.equal(owner.has(cap), true, `owner 应有 ${cap}`);
    assert.equal(editor.has(cap), true, `editor 应有 ${cap}`);
  }
  for (const cap of ownerOnly) {
    assert.equal(owner.has(cap), true, `owner 应有 ${cap}`);
    assert.equal(editor.has(cap), false, `editor 不应有 ${cap}`);
  }
  assert.equal(owner.size, 10);
  assert.equal(editor.size, 7);
});

// ── requireAccess:owner/editor/非成员三态(collab plan §5.2)──
test('requireAccess: owner→owner, member→editor, stranger→ALBUM_ACCESS_DENIED, 缺册→NOT_FOUND', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-access-owner');
  const editor = await makeUser('collab-access-editor');
  const stranger = await makeUser('collab-access-stranger');
  try {
    const album = await makeAlbum(owner.id);

    const asOwner = await collaborationService.requireAccess(owner.id, album.id);
    assert.equal(asOwner.role, 'owner');
    assert.equal(asOwner.album.id, album.id);

    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);
    const asEditor = await collaborationService.requireAccess(editor.id, album.id);
    assert.equal(asEditor.role, 'editor');

    await assert.rejects(
      () => collaborationService.requireAccess(stranger.id, album.id),
      hasCode('ALBUM_ACCESS_DENIED'),
    );
    await assert.rejects(
      () => collaborationService.requireAccess(stranger.id, 'no-such-album'),
      hasCode('ALBUM_NOT_FOUND'),
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
    await cleanupUser(stranger.id);
  }
});

// ── requireOwner:保留现有所有者语义(editor 与路人都是 ALBUM_NOT_OWNED)──
test('requireOwner: owner 通过,其余一律 ALBUM_NOT_OWNED', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-reqowner-owner');
  const editor = await makeUser('collab-reqowner-editor');
  try {
    const album = await makeAlbum(owner.id);
    const found = await collaborationService.requireOwner(owner.id, album.id);
    assert.equal(found.id, album.id);

    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);
    await assert.rejects(
      () => collaborationService.requireOwner(editor.id, album.id),
      hasCode('ALBUM_NOT_OWNED'),
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
  }
});

// ── createEditLink / redeemEditLink ──
test('createEditLink: owner 生成/旋转,editor 被 OWNER_REQUIRED 拒绝,legacy 相册 COLLAB_UNSUPPORTED_ALBUM', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-link-owner');
  const editor = await makeUser('collab-link-editor');
  try {
    const album = await makeCollabReadyAlbum(owner.id);

    // --- owner 生成:返回明文 token,库里只有 hash ---
    const first = await collaborationService.createEditLink(owner.id, album.id);
    assert.ok(first.token.length >= 40, 'token 应为 ≥32 字节 CSPRNG 的 base64url 编码');
    const linkRow = await albumEditLinkRepo.findByTokenHash(
      (await import('node:crypto')).createHash('sha256').update(first.token).digest('hex'),
    );
    assert.ok(linkRow, '按明文 token 的 hash 必须能查到链接行');
    assert.notEqual(linkRow!.tokenHash, first.token, '明文 token 绝不落库');

    // --- editor(已是成员)创建 → OWNER_REQUIRED;路人 → ALBUM_ACCESS_DENIED ---
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);
    await assert.rejects(
      () => collaborationService.createEditLink(editor.id, album.id),
      hasCode('OWNER_REQUIRED'),
    );

    // --- legacy:已定稿(layoutJson 非空)→ COLLAB_UNSUPPORTED_ALBUM ---
    const legacy = await makeCollabReadyAlbum(owner.id);
    await albumRepo.update(db, legacy.id, { layoutJson: { any: 'finalized' } });
    await assert.rejects(
      () => collaborationService.createEditLink(owner.id, legacy.id),
      hasCode('COLLAB_UNSUPPORTED_ALBUM'),
    );

    // --- 未播种 draft_pages(V3 页面不存在)→ COLLAB_UNSUPPORTED_ALBUM ---
    const unseeded = await makeAlbum(owner.id);
    await assert.rejects(
      () => collaborationService.createEditLink(owner.id, unseeded.id),
      hasCode('COLLAB_UNSUPPORTED_ALBUM'),
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
  }
});

test('createEditLink 旋转后旧 token redeem 失败;redeem 幂等且 owner 不落 members', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-rotate-owner');
  const invitee = await makeUser('collab-rotate-invitee');
  try {
    const album = await makeCollabReadyAlbum(owner.id);

    const first = await collaborationService.createEditLink(owner.id, album.id);
    // --- 新用户 redeem → 成为 member;重复 redeem 幂等(仍一行) ---
    const redeemed = await collaborationService.redeemEditLink(invitee.id, first.token);
    assert.equal(redeemed.albumId, album.id);
    assert.equal(await albumMemberRepo.exists(album.id, invitee.id), true);
    await collaborationService.redeemEditLink(invitee.id, first.token);
    assert.equal((await albumMemberRepo.listByAlbum(album.id)).length, 1);

    // --- owner 自己 redeem:幂等成功,不写 members ---
    const ownerRedeem = await collaborationService.redeemEditLink(owner.id, first.token);
    assert.equal(ownerRedeem.albumId, album.id);
    assert.equal(await albumMemberRepo.exists(album.id, owner.id), false, 'owner 永不入 members');
    assert.equal((await albumMemberRepo.listByAlbum(album.id)).length, 1);

    // --- 旋转:旧 token 立即失效,新 token 可 redeem ---
    const second = await collaborationService.createEditLink(owner.id, album.id);
    assert.notEqual(second.token, first.token);
    await assert.rejects(
      () => collaborationService.redeemEditLink(invitee.id, first.token),
      hasCode('EDIT_LINK_NOT_FOUND'),
    );
    const again = await collaborationService.redeemEditLink(invitee.id, second.token);
    assert.equal(again.albumId, album.id);

    // --- 乱写的 token → EDIT_LINK_NOT_FOUND ---
    await assert.rejects(
      () => collaborationService.redeemEditLink(invitee.id, 'garbage-token'),
      hasCode('EDIT_LINK_NOT_FOUND'),
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(invitee.id);
  }
});

// ── getChanges 增量同步(collab plan §7.4/Task 4)──
test('getChanges: 空增量/单页增量/结构变化 reloadRequired/since 超前/非法拒绝', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-changes-owner');
  const stranger = await makeUser('collab-changes-stranger');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    // 播种(structureRev=1)+ 一次 owner 保存 → revision 2、页 version 2。
    const seeded = await albumService.updatePage(owner.id, album.id, 0, { textsJson: { title: 'v2' } });
    assert.ok('version' in seeded);
    const v2 = seeded.version;

    // 空增量:since === 当前 revision → 只有 revision,无 pages。
    const empty = await collaborationService.getChanges(owner.id, album.id, v2);
    assert.equal(empty.revision, v2);
    assert.deepEqual(empty.pages, []);
    assert.equal(empty.reloadRequired, false);
    assert.equal(empty.structureChanged, false);

    // 单页普通修改:增量返回该页(version/updatedBy/updatedAt/page 全带)。
    const saved = await albumService.updatePage(
      owner.id, album.id, 0, { textsJson: { title: 'v3' } }, v2,
    );
    assert.ok('version' in saved);
    const delta = await collaborationService.getChanges(owner.id, album.id, v2);
    assert.equal(delta.revision, saved.version);
    assert.equal(delta.reloadRequired, false);
    assert.equal(delta.pages.length, 1);
    assert.equal(delta.pages[0]!.pageIndex, 0);
    assert.equal(delta.pages[0]!.version, saved.version);
    assert.equal(delta.pages[0]!.updatedBy, owner.id);
    assert.equal(typeof delta.pages[0]!.updatedAt, 'string');
    assert.deepEqual((delta.pages[0]!.page as { texts: unknown }).texts, { title: 'v3' });

    // 追平后再次空增量。
    const caughtUp = await collaborationService.getChanges(owner.id, album.id, saved.version);
    assert.deepEqual(caughtUp.pages, []);

    // 结构变化:since 落在播种(replaceAll)之前 → 整书重载,不做增量。
    const stale = await collaborationService.getChanges(owner.id, album.id, 0);
    assert.equal(stale.structureChanged, true);
    assert.equal(stale.reloadRequired, true);
    assert.deepEqual(stale.pages, []);

    // since 超前 → REVISION_AHEAD(details 带 since 与当前 revision)。
    await assert.rejects(
      () => collaborationService.getChanges(owner.id, album.id, saved.version + 100),
      (err: { code?: string; details?: { since: number; currentRevision: number } }) =>
        err.code === 'REVISION_AHEAD' && err.details!.currentRevision === saved.version,
    );

    // 非法参数:负数/小数/非整数。
    await assert.rejects(
      () => collaborationService.getChanges(owner.id, album.id, -1),
      hasCode('VALIDATION_FAILED'),
    );
    await assert.rejects(
      () => collaborationService.getChanges(owner.id, album.id, 1.5),
      hasCode('VALIDATION_FAILED'),
    );
    // 超过 Number.MAX_SAFE_INTEGER:虽仍是"整数"浮点表示,但已不可安全表示,
    // 应在 isSafeInteger 处被 VALIDATION_FAILED 拒绝(而非落到 REVISION_AHEAD)。
    await assert.rejects(
      () => collaborationService.getChanges(owner.id, album.id, Number.MAX_SAFE_INTEGER + 1),
      hasCode('VALIDATION_FAILED'),
    );

    // 非成员不可轮询。
    await assert.rejects(
      () => collaborationService.getChanges(stranger.id, album.id, 0),
      hasCode('ALBUM_ACCESS_DENIED'),
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(stranger.id);
  }
});
//    写路径(confirm)仍拒 editor。非白名单路径的权限回归在 Task 7/8 的路由测试覆盖。
// ── 白名单读路径:editor 可读 v1 detail / v3 draft skeleton / 章节摘要 / 原图 URL;
//    写路径(confirm)仍拒 editor。非白名单路径的权限回归在 Task 7/8 的路由测试覆盖。
test('白名单读路径对 editor 开放,写路径仍然拒绝', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-whitelist-owner');
  const editor = await makeUser('collab-whitelist-editor');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);

    // v1 detail:editor 能读(此前 findOwned 会 403)
    const detail = await albumService.getDetail(editor.id, album.id);
    assert.equal(detail.album.id, album.id);

    // v3 draft skeleton:不抛权限错(seed 过的 draft 能出投影)
    const skeleton = await albumService.getDraftSkeleton(editor.id, album.id);
    assert.ok(skeleton, '已播种 draft_pages 的相册应返回 skeleton');
    assert.equal(skeleton!.pages.length, 1);

    // 章节摘要:不抛权限错
    const summary = await albumService.getChapterSummary(editor.id, album.id);
    assert.ok(summary);

    // 原图签名 URL(只读):editor 可调。这里验证的是权限层放行 —— 用未登记的
    // photoId 走通 requireAccess 而不触发 R2 签名(测试环境无 R2 凭据);权限拒绝
    // 会抛 ALBUM_ACCESS_DENIED,而非返回空 map。
    const urls = await photoOriginalService.getUrls(editor.id, album.id, ['never-registered']);
    assert.deepEqual(urls, {}, 'editor 通过权限层,未登记照片返回空 map');

    // 原图 confirm(Phase 3.3 起 Creator 可写):editor 穿过权限层,空 payload
    // 落到校验层(VALIDATION_FAILED 而非权限错);stranger 仍在权限层被拦。
    await assert.rejects(
      () => photoOriginalService.confirm(editor.id, album.id, { entries: [], missing: [] }),
      hasCode('VALIDATION_FAILED'),
    );

    // 路人仍然全部被拒
    const stranger = await makeUser('collab-whitelist-stranger');
    try {
      await assert.rejects(
        () => albumService.getDetail(stranger.id, album.id),
        hasCode('ALBUM_ACCESS_DENIED'),
      );
      await assert.rejects(
        () => photoOriginalService.getUrls(stranger.id, album.id, ['photo-1']),
        hasCode('ALBUM_ACCESS_DENIED'),
      );
      await assert.rejects(
        () => photoOriginalService.confirm(stranger.id, album.id, { entries: [], missing: [] }),
        hasCode('ALBUM_ACCESS_DENIED'),
      );
    } finally {
      await cleanupUser(stranger.id);
    }
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
  }
});

// ── 邀请门槛(collab plan §13)────────────────────────────────────────────────
test('invitationReadiness: 形态/在途job/照片 四类拒绝与就绪', () => {
  const base = {
    album: { layoutJson: null },
    draftPageCount: 2,
    latestJob: null,
    referencedPhotoIds: ['p1', 'p2'],
    uploadedPhotoIds: ['p1', 'p2'],
  };
  assert.deepEqual(invitationReadiness(base), { ready: true });

  // 已定稿 / 未播种 → unsupported-album
  assert.deepEqual(
    invitationReadiness({ ...base, album: { layoutJson: { x: 1 } } }),
    { ready: false, reason: 'unsupported-album' },
  );
  assert.deepEqual(
    invitationReadiness({ ...base, draftPageCount: 0 }),
    { ready: false, reason: 'unsupported-album' },
  );

  // 在途 layout/add → layout;在途 compose → compose;终态 job 不拦
  assert.deepEqual(
    invitationReadiness({ ...base, latestJob: { status: 'QUEUED', kind: 'layout' } }),
    { ready: false, reason: 'layout' },
  );
  assert.deepEqual(
    invitationReadiness({ ...base, latestJob: { status: 'RUNNING', kind: 'add' } }),
    { ready: false, reason: 'layout' },
  );
  assert.deepEqual(
    invitationReadiness({ ...base, latestJob: { status: 'RUNNING', kind: 'compose' } }),
    { ready: false, reason: 'compose' },
  );
  assert.deepEqual(
    invitationReadiness({ ...base, latestJob: { status: 'COMPLETED', kind: 'compose' } }),
    { ready: true },
  );

  // 引用照片缺 uploaded → photos(快照不兜底:无服务端 renderVersion 概念)
  assert.deepEqual(
    invitationReadiness({ ...base, uploadedPhotoIds: ['p1'] }),
    { ready: false, reason: 'photos' },
  );
});

test('createEditLink: 引用照片未全部 uploaded → PHOTO_BACKUP_REQUIRED;补齐后通过', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-photogate-owner');
  try {
    const album = await makeCollabReadyAlbum(owner.id); // fixture 已登记 photo-1
    // 撤掉台账模拟「照片还没备份到服务器」。
    await db.transaction(async (tx) => {
      await albumPhotoRepo.deleteByAlbum(tx, album.id);
    });

    await assert.rejects(
      () => collaborationService.createEditLink(owner.id, album.id),
      hasCode('PHOTO_BACKUP_REQUIRED'),
    );

    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [{ photoId: 'photo-1', status: 'uploaded' }]);
    });
    const link = await collaborationService.createEditLink(owner.id, album.id);
    assert.ok(link.token.length >= 40);
  } finally {
    await cleanupUser(owner.id);
  }
});

test('createEditLink: 在途 layout/compose job → 拒绝直到终态', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-jobgate-owner');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [{ photoId: 'photo-1', status: 'uploaded' }]);
    });

    const job = await agentJobRepo.create(db, {
      userId: owner.id,
      albumId: album.id,
      requestId: `collab-jobgate-${Date.now()}`,
      kind: 'layout',
      status: 'QUEUED',
      progress: 0,
    });
    try {
      await assert.rejects(
        () => collaborationService.createEditLink(owner.id, album.id),
        hasCode('CHAT_BUSY'),
        '在途 layout job 时创建邀请应被拒(§7.1)',
      );
      await agentJobRepo.update(db, job.id, { status: 'COMPLETED' });
      const link = await collaborationService.createEditLink(owner.id, album.id);
      assert.ok(link.token.length >= 40, 'job 终态后即可创建');
    } finally {
      await agentJobRepo.update(db, job.id, { status: 'FAILED' });
    }
  } finally {
    await cleanupUser(owner.id);
  }
});

test('redeemEditLink: 链接生成后启动的整书 job 会阻止成员加入', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-redeem-race-owner');
  const invitee = await makeUser('collab-redeem-race-invitee');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    const link = await collaborationService.createEditLink(owner.id, album.id);
    // 直接造出「链接生成后、兑换前已有任务」的历史窗口；生产派发入口现在
    // 还会额外通过 album 行锁 + member freeze 防止反方向穿透。
    const job = await agentJobRepo.create(db, {
      userId: owner.id,
      albumId: album.id,
      requestId: `collab-redeem-race-${Date.now()}`,
      kind: 'layout',
      status: 'QUEUED',
      progress: 0,
    });
    await assert.rejects(
      () => collaborationService.redeemEditLink(invitee.id, link.token),
      hasCode('CHAT_BUSY'),
    );
    assert.equal(await albumMemberRepo.exists(album.id, invitee.id), false);
    await agentJobRepo.update(db, job.id, { status: 'COMPLETED' });
    await collaborationService.redeemEditLink(invitee.id, link.token);
    assert.equal(await albumMemberRepo.exists(album.id, invitee.id), true);
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(invitee.id);
  }
});

// ── 成员管理(§15.3)────────────────────────────────────────────────────────
test('listMembers/removeMember: owner 列表+移除;editor 与路人被 OWNER_REQUIRED 拒', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-members-owner');
  const editor = await makeUser('collab-members-editor');
  const stranger = await makeUser('collab-members-stranger');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);

    const list = await collaborationService.listMembers(owner.id, album.id);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.userId, editor.id);
    assert.equal(list[0]!.email, editor.email ?? '');
    assert.equal(typeof list[0]!.createdAt, 'string');

    // editor 与路人都不能看/移除成员
    await assert.rejects(() => collaborationService.listMembers(editor.id, album.id), hasCode('ALBUM_NOT_OWNED'));
    await assert.rejects(() => collaborationService.removeMember(stranger.id, album.id, editor.id), hasCode('ALBUM_NOT_OWNED'));

    // owner 移除 editor → 后续访问 403(requireAccess 落空)
    const { removed } = await collaborationService.removeMember(owner.id, album.id, editor.id);
    assert.equal(removed, true);
    assert.equal((await collaborationService.listMembers(owner.id, album.id)).length, 0);
    await assert.rejects(
      () => collaborationService.requireAccess(editor.id, album.id),
      hasCode('ALBUM_ACCESS_DENIED'),
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
    await cleanupUser(stranger.id);
  }
});

// ── 权限回归(§18.4):owner-only 写操作(邀请/成员)对 editor/路人一律拒;
//    全局创作设置(Phase 2B)owner/editor 同为 Creator,非成员拒 ALBUM_ACCESS_DENIED ─
test('权限回归:editor 可改标题/背景/滤镜、路人被 ACCESS_DENIED;邀请/成员仍 owner-only', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('collab-perm-owner');
  const editor = await makeUser('collab-perm-editor');
  const stranger = await makeUser('collab-perm-stranger');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);

    // 全局创作设置(Phase 2B):owner 与 editor 同为 Creator,可改标题/背景/滤镜;
    // 每次成功推进 settingsRevision+1。
    const t1 = await albumService.updateTitle(editor.id, album.id, 'Editor Title', 0);
    assert.equal(t1.settingsRevision, 1);
    const t2 = await albumService.updateBoardBackground(editor.id, album.id, null, t1.settingsRevision);
    assert.equal(t2.settingsRevision, 2);
    const t3 = await albumService.updatePhotoFilter(editor.id, album.id, null, t2.settingsRevision);
    assert.equal(t3.settingsRevision, 3);

    // 非成员(路人):三个设置写点一律 ALBUM_ACCESS_DENIED。
    await assert.rejects(() => albumService.updateTitle(stranger.id, album.id, '劫持', 3), hasCode('ALBUM_ACCESS_DENIED'));
    await assert.rejects(() => albumService.updateBoardBackground(stranger.id, album.id, null, 3), hasCode('ALBUM_ACCESS_DENIED'));
    await assert.rejects(() => albumService.updatePhotoFilter(stranger.id, album.id, null, 3), hasCode('ALBUM_ACCESS_DENIED'));

    // DTO 暴露(Phase 2B):detail 与 draft skeleton 都回传 settingsRevision 基线。
    const detail = await albumService.getDetail(editor.id, album.id);
    assert.equal(detail.album.settingsRevision, 3);
    const skeleton = await albumService.getDraftSkeleton(editor.id, album.id);
    assert.equal(skeleton?.settingsRevision, 3);

    // 结构写入(Phase 2A 起 owner/editor 都可写):不再走 owner 判定 —— editor 可重排/
    // 删页(其结构 OCC 语义由 album-service.test.ts 的 Phase 2A 用例覆盖),只对非成员
    // (路人)拒绝 ALBUM_ACCESS_DENIED。这里锁死「非成员」这一级权限回归。
    await assert.rejects(() => albumService.reorderPages(stranger.id, album.id, [0], 1), hasCode('ALBUM_ACCESS_DENIED'));
    await assert.rejects(() => albumService.deletePage(stranger.id, album.id, 0, 1), hasCode('ALBUM_ACCESS_DENIED'));

    // 邀请链接:editor/路人都不能创建(OWNER_REQUIRED / ALBUM_NOT_OWNED)。
    await assert.rejects(() => collaborationService.createEditLink(editor.id, album.id), hasCode('OWNER_REQUIRED'));
    await assert.rejects(() => collaborationService.createEditLink(stranger.id, album.id), hasCode('ALBUM_ACCESS_DENIED'));

    // 成员管理:editor 不能列成员。
    await assert.rejects(() => collaborationService.listMembers(editor.id, album.id), hasCode('ALBUM_NOT_OWNED'));
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
    await cleanupUser(stranger.id);
  }
});

// ── 写点清单守卫(collab plan §7.4/完成定义):每个生产 replaceAll 都必须是
//    结构写入(推进 draftStructureRevision),普通 updatePage/repair 不得推进 ──
const SERVICES_DIR = join(import.meta.dirname, '..', '..');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

// 源码正则守卫的纪律:断言前剥注释,改完必跑 mutation 确认会红(见
// collab-read-seam.test.ts 顶部的同款说明)。
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('写点清单守卫:每个 draftPageRepo.replaceAll 生产写点都推进结构 revision', () => {
  const files = listSourceFiles(SERVICES_DIR);
  assert.ok(files.length > 10, '应扫到 services 目录下的源文件');

  let replaceAllSites = 0;
  for (const rawFile of files) {
    // 剥注释:原版按「调用点前 500 字符里出现 structural: true」判定,一句
    // `// MUTATION: 这里本来传 { structural: true }` 就能喂饱它 —— 2026-09-02
    // code review 实测:真删掉参数只要留下这行注释,守卫 pass 14 / fail 0。
    const text = stripComments(readFileSync(rawFile, 'utf8'));
    const file = rawFile;
    let cursor = 0;
    while (true) {
      const at = text.indexOf('draftPageRepo.replaceAll', cursor);
      if (at < 0) break;
      replaceAllSites += 1;
      // 匹配**变量绑定**而不是距离:取 replaceAll 的第 4 个实参(version),回头找
      // 调用点之前**最近的一次**该变量赋值,要求它是带 { structural: true } 的
      // bumpDraftRevision。
      //
      // 「最近的一次」是关键:早先写成「文件里任意一次绑定」时,job-service 的三个
      // 写点都叫 rev,改坏其中一个、另外两个的 structural: true 会替它掩护 ——
      // mutation 实测仍然假绿。同名变量互相掩护,和注释喂饱是同一类病。
      //
      // 唯一豁免是 draft-store 的懒播种(不走 bumpDraftRevision,直接
      // set draftRevision + draftStructureRevision)。
      const call = text.slice(at, text.indexOf(')', at) + 1);
      const args = call.slice(call.indexOf('(') + 1, -1).split(',').map((a) => a.trim());
      const versionArg = args[3] ?? '';
      const escaped = versionArg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const before = text.slice(0, at);
      const assignments = [...before.matchAll(
        new RegExp(`(const|let)\\s+${escaped}\\s*=\\s*await bumpDraftRevision\\([^;]*?\\);`, 'g'),
      )];
      const nearest = assignments.length > 0 ? assignments[assignments.length - 1]![0] : '';
      const boundStructural = /structural:\s*true/.test(nearest);
      const exempt =
        file.endsWith('draft-store.ts') &&
        text.slice(Math.max(0, at - 500), at).includes('readPreviewPages');
      assert.ok(
        boundStructural || exempt,
        `${file} 的 replaceAll 调用点(#${replaceAllSites})写入的 version(${versionArg})不是来自 structural 的 bumpDraftRevision —— 整批替换后增量同步必须整书重载(collab plan §7.4)`,
      );
      cursor = at + 1;
    }
  }
  // 清单基数:job-service ×3(select-layout/append compose/full compose)+
  // album-service ×4(design-chat/placeholder/reorder/deletePage)+ draft-store 播种。
  assert.ok(replaceAllSites >= 8, `replaceAll 写点应至少 8 处,实际 ${replaceAllSites}`);

  // repair-mag09 是单页维护写点:不得推进结构 revision(也不得整批替换)。
  const repair = files.find((f) => f.includes('repair-mag09-pages.ts'));
  assert.ok(repair, 'repair-mag09-pages.ts 应存在于 services 目录');
  const repairText = readFileSync(repair!, 'utf8');
  assert.equal(repairText.includes('replaceAll'), false, 'repair 只做单页维护,不得整批替换');
  assert.equal(repairText.includes('structural'), false, 'repair 不推进结构 revision');
});

// ── OCC 冲突路径(Phase 2A/2B + §7.5/§8)──────────────────────────────────────
// 这几条钉的是本包的核心承诺:**冲突时零写入**。三种 OCC 各有一条,每条都在
// 409 之后把 albums 行与 draft_pages 行读回来,逐字段与调用前比对 —— 只断言
// 「抛了 409」是不够的,那证明不了没有半路写进去的副作用(bump 过的 revision、
// 播种出来的行、被覆盖的页)。
//
// 另外钉发布阶段 A 的过渡口径:owner 省略基线走旧盲写,editor 省略一律拒绝。
// 前端(EditorPort / MobileEditorRoot)在包 6 之前不发这些字段,基线若设成必填,
// owner 自己改书名/背景/滤镜/挪页/删页会全部 400。

async function snapshotOf(albumId: string) {
  const album = (await albumRepo.findById(albumId))!;
  const rows = await draftPageRepo.findByAlbum(albumId);
  return {
    draftRevision: album.draftRevision,
    draftStructureRevision: album.draftStructureRevision,
    settingsRevision: album.settingsRevision,
    title: album.title,
    pages: rows.map((r) => ({ pageIndex: r.pageIndex, version: r.version, page: r.page })),
  };
}

test('updatePage 陈旧 baseVersion → 409 EDIT_CONFLICT,且 revision/页面逐字段不变', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('occ-page-owner');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    const before = await snapshotOf(album.id);
    const liveVersion = before.pages[0]!.version;

    const conflict = await albumService
      .updatePage(owner.id, album.id, 0, { textsJson: { title: '并发写' } }, liveVersion - 1)
      .then(() => null, (e: { code?: string; details?: unknown }) => e);

    assert.equal(conflict?.code, 'EDIT_CONFLICT');
    const details = conflict!.details as { pageIndex: number; currentVersion: number; currentPage: unknown };
    assert.equal(details.pageIndex, 0);
    assert.equal(details.currentVersion, liveVersion, 'details 必须带当前版本供客户端「查看最新」');
    assert.ok(details.currentPage, 'details 必须带当前页全文(只经响应通道,不落日志)');

    assert.deepEqual(await snapshotOf(album.id), before, '冲突必须零写入:revision 与页面逐字段不变');
  } finally {
    await cleanupUser(owner.id);
  }
});

test('updateOneIfVersion 第二防线:绕过锁内预比较直接写,版本不符返回 false 且零行受影响', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('occ-repo-guard');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    const before = await snapshotOf(album.id);
    const row = before.pages[0]!;

    const won = await draftPageRepo.updateOneIfVersion(
      db, album.id, 0, row.version - 1,
      { ...(row.page as Record<string, unknown>), texts: { title: '绕过锁' } } as never,
      row.version + 1, owner.id,
    );
    assert.equal(won, false, '版本不符必须命中 0 行 —— 这是绕过行锁时的最后防线');
    assert.deepEqual(await snapshotOf(album.id), before, '未命中不得留下任何写入');

    // 对照组:版本相符时确实写得进去,证明上面的 false 不是恒假。
    assert.equal(
      await draftPageRepo.updateOneIfVersion(
        db, album.id, 0, row.version, row.page as never, row.version + 1, owner.id,
      ),
      true,
    );
  } finally {
    await cleanupUser(owner.id);
  }
});

test('reorderPages / deletePage 陈旧 baseStructureRevision → 409 STRUCTURE_CONFLICT,零写入且不播种', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('occ-struct-owner');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    const before = await snapshotOf(album.id);
    const stale = before.draftStructureRevision - 1;

    for (const [label, run] of [
      ['reorderPages', () => albumService.reorderPages(owner.id, album.id, [0], stale)],
      ['deletePage', () => albumService.deletePage(owner.id, album.id, 0, stale)],
    ] as const) {
      const e = await run().then(() => null, (err: { code?: string; details?: unknown }) => err);
      assert.equal(e?.code, 'STRUCTURE_CONFLICT', `${label} 陈旧基线必须 409`);
      assert.deepEqual(
        e!.details,
        { currentStructureRevision: before.draftStructureRevision },
        `${label} 的 details 只带当前结构版本,不带任何页面正文`,
      );
      assert.deepEqual(await snapshotOf(album.id), before, `${label} 冲突必须零写入`);
    }
  } finally {
    await cleanupUser(owner.id);
  }
});

test('设置三写陈旧 baseSettingsRevision → 409 SETTINGS_CONFLICT,零写入零推进', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('occ-settings-owner');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    // 先成功写一次,把 settingsRevision 推到 1 —— 这样 0 就是货真价实的陈旧基线。
    await albumService.updateTitle(owner.id, album.id, '第一次', 0);
    const before = await snapshotOf(album.id);
    assert.equal(before.settingsRevision, 1, '成功的设置写必须恰好推进一次');

    for (const [label, run] of [
      ['updateTitle', () => albumService.updateTitle(owner.id, album.id, '抢写', 0)],
      ['updateBoardBackground', () => albumService.updateBoardBackground(owner.id, album.id, null, 0)],
      ['updatePhotoFilter', () => albumService.updatePhotoFilter(owner.id, album.id, null, 0)],
    ] as const) {
      const e = await run().then(() => null, (err: { code?: string; details?: unknown }) => err);
      assert.equal(e?.code, 'SETTINGS_CONFLICT', `${label} 陈旧基线必须 409`);
      assert.deepEqual(e!.details, { currentSettingsRevision: 1 });
      assert.deepEqual(await snapshotOf(album.id), before, `${label} 冲突必须零写入`);
    }
  } finally {
    await cleanupUser(owner.id);
  }
});

test('发布阶段 A 过渡口径:owner 省略基线走旧盲写,editor 省略一律拒绝', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('occ-phase-a-owner');
  const editor = await makeUser('occ-phase-a-editor');
  try {
    const album = await makeCollabReadyAlbum(owner.id);
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);

    // owner 不带基线:五条写路径都照常放行(前端在包 6 前不发这些字段)。
    await albumService.updateTitle(owner.id, album.id, '旧客户端改名');
    assert.equal((await albumRepo.findById(album.id))!.title, '旧客户端改名');
    await albumService.updatePage(owner.id, album.id, 0, { textsJson: { title: '旧客户端存页' } });

    // editor 不带基线:一律拒绝 —— 协同并发的安全性由这条守,不靠 schema 必填。
    for (const [label, run] of [
      ['updatePage', () => albumService.updatePage(editor.id, album.id, 0, { textsJson: { title: 'x' } })],
      ['updateTitle', () => albumService.updateTitle(editor.id, album.id, 'x')],
      ['reorderPages', () => albumService.reorderPages(editor.id, album.id, [0])],
      ['deletePage', () => albumService.deletePage(editor.id, album.id, 0)],
    ] as const) {
      await assert.rejects(run, hasCode('VALIDATION_FAILED'), `${label}: editor 省略基线必须被拒`);
    }
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
  }
});

test('legacy 相册带 baseVersion → COLLAB_UNSUPPORTED_ALBUM(无页面 version 可比)', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('occ-legacy-owner');
  try {
    // 没有 draft_pages 行、也没有 legacy draftJson.pages 的相册 —— updatePage 会
    // 落到 album_pages 分支,那里没有 version 概念,协同写必须拒绝而不是盲写。
    const album = await makeAlbum(owner.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story' });
    await assert.rejects(
      () => albumService.updatePage(owner.id, album.id, 0, { textsJson: { title: 'x' } }, 0),
      hasCode('COLLAB_UNSUPPORTED_ALBUM'),
    );
  } finally {
    await cleanupUser(owner.id);
  }
});

// getDraftSkeleton 的页内容与页 version 必须来自**同一次** draft_pages 读。
// 分两次读的话,两次之间落一次写就会产生「旧内容 + 新 version」的组合:客户端
// 带着这个 version 保存,锁内预比较和 updateOneIfVersion 都会放行 —— 它覆盖掉的
// 是一份自己从未见过的修改。OCC 的全部意义就是防这个,读路径不能自己捅穿。
//
// 这里用真库直接构造错位:在 loadStoryDraft 读完之后、若还有第二次读之前写一笔。
// 由于实现已改成一次读派生 pages+meta,skeleton 拿到的内容与版本必然自洽。
test('getDraftSkeleton 的页内容与 version 同源:并发写不会造出「旧内容+新 version」', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('skeleton-meta-coherent');
  try {
    const album = await makeCollabReadyAlbum(owner.id);

    const before = await albumService.getDraftSkeleton(owner.id, album.id);
    const beforePage = before!.pages.find((p) => p.pageIndex === 0)!;

    // 落一次真实的单页写:内容与 version 一起前进。
    await albumService.updatePage(
      owner.id, album.id, 0, { textsJson: { title: '被别人改过' } }, beforePage.version!,
    );

    const after = await albumService.getDraftSkeleton(owner.id, album.id);
    const afterPage = after!.pages.find((p) => p.pageIndex === 0)!;

    assert.notEqual(afterPage.version, beforePage.version, '写过之后 version 必须前进');
    // 关键断言:拿 skeleton 给出的 version 去保存,必须被服务端接受 —— 它证明
    // 这个 version 描述的就是 skeleton 同时给出的那份内容。若两者错位,这里会
    // 因为 version 已过期而抛 EDIT_CONFLICT。
    await albumService.updatePage(
      owner.id, album.id, 0, { textsJson: { title: '基于最新版本再改' } }, afterPage.version!,
    );

    // 反向对照:拿上一版 version 再存必须冲突,证明上面的成功不是因为校验失效。
    await assert.rejects(
      () => albumService.updatePage(
        owner.id, album.id, 0, { textsJson: { title: 'x' } }, beforePage.version!,
      ),
      hasCode('EDIT_CONFLICT'),
    );
  } finally {
    await cleanupUser(owner.id);
  }
});

// ── AI 长任务基线纯函数(Phase 4 / 包 5 的地基)───────────────────────────────
// captureJobBaseline / findBaselineStaleReason 随协同服务一起搬了进来,但接线
// (job 启动记基线、回调重验)在包 5。纯函数先把四条分支钉住,免得等到包 5 时
// 它已经变成「看起来有人写过所以不敢动」的代码。
test('findBaselineStaleReason: 无基线放行,structure/settings/pages 三维各自失配', () => {
  const base = captureJobBaseline({
    album: { draftStructureRevision: 3, settingsRevision: 2 },
    pages: [{ pageIndex: 0, version: 7 }, { pageIndex: 1, version: 9 }],
  });
  const fresh = {
    album: { draftStructureRevision: 3, settingsRevision: 2 },
    pages: [{ pageIndex: 0, version: 7 }, { pageIndex: 1, version: 9 }],
  };

  // 基线机制上线前创建的旧 job 无基线可验:放行,与历史行为一致。
  assert.equal(findBaselineStaleReason(fresh, null), null);
  assert.equal(findBaselineStaleReason(fresh, undefined), null);
  // 一切未变:回写放行。
  assert.equal(findBaselineStaleReason(fresh, base), null);

  // 三个维度逐个失配,原因要分得清 —— stale 详情进 job error 帮助定位是哪路并发。
  assert.equal(
    findBaselineStaleReason({ ...fresh, album: { draftStructureRevision: 4, settingsRevision: 2 } }, base),
    'structure',
  );
  assert.equal(
    findBaselineStaleReason({ ...fresh, album: { draftStructureRevision: 3, settingsRevision: 5 } }, base),
    'settings',
  );
  assert.equal(
    findBaselineStaleReason({ ...fresh, pages: [{ pageIndex: 0, version: 8 }, { pageIndex: 1, version: 9 }] }, base),
    'pages',
    '人工在 AI 运行期间改过页 → 结果作废,人工编辑优先',
  );
  // 基线里的页整个消失(结构变化删页)同样算失配,不能当没看见。
  assert.equal(
    findBaselineStaleReason({ ...fresh, pages: [{ pageIndex: 0, version: 7 }] }, base),
    'pages',
  );
});

test('captureJobBaseline: 空页快照(compose 启动时尚未播种)只比 revision 两项', () => {
  const base = captureJobBaseline({
    album: { draftStructureRevision: 0, settingsRevision: 0 },
    pages: [],
  });
  assert.deepEqual(base, { structureRevision: 0, settingsRevision: 0, pages: [] });
  // 启动时没有页 → 回写时新播种出来的页不算失配(页级不比)。
  assert.equal(
    findBaselineStaleReason(
      { album: { draftStructureRevision: 0, settingsRevision: 0 }, pages: [{ pageIndex: 0, version: 1 }] },
      base,
    ),
    null,
  );
});
