// 页底色注入：把 texts['#pageBackground'] 落到页根 [data-template] 的 inline style。
//
// 为什么要有它：set_text_colors / swap_page_template 都会 page.html = undefined 再从
// 模板重烘，applyDesign 写的 inline 背景色会丢。页底色必须是「重烘能读到的字段」，
// 所以借 texts 这张 string map 走 magic key 文法（与 #accentColor / #artFont 同一套）。
//
// ⚠️ background-color 必须追加在 style **末尾**：模板根节点写的是 background:#fff
// **简写**，前置会被它盖掉。web 的 upsertStyleAttr 用 Map 保序、新键天然落末尾，
// 所以那条 inline 路径一直是对的；这里要显式保证同样的顺序。

/** 页根是 html 里第一个带 data-template 的元素（见 render/html-templates/*：794×1123 外框）。 */
const ROOT_RE = /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const BG_PROP = 'background-color';

export function applyPageBackground(html: string, hex: string | undefined | null): string {
  if (!hex || !HEX_RE.test(hex)) return html; // 含非法值：原样返回，不写坏页面
  const m = ROOT_RE.exec(html);
  if (!m) return html;
  const openTag = m[0]!;
  const styleMatch = /style="([^"]*)"/.exec(openTag);
  let nextTag: string;
  if (styleMatch) {
    // 去掉已有的 background-color（幂等），再把新值追加到末尾
    const decls = styleMatch[1]!
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d && !d.toLowerCase().startsWith(`${BG_PROP}:`));
    decls.push(`${BG_PROP}:${hex}`);
    nextTag = openTag.replace(styleMatch[0]!, `style="${decls.join(';')}"`);
  } else {
    nextTag = openTag.replace(/>$/, ` style="${BG_PROP}:${hex}">`);
  }
  return html.slice(0, m.index) + nextTag + html.slice(m.index + openTag.length);
}
