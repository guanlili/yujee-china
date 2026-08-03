# 移动端画板重构 · 交接文档 (#304)

> 分支 `feat/mobile-canvas-interaction` · worktree `~/yujee-304` · 未推远端
> 基线：`origin/main` @ 02244605。

## 一句话现状

移动端编辑器**已在真实相册上跑通「改文字 + 改页面底色」并落库**（真机口径 Playwright
自测全绿，含刷新后仍在）。图片编辑、导出/分享执行、AI 对话、删页仍是占位（点了给 toast）。

## 上一版交接文档错在哪（重要，别再照抄）

上一版说「就差一个选中链路」。真实情况有两处更靠底层的错：

1. **移动端在生产环境根本挂不上。** 分流条件曾是 `mode === 'editing'`，而 `mode` 的判据是
   `album.layoutJson != null`。全仓 `layout_json` **只有读、没有任何一处写**（`schema.ts:232`
   说明它是 v1 遗留列），`albumPageRepo.bulkInsert` 只出现在测试里。所以 V3 的真实相册永远
   `layoutJson == null` → 永远 `authoring` → `MobileEditorRoot` 一次都不会渲染。
2. **就算挂上了，样式改动也存不住。** `editing` 分支的 pages 来自 `getDetail`，它
   `pages.map` 里不返回 `htmlJson`（`album-service.ts:443`），`album_pages` 表也没有 html 列。
   没有 html 真相可打补丁，字号/字体/颜色/底色刷新即丢。

**修正后的接法（现在的实现）**：移动端挂在 `EditorAuthoring` 的 ready 分支
（`EditorPort.tsx`，`device === 'mobile' && pages.length > 0`）。那里的 pages 来自
`getDraftSkeleton`，**带 `htmlJson`**（`album-service.ts:916`）；落库时服务端 `updatePage`
走 draft 分支，认 `textStyles`/`pageStyle` 并打进存库 html。端到端因此闭环。
`page.tsx` 里 editing 那条分流保留不动（v1 遗留相册用）。

守卫：`edit-wiring.test.ts` 第一条就盯这个，改回去会红。

## 目标架构（不要推翻）

移动端与桌面是**两棵独立 UI 树，不共用任何 DOM 节点**。桌面 `EditorPort.tsx` 的 4700 行
命令式 innerHTML 一行不动。两边只共用三样：
- **渲染**：`page-face.tsx`（一页书→HTML，纯函数）
- **设计系统**：`editor-tokens.css` + `editor-fonts.ts`
- **落库通道**：`PATCH /api/v1/albums/{id}/pages/{index}`（桌面移动同一个）

判定源：`use-device-mode.ts`（`resolveDeviceMode(window.innerWidth)`，≤767=mobile）。
同一 URL，客户端按尺寸分流，不读服务端 UA、不改路由结构。

## 编辑落地的口径（与桌面刻意不同）

桌面是「先改活节点、再回写 html」。移动端反过来：**先改 html 真相，再让那一页重渲**。

原因：文字槽住在 `dangerouslySetInnerHTML` 里，React 不拥有那些节点，而架构守卫禁止
移动端源码碰 `document`/`querySelector`。所以：

- **命中**：`e.target.closest('[data-text-key]')` —— 只用事件里的 target，零查询
- **高亮**：从 `getBoundingClientRect()` 算出相对 `.mspread` 的位置，画一个 React 拥有的
  `.msel` 兄弟节点。不往页面 DOM 里塞节点、不改它的类/style
- **初值**：`getComputedStyle(target)` → `probeToState()`，面板打开即显示元素真实字号/颜色/对齐
- **预览**：面板每次改动都从「打开那一刻的整页快照」重算，经 `page-edit.ts` 的
  `applyTextEdit`/`applyPageBg`（内部用与服务端同一批 patcher）→ `setPages` → 那页重渲
- **取消/完成**：取消 = 把快照放回去（不做反向撤销）；完成 = PATCH
- **只写改过的项**：`styleDiff` 取差集，不把模板继承来的字号/颜色烘死进 html

