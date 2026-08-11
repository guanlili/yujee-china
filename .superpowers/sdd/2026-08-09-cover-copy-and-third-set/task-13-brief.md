# Task 13: 新封底模板 mag-63 —— 彩色底 + 左下字标 + 右下条形码

## 由来

原计划这条是「两个新封底版式」,一直卡在等设计。稿子已定,而且只需要**一个**版式:
一份几何吃四个色(所有元素走 `currentColor`,深底自动翻浅、浅底自动压深)。

用户在两个变体里选了 **A —— 只有 logo 和条形码,没有任何文字槽**。

## 定稿规格

页面 794 × 1123,实底铺满。**没有照片,没有文字槽。**

| 元素 | 规格 |
| --- | --- |
| 品牌字标 | `left:56px; bottom:96px`,宽 132px(高按比例 ≈55px) |
| 条形码 | `right:56px; bottom:96px`,130 × 38,与字标底边对齐 |
| 小字 `YUJEE · 2026` | `right:56px; bottom:142px`,宽 130 右对齐,10px,字距 2.5px,透明度 .5 |

字标用 **`mag-22.ts` 里那份内联 SVG**(task-15 已把它从 base64 换成内联并改成
`fill="currentColor"`)。**直接复用那份矢量,不要手打文字冒充,也不要重新描一遍** ——
用户为此明确纠正过一次。把它的定位/尺寸换成上表的值即可。

条形码是**纯装饰**,不编码任何信息。用确定性的粗细序列画竖条(不要随机 —— 同一本书每次
渲染必须一样),整条跟随页面墨色。参考实现(预览稿用的就是这个序列):

```
widths = [3,1,2,1,1,4,1,2,3,1,1,2,4,1,3,1,2,1,1,3,2,1,4,1,2,3,1,1,2,1]
条宽 = w / Σ(width + gap),gap = 2 个单位,偶数下标画条、奇数下标留白
```

也可以用别的画法,只要:确定性、纯 `currentColor`、130 × 38 的盒子里、看起来像条形码。

## 「没有文字槽」的连锁后果 —— 必须一起处理

AI 每次成稿都会写一句封尾结语(`endingTexts`)。这个模板没有槽,那句话**没有地方落**。
用户已知情并接受(这正是选 A 的代价),但**不能让它继续白烧模型调用**:

- `slotSpecs(endingTemplateId)` 对这个模板天然返回 `[]`,所以 `endingSlots` 自动为空 ——
  这部分不用改代码,**先自己验证确实如此**。
- `engine/src/workflows/core/compose/compose_global.md` 里有一条规则:
  「封尾页是全书收束:一句留白式的结语,呼应全书情绪,不要"全剧终"式套话。」
  当 `endingSlots` 为空时这条指令是死的。**判断要不要改 prompt**:如果模型仍会因为这条
  规则产出无处可落的内容、或因此浪费 token,就把它改成条件化表述;如果 `endingSlots: []`
  已经让它自然失效(输出的 `endingTexts` 是空对象),那就不动,并在报告里说明你验证的方式。
  **不要凭感觉决定,去读 `handler.py` 的 `_slot_texts` 和载荷构建逻辑。**

## 硬约束

- 页面几何 794×1123,绝对定位,写死 px,镜像现有模板的写法。
- **`&quot;` 必须原样保留** —— 它在双引号包裹的 style 属性里,解码会截断属性、整段
  font-family 失效。本仓踩过。
- `templates.generated.ts` 是产物,改了 JSON 必须 `pnpm --filter @yujee/contracts templates:generate`,不要手改。
- 渲染注册表唯一真相是 `apps/web/src/components/album/web-registry.ts`,不建第二套。
- 注释中文,密度语气跟周围走。
- doc-scope:`packages/contracts/templates/README.md` 覆盖 `render/html-templates/**`,
  会被触发,单独一个提交推 `checked-at`。`docs:check` 现在是绿的,保持绿。

## 预料中的坑

**这个模板图槽和文字槽都为零,全仓没有先例**(mag-20 是零文字槽但有 1 个图槽;
mag-02/mag-10 是零图槽但有文字或 items)。可能撞上:

- `templates:check` / `validateSlotsForTemplate` 的槽位校验
- `assembleDesignedPages` 组封尾页时 `endingSlotIds` 为空(应当天然产出 `images: {}`,验证它)
- skeleton golden fixtures(加模板会变动选版池 —— 但 ending 不参与内页选版,理论上不动;
  真动了要判断是真漂移还是算法被影响,不要直接改 fixture 让它变绿)

撞上任何一条,**先判断是「校验本来就该放行这种模板」还是「这种模板确实不合法」**,再动手。
如果结论是后者,停下来报告,不要自己给模板硬塞一个用不到的槽。

## 不在本任务范围

- **不要动 `SET_LAYOUT`。** 哪几套指向这个新封底是另一个待定项(用户还没答),
  由控制方在你之后单独接线。你只负责把模板做出来、注册好、验收通过。

## 验收

1. `pnpm --filter @yujee/contracts test` + `templates:check`、`cd apps/web && pnpm test`、
   `pnpm typecheck` 全绿。
2. **截图**:四个底色各出一张(深墨绿 `#12363A` / 奶黄 `#F9EDC4` / 粉 `#F0A4C2` /
   深蓝 `#0E2A47`),外加一张近白底(`#FFFFFF`,验证浅底上字标和条形码自动压深)。
   五张图放进工作区目录,报告里给路径。深底上字标必须清晰,浅底上必须是深色。
3. 对照定稿预览 `/Users/smalldog/Desktop/封底-选A还是B.html` 的「变体 A」那张,
   几何应当一致。
