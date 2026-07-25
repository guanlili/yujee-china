// mag-59 HTML 模板（外观真相源，镜像自 templates/mag-59/index.tsx 的 WebMag59）。
// #303 第六个真跨页模板（category: interior，本批最复杂：4 图 + 8 字 + 3 张白卡
// furniture）。来源 Figma A4-28（fileKey 5uKJQlCURRrrCBU1pd1QT6 / node 36:85，
// 1190×842 ×1.3344）。版面：一张近满幅大图打底（image1，36:86，横跨整个跨页），
// 左页大标题「PASSION」（title）+ 一段说明（body）；右页三张白色人物卡
// （36:97/99/101），每张卡 = 一张照片 + 名字（粗体）+ 居中的角色描述。
// 画布 1588×1123（双宽，PAGE.width*2）：中缝落在 x=794。几何逐一照抄 React 版：
// 绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 三张人物卡的槽位对应（文字槽 id 按 role 派号，不按语义命名 —— 见
// templates/README.md「新增一个模板要动的地方」）：
//
//   卡片      照片      名字（粗体）   角色描述（居中）
//   card1     image2    explain        explain2
//   card2     image3    explain3       explain4
//   card3     image4    explain5       explain6
//
// 只有 image1 横跨中缝（满幅底图，设计意图）；三张卡全部在右页（card1
// left=883 > 794），title/body 在左页 —— 都不需要担心中缝重叠。z 序：
// image1（底图）→ 三张白卡 furniture（纯 div，白底 + 圆角 + 柔和阴影，无
// data-* 锚点，不是槽）→ 三张照片（叠在卡上）→ 每卡的名字/角色文字 → 左页
// title/body。
//
// 槽位：image1（满幅底图 hero，1588×1005 cover）、image2/3/4（三张卡照片，
// 187×132 cover）、title（role: title，variableDecor，ExtraBold，左对齐）、
// body（role: body，非 variableDecor，左对齐）、explain/explain3/explain5
// （role: explain，非 variableDecor，Bold，居中 —— 三张卡的名字）、
// explain2/explain4/explain6（role: explain，非 variableDecor，Regular，居中
// —— 三张卡的角色描述）。契约只允许 variableDecor 挂 title/decoration，
// body/explain 不能开（见 templates.test.ts）——但这些槽仍照 mag-58 的做法
// 自愿带 {{COLOR:}}/{{FONT:}} token 走主题刷，兜底赤陶色 #b23a2e。全部槽位均
// 渲染，无省略。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
const NOTO_SERIF_SC = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_59_HTML = `<div data-template="mag-59" style="position:relative;width:1588px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div data-image-slot="image1" style="position:absolute;left:0px;top:59px;width:1588px;height:1005px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image1|50% 50%}};{{IMG_TF:image1}}" />
  </div>
  <div style="position:absolute;left:883px;top:515px;width:211px;height:295px;background:#fff;border-radius:2px;box-shadow:0 2px 12px rgba(0,0,0,.08)"></div>
  <div style="position:absolute;left:1103px;top:515px;width:212px;height:295px;background:#fff;border-radius:2px;box-shadow:0 2px 12px rgba(0,0,0,.08)"></div>
  <div style="position:absolute;left:1325px;top:515px;width:211px;height:295px;background:#fff;border-radius:2px;box-shadow:0 2px 12px rgba(0,0,0,.08)"></div>
  <div data-image-slot="image2" style="position:absolute;left:895px;top:527px;width:187px;height:132px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image2|50% 50%}};{{IMG_TF:image2}}" />
  </div>
  <div data-image-slot="image3" style="position:absolute;left:1117px;top:527px;width:187px;height:132px;overflow:hidden">
    <img data-image-slot="image3" src="{{IMG_SRC:image3}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image3|50% 50%}};{{IMG_TF:image3}}" />
  </div>
  <div data-image-slot="image4" style="position:absolute;left:1337px;top:527px;width:187px;height:132px;overflow:hidden">
    <img data-image-slot="image4" src="{{IMG_SRC:image4}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image4|50% 50%}};{{IMG_TF:image4}}" />
  </div>
  <div data-text-key="explain" style="position:absolute;left:895px;top:671px;width:187px;height:24px;overflow:hidden;font-family:{{FONT:explain|${NOTO_SERIF_SC}}};font-size:19px;font-weight:700;line-height:1.2;color:{{COLOR:explain|#b23a2e}};text-align:center">{{TEXT:explain}}</div>
  <div data-text-key="explain2" style="position:absolute;left:895px;top:709px;width:187px;height:44px;overflow:hidden;font-family:{{FONT:explain2|${NOTO_SERIF_SC}}};font-size:16px;font-weight:400;line-height:1.3;color:{{COLOR:explain2|#b23a2e}};text-align:center">{{TEXT:explain2}}</div>
  <div data-text-key="explain3" style="position:absolute;left:1117px;top:671px;width:187px;height:24px;overflow:hidden;font-family:{{FONT:explain3|${NOTO_SERIF_SC}}};font-size:19px;font-weight:700;line-height:1.2;color:{{COLOR:explain3|#b23a2e}};text-align:center">{{TEXT:explain3}}</div>
  <div data-text-key="explain4" style="position:absolute;left:1117px;top:712px;width:187px;height:44px;overflow:hidden;font-family:{{FONT:explain4|${NOTO_SERIF_SC}}};font-size:16px;font-weight:400;line-height:1.3;color:{{COLOR:explain4|#b23a2e}};text-align:center">{{TEXT:explain4}}</div>
  <div data-text-key="explain5" style="position:absolute;left:1337px;top:671px;width:187px;height:24px;overflow:hidden;font-family:{{FONT:explain5|${NOTO_SERIF_SC}}};font-size:19px;font-weight:700;line-height:1.2;color:{{COLOR:explain5|#b23a2e}};text-align:center">{{TEXT:explain5}}</div>
  <div data-text-key="explain6" style="position:absolute;left:1337px;top:709px;width:187px;height:60px;overflow:hidden;font-family:{{FONT:explain6|${NOTO_SERIF_SC}}};font-size:16px;font-weight:400;line-height:1.3;color:{{COLOR:explain6|#b23a2e}};text-align:center">{{TEXT:explain6}}</div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:129px;top:272px;width:494px;height:111px;overflow:hidden;font-family:{{FONT:title|${NOTO_SERIF_SC}}};font-size:85px;font-weight:800;line-height:1.1;color:{{COLOR:title|#b23a2e}}">{{TEXT:title}}</div>
  <div data-text-key="body" style="position:absolute;left:414px;top:562px;width:303px;height:103px;overflow:hidden;font-family:{{FONT:body|${NOTO_SERIF_SC}}};font-size:19px;font-weight:500;line-height:1.4;color:{{COLOR:body|#b23a2e}}">{{TEXT:body}}</div>
</div>`;
