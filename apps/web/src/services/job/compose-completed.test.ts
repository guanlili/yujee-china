import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/client';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
import { albumRepo } from '../../db/repos/album-repo';
import { draftPageRepo } from '../../db/repos/draft-page-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import { jobService, mergeComposeIntoDraft, readComposeMeta, type ComposeJobMeta } from './job-service';
import { buildComposeRequest } from '../album/album-service';
import type { Page } from '@yujee/contracts';

// ④ 一次性成稿(/v3/compose)回调落地。四条硬约束:
//   ① pagesTexts 逐槽覆盖到对应页的 texts,不整页替换(模型没写的槽保留模板 sample);
//   ② 没出现在 pagesTexts 里的页原样保留 —— 某章写不出来也照常成稿;
//   ③ 处理完 albums.stage === 'ready'(导出闸门钥匙,唯一推进点);
//   ④ coverTexts/endingTexts 里的空串忽略,不把封面 sample 洗成空白。

const COVER_ID = 'mag-01';
const ENDING_ID = 'mag-22';

// 内页两页(mag-05 单图三槽 / mag-07 双图三槽),都带模板 sample 文案。
function interiorPages(): Page[] {
  return [
    {
      pageIndex: 0,
      templateId: 'mag-05',
      images: { image: 'p1' },
      texts: { title: 'SAMPLE TITLE', explain: 'SAMPLE EXPLAIN', body: 'SAMPLE BODY' },
    },
    {
      pageIndex: 1,
      templateId: 'mag-07',
      images: { image1: 'p2', image2: 'p3' },
      texts: { title: 'KEEP TITLE', body: 'KEEP BODY', body2: 'KEEP BODY2' },
    },
  ];
}

function draft() {
  return {
    version: 'v3-story',
    tree: {
      chapters: [
        {
          chapterId: 'c1',
          title: '2024 年 03 月 11–14 日',
          description: '',
          chapterContext: '',
          place: '',
          keywords: [],
          extractedColor: null,
          accentColor: null,
          artFont: null,
          photos: [
            { photoId: 'p1', sceneDescription: '', width: 800, height: 600, orientation: 'landscape' },
            { photoId: 'p2', sceneDescription: '', width: 800, height: 600, orientation: 'landscape' },
            { photoId: 'p3', sceneDescription: '', width: 600, height: 800, orientation: 'portrait' },
          ],
        },
      ],
    },
    pages: interiorPages(),
    progress: { currentChapterId: 'c1', doneChapterIds: [] },
  };
}

const META: ComposeJobMeta = {
  language: 'zh',
  coverTemplateId: COVER_ID,
  coverPhotoId: 'p1',
  endingTemplateId: ENDING_ID,
  endingPhotoId: 'p2',
  extraEndingPhotoIds: ['p3'],
};

function pageByTemplate(pages: Array<{ templateId: string; texts: Record<string, string> }>, id: string) {
  return pages.find((p) => p.templateId === id)!;
}

test('① pagesTexts 逐槽覆盖内页 texts,没写到的槽保留模板 sample', () => {
  const { draftJson } = mergeComposeIntoDraft(draft(), META, {
    // 只写了第 0 页的 title + body,explain 没写
    pagesTexts: { '0': { title: '写出来的标题', body: '写出来的正文' } },
  });
  const page = pageByTemplate(draftJson.pages, 'mag-05');
  assert.equal(page.texts.title, '写出来的标题');
  assert.equal(page.texts.body, '写出来的正文');
  assert.equal(page.texts.explain, 'SAMPLE EXPLAIN', '未写到的槽必须保留 sample,不能整页替换');
});

test('② 未出现在 pagesTexts 里的页 texts 原样保留(某章写不出来也照常成稿)', () => {
  const { draftJson } = mergeComposeIntoDraft(draft(), META, {
    pagesTexts: { '0': { title: '只写了第一页' } },
  });
  const untouched = pageByTemplate(draftJson.pages, 'mag-07');
  assert.deepEqual(untouched.texts.title, 'KEEP TITLE');
  assert.deepEqual(untouched.texts.body, 'KEEP BODY');
  assert.deepEqual(untouched.texts.body2, 'KEEP BODY2');
});

