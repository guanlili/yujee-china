/* ════════════════════════════════════════════════════════════════════════════
   page-edit —— 移动端「改动怎么落到页面上」的纯函数层。

   移动端不走桌面那套「先改活节点、再回写 html」:文字槽住在 dangerouslySetInnerHTML
   里,React 不拥有它们,而架构守卫又禁止移动端源码碰 document/querySelector。
   所以这里反过来:**先改 html 真相,再让那一页重渲**。即时预览与落库因此用的是
   同一套 patcher(page-html-dom,与服务端 updatePage 共享)——所见即所存。

   全部纯函数、零 DOM:能被 node 直接测(仓里没有 jsdom)。
   ════════════════════════════════════════════════════════════════════════════ */

import type { EditorPage } from '../../types';
import {
  patchHtmlText,
  patchHtmlTextStyle,
  patchHtmlPageStyle,
  patchHtmlImagePos,
} from '../../page-html-dom';
import { EDITOR_FONTS } from '../editor-fonts';
// 图片平移/缩放的几何与夹取全部复用桌面那份(已单测:白边/溢出的不变式都在注释里)。
import { clampImagePos, DEFAULT_IMAGE_POS, type ImagePosValue } from '../image-edit-util';

/** 选中的文字槽在画板上的位置(相对 .mspread 左上角,已含页面缩放)。 */
export type SelRect = { left: number; top: number; width: number; height: number };

/** 文字面板的状态。null = 该项沿用模板/未覆写。 */
export type TextStyleState = {
  text: string;
  fontSize: number | null;
  fontId: string | null;
  color: string | null;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right' | null;
};

/** 从被点中元素读到的原始 computed 值(调用方用 getComputedStyle 取,这里只做解释)。 */
export type ComputedProbe = {
  text: string;
  fontSize: string;
  color: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  fontFamily: string;
};

const ALIGNS = new Set(['left', 'center', 'right']);

/** rgb()/rgba() → #rrggbb。已是 hex 或认不出的原样返回(取色格高亮靠它对齐)。 */
export function normalizeColor(value: string): string | null {
  const v = value.trim();
  if (v === '') return null;
  if (v.startsWith('#')) return v.toLowerCase();
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (!m) return v;
  const hex = (n: string) =>
    Math.max(0, Math.min(255, Math.round(Number(n))))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
}

