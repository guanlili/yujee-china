import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  adaptPageToTemplateData,
  type AdaptablePage,
  type ResolveImage,
} from '@/components/album/adapt-layout';
import { applyFolioOverlay, fitTextBoxes, pageFolioNumbers, pageFolioSides, resolveDisplayHtml, type FolioSide } from '@/components/album/page-html-dom';
import { renderPageHtml } from '@/components/album/templates/html/fill-template';
import { PAGE } from '@/components/album/templates/constants';
import { getWebTemplate } from '@/components/album/web-registry';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { injectDocumentFontsInto } from '@/lib/font/clone-document-fonts';

// 栅格 PDF 渲染器（收敛单渲染器）：逐页把「屏幕渲染」离屏渲成 794×1123 → html2canvas
// 高倍截图 → jsPDF 每页贴图。PDF 因此与屏幕像素级一致，index↔pdf 两套渲染器的分歧
// 从此消失。截的是屏幕渲染（HTML 模板或回退的 React 组件），所以全部模板都适用。
//
// 只从点击 handler `await import()` 本模块，别静态 import（html2canvas-pro/jspdf 体积大）。
//
// 印刷级：scale 3-4（794×1123 × 3 ≈ 2382×3369 ≈ 288 DPI，对齐消费级相册印刷）。
// 逐页离屏 host、截完立即释放，控内存；喂全分辨率原图由 resolveImage 决定（调用方传
// 全分辨率 data URL，不走导出降尺寸）。

export interface RasterPdfOptions {
  scale?: number; // 截图倍率，默认 3（≈288 DPI）
  jpegQuality?: number; // JPEG 质量 0..1，默认 0.92
  onProgress?: (done: number, total: number) => void;
}

// 一页 → 屏幕渲染的 HTML 字符串:存库 html(页面真相,含手工版面)优先,
// 缺失回退模板即时渲染,再缺回退 React 组件(与画板同源)。
function renderFaceHtml(
  page: AdaptablePage & { html?: string },
  resolveImage: ResolveImage,
  total: number,
  folio: number | null = null,
  folioSide: FolioSide = 'right',
): string {
  if (typeof page.html === 'string' && page.html.length > 0) {
    return applyFolioOverlay(resolveDisplayHtml(page.html, page.images, resolveImage), folio, folioSide);
  }
  const html = renderPageHtml(
    { templateId: page.templateId, images: page.images, texts: page.texts, imagePos: page.imagePos },
    resolveImage,
  );
  if (html !== undefined) return applyFolioOverlay(html, folio, folioSide);
  const Template = getWebTemplate(page.templateId);
  if (!Template) return `<div style="padding:24px;font-size:14px">Unknown template: ${page.templateId}</div>`;
  const data = adaptPageToTemplateData(page, resolveImage);
  return renderToStaticMarkup(
    createElement(Template, { data, totalPages: total, imagePos: page.imagePos }),
  );
}

export async function renderAlbumPdfRaster(
  pages: (AdaptablePage & { html?: string })[],
  resolveImage: ResolveImage,
  options: RasterPdfOptions = {},
): Promise<Blob> {
  // Install the same per-album CJK subsets used by the live preview before any
  // off-screen HTML is measured. Failure degrades to the existing CSS fallback.
  await loadAlbumFonts(pages).catch(() => undefined);
  const scale = options.scale ?? 3;
  const jpegQuality = options.jpegQuality ?? 0.92;
  const total = pages.length;

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf'),
  ]);

  const doc = new jsPDF({ unit: 'px', format: [PAGE.width, PAGE.height], orientation: 'portrait' });

  // 页签按导出页序计算(内页 1..N;封面/封尾/目录 null),与画板同一套覆盖层。
  const folios = pageFolioNumbers(pages.map((p) => p.templateId));
  // 页签贴订口侧,避开印后外缘裁切(左页右下 / 右页左下),与画板同一套推导。
  const folioSides = pageFolioSides(pages.map((p) => p.templateId));
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    // 离屏 host：固定 794×1123、移出视口，独立于当前缩放/翻页状态。
    const host = document.createElement('div');
    host.style.cssText =
      `position:fixed;left:-99999px;top:0;width:${PAGE.width}px;height:${PAGE.height}px;` +
      `overflow:hidden;background:#fff`;
    host.innerHTML = renderFaceHtml(page, resolveImage, total, folios[i] ?? null, folioSides[i] ?? 'right');
    document.body.appendChild(host);
    try {
      // 字体就绪后再截，避免中文/艺术字掉成回退字。
      await documentFontsReady();
      // 字体确定后再做固定高度文字槽的字号自适应,与画板同一 pass,屏幕/导出一致。
      fitTextBoxes(host);
      const canvas = await html2canvas(host, {
        width: PAGE.width,
        height: PAGE.height,
        scale,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        // 动态字体注入克隆文档,否则克隆里用回退字体测宽 → 词距错位(详见该模块注释)。
        onclone: injectDocumentFontsInto,
      });
      const img = canvas.toDataURL('image/jpeg', jpegQuality);
      if (i > 0) doc.addPage([PAGE.width, PAGE.height], 'portrait');
      doc.addImage(img, 'JPEG', 0, 0, PAGE.width, PAGE.height);
    } finally {
      host.remove();
    }
    options.onProgress?.(i + 1, total);
  }

  return doc.output('blob');
}

async function documentFontsReady(): Promise<void> {
  const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
  if (fonts?.ready) {
    try {
      await fonts.ready;
    } catch {
      // 字体加载失败不阻塞导出。
    }
  }
}
