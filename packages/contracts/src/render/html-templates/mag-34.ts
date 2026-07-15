// mag-34 HTML 模板（外观真相源，收敛单渲染器）。
// 几何逐一镜像自 templates/mag-34/index.tsx（WebMag34）：794×1123、绝对定位、写死 px。
// 内页 · 居中竖图 + 上下居中文字：白底；中央竖图 470×737，顶部居中大字主标题压在
// 图上沿，底部居中图注收尾。React 版根节点是裸 div（非 WebPage），无 font-family /
// color / box-sizing，此处照抄不加。
//
// 槽位：title（顶部居中大标题，variableDecor：色/字体可主题）、image（中央竖图）、
// body（底部居中图注，非 variableDecor 但 React 走 resolveThemeCarrier，给
// COLOR/FONT token 不加 data-variable-decor）。JSON 三槽全渲染，无省略。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_34_HTML = `<div data-template="mag-34" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image" style="position:absolute;left:163px;top:234px;width:470px;height:737px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:35px;top:187px;width:726px;font-family:{{FONT:title|${PLAYFAIR}}};font-weight:800;font-size:56px;line-height:1.05;color:{{COLOR:title|#1c1b18}};text-align:center;white-space:pre-wrap;overflow:hidden">{{TEXT:title}}</div>
  <div data-text-key="body" style="position:absolute;left:140px;top:970px;width:500px;font-family:{{FONT:body|${SANS_EN}}};font-weight:400;font-size:21px;line-height:1.35;color:{{COLOR:body|#1c1b18}};text-align:center;white-space:pre-wrap;overflow:hidden;height:50px">{{TEXT:body}}</div>
</div>`;
