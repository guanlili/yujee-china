# HTML 页面模板(页面真相 = HTML)

每个模板是一份 794×1123 的 HTML/CSS 字符串常量(`mag-XX.ts` 导出 `MAG_XX_HTML`),
注册进 `registry.ts`;`templates:check` 强制全量覆盖 + 锚点完整性(见
`scripts/check-html-templates.ts`,单模板自验用 `scripts/lint-one-html-template.ts <id>`)。

## 锚点与 token 契约

- 根节点:`<div data-template="<id>" ...>`(单根,794×1123)
- 文字槽:元素带 `data-text-key="<slotId>"`,内容 `{{TEXT:slotId}}`;variableDecor 槽加
  `data-variable-decor` 属性,颜色 `{{COLOR:slotId|默认}}`、字体 `{{FONT:slotId|默认栈}}`
- 图槽:容器与 `<img>` 都带 `data-image-slot="<slotId>"`,`src="{{IMG_SRC:slotId}}"`,
  `object-position:{{IMG_POS:slotId|50% 50%}}`,style 末尾拼 `{{IMG_TF:slotId}}`
- items 重复组:按容量固定展开,bracket 路径 token(`{{TEXT:explain[2]}}`),先例 mag-10
- 模板 JSON 声明的槽在 HTML 里必须锚点/token 成对出现(或成对省略——React 版没渲染的槽)

这些锚点同时是**用户操作面**(编辑器改字/换图)与 **AI 编辑红线**(design-agent 的
write_page_html 校验锚点不可删)的契约,改动需同步 `design-agent html-guard` 与
`apps/web page-html-dom`。

## 已知 token 体系边界(调模板视觉时留意)

- `{{TEXT:}}` 无默认文案通道:React 版的 `|| '兜底文案'` 表达不了,空值渲染为空
- WebFolio 的 `/{totalPages}`:无页数 token,按先例渲染静态灰 `/`
- 逐字拆分样式(如首字母放大)、链式颜色回退表达不了,已按最近似值镜像
- svg 槽(仅 mag-13 divider)无 token 通道,静态回退色