/** computed 的 font-family 串反查字体表 id(比首个字体族名)。认不出返回 null。 */
export function matchFontId(fontFamily: string): string | null {
  const head = (s: string) => (s.split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase();
  const target = head(fontFamily);
  if (target === '') return null;
  return EDITOR_FONTS.find((f) => head(f.stack) === target)?.id ?? null;
}

/** computed 值 → 面板初值。面板打开时显示元素**当前真实样式**,不是空白。 */
export function probeToState(probe: ComputedProbe): TextStyleState {
  const px = parseFloat(probe.fontSize);
  const weight = Number(probe.fontWeight);
  return {
    text: probe.text,
    fontSize: Number.isFinite(px) && px > 0 ? Math.round(px) : null,
    fontId: matchFontId(probe.fontFamily),
    color: normalizeColor(probe.color),
    // 'bold' 关键字与 600+ 数值都算粗(模板里两种写法都有)。
    bold: probe.fontWeight === 'bold' || (Number.isFinite(weight) && weight >= 600),
    italic: probe.fontStyle === 'italic' || probe.fontStyle === 'oblique',
    // computed 的 start/end 归一成 left/right —— 版面里只有这三种有意义。
    align: ALIGNS.has(probe.textAlign)
      ? (probe.textAlign as 'left' | 'center' | 'right')
      : probe.textAlign === 'start'
        ? 'left'
        : probe.textAlign === 'end'
          ? 'right'
          : null,
  };
}

/** 面板状态相对初值的**差集** → 要写进 html 的 CSS 声明。
 *  只写用户真改过的项:否则会把模板继承来的字号/颜色烘死进 html,以后换主题改不动。
 *  字体一律写具体字体栈(var(--…) 进不了 html —— 导出/AI 渲染环境没有编辑器变量)。 */
export function styleDiff(
  next: TextStyleState,
  base: TextStyleState,
): Record<string, string | null> {
  const props: Record<string, string | null> = {};
  if (next.fontSize !== base.fontSize && next.fontSize != null) {
    props['font-size'] = `${Math.min(200, Math.max(6, Math.round(next.fontSize)))}px`;
  }
  if (next.color !== base.color && next.color != null) props.color = next.color;
  if (next.bold !== base.bold) props['font-weight'] = next.bold ? '700' : null;
  if (next.italic !== base.italic) props['font-style'] = next.italic ? 'italic' : null;
  if (next.align !== base.align && next.align != null) props['text-align'] = next.align;
  if (next.fontId !== base.fontId && next.fontId != null) {
    const font = EDITOR_FONTS.find((f) => f.id === next.fontId);
    if (font) props['font-family'] = font.stack;
  }
  return props;
}

/** html 打补丁的统一收尾:patcher 返回 null(锚点缺失/非法值)= 放弃 html 真相,
 *  让渲染回落「模板 + 数据」现场重烘 —— 宁可丢版面微调,也不显示旧内容。
 *  与桌面 syncPageHtml 同一口径。 */
function patched(html: string | undefined, apply: (h: string) => string | null): string | undefined {
  if (typeof html !== 'string' || html.length === 0) return undefined;
  return apply(html) ?? undefined;
}

/** 文字改动 → 新的一页。**总是从 base(面板打开时的快照)算**,不在上一次结果上累加:
 *  每次 onChange 重算一遍,取消只要把 base 放回去,不用反向撤销。 */
export function applyTextEdit(
  base: EditorPage,
  slotId: string,
  next: TextStyleState,
  baseState: TextStyleState,
): { page: EditorPage; props: Record<string, string | null> } {
  const props = styleDiff(next, baseState);
  const textChanged = next.text !== baseState.text;
  let html = base.htmlJson;
  if (textChanged) html = patched(html, (h) => patchHtmlText(h, slotId, next.text));
  if (Object.keys(props).length > 0) {
    html = patched(html, (h) => patchHtmlTextStyle(h, slotId, props));
  }
  return {
    page: {
      ...base,
      textsJson: textChanged ? { ...base.textsJson, [slotId]: next.text } : base.textsJson,
      htmlJson: html,
    },
    props,
  };
}

/** 页面底色 → 新的一页。null = 移除覆写,回落模板自带的纸白。 */
export function applyPageBg(base: EditorPage, color: string | null): EditorPage {
  const props = { 'background-color': color };
  return { ...base, htmlJson: patched(base.htmlJson, (h) => patchHtmlPageStyle(h, props)) };
}

/** 图片位置/缩放 → 新的一页。html 与数据层都要写:
 *  html 是画板即时看到的真相,imagePosJson 是落库与重烘时的真相,两边必须同步
 *  (只写一边:要么刷新回退,要么导出/AI 看到的和屏幕不一致)。 */
export function applyImagePos(
  base: EditorPage,
  slotId: string,
  pos: ImagePosValue,
): EditorPage {
  const next = clampImagePos(pos);
  return {
    ...base,
    imagePosJson: { ...(base.imagePosJson ?? {}), [slotId]: next },
    // patch 失败保留原 html(?? h):图片位置是纯装饰性行内样式,失败只是这一笔不上屏;
    // 走 patched 的默认口径丢整页 html 会连手工背景/字色一起毁掉(与桌面同口径)。
    htmlJson: patched(base.htmlJson, (h) => patchHtmlImagePos(h, slotId, next) ?? h),
  };
}

/** 读回某个图槽当前的位置/缩放;没设过就是默认(居中、不放大)。 */
export function readImagePos(page: EditorPage, slotId: string): ImagePosValue {
  return clampImagePos(page.imagePosJson?.[slotId] ?? DEFAULT_IMAGE_POS);
}

/** 图片位置的落库 payload。服务端按 patchHtmlImagePos 打进存库 html。 */
export function imagePosPatchBody(page: EditorPage): Record<string, unknown> {
  return { imagePosJson: page.imagePosJson ?? {} };
}

/* ── 换图 / 清空图槽 ────────────────────────────────────────────────────────
   这两件**只动数据层,html 一个字不改**:存库 html 的图片位是 {{IMG_SRC:slot}} token,
   显示时 resolveDisplayHtml 按 imagesJson 现查现解析(空槽渲成浅灰缺图占位)。服务端
   updatePage 的 images 分支同口径(整体替换 page.images,注释就写着「换图/删图只动数据层」)。
   所以别在这儿碰 htmlJson —— 碰了反而会把 token 烘死成某张具体照片,以后换不动。 */

/** 换图:把某个图槽指到另一张照片。位置/缩放留着(换的是内容不是版面)。 */
export function applyImageSwap(base: EditorPage, slotId: string, photoId: string): EditorPage {
  return {
    ...base,
    imagesJson: { ...base.imagesJson, [slotId]: photoId },
  };
}

/** 清空图槽:删掉这个 key(不是置空串)。
 *  服务端 zod 是 z.record(z.string(), z.string()),空串虽然也能过、渲染也当 falsy,
 *  但会在数据里留一条指向「空照片」的假记录,collectPhotoIds 之类的读侧还得再判一次。
 *  删 key = 这个槽从来没配过图,与模板初始态同形,读侧零特判。版式不受影响:
 *  token 还在 html 里,框还占着位,以后放张图回去就复原。 */
export function applyImageClear(base: EditorPage, slotId: string): EditorPage {
  const nextImages = { ...base.imagesJson };
  delete nextImages[slotId];
  const nextPos = { ...(base.imagePosJson ?? {}) };
  // 位置/缩放是绑在「那张图」上的,图都没了就不该留 —— 否则下次放新图进来会
  // 继承上一张的平移缩放,看着像放歪了。
  delete nextPos[slotId];
  return { ...base, imagesJson: nextImages, imagePosJson: nextPos };
}

/** 换图/清空的落库 payload。服务端整体替换 page.images,所以必须发全量而不是单键
 *  (与 textPatchBody 同口径);imagePosJson 一起发,清空时要把那槽的位置也抹掉。 */
export function imagesPatchBody(page: EditorPage): Record<string, unknown> {
  return { imagesJson: page.imagesJson, imagePosJson: page.imagePosJson ?? {} };
}

/** 读回当前页底色(页根 data-template 元素的行内 background-color)。
 *  底色面板是从一级栏打开的、没有点击目标可探,只能从 html 真相里读。
 *  没写过覆写 → null(= 无背景,透出纸白)。 */
export function readPageBg(page: EditorPage): string | null {
  const html = page.htmlJson;
  if (typeof html !== 'string' || html.length === 0) return null;
  const root = /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i.exec(html);
  if (!root) return null;
  const style = /style="([^"]*)"/.exec(root[0]);
  if (!style) return null;
  const decl = /(?:^|;)\s*background-color\s*:\s*([^;]+)/i.exec(style[1]!);
  return decl ? normalizeColor(decl[1]!.trim()) : null;
}

/** 落库 payload(PATCH /api/v1/albums/{id}/pages/{index})。服务端按同一套 patcher
 *  把改动打进存库 html,前端不重复实现落库侧的 html 写回。 */
export function textPatchBody(
  page: EditorPage,
  slotId: string,
  props: Record<string, string | null>,
): Record<string, unknown> {
  return {
    // 服务端是整体替换 page.texts,必须发全量而不是单键(与桌面 persistPagePatch 同)。
    textsJson: page.textsJson,
    ...(Object.keys(props).length > 0 ? { textStyles: { [slotId]: props } } : {}),
  };
}

export function pageBgPatchBody(color: string | null): Record<string, unknown> {
  return { pageStyle: { 'background-color': color } };
}
