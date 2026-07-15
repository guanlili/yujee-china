import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATES, THEME_ACCENT_CARRIER_SUFFIX, THEME_FONT_CARRIER_SUFFIX } from '@yujee/contracts';
import type { Page, V3StoryDraft } from '@yujee/contracts';
import { sweepCarriers } from './design-apply';
import {
  countTreePhotos,
  extractDesignFromPages,
  insertAppendPages,
  mergeAppendTree,
  remapAppendChapterIds,
} from './append-photos';

type TemplateInfo = { id: string; category?: string; texts?: Array<{ id: string; role: string }> };
const templates = Object.values(TEMPLATES) as TemplateInfo[];

// 用真实模板注册表挑 fixture,避免硬编码模板 id 过期。
const interiorWithText = templates.find(
  (t) =>
    t.category === 'interior' &&
    (t.texts ?? []).some((s) => s.role === 'title') &&
    (t.texts ?? []).some((s) => s.role === 'body'),
)!;
const endingTemplate = templates.find((t) => t.category === 'ending')!;

function page(pageIndex: number, templateId: string, texts: Record<string, string> = {}): Page {
  return { pageIndex, templateId, images: {}, texts };
}

function chapter(chapterId: string, photoCount = 1) {
  return {
    chapterId,
    description: '',
    chapterContext: '',
    place: '',
    accentColor: null,
    artFont: null,
    photos: Array.from({ length: photoCount }, (_, i) => ({
      photoId: `${chapterId}-p${i}`,
      sceneDescription: '',
      width: 800,
      height: 600,
      orientation: 'landscape' as const,
    })),
  };
}

function draft(chapters: ReturnType<typeof chapter>[], opts: {
  pages?: Page[];
  currentChapterId?: string | null;
  doneChapterIds?: string[];
} = {}): V3StoryDraft {
  return {
    version: 'v3-story',
    tree: { chapters },
    ...(opts.pages ? { pages: opts.pages } : {}),
    progress: {
      currentChapterId: opts.currentChapterId ?? null,
      doneChapterIds: opts.doneChapterIds ?? [],
    },
  };
}

test('remapAppendChapterIds: 加 tag 前缀;撞号继续叠 x', () => {
  const existing = new Set(['ch-1', 'addf00d-ch-1']);
  const out = remapAppendChapterIds([{ chapterId: 'ch-1' }, { chapterId: 'ch-2' }], existing, 'addf00d');
  assert.equal(out[0].chapterId, 'xaddf00d-ch-1'); // addf00d-ch-1 已被占
  assert.equal(out[1].chapterId, 'addf00d-ch-2');
});

test('remapAppendChapterIds: 同批内部也不互撞', () => {
  const out = remapAppendChapterIds(
    [{ chapterId: 'a' }, { chapterId: 'a' }],
    new Set<string>(),
    't',
  );
  assert.notEqual(out[0].chapterId, out[1].chapterId);
});

test('mergeAppendTree: 章节追尾;老章全完成时 cursor 指向第一个新章', () => {
  const d = draft([chapter('c1')], { currentChapterId: null, doneChapterIds: ['c1'], pages: [page(0, interiorWithText.id)] });
  const merged = mergeAppendTree(d, [chapter('add1-c1'), chapter('add1-c2')]);
  assert.deepEqual(merged.tree.chapters.map((c) => c.chapterId), ['c1', 'add1-c1', 'add1-c2']);
  assert.equal(merged.progress.currentChapterId, 'add1-c1');
  assert.deepEqual(merged.progress.doneChapterIds, ['c1']); // 不动
  assert.equal(merged.pages?.length, 1); // 原页保留
});

test('mergeAppendTree: 老章采访中(cursor 有值)不被打断', () => {
  const d = draft([chapter('c1'), chapter('c2')], { currentChapterId: 'c2', doneChapterIds: ['c1'] });
  const merged = mergeAppendTree(d, [chapter('add1-c1')]);
  assert.equal(merged.progress.currentChapterId, 'c2');
});

test('insertAppendPages: 新页插在封尾页之前,pageIndex 连续', () => {
  const existing = [page(0, interiorWithText.id), page(1, interiorWithText.id), page(2, endingTemplate.id)];
  const merged = insertAppendPages(existing, [page(0, interiorWithText.id, { marker: 'new' })]);
  assert.equal(merged.length, 4);
  assert.equal(merged[2].texts.marker, 'new'); // 插在 ending 前
  assert.equal(merged[3].templateId, endingTemplate.id); // ending 仍是最后一页
  assert.deepEqual(merged.map((p) => p.pageIndex), [0, 1, 2, 3]);
});

test('insertAppendPages: 无封尾页则追尾', () => {
  const existing = [page(0, interiorWithText.id)];
  const merged = insertAppendPages(existing, [page(0, interiorWithText.id, { marker: 'new' })]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].texts.marker, 'new');
});

test('extractDesignFromPages: 从 carrier 反解出三键,可与 sweepCarriers 往返', () => {
  const fonts = { title: 'Fraunces', body: 'Inter', decoration: 'Caveat' };
  const colors = { title: '#111111', body: '#222222', explain: '#333333' };
  const swept = sweepCarriers([page(0, interiorWithText.id)], fonts, colors);
  const extracted = extractDesignFromPages(swept);
  assert.ok(extracted);
  assert.equal(extracted.fonts.title, fonts.title);
  assert.equal(extracted.fonts.body, fonts.body);
  assert.equal(extracted.colors.title, colors.title);
  assert.equal(extracted.colors.body, colors.body);
  // 往返:用反解结果 sweep 新页,title 槽的 carrier 与原书一致
  const titleSlot = (interiorWithText.texts ?? []).find((s) => s.role === 'title')!;
  const newSwept = sweepCarriers([page(0, interiorWithText.id)], extracted.fonts, extracted.colors);
  assert.equal(
    newSwept[0].texts[`${titleSlot.id}${THEME_FONT_CARRIER_SUFFIX}`],
    swept[0].texts[`${titleSlot.id}${THEME_FONT_CARRIER_SUFFIX}`],
  );
  assert.equal(
    newSwept[0].texts[`${titleSlot.id}${THEME_ACCENT_CARRIER_SUFFIX}`],
    swept[0].texts[`${titleSlot.id}${THEME_ACCENT_CARRIER_SUFFIX}`],
  );
});

test('extractDesignFromPages: 无任何 carrier → null(设计未做过)', () => {
  assert.equal(extractDesignFromPages([page(0, interiorWithText.id, { headline: 'hi' })]), null);
});

test('countTreePhotos: 各章 photos 求和', () => {
  assert.equal(countTreePhotos([chapter('a', 2), chapter('b', 3)]), 5);
});
