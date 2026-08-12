import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { agentClient } from '@/lib/agent/agent-client';
import { jobService } from '@/services/job/job-service';
import {
  buildSelectLayoutRequestFromTree,
  generationService,
} from './generation-service';

const TREE = {
  chapters: [
    {
      chapterId: 'ch_1',
      description: 'Coast morning',
      accentColor: null,
      artFont: null,
      photos: [
        {
          photoId: 'p1',
          sceneDescription: 'beach',
          width: 800,
          height: 600,
          orientation: 'landscape' as const,
          takenAt: '2024-03-15T08:30:00',
        },
        {
          photoId: 'p2',
          sceneDescription: 'portrait',
          width: 600,
          height: 800,
          orientation: 'portrait' as const,
          takenAt: null,
        },
      ],
    },
  ],
};


// C 方案:落库页面带烘出的 html;槽位断言剥掉它逐一比对。
function stripPagesHtml(pages: unknown): unknown {
  if (!Array.isArray(pages)) return pages;
  return pages.map((p) => {
    const { html: _html, ...rest } = p as Record<string, unknown>;
    return rest;
  });
}

test('buildSelectLayoutRequestFromTree sends 200px refs and never caller candidates', () => {
  const request = buildSelectLayoutRequestFromTree({
    requestId: 'layout-r1',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    tree: TREE,
    refs: {
      p1: 'data:image/jpeg;base64,AA==',
      p2: 'data:image/jpeg;base64,BB==',
    },
  });

  assert.deepEqual(request, {
    requestId: 'layout-r1',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    chapters: [
      {
        chapterId: 'ch_1',
        structureHint: 'Coast morning',
        chapterContext: '',
        photos: [
          {
            photoId: 'p1',
            ref200px: 'data:image/jpeg;base64,AA==',
            orientation: 'landscape',
            takenAt: '2024-03-15T08:30:00',
          },
          {
            photoId: 'p2',
            ref200px: 'data:image/jpeg;base64,BB==',
            orientation: 'portrait',
            takenAt: null,
          },
        ],
      },
    ],
  });
  assert.equal(JSON.stringify(request).includes('candidates'), false);
  // 豆包识图已砍:选版式入参不再带照片文字描述。
  assert.equal(JSON.stringify(request).includes('sceneDescription'), false);
});

// 章标识搬到 title 之后,description 恢复成「写目录环节才填」:分析期为空 =>
// 不再把日期串当 structureHint 发给排版(借位 description 时的定时炸弹)。
test('buildSelectLayoutRequestFromTree: 章标识(title)不当 structureHint 发出', () => {
  const request = buildSelectLayoutRequestFromTree({
    requestId: 'layout-r1',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    tree: {
      chapters: [
        { ...TREE.chapters[0], title: '2024 年 03 月 11–14 日', description: '' },
      ],
    },
    refs: {
      p1: 'data:image/jpeg;base64,AA==',
      p2: 'data:image/jpeg;base64,BB==',
    },
  });

  assert.equal('structureHint' in request.chapters[0], false);
  assert.equal(JSON.stringify(request).includes('2024 年 03 月'), false);
});

test('buildSelectLayoutRequestFromTree requires every tree photo to have a browser 200px ref', () => {
  assert.throws(() =>
    buildSelectLayoutRequestFromTree({
      requestId: 'layout-r1',
      callbackUrl: 'https://web.test/api/v3/internal/job-progress',
      language: 'en',
      tree: TREE,
      refs: { p1: 'data:image/jpeg;base64,AA==' },
    }),
  );
});