test('④ coverTexts/endingTexts 的空串被忽略,封面不会被洗成空白', () => {
  const { draftJson } = mergeComposeIntoDraft(draft(), META, {
    coverTexts: { title: '我的一年', label: '', body: '   ' },
    endingTexts: { title: '', body: '结尾写好了' },
  });
  const cover = pageByTemplate(draftJson.pages, COVER_ID);
  assert.equal(cover.texts.title, '我的一年');
  assert.equal(cover.texts.label, 'NORWAY · 21 DAYS ', '空串槽必须留模板 sample');
  assert.match(cover.texts.body ?? '', /I went north alone/, '纯空白同样按空串处理');
  const ending = pageByTemplate(draftJson.pages, ENDING_ID);
  assert.equal(ending.texts.title, '365 Stories');
  assert.equal(ending.texts.body, '结尾写好了');
});

test('compose 不回 colors / fonts 时,三色恒黑 + 按语言兜底字体(carrier 不写空)', () => {
  const { draftJson } = mergeComposeIntoDraft(draft(), META, {});
  const design = draftJson.design as { fonts: Record<string, string>; colors: Record<string, string> };
  assert.deepEqual(design.colors, { title: '#1c1b18', body: '#1c1b18', explain: '#1c1b18' });
  assert.deepEqual(design.fonts, {
    title: 'noto-serif-sc',
    body: 'noto-serif-sc',
    decoration: 'great-vibes',
  });
  // carrier sweep 真的把字体/颜色写进了页面 texts(渲染端消费的 `${slotId}#…` 形式)。
  const cover = pageByTemplate(draftJson.pages, COVER_ID);
  assert.equal(cover.texts['title#artFont'], 'noto-serif-sc');
  assert.equal(cover.texts['title#accentColor'], '#1c1b18');
});

test('成书页序 [cover, …interior, ending] + pageIndex 重排 + 整书重烘 html', () => {
  const { draftJson, pages } = mergeComposeIntoDraft(draft(), META, {});
  assert.deepEqual(
    pages.map((p) => p.templateId),
    [COVER_ID, 'mag-05', 'mag-07', ENDING_ID],
  );
  assert.deepEqual(pages.map((p) => p.pageIndex), [0, 1, 2, 3]);
  assert.ok(pages.every((p) => typeof p.html === 'string' && p.html.length > 0));
  // 封尾双图槽都填上(图槽绝不留空)。
  assert.deepEqual(pageByTemplate(draftJson.pages, ENDING_ID)['images' as 'texts'], {
    image1: 'p2',
    image2: 'p3',
  } as unknown as Record<string, string>);
  // 选定封面 = 故事收官:现存章节全部记 done。
  assert.deepEqual(draftJson.progress, { currentChapterId: null, doneChapterIds: ['c1'] });
});

test('幂等重入:已有封面/封尾的书重成稿,不会叠出第二组封面', () => {
  const first = mergeComposeIntoDraft(draft(), META, {}).draftJson;
  const second = mergeComposeIntoDraft(first, META, {}).draftJson;
  assert.deepEqual(
    second.pages.map((p) => p.templateId),
    [COVER_ID, 'mag-05', 'mag-07', ENDING_ID],
  );
});

test('没有排版页的草稿:拒绝成稿(不静默产出一本只有封面的书)', () => {
  assert.throws(
    () => mergeComposeIntoDraft({ ...draft(), pages: [] }, META, {}),
    /compose completion requires an existing paged draft/,
  );
});

test('readComposeMeta:坏形状 → null(回调侧据此判失败,不会拿空模板 id 组页)', () => {
  assert.equal(readComposeMeta(null), null);
  assert.equal(readComposeMeta({ appendChapterIds: ['c1'] }), null);
  assert.equal(readComposeMeta({ compose: { coverTemplateId: COVER_ID } }), null);
  assert.deepEqual(readComposeMeta({ compose: { ...META } }), META);
});

