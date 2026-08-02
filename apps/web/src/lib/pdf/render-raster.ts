import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isSpreadTemplate } from '@yujee/contracts/render';
import {
  adaptPageToTemplateData,
  type AdaptablePage,
  type ResolveImage,
} from '@/components/album/adapt-layout';
import { coverContentBox } from '@/components/album/editor-v2/image-edit-util';
import { applyFolioOverlay, fitTextBoxes, pageFolioInfos, resolveDisplayHtml, type FolioSide, type PageFolio } from '@/components/album/page-html-dom';
import { renderPageHtml } from '@/components/album/templates/html/fill-template';
import { PAGE } from '@/components/album/templates/constants';
import { getWebTemplate } from '@/components/album/web-registry';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { injectDocumentFontsInto } from '@/lib/font/clone-document-fonts';
import { faceCaptureSpec } from './face-capture';
import { splitSpreadCanvas } from './split-spread-canvas';

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
  folio: PageFolio = null,
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

/** 截图前的 cover 摊平 pass(2026-08-02)。
 *
 *  为什么存在:html2canvas-pro@2.0.4 渲染 object-fit:cover 的 <img> 时**忽略
 *  object-position**(同图不同 position 输出逐像素相同 —— 真实 Chrome 对照实验
 *  坐实,scratchpad h2c-objpos-repro)。屏幕是浏览器画的(对),导出是它复刻画的
 *  (丢位置)。修不了它,就把语义降级成它一定画对的形态:
 *
 *  把每个 cover img 的「object-fit + object-position + scale」换算成明确的
 *  width/height/left/top px(coverContentBox,与屏幕渲染同一套 cover 推导,
 *  单测钉死与 coverCropFraction 互逆)。旋转过的图(盒交换,transform 带 rotate)
 *  改为把内容偏移折进 transform 链尾的局部 translate —— html2canvas 的 transform
 *  支持是完好的(对照实验里 scale 组输出正确)。
 *
 *  只动离屏 host 里的节点,屏幕 DOM 与存库 html 一个字不碰。 */
async function flattenCoverImagesForCapture(host: HTMLElement): Promise<void> {
  const imgs = Array.from(host.querySelectorAll<HTMLImageElement>('img[data-image-slot]'));
  // 摊平要读 naturalWidth:先等解码(失败的图跳过,保持原样交给 html2canvas)。
  await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
  for (const img of imgs) {
    if (getComputedStyle(img).objectFit !== 'cover') continue;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const boxW = img.offsetWidth; // 盒交换后就是转置盒 —— cover 的参照系本来就是它
    const boxH = img.offsetHeight;
    // 位置一律读行内(烘焙/模板渲染都写行内);缺省 = 50% 50%。
    const posMatch = /^([\d.]+)%\s+([\d.]+)%$/.exec(img.style.objectPosition ?? '');
    const x = posMatch ? parseFloat(posMatch[1]!) : 50;
    const y = posMatch ? parseFloat(posMatch[2]!) : 50;
    const scale = parseFloat(/scale\(([\d.]+)\)/.exec(img.style.transform ?? '')?.[1] ?? '1') || 1;
    const rotate = parseInt(/rotate\((\d+)deg\)/.exec(img.style.transform ?? '')?.[1] ?? '0', 10) || 0;
    const box = coverContentBox(natW, natH, boxW, boxH, { x, y, scale });
    if (!box) continue;
    const wrapper = img.parentElement;
    if (wrapper && !getComputedStyle(wrapper).position.match(/absolute|relative|fixed/)) {
      wrapper.style.position = 'relative';
    }
    img.style.objectFit = 'fill';
    img.style.objectPosition = '';
    img.style.width = `${box.width}px`;
    img.style.height = `${box.height}px`;
    img.style.position = 'absolute';
    if (!rotate) {
      img.style.left = `${box.left}px`;
      img.style.top = `${box.top}px`;
      img.style.transform = '';
      img.style.transformOrigin = '';
    } else {
      // 盒交换的居中锚不变;内容偏移折进 rotate 之后的局部 translate(旋转坐标系)。
      const ox = (0.5 - x / 100) * (box.width - boxW);
      const oy = (0.5 - y / 100) * (box.height - boxH);
      img.style.left = '50%';
      img.style.top = '50%';
      img.style.transform = `translate(-50%, -50%) rotate(${rotate}deg) translate(${ox}px, ${oy}px)`;
      img.style.transformOrigin = '';
    }
  }
}

