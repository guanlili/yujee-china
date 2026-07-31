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

export type ExportKind = 'collage' | 'live' | 'pages' | 'pdf';

/** 进度浮层要的两样:一句在做什么 + 「done / total」。 */
export type ExportProgress = { label: string; done: number; total: number; percent: number } | null;

type LiveReadyAsset = {
  video: Blob;
  cover: Blob;
  stem: string;
  suffix: 'page-flip' | 'nine-grid';
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
};

export function useExport({
  albumId,
  title,
  zh,
  pages,
  background,
  photoFilter,
}: ExportDeps) {
  const [progress, setProgress] = useState<ExportProgress>(null);
  const [failed, setFailed] = useState(false);
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
    );
    return { adaptable, resolveImage: (id: string) => dataUrls[id] };
  }, [pages, photoFilter]);

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

  const stem = useCallback(async () => {
    const { safeFileStem } = await import('@/lib/export/download');
    return safeFileStem(title);
  }, [title]);

  const exportCollage = useCallback(
    (perImage: 1 | 2 | 3 | 6) =>
      runImageExport(t('正在导出拼图…', 'Exporting collage…'), async ({ adaptable, resolveImage }) => {
        const { renderCollages } = await import('@/lib/export/collage');
        const blobs = await renderCollages(adaptable, resolveImage, {
          perImage,
          background,
          onProgress,
        });
        const { downloadBlob, downloadBlobs } = await import('@/lib/export/download');
        const s = await stem();
        if (blobs.length === 0) throw new ExportError('render', 'no interior pages to collage');
        if (blobs.length === 1) downloadBlob(blobs[0]!, s + '.jpg');
        else
          await downloadBlobs(
            blobs.map((b, i) => ({ name: `${s}-${String(i + 1).padStart(2, '0')}.jpg`, blob: b })),
          );
      }),
    [runImageExport, t, background, onProgress, stem],
  );

  const exportSinglePages = useCallback(
    () =>
      runImageExport(t('正在导出单页图…', 'Exporting pages…'), async ({ adaptable, resolveImage }) => {
        const { renderPageJpegs } = await import('@/lib/export/single-pages');
        const files = await renderPageJpegs(adaptable, resolveImage, { onProgress });
        const { downloadBlobs } = await import('@/lib/export/download');
        const s = await stem();
        await downloadBlobs(files.map((f) => ({ name: `${s}-${f.name}`, blob: f.blob })));
      }),
    [runImageExport, t, onProgress, stem],
  );

  /** Live 视频。设备/浏览器不支持时给一句明确的话,不当成导出失败(与桌面同口径)。 */
  const [liveUnsupported, setLiveUnsupported] = useState<string | null>(null);
  // 视频生成可能要几十秒。生成结束后不能直接 navigator.share:移动浏览器要求分享由
  // 一次新的用户点击同步触发。先暂存产物,再由「保存 / 分享」按钮完成交付。
  const [liveReady, setLiveReady] = useState<LiveReadyAsset | null>(null);

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
          setLiveReady({
            video: blob,
            cover: covers[0].blob,
            stem: await stem(),
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
          setLiveReady({
            video: blob,
            cover,
            stem: await stem(),
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
  const deliverLive = useCallback(() => {
    if (!liveReady) return Promise.resolve<'cancelled'>('cancelled');
    return deliverLiveAssets(
      liveReady.video,
      liveReady.cover,
      liveReady.stem,
      liveReady.suffix,
    ).then((result) => {
      // 用户取消系统分享时保留弹窗,方便再次点击;真正交付后才释放大 Blob。
      if (result !== 'cancelled') setLiveReady(null);
      return result;
    });
  }, [liveReady]);

  const exportPdf = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setProgress({ label: t('正在导出 PDF…', 'Exporting PDF…'), done: 0, total: 0, percent: 0 });
    let downloaded = false;
    try {
      let blob: Blob | null = null;
      // render 段:出 PDF + 本地下载,自动重试 ≤3 次。连续 3 次失败才是真·导出失败。
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
          if (!downloaded) {
            downloaded = true;
            const { downloadBlob } = await import('@/lib/export/download');
            downloadBlob(b, (await stem()) + '.pdf');
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
      // 用户已拿到 PDF = 导出成功。云端上传解耦,失败**完全静默**(只落日志,不弹框)。
      await runExportWithRetry(() => uploadPdf(albumId, blob!), {
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
    liveReady: liveReady != null,
    dismissLiveReady: () => setLiveReady(null),
    deliverLive,
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
