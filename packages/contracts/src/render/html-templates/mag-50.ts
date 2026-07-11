// mag-50 HTML 模板（外观真相源，镜像自 templates/mag-50/index.tsx 的 WebMag50）。
// 内页 · 拼贴三图 + 右下角标签骨架（category: interior，3 图）：白底；三张矩形图错落拼贴
// （左满高竖图 224×742 + 中横图 263×195 + 右上竖图 263×427），右下角一组固定骨架标签词
// when/where/who/what（硬编码 furniture，不进契约，字体 sansEn、#1c1b18），下方叠一个
// 全大写主标题（title 槽，variableDecor：色/字体可主题，role: title）。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。全部槽位均渲染，无省略。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_50_HTML = `<div data-template="mag-50" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:0;top:382px;width:224px;height:742px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:173px;top:510px;width:263px;height:195px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-image-slot="image3" style="position:absolute;left:504px;top:119px;width:263px;height:427px;overflow:hidden">
    <img data-image-slot="image3" src="{{IMG_SRC:image3}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image3|50% 50%}};{{IMG_TF:image3}}" />
  </div>
  <div style="position:absolute;left:436px;top:793px;font-family:${SANS_EN};font-weight:400;font-size:18px;line-height:1;color:#1c1b18;white-space:nowrap">when</div>
  <div style="position:absolute;left:595px;top:793px;font-family:${SANS_EN};font-weight:400;font-size:18px;line-height:1;color:#1c1b18;white-space:nowrap">where</div>
  <div style="position:absolute;left:436px;top:818px;font-family:${SANS_EN};font-weight:400;font-size:18px;line-height:1;color:#1c1b18;white-space:nowrap">who</div>
  <div style="position:absolute;left:595px;top:818px;font-family:${SANS_EN};font-weight:400;font-size:18px;line-height:1;color:#1c1b18;white-space:nowrap">what</div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:436px;top:843px;width:320px;font-weight:400;font-size:18px;line-height:1;text-transform:uppercase;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}}">{{TEXT:title}}</div>
</div>`;
