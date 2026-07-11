# C 方案设计:页面真相 = HTML(2026-07-11)

> 工作文档:实现完成后把长期结论并入仓根/子 README,本文件删除(CLAUDE.md 约定)。

## 0. 决策背景(用户拍板)

- 对话里让 AI 只改槽位文字效果不理想;**内容修改 = 把整页 HTML 交给 AI 自由编辑**。
- 只有结构性操作(换排版、主题一键渲染)保留专用工具。
- 不走 A(html override 过渡),**直接 C:每页直接存 HTML,HTML 是页面唯一真相**。
- 48 个模板全部补出 HTML 版(镜像各 `templates/mag-XX/index.tsx`),在本 worktree 完成。
- 用户操作空间(改文字/选字体/换图)必须保留 → 锚点约定(见 §2)。

## 1. 终态图景

```text
engine 排版管线(槽位世界,不动)
  analyze → select-layout → judge → write_copy → design(字体/颜色/封面文案)
        ↓ Web 收尾:每页 fillTemplateHtml(同构) → 存 html
draft_json.pages[i] = { pageIndex, templateId, images, html }   ← html 即真相
        ↓                    ↓                     ↓
   编辑器画板           design-agent 对话        PDF 导出(栅格)
   (渲染 html,        (read=html 全文,       (html2canvas 喂
    锚点上做用户操作)    write=整页 html)        高清 src 的 html)
```

- `texts` 不再是真相:从 html 的 `data-text-key` 元素**派生**(装书校验/搜索用)。
- `templateId`/`images` 保留:photo 引用解析、换排版重生成、判图管线仍需要。
- 主题字体/颜色不再走 carrier 键:烘进每页 html(结构工具重刷时重新烘)。

## 2. HTML 页面契约(锚点 + token)

沿用试点([html/mag-01.ts](apps/web/src/components/album/templates/html/mag-01.ts))已有约定:

- 根:`<div data-template="mag-XX" style="…794×1123…">`
- 文字锚:`data-text-key="slotId"`(可主题的加 `data-variable-decor`)
- 图片锚:`data-image-slot="slotId"`,`src` **一律存 token `{{IMG_SRC:slotId}}`**
  (真实 src 渲染时解析:画板=blob URL,PDF=高清 dataURL;base64 绝不落库 —— 隐私红线)
- `object-position` / 缩放:直接写在 img style 里(取代 imagePos 字段)
- AI 新增元素:无锚点,属装饰,用户槽位 UI 不可达(改它走对话)

**存库形态 = 已填充 HTML**(文字/颜色/字体烘干),仅图片 src 保持 token。

## 3. 分层改动

### 3.1 contracts(跨服务)

- `Page` schema:新增 `html: string`(上限 64KB);`texts`/`imagePos` 降级为可选派生字段。
- 新增 `packages/contracts/templates-html/`?否 —— HTML 模板留在 web
  (`apps/web/src/components/album/templates/html/`),design-agent 通过独立包引用会引入
  web 依赖;改为把 **fill-template + 48 个 HTML 模板抽到 `packages/contracts`(纯字符串,无 React)**,
  web 与 design-agent 共同消费。engine 不需要它(engine 只出槽位)。
- Python 镜像 `schemas.py` 同步 `html` 字段。

### 3.2 模板 HTML 化(体力活,本 worktree 的大头)

- 48 个 `templates/mag-XX/index.tsx` → 逐一镜像成 `mag-XX.html.ts`(常量字符串),
  注册进 registry;每个补 `fill-template` 快照测试(槽位齐全、token 合法、锚点齐全)。
- 校验脚本:模板 JSON 声明的每个 text/image 槽,在 HTML 里必须有对应锚点/token
  (进 `pnpm templates:check` 一并跑)。
- 注意:用户随后会另开窗口调整模板视觉;本次以"忠实镜像现状"为准,不做视觉修正。

### 3.3 生成收尾(Web)

- judge 回调合并 & design 应用处(album-service/design-apply):组装出槽位页后,
  逐页 `fillTemplateHtml` → 把 `html` 写进 draft。
- 旧 draft 兼容:读到没有 `html` 的页,按 templateId 现场 fill(一次性迁移读路径)。

