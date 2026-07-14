// mag-26 HTML 模板（外观真相源，镜像自 templates/mag-26/index.tsx 的 WebMag26）。
// 内页 · 竖排标题图文页（category: interior，1 图）：白底；右侧一张几乎满高的竖长图
// （426×1015），左侧竖排大标题（rotate -90°）+ 两条竖排英文装饰小字（rotate -90°）+
// 横排导语小标题 + 正文段落。引号装饰字形与导语上方细分隔线是固定 furniture、不进契约。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image（右侧竖长图 426×1015）、title/label1/label2（variableDecor：色/字体可主题）、
// explain/body（React 走 resolveThemeCarrier，照 mag-01 惯例给 COLOR/FONT token，
// 不加 data-variable-decor）。全部槽位均渲染，无省略。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_26_HTML = `<div data-template="mag-26" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image" style="position:absolute;left:330px;top:52px;width:426px;height:1015px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:500px;height:1015px;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}};left:-30px" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:120px;top:500px;width:445px;height:160px;transform:rotate(-90deg);transform-origin:top left;font-weight:800;font-size:75px;line-height:1;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}}">{{TEXT:title}}</div>
  <div data-text-key="title2" data-variable-decor style="position:absolute;left:53px;top:440px;width:240px;height:24px;transform:rotate(-90deg);transform-origin:top left;font-size:24px;line-height:1;white-space:pre;overflow:hidden;color:{{COLOR:title2|#1c1b18}};font-family:{{FONT:title2|${SANS_EN}}}">{{TEXT:title2}}</div>
  <div style="position:absolute;left:183px;top:550px;width:113px;height:85px;font-family:${SERIF_EN};font-size:120px;line-height:1;color:#1c1b18;user-select:none;overflow:hidden">&rdquo;</div>
  <div style="position:absolute;left:53px;top:710px;width:227px;height:1px;background:#1c1b18"></div>
  <div data-text-key="explain" style="position:absolute;left:53px;top:680px;width:240px;height:25px;font-size:24px;line-height:1.3;white-space:pre-wrap;overflow:hidden;color:{{COLOR:explain|#1c1b18}};font-family:{{FONT:explain|${SANS_CN}}}">{{TEXT:explain}}</div>
  <div data-text-key="body" style="position:absolute;left:53px;top:754px;width:240px;height:300px;font-size:19px;line-height:1.6;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${SANS_CN}}}">{{TEXT:body}}</div>
</div>`;
