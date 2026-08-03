# 删除书页功能设计

- 日期: 2026-08-03
- 影响面: `apps/web`(service/API/编辑器双端)、`packages/design-agent`(Phase 2)
- 取代: `2026-07-30-split-delete-page-design.md` 中 `delete_page` 一节(该文档拆页部分仍被
  engine 分页坏地基挡着,不在本轮)
- 分支: `feat/collab-editing`(draft_pages 基建只在此分支,Task 1-4 已落地)

## 目标

让用户能删掉书里不要的内页,连图带文一起移除。两条入口:

1. **Phase 1(先行)**: 编辑器手动删除 —— 移动端已有按钮占位
   (`EditView.tsx` 一级工具栏"删除"格,现只弹"即将上线"),桌面端新增选中页删除。
2. **Phase 2(后行)**: 设计 Agent 对话删除 —— `delete_page` 写工具。
   **前置**: `docs/plans/2026-08-03-draft-pages-split.md` Task 6
   (`persistDesignChat` 切行级写)完成。在那之前 agent 写路径落 legacy
   `draftJson.pages`,对已播种行的相册改动会被 `loadStoryDraft` 无视、静默丢失。

两期串行的理由: Task 6 要改的 `job-service.ts` 正被拆表计划 Task 5 在途占用,
删页工程不抢跑; Phase 1 完全建立在已落地的 draft_pages 基建上,立即可交付。

## 语义契约(两条路径共享)

| 议题 | 决策 |
|---|---|
| 可删范围 | 只删**内页**(`category === "interior"`,含双宽页);封面/目录/封尾拒绝 |
| 页上照片 | **随页移除,不回流**,无"未使用照片池" |
| 下限保护 | 拒绝删到内页数为 0 |
| 翻面提示 | 删普通内页 → 确认弹窗附提示「后续页面左右位置将互换」;删双宽页(净减 2 个页位,后续不移位)→ 普通确认,无翻面提示 |
| 页数收口 | 每次删除更新 `albums.pageCount`(拆表后与页行分离,页数变化写点必须显式收口) |
| 状态回退 | `COMPLETED → EDITING`(与 `updatePage`/`reorderPages` 同款:导出即完成、不锁编辑) |
| 撤销 | 不做。确认弹窗防误触,删了就是删了 |

### 翻面问题(为什么要提示)

`placePages`(`apps/web/src/components/album/page-layout.ts:27`)是左右页配对的唯一
真相:内页顺序两两配 left/right,cover/ending/双宽模板独占一格并重置配对。删一张
普通内页净减 1 个页位 → 后面所有内页左右互换,直到下一个 solo/双宽页吸收;删一张
双宽页净减 2 → 后面纹丝不动。相册是装订实物,翻面对用户是可感知的意外,故知情确认,
不阻止。

## Phase 1 — 手动删除

### Service

`albumService.deletePage(userId, albumId, pageIndex)`,照抄 `reorderPages`
(`album-service.ts:1440-1523`)的事务骨架:

1. `albumRepo.findByIdForUpdate`(album 行锁)
2. `ensureDraftPagesSeeded`(锁内、行级写之前;`bumpDraftRevision` 吃它的返回值,
   不吃 `latest.draftRevision` —— 理由见 `album-service.ts:1327-1332` 注释)
3. `loadStoryDraft({tx, bake: false})` 取当前 pages
4. 校验: `pageIndex` 存在;该页模板 `category === "interior"`,否则拒绝;
   删后内页数 ≥ 1,否则拒绝
5. 过滤该页,余页 **`pageIndex` 重排 0..n-1 连续**(与 `reorderPages` 显式重写
   `pageIndex: newIdx` 同口径;PK `(albumId, pageIndex)` 也要求连续无洞)
6. `bumpDraftRevision` → `draftPageRepo.replaceAll`(delete-then-insert,原地逐行
   update 会撞 PK 唯一约束)
7. `albumRepo.update`: `pageCount` 收口 + `COMPLETED → EDITING`

v1/v2 遗留相册(`albumPages` 表)走与 `reorderPages` 同构的双路径分叉
(`hasDraft ? draft_pages : albumPageRepo`,`album-service.ts:1459-1462`);
不静默走错分支。

封面缩略图: 删页拒绝封面,第 0 页内容不变,但 album `updatedAt` 变化会使旧
`coverThumbnailRevision` 签名自然失效 —— 这正是 CAS 的既有语义(旧签名不能覆盖
新状态),不需要额外处理,也不清 `coverThumbnailUrl`。

### API

`apps/web/src/app/api/v1/albums/[uuid]/pages/[idx]/route.ts` 新增 `DELETE` 导出
(文件已有 `PATCH`)。错误码沿用 service 层 `ERRORS.VALIDATION_FAILED` 一族,
删最后一张内页/删非内页给可读的中文文案。

### 移动端

- `MobileEditorRoot.tsx:784` 的 `onDeletePage={() => soon('删除页面', ...)}` 换成
  真实现: 确认 sheet(沿用现有 sheet/modal 范式)→ 调 `DELETE` → 成功后整体替换
  本地 pages(与 `ReorderSheet` 成功路径同机制)。
