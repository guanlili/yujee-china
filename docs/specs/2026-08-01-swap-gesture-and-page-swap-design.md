# 图片交换手势统一长按 + 整页交换设计

- 日期: 2026-08-01
- 影响面: `apps/web`(editor-v2 桌面 + mobile、pages API 新端点、album-service)、
  `packages/contracts`(如需导出 reorder 请求 schema)
- 现状: `bf899f76` 引入拖拽交换图片后,桌面版鼠标"拖动调整照片裁切位置"(pan)被
  交换手势整体劫走;整页交换功能不存在。

## 一、手势统一:交换一律长按拾起

### 冲突根因(桌面)

pan 与交换的监听器绑在同一元素([EditorPort.tsx:3147](../../apps/web/src/components/album/editor-v2/EditorPort.tsx)
与 :3156)。鼠标路径的交换是 `immediate`(移动超 8px 立即拾起,:2432),拾起时
`beginSwapDrag` 清掉选中态 → pan 的 `if (!dragging || !imgEdit)` 守卫失效。
净效果:选中照片后拖动,前 8px 在 pan,之后手势被交换接管 —— **桌面鼠标 pan 已死**。
移动端无此问题(长按 350ms 计时,期间一动就取消计时继续 pan)。

### 已定决策

| 议题 | 决策 |
|---|---|
| 分流方式 | **鼠标与触屏统一走长按 350ms 拾起**(用户选定,弃"选中态分流"与"修饰键"方案) |
| 长按期间移动超 8px | 取消计时器,回落普通手势:选中照片 → pan;未选中 → 画布原有行为 |
| 长按满 350ms(位移 ≤8px) | 拾起进入交换,清选中态,现有幽灵图/目标高亮 UI 不变 |
| 桌面发现性补偿 | 拾起后鼠标指针 `grabbing`;悬停可拾起的照片时 `grab` |
| 移动端 | 行为不变(本来就是长按) |

### 改动点

1. `image-swap.ts`:常量不变(`SWAP_LONG_PRESS_MS=350`、`SWAP_LONG_PRESS_SLOP=8`),
   无需改动。
2. `EditorPort.tsx` 交换接线(:2419-2494):删除 `immediate = e.pointerType === 'mouse'`
   分支,鼠标与触屏同走长按计时;移动超 slop 取消计时(对齐移动端
   `EditView.tsx:451` 的既有逻辑)。
3. pan 复活验证:选中照片后拖动全程走 `onImgPointerDown/Move/Up`,不再被交换打断;
   滚轮缩放不受影响。
4. 指针样式:悬停 `grab` / 拖拽中 `grabbing` —— 实施时发现 #168/bf899f76 已把这两条
   写进 `editor-port.css`(`.page-selected img[data-image-slot]` 与 `.swap-dragging`),
   无需改动。

## 二、整页交换

### 交换单位与合法目标

页面配对由 `spreads.ts` 的 `pair`/`full` 判别联合推导(顺序贪心扫描,
单一真相 `placePages`)。交换以**页记录块**为单位对调,块内记录相对顺序不变:

| 选中 | 合法目标 | 数组操作 |
|---|---|---|
| 单页(pair 的一侧) | 任何其他单页(左右互换允许) | 1 条 ↔ 1 条,原地对调 |
| 跨页大页(full) | 其他跨页大页 | 1 条 ↔ 1 条,原地对调 |
| 跨页大页(full) | 一整个对页(pair 两侧作为整体) | 1 条 ↔ 2 条,块对调 |
| 封面 / 目录 / 封尾 | 不可选、不可作为目标 | — |

**大页↔对页的块对调会使夹在两块之间的所有页 pageIndex ±1**,但配对是顺序贪心
扫描,块整体互换后中间各 pair 成员依旧相邻 → 左右归属不乱(已推演验证)。
单↔单、大↔大只动两条记录。

交换搬移**整条页记录**(templateId/images/texts/imagePos/html 全部跟走),与图片
交换只动 `imagesJson` 的语义刻意不同 —— 整页交换是页的位置变了,页内一切不变。

