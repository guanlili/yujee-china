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
  imagePosJson?: Record<string, { x: number; y: number; scale: number; rotate?: number }>;
  htmlJson?: string;
}

const IMG_SRC_TOKEN_RE = /\{\{IMG_SRC:([^}|]+)\}\}/g;

// 「照片不在本机」的 src。**不能用空串**:`<img src="">` 会让浏览器拿当前页面地址当
// 图片去加载,必然失败并渲染成碎图标 —— 还会原样印进 html2canvas 截图和导出的 PDF。
// 1×1 全透明 GIF 才是真正的「什么都不显示」。
// 会走到这里的日常情形:照片不在本机(换设备/清缓存),或 origin 变了 —— IndexedDB
// 按 origin 隔离,协议算在 origin 里,http://localhost:3000 和 https://localhost:3000
// 是两套互不可见的库。这类槽有 photoId、只是像素暂时取不到(有轮询在补),所以保持
// 透明,不打「缺图」标。
const EMPTY_IMAGE_SLOT_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// 空槽(用户删了图,images 里没有这个 key)的 src:浅灰底 + 图片图标占位,明确告诉
// 用户这里缺一张图。与「照片不在本机」是两回事 —— 空槽是用户主动删出来的持久状态,
// 不会被轮询补上,必须可见。所有渲染路径(编辑器画布/翻书/卡片/导出)同一张脸,
// 所见即所得。图标不带文字:产品面向海外多语言,img src 里没法过 i18n。
const MISSING_IMAGE_SLOT_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
    '<rect width="400" height="400" fill="#ECEDEF"/>' +
    '<g transform="translate(164,164)" fill="none" stroke="#B6BAC1" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="0" y="0" width="72" height="72" rx="10"/>' +
    '<circle cx="24" cy="24" r="8"/>' +
    '<path d="M0 54 L22 34 L38 48 L52 36 L72 54"/>' +
    '</g></svg>',
)}`;

export function resolveDisplayHtml(
  html: string,
  images: Record<string, string>,
  resolveImage: ResolveImage,
): string {
  return html.replace(IMG_SRC_TOKEN_RE, (_full, slotRaw: string) => {
    const slot = slotRaw.trim();
    const photoId = images[slot];
    if (!photoId) return MISSING_IMAGE_SLOT_SRC;
    return resolveImage(photoId) ?? EMPTY_IMAGE_SLOT_SRC;
  });
}

/** 模板即时渲染只填 IMG_POS/IMG_TF(不含 rotate;fill-template 是纯 token 替换,
 *  够不到 wrapper 几何)。旋转的盒交换在渲染后用 patchHtmlImagePos 补 —— 与存库
 *  html 的烘焙(bakePageHtml)同一原语。patch 不动(失败/无旋转)则原样返回。 */
export function applyImageRotatePatches(
  html: string,
  imagePos: HtmlPage['imagePosJson'],
): string {
  let out = html;
  for (const [slot, pos] of Object.entries(imagePos ?? {})) {
    if (pos.rotate) out = patchHtmlImagePos(out, slot, pos) ?? out;
  }
  return out;
}

export function preferredPageHtml(page: HtmlPage, resolveImage: ResolveImage): string | undefined {
  if (typeof page.htmlJson === 'string' && page.htmlJson.length > 0) {
    return resolveDisplayHtml(page.htmlJson, page.imagesJson, resolveImage);
  }
  const html = renderPageHtml(
    {
      templateId: page.templateId,
      images: page.imagesJson,
      texts: page.textsJson,
      imagePos: page.imagePosJson,
    },
    resolveImage,
  );
  if (html === undefined) return undefined;
  // 即时渲染对空槽会保留 {{IMG_SRC:slot}} token(fill-template 的契约),这里再走一遍
  // 解析把它渲成缺图占位;已填槽在上一步就解析成真实 src 了,这一步不会再碰到。
  // 旋转过的槽同样是即时渲染补不上的(IMG_TF 不含 rotate),渲染后补盒交换。
  return resolveDisplayHtml(applyImageRotatePatches(html, page.imagePosJson), page.imagesJson, resolveImage);
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 槽位级改字:替换存库 html 中 data-text-key 元素的内容,保留其余版面。
 * 找不到锚点返回 null(调用方回退整页重烘或仅更新数据层)。
 * 含换行的文案给槽元素补 white-space:pre-wrap —— 文本节点里的 \n 默认被 HTML
 * 渲染折叠成空格;行内样式跟着 html 真相走,编辑器/翻书/导出所有表面同款生效
 * (与 design-agent html-guard 的同名实现保持同步)。 */
export function patchHtmlText(html: string, slotId: string, value: string): string | null {
  const escapedSlot = slotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRe = new RegExp(`<([a-z0-9]+)\\b[^>]*data-text-key="${escapedSlot}"[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = html.indexOf(`</${m[1]}>`, start);
  if (end === -1) return null;
  const openTag = /[\r\n]/.test(value)
    ? (upsertStyleAttr(m[0], { 'white-space': 'pre-wrap' }) ?? m[0])
    : m[0];
  return html.slice(0, m.index) + openTag + escapeHtmlText(value) + html.slice(end);
}