// 追加照片(加图增量重跑):chapterIds 子集只装那些章节,refs 也只需覆盖它们的照片。
test('buildSelectLayoutRequestFromTree: chapterIds 子集只装范围内章节', () => {
  const twoChapterTree = {
    chapters: [
      TREE.chapters[0],
      {
        ...TREE.chapters[0],
        chapterId: 'add1-ch_1',
        photos: [
          {
            photoId: 'p9',
            sceneDescription: 'new photo',
            width: 800,
            height: 600,
            orientation: 'landscape' as const,
            takenAt: null,
          },
        ],
      },
    ],
  };
  const request = buildSelectLayoutRequestFromTree({
    requestId: 'layout-r2',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    tree: twoChapterTree,
    refs: { p9: 'data:image/jpeg;base64,CC==' }, // 只给新章节照片的 ref
    chapterIds: ['add1-ch_1'],
  });
  assert.deepEqual(request.chapters.map((c) => c.chapterId), ['add1-ch_1']);
  assert.equal(request.chapters[0].photos[0].photoId, 'p9');
});

test('buildSelectLayoutRequestFromTree: 未知 chapterId 范围直接抛', () => {
  assert.throws(
    () =>
      buildSelectLayoutRequestFromTree({
        requestId: 'layout-r3',
        callbackUrl: 'https://web.test/api/v3/internal/job-progress',
        language: 'en',
        tree: TREE,
        refs: {
          p1: 'data:image/jpeg;base64,AA==',
          p2: 'data:image/jpeg;base64,BB==',
        },
        chapterIds: ['nope'],
      }),
    (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
  );
});

const REFS = {
  p1: 'data:image/jpeg;base64,AA==',
  p2: 'data:image/jpeg;base64,BB==',
};

const PAGES = [{ pageIndex: 0, templateId: 'mag-02', images: { 'cells[0].image': 'p1' }, texts: {} }];
const USAGE = { durationMs: 1, models: {} };

async function seedLayoutReadyAlbum(userId: string, requestId: string) {
  const album = await makeAlbum(userId);
  await jobService.createGenerationJob(db, { userId, albumId: album.id, requestId, kind: 'init' });
  await jobService.handleV3AnalyzeCompleted(requestId, TREE, USAGE);
  return album;
}

test('submitSelectLayoutV3 rejects when album is not in EDITING state', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-missing-job');
  try {
    const album = await makeAlbum(user.id);
    // 解耦:排版闸门看相册态(必须 EDITING),不再靠 job。AGENT_RUNNING(分析中)必须被拒。
    await albumRepo.update(db, album.id, {
      status: 'AGENT_RUNNING',
      stage: 'analysing',
      draftJson: { version: 'v3-story', tree: TREE, progress: { currentChapterId: 'ch_1', doneChapterIds: [] } },
    });
    let posted = false;
    t.mock.method(agentClient, 'submitSelectLayoutV3', async () => {
      posted = true;
      return { requestId: 'x', accepted: true };
    });

    await assert.rejects(
      generationService.submitSelectLayoutV3(user.id, album.id, {
        requestId: 'x',
        language: 'en',
        refs: REFS,
      }),
      (err: unknown) => (err as { code?: string }).code === 'ALBUM_NOT_EDITABLE',
    );
    assert.equal(posted, false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitSelectLayoutV3 requires the existing job to be in layout progress', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-not-ready');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      status: 'AGENT_RUNNING',
      stage: 'analysing',
      draftJson: { version: 'v3-story', tree: TREE, progress: { currentChapterId: 'ch_1', doneChapterIds: [] } },
    });
    await jobService.createGenerationJob(db, {
      userId: user.id,
      albumId: album.id,
      requestId: 'layout-not-ready',
      kind: 'init',
    });
    let posted = false;
    t.mock.method(agentClient, 'submitSelectLayoutV3', async () => {
      posted = true;
      return { requestId: 'layout-not-ready', accepted: true };
    });

    await assert.rejects(
      generationService.submitSelectLayoutV3(user.id, album.id, {
        requestId: 'layout-not-ready',
        language: 'en',
        refs: REFS,
      }),
      (err: unknown) => (err as { code?: string }).code === 'ALBUM_NOT_EDITABLE',
    );
    assert.equal(posted, false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitSelectLayoutV3 starts a fresh layout job whose requestId the select-layout callback lands on', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-callback');
  try {
    const album = await seedLayoutReadyAlbum(user.id, 'layout-ready'); // EDITING/story, init job COMPLETED
    const posted: unknown[] = [];
    t.mock.method(agentClient, 'submitSelectLayoutV3', async (payload: unknown) => {
      posted.push(payload);
      return { requestId: (payload as { requestId: string }).requestId, accepted: true };
    });

    await generationService.submitSelectLayoutV3(user.id, album.id, {
      requestId: 'ignored-by-server',
      language: 'en',
      refs: REFS,
    });
    assert.equal(posted.length, 1);
    // 解耦:服务端另起独立 layout job,用自己新生成的 requestId(不复用 analyze 的)。
    const layoutRequestId = (posted[0] as { requestId: string }).requestId;
    assert.ok(layoutRequestId && layoutRequestId !== 'ignored-by-server' && layoutRequestId !== 'layout-ready');
    const layoutJob = await agentJobRepo.findByRequestId(layoutRequestId);
    assert.equal(layoutJob?.kind, 'layout');
    assert.equal(layoutJob?.status, 'RUNNING');

    // 用这个新 requestId 的 completed 回调把页合并进草稿(相册已 EDITING/story,只补页)。
    await jobService.handleV3SelectLayoutCompleted(layoutRequestId, PAGES, USAGE);
    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.status, 'EDITING');
    // draft_pages 拆表(Phase 1a):页真相搬进 draft_pages 行,draftJson 瘦身为 envelope,
    // 不再带 pages 键 —— 读回改走 draftPageRepo(job-service.ts Task 5 收口)。
    assert.equal((reloaded?.draftJson as { pages?: unknown } | undefined)?.pages, undefined);
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.deepEqual(stripPagesHtml(rows.map((r) => r.page)), PAGES);
    const completedLayoutJob = await agentJobRepo.findByRequestId(layoutRequestId);
    assert.equal(completedLayoutJob?.status, 'COMPLETED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitSelectLayoutV3 reserves the layout handoff so duplicate posts do not start duplicate agent work', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-reserve');
  try {
    const album = await seedLayoutReadyAlbum(user.id, 'layout-reserve');
    let posts = 0;
    t.mock.method(agentClient, 'submitSelectLayoutV3', async () => {
      posts += 1;
      return { requestId: 'layout-reserve', accepted: true };
    });

    await generationService.submitSelectLayoutV3(user.id, album.id, {
      requestId: 'layout-reserve',
      language: 'en',
      refs: REFS,
    });
    await generationService.submitSelectLayoutV3(user.id, album.id, {
      requestId: 'layout-reserve',
      language: 'en',
      refs: REFS,
    });

    assert.equal(posts, 1);
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitSelectLayoutV3 rejects malformed browser refs before reserving or posting to Agent', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-bad-ref');
  try {
    const album = await seedLayoutReadyAlbum(user.id, 'layout-bad-ref');
    let posted = false;
    t.mock.method(agentClient, 'submitSelectLayoutV3', async () => {
      posted = true;
      return { requestId: 'layout-bad-ref', accepted: true };
    });

    await assert.rejects(
      generationService.submitSelectLayoutV3(user.id, album.id, {
        requestId: 'layout-bad-ref',
        language: 'en',
        refs: { p1: 'not-a-data-url', p2: 'data:image/jpeg;base64,BB==' },
      }),
      (err: unknown) => (err as { code?: string }).code === 'VALIDATION_FAILED',
    );

    // 坏 refs 在构造载荷时就抛(建 layout job 之前),所以没派发、也不留孤儿 job。
    assert.equal(posted, false);
    // seed 的 init job 仍是 COMPLETED(analyze 已完成),未被这次失败触动。
    const initJob = await agentJobRepo.findByRequestId('layout-bad-ref');
    assert.equal(initJob?.status, 'COMPLETED');
  } finally {
    await cleanupUser(user.id);
  }
});

