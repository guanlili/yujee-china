// mag-44 HTML 模板（外观真相源，镜像自 templates/mag-44/index.tsx 的 WebMag44）。
// 内页 · 大字拼贴（category: interior，2 图）：白底；左上超大字主标题（Notes 风，108px），
// 右上一张竖图（356×527）、左下一张竖图（364×536）错落拼贴，中部一行短句、右下角一段图注收尾。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1（右上竖图）、image2（左下竖图）、title（超大字主标题，variableDecor：
// 色/字体可主题，role: title，sample 为拉丁 → 默认 Playfair）、line（中部短句）、
// caption（右下图注）。line/caption 非 variableDecor 但 React 走 resolveThemeCarrier(role:
// explain)，照 mag-01 惯例给 COLOR/FONT token，不加 data-variable-decor。全部槽位均渲染，无省略。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';

export const MAG_44_HTML = `<div data-template="mag-44" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:438px;top:28px;width:356px;height:527px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:28px;top:555px;width:364px;height:536px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:28px;top:28px;width:440px;font-weight:700;font-size:108px;line-height:1.1;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}};height:200px;letter-spacing:0.02em">{{TEXT:title}}</div>
  <div data-text-key="explain" style="position:absolute;left:29px;top:508px;width:334px;font-weight:400;font-size:14px;line-height:1.6;white-space:pre-wrap;overflow:hidden;color:{{COLOR:explain|#1c1b18}};font-family:{{FONT:explain|${SANS_CN}}};height:28px;letter-spacing:0.02em">{{TEXT:explain}}</div>
  <div data-text-key="body" style="position:absolute;left:405px;top:900px;width:356px;font-weight:400;font-size:18px;line-height:1.7;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${SANS_CN}}};height:120px;letter-spacing:0.02em">{{TEXT:body}}</div>
</div>`;
