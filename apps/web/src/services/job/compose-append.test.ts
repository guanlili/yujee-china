import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATES } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { db } from '../../db/client';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
import { albumMessageRepo } from '../../db/repos/album-message-repo';
import { albumRepo } from '../../db/repos/album-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import {
  filterAppendComposePagesTexts,
  jobService,
  mergeAppendComposeTexts,
  readComposeAppendMeta,
} from './job-service';

type TemplateInfo = { id: string; category?: string; texts?: Array<{ id: string; role: string }> };
const interior = (Object.values(TEMPLATES) as TemplateInfo[]).find(
  (t) =>
    t.category === 'interior' &&
    (t.texts ?? []).some((s) => s.role === 'title') &&
    (t.texts ?? []).some((s) => s.role === 'body'),
)!;
const titleSlot = interior.texts!.find((s) => s.role === 'title')!.id;
const bodySlot = interior.texts!.find((s) => s.role === 'body')!.id;

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

function pagedDraft(pages: Page[]) {
  return {
    version: 'v3-story' as const,
    tree: { chapters: [chapterNode('c1')] },
    pages,
    progress: { currentChapterId: null, doneChapterIds: ['c1'] },
  };
}

// images 分别挂 c1 / addx-c1 两章各自的照片(chapterNode 的 `${chapterId}-p`):F1 的章
// 归属守卫按 images 的 photoId 判归属,designedDraft() 的两章树据此让 page0=c1、page1=
// addx-c1,与用例注释「pageIndex 0 是老页,1 是追加页」一致。
const PAGES: Page[] = [
  { pageIndex: 0, templateId: interior.id, images: { image1: 'c1-p' }, texts: { [titleSlot]: 'OLD TITLE', [bodySlot]: 'OLD BODY' } },
  { pageIndex: 1, templateId: interior.id, images: { image1: 'addx-c1-p' }, texts: { [titleSlot]: 'KEEP TITLE', [bodySlot]: 'KEEP BODY' } },
];

test('readComposeAppendMeta: 只认 { composeAppend: { chapterIds: 非空 string[] } }', () => {
  assert.equal(readComposeAppendMeta(null), null);
  assert.equal(readComposeAppendMeta({ compose: { coverTemplateId: 'x', endingTemplateId: 'y' } }), null);
  assert.equal(readComposeAppendMeta({ composeAppend: { chapterIds: [] } }), null);
  assert.deepEqual(readComposeAppendMeta({ composeAppend: { language: 'zh', chapterIds: ['a1'] } }), {
    language: 'zh',
    chapterIds: ['a1'],
  });
});

// F1 防误写老页:章归属守卫是纯函数,与 mergeAppendComposeTexts 解耦单测。
test('filterAppendComposePagesTexts: 与 chapterIds 并集 photoId 无交集的 pageIndex 被剔除', () => {
  const draft = {
    version: 'v3-story' as const,
    tree: { chapters: [chapterNode('c1'), chapterNode('addx-c1')] },
    pages: [
      { pageIndex: 0, templateId: interior.id, images: { image: 'c1-p' }, texts: {} },
      { pageIndex: 1, templateId: interior.id, images: { image: 'addx-c1-p' }, texts: {} },
    ],
    progress: { currentChapterId: null, doneChapterIds: ['c1', 'addx-c1'] },
  };
  const { pagesTexts, skippedPageIndexes } = filterAppendComposePagesTexts(draft, ['addx-c1'], {
    '0': { [titleSlot]: '误写老页' },
    '1': { [titleSlot]: '正确目标页' },
  });
  assert.deepEqual(skippedPageIndexes, [0]);
  assert.deepEqual(Object.keys(pagesTexts ?? {}), ['1']);
});

test('filterAppendComposePagesTexts: pageIndex 在当前 draft 里已不存在(越界)也剔除', () => {
  const draft = {
    version: 'v3-story' as const,
    tree: { chapters: [chapterNode('addx-c1')] },
    pages: [{ pageIndex: 0, templateId: interior.id, images: { image: 'addx-c1-p' }, texts: {} }],
    progress: { currentChapterId: null, doneChapterIds: ['addx-c1'] },
  };
  const { pagesTexts, skippedPageIndexes } = filterAppendComposePagesTexts(draft, ['addx-c1'], {
    '5': { [titleSlot]: '越界' },
  });
  assert.deepEqual(skippedPageIndexes, [5]);
  assert.deepEqual(pagesTexts, {});
});