// ───────────────── 加照片增量重跑(spec §1):submitAddPhotosV3 + append 回调分支 ─────────────────

const APPEND_PHOTOS = [
  { photoId: 'np1', base64: 'data:image/jpeg;base64,AA==', width: 800, height: 600, takenAt: null },
];

const APPEND_TREE = {
  chapters: [
    {
      chapterId: 'ch_1', // 故意与既有 draft 的 ch_1 撞号,验证重映射
      description: 'New trip',
      accentColor: null,
      artFont: null,
      photos: [
        {
          photoId: 'np1',
          sceneDescription: 'new scene',
          width: 800,
          height: 600,
          orientation: 'landscape' as const,
          takenAt: null,
        },
      ],
    },
  ],
};

// 已排版完的 EDITING 相册(v3-story 包裹 + pages + 全章 done + stage ready)。
async function seedPagedAlbum(userId: string) {
  const album = await makeAlbum(userId, { photoCount: 2 });
  await albumRepo.update(db, album.id, {
    status: 'EDITING',
    stage: 'ready',
    draftJson: {
      version: 'v3-story',
      tree: TREE,
      pages: PAGES,
      progress: { currentChapterId: null, doneChapterIds: ['ch_1'] },
    },
  });
  return album;
}

test('submitAddPhotosV3: hold 积分 + kind=add job;analyze 完成合并树/结算/photoCount 累加', async (t: TestContext) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { creditHoldRepo } = await import('@/db/repos/credit-hold-repo');
  const { creditService } = await import('@/services/credit/credit-service');
  const user = await makeUser('add-photos-happy');
  try {
    const album = await seedPagedAlbum(user.id);
    t.mock.method(agentClient, 'submitAnalyzeV3', async () => ({ requestId: 'append-r1' }));

    const before = await creditService.getBalance(user.id);
    await generationService.submitAddPhotosV3(user.id, album.id, {
      requestId: 'append-r1',
      language: 'en',
      photos: APPEND_PHOTOS,
    });

    const job = await agentJobRepo.findByRequestId('append-r1');
    assert.equal(job?.kind, 'add');
    const held = await albumRepo.findById(album.id);
    assert.ok(held?.creditHoldId, 'append hold linked on album');
    const hold = await creditHoldRepo.findById(held!.creditHoldId!);
    assert.equal(hold?.status, 'HOLDING');
    assert.equal(hold?.amount, 1); // 1 张 → ceil(1/10)=1
    assert.equal(await creditService.getBalance(user.id), before); // hold 不动余额

    await jobService.handleV3AnalyzeCompleted('append-r1', APPEND_TREE, USAGE);

    const after = await albumRepo.findById(album.id);
    const draft = after?.draftJson as {
      pages?: unknown;
      tree: { chapters: Array<{ chapterId: string }> };
      progress: { currentChapterId: string | null; doneChapterIds: string[] };
    };
    assert.equal(draft.tree.chapters.length, 2); // 合并,不覆盖
    assert.equal(draft.tree.chapters[0].chapterId, 'ch_1'); // 老章原样
    assert.match(draft.tree.chapters[1].chapterId, /^add[0-9a-f]{0,8}.*ch_1$/); // 重映射防撞
    assert.equal(draft.progress.currentChapterId, draft.tree.chapters[1].chapterId); // cursor 指新章
    assert.deepEqual(draft.progress.doneChapterIds, ['ch_1']); // 老章 done 不动
    // draft_pages 拆表(Phase 1a):draftJson 瘦身为 envelope,不再带 pages 键;
    // append 分支必须先播种(job-service.ts 的 ensureDraftPagesSeeded),老书这
    // 唯一一份 legacy pages 才不会被 envelope-only 覆盖连根拔掉。
    assert.equal(draft.pages, undefined);
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, PAGES.length); // 原页保留(搬进了行,不是没了)
    assert.equal(after?.status, 'EDITING');
    assert.equal(after?.stage, 'ready'); // 追加不回退 stage
    assert.equal(after?.photoCount, 3); // 2 + 1
    const settled = await creditHoldRepo.findById(held!.creditHoldId!);
    assert.equal(settled?.status, 'SETTLED');
    assert.equal(await creditService.getBalance(user.id), before - 1); // 结算扣 1
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitAddPhotosV3: 无排版页拒绝;在途追加拒绝', async (t: TestContext) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('add-photos-guards');
  try {
    // 无 pages 的 draft → VALIDATION_FAILED
    const bare = await makeAlbum(user.id);
    await albumRepo.update(db, bare.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: {
        version: 'v3-story',
        tree: TREE,
        progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
      },
    });
    await assert.rejects(
      () => generationService.submitAddPhotosV3(user.id, bare.id, {
        requestId: 'append-g1', language: 'en', photos: APPEND_PHOTOS,
      }),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );

    // 在途追加(active add job)→ ALBUM_NOT_EDITABLE
    const paged = await seedPagedAlbum(user.id);
    t.mock.method(agentClient, 'submitAnalyzeV3', async () => ({ requestId: 'x' }));
    await generationService.submitAddPhotosV3(user.id, paged.id, {
      requestId: 'append-g2', language: 'en', photos: APPEND_PHOTOS,
    });
    await assert.rejects(
      () => generationService.submitAddPhotosV3(user.id, paged.id, {
        requestId: 'append-g3', language: 'en', photos: APPEND_PHOTOS,
      }),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_EDITABLE',
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('append 失败:释放 hold、相册保持 EDITING 不标 FAILED', async (t: TestContext) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { creditHoldRepo } = await import('@/db/repos/credit-hold-repo');
  const user = await makeUser('add-photos-fail');
  try {
    const album = await seedPagedAlbum(user.id);
    t.mock.method(agentClient, 'submitAnalyzeV3', async () => ({ requestId: 'append-f1' }));
    await generationService.submitAddPhotosV3(user.id, album.id, {
      requestId: 'append-f1', language: 'en', photos: APPEND_PHOTOS,
    });
    const held = await albumRepo.findById(album.id);

    await jobService.handleV3Failed('append-f1', { code: 'AGENT_INTERNAL_ERROR', message: 'boom' });

    const after = await albumRepo.findById(album.id);
    assert.equal(after?.status, 'EDITING'); // 不标 FAILED
    const hold = await creditHoldRepo.findById(held!.creditHoldId!);
    assert.equal(hold?.status, 'RELEASED'); // 不扣钱
  } finally {
    await cleanupUser(user.id);
  }
});


// ── 游客(匿名)口径:零积分变动 + 20 张上限 + 1 本上限 ──────────────────────────

async function makeAnonUser(suffix: string) {
  const { userRepo } = await import('@/db/repos/user-repo');
  return userRepo.upsertById(db, {
    email: `anon-gen-${suffix}-${Date.now()}@yujee.test`,
    name: 'Anonymous',
    isAnonymous: true,
    creditBalance: 0,
  });
}

function dummyPhotos(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    photoId: `ap${i + 1}`,
    base64: 'data:image/jpeg;base64,aGk=',
    width: 800,
    height: 600,
  }));
}

