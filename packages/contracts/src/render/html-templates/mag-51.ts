// mag-51 HTML 模板（外观真相源，镜像自 templates/mag-51/index.tsx 的 WebMag51）。
// 内页 · 顶部大标题 + 满幅竖图（category: interior，1 图）：白底；顶部一行超大地名
// 主标题（92px、nowrap、overflow hidden），下方一张满幅竖向大图（674×917）。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：title（顶部超大主标题，variableDecor：色/字体可主题，role: title，默认色 #1c1b18、
// 默认字体为拉丁 title 角色的 Playfair 栈——React 走 resolveThemeCarrier，样本 "NORWAY"
// 为拉丁文时实际解析到 playfair-display）、image（满幅竖向大图）。全部槽位均渲染，无省略。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_51_HTML = `<div data-template="mag-51" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-text-key="title" data-variable-decor style="position:absolute;left:60px;top:44px;width:674px;height:70px;font-weight:700;font-size:92px;line-height:1.1;letter-spacing:0.02em;white-space:pre;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}}">{{TEXT:title}}</div>
  <div data-image-slot="image" style="position:absolute;left:60px;top:120px;width:674px;height:917px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
</div>`;
