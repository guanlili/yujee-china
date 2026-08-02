import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATES } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { mergeAppendComposeTexts, readComposeAppendMeta } from './job-service';

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

const PAGES: Page[] = [
  { pageIndex: 0, templateId: interior.id, images: {}, texts: { [titleSlot]: 'OLD TITLE', [bodySlot]: 'OLD BODY' } },
  { pageIndex: 1, templateId: interior.id, images: {}, texts: { [titleSlot]: 'KEEP TITLE', [bodySlot]: 'KEEP BODY' } },
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
