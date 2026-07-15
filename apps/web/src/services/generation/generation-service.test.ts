import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { agentClient } from '@/lib/agent/agent-client';
import { jobService } from '@/services/job/job-service';
import { transientLayoutCandidates } from '@/services/album/layout-candidates';
import {
  buildJudgeLayoutRequest,
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
            sceneDescription: 'beach',
          },
          {
            photoId: 'p2',
            ref200px: 'data:image/jpeg;base64,BB==',
            orientation: 'portrait',
            takenAt: null,
            sceneDescription: 'portrait',
          },
        ],
      },
    ],
  });
  assert.equal(JSON.stringify(request).includes('candidates'), false);
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
    assert.deepEqual(stripPagesHtml((reloaded?.draftJson as { pages?: unknown }).pages), PAGES);
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

// ── P2 two-phase select-layout (docs/agent/contract.md §5.2.1) ──

const CANDIDATE_UNITS = [
  {
    unitKey: 'ch_1',
    chapterId: 'ch_1',
    candidates: [
      { candidateIndex: 0, pages: [{ templateId: 'mag-02', images: { image: 'p1' } }] },
      { candidateIndex: 1, pages: [{ templateId: 'mag-04', images: { image1: 'p1', image2: 'p2' } }] },
    ],
  },
];

const JUDGE_UNITS = [
  {
    unitKey: 'ch_1',
    chapterId: 'ch_1',
    candidates: [
      { candidateIndex: 0, thumbnail: 'data:image/jpeg;base64,AA==', pages: [{ templateId: 'mag-02', images: { image: 'p1' } }] },
      { candidateIndex: 1, thumbnail: 'data:image/jpeg;base64,BB==', pages: [{ templateId: 'mag-04', images: { image1: 'p1', image2: 'p2' } }] },
    ],
  },
];

// Drive a job to the candidates-ready sentinel (progress 52) via phase-1 reserve +
// the candidates callback, so phase-2 tests start from the real state machine.
async function seedCandidatesReadyAlbum(userId: string, requestId: string, t: TestContext) {
  const album = await seedLayoutReadyAlbum(userId, requestId);
  t.mock.method(agentClient, 'submitSelectLayoutV3', async () => ({ requestId, accepted: true }));
  await generationService.submitSelectLayoutV3(userId, album.id, { requestId, language: 'en', refs: REFS });
  await jobService.handleV3SelectLayoutCandidates(requestId, CANDIDATE_UNITS, USAGE);
  return album;
}

test('buildJudgeLayoutRequest validates against the strict JudgeLayoutRequest contract', () => {
  const request = buildJudgeLayoutRequest({
    requestId: 'judge-r1',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    units: JUDGE_UNITS,
  });
  assert.equal(request.requestId, 'judge-r1');
  assert.equal(request.units.length, 1);
  assert.equal(request.units[0].candidates[0].thumbnail, 'data:image/jpeg;base64,AA==');
});

// NOTE: 解耦后两段式(candidates 52 / judge 52→53)的 job 哨兵机制不再适用(排版是独立
// layout job)。本地走 inline judge、不用两段式,故此处移除旧的两段式 job-sentinel 测试;
// 两段式若重新启用,需按 layout job 模型另行覆盖(见解耦 plan 后续项)。

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
      tree: { chapters: Array<{ chapterId: string }> };
      pages: unknown[];
      progress: { currentChapterId: string | null; doneChapterIds: string[] };
    };
    assert.equal(draft.tree.chapters.length, 2); // 合并,不覆盖
    assert.equal(draft.tree.chapters[0].chapterId, 'ch_1'); // 老章原样
    assert.match(draft.tree.chapters[1].chapterId, /^add[0-9a-f]{0,8}.*ch_1$/); // 重映射防撞
    assert.equal(draft.progress.currentChapterId, draft.tree.chapters[1].chapterId); // cursor 指新章
    assert.deepEqual(draft.progress.doneChapterIds, ['ch_1']); // 老章 done 不动
    assert.equal(draft.pages.length, PAGES.length); // 原页保留
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

test('候选跨实例可见:内存 miss 时从 agent_jobs.meta 兜底(Vercel 多实例回归)', async (t: TestContext) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('p2-meta-candidates');
  try {
    const requestId = crypto.randomUUID();
    const album = await seedLayoutReadyAlbum(user.id, requestId);
    // phase-1:layout job 到位并收到 candidates 回调(落内存 + 落 meta)
    const layoutRequestId = crypto.randomUUID();
    await jobService.createGenerationJob(db, { userId: user.id, albumId: album.id, requestId: layoutRequestId, kind: 'layout' });
    const layoutJob = await agentJobRepo.findByRequestId(layoutRequestId);
    await jobService.markRunning(db, layoutJob!.id);
    await agentJobRepo.update(db, layoutJob!.id, { stage: 'layout' });
    const units = [
      { chapterId: 'c1', unitKey: 'c1', candidates: [
        { templateId: 'mag-05', pages: [{ pageIndex: 0, templateId: 'mag-05', images: { image: 'p1' }, texts: {} }] },
        { templateId: 'mag-06', pages: [{ pageIndex: 0, templateId: 'mag-06', images: { image: 'p1' }, texts: {} }] },
      ] },
    ] as never[];
    await jobService.handleV3SelectLayoutCandidates(layoutRequestId, units as never, USAGE);

    // 模拟"另一个实例":清空本进程内存暂存 → 只能靠库
    transientLayoutCandidates.resetForTest();
    const result = await generationService.getJudgeCandidates(user.id, album.id, requestId);
    assert.equal(result.ready, true, '内存 miss 时必须从 meta 兜底(线上 2026-07-12 事故回归)');
    assert.equal(result.units.length, 1);
    // 追加照片回归:浏览器 phase-2 派发的去重键必须是「本次 layout job」的 requestId
    // (每次排版都换),不能是 analyze recipe 的 requestId(跨追加不变 → 第二次排版
    // 被首次生成的去重记录挡死,judge/write_copy 永不触发)。GET 必须把它带回去。
    assert.equal(result.requestId, layoutRequestId, 'GET judge-layout 必须返回 layout job 自己的 requestId');
  } finally {
    await cleanupUser(user.id);
  }
});
