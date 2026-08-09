import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATES, THEME_FONT_CARRIER_SUFFIX } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { sweepCarriers } from '@/services/album/design-apply';
import {
  jobService,
  mergeAppendComposeTexts,
  mergeAppendLayoutPages,
  mergeComposeIntoDraft,
  readAppendChapterIds,
} from './job-service';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { db } from '@/db/client';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';

type TemplateInfo = { id: string; category?: string; texts?: Array<{ id: string; role: string }> };
const templates = Object.values(TEMPLATES) as TemplateInfo[];
const interior = templates.find(
  (t) =>
    t.category === 'interior' &&
    (t.texts ?? []).some((s) => s.role === 'title') &&
    (t.texts ?? []).some((s) => s.role === 'body'),
)!;
const ending = templates.find((t) => t.category === 'ending')!;

function page(pageIndex: number, templateId: string, texts: Record<string, string> = {}): Page {
  return { pageIndex, templateId, images: {}, texts };
}

function chapterNode(chapterId: string) {
  return {
    chapterId,
    description: '',
    chapterContext: '',
    accentColor: null,
    artFont: null,
    photos: [
      { photoId: `${chapterId}-p`, sceneDescription: '', width: 800, height: 600, orientation: 'landscape' as const },
    ],
  };
}

const FONTS = { title: 'Fraunces', body: 'Inter', decoration: 'Caveat' };
const COLORS = { title: '#111111', body: '#222222', explain: '#333333' };

function pagedDraft(opts: { designed: boolean }) {
  const interiorPages = [page(0, interior.id), page(1, interior.id)];
  const bookPages = opts.designed
    ? [...sweepCarriers(interiorPages, FONTS, COLORS), page(2, ending.id)]
    : interiorPages;
  return {
    version: 'v3-story' as const,
    tree: { chapters: [chapterNode('c1'), chapterNode('addx-c1')] },
    pages: bookPages,
    progress: { currentChapterId: 'addx-c1', doneChapterIds: ['c1'] },
  };
}

test('mergeAppendLayoutPages: 新页插封尾前 + 继承 carrier + 新章自动 done', () => {
  const draft = pagedDraft({ designed: true });
  const newPages = [page(0, interior.id, { marker: 'new' })];
  const merged = mergeAppendLayoutPages(draft, newPages, ['addx-c1']);

  // 插入位置:ending 前
  assert.equal(merged.pages.length, 4);
  assert.equal(merged.pages[2].texts.marker, 'new');
  assert.equal(merged.pages[3].templateId, ending.id);
  assert.deepEqual(merged.pages.map((p) => p.pageIndex), [0, 1, 2, 3]);

  // carrier 继承:新页 title 槽带上与旧书一致的字体
  const titleSlot = (interior.texts ?? []).find((s) => s.role === 'title')!;
  assert.equal(merged.pages[2].texts[`${titleSlot.id}${THEME_FONT_CARRIER_SUFFIX}`], FONTS.title);

  // 新章记 done,cursor 清空
  assert.deepEqual(merged.progress.doneChapterIds, ['c1', 'addx-c1']);
  assert.equal(merged.progress.currentChapterId, null);
});

test('mergeAppendLayoutPages: 未设计过的书,新页不带 carrier', () => {
  const draft = pagedDraft({ designed: false });
  const merged = mergeAppendLayoutPages(draft, [page(0, interior.id, { marker: 'new' })], ['addx-c1']);
  const newPage = merged.pages.find((p) => p.texts.marker === 'new')!;
  assert.equal(
    Object.keys(newPage.texts).some((k) => k.includes('#')),
    false,
  );
});

