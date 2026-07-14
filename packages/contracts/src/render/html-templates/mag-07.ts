// mag-07 HTML 模板(外观真相源,收敛单渲染器)。
// 几何逐一镜像自 templates/mag-07/index.tsx(WebMag07):794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token(见 fill-template.ts)。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位:explain1/explain2(左侧两段说明,外框+内 <p> 双层结构照抄 React)、
// image1(右上横图 380×330,JSX 实际写死 top:60,LAYOUT 注释里的 y:90 未被使用,以 JSX 为准)、
// image2(右下竖图 380×480)、title(左下贴底大字,variableDecor:色/字体可主题)、folio(右下页码)。
// 与 React 版的两处已知差异(token 体系表达不了,均已尽量贴近):
// 1. title 在 React 里经 brToReact 把 \n 渲染成 <br/>;HTML 版改用 white-space:pre-line
//    达到同样的换行效果(token 输出会保留 \n 字面量)。
// 2. folio 在 React 里是 WebFolio:文案空时回退 "07",并拼 /totalPages;
//    HTML 管线没有 totalPages 输入、TEXT token 也无默认值语法,故只渲染 {{TEXT:folio}} + 静态 "/"
//    (等价于 React 在 totalPages 为 undefined 时的输出;folio 文案为空时不再显示 "07")。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_07_HTML = `<div data-template="mag-07" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div style="position:absolute;top:150px;left:50px;width:240px;height:330px">
    <p data-text-key="body" style="position:absolute;left:10px;top:20px;width:260px;height:120px;margin:0;line-height:1.7;text-align:justify;letter-spacing:0.02em;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|${SANS_EN}}};font-size:18px;white-space:pre-wrap">{{TEXT:body}}</p>
  </div>
  <div data-image-slot="image1" style="position:absolute;left:364px;top:60px;width:380px;height:330px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div style="position:absolute;top:510px;left:50px;width:260px;height:420px">
    <p data-text-key="body2" style="position:absolute;left:10px;top:20px;width:260px;height:260px;margin:0;line-height:1.7;text-align:justify;letter-spacing:0.02em;color:{{COLOR:body2|#5a574f}};font-family:{{FONT:body2|${SANS_EN}}};font-size:18px;white-space:pre-wrap">{{TEXT:body2}}</p>
  </div>
  <div data-image-slot="image2" style="position:absolute;left:364px;top:450px;width:380px;height:480px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <h1 data-text-key="title" data-variable-decor style="position:absolute;bottom:70px;left:50px;width:260px;margin:0;font-size:104px;letter-spacing:0.02em;line-height:0.92;font-weight:400;white-space:pre-line;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}};height:191px">{{TEXT:title}}</h1>
</div>`;