### 3.4 design-agent(对话 AI)

- `read_page`:返回每页完整 `html` + 图槽的 `sceneDescription`/photoId(短 id)映射
  + 章节背景。token 数注意:整本书全 html 很大,默认单页/指定页,读全书走摘要。
- 新 `write_page_html`(核心写工具):输入 `{pageNo, html}`;校验管线:
  1. 尺寸/结构:单根 `data-template`,794×1123,≤64KB;
  2. 安全:禁 `<script>/<iframe>/<object>`、`on*` 属性、`javascript:`、外链 http(s) src;
  3. 锚点:原页所有 `data-text-key`/`data-image-slot` 必须仍在(可挪/可改样式,不可删);
     图片 src 必须仍是 `{{IMG_SRC:*}}` token;
  4. 通过 → 存 html、从锚点重新派生 texts;失败 → 拒绝并返回具体原因让模型重试。
- `update_page_texts` 保留(轻量改字仍最省 token),实现改为 DOM patch textContent。
- `swap_page_template`(换排版):从新模板重新 fill(保留 images/texts 能带走的部分),
  **覆盖该页手工 HTML 改动**,工具结果里明确告知。
- `set_text_colors`/`set_text_fonts`(主题一键):按 `data-variable-decor` +
  `data-text-key` 角色批量 patch 每页 html 的 style。
- system prompt / skills 同步改写("你直接编辑页面 HTML"的方法论 + 锚点红线)。

### 3.5 Web 编辑器

- 画板(PagePreview/FlipBook/EditorPort):渲染存库 html(解析 IMG_SRC token → blob URL),
  React 模板渲染路径退役。
- PageEditPanel 用户操作改为 DOM patch helpers(共享一个 `page-html-dom.ts` 工具集:
  setText(slotId,text) / setImage(slotId,photoId) / setObjectPosition / setThemeVars),
  patch 后整串 html PATCH 回服务端(沿用现有逐页保存接口,body 换成 {html})。
- 缩略图/判图链路不变(发生在 html 化之前的候选阶段)。

### 3.6 PDF

- 栅格导出(html2canvas 高倍截图)改为直接喂存库 html(IMG_SRC 解析成高清 dataURL)。
- 矢量 @react-pdf 路径:C 世界无法消费自由 HTML,**退役**(保留代码删除单独提交)。

### 3.7 DB / 迁移

- draft_json 是 jsonb,加字段无 DDL;`album_pages` 若有列级 texts 依赖则同步(待查)。
- 存量册子:读路径兜底现场 fill(§3.3);不做批量回填。

## 4. 安全与预算

- sanitize 白名单在 write_page_html 与装书两处各跑一遍(纵深)。
- 单页 html ≤64KB、全书读上限提醒;对话默认单页粒度操作。
- AI 交互中的 photoId 一律短 id(既有约定,见 memory no-raw-ids-to-ai)。

## 5. 测试与验证

- 每模板:fill 快照 + 锚点齐全性(48×2,脚本生成)。
- write_page_html:锚点删除拒绝/script 注入拒绝/合法改动通过/texts 派生正确。
- 端到端:生成一册(mock engine)→ draft 带 html → 画板渲染 → 对话改版面 → PDF 导出。
- 回归:装书校验、判图、设计环节全链路测试套件。

## 6. 非目标

- engine 排版管线改造(仍槽位世界)
- 模板视觉调优(用户另开窗口做)
- 矢量 PDF 的 HTML 化替代(直接退役)
- 多页联动自由排版(跨页 spread)

## 7. 实施顺序(里程碑)

1. **M1 契约+抽包**:fill-template/registry 迁入 contracts;Page.html 字段;校验脚本
2. **M2 模板体力活**:48 个 HTML 模板 + 快照测试(可并行分批提交)
3. **M3 生成收尾**:Web 在 judge/design 落库时烘 html;读路径兜底
4. **M4 design-agent**:read/write_page_html + 结构工具改造 + prompt/skills
5. **M5 编辑器**:画板渲染 html + PageEditPanel DOM patch
6. **M6 PDF + 清理**:栅格导出接 html;@react-pdf 退役;README 收尾、删本文档