test('③ handleV3ComposeCompleted:落库成书 + stage 推到 ready(导出闸门钥匙)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('compose-ready');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: draft(),
    });
    const requestId = `compose-${Date.now()}`;
    const job = await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId,
      kind: 'compose',
      status: 'RUNNING',
      progress: 0,
      meta: { compose: { ...META } },
    });

    await jobService.handleV3ComposeCompleted(
      requestId,
      { pagesTexts: { '0': { body: '成稿正文' } }, coverTexts: { title: '我的一年', label: '' } },
      { durationMs: 1, models: {} },
    );

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.stage, 'ready');
    assert.equal(reloaded?.pageCount, 4);
    // draft_pages 拆表(Phase 1a):compose 落库的页真相搬进 draft_pages 行,
    // draftJson 瘦身为 envelope —— 不再含 pages 键。
    assert.equal(
      (reloaded?.draftJson as Record<string, unknown> | undefined)?.pages,
      undefined,
      'draftJson must not carry a pages key after the draft_pages split',
    );

    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 4, 'draft_pages row count must match pageCount');
    assert.equal(rows[0]!.pageIndex, 0);
    assert.equal(rows[0]!.page.templateId, COVER_ID);
    assert.equal((rows[0]!.page as { texts: Record<string, string> }).texts.title, '我的一年');
    assert.equal((rows[0]!.page as { texts: Record<string, string> }).texts.label, 'NORWAY · 21 DAYS ');
    assert.equal((rows[1]!.page as { texts: Record<string, string> }).texts.body, '成稿正文');
    assert.equal((rows[1]!.page as { texts: Record<string, string> }).texts.title, 'SAMPLE TITLE');
    // 每行 version === 新 draft_revision(整书替换,所有页同一版本)。
    assert.ok(reloaded?.draftRevision && reloaded.draftRevision > 0);
    for (const row of rows) {
      assert.equal(row.version, reloaded?.draftRevision);
      assert.equal(row.updatedBy, null, 'compose is a system/agent write point');
    }

    const doneJob = await agentJobRepo.findByRequestId(requestId);
    assert.equal(doneJob?.status, 'COMPLETED');
    assert.equal(doneJob?.progress, 100);
    assert.equal(job.id, doneJob?.id);
  } finally {
    await cleanupUser(user.id);
  }
});

test('compose 失败/超时:相册留 EDITING(草稿完好),不标 FAILED', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('compose-failed');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: draft() });
    const requestId = `compose-fail-${Date.now()}`;
    await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId,
      kind: 'compose',
      status: 'RUNNING',
      progress: 0,
    });

    await jobService.handleV3Failed(requestId, { code: 'AGENT_TIMEOUT', message: 'compose timed out' });

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.status, 'EDITING');
    assert.equal(reloaded?.stage, 'story');
    assert.equal((await agentJobRepo.findByRequestId(requestId))?.status, 'FAILED');
  } finally {
    await cleanupUser(user.id);
  }
});

// ── 派发侧:compose 请求装配(纯函数,无 DB) ────────────────────────────────
test('buildComposeRequest:页按图槽归章、缺 200px ref 的照片跳过、title 降级到页面 title 槽', () => {
  const req = buildComposeRequest({
    requestId: 'r1',
    callbackUrl: 'http://localhost:3000/api/v3/internal/job-progress',
    language: 'zh',
    albumTitle: '我的一年',
    coverTemplateId: COVER_ID,
    endingTemplateId: ENDING_ID,
    chapters: [
      // 老树没有 title:降级读本章页面已写进 title 槽的值(mag-05 的 title)。
      { chapterId: 'c1', place: '杭州', photos: [{ photoId: 'p1' }, { photoId: 'p2', takenAt: '2024-03-11T08:00:00' }] },
    ],
    interiorPages: interiorPages(),
    refs: { p1: 'data:image/jpeg;base64,AA==' }, // p2 没有 ref
  });

  assert.equal(req.chapters.length, 1);
  const chapter = req.chapters[0]!;
  assert.equal(chapter.title, 'SAMPLE TITLE');
  // p2 缺 ref 被跳过(少一张也照常出稿),p1 带上地名文字、没有任何坐标字段。
  assert.deepEqual(chapter.photos.map((p) => p.photoId), ['p1']);
  assert.equal(chapter.photos[0]!.place, '杭州');
  // 页归章:两页都引用了本章照片(p1 / p2、p3 在同章)。
  assert.deepEqual(chapter.pages.map((p) => p.pageIndex), [0, 1]);
  // 封面/封尾只给文字槽 spec(模板 sample 当篇幅预算)。
  assert.ok(req.coverSlots.length > 0 && req.coverSlots.every((s) => s.id && s.role));
  assert.ok(req.endingSlots.length > 0);
});
