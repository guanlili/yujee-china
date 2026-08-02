# 页面顺序调整弹窗(拖拽插入重排)设计

- 日期: 2026-08-02
- 影响面: `apps/web`(editor-v2 桌面 + mobile;新共享弹窗组件与纯逻辑;
  旧点选式整页交换模式退场)。**后端零改动**。
- 现状: 2026-08-01 设计上线了点选式整页交换(桌面画布「调整页序」模式 +
  移动端预览栏选中→点目标),当时明确"不做任意拖拽排序/插入,只做交换"。
  本设计**推翻该非目标**:用户拍板要拖拽插入重排,接受"单页插入使下游
  所有页左右翻面"的装订学后果(弹窗内的实时页码/左右角标把这个后果如实
  展示给用户,见 §3)。

## 已定决策(用户拍板)

| 议题 | 决策 |
|---|---|
| 拖拽语义 | **拖到缝隙 → 插入重排**(非对调) |
| 适用端 | 桌面 + 移动端,**各自的弹窗**(两端弹窗规范不同,不共用组件;共享的只有纯逻辑与缩略渲染缝) |
| 移动端入口 | 主菜单(MoreSheet「更多」)新增「调整页面顺序」条目 |
| 桌面入口 | 工具栏原「调整页序」按钮改为打开弹窗 |
| 保存时机 | 弹窗内只改本地工作序;点「完成」合成**一个**置换、发**一次** reorder;取消/遮罩/Esc 直接丢弃,**不加二次确认** |
| 旧点选式交换模式 | 两端 UI 接线全部退场,弹窗成为唯一页序入口 |
| `page-swap.ts` | 退场后无人引用 → **连同测试一并删除**(不留死代码) |

## 一、数据层 —— 零改动

`POST /api/v1/albums/[uuid]/pages/reorder` 现状即可用:
[album-service.ts:1422](../../apps/web/src/services/album/album-service.ts) 的
`reorderPages` 只校验 ① 置换是 0..n-1 完整双射、② 锚定页(cover/toc/ending
类目)不许移位;**没有"只许对调"的限制**,任意插入置换天然合法。
`COMPLETED → EDITING` 降级、置换触及 index 0 时清封面缩略图、分享/PDF
派生物走既有失效路径,全部不动。端点及其测试保留。

## 二、共享纯逻辑 `page-reorder.ts`(新,零 DOM)

与 `image-swap.ts` 同级,node 直测,移动端"不许碰 document"的子树可照用:

- **锚定区识别**:头部连续的 cover/toc 记录 + 尾部连续的 ending 记录为锁定区,
  中间为可拖的内容区。防御性通则:一次移动合法 ⇔ 不使**任何**锚定记录的下标
  变化(即便锚定页意外出现在书中间,也不会被平移殃及)。
- `legalGaps(pages, fromIndex) → number[]`:拖起工作序第 `fromIndex` 条记录时,
  所有合法插入缝隙。缝隙 g 一律指**工作序**里的位置("插到当前第 g 条之前",
  取值 0..n),与记录携带的原始下标无关。
- `applyMove(order, from, gap) → number[]`:工作序列变换。`order` 存**原始
  下标**(打开弹窗那一刻的 0..n-1),弹窗内连拖多次都只变换这个数组。
- `buildInsertPermutation(order) → number[] | null`:`perm[newIndex] = oldIndex`
  (与 reorder 端点 body 语义一致);恒等置换返回 null,调用方零请求短路。
- `gapFromPointer(cellRects, legalGaps, x, y) → number | null`:指针坐标 →
  最近合法缝隙的几何计算。DOM 侧只负责量 rect 和画插入条,判定全在纯函数里。

双宽页(full)在插入语义下就是**一条普通记录**,无需块单位概念;配对由
`placePages` 顺序贪心重推,单边尾巴(奇数内容页)是布局本来就容忍的形态。

## 三、两端各自的弹窗(不共用组件)

两端弹窗规范不同,**不做共享弹窗组件**——这也贴合仓里"移动端与桌面是两棵
独立 UI 树,不共享任何 UI/DOM/手势"的既定架构(page-face.tsx 头注)。两端
共享的只有:§二的纯逻辑 `page-reorder.ts`(工作序/缝隙/置换/指针几何全在
这里,两端零重复)和缩略渲染缝 `pageFaceHTML`(页面真相 = HTML,与预览栏/
画布同一渲染)。

**两端一致的行为语义**(实现各写各的,语义必须对齐):

- 网格:全书缩略图按工作序排列换行、纵向滚动;单页 A4 比例,双宽页占
  双倍宽;封面/目录/封尾压暗 + 锁标,不可拖起、不响应指针。
- 实时角标:每次落下后按工作序用 `pageFolioNumbers` / `pageFolioSides`
  (page-html-dom 既有导出)重算展示页码与左右归属;角标贴在缩略图
  **左下 = 左页、右下 = 右页**,用位置本身告诉用户"插入后下游翻面了"。
  缩略图内部 HTML 里烙死的旧页签不重渲(缩略尺寸下不可辨,提交后全书
  repaint 自然更新)。
- 拖动中:幽灵缩略图跟随指针,源格压暗;最近**合法**缝隙显示插入条,
  指针落在非法区(锁定区内/源位置本身)无插入条;贴近网格上下边缘自动滚动。
  松手:有合法缝隙 → `applyMove` 更新工作序重排;无 → 原位弹回,零变化。
