// mag-06 HTML 模板(外观真相源,收敛单渲染器)。
// 几何逐一镜像自 templates/mag-06/index.tsx(WebMag06):794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token(见 fill-template.ts)。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位:image(整版竖图 628×943,left:83/top:90)、folio(右下页码,role=decoration)。
// folio 非 variableDecor,但 React 版经 resolveThemeCarrier 取 accentColor/webFontFamily
// (WebFolio 默认 COLORS.ink + WEB_FONTS.serifEn),故用 COLOR/FONT token 忠实镜像,
// 不加 data-variable-decor 属性。
// 与 React 版的两处已知差异(token 体系无法表达):
// 1. WebFolio 的 `/{totalPages}` 后缀:fill-template 无 totalPages token,斜杠保留为
//    静态装饰,页码数留空(等价于 React 版 totalPages 未传时的输出)。
// 2. WebFolio 的 fallback="06"(folio 文案为空时兜底):TEXT token 无默认值语法,空则空。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_06_HTML = `<div data-template="mag-06" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-image-slot="image" style="position:absolute;left:83px;top:90px;width:628px;height:943px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
</div>`;
