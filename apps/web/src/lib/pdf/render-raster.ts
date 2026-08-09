import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isSpreadTemplate } from '@yujee/contracts/render';
import {
  adaptPageToTemplateData,
  type AdaptablePage,
  type ResolveImage,
} from '@/components/album/adapt-layout';
import { coverContentBox, rotatedCoverTranslate } from '@/components/album/editor-v2/image-edit-util';
import { applyFolioOverlay, applyImageRotatePatches, fitTextBoxes, pageFolioInfos, resolveDisplayHtml, type FolioSide, type PageFolio } from '@/components/album/page-html-dom';
import { renderPageHtml } from '@/components/album/templates/html/fill-template';
import { PAGE } from '@/components/album/templates/constants';
import { getWebTemplate } from '@/components/album/web-registry';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { injectDocumentFontsInto } from '@/lib/font/clone-document-fonts';
import { bleedCssPx, extendCanvasEdges, pdfPageFormat } from './extend-canvas-edges';
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
  // 出血毫米数,默认 0(印刷版传 3):四边边缘延伸 + 页面尺寸等比 216×303mm。
  // 详见 docs/specs/2026-08-03-pdf-bleed-export-design.md。
  bleedMm?: number;
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
  // 空槽在即时渲染里保留 {{IMG_SRC:slot}} token(fill-template 契约),再解析一遍
  // 渲成缺图占位 —— 与画板同脸,导出不出碎图标。旋转槽即时渲染也补不上
  // (IMG_TF 不含 rotate),渲染后补盒交换,与 preferredPageHtml 同口径。
  if (html !== undefined)
    return applyFolioOverlay(
      resolveDisplayHtml(applyImageRotatePatches(html, page.imagePos), page.images, resolveImage),
      folio,
      folioSide,
    );
  const Template = getWebTemplate(page.templateId);
  if (!Template) return `<div style="padding:24px;font-size:14px">Unknown template: ${page.templateId}</div>`;
  const data = adaptPageToTemplateData(page, resolveImage);
  return renderToStaticMarkup(
    createElement(Template, { data, totalPages: total, imagePos: page.imagePos }),
  );
}

/** 截图前的 cover 摊平 pass(2026-08-02 v1;2026-08-03 v2 泛化)。
 *
 *  为什么存在:html2canvas-pro@2.0.4 渲染 object-fit:cover 的 <img> 时**忽略
 *  object-position**(同图不同 position 输出逐像素相同 —— 真实 Chrome 对照实验
 *  坐实,scratchpad h2c-objpos-repro)。屏幕是浏览器画的(对),导出是它复刻画的
 *  (丢位置)。修不了它,就把语义降级成它一定画对的形态。
 *
 *  v1 教训(2026-08-03 用户上报「调过显示区域的图导出全变形」):v1 从行内样式
 *  正则读 x/y/scale,再把 img 摊成「放大 + 绝对定位」—— 只认编辑器写的窄格式。
 *  AI 手写页(write_page_html 只守锚点,不守 wrapper>img 渲染模型)的 class 样式、
 *  关键字/px 定位、translate 链全被读歪;裸 img(无裁切 wrapper,图框就是 img
 *  自己的盒)更是被放大后彻底失去裁切,整页乱窜(真实浏览器取证 H1-H6,偏差
 *  20-163px)。
 *
 *  v2 做法:按**计算样式**(getComputedStyle,类/行内/关键字/单位统统已解析)
 *  精确复算屏幕可见的源图窗口 —— 内容盒 = cover 布局(object-position 偏移)再经
 *  CSS transform(绕 transform-origin 的均匀缩放 + 平移,读矩阵)—— 把这块窗口
 *  预烘进一张与图框同宽高比的 canvas,原地换掉 img.src,清掉 position/transform。
 *  布局(盒、定位、圆角、wrapper 有无)一个字不动;cover 对同宽高比位图是恒等
 *  映射,h2c 想忽略 object-position 也无从忽略。矩阵含旋转/非均匀缩放(AI 的
 *  装饰性倾斜)超出 cover 摊平模型:保守跳过,交给 h2c 原生画(退化为中心裁,
 *  绝不半应用出「整图 fill 压进框」的变形)。
 *
 *  旋转图(编辑器盒交换写法:行内 rotate(90|180|270deg),格式可信)保留 v1 的
 *  显式几何摊平 —— 2026-08-02 导出实测钉死,盒交换 + 中心缩放模型见
 *  rotatedCoverTranslate。
 *
 *  只动离屏 host 里的节点,屏幕 DOM 与存库 html 一个字不碰。 */
