// mag-29 HTML 模板（外观真相源，镜像自 templates/mag-29/index.tsx 的 WebMag29）。
// 内页 · 旅行相册（category: interior，2 图）：白底；上方并排双图（330×464 各一），
// 下方右对齐的大标题 / 图注 / 地名（装饰标签）。全套文字默认陶土色 #1c1b18。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1/image2（并排双图）、title/label（variableDecor：色/字体可主题）、
// body（非 variableDecor 但 React 走 resolveThemeCarrier，照 mag-01 惯例给 COLOR/FONT
// token，不加 data-variable-decor）。全部槽位均渲染，无省略。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
// FONT 默认栈按 React 无 artFont 时的 DEFAULT_ALBUM_FONT 解析：title（role title，
// lang user→cjk）= serifCn；body（role body，lang user→cjk）= sansCn；
// label（role decoration，lang en→latin）= sansEn（decoration+en 的既有惯例）。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';
const SERIF_CN = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_29_HTML = `<div data-template="mag-29" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:28px;top:67px;width:330px;height:464px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:362px;top:67px;width:330px;height:464px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:295px;top:580px;width:400px;height:70px;font-weight:700;font-size:64px;line-height:1.1;text-align:right;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${SERIF_CN}}}">{{TEXT:title}}</div>
  <div data-text-key="body" style="position:absolute;left:280px;top:680px;width:460px;height:200px;font-weight:400;font-size:21px;line-height:1.5;text-align:right;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${SANS_CN}}};right:200px">{{TEXT:body}}</div>
  <div data-text-key="label" data-variable-decor style="position:absolute;left:390px;top:1007px;width:370px;height:40px;font-weight:700;font-size:48px;line-height:1.1;text-align:right;overflow:hidden;color:{{COLOR:label|#1c1b18}};font-family:{{FONT:label|${SANS_EN}}};white-space:pre-wrap">{{TEXT:label}}</div>
</div>`;