test('mergeAppendComposeTexts: 逐槽覆盖目标页并重烘 html,其余页原样', () => {
  const { draftJson, writtenPageIndexes } = mergeAppendComposeTexts(pagedDraft(PAGES), {
    '0': { [titleSlot]: '新标题', [bodySlot]: '新正文' },
  });
  const pages = (draftJson as { pages: Page[] }).pages;
  assert.deepEqual(writtenPageIndexes, [0]);
  assert.equal(pages[0]!.texts[titleSlot], '新标题');
  assert.ok(pages[0]!.html?.includes('新标题'));       // 目标页重烘
  assert.deepEqual(pages[1]!.texts, PAGES[1]!.texts);  // 没写的页原样
  assert.equal(pages[1]!.html, PAGES[1]!.html);        // 也不重烘
});

test('mergeAppendComposeTexts: 模型没写的槽保留原值(mergeSlotTexts 口径)', () => {
  const { draftJson } = mergeAppendComposeTexts(pagedDraft(PAGES), {
    '0': { [titleSlot]: '只写了标题' },
  });
  const pages = (draftJson as { pages: Page[] }).pages;
  assert.equal(pages[0]!.texts[bodySlot], 'OLD BODY');
});

test('mergeAppendComposeTexts: pagesTexts 空 → 页面原样,writtenPageIndexes 空', () => {
  const { draftJson, writtenPageIndexes } = mergeAppendComposeTexts(pagedDraft(PAGES), {});
  assert.deepEqual(writtenPageIndexes, []);
  assert.deepEqual((draftJson as { pages: Page[] }).pages, PAGES);
});

test('mergeAppendComposeTexts: 无页草稿直接抛(时序错了要诚实失败)', () => {
  assert.throws(() => mergeAppendComposeTexts({ version: 'v3-story', tree: { chapters: [chapterNode('c1')] }, pages: [], progress: { currentChapterId: null, doneChapterIds: [] } }, {}));
});

// ── handleV3ComposeCompleted: composeAppend 分支(DB 集成) ──────────────────
// 已设计的书(stage='ready')追加了 addx-c1 章、页已增量排版落地:pageIndex 0 是老页,
// 1 是追加页。回调只应合并 pagesTexts 指到的槽,stage/老页原样,回执诚实。
function designedDraft() {
  return {
    ...pagedDraft(PAGES),
    tree: { chapters: [chapterNode('c1'), chapterNode('addx-c1')] },
    progress: { currentChapterId: null, doneChapterIds: ['c1', 'addx-c1'] },
  };
}

