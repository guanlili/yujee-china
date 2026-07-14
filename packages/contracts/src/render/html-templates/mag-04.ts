// mag-04 HTML 模板(外观真相源,收敛单渲染器)。
// 几何逐一镜像自 templates/mag-04/index.tsx(WebMag04):794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token(见 fill-template.ts)。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位:image1(左上方图 380×360)、date(右上大号日期数字,variableDecor:色/字体可主题)、
// explain1(左中说明段)、image2(右下竖图 280×580)、explain2(左下说明段,左侧带竖线装饰)、
// folio(右下角页码,斜体)。全部槽位均渲染,无省略。
//
// 与 React 版的两处已知折衷(token 系统无法逐字拆分/无 totalPages 输入):
// 1. date:React 版把 "04/24" 拆成 dn[0] + <span style="margin-left:0.35em">/dn[1]</span>,
//    span 无主题色时用 ink3(#a09b8e);HTML 版 {{TEXT:title}} 整体输出,单一颜色、无拆分间距。
// 2. folio:React 版 WebFolio 渲染 {folio}<span>/{totalPages}</span>;fillTemplateHtml 无
//    totalPages 输入,HTML 版保留静态 "/"(等价于 WebFolio totalPages 为空时的输出)。
//    folio 的 "04" 兜底文案与 React 版一致地交由数据层,模板不内置。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_04_HTML = `<div data-template="mag-04" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-image-slot="image1" style="position:absolute;top:60px;left:50px;width:380px;height:360px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:380px;height:360px;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;top:150px;left:466px;width:280px;height:100px;font-size:108px;line-height:1;letter-spacing:0.04em;text-align:right;white-space:pre;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${SANS_EN}}}">{{TEXT:title}}</div>
  <div data-text-key="explain" style="position:absolute;top:500px;left:60px;width:347px;line-height:1.75;text-align:justify;letter-spacing:0.02em;font-size:18px;color:{{COLOR:explain|#5a574f}};font-family:{{FONT:explain|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain}}</div>
  <div data-image-slot="image2" style="position:absolute;top:460px;right:50px;width:280px;height:580px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div style="position:absolute;top:600px;left:48px;width:4px;height:63px;background:#5a574f"></div>
  <div data-text-key="body" style="position:absolute;top:600px;left:65px;width:347px;line-height:1.75;text-align:justify;letter-spacing:0.02em;font-size:18px;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|${SANS_EN}}};white-space:pre-wrap;height:400px">{{TEXT:body}}</div>
</div>`;