好处：预览与落库共用同一套 patcher，**所见即所存**。

## 文件地图

| 文件 | 职责 |
|---|---|
| `MobileEditorRoot.tsx` | **数据容器 + 编辑焦点持有者**：pagesState、editPage、selection、面板快照、落库。副作用只住这里。 |
| `page-edit.ts` | **纯函数层**：computed→面板初值、样式差集、改动打进页面、落库 payload、读回页面底色。零 DOM，node 直接测。 |
| `MobileEditor.tsx` | 浏览态展示层（纯受控）。 |
| `EditView.tsx` | 编辑态展示层 + 选中链路 + 面板升起时把书上移让位。 |
| `browse-window.ts` / `fit-box.ts` | 纯函数：哪一屏显示什么、怎么摆。 |
| `MobileTopbar / MobileStrip / icons / MobileToast` | chrome 零件（全部走 `zh` prop）。 |
| `modals/ModalHost.tsx` | 弹窗宿主：带 `.editor-port` 类，让桌面 165 条弹窗规则原样命中（借样式不借 DOM）。 |
| `modals/*` | 复刻桌面弹窗结构，行为 React 驱动。 |
| `mobile-editor.css` | 移动端全部样式。**零媒体查询**、**零自造颜色**（走 token）。 |

## 已跑通（真机口径验证过）

- 浏览态：翻页、密度 1/2/4、独页封面/封底、书册预览栏
- 编辑态：点页进入、逐页翻、返回、一级栏四格
- **点页面文字 → 高亮选中 → 面板绑上来（预填真实字号/文案）**
- **改文案 / 字号 / 颜色 / 粗斜 / 对齐 → 即时上屏 → 完成落库 → 刷新还在**
- **页面底色 → 即时上屏 → 走 pageStyle 落库**
- 取消 = 还原，且不落库
- 画板背景（相册级）落库
- 七个弹窗 + AI sheet 全部能开能关
- 中英双语（`zh` prop 串到每个 chrome 零件）

自测脚本（真实相册 + 手机视口 + 真实登录，10 段 40 条断言）：
`~/yujee-304` 外的临时目录里跑过，未入库（一次性验证件）。要复跑见下方「怎么复现自测」。

## 未完成（占位，点了给「即将上线」toast，没有死按钮）

- **图片编辑**：换图 / 缩放 / 铺满 / 复位（`PhotoPickerModal` 外壳在）
- **导出 / 分享的执行**：菜单 · 拼图 · 进度 UI 就绪，canvas 渲染与上传未接
- **AI 对话真收发**：`AiChatSheet` 只有外壳。真接要接桌面画布协调器
  （`ChatPanel` 依赖 `ChatCoordinatorContext`，移动端这棵树没有，不能整体挂）
- **删除页**：无删页后端通道（需新增 API + 页索引重排）
- **完整取色器**：HSV 拾色未做，先漏出 8 常用色

## 已知限制（改之前先知道）

- **v1 遗留相册（`layoutJson` 落地过的）走 `page.tsx` 的 editing 分支**，那条路上
  `detail.pages` 没有 `htmlJson` → 文字内容改动能存（`textsJson` 走 `album_pages` 列），
  但**样式改动（字号/颜色/字体/底色）存不住**。桌面在这条路上也一样。V3 相册不受影响。
- 面板升起时选中框的位置是点击那一刻算的；改完字号后框可能与新尺寸略有偏差（不影响功能）。
- 照片只存在浏览器本地（invariant 1）：换设备/清缓存后内页图会空，走服务器压缩快照兜底。

## 上线前必须清理

- `app/[locale]/dev/mobile/` 整个目录（dev 预览页 + 样例数据，仅调样式用）
  —— **等真机验收通过后再删**，删了就只能拿真实相册测。

## 验证

```
cd ~/yujee-304/apps/web
npx tsc -p tsconfig.json --noEmit          # 0 错
npx tsx --test "src/**/*.test.ts"          # 822 测试，821 通过，1 skip（原有）
```

