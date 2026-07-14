// mag-10 HTML 模板（外观真相源，收敛单渲染器）。
// 几何逐一镜像自 templates/mag-10/index.tsx（WebMag10）：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位：items 重复组 image[i]/explain[i]（2×2 图文格），固定展开 4 格（i=0..3）——
// React 版 count = max(数据长度, 4)，与 templates.ts 的 ITEMS_GRID_CAPACITY=4 一致；
// 旧 cells 兼容路径（legacy 对象数组）不进 HTML 模板。folio（右下页码，role=decoration）。
// explain[i] 非 variableDecor，但 React 版逐格走 resolveThemeCarrier(data,`explain[i]`,'explain')
// 取 accentColor/webFontFamily（accentColor ?? COLORS.ink），故照 mag-06 惯例给
// COLOR/FONT token、不加 data-variable-decor。folio 同理（WebFolio 默认
// COLORS.ink + WEB_FONTS.serifEn）。
// 每格序号 1..4 是 React 版 {i + 1} 的静态装饰（serifEn 22px），原样保留。
// 与 React 版的两处已知差异（token 体系无法表达）：
// 1) WebFolio 的 `/{totalPages}` 后缀：fill-template 无 totalPages token，斜杠保留为
//    静态装饰，页码数留空（等价于 React 版 totalPages 未传时的输出）。
// 2) WebFolio 的 fallback="10"（folio 文案为空时兜底）：TEXT token 无默认值语法，空则空。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;EB Garamond&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_10_HTML = `<div data-template="mag-10" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div style="position:absolute;top:130px;left:60px;right:60px;display:grid;grid-template-columns:1fr 1fr;column-gap:50px;row-gap:50px">
    <div>
      <div style="font-family:${SERIF_EN};font-size:22px;letter-spacing:0.04em;color:#1c1b18;margin-bottom:12px">1</div>
      <div data-image-slot="image[0]" style="display:block;width:100%;height:280px;overflow:hidden">
        <img data-image-slot="image[0]" src="{{IMG_SRC:image[0]}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image[0]|50% 50%}};{{IMG_TF:image[0]}}" />
      </div>
      <p data-text-key="explain[0]" style="margin:12px 0 0;line-height:1.7;letter-spacing:0.05em;text-align:justify;font-size:13px;color:{{COLOR:explain[0]|#1c1b18}};font-family:{{FONT:explain[0]|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain[0]}}</p>
    </div>
    <div>
      <div style="font-family:${SERIF_EN};font-size:22px;letter-spacing:0.04em;color:#1c1b18;margin-bottom:12px">2</div>
      <div data-image-slot="image[1]" style="display:block;width:100%;height:280px;overflow:hidden">
        <img data-image-slot="image[1]" src="{{IMG_SRC:image[1]}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image[1]|50% 50%}};{{IMG_TF:image[1]}}" />
      </div>
      <p data-text-key="explain[1]" style="margin:12px 0 0;line-height:1.7;letter-spacing:0.05em;text-align:justify;font-size:13px;color:{{COLOR:explain[1]|#1c1b18}};font-family:{{FONT:explain[1]|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain[1]}}</p>
    </div>
    <div>
      <div style="font-family:${SERIF_EN};font-size:22px;letter-spacing:0.04em;color:#1c1b18;margin-bottom:12px">3</div>
      <div data-image-slot="image[2]" style="display:block;width:100%;height:280px;overflow:hidden">
        <img data-image-slot="image[2]" src="{{IMG_SRC:image[2]}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image[2]|50% 50%}};{{IMG_TF:image[2]}}" />
      </div>
      <p data-text-key="explain[2]" style="margin:12px 0 0;line-height:1.7;letter-spacing:0.05em;text-align:justify;font-size:13px;color:{{COLOR:explain[2]|#1c1b18}};font-family:{{FONT:explain[2]|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain[2]}}</p>
    </div>
    <div>
      <div style="font-family:${SERIF_EN};font-size:22px;letter-spacing:0.04em;color:#1c1b18;margin-bottom:12px">4</div>
      <div data-image-slot="image[3]" style="display:block;width:100%;height:280px;overflow:hidden">
        <img data-image-slot="image[3]" src="{{IMG_SRC:image[3]}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image[3]|50% 50%}};{{IMG_TF:image[3]}}" />
      </div>
      <p data-text-key="explain[3]" style="margin:12px 0 0;line-height:1.7;letter-spacing:0.05em;text-align:justify;font-size:13px;color:{{COLOR:explain[3]|#1c1b18}};font-family:{{FONT:explain[3]|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain[3]}}</p>
    </div>
  </div>
</div>`;
