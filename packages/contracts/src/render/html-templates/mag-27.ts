// mag-27 HTML 模板（外观真相源，镜像自 templates/mag-27/index.tsx 的 WebMag27）。
// 内页 · 杂志风（category: interior，1 图）：白底；左上宽体大标题（两行），右上小标题 + 正文导语，
// 中部一张横图 685×476，下方日期 / 图注 / 右侧标签 / 底部页脚小字；
// 左上角固定汉堡图标（两根横条 #656565）是 furniture，不进契约。
// 几何逐一照抄：794×1123、绝对定位、写死 px。动态槽用 {{...}} token（见 fill-template.ts）。
//
// 槽位：title/date/label1/label2（variableDecor：色/字体可主题）、explain1/body/explain2
//（React 走 resolveThemeCarrier，照 mag-01 惯例给 COLOR/FONT token，不加 data-variable-decor）。
// 全部槽位均渲染，无省略。React 根节点是裸 div（无 color/box-sizing/font-family），照抄。
// FONT 默认栈按槽位 lang + role 的 DEFAULT_ALBUM_FONT 解析：title(user/title)→serifCn，
// explain1/body/explain2(user)→sansCn，date/label1/label2(en/decoration)→sansEn。
const SERIF_CN = '&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;, &quot;Songti SC&quot;, serif';
const SANS_CN = '&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif';
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';

export const MAG_27_HTML = `<div data-template="mag-27" style="position:relative;width:794px;height:1123px;background:#FFFFFF;overflow:hidden">
  <div style="position:absolute;left:63px;top:59px;width:23px;height:3px;background:#656565"></div>
  <div style="position:absolute;left:63px;top:65px;width:23px;height:3px;background:#656565"></div>
  <div data-text-key="title" data-variable-decor style="position:absolute;left:63px;top:116px;width:335px;height:192px;font-weight:800;font-size:75px;line-height:1.1;letter-spacing:0.04em;white-space:pre-wrap;overflow:hidden;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${SERIF_CN}}}">{{TEXT:title}}</div>
  <div data-text-key="explain1" style="position:absolute;left:430px;top:108px;width:144px;height:65px;font-weight:500;font-size:21px;line-height:1.3;white-space:pre-wrap;overflow:hidden;color:{{COLOR:explain1|#1c1b18}};font-family:{{FONT:explain1|${SANS_CN}}}">{{TEXT:explain1}}</div>
  <div data-text-key="body" style="position:absolute;left:430px;top:212px;width:310px;height:72px;font-weight:400;font-size:19px;line-height:1.4;white-space:pre-wrap;overflow:hidden;color:{{COLOR:body|#1c1b18}};font-family:{{FONT:body|${SANS_CN}}}">{{TEXT:body}}</div>
  <div data-image-slot="image" style="position:absolute;left:55px;top:353px;width:685px;height:476px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="date" data-variable-decor style="position:absolute;left:55px;top:840px;font-weight:400;font-size:19px;line-height:1;color:{{COLOR:date|#1c1b18}};font-family:{{FONT:date|${SANS_EN}}}">{{TEXT:date}}</div>
  <div data-text-key="explain2" style="position:absolute;left:55px;top:878px;width:232px;font-weight:400;font-size:19px;line-height:1.3;overflow:hidden;color:{{COLOR:explain2|#1c1b18}};font-family:{{FONT:explain2|${SANS_CN}}}">{{TEXT:explain2}}</div>
  <div data-text-key="label1" data-variable-decor style="position:absolute;left:698px;top:834px;font-weight:400;font-size:19px;line-height:1;color:{{COLOR:label1|#1c1b18}};font-family:{{FONT:label1|${SANS_EN}}}">{{TEXT:label1}}</div>
  <div data-text-key="label2" data-variable-decor style="position:absolute;left:316px;top:996px;font-weight:400;font-size:16px;line-height:1;color:{{COLOR:label2|#1c1b18}};font-family:{{FONT:label2|${SANS_EN}}}">{{TEXT:label2}}</div>
</div>`;
