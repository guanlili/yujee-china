// mag-01 HTML 模板（外观真相源，收敛单渲染器试点）。
// 几何逐一镜像自 templates/mag-01/index.tsx（WebMag01）：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位：title（大标题，variableDecor：色/字体可主题）、label（左侧竖排小标签，variableDecor）、
// image（右上大图 660×460）、explain1/explain2（左下两段说明）。folio 在 mag-01 不渲染（与 index.tsx 一致）。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const MONO = '&quot;JetBrains Mono&quot;, &quot;Noto Sans SC&quot;, &quot;Menlo&quot;, monospace';

export const MAG_01_HTML = `<div data-template="mag-01" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div style="position:absolute;top:140px;left:130px;right:130px;display:flex;align-items:center;gap:16px">
    <div data-text-key="title" data-variable-decor style="letter-spacing:0.02em;font-weight:700;font-size:{{FIT_SIZE:title|440,72,32}}px;line-height:1.1;white-space:pre;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}};width:460px;height:80px">{{TEXT:title}}</div>
    <div style="flex:1;height:3px;background:#1c1b18"></div>
    <div style="width:26px;height:26px;border-radius:50%;border:1px solid #1c1b18;display:flex;align-items:center;justify-content:center;font-family:${MONO};font-size:16px">N</div>
  </div>
  <div data-text-key="label" data-variable-decor style="position:absolute;top:460px;left:56px;writing-mode:vertical-rl;letter-spacing:0.36em;color:{{COLOR:label|#5a574f}};text-transform:uppercase;font-size:14px;font-family:{{FONT:label|${SANS_EN}}};width:21px;height:232px;white-space:pre-wrap">{{TEXT:label}}</div>
  <div data-image-slot="image" style="position:absolute;top:240px;right:0;width:660px;height:460px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="body" style="position:absolute;left:135px;top:750px;line-height:1.7;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|${SANS_EN}}};letter-spacing:0.02em;font-size:18px;width:400px;height:300px;bottom:0px;white-space:pre-wrap">{{TEXT:body}}</div>
</div>`;
