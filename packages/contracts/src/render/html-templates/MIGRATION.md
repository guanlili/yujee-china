你在 git worktree `/Users/smalldog/Desktop/yujee工程文件/memoir-agent-rebuild/.claude/worktrees/html-pages-c` 中工作(勿离开该目录)。

任务:把 React 页面模板 <templateId> 忠实镜像成 HTML 字符串模板。

**只允许创建一个文件**:`packages/contracts/src/render/html-templates/<templateId>.ts`,导出 `export const <TEMPLATE_ID>_HTML = \`...\`;`。禁止修改 registry.ts 或任何其他文件,禁止 git commit。

必读材料:
1. 权威范例(格式/约定的唯一标准):`packages/contracts/src/render/html-templates/mag-01.ts`
2. 镜像来源:`apps/web/src/components/album/templates/<templateId>/index.tsx` 的 Web 组件(忽略 Pdf 组件);组件用到的共享工具(如 `web-utils.tsx` 的图片框)也要读,理解真实产出的 markup
3. 槽位声明:`packages/contracts/templates/<templateId>.json`
4. token 语法说明:`packages/contracts/src/render/fill-template.ts` 顶部注释
5. 字体栈来源:`packages/contracts/src/render/constants.ts` 的 WEB_FONTS(照 mag-01 的方式在文件内定义 HTML 转义过的常量内联)

硬性约定:
- 根节点 `<div data-template="<templateId>" ...>`,几何逐一照抄 React 版(绝对定位、px 写死);React 版根节点没有的样式(如 WebPage 的 font-family)不要自己加
- 每个渲染的文字槽:元素带 `data-text-key="id"`,内容 `{{TEXT:id}}`;JSON 里 `variableDecor: true` 的槽额外加 `data-variable-decor` 属性,颜色用 `{{COLOR:id|<React版默认色>}}`、字体用 `{{FONT:id|<React版默认栈>}}`;非 variableDecor 但 React 走了 resolveThemeCarrier 的槽,同样给 COLOR/FONT token(不加 data-variable-decor 属性)
- 每个图槽:容器和 `<img>` 都带 `data-image-slot="id"`,`src="{{IMG_SRC:id}}"`,`object-position:{{IMG_POS:id|50% 50%}}`,style 末尾拼 `{{IMG_TF:id}}`(照 mag-01)
- **items 重复组模板**(JSON 有 `items` 字段):按网格容量固定展开(通常 4 格),槽引用用 bracket 路径 token,如 `{{IMG_SRC:image[0]}}`、`{{TEXT:explain[2]}}`,锚点同样 `data-image-slot="image[0]"` / `data-text-key="explain[2]"`(先例:mag-10.ts,fill/lint 已支持)
- React 版没渲染的槽:锚点和 token 一起省略,并在文件头注释说明
- React 版用 brToReact 处理换行的:样式加 `white-space:pre-line` 等效;用 pre-wrap 的照抄
- WebFolio 的 totalPages/空值兜底无 token 通道:渲染 `{{TEXT:folio}}` + 静态灰色 `/` span(先例 mag-03/05/06)
- 品牌 furniture(logo data URI 等)照 mag-20/22 先例整段内联;`new Date().getFullYear()` 在模块顶层求值
- 静态装饰原样保留;React 依赖全局 reset 的 p/h1 等显式补 `margin:0`

完成后自验(必须通过):
```bash
cd "/Users/smalldog/Desktop/yujee工程文件/memoir-agent-rebuild/.claude/worktrees/html-pages-c/packages/contracts" && npx tsx scripts/lint-one-html-template.ts <templateId>
```

返回:lint 结果、HTML 字符数、省略的槽位清单(如有)、镜像中遇到的任何不确定点。