test('handleV3ComposeCompleted: composeAppend 分支', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('append-compose-cb');
  try {
    await t.test('只写目标页,stage 与老页不动,assistant 回执落一条', async () => {
      const album = await makeAlbum(user.id);
      await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'ready', draftJson: designedDraft() });
      const requestId = crypto.randomUUID();
      await db.transaction(async (tx) => {
        const job = await jobService.createGenerationJob(tx, {
          userId: user.id,
          albumId: album.id,
          requestId,
          kind: 'compose',
          meta: { composeAppend: { language: 'zh', chapterIds: ['addx-c1'] } },
        });
        await jobService.markRunning(tx, job.id);
      });

      await jobService.handleV3ComposeCompleted(
        requestId,
        { pagesTexts: { '1': { [titleSlot]: '追加页新标题' } } },
        null,
      );

      const after = await albumRepo.findById(album.id);
      const pages = (after!.draftJson as { pages: Page[] }).pages;
      assert.equal(pages[1]!.texts[titleSlot], '追加页新标题');
      assert.ok(pages[1]!.html?.includes('追加页新标题'));
      assert.deepEqual(pages[0]!.texts, PAGES[0]!.texts); // 老页文案原样不动
      assert.equal(after!.stage, 'ready'); // 不动
      const job = await agentJobRepo.findByRequestId(requestId);
      assert.equal(job!.status, 'COMPLETED');
      // F2:真写了几页回填进 job.meta.composeAppend.writtenPages(供 listCoverSets 派生
      // lastComposeWrote)。
      assert.deepEqual(readComposeAppendMeta(job!.meta), {
        language: 'zh',
        chapterIds: ['addx-c1'],
        writtenPages: 1,
      });
      const messages = await albumMessageRepo.findByAlbum(album.id);
      assert.ok(messages.some((m) => m.role === 'assistant' && m.content.includes('新照片的文案写好了')));
    });

    await t.test('pagesTexts 全空(章全掉队):job 照常 COMPLETED,回执诚实,writtenPages=0', async () => {
      const album = await makeAlbum(user.id);
      await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'ready', draftJson: designedDraft() });
      const requestId = crypto.randomUUID();
      await db.transaction(async (tx) => {
        const job = await jobService.createGenerationJob(tx, {
          userId: user.id,
          albumId: album.id,
          requestId,
          kind: 'compose',
          meta: { composeAppend: { language: 'zh', chapterIds: ['addx-c1'] } },
        });
        await jobService.markRunning(tx, job.id);
      });
      await jobService.handleV3ComposeCompleted(requestId, { pagesTexts: {} }, null);
      const job = await agentJobRepo.findByRequestId(requestId);
      assert.equal(job!.status, 'COMPLETED');
      assert.equal(readComposeAppendMeta(job!.meta)?.writtenPages, 0);
      const messages = await albumMessageRepo.findByAlbum(album.id);
      assert.ok(messages.some((m) => m.role === 'assistant' && m.content.includes('没写出来')));
    });

    // F1 防误写老页:meta 范围仍是 addx-c1,但 engine 回调时那个 pageIndex 已经被
    // (画板 reorderPages / 设计 Agent move_pages 全书重排)挪成了 c1 的老页 —— 回调必须
    // 按**当前**页的照片归属重新核对,拒绝把追加章的文案写进这页,并诚实回执「没写出来」
    // (被守卫拦下的页不算「写了」,不能计入回执判断)。
    await t.test('章归属守卫:pageIndex 被重排后不再属于追加章 → 跳过不写,老页原样', async () => {
      const album = await makeAlbum(user.id);
      // 与 designedDraft() 相反:page0 现在是 addx-c1 的页,page1 被换回了 c1 的老页
      // (派发时 engine 记的是「pageIndex 1 = addx-c1」,回调落地前已经不成立)。
      const reordered = {
        version: 'v3-story' as const,
        tree: { chapters: [chapterNode('c1'), chapterNode('addx-c1')] },
        pages: [
          { pageIndex: 0, templateId: interior.id, images: { image1: 'addx-c1-p' }, texts: { [titleSlot]: 'NEW CHAPTER TITLE', [bodySlot]: 'NEW CHAPTER BODY' } },
          { pageIndex: 1, templateId: interior.id, images: { image1: 'c1-p' }, texts: { [titleSlot]: 'OLD CHAPTER TITLE', [bodySlot]: 'OLD CHAPTER BODY' } },
        ],
        progress: { currentChapterId: null, doneChapterIds: ['c1', 'addx-c1'] },
      };
      await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'ready', draftJson: reordered });
      const requestId = crypto.randomUUID();
      await db.transaction(async (tx) => {
        const job = await jobService.createGenerationJob(tx, {
          userId: user.id,
          albumId: album.id,
          requestId,
          kind: 'compose',
          meta: { composeAppend: { language: 'zh', chapterIds: ['addx-c1'] } },
        });
        await jobService.markRunning(tx, job.id);
      });

      // engine 仍按派发时的 pageIndex 回(以为 1 还是 addx-c1 的页)。
      await jobService.handleV3ComposeCompleted(
        requestId,
        { pagesTexts: { '1': { [titleSlot]: 'HIJACKED TITLE' } } },
        null,
      );

      const after = await albumRepo.findById(album.id);
      const pages = (after!.draftJson as { pages: Page[] }).pages;
      assert.equal(pages[1]!.texts[titleSlot], 'OLD CHAPTER TITLE'); // 没被劫持
      assert.equal(pages[1]!.html, undefined); // 未被守卫放行的页压根没进 touched 集,不重烘
      const job = await agentJobRepo.findByRequestId(requestId);
      assert.equal(job!.status, 'COMPLETED'); // 回调仍诚实完成(不是失败)
      assert.equal(readComposeAppendMeta(job!.meta)?.writtenPages, 0); // 被拦下的页不算「写了」
      const messages = await albumMessageRepo.findByAlbum(album.id);
      assert.ok(messages.some((m) => m.role === 'assistant' && m.content.includes('没写出来')));
    });
  } finally {
    await cleanupUser(user.id);
  }
});
