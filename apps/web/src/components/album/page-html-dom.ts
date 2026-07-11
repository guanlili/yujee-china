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
