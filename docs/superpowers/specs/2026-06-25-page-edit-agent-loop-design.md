# 设计：页级编辑 —— 意图路由 → 专门执行（两段解耦）

- 日期：2026-06-25
- 状态：架构师评审通过（含修订，待实现）
- 范围：当前分支(`fix/chat-mirror-user-language`)新增**页级编辑**环节 `POST /v3/page-edit`。核心：**判用户意图**与**执行（写文案/换排版）**拆成两次不同模型调用、两个专门 prompt；编辑只作用于**聚焦页**；完成度由 **agent 代码**确定性算（AI 的工具）；某章填满时由 AI 询问是否进下一章。

## 背景与问题

`chapter-chat` 是 per-turn 分类器(talk/write/edit)、单章作用域，且：
- 编辑时不把页面**当前 texts** 喂给模型 → "蒙着眼重写"而非润色。
- 一个 prompt 同时"判意图 + 写文案",什么都揉一起 → 难调、易崩。
- 用户在页视图逐页看、点的是"页",但分类器以章为心智。

编辑真实交互是多意图 + 有状态 + 非线性。`feat/unify-all-agent-loop` 的全本书级 loop 全量化会崩；本设计只把"编辑"做成**受控两段式**，留在当前分支。

## 目标

- 编辑**只作用于聚焦页**（chapter-chat 仍负责引导 + 整章写初稿，不变）。
- **判意图与执行解耦**：两次调用、两个专注 prompt。
- 意图：**改文案 / 换排版 / 推进 / 闲聊**。
- 完成度由 **agent 代码**确定性算（复用现有判定、单一实现），作为 AI 读取的工具；AI 只判用户意图、组织话术，不判完成度、不拍板导航。
- per-turn 无状态、死守边界、绝不写坏草稿、卡 <60s。

## 非目标

- 不做全本书级 loop。
- 换图(`set_photos`)不进本环节：段一识别到换图意图 → 归 `talk`、回一句引导（去现有 chapter-chat 的 `editTarget=image` 路径处理）。
- AI 不判机械完成度、不自动推进/导航。
- chapter-chat 的 `edit`/`editTarget` 路径**保留作回滚后备**，但产品上"聚焦页编辑"只走新端点 `/v3/page-edit`（消除 spec 早期"取代 vs 不动"的自相矛盾：**保留、共存、产品只走新端点**）。

## 架构：两段式 dispatch

新增 `apps/agent/src/agents/page_edit/`（**先在 `docs/architecture.md §目录` 登记**再建目录）。新增同步路由 `POST /v3/page-edit`，对齐现有 v3 端点范式：`Depends(require_bearer)` + `sync_endpoint_errors` 包裹，模型失败→502 `AGENT_PLANNING_FAILED`、输出校验失败→422 `AGENT_OUTPUT_VALIDATION`，失败不污染 stage。

### 完成度工具（agent 代码算，确定性）
- `page_filled(page)` := `not _missing_required_texts(单页)` —— **复用 `writing/handler.py` 现有的 `_page_slot_specs` + `_missing_required_texts`**，按 `page.images` 当前键展开 grid/items 槽，全 authored 槽即必填（无"可选槽"概念，与现状一致）。**不得另写判定**。
- `chapter_completion(pages)` := `{chapterId, filled: all(page_filled), pages:[{pageIndex, filled}]}`。
- 派生计算、**不落库**。作为 AI 的工具/上下文喂给段一。

### 段一 · 意图路由（一次"轻"调用）
- 输入：`userMessage` + `history` + 聚焦页精简摘要（现 texts 摘要 + 照片 scene 概要）+ `chapter_completion` 结果。
- 输出 STRICT JSON：`{"intent":"edit_text|change_layout|advance|talk","reply"?:string}`。
  - `talk`：`reply` 作引导回复（含换图引导），不进段二。
  - `advance`：识别用户想推进 → 置 `advanceIntent`、**必带一句确认 reply**，不进段二、不调执行模型。
  - `edit_text`/`change_layout`：进段二。
- **不产出页面内容**。`chapter_completion.filled` 为真且用户无明确指令时，倾向 `talk` 主动问"这章齐了，进下一章吗？"

### 段二 · 专门执行
- `edit_text` → **一次专门写作调用**（写作风格 prompt）：输入=聚焦页全貌（槽位+逐槽 hint、slot→photoId、各照片 scene、**当前 texts**）+ `userMessage`；输出按槽位 maxChars/合法槽校验后落补丁。沿用 chapter-chat 的 DeepSeek 超时。
- `change_layout` → **纯确定性**（无模型调用）：`skeleton_v3.legal_candidates(聚焦页照片数)` 选模板、`assign_images_v3` 按序重排图。模型无法注入非法 templateId。**换版丢弃旧 `imagePos`（显式预期）**。
- `advance` → 置 `advanceIntent=true` + 确认 reply（无执行调用）。
- `talk` → 用段一 reply。

