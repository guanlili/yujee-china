import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createChatCoordinator, type MobileChatDeps } from './use-chat-coordinator';
import type { EditorPage } from '../../types';
import type { DraftSkeleton } from '@/lib/album/authoring-client';

/* ════════════════════════════════════════════════════════════════════════════
   移动协调器的行为单测(纯构造器,不挂 React)。

   ChatPanel 挂进移动树后,它对画板的全部感知都经过这层 —— 这里错一个,症状是
   「对话在骗人」:发消息被劝退去等排版(getPagesState 空)、挪页后改字打错页
   (replacePages 没重编号)、章节卡跳错章(goToChapterById 映射错)。
   ════════════════════════════════════════════════════════════════════════════ */

const page = (i: number, images: Record<string, string> = {}): EditorPage => ({
  pageIndex: i,
  templateId: `tpl-${i}`,
  imagesJson: images,
  textsJson: {},
});

function makeDeps(over: Partial<MobileChatDeps> = {}) {
  const calls = { replaced: [] as EditorPage[][], went: [] as number[], locked: [] as boolean[] };
  const deps: MobileChatDeps = {
    pages: [page(0), page(1)],
    editPage: null,
    draftChapters: null,
    resolve: (id) => (id === 'p1' ? 'blob:p1' : undefined),
    replacePages: (p) => calls.replaced.push(p),
    goToPage: (i) => calls.went.push(i),
    setExportGateLocked: (v) => calls.locked.push(v),
    exportPdf: async () => {},
    ...over,
  };
  return { deps, calls };
}

test('getPagesState / imageUrl 每次调用取最新 deps(不缓存挂载时那份)', () => {
  const state = makeDeps();
  const co = createChatCoordinator(() => state.deps);
  assert.equal(co.getPagesState().length, 2);
  state.deps = { ...state.deps, pages: [page(0), page(1), page(2)] };
  assert.equal(co.getPagesState().length, 3, '换书后 ChatPanel 必须立刻看到新页数');
  assert.equal(co.imageUrl('p1'), 'blob:p1');
  assert.equal(co.imageUrl('nope'), undefined);
});

test('replacePages 按数组位置重编号,不信来料 pageIndex(挪页错乱的边界防御)', () => {
  const { deps, calls } = makeDeps();
  const co = createChatCoordinator(() => deps);
  // design-agent 挪页只动数组序:来料的 pageIndex 字段还是旧的
  const shuffled = [
    { ...page(2), htmlJson: '<div/>' },
    page(0),
  ];
  assert.equal(co.replacePages(shuffled), true);
  const applied = calls.replaced[0]!;
  assert.deepEqual(applied.map((p) => p.pageIndex), [0, 1]);
  assert.equal(applied[0]!.templateId, 'tpl-2', '顺序保持来料数组序');
  assert.equal(applied[0]!.htmlJson, '<div/>', '页面真相 html 必须带过去,丢了就是改动不可见');
  assert.notEqual(applied[1]!.imagesJson, shuffled[1]!.imagesJson, '要深拷贝,不共享引用');
});

test('replacePages 空数组 = 没应用(返回 false,ChatPanel 走整刷回退)', () => {
  const { deps, calls } = makeDeps();
  const co = createChatCoordinator(() => deps);
  assert.equal(co.replacePages([]), false);
  assert.equal(calls.replaced.length, 0);
});

test('goToChapterById:骨架里这一章的第一页;查不到就不动(不许跳去第 0 页)', () => {
  const skeleton = {
    chapters: [],
    pages: [
      { pageIndex: 0, kind: 'cover', chapterId: null },
      { pageIndex: 1, kind: 'content', chapterId: 'ch-a' },
      { pageIndex: 2, kind: 'content', chapterId: 'ch-b' },
    ],
  } as unknown as DraftSkeleton;
  const { deps, calls } = makeDeps({ draftChapters: skeleton });
  const co = createChatCoordinator(() => deps);
  co.goToChapterById('ch-b');
  assert.deepEqual(calls.went, [2]);
  co.goToChapterById('ch-missing');
  assert.deepEqual(calls.went, [2], '未知章不跳 —— 跳去第 0 页会把用户甩到封面');
});

test('authoringFocusPageIndex:编辑焦点在哪就是哪;浏览态回落第 0 页', () => {
  const { deps } = makeDeps({ editPage: 5 });
  assert.equal(createChatCoordinator(() => deps).authoringFocusPageIndex(), 5);
  const browse = makeDeps({ editPage: null });
  assert.equal(createChatCoordinator(() => browse.deps).authoringFocusPageIndex(), 0);
});

test('bookPhotoIds:页序去重(与桌面同口径)', () => {
  const { deps } = makeDeps({
    pages: [page(0, { a: 'p2', b: 'p1' }), page(1, { a: 'p1', b: '' })],
  });
  assert.deepEqual(createChatCoordinator(() => deps).bookPhotoIds(), ['p2', 'p1']);
});

test('setExportGateUi 直通移动树的导出闸门状态', () => {
  const { deps, calls } = makeDeps();
  const co = createChatCoordinator(() => deps);
  co.setExportGateUi(true);
  co.setExportGateUi(false);
  assert.deepEqual(calls.locked, [true, false]);
});

test('draft-edit 遗留接口按「诚实降级」:写类说没应用,截图必须炸而不是静默', async () => {
  const { deps } = makeDeps();
  const co = createChatCoordinator(() => deps);
  assert.equal(co.applyAuthoringPatch([{ pageIndex: 0 } as never]), false);
  assert.deepEqual(co.applyDraftAct({} as never), {});
  await assert.rejects(co.capturePageRender(0), /not wired/, '谁复活旧链路谁第一时间看见');
});
