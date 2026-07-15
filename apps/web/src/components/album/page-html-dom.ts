import { renderPageHtml, type ResolveImage } from '@yujee/contracts/render';

// C 方案编辑器侧:页面真相 = 存库 html。
// - resolveDisplayHtml:把存库 html 里的 {{IMG_SRC:slot}} token 解析成真实 src
//   (blob URL / dataURL),供画板 dangerouslySetInnerHTML / html2canvas 使用。
// - preferredPageHtml:有存库 html 用它(AI/用户的手工版面),没有(存量数据/
//   模板未注册)回退模板即时渲染。
// - patchHtmlText:用户改字在 html 上原位打补丁(与 design-agent html-guard 同
//   一约定的字符串实现;两包构建体系不同,少量复制,改动需两边同步)。

export interface HtmlPage {
  templateId: string;
  imagesJson: Record<string, string>;
  textsJson: Record<string, string>;
  imagePosJson?: Record<string, { x: number; y: number; scale: number }>;
  htmlJson?: string;
}

const IMG_SRC_TOKEN_RE = /\{\{IMG_SRC:([^}|]+)\}\}/g;

export function resolveDisplayHtml(
  html: string,
  images: Record<string, string>,
  resolveImage: ResolveImage,
): string {
  return html.replace(IMG_SRC_TOKEN_RE, (_full, slotRaw: string) => {
    const slot = slotRaw.trim();
    const photoId = images[slot];
    return photoId ? (resolveImage(photoId) ?? '') : '';
  });
}

