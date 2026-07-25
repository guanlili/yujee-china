# 移动端画板重构 · 交接文档 (#304)

> 分支 `feat/mobile-canvas-interaction` · worktree `~/yujee-304` · 未推远端
> 全部改动已提交（工作区干净）。基线：`origin/main` @ 02244605。

## 一句话现状

移动端编辑器的**外壳、交互、弹窗全部做完并可点**，但**编辑不生效**——
点页面上的字/图还不能选中、改动不落到书上。这是没做完的核心，见下方「未完成 · 最重要」。

## 目标架构（已和用户确认，不要推翻）

移动端与桌面是**两棵独立 UI 树，不共用任何 DOM 节点**。桌面 `EditorPort.tsx`（4700 行
命令式 innerHTML）一行不动。两边只共用三样：
- **渲染**：`page-face.tsx`（一页书→HTML，纯函数）
- **设计系统**：`editor-tokens.css`（配色/圆角/阴影/字体，`.editor-port,.mobile-editor,.mai-sheet-overlay` 共用）+ `editor-fonts.ts`（字体表）
- **落库通道**：`PATCH /api/v1/albums/{id}/pages/{index}`（HTTP，桌面移动同一个）

判定源：`use-device-mode.ts`（`resolveDeviceMode(window.innerWidth)`，≤767=mobile）。
路由分流：`app/[locale]/album/[uuid]/page.tsx` 的 `phase==='ready' && mode==='editing' && device==='mobile'`
→ `MobileEditorRoot`。**同一 URL，客户端按尺寸分流，不读服务端 UA、不改路由结构。**（用户问过，确认无误。）

## 文件地图（全部在 `mobile/`）

| 文件 | 职责 |
|---|---|
| `MobileEditorRoot.tsx` | **数据容器**：取照片 URL（display + thumb 两档）、画板背景、所有弹窗开关 state、落库。副作用只住这里。 |
| `MobileEditor.tsx` | 浏览态展示层：顶栏 + 画板（书居中/密度/翻页/AI气泡/左下角双钮）+ 书册预览栏。 |
| `EditView.tsx` | 编辑态展示层：满屏单页 + 一级栏四格（背景/图片/文字/删除）+ AI气泡。 |
| `browse-window.ts` | 纯函数：哪一屏显示哪些开页、翻屏、跳页对齐。独页（封面/封底）任何密度单页独占。 |
| `fit-box.ts` | 纯函数：等比贴合几何（书不做自由缩放，全靠 fitBox 算尺寸重绘）。 |
| `MobileTopbar.tsx` / `MobileStrip.tsx` / `icons.tsx` / `MobileToast.tsx` | chrome 零件。 |
| `modals/ModalHost.tsx` | 弹窗宿主：带 `.editor-port` 类，让桌面 165 条弹窗规则原样命中（借样式不借 DOM）。 |
| `modals/BoardBgSheet / ExportModals / ShareLinkModal / PhotoPickerModal / ElementSheet` | 复刻桌面弹窗结构（类名逐条对齐），行为 React 驱动。 |
| `modals/TextPanel.tsx` / `PageBgPanel.tsx` | 塞进 ElementSheet 的编辑控件（文字/页面底色）。 |
| `modals/AiChatSheet.tsx` | AI 对话黑底小水母 bottom sheet。 |
| `mobile-editor.css` | 移动端全部样式。**零媒体查询**（只在手机挂）；**零自造颜色**（走 token）。 |

## 已完成（可点、可核对）

- 浏览态：翻页、密度 1/2/4（开页单位）、独页封面/封底单页独占、书册预览栏（真实版面缩略，thumb 档）
- 编辑态：点页进入、逐页翻、返回、一级栏四格
- 七个弹窗 + AI sheet：全部能开能关（复用桌面样式）
- 画板背景弹窗：**唯一真正接通落库的**（选色/上传/PATCH 都通）
- 全部交互 handler 改必填 → 漏接编译不过（曾因可选漏接 onMore/onOpenChat 出死按钮）