test('submitAnalyzeV3(匿名): 建相册零积分变动(无 precheck、无 hold),余额 0 也能建', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const anon = await makeAnonUser('ok');
  try {
    t.mock.method(agentClient, 'submitAnalyzeV3', async () => ({ requestId: 'anon-r1' }));
    const result = await generationService.submitAnalyzeV3(
      anon.id,
      { requestId: crypto.randomUUID(), language: 'zh', photos: dummyPhotos(3) },
      { isAnonymous: true },
    );
    assert.equal(result.accepted, true);
    const album = await albumRepo.findById(result.albumId);
    assert.equal(album?.userId, anon.id);
    assert.equal(album?.creditHoldId, null); // 没挂 hold
    const { userRepo } = await import('@/db/repos/user-repo');
    const after = await userRepo.findById(anon.id);
    assert.equal(after?.creditBalance, 0); // 余额纹丝不动
  } finally {
    await cleanupUser(anon.id);
  }
});

test('submitAnalyzeV3(匿名): 超过 20 张抛 ANON_PHOTO_LIMIT,一行不写库', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const anon = await makeAnonUser('photos');
  try {
    await assert.rejects(
      () => generationService.submitAnalyzeV3(
        anon.id,
        { requestId: crypto.randomUUID(), language: 'zh', photos: dummyPhotos(21) },
        { isAnonymous: true },
      ),
      (e: { code?: string; status?: number }) => e.code === 'ANON_PHOTO_LIMIT' && e.status === 403,
    );
    const list = await albumRepo.findByUser(anon.id);
    assert.equal(list.length, 0);
  } finally {
    await cleanupUser(anon.id);
  }
});

