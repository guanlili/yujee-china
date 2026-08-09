// mag-13 HTML 模板（外观真相源，收敛单渲染器）。
// 几何逐一镜像自 templates/mag-13/index.tsx（WebMag13）：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位：title（顶部居中大标题，variableDecor：色/字体可主题）、image（中部大图 left/right:90 × 520 高）、
// explain（图下居中说明段，走 resolveThemeCarrier，非 variableDecor）。
//
// 省略的槽位（React 版没渲染，锚点和 token 一起省略）：
// - folio：WebMag13 不渲染页码（无 WebFolio 调用），与 index.tsx 一致。
//
// 与 React 版的已知差异（token 语法表达不了的部分，均取 React 链条的末端默认值）：
// - divider 是 svgs 槽（variableDecor），React 为 `backgroundColor: d.divider || COLORS.ink2`。
//   token 系统只有 TEXT/COLOR/FONT/IMG_* 通道且 lint 只认 texts/images 槽，svg 槽无 token
//   通道，这里写成静态色（= COLORS.ink2，即 d.divider 为空时的 React 行为）；fill 为
//   currentColor 跟随页根墨色（原写死 #5a574f，深底上会消失，Task 14 改）。
// - title 走 brToReact 把 \n 转 <br/>；token 系统输出纯转义文本，这里用
//   white-space:pre-line 等效镜像换行行为。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_13_HTML = `<div data-template="mag-13" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-text-key="title" data-variable-decor style="position:absolute;top:150px;left:200px;right:90px;font-weight:800;font-size:56px;letter-spacing:0.02em;text-align:center;line-height:1.1;white-space:pre-line;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}};width:400px;height:80px">{{TEXT:title}}</div>
  <div style="position:absolute;top:242px;left:260px;right:260px;height:2px;background-color:currentColor"></div>
  <div data-image-slot="image" style="position:absolute;top:300px;left:90px;right:90px;height:520px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:656px;height:800px;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}};top:0px" />
  </div>
  <p data-text-key="body" style="position:absolute;top:855px;left:130px;right:130px;margin:0;text-align:center;line-height:1.7;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|${SANS_EN}}};letter-spacing:0.02em;font-size:18px;white-space:pre-wrap;width:534px;height:60px">{{TEXT:body}}</p>
</div>`;
