// mag-53 HTML 模板（外观真相源）。
// 几何逐一镜像自 templates/mag-53/index.tsx（WebMag53）：794×1123、白底、绝对定位、写死 px。
// 内页 · 跨页大图叠字右半页（1 图）：跨页大图与跨页大标题均为负 left（-180），
// 左溢出由根节点 overflow:hidden 裁掉，只显示右页片段。
// React 版根节点是裸 div（非 WebPage），无 font-family/color/box-sizing——此处同样不加。
//
// 槽位：image（跨页大图右片段 907×1001）、title（跨页大标题右片段，variableDecor：
// 色/字体可主题，默认陶土黑 #1c1b18、Playfair 栈，pre-wrap 保留换行）。
// JSON 声明的槽位全部渲染，无省略。
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_53_HTML = `<div data-template="mag-53" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image" style="position:absolute;left:-180px;top:61px;width:907px;height:1001px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:-180px;top:823px;width:1265px;height:346px;font-family:{{FONT:title|${PLAYFAIR}}};font-weight:400;font-size:120px;line-height:1.05;color:{{COLOR:title|#1c1b18}};white-space:pre-wrap;overflow:hidden">{{TEXT:title}}</div>
</div>`;