// ── 手工编辑固化进存库 html(C 方案:页面真相 = html) ─────────────────────────
// 编辑器的字号/字体/图片位置操作先改画出来的 DOM 节点(即时反馈),但那只是
// innerHTML 幻影 —— 不把同样的改动写回 page.html,任何重绘/刷新都会回退,
// AI(读 draft html)和导出(渲 draft html)也永远看不到。以下两个 patcher 是
// 编辑器(本地即时同步)与 albumService.updatePage(落库)共用的唯一实现。

const STYLE_PROP_RE = /^[a-z-]+$/;
// `;{}<>` 能截断 CSS 声明或开新标签,转义兜不住,一律拒。**双引号不在此列**:
// WEB_FONTS 每条字体栈都是双引号形态(constants.ts serifCn = '"Noto Serif SC", …'),
// 拒掉它等于选字体必失败 —— 而调用方对 null 的兜底是「放弃整页 html 真相」,于是那一页
// 回落模板重烘、改动不上屏,且这页 html 没了之后连改颜色/字号也一起预览不出来。
// 写入时统一实体化成 &quot;(存库 html 本来就是这个形态),值就逃不出 style 属性。
const STYLE_VALUE_BAN = /[;{}<>]/;

/** 写进 style="" 的值:双引号必须实体化,否则裸 `"` 会提前闭合属性、撑开标签结构。
 *  只对新传入的值做 —— 从已有 html 解析出的声明本来就已是实体形态,二次转义会变成
 *  &amp;quot; 把字体栈写坏。 */
function escapeStyleValue(value: string): string {
  return value.replace(/"/g, '&quot;');
}

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
    else decls.set(prop, escapeStyleValue(value));
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
/** img 的直接父级就是图框 wrapper(WebImage 渲染模型:wrapper>img,中间无其他节点)。
 *  旋转的「盒交换」优先要图框的 px 尺寸(width/height 缺省 undefined);拿不到 px 时
 *  报告两轴是否「确定尺寸」(width/height 数值,或 left+right / top+bottom 对拉)——
 *  确定尺寸的 wrapper 可走容器查询单位盒交换(见 patchHtmlImagePos)。 */
function imageWrapperOpenTag(
  html: string,
  imgIndex: number,
): {
  start: number;
  tag: string;
  width?: number;
  height?: number;
  definiteW: boolean;
  definiteH: boolean;
} | null {
  const start = html.lastIndexOf('<div', imgIndex);
  if (start < 0) return null;
  const open = /^<div\b[^>]*>/.exec(html.slice(start, imgIndex));
  const style = open ? /style="([^"]*)"/.exec(open[0])?.[1] : undefined;
  if (!open || !style) return null;
  const px = (prop: 'width' | 'height'): number | undefined => {
    const v = new RegExp(`(?:^|;)\\s*${prop}:\\s*([\\d.]+)px`).exec(style)?.[1];
    const n = v ? parseFloat(v) : NaN;
    return n > 0 ? n : undefined;
  };
  const has = (prop: string): boolean =>
    new RegExp(`(?:^|;)\\s*${prop}:\\s*[\\d.]`).test(style);
  const width = px('width');
  const height = px('height');
  return {
    start,
    tag: open[0],
    width,
    height,
    definiteW: width !== undefined || has('width') || (has('left') && has('right')),
    definiteH: height !== undefined || has('height') || (has('top') && has('bottom')),
  };
}

