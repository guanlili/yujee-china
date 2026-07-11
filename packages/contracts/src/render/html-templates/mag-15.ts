// mag-15 HTML 模板（外观真相源，收敛单渲染器）。
// 几何逐一镜像自 templates/mag-15/index.tsx（WebMag15）：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位：body（左上说明段，走 resolveThemeCarrier：给 COLOR/FONT token 不加 data-variable-decor）、
// image1（右上竖图 655×440）、image2（左下横图 400×350）、title（右下大标题 84px，variableDecor）、
// date（右下小日期，variableDecor）、folio（右下页码）。全部槽位均渲染，无省略。
// 与 React 版的两处已知差异：
// 1) React 版 title 走 brToReact 把 \n 转 <br/>，且空值兜底 'HAPPY\nCHOFU'；token 系统
//    输出纯转义文本、{{TEXT:}} 无默认值，这里用 white-space:pre-line 等效镜像换行，空值输出空。
// 2) React 版 folio 为 WebFolio：空值回退 "15"、后缀 <span>/{totalPages}</span>。
//    token 系统 {{TEXT:}} 无默认值、也没有 totalPages 数据，这里 folio 空时输出空、
//    span 静态输出 "/"（与 React totalPages 缺省时的 "/" 一致）。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_15_HTML = `<div data-template="mag-15" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <p data-text-key="body" style="position:absolute;top:90px;left:70px;width:280px;margin:0;line-height:1.7;letter-spacing:0.02em;text-align:justify;font-size:18px;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|${SANS_EN}}}">{{TEXT:body}}</p>
  <div data-image-slot="image1" style="position:absolute;top:180px;right:70px;width:655px;height:440px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;top:660px;left:70px;width:400px;height:350px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <h1 data-text-key="title" data-variable-decor style="position:absolute;top:690px;right:70px;width:460px;margin:0;text-align:right;font-weight:800;font-size:84px;letter-spacing:0.01em;line-height:1.02;white-space:pre-line;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${SANS_EN}}}">{{TEXT:title}}</h1>
  <div data-text-key="date" data-variable-decor style="position:absolute;bottom:95px;right:72px;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:{{COLOR:date|#5a574f}};font-family:{{FONT:date|${SANS_EN}}}">{{TEXT:date}}</div>
  <div data-text-key="folio" style="position:absolute;bottom:40px;right:50px;font-style:italic;font-size:22px;color:{{COLOR:folio|#1c1b18}};font-family:{{FONT:folio|${SERIF_EN}}}">{{TEXT:folio}}<span style="color:#a09b8e">/</span></div>
</div>`;
