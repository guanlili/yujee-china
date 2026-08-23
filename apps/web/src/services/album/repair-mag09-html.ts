import { patchHtmlTextStyle } from '@/components/album/page-html-dom';

// mag-09 老书页面修复(2026-08-23)。
//
// 病:mag-09 的 HTML 模板曾把 body/explain/explain2 三个绝对定位的 <p> 套在另一个
// 绝对定位的外层 div 里,而它们写的是**整页坐标** —— 浏览器把两层坐标叠加,body 落到
// (1008,260)、explain 落到 (120,1240)、explain2 落到 (120,1284)。794×1123 的页面上
// 这三段字等于不存在,编辑器、导出 PDF、Live 视频全中(四条导出路径共用同一渲染原语)。
// 模板已于 2026-08-22 拍平,守卫见 contracts 的 html-template-lint。
//
// 但存库的 html 才是页面真相,而 bakePageHtml 对已带 html 的页直接跳过 —— 老书里那些
// 页不会自己变好。
//
// 为什么不清空重烘:存库 html 里烘着用户改过的字/颜色/字体,以及 design-agent
// write_page_html 写下的手工版面。重烘=把这些一并抹掉。所以走外科式补丁:只拆两层
// 外壳、把 body2 从外层的正常流改成显式整页坐标,其余一个字节不动。
//
// 幂等:已是新形态(或被 AI 整页重写、认不出)时返回 null,重复跑安全。

/** 两层外壳的开标签 —— 模板里是静态的(无 token),所有老书里字节一致。 */
const WRAPPER_TOP = '<div style="position:absolute;top:130px;right:60px;width:230px">';
const WRAPPER_BOTTOM =
  '<div style="position:absolute;top:620px;left:60px;width:280px;line-height:1.75;' +
  'color:currentColor;letter-spacing:0.02em;text-align:justify">';

/** 从 openTag 处拆掉这一层 div(保留内容),按标签深度找配对的 </div>。 */
function unwrapDiv(html: string, openTag: string): string | null {
  const start = html.indexOf(openTag);
  if (start === -1) return null;
  let depth = 1;
  let cursor = start + openTag.length;
  const tagRe = /<(\/?)div\b[^>]*>/gi;
  tagRe.lastIndex = cursor;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      const inner = html.slice(cursor, m.index);
      return html.slice(0, start) + inner.trim() + html.slice(m.index + m[0].length);
    }
    cursor = m.index + m[0].length;
  }
  return null; // 外壳没闭合:结构不认识,不动
}

export function repairMag09Html(html: string): string | null {
  if (!html.includes('data-template="mag-09"')) return null;
  let next = html;
  let changed = false;

  // 上壳:body 自己的 left/top 本来就是整页坐标,拆掉外壳即归位。
  const unwrappedTop = unwrapDiv(next, WRAPPER_TOP);
  if (unwrappedTop !== null) {
    next = unwrappedTop;
    // 模板拍平时给它补了 margin:0(<p> 默认有上下 margin,原先由外层吃掉)。
    next = patchHtmlTextStyle(next, 'body', { margin: '0' }) ?? next;
    changed = true;
  }

  // 下壳:explain/explain2 同理;body2 原本没有 position,靠外层正常流落在 620+12=632
  // (正好压在 explain/explain2 头上),按设计顺序显式落到 explain2 之下 664+32+12=708。
  // 外层的 text-align:justify 是三个 <p> 唯一继承到的样式(line-height / letter-spacing /
  // color 三者各自都有覆写),拆壳后逐个补回。
  const unwrappedBottom = unwrapDiv(next, WRAPPER_BOTTOM);
  if (unwrappedBottom !== null) {
    next = unwrappedBottom;
    for (const slot of ['explain', 'explain2']) {
      next = patchHtmlTextStyle(next, slot, { margin: '0', 'text-align': 'justify' }) ?? next;
    }
    next =
      patchHtmlTextStyle(next, 'body2', {
        'margin-top': null,
        'margin-bottom': null,
        margin: '0',
        position: 'absolute',
        left: '60px',
        top: '708px',
        'text-align': 'justify',
      }) ?? next;
    changed = true;
  }

  return changed ? next : null;
}
