import { isSpreadTemplate } from '@yujee/contracts/render';
import type { AdaptablePage, ResolveImage } from '@/components/album/adapt-layout';
import { pageFolioInfos } from '@/components/album/page-html-dom';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { renderFaceToCanvas } from '@/lib/pdf/render-raster';
import { splitSpreadCanvas } from '@/lib/pdf/split-spread-canvas';
import type { NamedBlob } from './download';

// 单页 JPG 导出：整本逐个 face（封面/内页/封尾全算）→ 一张 JPEG，按导出页序命名。
// 与 PDF 同一套 renderFaceToCanvas，像素级一致；页码覆盖层同源（内页 1..N）。
// 下载交给调用方（download.ts 的 downloadBlobs，逐张直接下）。
//
// 跨页(#303)同样处理：双宽页在这里也切成左右两张，保持「一个文件=一个物理页」的
// 不变量，否则会混入一张宽高比不同的双宽 JPG，破坏文件集的一致性。

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
  // 文件名位宽按「物理页数」算(双宽页拆两张才计 2),否则纯数据页数会在跨页存在
  // 时算少,序号溢出补零位宽导致字典序错位(如 pad=1 时 "10" 排到 "2" 前面)。
  const physicalTotal = pages.reduce((n, p) => n + (isSpreadTemplate(p.templateId) ? 2 : 1), 0);
  const pad = String(physicalTotal).length;

  const out: NamedBlob[] = [];
  let faceIndex = 0;
  for (let i = 0; i < total; i++) {
    const page = pages[i]!;
    const canvas = await renderFaceToCanvas(page, resolveImage, {
      scale, total,
      folio: folioInfos[i]?.folio ?? null,
      folioSide: folioInfos[i]?.side ?? 'right',
    });
    // 双宽页切成左右两张 A4 依次入列 —— 与 PDF 同一约定,保持单文件=单物理页。
    const faces = isSpreadTemplate(page.templateId) ? splitSpreadCanvas(canvas) : [canvas];
    for (const face of faces) {
      faceIndex += 1;
      const blob = await canvasToJpegBlob(face, quality);
      out.push({ name: `${String(faceIndex).padStart(pad, '0')}.jpg`, blob });
    }
    options.onProgress?.(i + 1, total);
  }
  return out;
}
