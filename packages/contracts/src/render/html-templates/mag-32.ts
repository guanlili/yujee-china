// mag-32 HTML 模板（外观真相源，镜像自 templates/mag-32/index.tsx 的 WebMag32）。
// 封面（category: cover，1 图）：白底；满高大图（左 103 起、691×1123，偏右铺满整页高）；
// 左缘主竖排大地名（rotate 90°）；左下角大号主标题。几何逐一照抄：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
//
// 槽位：image（满高大图）、title/label（variableDecor：色/字体可主题）。全部槽位均渲染，无省略（JSON 无 folio 槽）。
// 静态装饰（左下竖排小地名 + 底部横排小地名）：React 版注释称 furniture，但代码实际渲染的是
// label 槽的动态值（{label}）、字体走 labelTheme.webFontFamily、颜色写死 #1c1b18 ——
// 这里忠实照抄代码：内容用 {{TEXT:label}}、字体用 {{FONT:label|…}}，不加 data-text-key /
// data-variable-decor 锚点（锚点只留在主 label 槽上），颜色写死。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_32_HTML = `<div data-template="mag-32" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image" style="position:absolute;left:103px;top:0;width:691px;height:1123px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="label" data-variable-decor style="position:absolute;left:95px;top:160px;width:800px;font-weight:700;font-size:85px;line-height:1;letter-spacing:8.5px;white-space:nowrap;transform:rotate(90deg);transform-origin:left top;color:{{COLOR:label|#1c1b18}};font-family:{{FONT:label|${SANS_EN}}}">{{TEXT:label}}</div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:56px;top:710px;width:300px;height:360px;font-weight:700;font-size:{{FIT_SIZE:title|620,96,44}}px;line-height:1.05;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}}">{{TEXT:title}}</div>
  <div style="position:absolute;left:50px;top:760px;width:300px;font-weight:400;font-size:43px;line-height:1;letter-spacing:4px;white-space:nowrap;transform:rotate(90deg);transform-origin:left top;color:#1c1b18;font-family:{{FONT:label|${SANS_EN}}}">{{TEXT:label}}</div>
  <div style="position:absolute;left:56px;top:1066px;width:300px;font-weight:400;font-size:43px;line-height:1;letter-spacing:4px;white-space:nowrap;color:#1c1b18;font-family:{{FONT:label|${SANS_EN}}}">{{TEXT:label}}</div>
</div>`;
