// mag-36 HTML 模板（外观真相源，镜像自 templates/mag-36/index.tsx 的 WebMag36）。
// 内页 · 满版大图叠字（category: interior，1 图）：满版背景大图（831×1123，右侧溢出被
// 根节点 overflow:hidden 裁掉）；其上居中一块半透明白色面板（色块，非图片槽）；
// 面板上居中白色大字标题；左侧一段浅色小图注（叠在图上层）。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image（满版背景图）、title（variableDecor：色/字体可主题，默认白色）、
// explain（React 走 resolveThemeCarrier，照 mag-01 惯例给 COLOR/FONT token，
// 不加 data-variable-decor，默认色 rgba(28,27,24,0.7)）。全部槽位均渲染，无省略。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';

export const MAG_36_HTML = `<div data-template="mag-36" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image" style="position:absolute;left:0;top:0;width:831px;height:1123px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div style="position:absolute;left:72px;top:436px;width:300px;height:157px;background:rgba(255,255,255,0.55)"></div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:72px;top:436px;width:300px;height:157px;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700;font-size:64px;line-height:1.05;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#FFFFFF}};font-family:{{FONT:title|${PLAYFAIR}}}">{{TEXT:title}}</div>
</div>`;
