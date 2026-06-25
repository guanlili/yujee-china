# 设计：`group_pages` —— AI 按效果重分章内页

- 日期：2026-06-25
- 状态：设计已获批（待用户复审 spec）
- 范围：agent 管线新增一步，把"章内照片→页"的分组权从确定性代码挪给 AI（确定性当参考 + 兜底）

## 背景与问题

当前 V3 管线（§8.3"模型出意图、确定性引擎保合法"）里，章内"照片→页"的分组是**确定性代码**定死的：`template_select.plan_pages` 调 `skeleton_v3.partition_photos_v3` 按 `max_capacity(interior)` 切块，每块=一页；模型**只**为已切好的页挑 `templateId`，无权改分页（`plan_pages` 注释："select-template 只改用哪个模板，绝不改照片怎么分页"）。

问题：分组被代码按容量切死，不按画面效果。新模板把 interior 最大容量顶到 9（mag-48）后，10 张照片被切成 `[9,1]`（一页塞 9 张 + 1 张孤页），不合道理。

确定性容量约束应当是**"用户的分寸 / 给 AI 的参考"**，AI 最终应**按它识别出的效果分组**，并可在初步分组之外**再拆分**。

## 目标

- 新增一个 AI 分组步，按视觉/语义效果把章内照片分页。
- 确定性 `partition_photos_v3` 降为**参考基线 + 兜底**，不再是唯一真相。
- 容量上限（`max_capacity(interior)`）作为**硬护栏**保留。
- 预览永不崩：任何模型失败/非法输出 → 回退确定性基线。

## 非目标（本期不做）

- **不跨章分组**：章边界由 analysis 决定，本步只在章内重分页。
- **不重发原图**：纯文字信号（隐私 §3 不破）。
- **不打乱照片顺序**：相册是时间顺序回忆录，AI 只决定"在哪切页"，各页内及跨页保持原序。
- 不改 Web↔Agent 外部契约。

## 架构与数据流

```
flows/analyze.py:
  analysis(章节) → 〔新〕group_pages(章节)→章内分组 → select_template(章节, 分组)→页 → 文案/颜色…
```

新建 `apps/agent/src/agents/group_pages/`，沿用现有 agent 三件套：
- `handler.py` —— 编排：算基线、拼 prompt、调模型、校验、兜底。
- `group_pages.md` —— system prompt（按效果重分页的规则 + 护栏说明 + JSON 输出格式）。
- 复用 `ai_client.chat_completion` + `vision_provider`（纯文字，slot 策略同 select_template：主 OpenAI、failover 火山）。

## 这一步做什么（每章独立）

1. **算确定性基线**：`partition_photos_v3(chapter.photos)` → 基线分组（给 AI 当参考，也是兜底）。
2. **拼纯文字 prompt**，每张照片喂：`photoId` + `sceneDescription` + `orientation` + `takenAt`（时间间隔是天然分页断点）。注：`V3ChapterPhoto` 不带 `quality`（quality 在分析输入节点，不在章节树），故分组信号不含 quality。附上：基线分组、每页上限 `max_capacity(interior)`、指令"按画面效果/连贯性重分页；每页 ≤ 上限；保持原顺序；每张照片恰好出现一次；倾向避免孤页"。
3. **模型返回分组**：`{"pages": [["p1","p2"], ["p3"], ...]}`（每页是按序 photoId 列表）。

## 确定性护栏（沿用 §8.3）

新增 `skeleton_v3.validate_grouping(grouping, chapter_photo_ids) -> bool`，校验：
1. **不丢不重**：所有页并集 == 本章全部 photoId 集合，无重复。
2. **保顺序**：各页按序拼接 == 本章原始 photoId 顺序（即每页是原序的连续切片，且页间相接）。
3. **容量合法**：每页 1 ≤ 张数 ≤ `max_capacity(interior)`。

校验通过 → 采用 AI 分组；**任何不合法 / 模型失败 / provider 缺失 / 响应不可解析 → 回退确定性基线**。

## 与 template_select 的衔接

`group_pages` 产出"每章的页分组（photoId 块列表）"。`template_select.plan_pages` 改为**消费传入的分组**，不再自己调 `partition_photos_v3`；其余（合法候选 `legal_candidates`、模型挑 templateId、逐页 fallback）不变。`flows/analyze.py` 在调 `select_template_pages` 前先调 `group_pages`，把分组传下去。

## 契约影响

- **外部（Web↔Agent）契约零变化**：最终仍输出原 `Page` 结构（pageIndex/templateId/images/texts）。
- 内部新增一步 + `plan_pages` 入参从"章节"扩为"章节 + 分组"。

## 隐私 / 成本

- 纯文字（§3 不破，无 base64/GPS）。
- 每章一次轻量文字调用；模型关闭/失败时行为 == 当前确定性分页（回归安全）。

## 测试（TDD）

- **validator 单测**：合法分组通过；丢失/重复/乱序/超容量/空页 → 拒。
- **handler 单测（mock 模型）**：合法响应被采用；非法响应 → 兜底基线；模型报错/无 provider → 兜底基线。
- **回归**：模型关闭时，`group_pages` + `plan_pages` 的分页结果 == 当前 `partition_photos_v3` 的分页（保证不改既有确定性行为）。
- **集成**：analyze flow 端到端仍产出合法、连续 pageIndex 的页，照片不丢不重。

## 风险与回滚

- 上线当天改 agent 管线，风险偏高（已与用户确认、用户授权接受）。
- 回滚简单：`group_pages` 失败即自动走确定性基线；若整步要禁用，flows 里跳过该步即等价于当前行为。
- 部署：本改动在 agent，需手动重部署 Fly（与本次模板/契约改动一起）。
