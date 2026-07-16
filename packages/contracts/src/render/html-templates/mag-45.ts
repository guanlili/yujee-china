// mag-45 HTML 模板（外观真相源，镜像自 templates/mag-45/index.tsx 的 WebMag45）。
// 内页（category: interior，1 图 + 1 大标题）：白底；上方一张居中竖图（槽 image，
// 606×927）；底部一行大号展示主标题（槽 title，variableDecor，nowrap 溢出裁切）。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image（居中竖图 606×927）、title（variableDecor：色/字体可主题，默认墨色
// #1c1b18；React 走 resolveThemeCarrier(role 'title')，latin 默认解析为 Playfair，
// 照 mag-36 惯例默认栈取 PLAYFAIR）。全部槽位均渲染，无省略。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_45_HTML = `<div data-template="mag-45" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image" style="position:absolute;left:148px;top:35px;width:606px;height:927px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:31px;top:969px;width:600px;height:100px;font-weight:700;font-size:{{FIT_SIZE:title|700,120,40}}px;line-height:1.1;white-space:pre;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}};letter-spacing:0.02em">{{TEXT:title}}</div>
</div>`;
