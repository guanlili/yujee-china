// mag-60 HTML 模板（外观真相源，镜像自 templates/mag-60/index.tsx 的 WebMag60）。
// 内页 · 记事页（category: interior，2 图）：白底；左上竖图贴左缘 + 右侧大竖图贴右缘，
// 下方左对齐日期小字（label）/ 手写体大标题（Great Vibes）/ 一段正文。
// 版式来自「排版板式」Figma 稿 A4 - 31（node 42:3，595×842 → ×1.3344 → 794×1123）。
// Figma 标题字体 Alex Brush 不在项目字体目录,取目录内最接近的手写体 Great Vibes。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1（左上竖图）/image2（右侧大竖图）、title/label（variableDecor：色/字体可主题）、
// body（非 variableDecor 但照 mag-29 惯例给 COLOR/FONT token，不加 data-variable-decor）。
// 全部槽位均渲染，无省略。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const GREAT_VIBES = '&quot;Great Vibes&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, cursive';

export const MAG_60_HTML = `<div data-template="mag-60" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:0;top:0;width:286px;height:379px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:398px;top:85px;width:396px;height:508px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-text-key="label" data-variable-decor style="position:absolute;left:91px;top:594px;width:232px;height:33px;font-weight:500;font-size:19px;line-height:1.3;white-space:pre-wrap;overflow:hidden;color:{{COLOR:label|#1c1b18}};font-family:{{FONT:label|${SANS_EN}}}">{{TEXT:label}}</div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:91px;top:639px;width:464px;height:188px;font-weight:400;font-size:67px;line-height:1.25;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${GREAT_VIBES}}}">{{TEXT:title}}</div>
  <div data-text-key="body" style="position:absolute;left:91px;top:827px;width:648px;height:238px;font-weight:500;font-size:19px;line-height:1.36;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${SANS_EN}}}">{{TEXT:body}}</div>
</div>`;
