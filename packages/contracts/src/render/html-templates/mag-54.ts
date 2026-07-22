// mag-54 HTML 模板（外观真相源，镜像自 templates/mag-54/index.tsx 的 WebMag54）。
// #303 首个跨页模板：通栏满版大图横穿中缝（category: interior，1 图 + 1 标题）。
// 画布 1588×1123（双宽，PAGE.width*2）：中缝落在 x=794，装订会吃掉附近一点，
// 关键内容避开 x∈[750,840]——本版式标题从 x=96 起，安全。
// 几何逐一照抄 React 版：绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1（通栏满版大图，1588×1123 cover）、title（左半页下方压标题，variableDecor：
// 色/字体可主题，role: title，默认色 #f7f4ec、默认字体为 CJK title 角色的 Noto Serif SC 栈——
// React 走 resolveThemeCarrier，样本 "那一天" 为中文时实际解析到 noto-serif-sc）。
// 全部槽位均渲染，无省略。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const NOTO_SERIF_SC = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_54_HTML = `<div data-template="mag-54" style="position:relative;width:1588px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:0px;top:0px;width:1588px;height:1123px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:96px;bottom:104px;width:560px;height:144px;font-family:{{FONT:title|${NOTO_SERIF_SC}}};font-size:56px;line-height:1.28;letter-spacing:0.04em;color:{{COLOR:title|#f7f4ec}};text-shadow:0 2px 24px rgba(0,0,0,.45);overflow:hidden">{{TEXT:title}}</div>
</div>`;
