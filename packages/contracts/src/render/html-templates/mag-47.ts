// mag-47 HTML 模板（外观真相源，镜像自 templates/mag-47/index.tsx 的 WebMag47）。
// 内页 · 错落四图 + 左上叙事文（category: interior，4 图）。来自 A4-19 (node 12:66)。
// 白底；左上一段大字标题 + 小字图注段，四张等大横图（320×235）错落排布：
// image1 右上、image2 左中、image3 右下、image4 左下。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1~image4（四张错落横图）、title（左上大字主标题，variableDecor：色/字体可主题，
// role: title）、explain（标题下方小字图注段，React 走 resolveThemeCarrier(role: explain)，
// 照 mag-01/37 惯例给 COLOR/FONT token，不加 data-variable-decor）。全部槽位均渲染，无省略。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const SERIF_CN = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';

export const MAG_47_HTML = `<div data-template="mag-47" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:446px;top:296px;width:320px;height:235px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:89px;top:468px;width:320px;height:235px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-image-slot="image3" style="position:absolute;left:446px;top:567px;width:320px;height:235px;overflow:hidden">
    <img data-image-slot="image3" src="{{IMG_SRC:image3}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image3|50% 50%}};{{IMG_TF:image3}}" />
  </div>
  <div data-image-slot="image4" style="position:absolute;left:89px;top:739px;width:320px;height:235px;overflow:hidden">
    <img data-image-slot="image4" src="{{IMG_SRC:image4}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image4|50% 50%}};{{IMG_TF:image4}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:89px;top:296px;width:480px;font-weight:600;font-size:33px;line-height:1.1;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${SERIF_CN}}}">{{TEXT:title}}</div>
  <div data-text-key="explain" style="position:absolute;left:89px;top:368px;width:396px;font-weight:400;font-size:18px;line-height:1.4;white-space:pre-wrap;word-break:break-word;overflow:hidden;color:{{COLOR:explain|#1c1b18}};font-family:{{FONT:explain|${SANS_CN}}}">{{TEXT:explain}}</div>
</div>`;
