// mag-38 HTML 模板（外观真相源，镜像自 templates/mag-38/index.tsx 的 WebMag38）。
// 内页 · 上下满版双图叠字（category: interior，2 图）：上下两块满宽图槽
// （上 794×511 / 下 794×612），中间居中一段大字陈述句跨在两图交界处，
// 文字在图之后渲染 → z 在图上层。几何逐一照抄：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1（上方满宽图）、image2（下方满宽图）、body（居中大字，variableDecor：
// 色/字体可主题，role: title，CJK 默认解析到 serifCn；React 默认色 #1c1b18）。
// 全部槽位均渲染，无省略。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const SERIF_CN = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_38_HTML = `<div data-template="mag-38" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:0;top:0;width:794px;height:511px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:0;top:511px;width:794px;height:612px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-text-key="body" data-variable-decor style="position:absolute;left:87px;top:284px;width:620px;text-align:center;font-weight:700;font-size:48px;line-height:1.15;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${SERIF_CN}}}">{{TEXT:body}}</div>
</div>`;