export function preferredPageHtml(page: HtmlPage, resolveImage: ResolveImage): string | undefined {
  if (typeof page.htmlJson === 'string' && page.htmlJson.length > 0) {
    return resolveDisplayHtml(page.htmlJson, page.imagesJson, resolveImage);
  }
  return renderPageHtml(
    {
      templateId: page.templateId,
      images: page.imagesJson,
      texts: page.textsJson,
      imagePos: page.imagePosJson,
    },
    resolveImage,
  );
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 槽位级改字:替换存库 html 中 data-text-key 元素的内容,保留其余版面。
 * 找不到锚点返回 null(调用方回退整页重烘或仅更新数据层)。 */
export function patchHtmlText(html: string, slotId: string, value: string): string | null {
  const escapedSlot = slotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRe = new RegExp(`<([a-z0-9]+)\\b[^>]*data-text-key="${escapedSlot}"[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = html.indexOf(`</${m[1]}>`, start);
  if (end === -1) return null;
  return html.slice(0, start) + escapeHtmlText(value) + html.slice(end);
}

// ── 手工编辑固化进存库 html(C 方案:页面真相 = html) ─────────────────────────
// 编辑器的字号/字体/图片位置操作先改画出来的 DOM 节点(即时反馈),但那只是
// innerHTML 幻影 —— 不把同样的改动写回 page.html,任何重绘/刷新都会回退,
// AI(读 draft html)和导出(渲 draft html)也永远看不到。以下两个 patcher 是
// 编辑器(本地即时同步)与 albumService.updatePage(落库)共用的唯一实现。

const STYLE_PROP_RE = /^[a-z-]+$/;
const STYLE_VALUE_BAN = /[;{}<>"]/; // 允许单引号:font-family 栈里的 'Segoe UI' 等多词字体名需要它

function upsertStyleAttr(openTag: string, props: Record<string, string | null>): string | null {
  for (const [prop, value] of Object.entries(props)) {
    if (!STYLE_PROP_RE.test(prop)) return null;
    if (value !== null && STYLE_VALUE_BAN.test(value)) return null; // style 属性注入护栏
  }
  const styleMatch = /style="([^"]*)"/.exec(openTag);
  const decls = new Map<string, string>();
  if (styleMatch) {
    for (const part of styleMatch[1]!.split(';')) {
      const idx = part.indexOf(':');
      if (idx > 0) decls.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
    }
  }
  for (const [prop, value] of Object.entries(props)) {
    if (value === null) decls.delete(prop);
    else decls.set(prop, value);
  }
  const nextStyle = [...decls.entries()].map(([k, v]) => `${k}:${v}`).join(';');
  if (styleMatch) return openTag.replace(styleMatch[0], `style="${nextStyle}"`);
  return openTag.replace(/>$/, ` style="${nextStyle}">`);
}

/** 文字槽元素的行内 style 覆写(value=null 移除该属性)。找不到锚点/非法值返回 null。 */
export function patchHtmlTextStyle(
  html: string,
  slotId: string,
  props: Record<string, string | null>,
): string | null {
  const escapedSlot = slotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRe = new RegExp(`<[a-z0-9]+\\b[^>]*data-text-key="${escapedSlot}"[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  const patched = upsertStyleAttr(m[0], props);
  if (patched === null) return null;
  return html.slice(0, m.index) + patched + html.slice(m.index + m[0].length);
}

/** 图片位置/缩放固化(IMG_POS/IMG_TF 烘制后是具体值,必须回写)。与编辑器
 *  applyLiveImagePos 写的 CSS 逐字一致:objectPosition + scale>1 时 transform。 */
export function patchHtmlImagePos(
  html: string,
  slotId: string,
  pos: { x: number; y: number; scale: number },
): string | null {
  const escapedSlot = slotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRe = new RegExp(`<img\\b[^>]*data-image-slot="${escapedSlot}"[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  const patched = upsertStyleAttr(m[0], {
    'object-position': `${pos.x}% ${pos.y}%`,
    transform: pos.scale > 1 ? `scale(${pos.scale})` : null,
    'transform-origin': pos.scale > 1 ? `${pos.x}% ${pos.y}%` : null,
  });
  if (patched === null) return null;
  return html.slice(0, m.index) + patched + html.slice(m.index + m[0].length);
}

// ── 文字自适应(fit-text)展示层 pass ──────────────────────────────────────
// 文字槽带固定 height(模板源码里烘定)时,内容装不下则逐步缩小字号直到塞进框。
// 只动展示 DOM(与 folio 覆盖同层),存库 html 真相不变;画板、缩略图、栅格 PDF
// 截图前都要跑同一个 pass,保证屏幕和导出一致。

const FIT_TEXT_MIN_PX = 9;

/** 对 root 内所有固定高度的文字槽做字号自适应。幂等,可在重绘后反复调用。 */
export function fitTextBoxes(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-text-key]').forEach((el) => {
    if (el.tagName === 'IMG') return;
    if (!el.style.height) return; // 只处理模板里显式固定高度的框
    if (el.style.display === 'none') return; // folio 等被展示层隐藏的槽
    const overflows = () =>
      el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    if (!overflows()) return;
    let size = parseFloat(window.getComputedStyle(el).fontSize) || 16;
    while (size > FIT_TEXT_MIN_PX && overflows()) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  });
}

// ── 页签(folio)覆盖层 ─────────────────────────────────────────────────────
// 页码不再依赖烘进 html 的 folio 槽(重排页序后必然过期):展示层每次按当前页序
// 计算,统一小样式固定右下角;封面/目录/封尾不编号。模板遗留的 folio 槽元素在
// 展示时隐藏(存库 html 不动,锚点契约不受影响)。

import { getTemplate } from '@yujee/contracts/templates';

const NON_FOLIO_CATEGORIES = new Set(['cover', 'toc', 'ending']);

/** 按当前页序给每页算页签:内页从 1 连续编号,封面/目录/封尾为 null。 */
export function pageFolioNumbers(templateIds: string[]): (number | null)[] {
  let n = 0;
  return templateIds.map((id) => {
    const category = getTemplate(id)?.category;
    if (category && NON_FOLIO_CATEGORIES.has(category)) return null;
    n += 1;
    return n;
  });
}

const FOLIO_ANCHOR_OPEN_RE = /<([a-z0-9]+)((?:[^>]*?)data-text-key="folio(?:\[\d+\])?"[^>]*)>/gi;

/** 展示层页签:隐藏模板遗留 folio 元素;folio 非 null 时在右下角注入统一页码。 */
export function applyFolioOverlay(html: string, folio: number | null): string {
  let out = html.replace(FOLIO_ANCHOR_OPEN_RE, (_full, tag: string, attrs: string) => {
    const nextAttrs = attrs.includes('style="')
      ? attrs.replace('style="', 'style="display:none;')
      : `${attrs} style="display:none"`;
    return `<${tag}${nextAttrs}>`;
  });
  if (folio !== null) {
    const overlay =
      `<div data-page-folio="true" style="position:absolute;right:36px;bottom:26px;` +
      `font-size:12px;letter-spacing:0.12em;color:#a09b8e;` +
      `font-family:'Inter','Noto Sans SC',sans-serif;pointer-events:none">${folio}</div>`;
    const closeAt = out.lastIndexOf('</div>');
    if (closeAt >= 0) out = out.slice(0, closeAt) + overlay + out.slice(closeAt);
  }
  return out;
}