async function flattenCoverImagesForCapture(host: HTMLElement, captureScale: number): Promise<void> {
  const imgs = Array.from(host.querySelectorAll<HTMLImageElement>('img[data-image-slot]'));
  // 摊平要读 naturalWidth:先等解码(失败的图跳过,保持原样交给 html2canvas)。
  await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
  for (const img of imgs) {
    const computed = getComputedStyle(img);
    if (computed.objectFit !== 'cover') continue;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const boxW = img.offsetWidth; // 盒交换后就是转置盒 —— cover 的参照系本来就是它
    const boxH = img.offsetHeight;
    if (!(natW > 0) || !(natH > 0) || !(boxW > 0) || !(boxH > 0)) continue;

    const rotate = parseInt(/rotate\((\d+)deg\)/.exec(img.style.transform ?? '')?.[1] ?? '0', 10) || 0;
    if (rotate && rotate % 90 === 0) {
      // ── 编辑器盒交换旋转:行内格式可信,沿用显式几何摊平 ──
      const posMatch = /^([\d.]+)%\s+([\d.]+)%$/.exec(img.style.objectPosition ?? '');
      const x = posMatch ? parseFloat(posMatch[1]!) : 50;
      const y = posMatch ? parseFloat(posMatch[2]!) : 50;
      const scale = parseFloat(/scale\(([\d.]+)\)/.exec(img.style.transform ?? '')?.[1] ?? '1') || 1;
      const box = coverContentBox(natW, natH, boxW, boxH, { x, y, scale });
      if (!box) continue;
      const wrapper = img.parentElement;
      if (wrapper && !getComputedStyle(wrapper).position.match(/absolute|relative|fixed/)) {
        wrapper.style.position = 'relative';
      }
      // 盒交换的居中锚不变;内容偏移折进 rotate 之后的局部 translate(旋转坐标系)。
      // 旋转态的 scale 是**绕盒中心**(transform 链 scale 在 rotate 之后、origin=中心),
      // 不是非旋转态的焦点缩放 —— 偏移必须用 rotatedCoverTranslate 的中心模型算,
      // 直接套 coverContentBox 的 left/top 会整体错位(2026-08-02 导出实测)。
      const { ox, oy } = rotatedCoverTranslate(box, boxW, boxH, { x, y, scale });
      img.style.objectFit = 'fill';
      img.style.objectPosition = '';
      img.style.width = `${box.width}px`;
      img.style.height = `${box.height}px`;
      img.style.position = 'absolute';
      img.style.left = '50%';
      img.style.top = '50%';
      img.style.transform = `translate(-50%, -50%) rotate(${rotate}deg) translate(${ox}px, ${oy}px)`;
      img.style.transformOrigin = '';
      continue;
    }

    // ── 非旋转:按计算样式预烘位图,布局不动 ──
    const mtx = parseMatrix2d(computed.transform);
    if (!mtx) continue; // matrix3d 等超出模型:保持原样
    const su = Math.hypot(mtx.a, mtx.b);
    const sv = Math.hypot(mtx.c, mtx.d);
    // 带旋转/非均匀缩放的矩阵超出 cover 摊平模型:保守不动。
    if (!(su > 0) || Math.abs(su - sv) > su * 0.01 || Math.abs(mtx.b) > su * 0.01) continue;
    const s = su;
    // cover 布局(scale=1):内容盒尺寸 + object-position 偏移。
    const k0 = Math.max(boxW / natW, boxH / natH);
    const cw = natW * k0;
    const ch = natH * k0;
    const posParts = computed.objectPosition.split(' ');
    const offX = objectPositionOffset(posParts[0] ?? '', boxW, cw);
    const offY = objectPositionOffset(posParts[1] ?? '', boxH, ch);
    if (offX === null || offY === null) continue;
    const originParts = computed.transformOrigin.split(' ').map((v) => parseFloat(v));
    const ox = Number.isFinite(originParts[0]) ? originParts[0]! : boxW / 2;
    const oy = Number.isFinite(originParts[1]) ? originParts[1]! : boxH / 2;
    // 屏幕真正画出的内容矩形:内容盒经 transform(绕 origin)映射。
    const paintedLeft = ox + s * (offX - ox) + mtx.e;
    const paintedTop = oy + s * (offY - oy) + mtx.f;
    const paintedW = s * cw;
    // 图框窗口 [0,0,boxW,boxH] 映回源图像素窗口。
    const perPx = natW / paintedW; // 均匀缩放下与 natH/paintedH 相等
    const sx = -paintedLeft * perPx;
    const sy = -paintedTop * perPx;
    const sw = boxW * perPx;
    const sh = boxH * perPx;
    const ix = Math.max(0, sx);
    const iy = Math.max(0, sy);
    const ix2 = Math.min(natW, sx + sw);
    const iy2 = Math.min(natH, sy + sh);
    if (!(ix2 > ix && iy2 > iy)) continue; // 可见窗口完全出图:保持原样
    // 预烘分辨率跟截图倍率,但不超过源图密度(超采样只涨体积不涨细节)。
    const res = Math.min(captureScale, Math.max(1, perPx));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(boxW * res));
    canvas.height = Math.max(1, Math.round(boxH * res));
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(
      img,
      ix, iy, ix2 - ix, iy2 - iy,
      ((ix - sx) / sw) * canvas.width,
      ((iy - sy) / sh) * canvas.height,
      ((ix2 - ix) / sw) * canvas.width,
      ((iy2 - iy) / sh) * canvas.height,
    );
    // px 定位/translate 能把内容推出图框(浏览器露背景):出界留透明 → PNG;
    // 全覆盖(绝大多数)走 JPEG,体积小一个量级。
    const covered = ix <= sx + 0.5 && iy <= sy + 0.5 && ix2 >= sx + sw - 0.5 && iy2 >= sy + sh - 0.5;
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL(covered ? 'image/jpeg' : 'image/png', 0.95);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
    // 先钉死布局尺寸再换 src:auto 尺寸的裸 img 换 src 会跳大小。
    img.style.width = `${boxW}px`;
    img.style.height = `${boxH}px`;
    img.style.objectPosition = '';
    img.style.transform = 'none';
    img.style.transformOrigin = '';
    img.src = dataUrl;
    await img.decode().catch(() => undefined);
  }
}

