# HTML 页面真相(C 方案)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每页相册页面以 HTML 字符串为唯一真相:AI 直接读写整页 HTML,画板/PDF 渲染同一份 HTML,结构性操作(换排版/主题)从模板重新生成 HTML。

**Architecture:** fill-template 渲染簇(adapt-layout/theme-carrier/types/registry)从 web 抽到 `@yujee/contracts`,48 个模板补 HTML 变体;Web 在排版/设计落库时逐页烘 HTML 进 draft;design-agent 增 `write_page_html`(锚点+安全校验),结构工具改为重新 fill;编辑器与栅格 PDF 消费存库 HTML。

**Tech Stack:** TypeScript(contracts/web/design-agent)、zod、pydantic 镜像、node:test + tsx、pytest。

## Global Constraints

- 只在 worktree 分支 `worktree-html-pages-c` 提交,绝不动 main。
- 图片 src 落库形态一律 `{{IMG_SRC:slotId}}` token;base64 绝不落库(隐私红线)。
- 锚点约定沿用现状:`data-template` / `data-text-key` / `data-image-slot` / `data-variable-decor`。
- 给 AI 的 photoId 一律短 id(memory: no-raw-ids-to-ai)。
- 单页 html ≤ 65536 字符(64KB)。
- 模板 HTML 化 = 忠实镜像 `templates/mag-XX/index.tsx` 现状,不做视觉修正。
- 每个 Task 结束跑对应测试并 commit;M2 里每个模板一个 commit。

---

## M1 契约与渲染簇抽包

### Task 1: contracts 增加 render 模块(纯 TS 迁移)

**Files:**
- Create: `packages/contracts/src/render/types.ts`(自 web templates/types.ts 迁 TemplateData/TemplateArrayItem/ImagePos 等纯类型,去掉 React ComponentType 部分——那部分留在 web)
- Create: `packages/contracts/src/render/adapt-layout.ts`(整文件迁移,改 import 为包内相对路径)
- Create: `packages/contracts/src/render/theme-carrier.ts`(同上)
- Create: `packages/contracts/src/render/fill-template.ts`(同上;`getHtmlTemplate` 改从本包 registry 取)
- Create: `packages/contracts/src/render/html-templates/registry.ts` + `mag-01.ts`(现有 3 个先迁)
- Modify: `packages/contracts/src/index.ts`(导出 render 模块)
- Modify: web 原文件全部改为 `export * from '@yujee/contracts/render/...'` 薄转发(不破既有 import)
- Test: 迁移后 `pnpm --filter @yujee/web test` 与 `pnpm --filter @yujee/contracts typecheck` 全绿(fill-template.test.ts 跟随迁移)

**Interfaces:**
- Produces: `fillTemplateHtml(templateHtml, page: FillablePage, resolveImage)` / `renderPageHtml(page, resolveImage)` / `getHtmlTemplate(templateId): string | undefined` / `HTML_TEMPLATE_IDS: string[]`,design-agent 与 web 共用。

Steps:
- [ ] 迁移五个文件 + registry,web 侧留转发壳
- [ ] `pnpm --filter @yujee/contracts typecheck && pnpm --filter @yujee/web typecheck`
- [ ] `pnpm --filter @yujee/web test`(fill-template 快照测试随迁)
- [ ] Commit `refactor(contracts): fill-template 渲染簇抽包,web 留转发壳`

### Task 2: Page 契约加 html 字段(zod + pydantic)

**Files:**
- Modify: `packages/contracts/src/v3.ts`(Page schema:`html: z.string().max(65536).optional()`——过渡期 optional,M3 落库后编辑器路径要求存在)
- Modify: `engine/src/contracts/schemas.py`(镜像 `html: str | None = Field(default=None, max_length=65536)`)
- Test: contracts 既有 Page fixtures 通过;新增“html 超长被拒”用例(zod + pytest 各一)

Steps:
- [ ] 加字段 + 两侧用例(先红后绿)
- [ ] `pnpm --filter @yujee/contracts test && PYTHONPATH=engine <主仓>/engine/.venv/bin/python -m pytest engine/tests -q`
- [ ] Commit `feat(contracts): Page.html —— 页面 HTML 真相字段(可选,过渡期)`

### Task 3: 模板锚点校验脚本

**Files:**
- Create: `packages/contracts/scripts/check-html-templates.ts`:对 registry 里每个模板断言 —— 模板 JSON 的每个 text 槽有 `data-text-key="id"` 与 `{{TEXT:id}}`;每个 image 槽有 `data-image-slot` 与 `{{IMG_SRC:id}}`;根节点 `data-template="id"`;variableDecor 槽有 `{{COLOR:}}`/`{{FONT:}}` token。
- Modify: `packages/contracts/package.json` scripts + 根 `package.json` 的 `templates:check` 链上它。

**Interfaces:**
- Produces: `pnpm templates:check` 失败即列出缺失锚点清单——M2 的验收器。

Steps:
- [ ] 写脚本(对现有 3 个模板通过)
- [ ] 故意在 mag-01 删一个 token 验证脚本会红,再恢复
- [ ] Commit `feat(contracts): HTML 模板锚点完整性校验(templates:check)`

## M2 模板 HTML 化(48 个,忠实镜像)

### Task 4..N: 每模板一循环(以 mag-02 为例,其余同法)

**Files(每个模板):**
- Create: `packages/contracts/src/render/html-templates/mag-XX.ts`(镜像 `apps/web/src/components/album/templates/mag-XX/index.tsx` 的几何/样式,格式照 mag-01.ts)
- Modify: `registry.ts` 注册
- Test: 锚点校验脚本覆盖 + fill 快照测试(每模板一个:填样例数据,断言无残留 `{{`、锚点齐全、长度 < 64KB)

