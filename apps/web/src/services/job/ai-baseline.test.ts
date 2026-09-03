import { test } from 'node:test';
import assert from 'node:assert/strict';

// AI 长任务基线(collab rework §Phase 4)的双时序守卫:
//   时序一(AI 先启动、人工后改):完成回写前锁内重验 → AI_RESULT_STALE 零写入,
//     人工编辑优先 —— 这是不允许「AI 用旧快照覆盖协作者」的核心保证。
//   时序二(人工先改、AI 后启动):新 job 捕获新基线 → 正常落库(用户发起的重跑)。
// compose 与 layout 共用同一个闸;compose 的增量断言是「stage 不被推到 ready」。

const { db } = await import('../../db/client');
const { albumRepo } = await import('../../db/repos/album-repo');
const { agentJobRepo } = await import('../../db/repos/agent-job-repo');
const { draftPageRepo } = await import('../../db/repos/draft-page-repo');
const { albumService } = await import('../album/album-service');
const { jobService, buildAnalyzeDraftJson } = await import('./job-service');
const { captureJobBaseline, findBaselineStaleReason } = await import(
  '../collaboration/collaboration-service'
);
const { cleanupUser, isDbReachable, makeAlbum, makeUser } = await import(
  '../../db/repos/__test__/setup'
);

const TREE = {
  chapters: [
    {
      chapterId: 'ch_1',
      title: '',
      description: 'A quiet morning.',
      chapterContext: '',
      place: '',
      keywords: [],
      extractedColor: '#112233',
      accentColor: null,
      artFont: null,
      photos: [],
    },
  ],
};

const PAGES = [{ pageIndex: 0, templateId: 'mag-02', images: { image: 'p1' }, texts: {} }];

async function seedOnePagedAlbum(ownerLabel: string) {
  const user = await makeUser(ownerLabel);
  const album = await makeAlbum(user.id);
  await albumRepo.update(db, album.id, {
    status: 'EDITING',
    stage: 'story',
    draftJson: buildAnalyzeDraftJson(TREE),
  });
  // 第一次排版回调把 PAGES 落进 draft_pages(此后页带 version,可被人工编辑)。
  const seedRequestId = `seed-${ownerLabel}-${Date.now()}`;
  await agentJobRepo.create(db, {
    userId: user.id,
    albumId: album.id,
    requestId: seedRequestId,
    kind: 'layout',
    status: 'RUNNING',
    progress: 0,
  });
  await jobService.handleV3SelectLayoutCompleted(seedRequestId, PAGES, { durationMs: 1, models: {} });
  return { user, album };
}

