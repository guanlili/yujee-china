// mag-58 HTML 模板（外观真相源，镜像自 templates/mag-58/index.tsx 的 WebMag58）。
// #303 第五个真跨页模板（category: interior，2 图 + 2 字）。来源 Figma A4-30
// （fileKey 5uKJQlCURRrrCBU1pd1QT6 / node 37:124，1190×842 ×1.3344）。版面：左页
// 整幅大图（image1，Figma 37:125），一张小图浮在中缝上（image2，37:130，跨中缝），
// 右页放标题（title，37:126）+ 一大段正文（body，37:127）。画布 1588×1123（双宽，
// PAGE.width*2）：中缝落在 x=794。
// 几何逐一照抄 React 版：绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// image1 填满左页（右缘=794=中缝）；image2 故意跨中缝（浮动 inset，设计意图，spans
// x∈[576,1011]）；title/body 在右页，均清中缝（title 起于 x=1103，image2 右缘
// x=1011，不重叠）。z 序：image1 → image2 → title → body。
//
// 槽位：image1（左页整幅大图，794×1123 cover）、image2（中缝浮动小图，435×464
// cover）、title（右页标题，role: title，variableDecor，ExtraBold，默认字体走 CJK
// title 角色的 Noto Serif SC 栈）、body（长正文，role: body，非 variableDecor ——
// 契约只允许 variableDecor 挂 title/decoration，body 不能开，见 templates.test.ts ——
// 但仍照 p01/mag-57 的 body 做法自愿带 {{COLOR:body}}/{{FONT:body}} token 走主题刷，
// 兜底赤陶色 #b23a2e）。全部槽位均渲染，无省略。React 根节点是裸 div（无 color/
// box-sizing/font-family），照抄。
const NOTO_SERIF_SC = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_58_HTML = `<div data-template="mag-58" style="position:relative;width:1588px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:0px;top:0px;width:794px;height:1123px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:576px;top:340px;width:435px;height:464px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:1103px;top:237px;width:391px;height:103px;overflow:hidden;font-family:{{FONT:title|${NOTO_SERIF_SC}}};font-size:35px;font-weight:800;line-height:1.1;color:{{COLOR:title|#b23a2e}}">{{TEXT:title}}</div>
  <div data-text-key="body" style="position:absolute;left:1103px;top:400px;width:391px;height:544px;overflow:hidden;font-family:{{FONT:body|${NOTO_SERIF_SC}}};font-size:21px;line-height:1.5;color:{{COLOR:body|#b23a2e}};white-space:pre-wrap">{{TEXT:body}}</div>
</div>`;
