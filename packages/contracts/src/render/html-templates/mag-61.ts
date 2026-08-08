// mag-61 HTML 模板（外观真相源，镜像自 templates/mag-61/index.tsx 的 WebMag61）。
// 内页 · 双栏记事页（category: interior，2 图）：白底；对角布局 ——
// 左上竖图贴左缘配右侧正文（body），右下大竖图配左侧窄栏正文（body2）。
// 版式来自「排版板式」Figma 稿 A4 - 32（node 50:31，595×842 → ×1.3344 → 794×1123）。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1（左上竖图）/image2（右下大竖图）、body/body2（双正文，非 variableDecor
// 但照 mag-29 惯例给 COLOR/FONT token，不加 data-variable-decor）。
// 全部槽位均渲染，无省略。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';

export const MAG_61_HTML = `<div data-template="mag-61" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:0;top:139px;width:286px;height:379px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-text-key="body" style="position:absolute;left:346px;top:139px;width:376px;height:363px;font-weight:500;font-size:19px;line-height:1.36;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${SANS_EN}}}">{{TEXT:body}}</div>
  <div data-image-slot="image2" style="position:absolute;left:346px;top:630px;width:396px;height:440px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-text-key="body2" style="position:absolute;left:32px;top:653px;width:254px;height:418px;font-weight:500;font-size:19px;line-height:1.36;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body2|#1c1b18}};font-family:{{FONT:body2|${SANS_EN}}}">{{TEXT:body2}}</div>
</div>`;