test('mergeAppendLayoutPages: 无既有 pages 直接抛', () => {
  const draft = {
    version: 'v3-story' as const,
    tree: { chapters: [chapterNode('c1')] },
    progress: { currentChapterId: 'c1', doneChapterIds: [] },
  };
  assert.throws(
    () => mergeAppendLayoutPages(draft, [page(0, interior.id)], ['c1']),
    (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
  );
});

// ───────────── 加照片进「第三套(深色)」的书(评审 F1) ─────────────
// 真实场景走一遍:先按第三套成书(mergeComposeIntoDraft 是真成稿回调用的那个纯函数),
// 再往这本书里追加一页(mergeAppendLayoutPages),最后追加成稿把文案写进去
// (mergeAppendComposeTexts,追加链路的下一步,它会重烘同一批页)。
//
// 修之前:新页拿的是 extractDesignFromPages 从**封面**反提取的浅字色,页根却是
// 重烘出来的模板默认白 —— 正文 #E8E5DC 压白底 1.09:1,整页看着像没印上。

function composedThirdSetBook(colorwayId = 'teal') {
  const composed = mergeComposeIntoDraft(
    pagedDraft({ designed: false }),
    {
      language: 'zh',
      coverTemplateId: 'mag-62',
      coverPhotoId: 'c1-p',
      endingTemplateId: ending.id,
      endingPhotoId: 'addx-c1-p',
      extraEndingPhotoIds: [],
      pageBackground: '#F1F2F0',
      coverColorway: colorwayId,
    },
    {},
  );
  return composed.draftJson;
}

test('第三套成稿把配色 id 写进 draft 的设计契约(追加路径唯一能知道这是深色书的凭据)', () => {
  const draftJson = composedThirdSetBook();
  assert.equal(draftJson.design.coverColorway, 'teal');
  // 契约是可选的:不带配色的老书照旧不写这个键,解析和行为都不变。
  const plain = mergeComposeIntoDraft(
    pagedDraft({ designed: false }),
    {
      language: 'zh',
      coverTemplateId: 'mag-01',
      coverPhotoId: 'c1-p',
      endingTemplateId: ending.id,
      endingPhotoId: 'addx-c1-p',
      extraEndingPhotoIds: [],
      pageBackground: '#FBF8F1',
    },
    {},
  );
  assert.equal(plain.draftJson.design.coverColorway, undefined);
  // 脏 id 不进契约(coverColorwayById 认不出就当没有)。
  const junk = composedThirdSetBook('not-a-colorway');
  assert.equal(junk.design.coverColorway, undefined);
});

test('mergeAppendLayoutPages: 深色书的新页跟全书同一套深色,不是封面浅字压白底', () => {
  const draftJson = composedThirdSetBook();
  // 成书页序:[封面(mag-62), 内页 ×2, 封尾];新页插在封尾前 = 第 3 张内页,
  // 按 THIRD_SET_INTERIOR 轮换应当拿到第三组 ink-lime(#14140F / #D4FF3F)。
  const merged = mergeAppendLayoutPages(draftJson, [page(0, interior.id, { marker: 'new' })], ['addx-c1']);
  const fresh = merged.pages.find((p) => p.texts.marker === 'new')!;
  const titleSlot = (interior.texts ?? []).find((s) => s.role === 'title')!;
  const bodySlot = (interior.texts ?? []).find((s) => s.role === 'body')!;

  assert.match(fresh.html!, /background-color:\s*#14140F/i, '页根刷这一格的深底');
  assert.match(fresh.html!, /color:\s*#E8E5DC/i, '页根字色翻浅(静态装饰不至于黑压黑)');
  assert.equal(fresh.texts[`${titleSlot.id}#accentColor`], '#D4FF3F', '标题走这一格的亮字');
  assert.equal(fresh.texts[`${bodySlot.id}#accentColor`], '#E8E5DC');
  // 反提取到的封面色(粉标题)绝不能落到内页上 —— 这正是评审量到 1.09:1 的那条路。
  assert.notEqual(fresh.texts[`${titleSlot.id}#accentColor`], '#F0A4C2');
  assert.doesNotMatch(fresh.html!, /#F0A4C2/i);
  // 老页一个字节不动(carrier 与页根都保持成书时的样子)。
  assert.match(merged.pages[1]!.html!, /background-color:\s*#0E2A47/i);
  assert.match(merged.pages[2]!.html!, /background-color:\s*#12363A/i);
});

test('mergeAppendComposeTexts: 追加成稿重烘后,深色不被洗回白底', () => {
  const draftJson = composedThirdSetBook();
  const merged = mergeAppendLayoutPages(draftJson, [page(0, interior.id, { marker: 'new' })], ['addx-c1']);
  const freshIndex = merged.pages.find((p) => p.texts.marker === 'new')!.pageIndex;
  const titleSlot = (interior.texts ?? []).find((s) => s.role === 'title')!;
  const after = mergeAppendComposeTexts(merged, { [String(freshIndex)]: { [titleSlot.id]: '新章标题' } });
  const rebaked = (after.draftJson.pages as Page[])[freshIndex]!;
  assert.match(rebaked.html!, /新章标题/);
  assert.match(rebaked.html!, /background-color:\s*#14140F/i, '重烘后仍是深底');
  assert.match(rebaked.html!, /color:\s*#E8E5DC/i);
});

test('非深色书:追加页刷这本书的书页底色(重烘不该把新页留成模板默认白)', () => {
  const composed = mergeComposeIntoDraft(
    pagedDraft({ designed: false }),
    {
      language: 'zh',
      coverTemplateId: 'mag-01',
      coverPhotoId: 'c1-p',
      endingTemplateId: ending.id,
      endingPhotoId: 'addx-c1-p',
      extraEndingPhotoIds: [],
      pageBackground: '#FBF8F1',
    },
    {},
  );
  const merged = mergeAppendLayoutPages(composed.draftJson, [page(0, interior.id, { marker: 'new' })], ['addx-c1']);
  const fresh = merged.pages.find((p) => p.texts.marker === 'new')!;
  assert.match(fresh.html!, /background-color:\s*#FBF8F1/i);
  assert.doesNotMatch(fresh.html!, /#0E2A47/i, '没有配色的书不许染上深色');
});

test('readAppendChapterIds: 合法 meta 返回 ids,其余 null', () => {
  assert.deepEqual(readAppendChapterIds({ appendChapterIds: ['a', 'b'] }), ['a', 'b']);
  assert.equal(readAppendChapterIds(null), null);
  assert.equal(readAppendChapterIds({}), null);
  assert.equal(readAppendChapterIds({ appendChapterIds: [] }), null);
  assert.equal(readAppendChapterIds({ appendChapterIds: [1] }), null);
});

// ───────────── draft_pages 拆表(Phase 1a,Task 5)DB 级回归 ─────────────
// job 回调三写点加 album 行锁 + 切行级写(docs/plans/2026-08-03-draft-pages-split.md)。
// 这两条覆盖「加照片」场景下最容易踩的两个坑:analyze 的树合并分支必须只碰
// envelope、完全不动已落库的 draft_pages 行/revision;select-layout 的追加合并分支
// 必须能只从 draft_pages 行(不再依赖 draftJson.pages)取到既有页 —— 老代码在
// draftJson.pages 已经清空后会直接抛「requires an existing paged draft」。

test('handleV3AnalyzeCompleted(append): 只重写 envelope,draft_pages 行与 revision 完全不动', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('append-analyze-rows');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'ready',
      draftJson: {
        version: 'v3-story',
        tree: { chapters: [chapterNode('c1')] },
        progress: { currentChapterId: null, doneChapterIds: ['c1'] },
      },
    });
    const existingPages = [page(0, interior.id), page(1, ending.id)];
    await db.transaction(async (tx) => {
      await draftPageRepo.replaceAll(tx, album.id, existingPages, 3, user.id);
      await albumRepo.update(tx, album.id, { draftRevision: 3, pageCount: existingPages.length });
    });

    const requestId = `append-analyze-rows-${Date.now()}`;
    await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId,
      kind: 'add',
      status: 'RUNNING',
      progress: 0,
    });

    // 故意与既有章节撞号,顺带验证重映射仍然工作。
    const newTree = { chapters: [chapterNode('c1')] };
    await jobService.handleV3AnalyzeCompleted(requestId, newTree, { durationMs: 1, models: {} });

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.draftRevision, 3, 'append 分支不碰 pages,revision 绝不推进');
    assert.equal(reloaded?.pageCount, 2, 'pageCount 同理不动');
    const draft = reloaded?.draftJson as {
      pages?: unknown;
      tree: { chapters: Array<{ chapterId: string }> };
      progress: { currentChapterId: string | null; doneChapterIds: string[] };
    };
    assert.equal(draft.pages, undefined, 'envelope-only 重写:draftJson 不带 pages 键');
    assert.equal(draft.tree.chapters.length, 2, '新章追尾合并');
    assert.equal(draft.tree.chapters[0]!.chapterId, 'c1', '老章原样');
    assert.notEqual(draft.tree.chapters[1]!.chapterId, 'c1', '撞号新章被重映射');
    assert.equal(draft.progress.currentChapterId, draft.tree.chapters[1]!.chapterId, 'cursor 指新章');
    assert.deepEqual(draft.progress.doneChapterIds, ['c1']);

    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 2, 'append 分支绝不改 draft_pages 行数');
    assert.deepEqual(rows.map((r) => r.page), existingPages, '页内容逐字节不动');
    for (const row of rows) {
      assert.equal(row.version, 3, '行 version 不被这次写入推进');
      assert.equal(row.updatedBy, user.id, 'updatedBy 不被系统写点覆盖');
    }

    const doneJob = await agentJobRepo.findByRequestId(requestId);
    assert.equal(doneJob?.status, 'COMPLETED');
  } finally {
    await cleanupUser(user.id);
  }
});

// 2026-08-03 controller follow-up:上面那条用例把页种在 draft_pages 行里,从没
// 覆盖过「相册的页此刻还只活在 legacy draftJson.pages、draft_pages 还没有一行」
// 这个更早期的存量状态(analyze→select-layout 都还没经过任何行级写点触碰过,
// 拆表前的老书,或者刚上线拆表当天还没被 updatePage/reorderPages/select-layout/
// compose 摸过的书)。append 分支若不先 ensureDraftPagesSeeded 就用 envelope-only
// 覆盖 draftJson,会把这份唯一的 pages 副本连根拔掉 —— 静默丢一整本书的页(严重
// 数据丢失,generation-service.test.ts 的『submitAddPhotosV3 hold 积分…』用例
// 用的就是这个未播种的老式 fixture,间接踩中了这个洞)。
test('handleV3AnalyzeCompleted(append): legacy 相册(draft_pages 尚无行)首次追加自动播种,pages 不丢', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('append-analyze-legacy-seed');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });
    const legacyPages = [page(0, interior.id), page(1, ending.id)];
    // legacy 存量形态:pages 直接躺在 draftJson 里,draft_pages 一行都没有 ——
    // 与 draftPageRepo.replaceAll 播种过的上一条用例刻意不同。
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'ready',
      draftJson: {
        version: 'v3-story',
        tree: { chapters: [chapterNode('c1')] },
        pages: legacyPages,
        progress: { currentChapterId: null, doneChapterIds: ['c1'] },
      },
    });
    assert.equal(await draftPageRepo.countByAlbum(album.id), 0, 'sanity: 播种前确实没有行');

    const requestId = `append-analyze-legacy-seed-${Date.now()}`;
    await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId,
      kind: 'add',
      status: 'RUNNING',
      progress: 0,
    });

    await jobService.handleV3AnalyzeCompleted(
      requestId,
      { chapters: [chapterNode('addx-c1')] },
      { durationMs: 1, models: {} },
    );

    const reloaded = await albumRepo.findById(album.id);
    const draft = reloaded?.draftJson as { pages?: unknown } | undefined;
    assert.equal(draft?.pages, undefined, 'envelope-only 重写:draftJson 不带 pages 键');

    // 页没有被 envelope-only 重写连带抹掉 —— 懒播种把它们原样搬进了 draft_pages 行。
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 2, '两页都没丢');
    assert.deepEqual(rows.map((r) => r.page), legacyPages, '内容逐字节不变(播种不烘 html)');
    assert.equal(reloaded?.draftRevision, 1, '首次播种把 revision 从 0 立到 1(与 T3/T4 懒播种同口径)');
    for (const row of rows) {
      assert.equal(row.version, 1);
      assert.equal(row.updatedBy, null, '播种是系统动作,不是这次追加的用户写入');
    }
  } finally {
    await cleanupUser(user.id);
  }
});