test('submitAnalyzeV3(匿名): 第 2 本抛 ANON_ALBUM_LIMIT;登录用户不受 1 本上限影响', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const anon = await makeAnonUser('limit');
  const real = await makeUser('anon-gen-real');
  try {
    await makeAlbum(anon.id, { title: 'first' });
    t.mock.method(agentClient, 'submitAnalyzeV3', async () => ({ requestId: 'anon-r2' }));
    await assert.rejects(
      () => generationService.submitAnalyzeV3(
        anon.id,
        { requestId: crypto.randomUUID(), language: 'zh', photos: dummyPhotos(2) },
        { isAnonymous: true },
      ),
      (e: { code?: string }) => e.code === 'ANON_ALBUM_LIMIT',
    );
    // 登录用户(足额积分)建第 2 本照常
    await makeAlbum(real.id, { title: 'real first' });
    const ok2 = await generationService.submitAnalyzeV3(real.id, {
      requestId: crypto.randomUUID(), language: 'zh', photos: dummyPhotos(2),
    });
    assert.equal(ok2.accepted, true);
  } finally {
    await cleanupUser(anon.id);
    await cleanupUser(real.id);
  }
});

test('submitAddPhotosV3(匿名): 累计超 20 张抛 ANON_PHOTO_LIMIT;20 内零积分追加', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const anon = await makeAnonUser('append');
  try {
    const album = await seedPagedAlbum(anon.id); // seedPagedAlbum 的 photoCount = 2
    await assert.rejects(
      () => generationService.submitAddPhotosV3(
        anon.id, album.id,
        { requestId: crypto.randomUUID(), language: 'en', photos: dummyPhotos(19) }, // 2+19>20
        { isAnonymous: true },
      ),
      (e: { code?: string }) => e.code === 'ANON_PHOTO_LIMIT',
    );
    t.mock.method(agentClient, 'submitAnalyzeV3', async () => ({ requestId: 'anon-append-1' }));
    const ok = await generationService.submitAddPhotosV3(
      anon.id, album.id,
      { requestId: 'anon-append-1', language: 'en', photos: dummyPhotos(3) }, // 5+3≤20
      { isAnonymous: true },
    );
    assert.equal(ok.accepted, true);
    const after = await albumRepo.findById(album.id);
    assert.equal(after?.creditHoldId, null); // 追加同样不挂 hold
  } finally {
    await cleanupUser(anon.id);
  }
});

