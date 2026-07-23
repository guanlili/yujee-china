/* ════════════════════════════════════════════════════════════════════════════
   page-face —— 「一页书长什么样」。

   移动端与桌面端是两棵独立的 UI 树(各自拥有自己的 DOM,互不重建对方的节点),
   但「书」只有一本:页面怎么渲染必须一模一样。这个模块就是那条共享缝——
   两边共享**内容渲染**与落库通道,不共享任何 UI/DOM/手势。

   原地抽自 EditorPort 的 faceInner/faceHTML(闭包版)。抽出后是纯函数:
   页序相关的 folio 由调用方算好传进来(EditorPort 有自己的缓存,移动端可直接调
   page-html-dom 的 pageFolioNumbers/pageFolioSides),这里不持有任何状态。
   ════════════════════════════════════════════════════════════════════════════ */

import { renderToStaticMarkup } from 'react-dom/server';

import type { EditorPage } from '../types';
import type { ResolveImage } from '../adapt-layout';
import { adaptPageToTemplateData } from '../adapt-layout';
import { applyFolioOverlay, preferredPageHtml, type FolioSide } from '../page-html-dom';
import { getWebTemplate } from '../web-registry';
import { PAGE } from '../templates/constants';

export type PageFaceCtx = {
  /** 展示层页码(封面/目录/封尾不编号 → null)。调用方按页序算好。 */
  folio: number | null;
  /** 页签贴该页外侧下角:左页左下 / 右页右下。 */
  folioSide: FolioSide;
  /** 传给 React 模板的总页数。 */
  total: number;
  /** 照片 id → 可展示 URL。屏显给派生图,PDF 导出给原图。 */
  resolve: ResolveImage;
};

/** 把一页渲染成静态 HTML(794×1123 原始尺寸,不含缩放外框)。
 *  HTML 模板已迁移的走单一 HTML 渲染器;未迁的回退现有 React 组件。 */
export function pageFaceInner(page: EditorPage | null, ctx: PageFaceCtx): string {
  if (!page) return '';
  // 页面真相 = 存库 html(含 AI/用户手工版面);页签按当前页序展示层计算,
  // 覆盖模板遗留 folio(封面/封尾不编号)。
  const html = preferredPageHtml(page, ctx.resolve);
  if (html !== undefined) return applyFolioOverlay(html, ctx.folio, ctx.folioSide);
  const Template = getWebTemplate(page.templateId);
  if (!Template) {
    return `<div style="padding:24px;font-size:14px">Unknown template: ${page.templateId}</div>`;
  }
  const data = adaptPageToTemplateData(
    { templateId: page.templateId, images: page.imagesJson, texts: page.textsJson },
    ctx.resolve,
  );
  return applyFolioOverlay(
    renderToStaticMarkup(<Template data={data} totalPages={ctx.total} imagePos={page.imagePosJson} />),
    ctx.folio,
    ctx.folioSide,
  );
}

/** The 794×1123 page scaled to fill the given box (matches FlipBook PageFace).
 *  缩放写死进 innerHTML 而非外层 transform:低分辨率位图快照被 transform 放大永远糊。 */
export function pageFaceHTML(
  page: EditorPage | null,
  boxW: number,
  boxH: number,
  ctx: PageFaceCtx,
): string {
  const scale = Math.min(boxW / PAGE.width, boxH / PAGE.height) || 1;
  return (
    `<div style="width:${boxW}px;height:${boxH}px;overflow:hidden;background:#fff">` +
    `<div style="transform:scale(${scale});transform-origin:top left;width:${PAGE.width}px;height:${PAGE.height}px">` +
    pageFaceInner(page, ctx) +
    `</div></div>`
  );
}
