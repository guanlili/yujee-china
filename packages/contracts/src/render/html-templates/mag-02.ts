// mag-02 HTML 模板（外观真相源，收敛单渲染器试点）。
// 几何逐一镜像自 templates/mag-02/index.tsx（WebMag02）：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位：title（左上大标题，variableDecor：色/字体可主题）、folio（右下页码，decoration）。
//
// 与 React 版的已知差异（均为现行 token/lint 能力边界，非几何偏差）：
// ① items 重复组（number[i]/title[i]/description[i]）未 token 化：html-template-lint 的
//    declared 集只含顶层 texts（title/folio），bracket token 会报「未声明的槽」；且
//    adapt-layout 把 texts['number[0]'] 这类 bracket 键折叠成 data.number 数组，
//    fill-template 按 data['number[0]'] 取值必为空。因此 2×2 目录格照 React 无数据时的
//    SAMPLE_* 预览样例静态写死（字体/颜色与 React resolveThemeCarrier 对空数据的计算
//    结果一致：编号/斜杠 = latin decoration 默认 Inter 栈 + #1c1b18，行标题 = latin
//    title 默认 Playfair 栈，描述 = latin explain 默认 Inter 栈 + #5a574f），锚点与
//    token 一起省略；待 fill/lint 支持 items 组后再 token 化。
// ② WebFolio 的「/总页数」：totalPages 是渲染 prop，无 token 通道，此处保留静态斜杠
//    （等价 React totalPages=undefined 的输出）；folio 空值时 React 的 '02' 兜底也无
//    token 文案默认语法可表达。
// ③ 顶层标题在 data.title 为数组（有重复项数据）时 React 退回 'CONTENTS' 默认值，
//    token 无文案默认语法，届时填空字符串。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_02_HTML = `<div data-template="mag-02" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-text-key="title" data-variable-decor style="position:absolute;top:96px;left:56px;font-size:36px;font-weight:800;line-height:1;letter-spacing:0.04em;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}}">{{TEXT:title}}</div>
  <div style="position:absolute;top:338px;left:56px;right:56px;display:grid;grid-template-columns:1fr 1fr;row-gap:96px;column-gap:80px">
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
        <div style="display:flex;align-items:flex-end;gap:5px;line-height:1;transform:skewX(-8deg);font-family:${SANS_EN};color:#1c1b18"><span style="font-size:50px">0</span><span style="font-size:64px">1</span></div>
        <div style="font-size:17px;font-weight:400;line-height:1;font-family:${SANS_EN};color:#1c1b18">/</div>
      </div>
      <div style="font-size:17px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:#1c1b18;margin-bottom:10px;font-family:${PLAYFAIR}">Beginnings</div>
      <div style="line-height:1.7;color:#5a574f;font-family:${SANS_EN};text-align:justify;letter-spacing:0.02em;font-size:16px">The first quiet mornings, and where this whole story started to take shape.</div>
    </div>
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
        <div style="display:flex;align-items:flex-end;gap:5px;line-height:1;transform:skewX(-8deg);font-family:${SANS_EN};color:#1c1b18"><span style="font-size:50px">0</span><span style="font-size:64px">2</span></div>
        <div style="font-size:17px;font-weight:400;line-height:1;font-family:${SANS_EN};color:#1c1b18">/</div>
      </div>
      <div style="font-size:17px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:#1c1b18;margin-bottom:10px;font-family:${PLAYFAIR}">Everyday Light</div>
      <div style="line-height:1.7;color:#5a574f;font-family:${SANS_EN};text-align:justify;letter-spacing:0.02em;font-size:16px">Small ordinary moments — a kitchen, a window, the warmth of an afternoon.</div>
    </div>
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
        <div style="display:flex;align-items:flex-end;gap:5px;line-height:1;transform:skewX(-8deg);font-family:${SANS_EN};color:#1c1b18"><span style="font-size:50px">0</span><span style="font-size:64px">3</span></div>
        <div style="font-size:17px;font-weight:400;line-height:1;font-family:${SANS_EN};color:#1c1b18">/</div>
      </div>
      <div style="font-size:17px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:#1c1b18;margin-bottom:10px;font-family:${PLAYFAIR}">Together</div>
      <div style="line-height:1.7;color:#5a574f;font-family:${SANS_EN};text-align:justify;letter-spacing:0.02em;font-size:16px">The faces and hands we held close through every season of this year.</div>
    </div>
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
        <div style="display:flex;align-items:flex-end;gap:5px;line-height:1;transform:skewX(-8deg);font-family:${SANS_EN};color:#1c1b18"><span style="font-size:50px">0</span><span style="font-size:64px">4</span></div>
        <div style="font-size:17px;font-weight:400;line-height:1;font-family:${SANS_EN};color:#1c1b18">/</div>
      </div>
      <div style="font-size:17px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:#1c1b18;margin-bottom:10px;font-family:${PLAYFAIR}">Looking Back</div>
      <div style="line-height:1.7;color:#5a574f;font-family:${SANS_EN};text-align:justify;letter-spacing:0.02em;font-size:16px">A gentle pause to gather what mattered most before turning the page.</div>
    </div>
  </div>
  <div data-text-key="folio" style="position:absolute;bottom:40px;right:50px;font-family:{{FONT:folio|${SERIF_EN}}};font-style:italic;font-size:22px;color:{{COLOR:folio|#1c1b18}}">{{TEXT:folio}}<span style="color:#a09b8e">/</span></div>
</div>`;
