'use client';

/* ════════════════════════════════════════════════════════════════════════════
   导出 —— 移动端那一份。四条格式与桌面完全同源:

     多跨页拼图 JPG   lib/export/collage       renderCollages
     Live 视频 MP4    lib/export/live-video       renderLiveVideo(翻页)
                      lib/export/nine-grid-motion renderNineGridVideo(九宫格)
     单页 JPG         lib/export/single-pages  renderPageJpegs
     整本 PDF         lib/pdf/render-raster    renderAlbumPdfRaster + 上传 R2

   渲染这些的都是纯函数库(吃「适配页 + 原图解析器」),桌面移动共用同一份 ——
   移动端不重写任何渲染,只负责 UI 与调度。

   两条与桌面一致、容易做错的处置:
     · PDF:render 段自动重试 ≤3 次,连续 3 次才算真失败(弹安抚框);
       用户拿到文件之后的**云端上传失败完全静默**(后台重试,只落日志,不弹框)。
     · 导出闸门:computeExportUnlocked(stage, allDone) —— 没到 ready 不给导出。
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useRef, useState } from 'react';

import { photoStore, RASTER_PDF_IMAGE_MAX_EDGE } from '@/lib/photo/store';
import { collectPhotoIds } from '../../adapt-layout';
import type { BoardBackground } from '@/lib/board-bg/presets';
import type { EditorPage } from '../../types';
import { runExportWithRetry, buildExportFailureLog, ExportError } from '../export-retry-util';
import { logger } from '@/lib/log/logger';
import type { PhotoFilterState } from '@/lib/photo/filter-state';
import { deliverLiveAssets } from '@/lib/export/live-delivery';
import { safeFileStem, type NamedBlob } from '@/lib/export/download';
import {
  deliverMobileExportAssets,
  saveExportFileAt,
  type MobileDeliveryResult,
} from '@/lib/export/mobile-delivery';

export type ExportKind = 'collage' | 'live' | 'pages' | 'pdf';

/** 进度浮层要的两样:一句在做什么 + 「done / total」。 */
export type ExportProgress = { label: string; done: number; total: number; percent: number } | null;

type ExportReadyAsset =
  | {
      kind: 'live';
      label: string;
      video: Blob;
      cover: Blob;
      stem: string;
      suffix: 'page-flip' | 'nine-grid';
    }
  | {
      kind: 'files';
      label: string;
      files: NamedBlob[];
    };

export type ExportDeps = {
  albumId: string;
  title: string;
  zh: boolean;
  pages: EditorPage[];
  /** 画板垫底背景(**BoardBackground 原对象**,不是 CSS 字符串)——
   *  拼图/Live 的渲染器自己按 kind 解析,与画布同一份视觉。 */
  background: BoardBackground | null;
  photoFilter: PhotoFilterState | null;
  /** 已备份到服务器的压缩图(photoId→URL)。**本地没有原图时的回落** ——
   *  与展示层 `imageUrls[id] ?? snapshotUrls[id]` 同一份表、同一条规则。
   *  漏了它,换设备/清缓存后导出的就是一本空图(见 export-backup-fallback.test.ts)。 */
  snapshotUrls: Record<string, string>;
};

