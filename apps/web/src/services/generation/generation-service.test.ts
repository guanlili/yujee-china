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
    assert.deepEqual((reloaded?.draftJson as { pages?: unknown }).pages, PAGES);
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
