// mag-62 HTML 模板(椭圆挖空封面)。几何按参照书封等比换算到 794×1123:
// 胶囊照片框 212×402(圆角 106 = 宽的一半,两端全圆)、left 291 水平居中、top 366。
// 底色与文字色由 design-apply 的第三套配色在页根 style 上覆盖(background-color/color),
// 模板自带的是深墨绿默认配色。
const SANS_EN = '&quot;Work Sans&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_62_HTML = `<div data-template="mag-62" style="position:relative;width:794px;height:1123px;background:#12363A;color:#E7E3D8;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-text-key="title" style="position:absolute;left:70px;top:118px;width:654px;text-align:center;font-family:{{FONT:title|${SERIF_EN}}};font-size:52px;line-height:1.2;letter-spacing:3px;color:{{COLOR:title|#F0A4C2}}">{{TEXT:title}}</div>
  <div data-text-key="explain" style="position:absolute;left:70px;top:196px;width:654px;text-align:center;font-family:{{FONT:explain|${SERIF_EN}}};font-size:22px;line-height:1.4;letter-spacing:0.6px;color:{{COLOR:explain|#E7E3D8}}">{{TEXT:explain}}</div>
  <div data-image-slot="image" style="position:absolute;left:291px;top:366px;width:212px;height:402px;border-radius:106px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="label" style="position:absolute;left:664px;top:400px;width:334px;transform:rotate(90deg);transform-origin:0 0;font-family:{{FONT:label|${SANS_EN}}};font-size:15px;letter-spacing:2.4px;color:{{COLOR:label|#E7E3D8}}">{{TEXT:label}}</div>
  <div data-text-key="label2" style="position:absolute;left:70px;bottom:78px;font-family:{{FONT:label2|${SERIF_EN}}};font-size:24px;letter-spacing:1px;color:{{COLOR:label2|#E7E3D8}}">{{TEXT:label2}}</div>
  <div data-text-key="label3" style="position:absolute;right:70px;bottom:74px;text-align:right;font-family:{{FONT:label3|${SANS_EN}}};font-size:15px;line-height:1.7;letter-spacing:1px;color:{{COLOR:label3|#E7E3D8}}">{{TEXT:label3}}</div>
</div>`;
