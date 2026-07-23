import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalyzeDraftJson,
  jobService,
  mergeSelectLayoutPages,
  mergeV3Usage,
  zombieTimeoutMsFor,
} from './job-service';
import { agentJobRepo } from '../../db/repos/agent-job-repo';

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


// C 方案:落库/外发页面带烘出的 html;槽位断言剥掉它逐一比对。
function stripPagesHtml(pages: unknown): unknown {
  if (!Array.isArray(pages)) return pages;
  return pages.map((p) => {
    const { html: _html, ...rest } = p as Record<string, unknown>;
    return rest;
  });
}

test('buildAnalyzeDraftJson wraps tree-only analyze output as V3StoryDraft', () => {
  assert.deepEqual(buildAnalyzeDraftJson(TREE), {
    version: 'v3-story',
    tree: TREE,
    progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
  });
});

test('mergeSelectLayoutPages adds pages without mutating the Stage1 tree/progress', () => {
  const draft = buildAnalyzeDraftJson(TREE);

  const merged = mergeSelectLayoutPages(draft, PAGES) as { pages: unknown[] } & Record<string, unknown>;
  assert.deepEqual({ ...merged, pages: stripPagesHtml(merged.pages) }, {
    version: 'v3-story',
    tree: TREE,
    pages: PAGES,
    progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
  });
  assert.deepEqual(draft, {
    version: 'v3-story',
    tree: TREE,
    progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
  });
});

test('mergeSelectLayoutPages rejects select-layout output before a Stage1 tree exists', () => {
  assert.throws(
    () => mergeSelectLayoutPages({ chapters: [] }, PAGES),
    /select-layout completion requires an existing v3-story draft/,
  );
  assert.throws(
    () => mergeSelectLayoutPages(null, PAGES),
    /select-layout completion requires an existing v3-story draft/,
  );
});

test('mergeV3Usage keeps Stage1 usage when Stage2 reuses the same job', () => {
  assert.deepEqual(
    mergeV3Usage(
      {
        durationMs: 10,
        visionCallCount: 2,
        planningInputTokens: 3,
        models: { vision: 'doubao' },
      },
      {
        durationMs: 20,
        geminiCallCount: 1,
        planningInputTokens: 7,
        planningOutputTokens: 11,
        models: { planning: 'gemini-layout' },
      },
    ),
    {
      durationMs: 30,
      visionCallCount: 2,
      geminiCallCount: 1,
      planningInputTokens: 10,
      planningOutputTokens: 11,
      repairAttempts: 0,
      models: { vision: 'doubao', planning: 'gemini-layout' },
    },
  );
});

// ── 僵尸超时按 job kind 分档 ────────────────────────────────────────────────
// compose 是全链路唯一的 AI 调用(按章并发看真图 + 写全书文案),10 章的书跑过
// 5 分钟完全正常。用 init/layout 那档 5 分钟去扫它,会在成稿回调回来之前把 job
// 标成 FAILED,回调进门第一句就 return —— 整本书的文案静默丢弃。

function runningJob(kind: string, ageMs: number) {
  return {
    id: 'job-1',
    kind,
    albumId: 'album-1',
    status: 'RUNNING' as const,
    stage: 'compose',
    progress: 12,
    startedAt: new Date(Date.now() - ageMs),
    createdAt: new Date(Date.now() - ageMs),
  };
}

test('compose 的僵尸超时比 engine 的 600s 后台预算更长,init/layout 仍是 5 分钟', () => {
  assert.equal(zombieTimeoutMsFor('init'), 5 * 60 * 1000);
  assert.equal(zombieTimeoutMsFor('layout'), 5 * 60 * 1000);
  assert.ok(zombieTimeoutMsFor('compose') > 10 * 60 * 1000);
});

test('resolveGeneration 不扫死跑了 6 分钟的 compose job', async () => {
  const findMock = mock.method(agentJobRepo, 'findLatestByAlbum', async () =>
    runningJob('compose', 6 * 60 * 1000),
  );
  const sweepMock = mock.method(jobService, 'sweepStaleJob', async () => ({
    swept: true,
    releasedHold: false,
  }));
  try {
    const resolved = await jobService.resolveGeneration('album-1');
    assert.deepEqual(resolved, { kind: 'progress', stage: 'compose', progress: 12 });
    assert.equal(sweepMock.mock.callCount(), 0);
  } finally {
    findMock.mock.restore();
    sweepMock.mock.restore();
  }
});

test('resolveGeneration 扫死跑了 13 分钟的 compose job', async () => {
  const findMock = mock.method(agentJobRepo, 'findLatestByAlbum', async () =>
    runningJob('compose', 13 * 60 * 1000),
  );
  const sweepMock = mock.method(jobService, 'sweepStaleJob', async () => ({
    swept: true,
    releasedHold: false,
  }));
  try {
    const resolved = await jobService.resolveGeneration('album-1');
    assert.deepEqual(resolved, { kind: 'swept' });
    assert.equal(sweepMock.mock.callCount(), 1);
  } finally {
    findMock.mock.restore();
    sweepMock.mock.restore();
  }
});

test('resolveGeneration 仍在 5 分钟就扫死非 compose 的 job', async () => {
  const findMock = mock.method(agentJobRepo, 'findLatestByAlbum', async () =>
    runningJob('layout', 6 * 60 * 1000),
  );
  const sweepMock = mock.method(jobService, 'sweepStaleJob', async () => ({
    swept: true,
    releasedHold: false,
  }));
  try {
    assert.deepEqual(await jobService.resolveGeneration('album-1'), { kind: 'swept' });
    assert.equal(sweepMock.mock.callCount(), 1);
  } finally {
    findMock.mock.restore();
    sweepMock.mock.restore();
  }
});
