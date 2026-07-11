// mag-23 HTML 模板(外观真相源,镜像自 templates/mag-23/index.tsx 的 WebMag23)。
// 封面(category: cover,1 图):白底;大号宽体主标题 + 副标题叠于左上;居中大封面图;
// 右上「Year / City」两列固定标签 + 年份/城市列表;右上「M」角标与左上/中部渐深小方块
// 均为固定 furniture,原样内联。794×1123,绝对定位,px 写死。
//
// 槽位:title/subtitle(variableDecor,色/字体可主题,role: title → 默认 Playfair)、
// year/city(role: decoration,走 resolveThemeCarrier → 给 COLOR/FONT token 但不带
// data-variable-decor,默认 Inter 栈)、image(封面大图 685×728)。
// JSON 声明的槽全部渲染,无省略。year/city/title/subtitle 在 React 用 whiteSpace:pre-wrap,
// HTML 同样内联 white-space:pre-wrap。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_23_HTML = `<div data-template="mag-23" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div style="position:absolute;left:67px;top:67px;width:13px;height:13px;background:rgba(0,0,0,0.15)"></div>
  <div style="position:absolute;left:81px;top:67px;width:13px;height:13px;background:rgba(0,0,0,0.35)"></div>
  <div style="position:absolute;left:95px;top:67px;width:13px;height:13px;background:rgba(0,0,0,0.65)"></div>
  <div style="position:absolute;left:108px;top:67px;width:13px;height:13px;background:rgba(0,0,0,0.9)"></div>
  <div style="position:absolute;left:723px;top:60px;font-family:${SANS_CN};font-weight:700;font-size:16px;line-height:1;color:#1c1b18">M</div>
  <div style="position:absolute;left:427px;top:125px;font-family:${SANS_CN};font-weight:400;font-size:12px;line-height:1;color:#1c1b18">Year</div>
  <div style="position:absolute;left:536px;top:125px;font-family:${SANS_CN};font-weight:400;font-size:12px;line-height:1;color:#1c1b18">City</div>
  <div data-text-key="year" style="position:absolute;left:467px;top:123px;width:60px;font-family:{{FONT:year|${SANS_EN}}};font-weight:300;font-size:12px;line-height:1.6;color:{{COLOR:year|#1c1b18}};white-space:pre-wrap;overflow:hidden">{{TEXT:year}}</div>
  <div data-text-key="city" style="position:absolute;left:576px;top:123px;width:130px;font-family:{{FONT:city|${SANS_EN}}};font-weight:300;font-size:12px;line-height:1.6;color:{{COLOR:city|#1c1b18}};white-space:pre-wrap;overflow:hidden">{{TEXT:city}}</div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:57px;top:201px;width:400px;height:80px;font-family:{{FONT:title|${PLAYFAIR}}};font-weight:800;font-size:75px;line-height:1;letter-spacing:0.06em;color:{{COLOR:title|#1c1b18}};white-space:pre-wrap;overflow:hidden">{{TEXT:title}}</div>
  <div data-text-key="subtitle" data-variable-decor style="position:absolute;left:67px;top:287px;width:300px;height:56px;font-family:{{FONT:subtitle|${PLAYFAIR}}};font-weight:800;font-size:53px;line-height:1;letter-spacing:0.06em;color:{{COLOR:subtitle|#1c1b18}};white-space:pre-wrap;overflow:hidden">{{TEXT:subtitle}}</div>
  <div style="position:absolute;left:354px;top:327px;width:13px;height:13px;background:rgba(0,0,0,0.8)"></div>
  <div data-image-slot="image" style="position:absolute;left:55px;top:353px;width:685px;height:728px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
</div>`;