- 「完成」:`buildInsertPermutation` 恒等 → 直接关窗零请求;否则乐观提交
  (本地按置换重排全书 + 关窗 + POST reorder;失败回滚 + 提示),与被删的
  swap 提交同口径。提交前若发现当前 `pages.length` 与打开时不一致(外部
  改动),提示后关窗不提交——服务端双射校验反正也会拒。
- 「取消」/点遮罩/Esc(桌面):直接丢弃,不加二次确认(用户拍板)。

### 3a. 桌面 `PageReorderModal.tsx`(editor-v2/)

- 弹窗壳走桌面既有规范:`.modal-overlay` / `.modal-card`(同
  CreditsPurchaseModal 一族),网格区样式在 `editor-port.css` 新段
  (`.preorder-*` 前缀);React `useState` 挂载。
- 手势只做鼠标口径:按下后移动超 8px 立即拾起(对齐 763fecb6"按住一拖
  立即拾起"的既定手感;弹窗内没有 pan 竞争,无需长按仲裁)。pointer events
  + `setPointerCapture`,不用 HTML5 DnD。
- 缩略宽 ~120px,Esc 可关。

### 3b. 移动端 `ReorderSheet.tsx`(mobile/modals/)

- 弹窗壳走移动端既有规范:`ModalHost` 宿主 + `mobile/modals/` 目录族,
  布局样式进 `mobile-editor.css`;子树守则照旧——不碰 `document`,状态住
  容器层。
- 手势只做触屏口径:长按 350ms 拾起(对齐全仓 `SWAP_LONG_PRESS_MS`;期间
  移动超 8px 取消计时回落滚动,不劫持网格滚动)。
- 缩略宽随屏幕自适应(约 3-4 列),无 Esc 语义,点遮罩/「取消」丢弃。

## 四、两端接线

**桌面(EditorPort)**:

- 工具栏按钮 `pageSwapBtn` 改为 `data-action="openPageReorder"`,打开
  `PageReorderModal`(tooltip 文案沿用「调整页序 / Reorder pages」)。
- `onCommit(perm)`:复用现有整体替换路径——按置换重排本地 pages、
  `replacePages` + 全量 `repaintBook`(对齐"图片/整页交换刻意不走 dirty-page
  快路径"的先例),POST 失败回滚 + 提示。

**移动端(MobileEditorRoot)**:

- MoreSheet 新增「调整页面顺序 / Reorder pages」条目;MobileEditorRoot 持
  `open` 态,渲染 `ReorderSheet`。
- `onCommit(perm)`:`setPages` 乐观重排 + POST + 失败回滚 + `say` toast
  (沿用被删的 `commitPageSwap` 的口径,函数体迁移改造)。

## 五、旧模式退场(删码清单)

- 桌面 `EditorPort.tsx`:页序模式整块(约 :2764-2860 状态机 + :3516 Esc +
  :2656/:2758 画布手势守卫 + :5552 action 映射);按钮保留但语义换成开弹窗。
- 移动端 `MobileEditorRoot.tsx`:`pageSwapOn/pageSwapSel` 状态、
  `pageSwapTargetUnit/pageSwapFaceState/commitPageSwap/onPageSwapPick`
  (约 :468-531)及向下透传;`MobileEditor.tsx` 上的旧模式切换按钮(:608)
  删除——移动端唯一入口在主菜单;`MobileStrip.tsx` 的 `pageSwap` prop 与
  三态渲染删除。
- `page-swap.ts`、`page-swap.test.ts`、`page-swap-wiring.test.ts`:删除
  (退场后无人引用,不留死代码)。
- i18n:`pageSwapFailed` 等旧串按引用情况清理,新增弹窗文案串。

## 六、测试

- `page-reorder.test.ts`(纯逻辑):锚定区识别(含书中间出现锚定页的防御
  用例)、`legalGaps` 边界、`applyMove` 连拖复合、置换双射性与
  `perm[newIndex]=oldIndex` 语义、恒等短路、`gapFromPointer` 几何。
- 接线测试(source-regex 风格,对齐仓内先例,两端各测各的):桌面按钮开
  `PageReorderModal` 且旧模式代码不复存在;MoreSheet 有新条目、
  MobileEditorRoot 渲染 `ReorderSheet`;MobileStrip 无 pageSwap 残留;
  两端「完成」都只发一次 reorder、「取消」零请求;两端手势口径各自验证
  (桌面 8px 即拾、移动端长按 350ms)。行为语义的一致性靠共享纯逻辑保证,
  不靠复制组件。
- 验证命令:`pnpm --filter @yujee/web test`;涉及文档核对后跑 `pnpm typecheck`
  (含 docs:check)。

## 边界与非目标

- 不做弹窗内的对调手势(插入已覆盖重排诉求;要"互换"就拖两次)。
- 不做跨弹窗的撤销栈(「取消」即整体回退;提交后要改再开一次)。
- 不动 engine 选版对 spread 模板的无知问题(另案,见
  2026-07-30-engine-spread-pagination-design.md)。
- 不新增派生物失效逻辑(reorder 端点既有降级路径已覆盖)。
