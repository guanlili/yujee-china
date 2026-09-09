import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from '@yujee/contracts';
import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMemberRepo } from '@/db/repos/album-member-repo';
import { albumShareRepo } from '@/db/repos/album-share-repo';
import { designAgentClient } from '@/lib/agent/design-agent-client';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { albumService } from './album-service';
import { photoMaskService } from './photo-mask-service';

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

const hasCode = (code: string) => (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;

async function seedBook(suffix: string) {
  const user = await makeUser(suffix);
  const album = await makeAlbum(user.id);
  await db.transaction(async (tx) => {
    await draftPageRepo.replaceAll(tx, album.id, [seededPage], 1, user.id);
  });
  // ⚠️ 必须写一份能过 loadStoryDraft 的 V3 信封:少了它 prepareDesignChat 会在
  // 「album has no V3 story draft」当场抛,下面那条基线用例就变成一条永不执行的
  // 断言(2026-09-09 评审揪出的假绿正是这个形状)。
  await albumRepo.update(db, album.id, {
    status: 'EDITING',
    stage: 'story',
    draftRevision: 1,
    draftStructureRevision: 1,
    draftJson: {
      version: 'v3-story',
      tree: {
        chapters: [
          {
            chapterId: 'c1',
            title: '第一章',
            description: '',
            accentColor: null,
            artFont: null,
            chapterContext: '',
            place: '',
            keywords: [],
            photos: [],
          },
        ],
      },
      pages: [],
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    },
  });
  return { userId: user.id, albumId: album.id };
}

/** 拦下装书那一趟网络。design-agent 起不起得来与「基线从哪来」无关。 */
function captureLoadBook() {
  const original = designAgentClient.loadBook;
  designAgentClient.loadBook = async () => {};
  return () => {
    designAgentClient.loadBook = original;
  };
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
    // ⚠️ 必须钉错误码:不带码的 assert.rejects 换成任何别的错误也绿。
    await assert.rejects(
      () => albumService.persistDesignChat(editor.id, albumId, persistInput),
      hasCode('VALIDATION_FAILED'),
    );

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

    await assert.rejects(
      () => albumService.persistDesignChat(userId, albumId, { ...persistInput, baseSettingsRevision: stale }),
      hasCode('SETTINGS_CONFLICT'),
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
  const restore = captureLoadBook();
  try {
    await albumRepo.update(db, albumId, { settingsRevision: 7 });
    // 基线必须等于**装书那一刻**的 settingsRevision(70d38c4e 修的就是这个)。
    // 断言无条件执行 —— 早先这里是 `if (baseline !== undefined)` 加一个必抛的
    // fixture,于是这条不变量零运行时断言。
    const { baseSettingsRevision } = await albumService.prepareDesignChat(userId, albumId);
    assert.equal(baseSettingsRevision, 7);
  } finally {
    restore();
    await cleanupUser(userId);
  }
});

test('已发布分享的书:落库把 warning 吐出来 —— 路由才有东西转述给用户', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-warn');
  try {
    // 已备份 + 已发布分享:改滤镜会让全书 renderVersion 失配,用户必须重备全书。
    await albumRepo.update(db, albumId, {
      photoSnapshot: {
        photoIds: ['p1'],
        renderVersions: { p1: 'pf-v1__original' },
        updatedAt: new Date().toISOString(),
      },
    });
    await db.transaction(async (tx) =>
      albumShareRepo.create(tx, {
        token: `dcf-warn-${Date.now()}`,
        albumId,
        title: 'shared',
        snapshotJson: { pages: [], photoUrls: {}, boardBackground: null, locale: 'zh' },
      }),
    );
    const before = (await albumRepo.findById(albumId))!.settingsRevision;

    const applied = await albumService.persistDesignChat(userId, albumId, {
      ...persistInput,
      baseSettingsRevision: before,
    });

    assert.ok(applied, '写了滤镜就该有返回');
    assert.ok(
      applied.warnings.some((w) => w.includes('分享')),
      `warning 必须一路传到 persistDesignChat 的返回值:${JSON.stringify(applied.warnings)}`,
    );
  } finally {
    await cleanupUser(userId);
  }
});

