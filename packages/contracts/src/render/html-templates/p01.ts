// p01 HTML 模板（封面）。几何逐一镜像自 templates/p01/index.tsx（WebP01）：
// 794×1123 暗底（WebPage dark，背景 COLORS.ink、文字 COLORS.paper、根字体 serifCn）、
// 上部大图（top:0 / bottom:320 / 宽 794）、顶部 mono 刊头行、右上 100px 斜体大刊号、
// 底部 320px 墨色文字面板。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image（封面大图）、title（H1 大标题，variableDecor，brToReact → white-space:pre-line）、
// body（正文段落，非 variableDecor 但 React 走 resolveThemeCarrier → 有 COLOR/FONT token、无
// data-variable-decor 属性）、label1（面板小标签，variableDecor）、label2（刊号，variableDecor）、
// date（日期，variableDecor）。无省略槽位。
//
// 忠实性说明：
// - label2 在 React 渲染两处（刊头行小字 + 右上 100px 大字）。照 mag-32 先例：主锚点
//   （data-text-key + data-variable-decor）只放在大刊号上，刊头行 span 仅用 token 复读。
// - React 的文案兜底（'01' / '2026' / 'nº 01 · Portrait' / 'Page Title'）无 token 通道，
//   HTML 版空值即空输出（既有模板同约定）。
// - label1 的 `?? d.label1Color` 中间兜底是旧字段（非 '#accentColor' 主题载体），无 token
//   通道，HTML 版直接落到 COLORS.vermilionSoft 默认色。
const SERIF_CN = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';
const MONO = '&quot;JetBrains Mono&quot;, &quot;Noto Sans SC&quot;, &quot;Menlo&quot;, monospace';

export const P01_HTML = `<div data-template="p01" style="position:relative;width:794px;height:1123px;background:#1c1b18;color:#f6f1e7;overflow:hidden;box-sizing:border-box;font-family:${SERIF_CN}">
  <div data-image-slot="image" style="position:absolute;top:0;bottom:320px;left:0;width:794px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div style="position:absolute;top:36px;left:56px;right:56px;display:flex;justify-content:space-between;align-items:baseline;font-family:${MONO};letter-spacing:0.3em;color:#ffffff;font-size:14px">
  </div>
  <div data-text-key="label2" data-variable-decor style="position:absolute;top:70px;right:56px;font-style:italic;font-size:100px;line-height:0.9;color:{{COLOR:label2|#ffffff}};font-family:{{FONT:label2|${SERIF_CN}}};white-space:pre-wrap">{{TEXT:label2}}</div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:320px;background:#1c1b18;padding:40px 56px 0">
    <div data-text-key="label" data-variable-decor style="font-style:italic;letter-spacing:0.04em;font-size:16px;color:{{COLOR:label|#d27b62}};font-family:{{FONT:label|${SERIF_CN}}};white-space:pre-wrap;width:300px;height:24px">{{TEXT:label}}</div>
    <h1 data-text-key="title" data-variable-decor style="margin:8px 0 0;font-weight:500;letter-spacing:0.02em;line-height:1.1;font-size:56px;white-space:pre-line;color:{{COLOR:title|#f6f1e7}};font-family:{{FONT:title|${SERIF_CN}}};width:400px;height:130px">{{TEXT:title}}</h1>
    <div style="margin-top:22px">
      <p data-text-key="body" style="margin:0;line-height:1.7;text-align:justify;font-size:18px;color:{{COLOR:body|rgba(246,241,231,0.78)}};font-family:{{FONT:body|${SERIF_CN}}};white-space:pre-wrap;width:700px;height:66px;letter-spacing:0.02em">{{TEXT:body}}</p>
    </div>
  </div>

  <div data-text-key="label3" style="position:absolute;left:60px;top:60px;width:200px;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:{{COLOR:label3|#a09b8e}};font-family:{{FONT:label3|&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif}};white-space:pre-wrap;height:30px">{{TEXT:label3}}</div>
</div>`;
