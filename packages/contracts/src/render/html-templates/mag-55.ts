// mag-55 HTML 模板（外观真相源，镜像自 templates/mag-55/index.tsx 的 WebMag55）。
// #303 第二个真跨页模板（category: interior，3 图 + 2 字）。来源 Figma A4-7 通栏跨页
// （fileKey 5uKJQlCURRrrCBU1pd1QT6 / node 11:271，1190×842 ×1.3344）。mag-52/53（已退役）
// 曾是这同一张 Figma 当年被手工拆成的左右两张假跨页 A4；mag-52 里那段手写矢量 furniture
// （node 11:331）在 Figma 里已被替换成可编辑文字节点 28:55 "the slow afternoon" —— 这里按
// 现状还原成真文字槽（label，role: decoration），不内联那段 HANDWRITING_SVG。
// 画布 1588×1123（双宽，PAGE.width*2）：中缝落在 x=794，装订会吃掉附近一点；大图
// （image3）与大标题（title）按 Figma 原坐标故意跨中缝渲染（image3 spans x∈[614,1521]，
// title spans x∈[491,1237]）——这正是跨页的意义，不回避 x∈[750,840]。
// 几何逐一照抄 React 版：绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1/image2（左上两张小图，240×260 cover）、image3（右侧跨中缝大图，907×1001
// cover）、label（手写体副标题，variableDecor：role decoration，默认字体走 CJK 装饰角色的
// 志莽行书栈）、title（跨中缝大标题，variableDecor：role title，默认字体走 CJK title 角色的
// Noto Serif SC 栈）。z 序：image1 → image2 → image3 → label → title（title 压在大图上层，
// 必须最后渲染才可见）。全部槽位均渲染，无省略。React 根节点是裸 div（无 color/box-sizing/
// font-family），照抄。
const NOTO_SERIF_SC = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';
const ZHI_MANG_XING = '&quot;Zhi Mang Xing&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_55_HTML = `<div data-template="mag-55" style="position:relative;width:1588px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:0px;top:0px;width:240px;height:260px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:251px;top:0px;width:240px;height:260px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-image-slot="image3" style="position:absolute;left:614px;top:61px;width:907px;height:1001px;overflow:hidden">
    <img data-image-slot="image3" src="{{IMG_SRC:image3}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image3|50% 50%}};{{IMG_TF:image3}}" />
  </div>
  <div data-text-key="label" data-variable-decor style="position:absolute;left:140px;top:295px;width:474px;height:107px;font-family:{{FONT:label|${ZHI_MANG_XING}}};font-size:80px;line-height:1.1;color:{{COLOR:label|#111}};overflow:hidden">{{TEXT:label}}</div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:491px;top:833px;width:746px;height:207px;font-family:{{FONT:title|${NOTO_SERIF_SC}}};font-size:93px;line-height:1.05;letter-spacing:-0.01em;color:{{COLOR:title|#262626}};overflow:hidden">{{TEXT:title}}</div>
</div>`;
