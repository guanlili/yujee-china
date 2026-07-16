// mag-05 HTML 模板（外观真相源，收敛单渲染器）。
// 几何逐一镜像自 templates/mag-05/index.tsx（WebMag05）：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位：title（左上大标题，variableDecor：色/字体可主题）、label（右上小标签，variableDecor）、
// explain（标题下说明段）、image（中下大图 left/right:50 × 600 高）、folio（右下页码）。
// 全部槽位均渲染，无省略。与 React 版的两处已知差异：
// 1) React 版 title 走 brToReact 把 \n 转 <br/>；token 系统输出纯转义文本，这里用
//    white-space:pre-line 等效镜像换行行为。
// 2) React 版 folio 为 WebFolio：空值回退 "05"、后缀 <span>/{totalPages}</span>。
//    token 系统 {{TEXT:}} 无默认值、也没有 totalPages 数据，这里 folio 空时输出空、
//    span 静态输出 "/"（与 React totalPages 缺省时的 "/" 一致）。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_05_HTML = `<div data-template="mag-05" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <h1 data-text-key="title" data-variable-decor style="position:absolute;top:96px;left:50px;right:240px;margin:0;font-size:88px;letter-spacing:0.02em;line-height:1.1;font-weight:400;text-transform:uppercase;white-space:pre-line;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}};width:400px;height:90px">{{TEXT:title}}</h1>
  <div data-text-key="explain" data-variable-decor style="position:absolute;top:120px;right:50px;width:190px;text-align:right;font-size:14px;letter-spacing:0.02em;text-transform:uppercase;color:{{COLOR:explain|#5a574f}};font-family:{{FONT:explain|${SANS_EN}}};white-space:pre-wrap;line-height:1.6">{{TEXT:explain}}</div>
  <div style="position:absolute;top:290px;left:50px;width:320px">
    <p data-text-key="body" style="margin:0;line-height:1.7;text-align:justify;letter-spacing:0.02em;font-size:18px;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|${SANS_EN}}};white-space:pre-wrap;width:400px;height:95px">{{TEXT:body}}</p>
  </div>
  <div data-image-slot="image" style="position:absolute;top:430px;left:50px;right:50px;height:600px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
</div>`;
