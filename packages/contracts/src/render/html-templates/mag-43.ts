// mag-43 HTML 模板(外观真相源,镜像自 templates/mag-43/index.tsx 的 WebMag43)。
// 内页 · 拼贴大字内页(category: interior,5 图):白底;上半部右侧大竖图(328×431)+
// 左中两张错落竖图(195×271 / 181×268)拼贴,右图下方一段图注;下半部「Notes /
// from Elsewhere」两行大字标题(88px / 80px),底部左右两张方图(181×184)收尾。
// 794×1123,绝对定位,px 写死。
//
// 槽位:image1~image5(五图拼贴,几何见上)、
// title/subtitle(variableDecor,色/字体可主题,role: title,sample 为拉丁 → 默认
// Playfair 栈)、caption(role: explain,React 走 resolveThemeCarrier → 给 COLOR/FONT
// token 但不带 data-variable-decor,sample 为中文 → 默认 Noto Sans SC 栈)。
// JSON 声明的槽全部渲染,无省略。caption/title/subtitle 在 React 用 whiteSpace:pre-wrap,
// HTML 同样内联 white-space:pre-wrap(caption 另有 word-break:break-word)。
// React 根节点是裸 div(无 color/box-sizing/font-family),照抄。
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_43_HTML = `<div data-template="mag-43" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:438px;top:28px;width:328px;height:431px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:221px;top:28px;width:195px;height:271px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-image-slot="image3" style="position:absolute;left:40px;top:291px;width:181px;height:268px;overflow:hidden">
    <img data-image-slot="image3" src="{{IMG_SRC:image3}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image3|50% 50%}};{{IMG_TF:image3}}" />
  </div>
  <div data-text-key="body" style="position:absolute;left:444px;top:466px;width:320px;font-family:{{FONT:body|${SANS_CN}}};font-weight:400;font-size:19px;line-height:1.4;color:{{COLOR:body|#1c1b18}};white-space:pre-wrap;word-break:break-word;overflow:hidden;height:120px">{{TEXT:body}}</div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:418px;top:647px;width:340px;font-family:{{FONT:title|${PLAYFAIR}}};font-weight:800;font-size:88px;line-height:1;color:{{COLOR:title|#1c1b18}};white-space:pre-wrap;overflow:hidden;height:160px">{{TEXT:title}}</div>
  <div data-image-slot="image4" style="position:absolute;left:221px;top:901px;width:181px;height:184px;overflow:hidden">
    <img data-image-slot="image4" src="{{IMG_SRC:image4}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image4|50% 50%}};{{IMG_TF:image4}}" />
  </div>
  <div data-image-slot="image5" style="position:absolute;left:584px;top:901px;width:181px;height:184px;overflow:hidden">
    <img data-image-slot="image5" src="{{IMG_SRC:image5}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image5|50% 50%}};{{IMG_TF:image5}}" />
  </div>
</div>`;
