// mobile-canvas.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDeviceMode, cycleDensity, pageWindow, clampStart, canvasVisibleHeight, panelSpec, arbitrateGesture, initMobileCanvas } from './mobile-canvas';

test('resolveDeviceMode: 767 及以下是 mobile,768 及以上是 desktop（与 max-width:767px 等价）', () => {
  assert.equal(resolveDeviceMode(767), 'mobile');
  assert.equal(resolveDeviceMode(320), 'mobile');
  assert.equal(resolveDeviceMode(768), 'desktop');
  assert.equal(resolveDeviceMode(1200), 'desktop');
});

test('cycleDensity: 1→2→4→1 循环', () => {
  assert.equal(cycleDensity(1), 2);
  assert.equal(cycleDensity(2), 4);
  assert.equal(cycleDensity(4), 1);
});

test('pageWindow: 返回当前屏页 index,末屏不足短返回', () => {
  assert.deepEqual(pageWindow(0, 2, 10), [0, 1]);
  assert.deepEqual(pageWindow(4, 4, 10), [4, 5, 6, 7]);
  assert.deepEqual(pageWindow(8, 4, 10), [8, 9]); // 末屏只剩两页,不补越界
  assert.deepEqual(pageWindow(9, 1, 10), [9]);
  assert.deepEqual(pageWindow(-2, 2, 10), []); // 负 index 被守卫跳过,结果为空数组
});

test('clampStart: 对齐 density 边界并夹紧,换档后仍在原页所在屏', () => {
  assert.equal(clampStart(5, 2, 10), 4); // 第5页在 2 档下属于 [4,5] 屏,start=4
  assert.equal(clampStart(5, 4, 10), 4); // 4 档下属于 [4..7] 屏,start=4
  assert.equal(clampStart(9, 4, 10), 8); // 末屏起点
  assert.equal(clampStart(-3, 2, 10), 0);
  assert.equal(clampStart(100, 2, 10), 8);
});

test('canvasVisibleHeight: 屏高减去顶栏/位置条/dock,不为负', () => {
  assert.equal(canvasVisibleHeight(800, 46, 38, 0), 716);
  assert.equal(canvasVisibleHeight(800, 46, 38, 500), 216);
  assert.equal(canvasVisibleHeight(400, 46, 38, 500), 0); // 夹到 0,不为负
});

test('panelSpec: 编辑类固定2/3不可拖,对话2/3可拖,删除居中dialog', () => {
  const edit = panelSpec('edit', 900);
  assert.equal(edit.form, 'sheet');
  assert.equal(edit.heightPx, 600); // 2/3 of 900
  assert.equal(edit.resizable, false);

  const chat = panelSpec('chat', 900);
  assert.equal(chat.form, 'sheet');
  assert.equal(chat.heightPx, 600);
  assert.equal(chat.resizable, true);

  const del = panelSpec('delete', 900);
  assert.equal(del.form, 'dialog');
  assert.equal(del.heightPx, null);
  assert.equal(del.resizable, false);
});

test('arbitrateGesture: 浏览态双指=密度,单指横滑=翻屏,竖滑不响应', () => {
  assert.equal(arbitrateGesture({ state: 'browse', pointers: 2, axis: null, onSelectedImage: false }), 'density');
  assert.equal(arbitrateGesture({ state: 'browse', pointers: 1, axis: 'x', onSelectedImage: false }), 'page-nav');
  assert.equal(arbitrateGesture({ state: 'browse', pointers: 1, axis: 'y', onSelectedImage: false }), 'none');
});

test('arbitrateGesture: 编辑态双指=缩放,横滑=翻页,竖滑=滚页', () => {
  assert.equal(arbitrateGesture({ state: 'edit', pointers: 2, axis: null, onSelectedImage: false }), 'zoom');
  assert.equal(arbitrateGesture({ state: 'edit', pointers: 1, axis: 'x', onSelectedImage: false }), 'page-nav');
  assert.equal(arbitrateGesture({ state: 'edit', pointers: 1, axis: 'y', onSelectedImage: false }), 'scroll-page');
});

test('arbitrateGesture: 编辑态拖只在已选中图上=改构图,否则不抢画布', () => {
  assert.equal(arbitrateGesture({ state: 'edit', pointers: 1, axis: 'y', onSelectedImage: true }), 'pan-image');
  assert.equal(arbitrateGesture({ state: 'edit', pointers: 1, axis: 'x', onSelectedImage: true }), 'pan-image');
});

test('initMobileCanvas: 返回可调用的 teardown;桌面宽度不建态机', () => {
  const listeners: Array<[string, unknown]> = [];
  const fakeRoot = {
    addEventListener: (t: string, f: unknown) => listeners.push([t, f]),
    removeEventListener: () => {},
    querySelector: () => null,
  } as unknown as HTMLElement;
  const { teardown, refreshChapters } = initMobileCanvas({
    root: fakeRoot,
    getWidth: () => 1200, // 桌面
    enterEdit: () => {},
    exitEdit: () => {},
    openBoardBg: () => {},
    totalPages: () => 0,
    renderGrid: () => {},
    openPageBg: () => {},
    openChat: () => {},
    isEditingPhase: () => false,
    chapters: () => [],
    spreadOfPage: () => 0,
  });
  assert.equal(typeof teardown, 'function');
  assert.equal(typeof refreshChapters, 'function');
  teardown(); // 不抛
  refreshChapters(); // 桌面态是安全 no-op,不抛(#304 Important fix2)
});
