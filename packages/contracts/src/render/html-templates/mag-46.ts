// mag-46 HTML 模板（外观真相源，镜像自 templates/mag-46/index.tsx 的 WebMag46）。
// 内页 · 拼贴对角双图叠标签骨架（category: interior，2 图）：白底；顶部大字主标题，
// 下面 when/where/who/what 四个固定骨架标签词（硬编码 furniture，非契约槽）。
// 左侧一张竖图（467×730），右下角小竖图（226×300）与之叠角，右侧小图注承接标题。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：title（顶部大字主标题，variableDecor：色/字体可主题，role: title）、
// caption（右侧小图注，React 走 resolveThemeCarrier(role: explain)，照 mag-01 惯例给
// COLOR/FONT token，不加 data-variable-decor）、image1/image2（双图）。全部槽位均渲染,无省略。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';
const SERIF_CN = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_46_HTML = `<div data-template="mag-46" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-text-key="title" data-variable-decor style="position:absolute;left:91px;top:65px;width:280px;font-weight:700;font-size:36px;line-height:1.1;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${SERIF_CN}}};height:80px">{{TEXT:title}}</div>
  <div data-text-key="explain" style="position:absolute;left:91px;top:260px;width:334px;font-weight:400;font-size:16px;line-height:1.35;white-space:pre-wrap;overflow:hidden;color:{{COLOR:explain|#1c1b18}};font-family:{{FONT:explain|${SANS_CN}}};height:60px">{{TEXT:explain}}</div>
  <div data-image-slot="image1" style="position:absolute;left:91px;top:331px;width:467px;height:730px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:478px;top:761px;width:226px;height:300px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
</div>`;
