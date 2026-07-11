// mag-37 HTML 模板（外观真相源，镜像自 templates/mag-37/index.tsx 的 WebMag37）。
// 内页 · 留白收束页（category: interior，1 图）：白底；下半页一张方形大图（532×512），
// 图上方左侧一小段闭合手记（正文），右上角一句倾斜装饰短句（rotate -22°）。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image（下半页方形大图）、body（手记正文，React 走 resolveThemeCarrier(role: body)，
// 照 mag-01 惯例给 COLOR/FONT token，不加 data-variable-decor）、decor（倾斜装饰短句，
// variableDecor：色/字体可主题，role: title）。全部槽位均渲染，无省略。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';
const SERIF_CN = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_37_HTML = `<div data-template="mag-37" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image" style="position:absolute;left:119px;top:562px;width:532px;height:512px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="body" style="position:absolute;left:133px;top:426px;width:252px;font-weight:400;font-size:21px;line-height:1.35;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${SANS_CN}}}">{{TEXT:body}}</div>
  <div data-text-key="decor" data-variable-decor style="position:absolute;left:438px;top:387px;width:280px;font-weight:400;font-size:21px;line-height:1.35;white-space:pre-wrap;transform:rotate(-22deg);transform-origin:left top;color:{{COLOR:decor|#1c1b18}};font-family:{{FONT:decor|${SERIF_CN}}}">{{TEXT:decor}}</div>
</div>`;
