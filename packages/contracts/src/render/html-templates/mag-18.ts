// mag-18 HTML 模板（外观真相源，收敛单渲染器）。
// 几何逐一镜像自 templates/mag-18/index.tsx（WebMag18）：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位：image1（左侧竖图 320×600）、image2（右侧竖图 320×600）、
// explain1/explain2（左右两栏说明段，React 走 resolveThemeCarrier，照 mag-01 惯例给
// COLOR/FONT token，不加 data-variable-decor）、folio（右下页码，decoration 主题）。
// 全部槽位均渲染，无省略。静态装饰："PLATE I" / "PLATE II" 小标签（Montserrat，#a09b8e）。
// 与 React 版的已知差异：React 版 folio 为 WebFolio：空值回退 "18"、后缀
// <span>/{totalPages}</span>。token 系统 {{TEXT:}} 无默认值、也没有 totalPages 数据，
// 这里 folio 空时输出空、span 静态输出 "/"（与 React totalPages 缺省时的 "/" 一致，
// 先例见 mag-03/05/06）。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const MONTSERRAT = '&quot;Montserrat&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_18_HTML = `<div data-template="mag-18" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-image-slot="image1" style="position:absolute;top:170px;left:70px;width:320px;height:600px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;top:170px;right:70px;width:320px;height:600px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div style="position:absolute;top:778px;left:70px;width:320px">
    <p data-text-key="explain" style="margin:0;line-height:1.6;letter-spacing:0.02em;text-align:justify;font-size:14px;color:{{COLOR:explain|#5a574f}};font-family:{{FONT:explain|${SANS_EN}}};white-space:pre-wrap;width:320px;height:53px">{{TEXT:explain}}</p>
  </div>
  <div style="position:absolute;top:778px;right:70px;width:320px">
    <p data-text-key="explain2" style="margin:0;line-height:1.6;letter-spacing:0.02em;text-align:justify;font-size:14px;color:{{COLOR:explain2|#5a574f}};font-family:{{FONT:explain2|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain2}}</p>
  </div>
</div>`;
