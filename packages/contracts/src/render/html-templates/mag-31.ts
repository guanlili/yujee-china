// mag-31 HTML 模板（外观真相源，镜像自 templates/mag-31/index.tsx 的 WebMag31）。
// 内页 · 旅行相册六宫格（category: interior，6 图）：白底；2 行 ×3 列等大竖图（230×351），
// 行优先编号 image1..image6（上排左→右，下排左→右）；底部居中图注（body）。
// 几何逐一照抄：794×1123、绝对定位、写死 px（上排 y28、下排 y403；列 x27/x283/x538）。
// 动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：image1..image6（六宫格图）、body（React 走 resolveThemeCarrier(role: body)，
// 照 mag-01 惯例给 COLOR/FONT token，不加 data-variable-decor；默认色 #1c1b18、
// 默认栈取 CJK body 解析结果 sansCn —— JSON sample 为中文 user 文案，同 mag-01 先例）。
// 全部槽位均渲染，无省略。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';

export const MAG_31_HTML = `<div data-template="mag-31" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:27px;top:28px;width:230px;height:351px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:283px;top:28px;width:230px;height:351px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-image-slot="image3" style="position:absolute;left:538px;top:28px;width:230px;height:351px;overflow:hidden">
    <img data-image-slot="image3" src="{{IMG_SRC:image3}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image3|50% 50%}};{{IMG_TF:image3}}" />
  </div>
  <div data-image-slot="image4" style="position:absolute;left:27px;top:403px;width:230px;height:351px;overflow:hidden">
    <img data-image-slot="image4" src="{{IMG_SRC:image4}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image4|50% 50%}};{{IMG_TF:image4}}" />
  </div>
  <div data-image-slot="image5" style="position:absolute;left:283px;top:403px;width:230px;height:351px;overflow:hidden">
    <img data-image-slot="image5" src="{{IMG_SRC:image5}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image5|50% 50%}};{{IMG_TF:image5}}" />
  </div>
  <div data-image-slot="image6" style="position:absolute;left:538px;top:403px;width:230px;height:351px;overflow:hidden">
    <img data-image-slot="image6" src="{{IMG_SRC:image6}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image6|50% 50%}};{{IMG_TF:image6}}" />
  </div>
  <div data-text-key="body" style="position:absolute;left:167px;top:800px;width:460px;height:120px;font-family:{{FONT:body|${SANS_CN}}};font-size:18px;line-height:1.7;color:{{COLOR:body|#1c1b18}};text-align:center;white-space:pre-wrap;word-break:break-word;overflow:hidden;letter-spacing:0.02em">{{TEXT:body}}</div>
</div>`;
