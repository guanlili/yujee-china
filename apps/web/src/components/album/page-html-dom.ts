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

// 存库 html 的 style 属性值里,字体名的 `"` 被转义成了 HTML 实体 `&quot;`(否则和属性
// 外层引号冲突)。而实体末尾的 `;` 不是 CSS 声明分隔符 —— 直接 split(';') 会把
// font-family:&quot;A&quot;,&quot;B&quot;,serif 的字体栈从每个 &quot; 的分号处切碎、丢掉
// 无冒号的碎片,导致 font-family 损坏(改颜色/字号等任意样式都会连带毁掉字体栈)。先把
// 实体末尾的分号占位保护,split 后还原。
function splitStyleDeclarations(style: string): string[] {
  const SEMI = String.fromCharCode(0xE000); // 私有区占位符:绝不出现在 style 值里
  const guarded = style.replace(/&#?[a-z0-9]+;/gi, (m) => m.slice(0, -1) + SEMI);
  return guarded.split(';').map((part) => part.split(SEMI).join(';'));
}

function upsertStyleAttr(openTag: string, props: Record<string, string | null>): string | null {
  for (const [prop, value] of Object.entries(props)) {
    if (!STYLE_PROP_RE.test(prop)) return null;
    if (value !== null && STYLE_VALUE_BAN.test(value)) return null; // style 属性注入护栏
  }
  const styleMatch = /style="([^"]*)"/.exec(openTag);
  const decls = new Map<string, string>();
  if (styleMatch) {
    for (const part of splitStyleDeclarations(styleMatch[1]!)) {
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

/** 页级样式覆写:锚定页 html 最外层的页根元素(`data-template=…`),给它的行内
 *  style upsert 属性(value=null 移除)。用于「书页背景色」这类整页设计(background-color)。
 *  移除 background-color 后自动回落到模板根自带的 `background:#fff`(默认不写死白)。
 *  找不到页根/非法值返回 null(调用方回退整页重烘或仅更新数据层,与 textStyle 同口径)。 */
export function patchHtmlPageStyle(
  html: string,
  props: Record<string, string | null>,
): string | null {
  // 页根是 html 里第一个带 data-template 的元素(见 render/html-templates/*:794×1123 外框)。
  const openRe = /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i;
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

// 记忆化:同一(槽 key + class + 初始字号 + 框尺寸 + 文本)的收敛字号是确定的。
// 命中直接写字号,零测量(每次 scrollHeight 读取都是一次强制同步 reflow,这是
// 20+ 页 repaint 的主要 CPU 开销之一)。字体异步加载会改变换行,故 key 掺入
// document.fonts.status:loading 期不与 loaded 期互相污染。上限防长会话膨胀。
const FIT_MEMO_MAX = 4000;
const fitMemo = new Map<string, number>();

function memoSet(key: string, size: number): void {
  fitMemo.set(key, size);
  if (fitMemo.size <= FIT_MEMO_MAX) return;
  for (const oldKey of fitMemo.keys()) {
    if (fitMemo.size <= FIT_MEMO_MAX) break;
    fitMemo.delete(oldKey);
  }
}

/** 对 root 内所有固定高度的文字槽做字号自适应。幂等,可在重绘后反复调用。 */
export function fitTextBoxes(root: HTMLElement): void {
  const fontsStatus = (document as { fonts?: { status?: string } }).fonts?.status ?? 'na';
  root.querySelectorAll<HTMLElement>('[data-text-key]').forEach((el) => {
    if (el.tagName === 'IMG') return;
    if (!el.style.height) return; // 只处理模板里显式固定高度的框
    if (el.style.display === 'none') return; // folio 等被展示层隐藏的槽
    // 不可测量(display:none 祖先/未布局)时 scrollHeight 恒 0,"不溢出"是假象 ——
    // 跳过且不写 memo,防止污染各表面共享的字号缓存(画板/书籍视图必须同字号)。
    if (el.clientHeight === 0 && el.clientWidth === 0) return;
    const initial = parseFloat(el.style.fontSize) || 0;
    const key =
      `${el.getAttribute('data-text-key')}|${el.className}|${el.style.width}x${el.style.height}` +
      `|${initial}|${fontsStatus}|${el.textContent ?? ''}`;
    const memo = fitMemo.get(key);
    if (memo !== undefined) {
      if (memo > 0) el.style.fontSize = `${memo}px`;
      return;
    }
    const overflows = () =>
      el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    if (!overflows()) {
      memoSet(key, 0); // 0 = 初始字号本来就装得下,不动
      return;
    }
    // 二分收敛:字号→溢出是单调的。逐像素递减是 O(初始字号) 次强制重排,
    // 二分是 O(log) 次。找「不溢出的最大字号」,全都溢出则取下限。
    let lo = FIT_TEXT_MIN_PX;
    let hi = Math.max(FIT_TEXT_MIN_PX, Math.floor(parseFloat(window.getComputedStyle(el).fontSize) || 16) - 1);
    el.style.fontSize = `${lo}px`;
    if (overflows()) {
      memoSet(key, lo);
      return;
    }
    while (lo < hi) {
      const mid = Math.ceil((lo + hi + 1) / 2);
      el.style.fontSize = `${mid}px`;
      if (overflows()) hi = mid - 1;
      else lo = mid;
    }
    el.style.fontSize = `${lo}px`;
    memoSet(key, lo);
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

// 页签贴订口(书脊)侧,避开外缘印后裁切:左页订口在右→右下角,右页订口在左→左下角。
// 侧别按 buildSpreads 的两两配对推出(与 spreads.ts 一致:cover 右单页/ending 左单页
// 都单独成对、不参与配对,其余 interior+toc 顺序两两配),所以「奇偶」不等于左右——
// 有没有目录页会整体错位一位,必须按真实版面推,不能只看页码奇偶。
export type FolioSide = 'left' | 'right';

/** 每页页签该贴哪侧(左页→right/右下,右页→left/左下)。folio 为 null 的页侧别无意义。 */
export function pageFolioSides(templateIds: string[]): FolioSide[] {
  // 默认 right(右下):左页/末尾落单页/兜底都贴右,与旧行为一致。
  const sides: FolioSide[] = templateIds.map(() => 'right');
  let pendingLeft: number | null = null;
  templateIds.forEach((id, i) => {
    const category = getTemplate(id)?.category;
    if (category === 'cover' || category === 'ending') {
      pendingLeft = null; // 单页,冲掉未配对的左页(它保持默认 right)
      return;
    }
    if (pendingLeft === null) {
      pendingLeft = i; // 左页:订口在右 → 保持 'right'
    } else {
      sides[i] = 'left'; // 右页:订口在左 → 左下角
      pendingLeft = null;
    }
  });
  return sides;
}

const FOLIO_ANCHOR_OPEN_RE = /<([a-z0-9]+)((?:[^>]*?)data-text-key="folio(?:\[\d+\])?"[^>]*)>/gi;

/** 展示层页签:隐藏模板遗留 folio 元素;folio 非 null 时在订口侧下角注入统一页码。 */
export function applyFolioOverlay(html: string, folio: number | null, side: FolioSide = 'right'): string {
  let out = html.replace(FOLIO_ANCHOR_OPEN_RE, (_full, tag: string, attrs: string) => {
    const nextAttrs = attrs.includes('style="')
      ? attrs.replace('style="', 'style="display:none;')
      : `${attrs} style="display:none"`;
    return `<${tag}${nextAttrs}>`;
  });
  if (folio !== null) {
    const edge = side === 'left' ? 'left:36px' : 'right:36px';
    const overlay =
      `<div data-page-folio="true" style="position:absolute;${edge};bottom:26px;` +
      `font-size:12px;letter-spacing:0.12em;color:#a09b8e;` +
      `font-family:'Inter','Noto Sans SC',sans-serif;pointer-events:none">${folio}</div>`;
    const closeAt = out.lastIndexOf('</div>');
    if (closeAt >= 0) out = out.slice(0, closeAt) + overlay + out.slice(closeAt);
  }
  return out;
}