## 请求 / 响应契约（新增；两端 parity）

**`V3PageEditRequest`**（携带聚焦页所属那一章的上下文，供算完成度 + 写作 grounding；agent 只编辑聚焦页）
- `language`
- `chapter`: `V3Chapter`（该聚焦页所属章；含 photos 的 sceneDescription/orientation 等）
- `pages`: `list[Page]`（该章的页，含**当前 texts**）
- `focusedPageIndex`: int
- `userMessage`, `history`

> 复用 `V3ChapterChatRequest` 同形字段，降低新契约面。任何 place/GPS/坐标字段禁止（§3 redact 红线）。

**`V3PageEditResponse`**（复用 `V3LayoutPatchEntry`，不另造补丁形状）
- `assistantReply`: string
- `intent`: 段一判定（可观测）
- `layoutPatch?`: `list[V3LayoutPatchEntry]` —— `edit_text`→一条只含 `{pageIndex, texts}`;`change_layout`→一条 `{pageIndex, templateId, images}`。与 chapter-chat 的 `_coerce_*_patch` 输出同构，web 合并走现有单一 patch 路径。
- `advanceIntent?`: bool（用户想进下一章 → **web 导航**；agent 不导航）
- `usage`: 同其它 v3 端点

两端真相源：`packages/contracts/src/v3.ts` 先行、`apps/agent/src/schemas.py` 逐字段镜像，全 `_V3Strict`/`.strict()`。

## 推进微流程（AI 判意图，不判完成度，不拍板）
1. agent 代码算该章 `filled`。
2. `filled` 时段一倾向主动问"这章齐了，进下一章吗？"。
3. 用户回话 → 段一判意图（推进/还想改/跳别处）。
4. 意图=`advance` → 置 `advanceIntent=true` + 确认 reply → **web 导航**。

## 预算账（硬约束 <60s，contract §2.3）
- `talk`/`advance`：仅段一 1 次 DeepSeek 调用。
- `edit_text`：段一 + 段二专门写作 = 2 次 DeepSeek 调用（各沿用 chapter-chat per-call 超时）。
- `change_layout`：段一 1 次 + 段二纯确定性（0 调用）。
- 整体 `asyncio.wait_for` 包 <60s；超时/解析失败/provider 缺失 → 安全兜底：回保守 `assistantReply`、**零 layoutPatch**、草稿零改动。

## 健壮性（全量版会崩，这版死守边界）
- 段一极薄、易稳；每段失败独立兜底。
- `change_layout` 候选受限 `legal_candidates`、`edit_text` 受限槽位校验——非法即拒、不写坏草稿（§8.3）。
- 复用 `complete=` 注入（测试不打真实模型）。

## 契约影响
- 新增 `V3PageEditRequest/Response`（改 Web↔Agent 协议）——架构师已评审。
- chapter-chat 契约不变。

## 测试（TDD）
- **完成度纯函数**：空/满/混合槽、grid 展开、排除代码槽 → filled 正确；复用 `_missing_required_texts`。
- **段一意图路由（注入 complete）**：四类意图分类；filled 时主动问推进；换图→talk；脏输出→安全兜底。
- **段二**：`edit_text` 产出按槽校验的 patch（越界/非法槽→拒）；`change_layout` 确定性、合法集内重排图、丢 imagePos；`advance` 置标志无执行调用。
- **路由 surface**：`/v3/page-edit` req/res + 两端契约 re-validate + 鉴权 + 错误形状。
- **零回归**：chapter-chat 写初稿/edit 路径不受影响（共存验证）。

## 风险与回滚
- 上线分支加编辑环节，风险偏高（用户确认接受、刻意做小受控）。
- 回滚：任一段失败回安全兜底、不写草稿；整步禁用 = web 不调 `/v3/page-edit`、退回 chapter-chat edit（等价旧行为，**上线前需真实验证此路径**）。
- 部署：agent + 契约改动，需手动重部署 Fly。

## 架构师裁定记录（开放问题）
1. `change_layout`：**纯确定性**，不加模型调用。
2. 多意图：**本期单意图**；有序短 plan 留后续。
3. 完成度：**派生不落库**；由 **agent 代码算**（复用单一实现，请求带同章页）。
4. 端点：**独立新端点 `/v3/page-edit`**；chapter-chat edit 保留作回滚后备。
