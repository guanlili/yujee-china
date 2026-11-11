// 导出四条链路(2026-11-11,拆 EditorBook 的阶段 2b)。
//
// 从 5,700 行的巨型 effect 里搬出来的四个函数:
//   renderPdfOnce   栅格渲染出 PDF 字节(有渲染超时上限)
//   downloadPdfOnce 本地吐文件(每次导出只吐一次,文件名带 -bleed3mm)
//   uploadPdfOnce   云端正签 → 直传 → 确认(直传必须带截止时间)
//   exportPdf       主流程:门闩 → 渲染重试 → 埋点 → 云端旁路
//
// 只有 8 项依赖需要注入(见 ExportActionDeps)。其余全部是模块级 import 或
// ctx / exportState —— 这也是它能被搬出来的原因:依赖面比看上去窄得多。
//
// 行为与搬到之前逐字等价。唯一的变化是读「页数 / 标题 / 游客 / 文案」改走 getter:
// 这几个在 effect 里是可变的,构造时捕获会拿到旧值。
import { withDeadline } from '@/lib/net/fetch-timeout';
import { logger } from '@/lib/log/logger';
import { track } from '@/lib/analytics/track-client';

import type { CanvasCtx } from './editor-canvas-context';
import type { ExportState } from './export-state';
import type { ExportUi } from './export-ui';
import {
  runExportWithRetry,
  buildExportFailureLog,
  PDF_UPLOAD_TIMEOUT_MS,
  fetchWithTimeout,
  normalizeUploadError,
  ExportError,
  RASTER_PDF_RENDER_DEADLINE_MS,
} from './export-retry-util';

export type ExportActionDeps = {
  /** 三条导出路径共用的输入:适配页 + 原图解析器。留在 EditorBook(它要吃 pagesState / 照片库)。 */
  buildExportInput: () => Promise<{ adaptable: unknown[]; photoIds: string[]; resolveImage: (id: string) => string }>;
  /** 当前页数。必须惰性读:pagesState 是 effect 内可变数组。 */
  getPageCount: () => number;
  /** 书名,用于下载文件名。 */
  getTitle: () => string;
  /** 是否游客(viewerAnonRef.current === true)。 */
  isAnon: () => boolean;
  closeExportMenu: () => void;
  openExportFailModal: () => void;
  /** i18n,惰性(locale 可变)。 */
  aT: (zh: string, en: string) => string;
};

export type ExportActions = {
  renderPdfOnce(bleedMm?: number): Promise<Blob>;
  downloadPdfOnce(blob: Blob): void;
  uploadPdfOnce(blob: Blob): Promise<void>;
  exportPdf(bleedMm?: number): Promise<void>;
};

