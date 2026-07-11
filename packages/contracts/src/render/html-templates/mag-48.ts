// mag-48 HTML 模板（外观真相源，收敛单渲染器试点）。
// 几何逐一镜像自 templates/mag-48/index.tsx（WebMag48）：794×1123、绝对定位、写死 px。
// 内页 · 满铺九宫格相册：白底，3 行 ×3 列竖图满铺整页，行优先编号 image1..image9。
// 列边界 0/264/530（宽 264/266/264）、行边界 0/379/751（高 379/372/372）满铺无缝。
// 槽位：image1..image9（9 个图槽）；无文字槽（JSON texts 为空，与 index.tsx 一致）。
// React 版根节点是裸 div（非 WebPage），无 font-family/color/box-sizing，此处照抄不加。

export const MAG_48_HTML = `<div data-template="mag-48" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:0;top:0;width:264px;height:379px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div data-image-slot="image2" style="position:absolute;left:264px;top:0;width:266px;height:379px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-image-slot="image3" style="position:absolute;left:530px;top:0;width:264px;height:379px;overflow:hidden">
    <img data-image-slot="image3" src="{{IMG_SRC:image3}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image3|50% 50%}};{{IMG_TF:image3}}" />
  </div>
  <div data-image-slot="image4" style="position:absolute;left:0;top:379px;width:264px;height:372px;overflow:hidden">
    <img data-image-slot="image4" src="{{IMG_SRC:image4}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image4|50% 50%}};{{IMG_TF:image4}}" />
  </div>
  <div data-image-slot="image5" style="position:absolute;left:264px;top:379px;width:266px;height:372px;overflow:hidden">
    <img data-image-slot="image5" src="{{IMG_SRC:image5}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image5|50% 50%}};{{IMG_TF:image5}}" />
  </div>
  <div data-image-slot="image6" style="position:absolute;left:530px;top:379px;width:264px;height:372px;overflow:hidden">
    <img data-image-slot="image6" src="{{IMG_SRC:image6}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image6|50% 50%}};{{IMG_TF:image6}}" />
  </div>
  <div data-image-slot="image7" style="position:absolute;left:0;top:751px;width:264px;height:372px;overflow:hidden">
    <img data-image-slot="image7" src="{{IMG_SRC:image7}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image7|50% 50%}};{{IMG_TF:image7}}" />
  </div>
  <div data-image-slot="image8" style="position:absolute;left:264px;top:751px;width:266px;height:372px;overflow:hidden">
    <img data-image-slot="image8" src="{{IMG_SRC:image8}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image8|50% 50%}};{{IMG_TF:image8}}" />
  </div>
  <div data-image-slot="image9" style="position:absolute;left:530px;top:751px;width:264px;height:372px;overflow:hidden">
    <img data-image-slot="image9" src="{{IMG_SRC:image9}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image9|50% 50%}};{{IMG_TF:image9}}" />
  </div>
</div>`;
