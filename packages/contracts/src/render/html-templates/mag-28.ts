// mag-28 HTML 模板(外观真相源,镜像自 templates/mag-28/index.tsx 的 WebMag28)。
// 内页 · 满版大图叠字(category: interior,1 图):白底;右侧一张满高大图(661×990),
// 左侧大字主标题 + 大字陈述句与左下角小图注叠在图上方(文字在图之后渲染 → z 顺序在图上层)。
// 794×1123,绝对定位,px 写死。React 根节点是裸 div(无 color/box-sizing/font-family),照抄。
//
// 槽位:title/headline(variableDecor,色/字体可主题,role: title;title 样例为拉丁
// → 默认 Playfair,headline 样例为中文 → 默认中文衬线栈)、explain(role: explain,
// React 走 resolveThemeCarrier → 给 COLOR/FONT token 但不带 data-variable-decor,
// 中文样例 → 默认中文黑体栈)、image(右侧满高大图)。
// JSON 声明的槽全部渲染,无省略。三个文字槽 React 均 whiteSpace:pre-wrap,HTML 照抄。
// 全套文字默认色 TERRACOTTA(源码常量名如此,实际值 #1c1b18)。
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SERIF_CN = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';

export const MAG_28_HTML = `<div data-template="mag-28" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image" style="position:absolute;left:133px;top:67px;width:661px;height:990px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:28px;top:69px;width:460px;font-family:{{FONT:title|${PLAYFAIR}}};font-weight:800;font-size:64px;line-height:1.05;color:{{COLOR:title|#1c1b18}};white-space:pre-wrap;overflow:hidden;height:134px">{{TEXT:title}}</div>
  <div data-text-key="title2" data-variable-decor style="position:absolute;left:28px;top:307px;width:300px;font-family:{{FONT:title2|${SERIF_CN}}};font-weight:800;font-size:64px;line-height:1.05;color:{{COLOR:title2|#1c1b18}};white-space:pre-wrap;overflow:hidden;height:120px">{{TEXT:title2}}</div>
  <div data-text-key="explain" style="position:absolute;left:28px;bottom:66px;width:120px;font-family:{{FONT:explain|${SANS_CN}}};font-weight:400;font-size:21px;line-height:1.35;color:{{COLOR:explain|#1c1b18}};white-space:pre-wrap;overflow:hidden;height:43px">{{TEXT:explain}}</div>
</div>`;