export interface FaceRenderOptions {
  scale?: number; // 截图倍率，默认 3
  folio?: PageFolio; // 页码；null=不贴，双宽页={left,right}
  folioSide?: FolioSide; // 页码贴左下 / 右下
  total?: number; // 总页数（供 React 回退模板用）
}

// 单个 face → 离屏 html2canvas 截图 → 返回 canvas。尺寸由 faceCaptureSpec() 决定：
// 普通页 794*scale × 1123*scale；双宽(#303)页 1588*scale × 1123*scale —— 调用方若要
// 纯 A4 输出，自己用 splitSpreadCanvas 切成左右两张（PDF / 单页 JPG 都这么做）。
// PDF / 单页 JPG / 拼图 / Live 视频四条导出路径共用的原语。调用方需先 loadAlbumFonts。
export async function renderFaceToCanvas(
  page: AdaptablePage & { html?: string },
  resolveImage: ResolveImage,
  options: FaceRenderOptions = {},
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 3;
  const { default: html2canvas } = await import('html2canvas-pro');
  // 离屏 host：按 pageBox() 开盒（普通页 794×1123；双宽页 1588×1123），移出视口，
  // 独立于当前缩放/翻页状态。#303:此前这里硬编码单页宽，双宽页只截到左半。
  const capture = faceCaptureSpec(page.templateId);
  const host = document.createElement('div');
  host.style.cssText = capture.cssText;
  host.innerHTML = renderFaceHtml(
    page, resolveImage, options.total ?? 1, options.folio ?? null, options.folioSide ?? 'right',
  );
  document.body.appendChild(host);
  try {
    // 字体就绪后再截，避免中文/艺术字掉成回退字。
    await documentFontsReady();
    // 字体确定后再做固定高度文字槽的字号自适应,与画板同一 pass,屏幕/导出一致。
    fitTextBoxes(host);
    // 截图前把 cover 语义摊平成纯几何:html2canvas-pro 会忽略 <img> 的
    // object-position(2026-08-02 真实浏览器对照实验坐实),用户调过的照片位置
    // 在导出里全部回到默认。摊平后与屏幕逐像素等价,它想忽略也没得忽略。
    await flattenCoverImagesForCapture(host);
    return await html2canvas(host, {
      width: capture.width,
      height: capture.height,
      scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      // 动态字体注入克隆文档,否则克隆里用回退字体测宽 → 词距错位(详见该模块注释)。
      onclone: injectDocumentFontsInto,
    });
  } finally {
    host.remove();
  }
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

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'px', format: [PAGE.width, PAGE.height], orientation: 'portrait' });

  // 页签按导出页序计算(内页 1..N;封面/封尾/目录 null),与画板同一套覆盖层。
  const folioInfos = pageFolioInfos(pages.map((p) => p.templateId));
  let first = true;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const canvas = await renderFaceToCanvas(page, resolveImage, {
      scale, total,
      folio: folioInfos[i]?.folio ?? null,
      folioSide: folioInfos[i]?.side ?? 'right',
    });
    // 双宽页切成左右两张 A4 依次写入 —— PDF 保持纯竖版,可直送印刷。
    const faces = isSpreadTemplate(page.templateId) ? splitSpreadCanvas(canvas) : [canvas];
    for (const face of faces) {
      const img = face.toDataURL('image/jpeg', jpegQuality);
      if (!first) doc.addPage([PAGE.width, PAGE.height], 'portrait');
      first = false;
      doc.addImage(img, 'JPEG', 0, 0, PAGE.width, PAGE.height);
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
