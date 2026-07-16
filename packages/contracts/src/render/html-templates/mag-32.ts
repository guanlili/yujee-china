// mag-32 HTML 模板（外观真相源，镜像自 templates/mag-32/index.tsx 的 WebMag32）。
// 封面（category: cover，1 图）：白底；满高大图（左 103 起、691×1123，偏右铺满整页高）；
// 左缘主竖排大地名（rotate 90°）；左下角大号主标题。几何逐一照抄：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
//
// 槽位：image（满高大图）、title/label（variableDecor：色/字体可主题）。全部槽位均渲染，无省略（JSON 无 folio 槽）。
// 静态装饰（左下竖排小地名 + 底部横排小地名）：React 版注释称 furniture，但代码实际渲染的是
// label 槽的动态值（{label}）、字体走 labelTheme.webFontFamily、颜色写死 #1c1b18 ——
// 这里忠实照抄代码：内容用 {{TEXT:title}}、字体用 {{FONT:title|…}}，不加 data-text-key /
// data-variable-decor 锚点（锚点只留在主 label 槽上），颜色写死。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_32_HTML = `<div data-template="mag-32" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image" style="position:absolute;left:103px;top:0;width:691px;height:1123px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:691px;height:1123px;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:110px;top:160px;width:460px;font-weight:700;font-size:85px;line-height:1.1;letter-spacing:0.02em;white-space:pre;transform:rotate(90deg);transform-origin:left top;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${SANS_EN}}};height:100px">{{TEXT:title}}</div>
  <div data-text-key="body" data-variable-decor style="position:absolute;left:56px;top:900px;width:300px;height:100px;font-weight:700;font-size:{{FIT_SIZE:body|620,96,44}}px;line-height:1.05;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${PLAYFAIR}}}">{{TEXT:body}}</div>

  <div data-text-key="explain" style="position:absolute;left:60px;top:1060px;width:200px;font-size:14px;line-height:1.6;letter-spacing:0.02em;color:{{COLOR:explain|#5a574f}};font-family:{{FONT:explain|&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif}};white-space:pre-wrap;height:26px">{{TEXT:explain}}</div>
</div>`;