真机：手机连同一 WiFi → `http://<局域网IP>:3000/zh/album/<uuid>`
起服务：`cd ~/yujee-304/apps/web && npx next dev -p 3000`
（**不要加 `-H 0.0.0.0`**，会只绑 IPv4 让 localhost 拒连；3000 若被主仓占用，先停主仓 dev）

### 怎么复现自测

本地 dev DB 里 V3 相册都是 `layoutJson == null`、pages 在 `draft_json`，可直接用。
挑一本有 pages 的：

```sql
select id, title, jsonb_array_length(draft_json->'pages') n
from albums where status='EDITING' and layout_json is null order by created_at desc;
```

**改任何相册数据前先备份，跑完立刻恢复。** 这条是血的教训：备份取晚了，自测把 4 页
文案写脏，其中 3 处原值永久丢失（`draft_json` 没有版本历史，`album_file_snapshots` 是空的，
compose job 的 `meta` 只有 337 字节不含页面内容）。

```bash
# 跑之前
psql "$DATABASE_URL" -t -A -c "select draft_json from albums where id='<uuid>'" > snap.json
# 跑之后（psql 的 \set + :'var' 才能安全塞进 jsonb，别用 -c 拼字符串）
printf "\\\\set d \`cat snap.json\`\nupdate albums set draft_json = :'d'::jsonb where id='<uuid>';\n" > restore.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f restore.sql
```

更好的做法：**别拿用户的相册当靶子**。自测脚本应该先复制一行 album 出来打，跑完删掉。

## 测试守卫（改的时候别踩红，它们是有意的）

- `edit-wiring.test.ts`：**移动端必须挂在 authoring**、pages 必须外部传入、编辑焦点必须
  在 Root、落库必须真发 PATCH 且用 `page.pageIndex`、失败必须出声、取消必须走快照还原
- `page-edit.test.ts`：纯函数层 22 条（差集、转义、锚点缺失回落、payload 口径）
- `click-wiring.test.ts`：交互 handler 必填 + **禁组件内空 onClick** + **禁行为型可选 handler**
  + 禁传空函数。后三条是这次补的，当场抓出 4 个死按钮
  （`PhotoPickerModal.onConfirm`、`CollageModal.onConfirm`、`ShareLinkModal.onConfirm/onCopy`、
  `TextPanel` 更多颜色）
- `modals.test.ts`：每个弹窗「关着不渲染 / 开着有关闭入口」；宿主不许 `pointer-events:none`
  放行名单；**「无背景」格必须有定位上下文**（真机抓到的 bug：斜杠 `::after` 逃出去铺满
  整块面板，底色面板一个颜色都点不动）
- `editor-tokens.test.ts`：移动端 token 与桌面逐条一致、样式零自造颜色（`#c44` 除外）
- `edit-view.test.ts` / `mobile-editor.test.ts`：架构守卫 + i18n（英文界面不许残留中文标签）

## 用户明确的规矩（务必遵守）

1. 移动端和网页端 UI 分离，编辑这块尤其不能混用同一套组件。
   **例外（2026-08-03 用户拍板）：AI 对话弹窗**。为对话另做的瘦壳（AiChatSheet）让
   两个阶段长出两个不同的弹窗，被用户明确否掉——对话必须是桌面 `ChatPanel` 本体
   （经 `use-chat-coordinator.ts` 接移动画板，抽屉样式命中 editor-port.css 的 ≤767
   规则）。画布/编辑组件仍分离不混用。
2. 配色/样式/样例**照搬网页端，不自创**（给的图是布局参考，不是让你重画视觉）
3. 书**不做自由缩放**（密度是离散档位，靠重绘不靠 transform；面板让位的 translateY 只是位移）
4. 别只给 demo，要接真实相册跑通
5. 报完成前**自己先验证**（尤其点击/关闭）
6. 未实现的功能一律给反馈，**不留死按钮**
