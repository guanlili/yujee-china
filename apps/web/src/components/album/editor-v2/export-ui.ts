// 导出域的 UI 小件(2026-11-11,拆 EditorBook 的阶段 2a)。
//
// 搬的是六个「只碰 DOM + 导出状态」的函数:门闩、版式弹窗、进度弹窗。
// 它们不含任何渲染/上传逻辑,所以能安全地先搬 —— 用来验证「ctx 注入 + 按域搬函数」
// 这套模式在真代码上跑得通,而不只是搭了个空接口(阶段 1)。
//
// 不搬的部分(阶段 2b):exportPdf 主路径、renderPdfOnce、uploadPdfOnce —— 它们还
// 牵着渲染器、图片解析、埋点三条链,依赖数比这一簇多一倍。
import type { CanvasCtx } from './editor-canvas-context';
import type { ExportState } from './export-state';

export type ExportUiDeps = {
  /** 打开版式弹窗前要先把导出菜单收起来。 */
  closeExportMenu: () => void;
  /** i18n 取值;必须是惰性调用,不能在构造时就求值(locale 是 effect 内的可变状态)。 */
  aT: (zh: string, en: string) => string;
};

export type ExportUi = {
  /** 同步门闩 + 顶栏导出按钮的 disabled/aria 状态。 */
  setGate(locked: boolean): void;
  openPdfStyleModal(): void;
  closePdfStyleModal(): void;
  showProgress(title: string): void;
  setProgress(done: number, total: number): void;
  hideProgress(): void;
};

export function createExportUi(ctx: CanvasCtx, state: ExportState, deps: ExportUiDeps): ExportUi {
  const { q, isAuthoring } = ctx;

  function setGate(locked: boolean) {
    state.gateLocked = locked;
    // 菜单里的 PDF 入口只剩一个(版式在弹窗里选;出血只是渲染参数,不改导出门槛)。
    for (const selector of ['[data-action="openPdfStyle"]']) {
      const exportBtn = q.$(selector) as HTMLButtonElement | null;
      if (exportBtn && isAuthoring) {
        exportBtn.disabled = locked;
        exportBtn.classList.toggle('is-disabled', locked);
        exportBtn.setAttribute('aria-disabled', locked ? 'true' : 'false');
      }
    }
  }

  function openPdfStyleModal() {
    if (state.gateLocked) return; // 与 openExportMenu 同一道防线(chat 也可能开闸前触发)
    deps.closeExportMenu();
    state.pdfStyle = 'standard';
    // 与原实现一致:原代码调 $$(sel)(= root.querySelectorAll,不做容器排除),
    // 所以这里直接用 ctx.root.querySelectorAll,不要换成 $$scoped。
    ctx.root.querySelectorAll('[data-pdf-style]').forEach((el) => {
      const selected = el.getAttribute('data-pdf-style') === 'standard';
      el.classList.toggle('selected', selected);
      el.setAttribute('aria-pressed', String(selected));
    });
    q.byId('pdfStyleModal')?.classList.add('open');
  }

  function closePdfStyleModal() {
    q.byId('pdfStyleModal')?.classList.remove('open');
  }

  function showProgress(title: string) {
    const el = q.byId('expTitle');
    if (el) el.textContent = title;
    setProgress(0, 0);
    q.byId('exportProgressModal')?.classList.add('open');
  }

  function setProgress(done: number, total: number) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const fill = q.byId('expBarFill');
    if (fill) fill.style.width = pct + '%';
    const label = q.byId('expLabel');
    if (label) label.textContent = total > 0 ? `${done} / ${total}` : '…';
  }

  function hideProgress() {
    q.byId('exportProgressModal')?.classList.remove('open');
  }

  return { setGate, openPdfStyleModal, closePdfStyleModal, showProgress, setProgress, hideProgress };
}
