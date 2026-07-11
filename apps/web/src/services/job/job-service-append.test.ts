import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATES, THEME_FONT_CARRIER_SUFFIX } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { sweepCarriers } from '@/services/album/design-apply';
import { mergeAppendLayoutPages, readAppendChapterIds } from './job-service';

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
