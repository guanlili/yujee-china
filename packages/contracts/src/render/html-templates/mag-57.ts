// mag-57 HTML 模板（外观真相源，镜像自 templates/mag-57/index.tsx 的 WebMag57）。
// #303 第四个真跨页模板（category: interior，1 图 + 3 字）。来源 Figma A4-27
// （fileKey 5uKJQlCURRrrCBU1pd1QT6 / node 33:65，1190×842 ×1.3344）。版面：右页整幅
// 大图（image1，Figma 33:66），左页放大标题（title，34:74）+ 一大段正文
// （body，34:77），底部一行小标签（label，36:79）。画布 1588×1123（双宽，
// PAGE.width*2）：中缝落在 x=794，图槽左缘正贴中缝（left:794），填满右页。
// 几何逐一照抄 React 版：绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 条形码字体降级（已确认）：原稿 label 用 Libre Barcode 39 Text 条形码字体渲文字，
// 字体目录里没有这个字体（font-catalog.ts 查证过）。不装/不内联该字体，也不做矢量
// furniture —— label 按普通 decoration 文字槽渲染（role: decoration，variableDecor：
// 带 data-variable-decor，色/字走主题刷，默认字体走英文无衬线栈），这是已知、可接受
// 的降级。
//
// 槽位：image1（右页整幅大图，794×1123 cover）、title（放大标题，role: title，
// variableDecor，ExtraBold，默认字体走 CJK title 角色的 Noto Serif SC 栈）、body
// （长正文，role: body，非 variableDecor —— 契约只允许 variableDecor 挂 title/decoration，
// body 不能开，见 templates.test.ts —— 但仍照 p01/mag-56 的 body 做法自愿带
// {{COLOR:body}}/{{FONT:body}} token 走主题刷，兜底赤陶色 #b23a2e）、label（底部小标签，
// role: decoration，variableDecor，lang en）。z 序：image1 → title → body → label。
// 全部槽位均渲染，无省略。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const NOTO_SERIF_SC = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';

export const MAG_57_HTML = `<div data-template="mag-57" style="position:relative;width:1588px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:794px;top:0px;width:794px;height:1123px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:80px;top:197px;width:494px;height:111px;overflow:hidden;font-family:{{FONT:title|${NOTO_SERIF_SC}}};font-size:43px;font-weight:800;line-height:1.1;color:{{COLOR:title|#b23a2e}}">{{TEXT:title}}</div>
  <div data-text-key="body" style="position:absolute;left:77px;top:490px;width:618px;height:510px;overflow:hidden;font-family:{{FONT:body|${NOTO_SERIF_SC}}};font-size:21px;line-height:1.5;color:{{COLOR:body|#b23a2e}};white-space:pre-wrap">{{TEXT:body}}</div>
  <div data-text-key="label" data-variable-decor style="position:absolute;left:443px;top:999px;width:488px;height:29px;overflow:hidden;font-family:{{FONT:label|${SANS_EN}}};font-size:21px;line-height:1.5;color:{{COLOR:label|#b23a2e}}">{{TEXT:label}}</div>
</div>`;
