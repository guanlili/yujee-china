import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/client';
import { albumRepo } from '../../db/repos/album-repo';
import { albumMessageRepo } from '../../db/repos/album-message-repo';
import { draftPageRepo } from '../../db/repos/draft-page-repo';
import { jobService } from '../job/job-service';
import { agentClient } from '../../lib/agent/agent-client';
import { albumService, buildComposeRequest } from './album-service';
import type { Page } from '@yujee/contracts';

// applyDesign(④ 派发 /v3/compose)的两条失败语义:
//   ① 建 job 只对唯一索引冲突(23505)做幂等接受 —— 其余 DB 错误(连接断开、序列化
//      失败、迁移没跑导致 agent_job_kind 缺 'compose')必须原样炸出来。裸 catch 会把
//      「迁移没上」伪装成「模型没写出来」,用户拿到 accepted:true 去轮询一个不存在的 job。
//   ② submit 失败时不能在对话里留下孤儿封面回执卡(user 消息只在 submit 成功后才落库)。

const REF = 'data:image/jpeg;base64,AAAA';

function interiorPage(): Page {
  return {
    pageIndex: 0,
    templateId: 'mag-05',
    images: { image: 'p1' },
    texts: { title: 'SAMPLE' },
  } as Page;
}

function editingAlbum() {
  // draftJson 必须是合法 DraftEnvelope:applyDesign 的页源已切 loadStoryDraft
  // (draft_pages 拆表适配),parseDraftEnvelope 解析失败会变成
  // 'design requires laid-out pages',测不到本文件想测的失败语义。
  return {
    id: 'album-1',
    userId: 'user-1',
    title: '我的书',
    status: 'EDITING',
    draftRevision: 0,
    copySource: null,
    draftJson: {
      version: 'v3-story',
      tree: {
        chapters: [
          {
            chapterId: 'c1',
            title: '第一章',
            description: '',
            chapterContext: '用户讲的故事',
            place: '杭州',
            keywords: [],
            extractedColor: null,
            accentColor: null,
            artFont: null,
            photos: [
              {
                photoId: 'p1',
                sceneDescription: '',
                width: 800,
                height: 600,
                orientation: 'landscape',
                takenAt: null,
              },
            ],
          },
        ],
      },
      pages: [interiorPage()],
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    },
  };
}

const INPUT = {
  language: 'zh' as const,
  coverTemplateId: 'mag-01',
  coverPhotoId: 'p1',
  endingTemplateId: 'mag-22',
  endingPhotoId: 'p1',
  refs: { p1: REF },
};

function mockAlbumAndTx() {
  const findById = mock.method(albumRepo, 'findById', async () => editingAlbum() as never);
  const transaction = mock.method(db, 'transaction', (async (fn: (tx: unknown) => unknown) =>
    fn({} as unknown)) as never);
  // loadStoryDraft 会数 draft_pages 行:mock 成 0 行走 legacy draftJson.pages 回退,
  // 保持本文件零 DB 依赖(它测的是 job/submit 失败语义,不是页源)。
  const countRows = mock.method(draftPageRepo, 'countByAlbum', async () => 0);
  return { findById, transaction, countRows };
}

test('建 job 抛非 23505 的错误 → applyDesign 原样抛,绝不谎报 accepted', async () => {
  const { findById, transaction } = mockAlbumAndTx();
  const createJob = mock.method(jobService, 'createGenerationJob', async () => {
    const err = new Error('invalid input value for enum agent_job_kind: "compose"') as Error & {
      code?: string;
    };
    err.code = '22P02';
    throw err;
  });
  const createMsg = mock.method(albumMessageRepo, 'create', async () => ({}) as never);
  try {
    await assert.rejects(
      () => albumService.applyDesign('user-1', 'album-1', INPUT),
      /agent_job_kind/,
    );
    assert.equal(createMsg.mock.callCount(), 0);
  } finally {
    findById.mock.restore();
    transaction.mock.restore();
    createJob.mock.restore();
    createMsg.mock.restore();
  }
});

