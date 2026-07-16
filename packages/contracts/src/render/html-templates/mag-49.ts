// mag-49 HTML 模板（外观真相源，镜像自 templates/mag-49/index.tsx 的 WebMag49）。
// 内页 · 顶部超大标题 + 单张近方大图（category: interior，1 图）：白底；页顶横排超大
// 展示主标题；标题上方嵌固定骨架标签 when / where / who / what（2×2，写死 furniture，
// 不进契约、不可填）；中下部一张近方大图铺开。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
// React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
//
// 槽位：title（顶部超大主标题，variableDecor：色/字体可主题，role: title）、
// image（中下部近方大图 674×699）。全部槽位均渲染，无省略。
//
// 与 React 版的一处已知折衷（token 系统无法逐字拆分，先例见 mag-04 头注释）：
// React 版把 title 拆成首字母 <span style="font-size:155px"> + 其余 <span style="font-size:124px">
// 两个 span（内容同一个槽）；HTML 版 {{TEXT:title}} 整体输出，统一 124px（除首字母外
// 逐字与 React 版同尺寸，仅首字母不再略大）。外层容器几何（738×155、baseline flex、
// nowrap+hidden）照抄。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_49_HTML = `<div data-template="mag-49" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-text-key="title" data-variable-decor style="position:absolute;left:30px;top:150px;width:660px;height:155px;font-weight:700;font-size:124px;line-height:1.1;white-space:pre;overflow:hidden;display:flex;align-items:baseline;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}};letter-spacing:0.02em">{{TEXT:title}}</div>
  <div data-image-slot="image" style="position:absolute;left:28px;top:306px;width:674px;height:699px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>

  <div data-text-key="body" style="position:absolute;left:60px;top:60px;width:320px;font-size:18px;line-height:1.7;letter-spacing:0.02em;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif}};white-space:pre-wrap;height:28px">{{TEXT:body}}</div>

  <div data-text-key="body2" style="position:absolute;left:60px;top:90px;width:320px;font-size:18px;line-height:1.7;letter-spacing:0.02em;color:{{COLOR:body2|#5a574f}};font-family:{{FONT:body2|&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif}};white-space:pre-wrap;height:28px">{{TEXT:body2}}</div>

  <div data-text-key="body3" style="position:absolute;left:460px;top:60px;width:320px;font-size:18px;line-height:1.7;letter-spacing:0.02em;color:{{COLOR:body3|#3a3833}};font-family:{{FONT:body3|&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif}};white-space:pre-wrap;height:28px">{{TEXT:body3}}</div>

  <div data-text-key="body4" style="position:absolute;left:460px;top:90px;width:320px;font-size:18px;line-height:1.7;letter-spacing:0.02em;color:{{COLOR:body4|#3a3833}};font-family:{{FONT:body4|&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif}};white-space:pre-wrap;height:28px">{{TEXT:body4}}</div>
</div>`;
