// 页底色注入：把 texts['#pageBackground'] 落到页根 [data-template] 的 inline style，
// 并把**成对的页根字色**一起写上（深底浅字 / 浅底深字，由 bestInkFor 从底色算出）。
//
// 为什么要有它：set_text_colors / swap_page_template 都会 page.html = undefined 再从
// 模板重烘，applyDesign 写的 inline 背景色会丢。页底色必须是「重烘能读到的字段」，
// 所以借 texts 这张 string map 走 magic key 文法（与 #accentColor / #artFont 同一套）。
//
// 为什么底色和字色必须成对写（2026-08-29 最终评审 Important 2）：写工具只刷带 carrier
// 的文字槽（`slotId#accentColor`），**不带 carrier 的静态装饰**（mag-10 的 1/2/3/4 序号
// 用的正是 `color:currentColor`、分隔线、页码斜杠…）只跟页根 `color` 走。页根字色是模板
// 写死的 #1c1b18，压在多巴胺的橙/绿/蓝底上实测 3.41 / 3.36 / 3.22 —— 全都低于本分支
// 自己定的 4.5 硬线。web 侧的 applyDarkChrome 早就两个都写（design-apply.ts，注释写明
// 「不翻的话静态装饰黑压黑看不见」）；把同一件事收到 carrier 这一处，四个写工具
// （set_page_background / apply_book_style / set_text_colors 重烘 / swap_page_template
// 重烘）一次全都受益，不必逐个工具各写一遍。字色不另存字段：它是底色的纯函数。
//
// ⚠️ 两条声明都必须追加在 style **末尾**：模板根节点写的是 background:#fff **简写**
// 和 color:#1c1b18，前置会被它们盖掉。web 的 upsertStyleAttr 用 Map 保序、新键天然落
// 末尾，所以那条 inline 路径一直是对的；这里要显式保证同样的顺序。
//
// ⚠️ 无 carrier（hex 缺省或非法）时**逐字节原样返回** —— renderPageHtml 是 engine/web
// 共用的渲染路径，老书零影响这条守卫由 page-background.test.ts 钉死，不能破。
import { bestInkFor } from '../design/contrast';

/** 页根是 html 里第一个带 data-template 的元素（见 render/html-templates/*：794×1123 外框）。 */
const ROOT_RE = /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const BG_PROP = 'background-color';
const INK_PROP = 'color';

/** 声明的属性名（`background-color: #fff` 这种带空格的写法也要认出来）。 */
function propOf(decl: string): string {
  const at = decl.indexOf(':');
  return at < 0 ? '' : decl.slice(0, at).trim().toLowerCase();
}

export function applyPageBackground(html: string, hex: string | undefined | null): string {
  if (!hex || !HEX_RE.test(hex)) return html; // 含非法值：原样返回，不写坏页面
  const m = ROOT_RE.exec(html);
  if (!m) return html;
  const openTag = m[0]!;
  const ink = bestInkFor(hex);
  const styleMatch = /style="([^"]*)"/.exec(openTag);
  let nextTag: string;
  if (styleMatch) {
    // 去掉已有的 background-color / color（幂等；prop 精确匹配，不会误删 border-color），
    // 再把新值追加到末尾。
    const decls = styleMatch[1]!
      .split(';')
      .map((d) => d.trim())
      .filter((d) => {
        if (!d) return false;
        const prop = propOf(d);
        return prop !== BG_PROP && prop !== INK_PROP;
      });
    decls.push(`${BG_PROP}:${hex}`, `${INK_PROP}:${ink}`);
    nextTag = openTag.replace(styleMatch[0]!, `style="${decls.join(';')}"`);
  } else {
    nextTag = openTag.replace(/>$/, ` style="${BG_PROP}:${hex};${INK_PROP}:${ink}">`);
  }
  return html.slice(0, m.index) + nextTag + html.slice(m.index + openTag.length);
}