// ── 建书照片直传 R2(绕开 Vercel 4.5MB 请求体上限)────────────────────────────
// 字节由浏览器 PUT 到 analyze-uploads/,建书 body 只带 uploadSessionId + 元数据;
// 服务端取回来拼成和内联时代一模一样的 photos 转发给 agent,engine 侧零改动。

function metaPhotos(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    photoId: `up${i + 1}`,
    width: 800,
    height: 600,
  }));
}

test('submitAnalyzeV3(直传): 从 R2 取回的字节原样转发给 agent', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const user = await makeUser('analyze-upload-ok');
  const sessionId = crypto.randomUUID();
  try {
    const { analyzeUploadService } = await import('@/services/album/analyze-upload-service');
    t.mock.method(analyzeUploadService, 'collect', async (
      _userId: string,
      _sessionId: string,
      photos: { photoId: string; width: number; height: number }[],
    ) => photos.map((p) => ({ ...p, base64: `data:image/jpeg;base64,${p.photoId}` })));

    let sent: { photos: { photoId: string; base64: string }[] } | null = null;
    t.mock.method(agentClient, 'submitAnalyzeV3', async (req: typeof sent) => {
      sent = req;
      return { requestId: 'upload-r1' };
    });

    const result = await generationService.submitAnalyzeV3(user.id, {
      requestId: crypto.randomUUID(),
      language: 'zh',
      uploadSessionId: sessionId,
      photos: metaPhotos(3),
    });

    assert.equal(result.accepted, true);
    assert.deepEqual(
      sent!.photos.map((p) => [p.photoId, p.base64]),
      [
        ['up1', 'data:image/jpeg;base64,up1'],
        ['up2', 'data:image/jpeg;base64,up2'],
        ['up3', 'data:image/jpeg;base64,up3'],
      ],
    );
    const album = await albumRepo.findById(result.albumId);
    assert.equal(album?.photoCount, 3);
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitAnalyzeV3(直传): R2 少字节时不建相册、不 hold 积分、不发 agent', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const user = await makeUser('analyze-upload-missing');
  try {
    const { analyzeUploadService } = await import('@/services/album/analyze-upload-service');
    const { ERRORS } = await import('@/lib/api/error-codes');
    const { userRepo } = await import('@/db/repos/user-repo');
    const balanceBefore = (await userRepo.findById(user.id))?.creditBalance;
    t.mock.method(analyzeUploadService, 'collect', async () => {
      throw ERRORS.ANALYZE_UPLOAD_INCOMPLETE(2);
    });
    let agentCalls = 0;
    t.mock.method(agentClient, 'submitAnalyzeV3', async () => {
      agentCalls += 1;
      return { requestId: 'never' };
    });

    await assert.rejects(
      () => generationService.submitAnalyzeV3(user.id, {
        requestId: crypto.randomUUID(),
        language: 'zh',
        uploadSessionId: crypto.randomUUID(),
        photos: metaPhotos(3),
      }),
      (e: { code?: string; status?: number }) =>
        e.code === 'ANALYZE_UPLOAD_INCOMPLETE' && e.status === 409,
    );

    assert.equal(agentCalls, 0);
    const list = await albumRepo.findByUser(user.id);
    assert.equal(list.length, 0, '相册一行都不该写');
    const after = await userRepo.findById(user.id);
    assert.equal(after?.creditBalance, balanceBefore, '积分余额纹丝不动');
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitAnalyzeV3(旧式内联): 没有 uploadSessionId 时不碰 R2,照旧直发', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const user = await makeUser('analyze-upload-legacy');
  try {
    const { analyzeUploadService } = await import('@/services/album/analyze-upload-service');
    let collectCalls = 0;
    t.mock.method(analyzeUploadService, 'collect', async () => {
      collectCalls += 1;
      return [];
    });
    let sent: { photos: { photoId: string; base64: string }[] } | null = null;
    t.mock.method(agentClient, 'submitAnalyzeV3', async (req: typeof sent) => {
      sent = req;
      return { requestId: 'legacy-r1' };
    });

    await generationService.submitAnalyzeV3(user.id, {
      requestId: crypto.randomUUID(),
      language: 'zh',
      photos: dummyPhotos(2),
    });

    assert.equal(collectCalls, 0, '旧路径不该去 R2 取字节');
    assert.equal(sent!.photos[0]!.base64, 'data:image/jpeg;base64,aGk=');
  } finally {
    await cleanupUser(user.id);
  }
});