- 翻面提示按当前页类型条件显示(普通内页显示,双宽页不显示)。
- 当前页非内页(封面/目录/封尾)时,工具栏"删除"格置灰。
- `MobileStrip` / `ReorderSheet` 以 `pages.length` 建索引与 `identity` 数组,
  页数变化后必须随新 pages 重新初始化,不残留旧 order。

### 桌面端

- 入口: 选中页(`selectedPageIndex`,`EditorPort.tsx:1957`)的页级工具栏加
  "删除此页"(页背景色操作同款挂点),未选中或选中非内页时不可用。
- 确认弹窗同款翻面提示。
- 乐观更新: 先本地删 + `replacePages`(`EditorPort.tsx:4887`,整体替换,不假定
  页数不变)+ `rebuildSpreads()` + `repaintBook()`,失败回滚到旧引用 + alert
  (照 `confirmPageReorder` `EditorPort.tsx:2860-2888` 的模式)。

## Phase 2 — 对话删除(前置: 拆表计划 Task 6 完成)

### 工具契约 `delete_page(pageNo)`

- `pageNo` — 用户口径页码(`resolvePageUserRef`,`book-state.ts:188`:内页 1..M,
  封面/目录/封尾用类别名)。传 `"cover"`/`"toc"`/`"ending"` 直接拒绝。
- 校验同语义契约;任一不过则整体拒绝,不落库。
- 单次 `commitWrite`(`tools.ts:905-925`): `version += 1` + `setBookState` +
  `terminate: true`,要么整个完成、要么一页没动。
- 返回: 删除确认 + 剩余内页数,供 AI 组织回复;AI 需口头告知翻面效应
  (system-prompt 约定)。

### pageIndex 口径定案

旧 spec「全书重排 pageIndex」与 `move_pages` 的「保留输入数组顺序、不改
`pageIndex`」(`book-state.ts:94-101`;`album-move-pages-tool.test.ts:48-50`
断言逐字节不变)冲突。定案:

- **agent 侧不改**余页的 `pageIndex` 字段(与 `move_pages` 同口径 —— 真实管线的
  `pageIndex` 按章节计数、会重复,agent 无权重写)。
- 落库行位置由 Task 6 后 `persistDesignChat` 的 `replaceAll` 按数组位置决定。
- Web 手动路径则显式重排(与 `reorderPages` 一致)。两边口径在各自世界内自洽。

### 实现落点

- `packages/design-agent/src/core/album/tools.ts`: `createDeletePageTool` 工厂,
  注册进 `createAlbumTools`(`tools.ts:183-197`)。纯逻辑放 `page-move.ts` 旁
  (新建 `page-delete.ts`),样板参照 `createMovePagesTool`(`tools.ts:808-877`)。
- 接线四处(前三处 CLAUDE.md 点名,漏了历史回放丢更新):
  1. `apps/web/src/app/api/v3/albums/[uuid]/design-chat/route.ts` 的
     `DESIGN_WRITE_TOOLS` 补 `delete_page`
  2. `apps/web/src/components/album/editor-v2/chat-history.ts` 的
     `DESIGN_CHANGE_CATEGORY` 补 `delete_page → 'pages'`
  3. `apps/web/src/components/album/editor-v2/mobile/use-design-chat.ts` 的
     `TOOL_LABEL` 补移动端进度文案
  4. `packages/design-agent/src/core/album/system-prompt.ts`: 删页语义
     (「合并/挤一页」≠「删掉」,模棱时反问)、翻面效应告知、封面/目录/封尾不可删

## 测试

Web(`cd apps/web && pnpm test`):

- 删普通内页: 行数 -1、`pageIndex` 连续、`pageCount` 收口、所有行 `version` == 新
  revision、`COMPLETED → EDITING`
- 删双宽页: 同上
- 拒绝: 删封面/目录/封尾、删最后一张内页、`pageIndex` 越界 —— 均不落库
- legacy 相册(只有 `draftJson.pages`)首次删除: 懒播种后删除成功
- 渲染安全: 删双宽页、删奇偶位内页后 `buildSpreads` 不 throw
  (`spreads.ts:63` 的不变式)

design-agent(Phase 2,`cd packages/design-agent && pnpm test`):

- 图片随页消失、后续用户口径页码顺移、删到最后一张内页拒绝、余页序列化逐字节不变
  (pageIndex 口径)、`album-contract-parity.test.ts` 纳入 `delete_page`

验证陷阱(CLAUDE.md): 仓根 `pnpm test` 撞第一个失败包就中断;改到
`apps/web/src/app/api/**` 或 `packages/design-agent/src/web/**` 要更新对应文档
`doc-scope: checked-at`(`pnpm docs:check` 会拦)。

## 明确不做(YAGNI)

- 撤销 / 回收站 / 软删除
- 批量删除
- 照片回流到其他页 / 「未使用照片池」
- 删封面 / 目录 / 封尾
- 合并页
- `split_page` 拆页(依赖 engine 分页按跨页为单位,见旧 spec 顶部警告,另开)
