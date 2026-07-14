// mag-08 HTML 模板（外观真相源，收敛单渲染器）。
// 几何逐一镜像自 templates/mag-08/index.tsx（WebMag08）：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位：date（右上斜体大日期，variableDecor）、image（左侧竖图 360×550）、
// explain1（照片下单行说明）、explain2（右栏长说明）、title（左下大标题，variableDecor）、
// folio（右下页码）。全部槽位均渲染，无省略。
//
// 与 React 版的已知差异（token 体系表达不了的部分）：
// - date：React 把 "08/24" 按 "/" 拆开、斜杠单独着色（默认 #5a574f）；HTML 只能整段
//   {{TEXT:label}} 单色输出。有主题强调色时两者本就同色，仅默认态丢失双色斜杠。
// - explain2：React 按 "\n\n" 拆成多个 <p>（段间距 14px）；HTML 用 white-space:pre-line
//   让空行自然成段（段间距约一行高），视觉近似。
// - folio：React 版尾随 <span>/{totalPages}</span>；HTML 管线没有 totalPages 输入，
//   与 React 收到 totalPages=undefined 时的输出一致（只渲染 "/"）。folio 空值时
//   React 兜底 "08"，TEXT token 无默认值，空则留白。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_08_HTML = `<div data-template="mag-08" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-text-key="label" data-variable-decor style="position:absolute;top:96px;right:70px;font-style:italic;font-size:46px;line-height:1;letter-spacing:0.02em;color:{{COLOR:label|#1c1b18}};font-family:{{FONT:label|${SANS_EN}}};white-space:pre-wrap;width:107px;height:46px">{{TEXT:label}}</div>
  <div data-image-slot="image" style="position:absolute;left:70px;top:100px;width:360px;height:550px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <p data-text-key="explain" style="margin:0;position:absolute;left:70px;top:660px;width:360px;height:48px;font-size:18px;line-height:1.7;color:{{COLOR:explain|#5a574f}};font-family:{{FONT:explain|${SANS_EN}}};letter-spacing:0.04em;text-align:justify;white-space:pre-wrap">{{TEXT:explain}}</p>
  <div data-text-key="body" style="position:absolute;left:470px;top:280px;width:260px;font-size:16px;line-height:1.7;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|${SANS_EN}}};letter-spacing:0.04em;text-align:justify;white-space:pre-line;height:355px">{{TEXT:body}}</div>
  <h1 data-text-key="title" data-variable-decor style="margin:0;position:absolute;left:70px;top:920px;width:280px;height:96px;font-weight:400;font-size:78px;letter-spacing:0.01em;line-height:1.05;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}};white-space:pre-wrap">{{TEXT:title}}</h1>
</div>`;