async function createBaselineJob(kind: 'layout' | 'compose', userId: string, albumId: string) {
  return db.transaction(async (tx) =>
    jobService.createGenerationJob(tx, {
      userId,
      albumId,
      requestId: `${kind}-baseline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
    }),
  );
}

test('findBaselineStaleReason:分维判定 + 无基线放行(旧 job 兼容)', () => {
  const album = { draftStructureRevision: 7, settingsRevision: 3 };
  const pages = [
    { pageIndex: 0, version: 7 },
    { pageIndex: 1, version: 7 },
  ];
  const baseline = captureJobBaseline({ album, pages });

  assert.equal(findBaselineStaleReason({ album, pages }, baseline), null, '新鲜基线放行');
  assert.equal(findBaselineStaleReason({ album, pages }, null), null, '无基线(旧 job)放行');

  assert.equal(
    findBaselineStaleReason(
      { album: { draftStructureRevision: 8, settingsRevision: 3 }, pages },
      baseline,
    ),
    'structure',
    '结构 revision 失配',
  );
  assert.equal(
    findBaselineStaleReason(
      { album: { draftStructureRevision: 7, settingsRevision: 4 }, pages },
      baseline,
    ),
    'settings',
    '设置 revision 失配',
  );
  assert.equal(
    findBaselineStaleReason(
      { album, pages: [pages[0]!, { pageIndex: 1, version: 9 }] },
      baseline,
    ),
    'pages',
    '页版本推进',
  );
  assert.equal(
    findBaselineStaleReason({ album, pages: [pages[0]!] }, baseline),
    'pages',
    '基线页消失(删页)',
  );
});

test('时序一(AI 先启动、人工后改):layout 回写撞基线 → AI_RESULT_STALE 零写入', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { user, album } = await seedOnePagedAlbum('ai-baseline-stale');
  try {
    // 建第二排版 job:基线快照此刻的页版本(v1)。
    const job = await createBaselineJob('layout', user.id, album.id);
    assert.ok((job.meta as { baseline?: unknown }).baseline, 'layout job 必须记录基线');

    // 人工编辑落在 AI 运行期间:updatePage 推进该页 version。
    const manual = await albumService.updatePage(user.id, album.id, 0, {
      textsJson: { headline: '人工的手笔' },
    });
    // 已播种 draft 必走 OCC 分支(带 version/revision);盲写分支只对 legacy 相册。
    assert.ok('version' in manual && 'revision' in manual, '已播种页必须走 OCC 写');
    const manualVersion = manual.version;
    const revisionAfterManual = manual.revision;

    // AI 结果回来:基线已失配 → 必须零写入。
    await jobService.handleV3SelectLayoutCompleted(
      job.requestId,
      [{ ...PAGES[0], texts: { headline: 'AI 的旧快照' } }],
      { durationMs: 1, models: {} },
    );

    const done = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(done?.status, 'FAILED');
    assert.equal((done?.error as { code?: string } | null)?.code, 'AI_RESULT_STALE');

    // 人工内容原样保留,AI 的旧快照没有落库。
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 1);
    const page = rows[0]!.page as { texts?: Record<string, unknown> };
    assert.equal(page.texts?.headline, '人工的手笔');
    assert.equal(rows[0]!.version, manualVersion, '页版本停在人工写入的那次');

    // revision 没有被 AI 回写推进(零写入)。
    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.draftRevision, revisionAfterManual);
  } finally {
    await cleanupUser(user.id);
  }
});

test('时序二(人工先改、AI 后启动):新 job 捕获新基线 → 正常落库', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { user, album } = await seedOnePagedAlbum('ai-baseline-fresh');
  try {
    // 人工编辑先发生。
    await albumService.updatePage(user.id, album.id, 0, {
      textsJson: { headline: '改完再跑 AI' },
    });

    // 用户基于最新版本发起重跑:job 基线 = 人工编辑之后的状态。
    const job = await createBaselineJob('layout', user.id, album.id);
    await jobService.handleV3SelectLayoutCompleted(
      job.requestId,
      [{ ...PAGES[0], texts: { headline: 'AI 基于最新版重排' } }],
      { durationMs: 1, models: {} },
    );

    const done = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(done?.status, 'COMPLETED', '基线新鲜,回写放行');
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(
      (rows[0]!.page as { texts?: { headline?: string } }).texts?.headline,
      'AI 基于最新版重排',
    );
    assert.equal(rows[0]!.updatedBy, user.id, 'AI 继承发起者身份');
  } finally {
    await cleanupUser(user.id);
  }
});

test('设置修改同样构成 stale:layout 回写被拦(settings 维度)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { user, album } = await seedOnePagedAlbum('ai-baseline-settings');
  try {
    const job = await createBaselineJob('layout', user.id, album.id);
    // 运行期间只改了设置(标题),页没动 —— 保守策略下 AI 结果同样作废。
    await albumService.updateTitle(user.id, album.id, '运行期间改的标题', 0);

    await jobService.handleV3SelectLayoutCompleted(job.requestId, PAGES, { durationMs: 1, models: {} });

    const done = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(done?.status, 'FAILED');
    assert.equal((done?.error as { code?: string } | null)?.code, 'AI_RESULT_STALE');
    assert.equal((done?.error as { stale?: string } | null)?.stale, 'settings');

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.title, '运行期间改的标题', '设置与页面都未被 AI 回写触碰');
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 1, '页数不变(零写入)');
  } finally {
    await cleanupUser(user.id);
  }
});

test('compose 回调共用同一闸:stale 时零写入且 stage 不被推到 ready', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { user, album } = await seedOnePagedAlbum('ai-baseline-compose');
  try {
    const job = await createBaselineJob('compose', user.id, album.id);
    assert.ok((job.meta as { baseline?: unknown }).baseline, 'compose job 必须记录基线');

    await albumService.updatePage(user.id, album.id, 0, {
      textsJson: { headline: 'compose 期间的人工编辑' },
    });

    await jobService.handleV3ComposeCompleted(
      job.requestId,
      { pagesTexts: { '0': { body: 'AI 的旧文案' } }, coverTexts: { title: '', label: '' } },
      { durationMs: 1, models: {} },
    );

    const done = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(done?.status, 'FAILED');
    assert.equal((done?.error as { code?: string } | null)?.code, 'AI_RESULT_STALE');

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.stage, 'story', '导出闸门钥匙(stage=ready)不得被 stale 回写递出');
    const rows = await draftPageRepo.findByAlbum(album.id);
    const page = rows[0]!.page as { texts?: Record<string, unknown> };
    assert.equal(page.texts?.headline, 'compose 期间的人工编辑', '人工文案保留');
  } finally {
    await cleanupUser(user.id);
  }
});

test('AI 入口 Creator 授权(Phase 4a):editor 通过权限层,stranger 被拦', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { generationService } = await import('../generation/generation-service');
  const { albumMemberRepo } = await import('../../db/repos/album-member-repo');
  const owner = await makeUser('ai-access-owner');
  const editor = await makeUser('ai-access-editor');
  const stranger = await makeUser('ai-access-stranger');
  try {
    const album = await makeAlbum(owner.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: buildAnalyzeDraftJson(TREE) });
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);

    // helper:断言错误不是权限拒绝(权限层放行后,后续业务/网络层错误都算通过)。
    const notAccessDenied = (err: { code?: string }): boolean => {
      assert.notEqual(err.code, 'ALBUM_ACCESS_DENIED', 'editor 必须穿过权限层');
      return true;
    };

    // select-layout:editor 权限放行(后续业务闸/agent 提交失败都不是权限错)。
    await assert.rejects(
      () => generationService.submitSelectLayoutV3(editor.id, album.id, {
        requestId: `ai-access-layout-${Date.now()}`,
        language: 'zh',
      } as Parameters<typeof generationService.submitSelectLayoutV3>[2]),
      notAccessDenied,
    );
    // stranger 仍在权限层被拦。
    await assert.rejects(
      () => generationService.submitSelectLayoutV3(stranger.id, album.id, {
        requestId: `ai-access-layout-s-${Date.now()}`,
        language: 'zh',
      } as Parameters<typeof generationService.submitSelectLayoutV3>[2]),
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );

    // design-chat 装书闸:editor 权限放行(设计 Agent 本地不可达 → 连接类错误);
    // stranger 在 prepareDesignChat 的 requireAccess 就被拦。
    await assert.rejects(() => albumService.prepareDesignChat(editor.id, album.id), notAccessDenied);
    await assert.rejects(
      () => albumService.prepareDesignChat(stranger.id, album.id),
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
    await cleanupUser(stranger.id);
  }
});
