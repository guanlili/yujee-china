// mag-33 HTML 模板(外观真相源,镜像自 templates/mag-33/index.tsx 的 WebMag33)。
// 内页(category: interior,3 图):白底;三张等大横图(376×247)垂直堆叠、水平居中偏左,
// 左侧留白放竖排大字标题,每张图右侧留白放小图注。794×1123,绝对定位,px 写死。
//
// 槽位:image1/image2/image3(三联横图 376×247,top 159/438/717)、
// title(variableDecor,色/字体可主题,role: title,sample 为拉丁 → 默认 Playfair 栈)、
// caption1/caption2/caption3(role: explain,React 走 resolveThemeCarrier → 给
// COLOR/FONT token 但不带 data-variable-decor,sample 为中文 → 默认 Noto Sans SC 栈)。
// JSON 声明的槽全部渲染,无省略。title/caption* 在 React 用 whiteSpace:pre-wrap,
// HTML 同样内联 white-space:pre-wrap。React 根节点是裸 div(无 color/box-sizing/
// font-family),照抄。
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_33_HTML = `<div data-template="mag-33" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:200px;top:159px;width:376px;height:247px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:200px;top:438px;width:376px;height:247px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-image-slot="image3" style="position:absolute;left:200px;top:717px;width:376px;height:247px;overflow:hidden">
    <img data-image-slot="image3" src="{{IMG_SRC:image3}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image3|50% 50%}};{{IMG_TF:image3}}" />
  </div>
</div>`;
