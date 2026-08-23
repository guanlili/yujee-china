// mag-09 HTML 模板（外观真相源，收敛单渲染器）。
// 几何逐一镜像自 templates/mag-09/index.tsx（WebMag09）：794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈直接内联自 constants.WEB_FONTS。
//
// 槽位：image1（左上方图 300×300）、body（右上短句）、title（大标题 h1，variableDecor：色/字体可主题）、
// image2（右侧大图 370×600）、explain1/explain2/explain3（左下三段说明）、folio（右下页码）。
// 全部槽位均渲染，无省略。
//
// 与 React 版的已知差异（token 词汇表限制，均已尽量贴近）：
// - title 在 React 版经 brToReact 把 \n 转成 <br/>；HTML 版用 white-space:pre-line 达成同样的换行效果。
// - folio 在 React 版是 WebFolio：文案空时回退 "09"、后缀 "/{totalPages}"。token 无 totalPages/回退文案，
//   此处保留静态 "/"（与 totalPages 为空时的 React 输出一致），folio 文案为空时渲染为空。
// - 2026-08-22 修：body/explain/explain2 原本嵌在各自的绝对定位外层 div 里，而它们写的是
//   整页坐标，浏览器把两层叠加——body 落到 x=1008、explain 落到 y=1240、explain2 落到 y=1284，
//   在 794×1123 的页面上等于三段字直接不存在（屏幕/PDF/Live 全中）。现已拍平成模板根的直接
//   子元素，坐标即整页坐标。body2 原来靠外层的正常流定位（落在 620+12=632，正好压在
//   explain/explain2 头上），现按设计顺序显式落到 explain2 之下（664+32+12=708）。外层 div 上的
//   text-align:justify 是三个 <p> 唯一继承到的样式，已逐个补回。守卫见 html-template-lint.ts。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_09_HTML = `<div data-template="mag-09" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-image-slot="image1" style="position:absolute;left:50px;top:90px;width:300px;height:300px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <p data-text-key="body" style="position:absolute;left:504px;top:130px;width:230px;height:31px;margin:0;line-height:1.7;color:{{COLOR:body|#5a574f}};font-family:{{FONT:body|${SANS_EN}}};letter-spacing:0.02em;text-align:justify;font-size:18px;white-space:pre-wrap">{{TEXT:body}}</p>
  <h1 data-text-key="title" data-variable-decor style="position:absolute;top:415px;left:60px;width:280px;height:180px;margin:0;overflow:hidden;font-family:{{FONT:title|${PLAYFAIR}}};font-weight:400;font-size:116px;letter-spacing:0.02em;line-height:1.1;color:{{COLOR:title|#1c1b18}};white-space:pre-line">{{TEXT:title}}</h1>
  <div data-image-slot="image2" style="position:absolute;left:374px;top:400px;width:370px;height:600px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <p data-text-key="explain" style="position:absolute;left:60px;top:620px;width:280px;height:32px;margin:0;font-size:14px;color:{{COLOR:explain|#5a574f}};font-family:{{FONT:explain|${SANS_EN}}};white-space:pre-wrap;letter-spacing:0.02em;line-height:1.6;text-align:justify">{{TEXT:explain}}</p>
  <p data-text-key="explain2" style="position:absolute;left:60px;top:664px;width:280px;height:32px;margin:0;font-size:14px;color:{{COLOR:explain2|#5a574f}};font-family:{{FONT:explain2|${SANS_EN}}};white-space:pre-wrap;letter-spacing:0.02em;line-height:1.6;text-align:justify">{{TEXT:explain2}}</p>
  <p data-text-key="body2" style="position:absolute;left:60px;top:708px;width:280px;height:200px;margin:0;font-size:18px;line-height:1.7;color:{{COLOR:body2|#5a574f}};font-family:{{FONT:body2|${SANS_EN}}};white-space:pre-wrap;letter-spacing:0.02em;text-align:justify">{{TEXT:body2}}</p>
</div>`;