export function patchHtmlImagePos(
  html: string,
  slotId: string,
  pos: { x: number; y: number; scale: number; rotate?: number },
): string | null {
  const escapedSlot = slotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRe = new RegExp(`<img\\b[^>]*data-image-slot="${escapedSlot}"[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  const rotate = pos.rotate ? ((Math.round(pos.rotate / 90) * 90) % 360 + 360) % 360 : 0;
  if (!rotate) {
    const patched = upsertStyleAttr(m[0], {
      // 从旋转态回来时,盒交换写过的绝对定位/转置尺寸要一并复位(width/height 写回
      // WebImage 的默认 100%,不能删 —— 删了 img 就没有尺寸了)。从未旋转过的图,
      // 这几笔是同值覆写/删除不存在的键,逐字节无感。
      position: null,
      left: null,
      top: null,
      width: '100%',
      height: '100%',
      'object-position': `${pos.x}% ${pos.y}%`,
      transform: pos.scale > 1 ? `scale(${pos.scale})` : null,
      'transform-origin': pos.scale > 1 ? `${pos.x}% ${pos.y}%` : null,
    });
    if (patched === null) return null;
    return html.slice(0, m.index) + patched + html.slice(m.index + m[0].length);
  }
  // ── 旋转:盒交换(2026-08-02)────────────────────────────────────────────────
  // 90/270 时把 img 的盒尺寸换成图框的转置尺寸再绕中心 rotate:object-fit:cover
  // 在转置盒上按最小缩放覆盖,白边不变式照旧成立,不需要按宽高比做补偿放大。
  // 旋转下缩放绕中心(焦点缩放在旋转坐标系里不成立),object-position 仍在图像
  // 自身轴上滑动 —— 编辑侧的拖动补偿见 image-edit-util.rotateDragDelta。
  //
  // 盒尺寸分两档:wrapper 行内有 px 直接写转置 px;没有 px 但两轴尺寸确定
  // (width/height 数值,或 left+right / top+bottom 对拉,如 mag-03 的 left/right
  // 定宽、mag-10 的 grid 列 width:100%)时,写容器查询单位 —— wrapper 升级为
  // container-type:size,img 的转置盒 = 100cqh×100cqw,由浏览器代为转置(与 px
  // 路径逐像素一致,Chromium 实测)。两档都不行(auto 尺寸/结构意外)才返回 null;
  // 调用方对 imagePos 的 null 一律**保留原 html**,绝不为一笔位置微调丢整页真相。
  const wrapper = imageWrapperOpenTag(html, m.index);
  if (!wrapper) return null;
  const swap = rotate % 180 !== 0;
  const hasPx = wrapper.width !== undefined && wrapper.height !== undefined;
  const useCq = !hasPx;
  if (useCq && !(wrapper.definiteW && wrapper.definiteH)) return null;
  const sizeProps = hasPx
    ? {
        width: `${swap ? wrapper.height : wrapper.width}px`,
        height: `${swap ? wrapper.width : wrapper.height}px`,
      }
    : {
        width: swap ? '100cqh' : '100cqw',
        height: swap ? '100cqw' : '100cqh',
      };
  const patched = upsertStyleAttr(m[0], {
    position: 'absolute',
    left: '50%',
    top: '50%',
    ...sizeProps,
    'object-position': `${pos.x}% ${pos.y}%`,
    transform: `translate(-50%, -50%) rotate(${rotate}deg)${pos.scale > 1 ? ` scale(${pos.scale})` : ''}`,
    'transform-origin': null,
  });
  if (patched === null) return null;
  // wrapper 必须是包含块(绝对定位的 img 以它定位)。模板槽位几乎都是 absolute,
  // 万一是流式布局,补一笔 position:relative(已声明 position 的不动)。
  // cq 路径还要把 wrapper 升级为 size 容器(固定尺寸的图框上 contain:size 无副作用;
  // 回正到 rotate=0 时这笔残留同样无害,不清)。
  let out = html.slice(0, m.index) + patched + html.slice(m.index + m[0].length);
  const wrapperStyle = /style="([^"]*)"/.exec(wrapper.tag)?.[1] ?? '';
  const wrapperProps: Record<string, string | null> = {
    ...(/(?:^|;)\s*position:/.test(wrapperStyle) ? {} : { position: 'relative' }),
    ...(useCq ? { 'container-type': 'size' } : {}),
  };
  if (Object.keys(wrapperProps).length > 0) {
    const wrapperPatched = upsertStyleAttr(wrapper.tag, wrapperProps);
    if (wrapperPatched === null) return null;
    out = out.slice(0, wrapper.start) + wrapperPatched + out.slice(wrapper.start + wrapper.tag.length);
  }
  return out;
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
// 页签不再依赖烘进 html 的 folio 槽(重排页序后必然过期):展示层每次按当前页序
// 计算。封面/目录/封尾不编号。页签贴该页所在物理半页的外侧下角(左页→左下,
// 右页→右下);双宽(spread)页占满整个跨页,故一页吃掉两个号、左下右下各贴一个。
// 侧别一律按 placePages 的真实版面推 ——「奇偶」不等于左右,有没有目录页会整体
// 错位一位。

import { getTemplate } from '@yujee/contracts/templates';
import { placePages } from './page-layout';

const NON_FOLIO_CATEGORIES = new Set(['cover', 'toc', 'ending']);

export type FolioSide = 'left' | 'right';

/** 一页的页码:null=不编号;number=单页一个号;{left,right}=双宽页吃掉的两个号。 */
export type PageFolio = null | number | { left: number; right: number };

export interface PageFolioInfo {
  folio: PageFolio;
  /** 单页页贴哪一侧;双宽页(folio 为对象)时该值无意义,两侧都贴。 */
  side: FolioSide;
}

/** 按当前页序算出每页的页码与贴边。左右页配对走 placePages(唯一真相)。 */
export function pageFolioInfos(templateIds: string[]): PageFolioInfo[] {
  const placements = placePages(templateIds);
  let n = 0;
  return templateIds.map((id, i) => {
    const placement = placements[i]!;
    const category = getTemplate(id)?.category;
    const side: FolioSide = placement.side === 'right' ? 'right' : 'left';
    if (category && NON_FOLIO_CATEGORIES.has(category)) {
      return { folio: null, side };
    }
    if (placement.side === 'both') {
      const left = n + 1;
      const right = n + 2;
      n += 2;
      return { folio: { left, right }, side };
    }
    n += 1;
    return { folio: n, side };
  });
}

const FOLIO_ANCHOR_OPEN_RE = /<([a-z0-9]+)((?:[^>]*?)data-text-key="folio(?:\[\d+\])?"[^>]*)>/gi;

function folioMarkup(value: number, side: FolioSide): string {
  const edge = side === 'left' ? 'left:36px' : 'right:36px';
  return (
    `<div data-page-folio="true" style="position:absolute;${edge};bottom:26px;` +
    `font-size:12px;letter-spacing:0.12em;color:#a09b8e;` +
    `font-family:'Inter','Noto Sans SC',sans-serif;pointer-events:none">${value}</div>`
  );
}

/** 展示层页签:隐藏模板遗留 folio 元素;folio 非 null 时在对应侧下角注入统一页码。
 *  双宽页(folio 为 {left,right})左下右下各注入一个。 */
export function applyFolioOverlay(
  html: string,
  folio: PageFolio,
  side: FolioSide = 'right',
): string {
  let out = html.replace(FOLIO_ANCHOR_OPEN_RE, (_full, tag: string, attrs: string) => {
    const nextAttrs = attrs.includes('style="')
      ? attrs.replace('style="', 'style="display:none;')
      : `${attrs} style="display:none"`;
    return `<${tag}${nextAttrs}>`;
  });
  const overlay =
    folio === null
      ? ''
      : typeof folio === 'number'
        ? folioMarkup(folio, side)
        : folioMarkup(folio.left, 'left') + folioMarkup(folio.right, 'right');
  if (overlay) {
    const closeAt = out.lastIndexOf('</div>');
    if (closeAt >= 0) out = out.slice(0, closeAt) + overlay + out.slice(closeAt);
  }
  return out;
}
