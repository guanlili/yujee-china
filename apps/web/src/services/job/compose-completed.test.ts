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
import { interiorInkSequence, legacyInteriorInkSequence } from '@/lib/design/third-set-palette';

// ④ 一次性成稿(/v3/compose)回调落地。四条硬约束:
//   ① pagesTexts 逐槽覆盖到对应页的 texts,不整页替换(模型没写的槽保留模板 sample);
//   ② 没出现在 pagesTexts 里的页原样保留 —— 某章写不出来也照常成稿;
//   ③ 处理完 albums.stage === 'ready'(导出闸门钥匙,唯一推进点);
//   ④ coverTexts/endingTexts 里的空串忽略;只有 title 槽落模板 sample 兜底,其余槽
//      (body/label/decoration)宁可空着,不把模板作者写的年份地名印上用户的书。

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

test('④ coverTexts/endingTexts 的空串被忽略;title 槽落模板 sample,其余槽宁可空着', () => {
  const { draftJson } = mergeComposeIntoDraft(draft(), META, {
    coverTexts: { title: '我的一年', label: '', body: '   ' },
    endingTexts: { title: '', body: '结尾写好了' },
  });
  const cover = pageByTemplate(draftJson.pages, COVER_ID);
  assert.equal(cover.texts.title, '我的一年');
  // label(decoration)/body 不是 title 槽:模型没写出来就空着,不回落模板 sample
  // (mag-01 的 label sample 是 "NORWAY · 21 DAYS ",body sample 是别人的旅行故事)。
  assert.equal(cover.texts.label, undefined, '非 title 槽不回落 sample');
  assert.equal(cover.texts.body, undefined, '纯空白同样按空串处理,body 槽同理不回落 sample');
  const ending = pageByTemplate(draftJson.pages, ENDING_ID);
  assert.equal(ending.texts.title, '365 Stories', 'title 槽仍留 sample 兜底(封面没有大标题是废版面)');
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
  // interiorSeed 也必须能从 DB 往返里读回来(评审 H2b):真账号那条路是
  // applyDesign → agent_jobs.meta 落库 → 回调侧 readComposeMeta 读回。漏了这一段,
  // 种子静默丢失、全平台内页配色回落成老三色表,而其余测试一条都不会红。
  assert.deepEqual(
    readComposeMeta({ compose: { ...META, interiorSeed: 'album-xyz' } }),
    { ...META, interiorSeed: 'album-xyz' },
  );
  // coverColorway 是真实账号那条路唯一会丢字段的跳(job.meta 落库为 JSON,回调侧靠
  // readComposeMeta 逐字段读回;占位书直接用内存对象,不经过这个函数)。META 本身不带
  // 这个字段(全文件其余用例都复用 META,加上会让它们意外都走深色渲染),所以只在这一
  // 条用例里局部构造,钉住「读回的 meta 里必须带着它」。
  assert.deepEqual(
    readComposeMeta({ compose: { ...META, coverColorway: 'teal' } }),
    { ...META, coverColorway: 'teal' },
  );
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
    // label 是 decoration 槽,派发时留空(coverTexts 只带 label: ''):不回落模板 sample。
    assert.equal((rows[0]!.page as { texts: Record<string, string> }).texts.label, undefined);
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

// ── 第三套(深色椭圆)配色透传 ────────────────────────────────────────────────

test('mergeComposeIntoDraft: meta 带 coverColorway 时内页走深色配色', () => {
  const { draftJson } = mergeComposeIntoDraft(
    draft(),
    { ...META, coverTemplateId: 'mag-62', coverColorway: 'teal' } as ComposeJobMeta,
    {},
  );
  // 页序 [封面, ...内页, 封尾]。这条 meta 没带 interiorSeed(模拟本次改动之前派发的
  // job),按老书处理 —— 第一张内页是老三色表的第 1 格。
  const first = legacyInteriorInkSequence(1)[0]!;
  assert.match(draftJson.pages[1]!.html!, new RegExp(`background-color:\\s*${first.bg}`, 'i'));
  // 封面/封尾直接吃 colorway 自己的 bg(THIRD_SET_COVERS 里 teal 是 #12363A,与内页
  // 五色表不共享任何一个值),这条才钉住「传进去的 id 真的被用了」。
  assert.match(draftJson.pages[0]!.html!, /background-color:\s*#12363A/i);
});

test('mergeComposeIntoDraft: meta 带 interiorSeed 时内页按它派色,并写进设计契约', () => {
  const build = (interiorSeed?: string) =>
    mergeComposeIntoDraft(
      draft(),
      { ...META, coverTemplateId: 'mag-62', coverColorway: 'teal', ...(interiorSeed ? { interiorSeed } : {}) } as ComposeJobMeta,
      {},
    ).draftJson;

  const seeded = build('album-zzz');
  assert.equal(seeded.design.interiorSeed, 'album-zzz', '种子必须留痕,否则追加页会重新随机');
  const expected = interiorInkSequence('album-zzz', 1)[0]!;
  assert.match(seeded.pages[1]!.html!, new RegExp(`background-color:\\s*${expected.bg}`, 'i'));

  // 换一本书(换种子)内页颜色跟着换 —— 种子没被用上的话这两条会相等。
  const other = build('album-yyy');
  const bgOf = (d: { pages: { html?: string }[] }) =>
    d.pages.slice(1, -1).map((p) => /background-color:\s*(#[0-9a-fA-F]{6})/i.exec(p.html!)?.[1]).join(',');
  assert.notEqual(bgOf(seeded), bgOf(other));
});

test('mergeComposeIntoDraft: 不带 coverColorway 时不写深色底(老书行为不变)', () => {
  const { draftJson } = mergeComposeIntoDraft(draft(), META, {});
  assert.doesNotMatch(draftJson.pages[1]!.html!, /#0E2A47/i);
});

// ── 封面标题的兜底链(评审 F5) ─────────────────────────────────────────────
// AI 写的 → 相册自己的标题(哪怕是系统默认名)→ 模板 sample。
// engine 的全局批次整个掉线时(compose.py 的 global_dropped 直接返回空结果),
// coverTexts 是空的回到 Web —— 兜底只有落在这一层才罩得住那条路径。

test('mergeComposeIntoDraft: AI 写出标题时用 AI 的(相册标题不抢跑)', () => {
  const { draftJson } = mergeComposeIntoDraft(
    draft(),
    META,
    { coverTexts: { title: 'AI 写的书名' } },
    '我的纪念册',
  );
  assert.equal(pageByTemplate(draftJson.pages, COVER_ID).texts.title, 'AI 写的书名');
});

test('mergeComposeIntoDraft: 全局批次掉线(coverTexts 全空)时落到相册标题,不印模板 sample', () => {
  // 系统默认名也照用 —— 它至少是这本书自己的名字,而 "DUE NORTH" 是模板作者的稿子。
  const dropped = mergeComposeIntoDraft(draft(), META, {}, '我的纪念册');
  assert.equal(pageByTemplate(dropped.draftJson.pages, COVER_ID).texts.title, '我的纪念册');
  // 模型把标题槽写成空串带回来(engine 对封面槽的既有口径)也走同一条兜底。
  const blank = mergeComposeIntoDraft(draft(), META, { coverTexts: { title: '   ' } }, '我的纪念册');
  assert.equal(pageByTemplate(blank.draftJson.pages, COVER_ID).texts.title, '我的纪念册');
});

test('mergeComposeIntoDraft: 连相册标题都没有才回落模板 sample', () => {
  const { draftJson } = mergeComposeIntoDraft(draft(), META, {}, '   ');
  assert.equal(pageByTemplate(draftJson.pages, COVER_ID).texts.title, 'DUE NORTH');
});

// task-16 裁决:占位书路径(placeholder-design.test.ts)改为保留全量 sample 回落,
// 真成稿路径(这个文件 = handleV3ComposeCompleted 的落地路径)必须原样不变 —— 这是
// 防止修 A(占位书)弄坏 B(真成稿)的闸门。mergeComposeIntoDraft 新增的 isPlaceholder
// 开关默认 false,真成稿调用点(job-service.handleV3ComposeCompleted)不传这个参数。
test('mergeComposeIntoDraft: isPlaceholder 缺省(真成稿路径)—— 封面/封尾非标题槽仍然空着', () => {
  const { draftJson } = mergeComposeIntoDraft(draft(), META, {});
  const cover = pageByTemplate(draftJson.pages, COVER_ID);
  // mag-01 的 label(decoration)/body(body)都带模板 sample,真成稿路径必须留空。
  assert.equal(cover.texts.label, undefined, '非 title 槽不该回落 sample(真成稿路径)');
  assert.equal(cover.texts.body, undefined, '非 title 槽不该回落 sample(真成稿路径)');
  const ending = pageByTemplate(draftJson.pages, ENDING_ID);
  assert.equal(ending.texts.body, undefined, '封尾非 title 槽同样不该回落 sample(真成稿路径)');
});

test('coverTextBase: 相册标题只兜第一个 title 槽,副标题槽不重复书名', async () => {
  const { coverTextBase } = await import('../album/design-apply');
  const base = coverTextBase('mag-23', '我的纪念册');
  assert.equal(base.title, '我的纪念册');
  assert.equal(base.title2, 'Record', '第二个 title 槽仍是模板 sample,不重复书名');
  // 不传标题 = 老行为一字不变。
  assert.equal(coverTextBase('mag-23').title, 'NORWAY');
});