/** 计算样式的 transform → 2D 矩阵。'none' 视为单位阵;matrix3d 等返回 null。 */
function parseMatrix2d(
  t: string,
): { a: number; b: number; c: number; d: number; e: number; f: number } | null {
  if (!t || t === 'none') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const m = /^matrix\(([^)]+)\)$/.exec(t);
  if (!m) return null;
  const parts = m[1]!.split(',').map((v) => parseFloat(v));
  if (parts.length !== 6 || parts.some((v) => !Number.isFinite(v))) return null;
  return { a: parts[0]!, b: parts[1]!, c: parts[2]!, d: parts[3]!, e: parts[4]!, f: parts[5]! };
}

/** 计算样式的 object-position 单轴分量 → 内容盒相对图框的偏移 px(scale=1 语义)。
 *  百分比:offset = (box - content) * p / 100(CSS 语义:内容的 p% 点对齐框的 p% 点);
 *  px:字面偏移。计算值只有这两种形态(关键字已被浏览器解析成百分比)。 */
function objectPositionOffset(component: string, box: number, content: number): number | null {
  const v = parseFloat(component);
  if (!Number.isFinite(v)) return null;
  if (component.endsWith('%')) return ((box - content) * v) / 100;
  return v;
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
    // 截图前把 cover 语义摊平(预烘位图):html2canvas-pro 会忽略 <img> 的
    // object-position(2026-08-02 真实浏览器对照实验坐实),用户调过的照片位置
    // 在导出里全部回到默认。摊平后与屏幕逐像素等价,它想忽略也没得忽略。
    // captureScale 决定预烘位图分辨率,与截图倍率同源,免得高倍截图吃到低清位图。
    await flattenCoverImagesForCapture(host, scale);
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
  // 出血(2026-08-03 设计):页面尺寸用浮点 CSS px 保物理比例精确(3mm → 等比
  // 216×303mm),画布延伸宽取整。bleedMm 缺省 0 时 pdfPageFormat 回 [794,1123]、
  // extendCanvasEdges 原样返回 —— 标准路径零改动。
  const bleedMm = options.bleedMm ?? 0;
  const pageFormat = pdfPageFormat(bleedMm);
  const bleedDevicePx = Math.round(bleedCssPx(bleedMm) * scale);

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'px', format: pageFormat, orientation: 'portrait' });

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
      // 出血在**拆半之后**做:双宽页每半各自四边延伸(书脊侧也延伸,印厂拼版通用)。
      const bled = extendCanvasEdges(face, bleedDevicePx);
      const img = bled.toDataURL('image/jpeg', jpegQuality);
      if (!first) doc.addPage(pageFormat, 'portrait');
      first = false;
      doc.addImage(img, 'JPEG', 0, 0, pageFormat[0], pageFormat[1]);
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