## 未完成 · 最重要（下一步就做这个）

**选中链路——让编辑真正生效。** 现状：TextPanel/PageBgPanel 改的是面板自己的 state，
**不落到页面元素上，也不存库**。需要做：
1. 移动端画板 DOM（`pageFaceHTML` 产出）里，点图/字 → 命中具体 slot → 高亮选中
2. 面板绑定到被选中的元素，改动写回 `htmlJson` 真相
3. 落库走 `PATCH /api/v1/albums/{id}/pages/{index}`（见 `EditorPort.tsx:2617 persistPagePatch` 是桌面怎么做的，`page-html-dom.ts` 的 `patchHtmlText/patchHtmlTextStyle/patchHtmlPageStyle/patchHtmlImagePos` 是共享的写回函数）
4. **必须在真实相册测**（dev 样例是假数据、无照片、无落库，测不了这一步）

桌面参考：`EditorPort.tsx` 的 `surfaceClick`（选中）、`applyColorToSelection`/`applyFontToSelection`/`applyFontSizeToSelection`（改样式）、`syncPageHtml`（写回 html 真相）。移动端要复刻这套逻辑到自己的 DOM 上，**不要去调桌面的（那依赖 coordinator，移动端没有）**。

## 其它未完成（占位，点了给「即将上线」toast）

- **AI 对话真收发**：`AiChatSheet` 只有外壳，真正接 AI 要接桌面画布协调器（ChatPanel 依赖 `ChatCoordinatorContext`，移动端这棵树没有，不能整体挂）
- **导出/分享的执行**：菜单/拼图/进度 UI 就绪，canvas 渲染与上传未接
- **删除页**：UI 在，无删页后端通道（需新增 API + 页索引重排，超范围）
- **颜色「更多」**：完整 HSV 取色器未做
- **图片编辑面板**：缩放/铺满/复位/换图未做（PhotoPickerModal 外壳在）

## 上线前必须清理

- `app/[locale]/dev/mobile/` 整个目录（dev 预览页 + 样例数据，仅调样式用）

## 验证

```
cd ~/yujee-304/apps/web
npx tsc -p tsconfig.json --noEmit        # 0 错
npx tsx --test "src/**/*.test.ts"        # 782 测试，781 通过，1 skip（原有）
```
dev 预览（假数据，看形态）：`http://localhost:3000/zh/dev/mobile`
真实相册（手机连同一 WiFi，测落库）：`http://<局域网IP>:3000/zh/album/<uuid>`
起服务：`cd ~/yujee-304/apps/web && npx next dev -p 3000`（**不要加 `-H 0.0.0.0`**，会只绑 IPv4 让 localhost 拒连；3000 若被主仓占用，先停主仓 dev）

## 测试守卫（改的时候别踩红，它们是有意的）

- `modals/modals.test.ts`：每个弹窗必须「关着不渲染 / 开着有关闭入口」；宿主不许 `pointer-events:none` 放行名单（曾漏 `.mes-overlay` 导致弹窗关不掉）
- `click-wiring.test.ts`：交互 handler 必填、必须传下去、未实现功能不做死按钮
- `editor-tokens.test.ts`：移动端 token 与桌面逐条一致、移动端样式零自造颜色（`#c44` 除外）
- 各文件顶部「架构守卫」：移动端源码不许出现 `document`/`querySelector`/`#ovGrid`；样式不许 `@media max-width`

## 用户明确的规矩（务必遵守）

1. 移动端和网页端 UI 分离，编辑这块尤其不能混用同一套组件
2. 配色/样式/样例**照搬网页端，不自创**（用户给的图是布局参考，不是让你重画视觉）
3. 书**不做自由缩放**（密度是离散档位，靠重绘不靠 transform）
4. 别只给 demo，要接真实相册跑通
5. 报完成前**自己先验证**（尤其点击/关闭，之前因没验出过「弹窗关不掉」「死按钮」两次事故）
