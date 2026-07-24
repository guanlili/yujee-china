// mag-56 HTML 模板（外观真相源，镜像自 templates/mag-56/index.tsx 的 WebMag56）。
// #303 第三个真跨页模板（category: interior，1 图 + 1 字）。来源 Figma A4-26
// （fileKey 5uKJQlCURRrrCBU1pd1QT6 / node 28:56，1190×842 ×1.3344）。版面极简：一张
// 近满幅大图（image1，Figma 28:59）故意跨中缝渲染（spans x∈[63,1524]），左下一段收尾
// 正文（body，Figma 28:63）。画布 1588×1123（双宽，PAGE.width*2）：中缝落在 x=794，
// 图跨中缝是设计意图，不回避。body 停在 x=745（left 63 + width 682），贴着中缝左侧，
// 不进 x∈[750,840]，留在左页。
// 几何逐一照抄 React 版：绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1（跨中缝大图，1461×839 cover）、body（收尾正文，role: body，非
// variableDecor —— 契约只允许 variableDecor 挂 title/decoration，body 不能开，见
// templates.test.ts —— 但仍照 p01 的 body 做法自愿带 {{COLOR:body}}/{{FONT:body}} token
// 走主题刷，兜底赤陶色 #b23a2e；显式 height:140 + overflow:hidden 让 fitTextBoxes 自动
// 缩字生效）。z 序：image1 → body（DOM 顺序图先字后，二者本不重叠）。全部槽位均渲染，
// 无省略。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const BODY_SERIF = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_56_HTML = `<div data-template="mag-56" style="position:relative;width:1588px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:63px;top:72px;width:1461px;height:839px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-text-key="body" style="position:absolute;left:63px;top:955px;width:682px;height:140px;overflow:hidden;font-family:{{FONT:body|${BODY_SERIF}}};font-size:21px;line-height:1.5;color:{{COLOR:body|#b23a2e}};white-space:pre-wrap">{{TEXT:body}}</div>
</div>`;