### 章节

页与章节的关联是从页面引用的照片反推的
(`chapterIdForDraftPage`,[album-service.ts:238](../../apps/web/src/services/album/album-service.ts)),
没有按 pageIndex 持久化的章节数据。整页交换照片跟页走,章节推导自动跟随,
无需同步任何东西。跨章交换是用户主动行为,chips 顺序如实反映新页序。

### 数据层:原子 reorder 端点

现有逐页 PATCH(`pages/[idx]`)**表达不了整页交换**:body 不收 templateId/html,
且块对调涉及多页平移,逐页写既不原子又会在中间态撞 html 逐笔 patch 的语义。

新端点 `POST /api/v1/albums/[uuid]/pages/reorder`:

- body: `{ permutation: number[] }` —— 新页序,`permutation[newIndex] = oldIndex`,
  必须是 0..n-1 的完整置换(服务端校验长度与双射性)。
- 服务端在事务 + 行锁内(同 `updatePage` 的锁序):
  - draft 路径:按置换重排 `draftJson.pages`,重写每条 `pageIndex = 0..n-1`。
  - 无 draft 的存量路径(album_pages 行):同一置换重写各行 pageIndex。
  - 校验:置换不得移动 cover/toc/ending 类目页(服务端二次把关,不只靠前端置灰)。
  - `COMPLETED → EDITING` 降级、防御性地在置换触及 index 0 时清封面缩略图,
    对齐 `updatePage` 现有约定(封面被排除后正常不会触及)。
- 前端构造置换而非在前端手搓数组写回,交换语义(块的计算)留在共享纯模块。

### 共享纯逻辑 `page-swap.ts`(新,零 DOM)

- `swapUnitOfPage(spreads, pageIndex) → { kind: 'single'|'full'|'pair'; pages: number[] } | null`
  (cover/toc/ending → null)
- `canSwap(a, b)`:single↔single、full↔full、full↔pair
- `buildSwapPermutation(pageCount, unitA, unitB) → number[]`
- 与 `image-swap.ts` 同级,配套单测覆盖:单↔单、大↔大、大↔对页(含中间页平移)、
  非法组合拒绝、置换双射性。

### 交互(桌面与移动端同一状态机)

「选中 → 点目标」,不占用拖拽手势(总览画布的平移/缩放不受影响):

1. 入口:桌面总览工具栏「调整页序」按钮;移动端页面导航条(MobileStrip)区域菜单。
2. 进入模式后:点第一页 → 该页单元描边选中(pair 目标以两页整体描边);合法目标
   保持原亮度,非法目标压暗。
3. 点合法目标 → 立即交换:调 reorder 端点,成功后整体刷新页面数据
   (`replacePages` 已支持整体替换)并全量 `repaintBook()`(对齐图片交换
   刻意不走 dirty-page 快路径的先例);保持在模式内可连续交换。
4. 点选中页本身取消选择;Esc / 再点按钮退出模式。请求失败 → toast + 状态回滚,
   不留半交换态。
5. 交换模式内禁用照片级手势(选照片/pan/图片交换),退出后恢复。

### 测试

- `page-swap.test.ts`:纯逻辑全覆盖(见上)。
- reorder 端点:置换校验(长度/双射/固定页)、draft 与 album_pages 两路径、
  EDITING 降级。
- 接线测试(对齐 `image-swap-wiring.test.ts` 的 source-regex 风格):桌面无
  `immediate` 鼠标分支、长按计时器在移动超 slop 时取消、交换模式的进入/退出。

## 边界与非目标

- 不做任意拖拽排序/插入,只做交换(用户明确"交换位置")。
- 不做 pair↔pair 的整体交换(等价于两次单↔单,不加规则)。
- 不动 engine 选版对 spread 模板的无知问题(见
  `2026-07-30-engine-spread-pagination-design.md`,另案)。
- 分享/PDF 派生物:走既有 EDITING 降级路径,交换后重新导出即可,不新增失效逻辑。
