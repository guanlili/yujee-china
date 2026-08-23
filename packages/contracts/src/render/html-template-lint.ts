// HTML 模板锚点/token 完整性 lint(check-html-templates 脚本与 M2 子代理自验共用)。
import type { TemplateDef } from '../templates';

export function lintTemplateHtml(tpl: TemplateDef, html: string): string[] {
  const errors: string[] = [];
  if (!new RegExp(`data-template="${tpl.id}"`).test(html)) {
    errors.push(`${tpl.id}: 根节点缺 data-template="${tpl.id}"`);
  }
  if (html.length > 60000) {
    errors.push(`${tpl.id}: 模板本体 ${html.length} 字符,逼近 64KB 页面上限,留不出文案余量`);
  }
  for (const slot of tpl.texts) {
    const hasToken = html.includes(`{{TEXT:${slot.id}}}`);
    const hasAnchor = html.includes(`data-text-key="${slot.id}"`);
    // 声明了就必须渲染。曾允许「锚点和 token 一起缺」,结果攒出 13 个哑槽:
    // JSON 声明着、AI 给它写文案、页面上却一个字不显示 —— 用户付 token 买看不见的字。
    // 工作台删图层现在会级联删掉 JSON 声明(dev/template-box),所以「留声明不渲染」
    // 不再有合法场景。
    if (!hasToken || !hasAnchor) {
      errors.push(
        `${tpl.id}: 文字槽 ${slot.id} 声明了但 HTML 不渲染(anchor=${hasAnchor}, token=${hasToken})——删声明或补锚点`,
      );
    }
    if (slot.variableDecor && hasToken) {
      if (!html.includes(`{{COLOR:${slot.id}`)) errors.push(`${tpl.id}: variableDecor 槽 ${slot.id} 缺 {{COLOR:}} token`);
      if (!html.includes(`{{FONT:${slot.id}`)) errors.push(`${tpl.id}: variableDecor 槽 ${slot.id} 缺 {{FONT:}} token`);
    }
  }
  // items 重复组的文字槽:至少第 0 个实例要在 HTML 里渲染(mag-10/mag-02 先例)。
  for (const slot of tpl.items?.texts ?? []) {
    if (!html.includes(`data-text-key="${slot.id}[0]"`) || !html.includes(`{{TEXT:${slot.id}[0]}}`)) {
      errors.push(`${tpl.id}: items 文字槽 ${slot.id} 声明了但 HTML 连 ${slot.id}[0] 都不渲染`);
    }
  }
  for (const slot of tpl.images) {
    if (!html.includes(`data-image-slot="${slot.id}"`)) errors.push(`${tpl.id}: 图槽 ${slot.id} 缺 data-image-slot 锚点`);
    if (!html.includes(`{{IMG_SRC:${slot.id}}}`)) errors.push(`${tpl.id}: 图槽 ${slot.id} 缺 {{IMG_SRC:}} token`);
  }
  const declared = new Set([
    ...tpl.texts.map((s) => s.id),
    ...tpl.images.map((s) => s.id),
    // items 重复组(V3 网格模板):base[i] bracket 路径寻址,基名视为已声明。
    ...(tpl.items?.texts?.map((s) => s.id) ?? []),
    ...(tpl.items?.images?.map((s) => s.id) ?? []),
  ]);
  for (const m of html.matchAll(/\{\{(?:TEXT|COLOR|FONT|IMG_SRC|IMG_POS|IMG_TF|FIT_SIZE):([^}|]+)(?:\|[^}]*)?\}\}/g)) {
    const slotId = m[1]!.trim().replace(/\[\d+\]$/, '');
    if (!declared.has(slotId)) errors.push(`${tpl.id}: HTML 引用了未声明的槽 "${slotId}"`);
  }
  errors.push(...lintNestedPositionedSlots(tpl.id, html));
  return errors;
}

const TAG_RE = /<(\/?)([a-z0-9]+)((?:"[^"]*"|[^>])*?)(\/?)>/gi;
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'source', 'path', 'circle', 'rect', 'line', 'use', 'stop']);

function isPositioned(style: string): boolean {
  return /position:\s*(absolute|relative|fixed|sticky)/i.test(style);
}

/** 槽元素与模板根之间不许再有定位祖先。
 *
 *  模板里的 left/top 一律是**整页坐标**(全库统一写法,也是工作台
 *  /api/dev/template-box 直接改 left/top 的前提)。一旦槽被套进另一个定位元素,
 *  浏览器会把两层坐标叠加 —— mag-09 就是这么把 body 推到 x=1008、explain2 推到
 *  y=1284,在 794×1123 的页面上等于三段字直接消失(屏幕/PDF/Live 全中)。
 *
 *  例外:图槽的 <img> 必须待在同 slotId 的图框 div 里(锚点契约要求的双层结构),
 *  它靠 width/height:100% 铺满图框,不带自己的 left/top,不存在叠加。
 *
 *  只管 HTML 模板:React 镜像组件除 mag-54~59 外都不发 data-text-key 锚点,
 *  拿这条规则去扫它们只会空跑出假绿。 */
function lintNestedPositionedSlots(tplId: string, html: string): string[] {
  const errors: string[] = [];
  const stack: { tag: string; positioned: boolean; isRoot: boolean; imageSlot: string | null }[] = [];
  for (const m of html.matchAll(TAG_RE)) {
    const [, closing, tagRaw, attrs, selfClosing] = m;
    const tag = tagRaw!.toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i]!.tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const style = /style="([^"]*)"/i.exec(attrs!)?.[1] ?? '';
    const textKey = /data-text-key="([^"]*)"/i.exec(attrs!)?.[1] ?? null;
    const imageSlot = /data-image-slot="([^"]*)"/i.exec(attrs!)?.[1] ?? null;
    const slot = textKey ?? imageSlot;
    // 最外层元素即模板根(HTML 模板带 data-template,React 组件的 WebPage 根不带,
    // 所以按深度判定而不是按属性 —— 两边共用同一条不变量)。
    const isRoot = stack.length === 0;
    if (slot && isPositioned(style)) {
      const ancestor = stack.find((s) => s.positioned && !s.isRoot);
      // 图框 div 里的同槽 <img> 是契约要求的双层锚点,不算嵌套。
      const isOwnImageAnchor =
        tag === 'img' && imageSlot !== null && stack.some((s) => s.imageSlot === imageSlot);
      if (ancestor && !isOwnImageAnchor) {
        errors.push(
          `${tplId}: 槽 ${slot} 嵌在定位元素 <${ancestor.tag}> 里 —— ` +
            `槽自己的 left/top 会与外层叠加,把它推离模板写的整页坐标(mag-09 因此丢过三段字)`,
        );
      }
    }
    if (!selfClosing && !VOID_TAGS.has(tag)) {
      stack.push({ tag, positioned: isPositioned(style), isRoot, imageSlot });
    }
  }
  return errors;
}
