// export-actions 的单测:只测「不需要真正渲染」的部分。
//
// 为什么只测这些:
//   downloadPdfOnce  纯 DOM + 状态,可完全隔离
//   exportPdf 的早退  门闩 / 防重入 —— 以前这两条只能靠人工点两次按钮验证
// 渲染链路(renderPdfOnce / uploadPdfOnce)依赖 canvas 与网络,留给结构守卫 +
// 既有集成测试覆盖,不在这里假装测到。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { CanvasCtx } from './editor-canvas-context';
import { createExportActions } from './export-actions';
import { createExportState } from './export-state';
import { createExportUi } from './export-ui';

type Ctx = CanvasCtx;

function makeHarness(over: { isAuthoring?: boolean; title?: string } = {}) {
  const state = createExportState(over.isAuthoring ?? false);
  const calls: string[] = [];
  const ctx = {
    root: {} as HTMLElement,
    bodyEl: {} as HTMLElement,
    q: {
      $: () => null,
      $$: (() => []) as unknown as (sel: string) => NodeListOf<Element>,
      byId: () => null,
      $$scoped: () => [],
    },
    i18n: {},
    albumId: 'album-1',
    isAuthoring: over.isAuthoring ?? false,
  } as unknown as Ctx;
  const ui = createExportUi(ctx, state, { closeExportMenu: () => {}, aT: (zh) => zh });
  // 包一层,既能观察调用又能保持 ui 的原行为
  const spyUi = {
    ...ui,
    showProgress: (t: string) => { calls.push(`progress:${t}`); ui.showProgress(t); },
    setProgress: (d: number, n: number) => ui.setProgress(d, n),
    hideProgress: () => { calls.push('hide'); ui.hideProgress(); },
  };
  const actions = createExportActions(ctx, state, spyUi, {
    buildExportInput: async () => ({ adaptable: [], photoIds: [], resolveImage: () => '' }),
    getPageCount: () => 7,
    getTitle: () => over.title ?? '',
    isAnon: () => false,
    closeExportMenu: () => calls.push('closeMenu'),
    openExportFailModal: () => calls.push('failModal'),
    aT: (zh) => zh,
  });
  return { state, actions, calls };
}

describe('downloadPdfOnce', () => {
  const g = globalThis as unknown as { document?: unknown; URL?: unknown };
  let savedDoc: unknown, savedUrl: unknown, clicked: Array<{ download: string }>;

  beforeEach(() => {
    savedDoc = g.document;
    savedUrl = g.URL;
    clicked = [];
    const anchors: Array<{ download: string; href: string; click(): void; remove(): void }> = [];
    g.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
    g.document = {
      createElement: () => {
        const a = {
          download: '',
          href: '',
          click: () => void clicked.push(a),
          remove: () => {},
        };
        anchors.push(a);
        return a;
      },
      body: { appendChild: () => {} },
    };
  });

  afterEach(() => {
    g.document = savedDoc;
    g.URL = savedUrl;
  });

  it('标准版文件名是 <书名>.pdf,出血版加 -bleed3mm 后缀', () => {
    const std = makeHarness({ title: '我的故事' });
    std.actions.downloadPdfOnce(new Blob(['x']));
    assert.equal(clicked[0].download, '我的故事.pdf');

    clicked = [];
    const bleed = makeHarness({ title: '我的故事' });
    bleed.state.bleedMm = 3;
    bleed.actions.downloadPdfOnce(new Blob(['x']));
    assert.equal(clicked[0].download, '我的故事-bleed3mm.pdf');
  });

  it('没有书名时回落 album.pdf(不能出现 ".pdf" 这种空名文件)', () => {
    const { actions } = makeHarness({ title: '' });
    actions.downloadPdfOnce(new Blob(['x']));
    assert.equal(clicked[0].download, 'album.pdf');
  });

  it('一次导出只吐一次文件 —— 重试不能变成下载两遍', () => {
    const { actions } = makeHarness({ title: '书' });
    actions.downloadPdfOnce(new Blob(['x']));
    actions.downloadPdfOnce(new Blob(['x']));
    actions.downloadPdfOnce(new Blob(['x']));
    assert.equal(clicked.length, 1, '第二次起应当被 didLocalDownload 拦住');
  });
});

describe('exportPdf 早退', () => {
  it('门闩锁着时直接返回:不弹进度、不收菜单、不置导出中', () => {
    const { state, actions, calls } = makeHarness({ isAuthoring: true });
    assert.equal(state.gateLocked, true, 'authoring 入口初始就是锁的');
    void actions.exportPdf(0);
    return Promise.resolve().then(() => {
      assert.deepEqual(calls, [], '锁着的时候什么都不该发生');
      assert.equal(state.exportingPdf, false);
    });
  });

  it('导出进行中再点一次:直接返回(防重入)', async () => {
    const { state, actions, calls } = makeHarness();
    state.exportingPdf = true;
    await actions.exportPdf(0);
    assert.deepEqual(calls, [], '重入不该再走一遍流程');
  });

  it('逐页 PNG 导出进行中时,PDF 导出也必须让路', async () => {
    const { state, actions, calls } = makeHarness();
    state.exportingImages = true;
    await actions.exportPdf(0);
    assert.deepEqual(calls, [], '两条导出互斥');
  });
});