test('handleV3SelectLayoutCompleted(append): 既有页源切到 draft_pages 行,不再依赖 draftJson.pages', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('append-layout-rows');
  try {
    const album = await makeAlbum(user.id, { photoCount: 3 });
    // 老书:draftJson 的 tree/progress 完整,但刻意不带 pages 键 —— 证明
    // mergeAppendLayoutPages 吃的「既有页」现在只来自 draft_pages 行,不再要求
    // draftJson.pages 里还有一份副本(拆表前两者同源,拆表后 pages 只活在行里)。
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'ready',
      draftJson: {
        version: 'v3-story',
        tree: { chapters: [chapterNode('c1'), chapterNode('addx-c1')] },
        progress: { currentChapterId: 'addx-c1', doneChapterIds: ['c1'] },
      },
    });
    const existingPages = [page(0, interior.id), page(1, ending.id)];
    await db.transaction(async (tx) => {
      await draftPageRepo.replaceAll(tx, album.id, existingPages, 2, user.id);
      await albumRepo.update(tx, album.id, { draftRevision: 2, pageCount: existingPages.length });
    });

    const requestId = `append-layout-rows-${Date.now()}`;
    await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId,
      kind: 'layout',
      status: 'RUNNING',
      progress: 0,
      meta: { appendChapterIds: ['addx-c1'] },
    });

    const newPages = [page(0, interior.id, { marker: 'new' })];
    await jobService.handleV3SelectLayoutCompleted(requestId, newPages, { durationMs: 1, models: {} });

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.pageCount, 3, '插入一页:2 → 3(pageCount 收口点二)');
    assert.equal(reloaded?.draftRevision, 3, 'seed 无操作(行已存在)后仅推进一次');
    const draft = reloaded?.draftJson as {
      pages?: unknown;
      progress: { currentChapterId: string | null; doneChapterIds: string[] };
    };
    assert.equal(draft.pages, undefined, 'envelope-only 重写:draftJson 不带 pages 键');
    assert.deepEqual(draft.progress.doneChapterIds, ['c1', 'addx-c1']);
    assert.equal(draft.progress.currentChapterId, null);

    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.pageIndex),
      [0, 1, 2],
    );
    assert.equal(rows[1]!.page.texts.marker, 'new', '新页插在封尾前');
    assert.equal(rows[2]!.page.templateId, ending.id, '封尾仍在最后');
    for (const row of rows) {
      assert.equal(row.version, 3, '整批(老页 + 新页)推到同一个新 revision');
      assert.equal(row.updatedBy, null, 'select-layout 是系统/agent 写点');
    }

    const doneJob = await agentJobRepo.findByRequestId(requestId);
    assert.equal(doneJob?.status, 'COMPLETED');
  } finally {
    await cleanupUser(user.id);
  }
});