export function createExportActions(
  ctx: CanvasCtx,
  state: ExportState,
  ui: ExportUi,
  deps: ExportActionDeps,
): ExportActions {
  const { albumId, q } = ctx;

  async function renderPdfOnce(bleedMm = 0): Promise<Blob> {
    try {
      // C 方案:PDF 导出 = 栅格截屏幕渲染(存库 html 优先,与画布像素级一致)。
      // 矢量导出路径已退役(消费不了自由 HTML)。喂高分辨率原图,防放大糊。
      // bleedMm:印刷版传 3(2026-08-03 出血设计),默认 0 走原路径。
      // 渲染整体(含动态 import、取图 buildExportInput、栅格化)要有上限:任意一环挂住,
      // 进度条会永远停在 0%,用户既拿不到文件也没有失败提示(2026-11-09 两次实测:
      // 先是取图/编码那段挂住,后是 render-raster 这个 chunk 的请求挂住)。
      // 期限常量走静态 import —— 否则连 withDeadline 那行都执行不到。
      // 到点按 render 失败处理 —— 走既有的重试 + 安抚框,有界、可重试、说得清。
      return await withDeadline(
        (async () => {
          const { renderAlbumPdfRaster } = await import('@/lib/pdf/render-raster');
          const { adaptable, resolveImage } = await deps.buildExportInput();
          return await renderAlbumPdfRaster(adaptable as never, resolveImage, {
            scale: 3,
            onProgress: ui.setProgress,
            bleedMm,
          });
        })(),
        RASTER_PDF_RENDER_DEADLINE_MS,
        'pdfRender',
      );
    } catch (e) {
      throw new ExportError('render', e instanceof Error ? e.message : String(e));
    }
  }

  // Local download — useful even if R2 isn't configured (e.g. mock runs). Once
  // per export so a retry doesn't trigger a second download.
  function downloadPdfOnce(blob: Blob) {
    if (state.didLocalDownload) return;
    state.didLocalDownload = true;
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement('a');
    aEl.href = url;
    aEl.download = (deps.getTitle() || 'album') + (state.bleedMm ? '-bleed3mm' : '') + '.pdf';
    document.body.appendChild(aEl);
    aEl.click();
    aEl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function uploadPdfOnce(blob: Blob): Promise<void> {
    const signRes = await fetch(`/api/v1/albums/${albumId}/pdf-upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'application/pdf', size: blob.size }),
    });
    const signJson = await signRes.json();
    if (!signJson.ok) {
      throw new ExportError('upload', signJson.error?.message ?? 'sign failed', signRes.status);
    }
    const { putUrl, r2Key } = signJson.data;
    // 直传必须带截止时间:这条链路实测会**挂住**(既不 200 也不报错,一直 inflight),
    // 没有截止时间的话 runExportWithRetry 永远停在第 1 次,「3 次耗尽」永远不到,
    // 用户既没云端备份也没提示(2026-11-09,与移动端同源,共用同一份实现)。
    let putRes: Response;
    try {
      putRes = await fetchWithTimeout(
        putUrl,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: blob,
        },
        PDF_UPLOAD_TIMEOUT_MS,
      );
    } catch (e) {
      throw normalizeUploadError(e);
    }
    if (!putRes.ok) throw new ExportError('upload', `R2 PUT ${putRes.status}`, putRes.status);
    const confirmRes = await fetch(`/api/v1/albums/${albumId}/pdf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ r2Key }),
    });
    const confirmJson = await confirmRes.json();
    if (!confirmRes.ok || confirmJson.ok !== true) {
      throw new ExportError('upload', confirmJson.error?.message ?? 'PDF confirm failed', confirmRes.status);
    }
  }

  async function exportPdf(bleedMm = 0) {
    // The topbar export button is prop-disabled when the gate is locked, and the
    // chat export-ready card only appears when unlocked — but defend anyway.
    if (state.gateLocked) return;
    if (state.exportingPdf || state.exportingImages) return;
    state.exportingPdf = true;
    state.bleedMm = bleedMm;
    state.didLocalDownload = false;
    deps.closeExportMenu();
    // 埋点:导出是用户最在意的一步,也是唯一「耗时以分钟计」的路径。
    // 只记页数与耗时,不记书名/页面内容(见 lib/analytics/events.ts 的隐私口径)。
    const exportStartedAt = Date.now();
    const exportPages = deps.getPageCount();
    track('export_start', { albumId, meta: { pages: exportPages, bleed: bleedMm, mode: 'desktop' } });
    ui.showProgress(deps.aT('正在导出 PDF…', 'Exporting PDF…'));
    try {
      // render 段:出 PDF + 本地下载,自动重试 ≤3 次。连续 3 次失败才是真·导出失败 →
      // 弹安抚框 + 落日志。计数全在前端(runExportWithRetry),**不动积分**(§5)。
      let blob: Blob | null = null;
      const rendered = await runExportWithRetry(
        async () => {
          const b = await renderPdfOnce(bleedMm);
          downloadPdfOnce(b);
          blob = b;
        },
        {
          onExhausted: (lastError: unknown, attempts: number) => {
            // 同一份归类结果既进日志也进埋点:两处各算一次迟早会漂移,
            // 而 classifyExportFailure 本身是封闭词表,天然满足隐私红线。
            const failure = buildExportFailureLog(lastError, { albumId, attempts });
            logger.error(failure, 'pdf export failed');
            deps.openExportFailModal();
            track('export_fail', {
              albumId,
              value: Date.now() - exportStartedAt,
              result: 'fail',
              meta: {
                pages: exportPages,
                attempt: attempts,
                step: 'render',
                code: failure.failureCode,
                ...(failure.status !== undefined ? { status: failure.status } : {}),
              },
            });
          },
        },
      );
      // render 失败:安抚框已弹,到此为止(用户确实没拿到文件)。
      if (!rendered.ok || blob == null) return;
      // 用户拿到 PDF 这一刻就算成功(云端上传是旁路,另记一条)。
      track('export_ok', {
        albumId,
        value: Date.now() - exportStartedAt,
        result: 'ok',
        meta: { pages: exportPages, bleed: bleedMm, mode: 'desktop' },
      });

      // 用户已拿到 PDF = 导出成功。云端上传解耦:失败不弹失败框,重试耗尽亮横幅。
      // 飞书推送仍后置(§4.5d);游客只本地下载;出血版跳过上传(保持标准版)。
      if (deps.isAnon()) return;
      if (bleedMm === 0) {
        await runExportWithRetry(() => uploadPdfOnce(blob!), {
          onExhausted: (lastError: unknown, attempts: number) => {
            const failure = buildExportFailureLog(lastError, { albumId, attempts });
            logger.error(
              failure,
              'pdf cloud upload failed (local download already succeeded)',
            );
            const card = q.byId('pdfCloudAlert');
            if (card) card.style.display = '';
            // 本地已成功、云端没上去:单独记,别和「用户没拿到文件」混成一个失败率。
            // code 同样取封闭词表 —— 上传失败最常见的就是桶策略/签名过期,看一眼就知道。
            track('export_fail', {
              albumId,
              value: Date.now() - exportStartedAt,
              result: 'fail',
              meta: {
                pages: exportPages,
                attempt: attempts,
                step: 'upload',
                code: failure.failureCode,
                ...(failure.status !== undefined ? { status: failure.status } : {}),
              },
            });
          },
        });
      }
    } finally {
      ui.hideProgress();
      state.exportingPdf = false;
    }
  }

  return { renderPdfOnce, downloadPdfOnce, uploadPdfOnce, exportPdf };
}
