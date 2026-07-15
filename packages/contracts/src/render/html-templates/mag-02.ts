// mag-02 HTML 模板（外观真相源）。794×1123、绝对定位、写死 px。
// 动态槽用 {{...}} token（见 fill-template.ts）。静态字体栈内联自 constants.WEB_FONTS。
//
// 槽位：
//   title       左上大标题（variableDecor：色/字体可主题）
//   items 2×2 目录格,每格三件（bracket 寻址,填充/lint 均按 mag-10 先例）:
//     label[i]    章节编号(decoration,variableDecor,斜切大字)
//     title2[i]   章节标题(title,variableDecor)
//     explain[i]  章节描述(explain)
//
// 四个格子手写四遍、不抽 ${helper} 插值 —— 模板台(dev/template-box)按【源码字面量】
// 扫元素并与浏览器 DOM 序号一一对应,函数插值会让源码里"看不见"这些元素,
// elementIndex 错位就会改错/删错元素。
//
// 【曾经的坑】此格子一度写死英文假内容("Beginnings"…)不 token 化 —— 每个用户的书
// 目录页都显示同一套假章节。当年的理由(lint 不认 bracket、adapt 折叠键)早已失效:
// lint 把 items 基名视为已声明,fill-template 会为模板引用的 bracket 槽补扁平键
// (mag-10 生产在用)。生成侧由 skeleton buildToc 写 label[i]/title2[i];没有数据的
// 格子渲染为空,不残留占位假字。
const SANS_EN = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const PLAYFAIR = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_02_HTML = `<div data-template="mag-02" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-text-key="title" data-variable-decor style="position:absolute;top:96px;left:56px;font-size:36px;font-weight:800;line-height:1;letter-spacing:0.04em;color:{{COLOR:title|#1c1b18}};font-family:{{FONT:title|${PLAYFAIR}}};white-space:pre-wrap">{{TEXT:title}}</div>
  <div style="position:absolute;top:338px;left:56px;right:56px;display:grid;grid-template-columns:1fr 1fr;row-gap:96px;column-gap:80px">
    <div>
      <div data-text-key="label[0]" data-variable-decor style="line-height:1;transform:skewX(-8deg);font-size:58px;margin-bottom:8px;color:{{COLOR:label[0]|#1c1b18}};font-family:{{FONT:label[0]|${SANS_EN}}};white-space:pre">{{TEXT:label[0]}}</div>
      <div data-text-key="title2[0]" data-variable-decor style="font-size:17px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:10px;color:{{COLOR:title2[0]|#1c1b18}};font-family:{{FONT:title2[0]|${PLAYFAIR}}};white-space:pre-wrap">{{TEXT:title2[0]}}</div>
      <div data-text-key="explain[0]" style="line-height:1.7;text-align:justify;letter-spacing:0.02em;font-size:16px;color:{{COLOR:explain[0]|#5a574f}};font-family:{{FONT:explain[0]|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain[0]}}</div>
    </div>
    <div>
      <div data-text-key="label[1]" data-variable-decor style="line-height:1;transform:skewX(-8deg);font-size:58px;margin-bottom:8px;color:{{COLOR:label[1]|#1c1b18}};font-family:{{FONT:label[1]|${SANS_EN}}};white-space:pre">{{TEXT:label[1]}}</div>
      <div data-text-key="title2[1]" data-variable-decor style="font-size:17px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:10px;color:{{COLOR:title2[1]|#1c1b18}};font-family:{{FONT:title2[1]|${PLAYFAIR}}};white-space:pre-wrap">{{TEXT:title2[1]}}</div>
      <div data-text-key="explain[1]" style="line-height:1.7;text-align:justify;letter-spacing:0.02em;font-size:16px;color:{{COLOR:explain[1]|#5a574f}};font-family:{{FONT:explain[1]|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain[1]}}</div>
    </div>
    <div>
      <div data-text-key="label[2]" data-variable-decor style="line-height:1;transform:skewX(-8deg);font-size:58px;margin-bottom:8px;color:{{COLOR:label[2]|#1c1b18}};font-family:{{FONT:label[2]|${SANS_EN}}};white-space:pre">{{TEXT:label[2]}}</div>
      <div data-text-key="title2[2]" data-variable-decor style="font-size:17px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:10px;color:{{COLOR:title2[2]|#1c1b18}};font-family:{{FONT:title2[2]|${PLAYFAIR}}};white-space:pre-wrap">{{TEXT:title2[2]}}</div>
      <div data-text-key="explain[2]" style="line-height:1.7;text-align:justify;letter-spacing:0.02em;font-size:16px;color:{{COLOR:explain[2]|#5a574f}};font-family:{{FONT:explain[2]|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain[2]}}</div>
    </div>
    <div>
      <div data-text-key="label[3]" data-variable-decor style="line-height:1;transform:skewX(-8deg);font-size:58px;margin-bottom:8px;color:{{COLOR:label[3]|#1c1b18}};font-family:{{FONT:label[3]|${SANS_EN}}};white-space:pre">{{TEXT:label[3]}}</div>
      <div data-text-key="title2[3]" data-variable-decor style="font-size:17px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:10px;color:{{COLOR:title2[3]|#1c1b18}};font-family:{{FONT:title2[3]|${PLAYFAIR}}};white-space:pre-wrap">{{TEXT:title2[3]}}</div>
      <div data-text-key="explain[3]" style="line-height:1.7;text-align:justify;letter-spacing:0.02em;font-size:16px;color:{{COLOR:explain[3]|#5a574f}};font-family:{{FONT:explain[3]|${SANS_EN}}};white-space:pre-wrap">{{TEXT:explain[3]}}</div>
    </div>
  </div>
</div>`;