export function useExport({
  albumId,
  title,
  zh,
  pages,
  background,
  photoFilter,
  snapshotUrls,
}: ExportDeps) {
  const [progress, setProgress] = useState<ExportProgress>(null);
  const [failed, setFailed] = useState(false);
  const [exportReady, setExportReady] = useState<ExportReadyAsset | null>(null);
  /** 非空 = 已确认这台设备打不开系统分享,弹窗切成「逐张保存」列表(见 deliverExport)。
   *  新一轮导出必须先清掉,否则新产物的弹窗会挂着上一轮的旧文件名。 */
  const [manualFiles, setManualFiles] = useState<NamedBlob[] | null>(null);
  const busy = useRef(false);
  const t = useCallback((cn: string, en: string) => (zh ? cn : en), [zh]);

  /** 三条导出路径共用的输入:适配页 + **原图**解析器(喂高分辨率原图,防放大糊)。 */
  const buildInput = useCallback(async () => {
    const adaptable = pages.map((p) => ({
      templateId: p.templateId,
      images: p.imagesJson,
      texts: p.textsJson,
      imagePos: p.imagePosJson,
      html: p.htmlJson,
    }));
    const ids = collectPhotoIds(adaptable);
    const dataUrls = await photoStore.getPdfDataUrls(
      ids,
      RASTER_PDF_IMAGE_MAX_EDGE,
      photoFilter,
      snapshotUrls,
    );
    return { adaptable, resolveImage: (id: string) => dataUrls[id] };
  }, [pages, photoFilter, snapshotUrls]);

  // 渲染库的回调口径是 (done, total)(见桌面 setExportProgress),不是百分比 ——
  // 百分比在这里算,标签沿用当前那一条,不被进度覆盖掉。
  const onProgress = useCallback((done: number, total: number) => {
    setProgress((cur) =>
      cur == null
        ? cur
        : { ...cur, done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 },
    );
  }, []);

  /** 图片类导出(拼图/Live/单页)共用的外壳:忙锁 + 进度 + 失败安抚框 + 落日志。 */
  const runImageExport = useCallback(
    async (label: string, run: (input: Awaited<ReturnType<typeof buildInput>>) => Promise<void>) => {
      if (busy.current) return;
      busy.current = true;
      setManualFiles(null); // 新一轮导出:上一轮的「逐张保存」列表作废
      setProgress({ label, done: 0, total: 0, percent: 0 });
      try {
        await run(await buildInput());
      } catch (e) {
        logger.error(buildExportFailureLog(e, { albumId, attempts: 1 }), 'mobile export failed');
        setFailed(true);
      } finally {
        setProgress(null);
        busy.current = false;
      }
    },
    [albumId, buildInput],
  );

  const stem = useCallback(() => safeFileStem(title), [title]);

  // 渲染完只是「产物就绪」,交付要等用户那一记明确点击(见 deliverExport)。
  // 这里**不打包**:zip 在手机上存不进相册、看不了图,等于没导出(见 export-no-zip.test)。
  // 多文件的交付方式是系统分享面板;分享走不通就由用户逐张点着存。
  const stageExportFiles = useCallback((label: string, files: NamedBlob[]) => {
    if (files.length === 0) throw new ExportError('render', 'export returned no files');
    setExportReady({ kind: 'files', label, files });
  }, []);

  const exportCollage = useCallback(
    (perImage: 1 | 2 | 3 | 6) =>
      runImageExport(t('正在导出拼图…', 'Exporting collage…'), async ({ adaptable, resolveImage }) => {
        const { renderCollages } = await import('@/lib/export/collage');
        const blobs = await renderCollages(adaptable, resolveImage, {
          perImage,
          background,
          onProgress,
        });
        const s = stem();
        if (blobs.length === 0) throw new ExportError('render', 'no interior pages to collage');
        const files = blobs.map((blob, i) => ({
          name:
            blobs.length === 1
              ? `${s}.jpg`
              : `${s}-${String(i + 1).padStart(2, '0')}.jpg`,
          blob,
        }));
        stageExportFiles(t('拼图', 'Collage'), files);
      }),
    [runImageExport, t, background, onProgress, stem, stageExportFiles],
  );

  const exportSinglePages = useCallback(
    () =>
      runImageExport(t('正在导出单页图…', 'Exporting pages…'), async ({ adaptable, resolveImage }) => {
        const { renderPageJpegs } = await import('@/lib/export/single-pages');
        const files = await renderPageJpegs(adaptable, resolveImage, { onProgress });
        const s = stem();
        stageExportFiles(
          t('单页图片', 'Page images'),
          files.map((f) => ({ name: `${s}-${f.name}`, blob: f.blob })),
        );
      }),
    [runImageExport, t, onProgress, stem, stageExportFiles],
  );

  /** Live 视频。设备/浏览器不支持时给一句明确的话,不当成导出失败(与桌面同口径)。 */
  const [liveUnsupported, setLiveUnsupported] = useState<string | null>(null);

  /** 翻页 Live:整本逐页翻。 */
  const exportLive = useCallback(
    () =>
      runImageExport(t('正在导出 Live 视频…', 'Exporting Live video…'), async ({ adaptable, resolveImage }) => {
        const { renderLiveVideo, LiveUnsupportedError } = await import('@/lib/export/live-video');
        try {
          const blob = await renderLiveVideo(adaptable, resolveImage, { background, onProgress });
          // 封面用首页静帧 —— iOS 分享面板要 jpg + 视频成对才能合成 Live Photo。
          const { renderPageJpegs } = await import('@/lib/export/single-pages');
          const covers = await renderPageJpegs(adaptable.slice(0, 1), resolveImage);
          if (!covers[0]) throw new ExportError('render', 'live cover rendering returned no page');
          setExportReady({
            kind: 'live',
            label: t('Live 视频', 'Live video'),
            video: blob,
            cover: covers[0].blob,
            stem: stem(),
            suffix: 'page-flip',
          });
        } catch (e) {
          if (e instanceof LiveUnsupportedError) {
            setLiveUnsupported(
              t('这台设备的浏览器不支持导出视频,换电脑或换浏览器再试。', "This browser can't export video — try another browser or a computer."),
            );
            return; // 不是导出失败,不弹安抚框
          }
          throw e;
        }
      }),
    [runImageExport, t, background, onProgress, stem],
  );

  /** 九宫格 Live:每组 9 页整齐切换。参数与桌面逐条一致(3:4 满版、三列、每组 9 页),
   *  渲染器也是同一份 —— 移动端不重写任何渲染。 */
  const exportNineGrid = useCallback(
    () =>
      runImageExport(t('正在导出九宫格 Live…', 'Exporting nine-grid Live…'), async ({ adaptable, resolveImage }) => {
        const {
          renderNineGridLayoutSources,
          renderNineGridCover,
          renderNineGridVideo,
          NineGridUnsupportedError,
        } = await import('@/lib/export/nine-grid-motion');
        const sources = await renderNineGridLayoutSources(adaptable, resolveImage, 'single', onProgress);
        if (sources.length === 0) throw new ExportError('render', 'no layouts to export');
        try {
          const blob = await renderNineGridVideo(sources, {
            aspect: '3:4',
            frameStyle: 'full',
            background,
            columns: 3,
            layoutsPerScene: 9,
            onProgress,
          });
          const cover = await renderNineGridCover(sources, { background, columns: 3, maxLayouts: 9 });
          setExportReady({
            kind: 'live',
            label: t('九宫格 Live', 'Nine-grid Live'),
            video: blob,
            cover,
            stem: stem(),
            suffix: 'nine-grid',
          });
        } catch (e) {
          if (e instanceof NineGridUnsupportedError) {
            setLiveUnsupported(
              t('这台设备的浏览器不支持导出视频,换电脑或换浏览器再试。', "This browser can't export video — try another browser or a computer."),
            );
            return; // 同上:能力缺失不是导出失败
          }
          throw e;
        }
      }),
    [runImageExport, t, background, onProgress, stem],
  );

  /** 必须从保存按钮的 click handler 里直接调用,让 navigator.share 保有瞬时用户授权。 */
  const deliverExport = useCallback((): Promise<MobileDeliveryResult> => {
    if (!exportReady) return Promise.resolve('cancelled');
    const files = exportReady.kind === 'files' ? exportReady.files : null;
    const delivery =
      exportReady.kind === 'live'
        ? deliverLiveAssets(
            exportReady.video,
            exportReady.cover,
            exportReady.stem,
            exportReady.suffix,
          )
        : deliverMobileExportAssets(exportReady.files);
    return delivery.then((result) => {
      // 用户取消系统分享时保留弹窗,方便再次点击;真正交付后才释放大 Blob。
      if (result === 'cancelled') return result;
      // 分享不可用的多文件导出:不打包、不连发,改成列出来让用户逐张点着存。
      // 弹窗留着(列表就长在它上面),Blob 也必须留着 —— 用户还没拿到东西。
      if (result === 'manual' && files) {
        setManualFiles(files);
        return result;
      }
      setExportReady(null);
      return result;
    });
  }, [exportReady]);

  /** 逐张保存:一记点击落一个文件(共享交付层实现,两端同一条规则)。 */
  const saveExportFile = useCallback(
    (index: number) => {
      if (manualFiles) saveExportFileAt(manualFiles, index);
    },
    [manualFiles],
  );

  const dismissExportReady = useCallback(() => {
    setExportReady(null);
    setManualFiles(null);
  }, []);

  const exportPdf = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setManualFiles(null); // 同 runImageExport:新一轮导出作废上一轮的逐张保存列表
    setProgress({ label: t('正在导出 PDF…', 'Exporting PDF…'), done: 0, total: 0, percent: 0 });
    try {
      let blob: Blob | null = null;
      // render 段:生成 PDF,自动重试 ≤3 次。连续 3 次失败才是真·导出失败。
      const rendered = await runExportWithRetry(
        async () => {
          const { adaptable, resolveImage } = await buildInput();
          const { renderAlbumPdfRaster } = await import('@/lib/pdf/render-raster');
          let b: Blob;
          try {
            b = await renderAlbumPdfRaster(adaptable, resolveImage, { scale: 3, onProgress });
          } catch (e) {
            throw new ExportError('render', e instanceof Error ? e.message : String(e));
          }
          blob = b;
        },
        {
          onExhausted: (lastError, attempts) => {
            logger.error(buildExportFailureLog(lastError, { albumId, attempts }), 'mobile pdf export failed');
            setFailed(true);
          },
        },
      );
      if (!rendered.ok || blob == null) return;
      const renderedBlob = blob;
      const name = `${stem()}.pdf`;
      setExportReady({ kind: 'files', label: 'PDF', files: [{ name, blob: renderedBlob }] });
      // 本地保存入口已经就绪。云端上传在后台重试,失败**完全静默**(只落日志,不弹框)。
      void runExportWithRetry(() => uploadPdf(albumId, renderedBlob), {
        onExhausted: (lastError, attempts) => {
          logger.error(
            buildExportFailureLog(lastError, { albumId, attempts }),
            'mobile pdf cloud upload failed (silent — local download already succeeded)',
          );
        },
      });
    } finally {
      setProgress(null);
      busy.current = false;
    }
  }, [albumId, buildInput, onProgress, stem, t]);

  return {
    progress,
    failed,
    dismissFailed: () => setFailed(false),
    liveUnsupported,
    dismissLiveUnsupported: () => setLiveUnsupported(null),
    exportReady: exportReady != null,
    exportReadyLabel: exportReady?.label ?? '',
    /** 非空 = 弹窗切到「逐张保存」列表(分享走不通的多文件导出)。 */
    exportManualFiles: manualFiles?.map((f) => f.name) ?? null,
    dismissExportReady,
    deliverExport,
    saveExportFile,
    exportCollage,
    exportSinglePages,
    exportLive,
    exportNineGrid,
    exportPdf,
  };
}

/** 签名 → 直传 R2 → confirm 落库。与桌面 uploadPdfOnce 同一条。 */
async function uploadPdf(albumId: string, blob: Blob): Promise<void> {
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
  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: blob,
  });
  if (!putRes.ok) throw new ExportError('upload', `R2 PUT ${putRes.status}`, putRes.status);
  const confirmRes = await fetch(`/api/v1/albums/${albumId}/pdf`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ r2Key }),
  });
  const confirmJson = await confirmRes.json();
  if (!confirmRes.ok || !confirmJson.ok) {
    throw new ExportError('upload', confirmJson.error?.message ?? 'confirm failed', confirmRes.status);
  }
}