test('没有分享的书:warnings 是空数组,不给用户刷假警报', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-nowarn');
  try {
    const before = (await albumRepo.findById(albumId))!.settingsRevision;
    const applied = await albumService.persistDesignChat(userId, albumId, {
      ...persistInput,
      baseSettingsRevision: before,
    });
    assert.deepEqual(applied?.warnings, []);
  } finally {
    await cleanupUser(userId);
  }
});

// ── 开抠图要顺手把服务端 mask 备好 ────────────────────────────────────────
// 不备的话渲染只能退回浏览器端的漫水填充 —— 那正是 2026-08-29 验证「5 张 0 张能用」
// 而被否决的那套。Agent 现在能自动开抠图,用户会拿到一个被啃残的自己。
function captureMasks(impl?: (albumId: string, photoIds: string[]) => Promise<void>) {
  const original = photoMaskService.ensureCutoutMasks;
  const calls: { albumId: string; photoIds: string[] }[] = [];
  photoMaskService.ensureCutoutMasks = async (albumId, photoIds) => {
    calls.push({ albumId, photoIds: [...photoIds] });
    if (impl) await impl(albumId, photoIds);
    return { created: [...photoIds], deferred: 0 };
  };
  return {
    calls,
    restore() {
      photoMaskService.ensureCutoutMasks = original;
    },
  };
}

test('开抠图 → 触发服务端 mask 生成', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-mask-on');
  const capture = captureMasks();
  try {
    const before = (await albumRepo.findById(albumId))!.settingsRevision;
    await albumService.persistDesignChat(userId, albumId, {
      userMessage: '把这两张的主体抠出来',
      assistantReply: '抠好了',
      committed: false,
      pages: [],
      photoFilterPatch: { cutouts: { p1: true, p2: true } },
      baseSettingsRevision: before,
    });
    assert.equal(capture.calls.length, 1);
    assert.equal(capture.calls[0]!.albumId, albumId);
    assert.deepEqual([...capture.calls[0]!.photoIds].sort(), ['p1', 'p2']);
  } finally {
    capture.restore();
    await cleanupUser(userId);
  }
});

test('只调色不抠图的一轮不去烧 mask 推理', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-mask-off');
  const capture = captureMasks();
  try {
    const before = (await albumRepo.findById(albumId))!.settingsRevision;
    await albumService.persistDesignChat(userId, albumId, {
      ...persistInput,
      baseSettingsRevision: before,
    });
    assert.equal(capture.calls.length, 0);
  } finally {
    capture.restore();
    await cleanupUser(userId);
  }
});

test('关抠图不触发 —— 删键那条路没有 mask 要备', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-mask-remove');
  const capture = captureMasks();
  try {
    const before = (await albumRepo.findById(albumId))!.settingsRevision;
    await albumService.persistDesignChat(userId, albumId, {
      userMessage: '把抠图关掉',
      assistantReply: '关了',
      committed: false,
      pages: [],
      photoFilterPatch: { cutouts: { p1: null } },
      baseSettingsRevision: before,
    });
    assert.equal(capture.calls.length, 0);
  } finally {
    capture.restore();
    await cleanupUser(userId);
  }
});

test('mask 生成炸了也不能把这一轮对话拖垮(滤镜已经落库了)', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBook('dcf-mask-throw');
  const capture = captureMasks(async () => { throw new Error('clip worker down'); });
  try {
    const before = (await albumRepo.findById(albumId))!.settingsRevision;
    const applied = await albumService.persistDesignChat(userId, albumId, {
      userMessage: '抠一下',
      assistantReply: '好',
      committed: false,
      pages: [],
      photoFilterPatch: { cutouts: { p1: true } },
      baseSettingsRevision: before,
    });
    assert.equal(applied?.photoFilter?.cutouts?.p1, true, '抠图开关照样落库');
  } finally {
    capture.restore();
    await cleanupUser(userId);
  }
});
