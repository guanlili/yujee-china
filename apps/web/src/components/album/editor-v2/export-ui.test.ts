// export-ui / export-state 的单测。
// 这一簇从 5,700 行的 EditorBook 里搬出来,换来的就是这些以前测不到的行为:
// 门闩三件套、版式弹窗重置、进度条百分比。以前只能靠挂载整个编辑器 + 点按钮。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CanvasCtx } from './editor-canvas-context';
import { createExportUi } from './export-ui';
import { createExportState } from './export-state';

type FakeEl = {
  disabled: boolean;
  style: { width?: string };
  textContent: string;
  classList: { add(c: string): void; remove(c: string): void; toggle(c: string, on?: boolean): void; has(c: string): boolean };
  getAttribute(k: string): string | null;
  setAttribute(k: string, v: string): void;
  has(c: string): boolean;
};

function makeEl(attrs: Record<string, string> = {}): FakeEl {
  const set = new Set<string>();
  const el: FakeEl = {
    disabled: false,
    style: {},
    textContent: '',
    classList: {
      add: (c) => void set.add(c),
      remove: (c) => void set.delete(c),
      toggle: (c, on) => (on === false ? set.delete(c) : set.add(c)),
      has: (c) => set.has(c),
    },
    getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => void (attrs[k] = v),
    has: (c) => set.has(c),
  };
  return el;
}

function harness(opts: { isAuthoring?: boolean; styleChips?: FakeEl[]; byId?: Record<string, FakeEl>; oneShot?: FakeEl } = {}) {
  const byIds = opts.byId ?? {};
  const root = {
    querySelectorAll: (_sel?: string) => opts.styleChips ?? [],
    querySelector: (_sel?: string) => opts.oneShot ?? null,
  };
  const q = {
    $: (sel: string) => (sel.includes('openPdfStyle') ? (opts.oneShot ?? null) : null),
    $$: (sel: string) => (root.querySelectorAll(sel) as unknown) as NodeListOf<Element>,
    byId: (id: string) => byIds[id] ?? null,
    $$scoped: () => [],
  };
  const state = createExportState(opts.isAuthoring ?? false);
  const calls: string[] = [];
  const ui = createExportUi(
    { root, bodyEl: root, q, i18n: {}, albumId: 'a1', isAuthoring: opts.isAuthoring ?? false } as unknown as CanvasCtx,
    state,
    { closeExportMenu: () => void calls.push('closeMenu'), aT: (zh) => zh },
  );
  return { ui, state, calls, byIds };
}

describe('createExportState', () => {
  it('authoring 入口默认锁门,游客/编辑入口不锁', () => {
    assert.equal(createExportState(true).gateLocked, true);
    assert.equal(createExportState(false).gateLocked, false);
  });

  it('其余五个字段初始值与原 let 完全一致(0 / false / standard)', () => {
    const s = createExportState(false);
    assert.deepEqual(
      { p: s.exportingPdf, i: s.exportingImages, b: s.bleedMm, d: s.didLocalDownload, style: s.pdfStyle },
      { p: false, i: false, b: 0, d: false, style: 'standard' },
    );
  });
});

describe('setGate', () => {
  it('锁门时把导出按钮打上 disabled / is-disabled / aria-disabled 三件套', () => {
    const btn = makeEl();
    const { ui, state } = harness({ isAuthoring: true, oneShot: btn });
    ui.setGate(true);
    assert.equal(state.gateLocked, true);
    assert.equal(btn.disabled, true);
    assert.equal(btn.has('is-disabled'), true);
    assert.equal(btn.getAttribute('aria-disabled'), 'true');
  });

  it('开闸时三件套一起撤掉(漏一个 = 按钮看着能点但点不动)', () => {
    const btn = makeEl();
    const { ui } = harness({ isAuthoring: true, oneShot: btn });
    ui.setGate(true);
    ui.setGate(false);
    assert.equal(btn.disabled, false);
    assert.equal(btn.has('is-disabled'), false);
    assert.equal(btn.getAttribute('aria-disabled'), 'false');
  });

  it('非 authoring 模式不碰顶栏按钮(那个按钮本来不由它管)', () => {
    const btn = makeEl();
    const { ui } = harness({ isAuthoring: false, oneShot: btn });
    ui.setGate(true);
    assert.equal(btn.disabled, false, '非 authoring 下按钮不该被禁用');
  });
});

describe('版式弹窗', () => {
  it('门闩锁着时直接返回,不关菜单也不重置版式', () => {
    const chip = makeEl({ 'data-pdf-style': 'bleed' });
    chip.classList.add('selected');
    const modal = makeEl();
    const { ui, state, calls } = harness({
      isAuthoring: true, styleChips: [chip], byId: { pdfStyleModal: modal },
    });
    ui.setGate(true);
    state.pdfStyle = 'bleed';
    ui.openPdfStyleModal();
    assert.deepEqual(calls, [], '锁着的时候不该动菜单');
    assert.equal(state.pdfStyle, 'bleed', '版式不该被重置');
    assert.equal(modal.has('open'), false);
  });

  it('开闸后打开:先收菜单,版式重置为 standard,标准 chip 选中', () => {
    const std = makeEl({ 'data-pdf-style': 'standard' });
    const bleed = makeEl({ 'data-pdf-style': 'bleed' });
    bleed.classList.add('selected');
    const modal = makeEl();
    const { ui, state, calls } = harness({
      isAuthoring: false, styleChips: [std, bleed], byId: { pdfStyleModal: modal },
    });
    state.pdfStyle = 'bleed';
    ui.openPdfStyleModal();
    assert.deepEqual(calls, ['closeMenu'], '必须先收导出菜单');
    assert.equal(state.pdfStyle, 'standard');
    assert.equal(std.has('selected'), true);
    assert.equal(bleed.has('selected'), false);
    assert.equal(std.getAttribute('aria-pressed'), 'true');
    assert.equal(modal.has('open'), true);
  });
});

describe('进度弹窗', () => {
  it('setProgress 算百分比并写 label', () => {
    const fill = makeEl();
    const label = makeEl();
    const { ui } = harness({ byId: { expBarFill: fill, expLabel: label } });
    ui.setProgress(3, 8);
    assert.equal(fill.style.width, '38%');
    assert.equal(label.textContent, '3 / 8');
  });

  it('total 为 0 时百分比 0、label 是省略号(不是 "0 / 0")', () => {
    const fill = makeEl();
    const label = makeEl();
    const { ui } = harness({ byId: { expBarFill: fill, expLabel: label } });
    ui.setProgress(0, 0);
    assert.equal(fill.style.width, '0%');
    assert.equal(label.textContent, '…');
  });

  it('showProgress 写标题、归零进度、打开弹窗;hideProgress 关掉', () => {
    const title = makeEl();
    const modal = makeEl();
    const fill = makeEl();
    const label = makeEl();
    const { ui } = harness({ byId: { expTitle: title, exportProgressModal: modal, expBarFill: fill, expLabel: label } });
    ui.showProgress('正在导出 PDF…');
    assert.equal(title.textContent, '正在导出 PDF…');
    assert.equal(fill.style.width, '0%');
    assert.equal(modal.has('open'), true);
    ui.hideProgress();
    assert.equal(modal.has('open'), false);
  });
});
