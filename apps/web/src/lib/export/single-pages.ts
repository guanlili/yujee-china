import type { AdaptablePage, ResolveImage } from '@/components/album/adapt-layout';
import { pageFolioInfos } from '@/components/album/page-html-dom';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { renderFaceToCanvas } from '@/lib/pdf/render-raster';
import type { NamedBlob } from './download';

// 单页 JPG 导出：整本逐个 face（封面/内页/封尾全算）→ 一张 JPEG，按导出页序命名。
// 与 PDF 同一套 renderFaceToCanvas，像素级一致；页码覆盖层同源（内页 1..N）。
// 下载交给调用方（download.ts 的 downloadBlobs，逐张直接下）。

export interface SinglePagesOptions {
  scale?: number; // 截图倍率，默认 3（≈288 DPI，与 PDF 一致）
  quality?: number; // JPEG 质量 0..1，默认 0.92
  onProgress?: (done: number, total: number) => void;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      quality,
    );
  });
}

export async function renderPageJpegs(
  pages: (AdaptablePage & { html?: string })[],
  resolveImage: ResolveImage,
  options: SinglePagesOptions = {},
): Promise<NamedBlob[]> {
  await loadAlbumFonts(pages).catch(() => undefined);
  const scale = options.scale ?? 3;
  const quality = options.quality ?? 0.92;
  const total = pages.length;

  const folioInfos = pageFolioInfos(pages.map((p) => p.templateId));
  const pad = String(total).length;

  const out: NamedBlob[] = [];
  for (let i = 0; i < total; i++) {
    const canvas = await renderFaceToCanvas(pages[i]!, resolveImage, {
      scale, total,
      folio: folioInfos[i]?.folio ?? null,
      folioSide: folioInfos[i]?.side ?? 'right',
    });
    const blob = await canvasToJpegBlob(canvas, quality);
    out.push({ name: `${String(i + 1).padStart(pad, '0')}.jpg`, blob });
    options.onProgress?.(i + 1, total);
  }
  return out;
}
