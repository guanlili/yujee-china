// mag-19 HTML 模板(外观真相源,收敛单渲染器)。
// 几何逐一镜像自 templates/mag-19/index.tsx(WebMag19):794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token(见 fill-template.ts)。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位:title(顶部居中斜体大字,variableDecor:色/字体可主题)、image(中部方图 674×674)、
// explain1/explain2(底部左右两栏说明)、folio(右下页码)。全部槽位均渲染,无省略。
// 与 React 版的已知差异(token 体系表达不了,均取 React 链条的末端默认值):
// 1. 右侧竖排装饰 "Frame {folio} / 30":React 里 folio 空时回退 "19"(`d.folio || '19'`),
//    TEXT token 无默认值语法,folio 空时渲染 "Frame  / 30"。该元素内容是静态文案 + folio
//    插值的混合体,不挂 data-text-key(锚点只挂右下纯页码元素,lint 锚点/token 仍成对);
//    其色/字体走 folioTheme,用 {{COLOR:folio|#a09b8e}}(accentColor ?? ink3)+ {{FONT:folio}} 表达。
// 2. folio 页码在 React 里是 WebFolio:文案空时回退 "19",并拼 /totalPages;
//    HTML 管线没有 totalPages 输入、TEXT token 也无默认值语法,故只渲染 {{TEXT:folio}} + 静态 "/"
//    (等价于 React 在 totalPages 为 undefined 时的输出;先例见 mag-03/05/07)。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_19_HTML = `<div data-template="mag-19" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <p data-text-key="title" data-variable-decor style="position:absolute;top:80px;left:60px;width:674px;height:72px;margin:0;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.1;letter-spacing:0.02em;font-size:72px;font-style:italic;white-space:pre;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}}">{{TEXT:title}}</p>
  <div data-image-slot="image" style="position:absolute;top:170px;left:60px;width:674px;height:674px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <p data-text-key="explain" style="position:absolute;top:868px;left:60px;width:300px;margin:0;line-height:1.6;letter-spacing:0.02em;text-align:left;font-size:14px;color:{{COLOR:explain|#5a574f}};font-family:{{FONT:explain|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain}}</p>
  <p data-text-key="explain2" style="position:absolute;top:868px;right:60px;width:300px;margin:0;line-height:1.6;letter-spacing:0.02em;text-align:right;font-size:14px;color:{{COLOR:explain2|#5a574f}};font-family:{{FONT:explain2|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain2}}</p>
</div>`;
