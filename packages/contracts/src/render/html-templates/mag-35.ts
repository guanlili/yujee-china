// mag-35 HTML 模板（外观真相源，镜像自 templates/mag-35/index.tsx 的 WebMag35）。
// 内页 · 满版绿底收束页（category: interior，1 图）：整页铺绿色底色 #81a46d；
// 左上 / 右上一对小标签（label / date），中部偏左一张竖图 318×408，图上叠散文式收束语（body）。
// 文字渲染在图之后 → z 顺序在图上层。版式来自「排版板式」A4-6（node 11:263）：
// 595×842 → ×1.3344 → 794×1123。几何逐一照抄：绝对定位、写死 px。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
//
// 槽位：image（竖图）、label/date（variableDecor：色/字体可主题）、
// body（非 variableDecor，React 走 resolveThemeCarrier → 照 mag-01 惯例给 COLOR/FONT token，
// 不加 data-variable-decor）。全部槽位均渲染，无省略。
// FONT token 默认栈按 resolveThemeCarrier 对 JSON sample 的实际解析取值
// （label/date：latin+title → playfair；body：cjk+explain → sansCn）；
// 槽位声明了 role，运行时 webFontFamily 恒有值，默认栈只作 token 语法兜底。
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';

export const MAG_35_HTML = `<div data-template="mag-35" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div style="position:absolute;left:0;top:0;width:794px;height:1123px;background:#81a46d"></div>
  <div data-image-slot="image" style="position:absolute;left:148px;top:160px;width:318px;height:408px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="label" data-variable-decor style="position:absolute;left:156px;top:160px;width:135px;font-weight:400;font-size:21px;line-height:1.3;white-space:pre-wrap;overflow:hidden;color:{{COLOR:label|#1c1b18}};font-family:{{FONT:label|${PLAYFAIR}}}">{{TEXT:label}}</div>
  <div data-text-key="date" data-variable-decor style="position:absolute;left:330px;top:160px;width:135px;text-align:right;font-weight:400;font-size:21px;line-height:1.3;white-space:pre-wrap;overflow:hidden;color:{{COLOR:date|#1c1b18}};font-family:{{FONT:date|${PLAYFAIR}}}">{{TEXT:date}}</div>
  <div data-text-key="body" style="position:absolute;left:156px;top:220px;width:242px;font-weight:400;font-size:21px;line-height:1.35;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${SANS_CN}}}">{{TEXT:body}}</div>
</div>`;
