// mag-11 HTML 模板（外观真相源，镜像自 templates/mag-11/index.tsx 的 WebMag11）。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image（竖幅大图 top:120 left/right:25 h:640）、title（左下大标题 h1，variableDecor，
// brToReact 换行）、label（title 下小标签，variableDecor）、explain（右侧说明段）、folio（右下页码）。
// 全部槽位均渲染，无省略。
//
// 与 React 版的已知差异（token 语法表达不了的部分，均取 React 链条的末端默认值）：
// - title 在 React 里经 brToReact 把 \n 渲染成 <br/>；HTML 版用 white-space:pre-line 等效。
// - title 的 `titleTheme.text ?? d.title ?? 'CHERRY\nBUCKET'` 兜底：TEXT token 不支持默认值，
//   title 为空时渲染空串。
// - folio 的 `folio || '11'` 兜底同理，folio 为空时渲染空串。`/{totalPages}` 后缀：
//   fill-template 无 totalPages 输入，只保留静态 "/"（先例 mag-03/05/06）。
// - title/label/explain 的字体在 React 是 theme.webFontFamily，未定义时继承页面 sansEn，
//   FONT token 默认写 SANS_EN；folio 默认取 WebFolio 的 serifEn。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_11_HTML = `<div data-template="mag-11" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-image-slot="image" style="position:absolute;top:120px;left:25px;right:25px;height:640px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:740px;height:640px;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <h1 data-text-key="title" data-variable-decor style="position:absolute;top:792px;left:40px;margin:0;width:360px;font-weight:700;font-size:76px;letter-spacing:0.02em;line-height:1.1;white-space:pre-line;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${SANS_EN}}};height:78px">{{TEXT:title}}</h1>
  <div style="position:absolute;top:992px;left:50px;width:280px">
    <div data-text-key="explain" data-variable-decor style="font-size:14px;letter-spacing:0.02em;color:{{COLOR:explain|#1c1b18}};text-transform:uppercase;font-family:{{FONT:explain|${SANS_EN}}};font-weight:600;white-space:pre-wrap;width:280px;height:24px;line-height:1.6">{{TEXT:explain}}</div>
  </div>
  <div style="position:absolute;top:800px;right:50px;width:200px;line-height:1.75;color:#5a574f;letter-spacing:0.02em;text-align:justify">
    <p data-text-key="body" style="margin:0;font-size:18px;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|${SANS_EN}}};white-space:pre-wrap;width:200px;height:63px;left:100px;letter-spacing:0.02em;line-height:1.7">{{TEXT:body}}</p>
  </div>
</div>`;