Steps(重复 47 次,可分批派发子代理并行,每模板独立 commit):
- [ ] 读 `mag-XX/index.tsx`,镜像成 HTML 常量(px 几何逐一照抄;字体栈内联)
- [ ] 注册 + `pnpm templates:check`
- [ ] 快照测试绿
- [ ] Commit `feat(contracts): mag-XX HTML 模板(镜像现状)`

验收:`HTML_TEMPLATE_IDS.length === 48` 且 `templates:check` 全绿。

## M3 生成收尾:落库烘 HTML

### Task 5: bakePagesHtml 纯函数 + 接线

**Files:**
- Create: `apps/web/src/services/album/bake-html.ts`:`bakePagesHtml(pages: Page[]): Page[]` —— 对每页 `renderPageHtml`(resolveImage 返回 `{{IMG_SRC:slot}}` token 原样)写入 `page.html`;无 HTML 模板的 templateId 抛错(M2 完成后不该发生)。
- Modify: judge 回调合并处(`apps/web/src/app/api/v3/internal/job-progress/handler.ts` 落 pages 前)与 `design-apply`(组封面/封尾页处)调用 bake。
- Modify: 读路径兜底:`readStoryDraft` 后对缺 html 的页现场 bake(存量册子)。
- Test: bake 单测(token 保留/文字烘干/64KB 保护);job-progress 合并测试补断言“落库页带 html”。

**Interfaces:**
- Produces: draft_json.pages[i].html 自此始终存在。

## M4 design-agent:读写 HTML 工具

### Task 6: read_page 带 html + write_page_html

**Files:**
- Modify: `packages/design-agent/src/core/album/book-state.ts`(AlbumBookPage 加 `html`;parse/validate/clamp 兼容)
- Create: `packages/design-agent/src/core/album/html-guard.ts`:`validatePageHtml(prevHtml, nextHtml, template): string[]` —— 单根 data-template 一致、≤64KB、禁 `<script|iframe|object|embed>`、禁 `on\w+=`、禁 `javascript:`、禁 http(s) 外链 src、原 `data-text-key`/`data-image-slot` 集合 ⊆ 新 html、img src 仍为 `{{IMG_SRC:*}}`;`derivePageTexts(html): Record<string,string>`(从 data-text-key 提取,正则实现,无 DOM 依赖)。
- Modify: `tools.ts`:read_page payload 加 `html`;新工具 `write_page_html {pageNo, html}`(guard 通过 → 存 html + texts=derive → commitWrite;失败 → 返回错误清单);`update_page_texts` 改为在 html 上 patch textContent;`swap_page_template` 改为新模板重 fill(告知覆盖手工改动);`set_text_colors/fonts` 改为按锚点 patch style。
- Modify: `system-prompt.ts` / `skills.ts`(“直接编辑页面 HTML”方法论 + 锚点红线 + 图片 src 是 token 别动)。
- Test: html-guard 全分支;write_page_html 拒绝/通过;texts 派生;结构工具重 fill 行为。

**Interfaces:**
- Consumes: contracts 的 `getHtmlTemplate`/`fillTemplateHtml`。
- Produces: 对话侧页面读写全走 html。

## M5 编辑器消费 HTML

### Task 7: 画板渲染 + 用户操作 DOM patch

**Files:**
- Create: `apps/web/src/components/album/page-html-dom.ts`:`resolveHtmlForDisplay(html, resolveImage)`(IMG_SRC token→blob URL)/`setSlotText`/`setSlotImage`/`setObjectPosition`(字符串级正则 patch,同构可测)。
- Modify: `PagePreview.tsx`/`FlipBook.tsx`/EditorPort 画板:页面有 `html` 一律走 `dangerouslySetInnerHTML`(React 模板路径保留为无 html 页的兜底,待全量后删)。
- Modify: `PageEditPanel.tsx`:改字/换图/取景操作调用 page-html-dom,PATCH `{html}` 回既有逐页保存接口;服务端校验(html-guard 同款,web 侧复制或抽 contracts)。
- Test: page-html-dom 单测;编辑面板既有测试改造。

## M6 PDF + 收尾

### Task 8: 栅格导出接 html;@react-pdf 退役;文档收尾

**Files:**
- Modify: 栅格 PDF 导出路径(AlbumEditor.exportPdf / pdf/render):对每页 `resolveHtmlForDisplay`(高清 dataURL)→ html2canvas。
- Delete: `@react-pdf` 矢量路径文件与依赖(单独 commit,便于回退)。
- Modify: 仓根 README / apps/web/README / design-agent 说明,把“页面真相=HTML/锚点契约”写进长期文档;删除 HTML-PAGES-C-DESIGN.md 与本 PLAN。
- Test: 全仓 `pnpm test` + `pnpm typecheck` + engine pytest;端到端(mock)一册:生成→draft 带 html→画板→对话改版→导出。

---

## Self-Review 备忘

- spec §3.1-§3.7 ↔ Task 1-8 全覆盖;§4 安全在 Task 6(guard)与 Task 7(服务端复检)双层。
- texts 派生函数只在 design-agent 与 web 服务端两处调用,实现放 contracts?——放 design-agent html-guard,web 端从 contracts 复用会引入循环;先 design-agent 实现,M5 服务端校验时抽到 contracts(Task 7 注明)。
- M2 与 M3+ 可并行:M3-M6 只依赖 registry 接口,不依赖 48 个全齐。
