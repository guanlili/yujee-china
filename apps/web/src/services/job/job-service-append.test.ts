import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATES, THEME_FONT_CARRIER_SUFFIX } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { sweepCarriers } from '@/services/album/design-apply';
import { jobService, mergeAppendLayoutPages, readAppendChapterIds } from './job-service';
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
