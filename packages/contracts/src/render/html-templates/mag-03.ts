// mag-03 HTML 模板（外观真相源，镜像自 templates/mag-03/index.tsx 的 WebMag03）。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image（整幅竖图 top:80 left/right:50 h:925）、label（左下 kicker 小标签，variableDecor）、
// date（label 下方日期，variableDecor）、folio（右下页码）。
//
// 与 React 版的已知差异（token 语法表达不了的部分，均取 React 链条的末端默认值）：
// - date 在 React 是条件渲染（d.date 有值才出 div），HTML 恒渲染；date 为空时仅多出
//   6px 的 margin-top（空 div 无行盒），label 位置比 React 高 6px。
// - date 颜色 React 为链式回退 dateTheme.accentColor ?? labelTheme.accentColor ?? ink，
//   token 无法表达链式，写成 {{COLOR:date|#1c1b18}}（有 date 主题色时行为一致）。
// - folio 的 `folio || '03'` 兜底：TEXT token 不支持默认值，folio 为空时渲染空串。
//   `/{totalPages}` 后缀：fill-template 无 totalPages 输入，只保留静态 "/"（等价于
//   React 在 totalPages 未传时渲染的 "/"）。
// - 四角取景框线颜色 = labelTheme.accentColor ?? ink，用 {{COLOR:label|#1c1b18}} 表达。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_03_HTML = `<div data-template="mag-03" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-image-slot="image" style="position:absolute;top:80px;left:50px;right:50px;height:925px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div style="position:absolute;top:94px;left:64px;width:30px;height:30px;border-top:2px solid {{COLOR:label|#1c1b18}};border-left:2px solid {{COLOR:label|#1c1b18}}"></div>
  <div style="position:absolute;top:94px;left:702px;width:30px;height:30px;border-top:2px solid {{COLOR:label|#1c1b18}};border-right:2px solid {{COLOR:label|#1c1b18}}"></div>
  <div style="position:absolute;top:963px;left:64px;width:30px;height:30px;border-bottom:2px solid {{COLOR:label|#1c1b18}};border-left:2px solid {{COLOR:label|#1c1b18}}"></div>
  <div style="position:absolute;top:963px;left:702px;width:30px;height:30px;border-bottom:2px solid {{COLOR:label|#1c1b18}};border-right:2px solid {{COLOR:label|#1c1b18}}"></div>
  <div style="position:absolute;bottom:50px;left:50px;right:50px">
    <div data-text-key="label" data-variable-decor style="letter-spacing:0.38em;color:{{COLOR:label|#1c1b18}};text-transform:uppercase;font-size:15px;font-weight:600;font-family:{{FONT:label|${SANS_EN}}}">{{TEXT:label}}</div>
    <div data-text-key="date" data-variable-decor style="margin-top:6px;letter-spacing:0.1em;color:{{COLOR:date|#1c1b18}};font-size:30px;font-weight:600;font-family:{{FONT:date|${SANS_EN}}}">{{TEXT:date}}</div>
  </div>
  <div data-text-key="folio" style="position:absolute;bottom:40px;right:50px;font-style:italic;font-size:22px;color:{{COLOR:folio|#1c1b18}};font-family:{{FONT:folio|${SERIF_EN}}}">{{TEXT:folio}}<span style="color:#a09b8e">/</span></div>
</div>`;