test('建 job 撞唯一索引(23505)→ 幂等接受,不建第二个 job', async () => {
  const { findById, transaction } = mockAlbumAndTx();
  const createJob = mock.method(jobService, 'createGenerationJob', async () => {
    const err = new Error('duplicate key value violates unique constraint') as Error & {
      code?: string;
    };
    err.code = '23505';
    throw err;
  });
  const submit = mock.method(agentClient, 'submitComposeV3', async () => undefined as never);
  try {
    const res = await albumService.applyDesign('user-1', 'album-1', INPUT);
    assert.equal(res.accepted, true);
    assert.equal(submit.mock.callCount(), 0);
  } finally {
    findById.mock.restore();
    transaction.mock.restore();
    createJob.mock.restore();
    submit.mock.restore();
  }
});

test('submit 失败 → 不留下孤儿封面回执卡(user 消息不入库)', async () => {
  const { findById, transaction } = mockAlbumAndTx();
  const createJob = mock.method(
    jobService,
    'createGenerationJob',
    async () => ({ id: 'job-1' }) as never,
  );
  const markRunning = mock.method(jobService, 'markRunning', async () => undefined as never);
  const handleFailed = mock.method(jobService, 'handleV3Failed', async () => undefined as never);
  const createMsg = mock.method(albumMessageRepo, 'create', async () => ({}) as never);
  const submit = mock.method(agentClient, 'submitComposeV3', async () => {
    throw new Error('agent down');
  });
  try {
    await assert.rejects(() => albumService.applyDesign('user-1', 'album-1', INPUT));
    assert.equal(createMsg.mock.callCount(), 0);
    assert.equal(handleFailed.mock.callCount(), 1);
  } finally {
    findById.mock.restore();
    transaction.mock.restore();
    createJob.mock.restore();
    markRunning.mock.restore();
    handleFailed.mock.restore();
    createMsg.mock.restore();
    submit.mock.restore();
  }
});

test('submit 成功 → 才落「就用这组封面」的 user 消息', async () => {
  const { findById, transaction } = mockAlbumAndTx();
  const createJob = mock.method(
    jobService,
    'createGenerationJob',
    async () => ({ id: 'job-1' }) as never,
  );
  const markRunning = mock.method(jobService, 'markRunning', async () => undefined as never);
  const createMsg = mock.method(albumMessageRepo, 'create', async () => ({}) as never);
  const submit = mock.method(agentClient, 'submitComposeV3', async () => undefined as never);
  try {
    const res = await albumService.applyDesign('user-1', 'album-1', INPUT);
    assert.equal(res.accepted, true);
    assert.equal(createMsg.mock.callCount(), 1);
  } finally {
    findById.mock.restore();
    transaction.mock.restore();
    createJob.mock.restore();
    markRunning.mock.restore();
    createMsg.mock.restore();
    submit.mock.restore();
  }
});

// ── 坏 ref 不该拖垮整本书 ────────────────────────────────────────────────────
// 缺 ref 的照片本来就跳过;格式不合法/超 800KB 的 ref 却会让整个 ComposeRequest
// safeParse 失败 → 用户拿 400、整本书写不出来,与「少一张也照常出稿」不一致。

test('buildComposeRequest:非法 ref 当缺 ref 跳过,不炸整个请求', () => {
  const req = buildComposeRequest({
    requestId: 'r1',
    callbackUrl: 'https://example.com/api/v3/internal/job-progress',
    language: 'zh',
    albumTitle: '我的书',
    coverTemplateId: 'mag-01',
    endingTemplateId: 'mag-22',
    chapters: [
      {
        chapterId: 'c1',
        title: '第一章',
        photos: [
          { photoId: 'p1', takenAt: null },
          { photoId: 'p2', takenAt: null }, // 非法 data URL
          { photoId: 'p3', takenAt: null }, // 超 800KB
        ],
      },
    ],
    interiorPages: [interiorPage()],
    refs: {
      p1: REF,
      p2: 'https://cdn.example.com/p2.jpg',
      p3: `data:image/jpeg;base64,${'A'.repeat(1_200_000)}`,
    },
  });
  assert.deepEqual(
    req.chapters[0].photos.map((p) => p.photoId),
    ['p1'],
  );
});
