# Agent 当前实际运作逻辑与全量操作测试

日期: 2026-06-27;启动修复与文档刷新追加:2026-06-28

内部运行逻辑详版见: [`internal-operation-2026-06-28.md`](./internal-operation-2026-06-28.md)。本文保留为操作测试和启动修复记录。

范围: 本文只记录当前工作区 `memoir-agent-rebuild` 里 Agent 的实际代码行为与本轮本机测试结果。测试时工作树已有本地状态: `main...origin/main [ahead 58]`, 且存在未提交/未跟踪文件;本轮未回滚这些现有改动。

## 1. 当前结论

当前 Agent 不是旧 `/v1/layout` mock pipeline。实际运行面是 FastAPI V3:

- 入口: `apps/agent/src/main.py` 暴露 `src.main:app`。
- 路由: `apps/agent/src/routes.py` 注册 `/health`, `/v3/analyze`, `/v3/select-layout`, `/v3/chapter-chat`, `/v3/edit-chat`, `/v3/page-edit`, `/v3/recommend`, `/v3/apply-theme`, `/v3/cover`, `/v3/finalize`, `/internal/agent-ack`。
- 架构: 异步初始化已经拆成两段: Stage1 `/v3/analyze` 只产出章节树;Stage2 `/v3/select-layout` 再产出版面页。
- Web 仍拥有相册 `draft_json`、stage、积分和最终持久化。Agent 只在 Stage3 `edit-chat` 例外地拥有 `agent.*` schema 下的编辑会话/消息/op 状态。
- 旧 `AGENT_PIPELINE_MODE=mock` 不是 V3 的全局免模型开关。V3 的 `recommend` / `chapter-chat` 仍会在未注入测试 complete 时尝试 DeepSeek 槽;缺 key 时按契约返回失败。`page-edit` 特意做成缺模型也安全降级为 talk。

## 2. 启动与基础约束

Agent 启动时读取 `Settings(env_file=".env")`。这个 `.env` 是相对当前进程工作目录解析的,所以从 `apps/agent` 目录运行测试会加载 `apps/agent/.env`,从仓库根运行则不会加载该文件。

2026-06-28 启动修复:

- 根命令 `pnpm agent:dev` 已改为从 `apps/agent/.venv/bin/uvicorn` 启动,并支持 `PORT` 覆盖:`pnpm agent:dev` 默认 8001,端口被旧进程占用时用 `PORT=8011 pnpm agent:dev`。
- `apps/agent/.env.example` 已补非空本地占位 `AGENT_SHARED_SECRET=dev_secret_local`,避免从 example 复制后因空 secret 启动失败。
- 本机复现到的启动失败根因是 8001 已有旧 Agent 进程监听;不是 FastAPI app import 失败。旧进程的 `/health` 当时返回 200。

启动校验:

- `AGENT_ENV=production` 必须配 `AGENT_PIPELINE_MODE=real`。
- `AGENT_PIPELINE_MODE=real` 启动时要求 `ARK_API_KEY` 和 `DEEPSEEK_API_KEY`。
- 所有业务端点使用 `Authorization: Bearer <AGENT_SHARED_SECRET>`。
- HTTP 失败统一返回 `{ ok:false, error:{ code, message } }`。

隐私边界:

- 原图 base64 只进入 `/v3/analyze` 请求内存链路。
- `/v3/select-layout` 使用浏览器给的 200px 引用图 `ref200px`。
- `/v3/cover` 可接收 200px 缩略图 `coverPhoto` / `endingPhoto`,但这些只用于本地颜色提取,不应进入 LLM prompt。
- schema 严格拒绝 GPS / place / coordinate 等字段;日志层还有 redact 防线。

## 3. 实际路由与职责

| 路由 | 模式 | 当前职责 |
|---|---:|---|
| `GET /health` | sync | 健康检查,返回 `{ok, version, timestamp}` |
| `POST /v3/analyze` | async 202 + callback | Stage1: 接收 base64,分组/识图/补未归组照片,产出 `V3LayoutTree` |
| `POST /v3/select-layout` | async 202 + callback | Stage2: 用 200px refs 挑模板/合法化/包 cover-ending/generic copy,产出 `Page[]` |
| `POST /v3/chapter-chat` | sync | 无状态章节 turn: DeepSeek 一次分诊并生成 `talk/write/edit` |
| `POST /v3/edit-chat` | sync + Agent DB | 当前 Web 主编辑 turn: Agent 串行化 turn,写 pending op,等待 Web ack |
| `POST /v3/page-edit` | sync | 聚焦页两段式编辑: 意图路由 -> 文字改写或确定性换版;失败安全 talk |
| `POST /v3/recommend` | sync | DeepSeek 推荐 3 组 `bookThemeOptions` |
| `POST /v3/apply-theme` | sync deterministic | 将用户选择的 subject/color/font 确定性刷入页级 patch |
| `POST /v3/cover` | sync awaited async | 封面/封尾选择、跳过、AI copy/color 设计与确定性落页 |
| `POST /v3/finalize` | sync deterministic | 将 tree + pages 拍平成 `AlbumLayoutPlan` 并校验 |
| `POST /internal/agent-ack` | sync + Agent DB | Web 确认某个 edit op 已持久化后,Agent 将 pending op/message 标记为 committed |

### 3.1 Prompt / skill 边界(2026-06-28 更新)

- `apps/agent/src/agents/<cap>/*.md` 只承担 agent 固定契约:角色、输入范围、输出 JSON/字段形状、硬格式要求。
- 所有人为可调规则、风格、红线、重试纠正语和默认回复都在 `apps/agent/src/skills/` 下。
- handler 通过 `load_prompt(..., skills=(...))` 组合跨能力 skill,或通过 `SKILLS_DIR / "<name>.md"` 显式加载能力 skill。
- 旧 `prompts/common/`, `prompts/rules`, `prompts/skills` 已提升为单层 `src/skills`;旧 agents 下的 `replies.md` 已迁到 `src/skills/replies/`。
- `json_only`, `persona`, `privacy` 不再作为独立 skill 文件保留:严格 JSON 是 agents `.md` 的硬格式契约,隐私由 schema/redact 承担,全局人设不再注入。

## 4. 端到端流程

### 4.1 初始化 Stage1: analyze

`/v3/analyze` 接单后立即返回 202,后台执行 `flows/analyze.py`:

1. 发 callback `jobKind="analyze", stage="group", progress=0`。
2. `agents/image_grouping.group_photos(req.photos)` 本地分组。
3. 发 group 100。
4. 发 describe 0。
5. `agents/image_understanding.describe_chapters(...)` 调识图模型,输出每章描述与每图 `sceneDescription`。
6. 发 describe 100。
7. 再发 group 0。
8. `agents/regroup_unplaced.group_unplaced(...)` 处理未归组照片。
9. `_assemble_stage1_tree(...)` 组装严格的 `V3LayoutTree`:
   - 每张输入照片必须且只能出现一次。
   - 每章有 `description`, `photos[]`, `extractedColor`。
   - `accentColor` / `artFont` 在此阶段保持 null。
10. 发 group 100。
11. callback `event="completed", jobKind="analyze"` 只携带 `tree` 和 `usage`。

失败路径:

- group / regroup / assemble 失败 -> callback `AGENT_OUTPUT_VALIDATION`。
- describe 失败 -> callback `AGENT_VISION_FAILED`。
- background 超时 -> callback `AGENT_TIMEOUT`。
- 未捕获异常 -> callback `AGENT_INTERNAL_ERROR`。

注意: 当前 analyze completed 不再返回 pages。Web 侧测试也明确拒绝 analyze callback 带 pages。

### 4.2 初始化 Stage2: select-layout

`/v3/select-layout` 接单后返回 202,后台执行 `flows/select_layout.py`:

1. 输入来自 Stage1 tree 切片和浏览器保留的 `ref200px`。
2. 按 `select_layout_max_images_per_batch` 拆 layout units / batches。
3. 每批尝试 `engine/gemini_layout.gemini_layout(..., mode="select")`。
4. Gemini 失败时按批降级 `engine/skeleton_v3.build_skeleton_v3(...)`。
5. `gemini_layout.legalize_layout(...)` 合法化页面。
6. `skeleton_v3.wrap_with_cover_ending(...)` 包可选封面/封尾结构。
7. `generic_copy.fill_generic_copy(...)` 填通用装饰文案。
8. callback `event="completed", jobKind="select-layout"` 携带 `pages` 和 `usage`。

失败路径:

- 单批 Gemini 失败不是终止错误,会局部 fallback。
- 整体超时 -> callback `AGENT_TIMEOUT`。
- 未捕获异常 -> callback `AGENT_OUTPUT_VALIDATION`。

### 4.3 章节编辑:当前有三条路

当前代码里同时存在三类章节/页编辑入口,需要后续产品/架构文档明确主次。

`/v3/edit-chat` 是 Web 当前主编辑路径:

- 请求是 slim body: `albumId`, `language`, `userMessage`, `focus`, `progress`。
- Agent 通过 `agent_edit_repo.begin_serialized_turn(...)` 抢一个串行 turn lease。
- Agent 从自身 `agent.edit_messages` 读已 committed 的历史。
- Agent 通过 Web 内部 `agent-data` 获取章节/页/照片上下文。
- 如果用户发 `[confirm-chapter]`,直接返回 `progressDecision.chapterDone=true`。
- 如果识别为 layout swap,通过 `gemini_layout` 做 case4 swap,再合法化成 patch。
- 其他 chapter/page 内容编辑委托给 `agents/writing.handler.run(...)`。
- Agent 写入 pending op 和 pending user/assistant messages,返回 `opId`。
- Web 合并 patch / pagesTexts / progressDecision 后调用 `/internal/agent-ack`。
- ack 成功后 Agent 将 pending op/messages 标为 committed。

`/v3/chapter-chat` 是无状态章节 turn:

- Web 必须把单章 `chapter` 和该章 `pages` 一次性传入。
- DeepSeek 一次调用同时判定 `kind=talk/write/edit` 并产出回复/patch。
- `write` 会生成本章每页 authored text slots。
- `edit` 只作用于聚焦页;文字编辑留在 DeepSeek,图片相关编辑升级到 image edit intent,再由确定性引擎落版。
- 模型输出会按模板槽位过滤与 `maxChars` 钳制。
- 缺 `DEEPSEEK_API_KEY` 时返回 502 `AGENT_PLANNING_FAILED`。

`/v3/page-edit` 是聚焦页两段式入口:

- 请求形态接近 `chapter-chat`,但没有 `albumId`,且必须有 `focusedPageIndex`。
- 段一: 轻量 DeepSeek 调用只判 `intent=edit_text|change_layout|advance|talk`。
- 段二:
  - `edit_text`: 第二次写作调用,输入当前 texts,只回该页 text patch。
  - `change_layout`: 不调模型,从合法候选里确定性换一个不同模板,并重排当前页照片。
  - `advance`: 只回 `advanceIntent=true`。
  - `talk`: 只回回复。
- 任何内部失败、解析错误、缺 key、超时都会安全降级为 `intent="talk"` 且无 patch。

### 4.4 主题推荐与应用

`/v3/recommend` 当前实际输出不是旧文档里的 `chapterColors`,而是:

```json
{
  "bookThemeOptions": [
    {
      "optionId": "opt-1",
      "artFont": "script-elegant",
      "label": "...",
      "style": "...",
      "chapters": [
        { "chapterId": "ch_1", "subject": "...", "accentColor": "#C0392B" }
      ]
    }
  ],
  "assistantReply": "...",
  "usage": {}
}
```

约束:

- `bookThemeOptions` 必须恰好 3 组。
- 每组 option 必须覆盖请求里的每个 chapter,不能缺、不能多、不能重复。
- `artFont` 是闭集。
- `accentColor` 必须归一为合法 hex。
- 缺 `DEEPSEEK_API_KEY` 时返回 502 `AGENT_PLANNING_FAILED`。

`/v3/apply-theme` 是纯确定性:

- 输入是用户选择的每章 `subject/accentColor/artFont` 与相关页。
- 当请求同时包含多章选择和 pages 时会拒绝,因为 `Page` 不带 `chapterId`,多章有歧义。
- 对 `variableDecor` SVG 槽写入强调色。
- 对空 title 槽写入 `subject`;非空 title 保留用户已有章名。
- 普通正文和非 variableDecor 槽不改。
- 成功时 `layoutPatch` 必须非空;没有可主题化槽会返回 422 `AGENT_OUTPUT_VALIDATION`。

### 4.5 封面/封尾

`/v3/cover` 当前是 Web 同步等待,内部 `await cover_v3.build_cover(...)`:

- 不选 coverTemplateId / endingTemplateId 时是合法跳过,返回空 `layoutPatch`。
- 选模板时会校验模板 id 存在且 category 匹配 `cover` / `ending`。
- cover 设计落到传入 pages 的第一页;ending 设计落到最后一页;Agent 不凭空造页。
- 自动把页已有照片按模板 image slots 填进去,超出容量的图丢弃,不复用/编造。
- 通用装饰由 `generic_copy` 填;用户正文默认不自动写。
- Stage5 可走 AI copy/color seam,但缩略图 base64 只用于本地颜色提取。

### 4.6 Finalize

`/v3/finalize` 是纯确定性:

1. 从整棵 `V3LayoutTree` 收集唯一照片,输出 render contract 要求的 `photos[]`;V3 没有 quality,所以合成中性 `quality="detail"`。
2. 将传入 pages 按顺序重排连续 `pageIndex`。
3. 通过照片归属把每页映射到章节。
4. 将章节 `accentColor/artFont` 烘进扁平 `Page.texts`:
   - SVG variableDecor 槽: `texts[svgId] = accentColor`。
   - TEXT variableDecor 槽: 通过 sibling carrier `slotId#accentColor` / `slotId#artFont` 携带样式。
5. 构造 `AlbumLayoutPlan`。
6. 执行唯一的 `validate_v3`。

V3 不强制 page0 必须是 cover;封面/封尾可跳过。

## 5. 本轮操作测试结果

### 5.1 自动化测试

| 命令 | 结果 |
|---|---|
| `pnpm --filter @yujee/contracts test` | 60 passed |
| `pnpm --filter @yujee/web test` | 475 passed, 1 skipped |
| `pnpm typecheck` | passed |
| `PYTHONPATH=apps/agent apps/agent/.venv/bin/python -m pytest apps/agent/tests` | 499 passed, 4 skipped |

Python 测试的关键现象:

- 从 `apps/agent` 目录直接跑 `.venv/bin/python -m pytest` 时,结果是 `495 passed, 4 skipped, 4 failed`。
- 失败用例:
  - `tests/test_recommend_v3.py::test_provider_not_injected_uses_no_real_model_by_default`
  - `tests/test_vision_provider.py::test_select_slot_openai_has_no_thinking_and_json_object`
  - `tests/test_vision_provider.py::test_select_slot_ark_missing_key_raises`
  - `tests/test_vision_provider.py::test_resolved_vision_model_tracks_provider_without_key`
- 根因: 从 `apps/agent` 目录运行时,`Settings(env_file=".env")` 加载了 `apps/agent/.env` 中的真实 provider keys 和 model overrides。测试以为没有 key,实际拿到了 key;测试以为 OpenAI vision 默认模型是 `gpt-4o-mini`,实际 `.env` 覆盖成了本地配置。
- 复核: 同 4 个失败用例从仓库根以 `PYTHONPATH=apps/agent` 运行时全部通过。

结论: 代码在隔离测试环境下是绿的;但测试命令对当前工作目录敏感,这会造成误报、真实模型调用和潜在费用风险。

### 5.2 live HTTP 操作测试

本轮启动命令:

```bash
AGENT_SHARED_SECRET=test_secret AGENT_PIPELINE_MODE=mock AGENT_ENV=development DEEPSEEK_API_KEY= ARK_API_KEY= OPENAI_API_KEY= SELECT_LAYOUT_API_KEY= DATABASE_URL= .venv/bin/uvicorn src.main:app --host 127.0.0.1 --port 8011
```

结果:

| 操作 | 结果 |
|---|---|
| `GET /health` | 200, `{ok:true, version:"1.0.0"}` |
| `POST /v3/apply-theme` 有 auth + 合法页 | 200, 返回 1 条 patch,写入 `title:"A Year Away"` |
| `POST /v3/cover` 跳过 cover/ending | 200, `layoutPatch:[]`, `needsUserInput:false` |
| `POST /v3/finalize` 有 auth + 合法 tree/pages | 200, 返回扁平 `AlbumLayoutPlan`,含 `title#accentColor` / `title#artFont` |
| `POST /v3/finalize` 无 auth | 401, `AGENT_UNAUTHORIZED` |
| `POST /v3/recommend` 无 DeepSeek key | 502, `AGENT_PLANNING_FAILED` |
| `POST /v3/chapter-chat` 无 DeepSeek key | 502, `AGENT_PLANNING_FAILED` |
| `POST /v3/page-edit` 无 DeepSeek key | 200, 安全降级 `intent:"talk"`,无 patch |
| `POST /internal/agent-ack` 无 `DATABASE_URL` | 503, `AGENT_DB_UNAVAILABLE` |

本轮没有用真实 provider key 跑 live LLM 调用,避免消耗本地 `.env` 里的真实 key。LLM 成功路径由 Python/Web 单测里的注入 fake completions 覆盖。

## 6. 当前主要问题与 2026-06-28 修复

### 6.1 文档落后问题已刷新

2026-06-28 已更新:

- `apps/agent/README.md`:改为当前 V3 启动、路由、阶段流和测试命令。
- `docs/agent/contract.md`:补齐 `/v3/select-layout`, `/v3/edit-chat`, `/v3/page-edit`, `/internal/agent-ack`;`/v3/recommend` 改为 `bookThemeOptions`。
- `docs/agent/design.md`:改为 Stage1 tree-only + Stage2 select-layout 出 pages 的实际设计。
- `docs/architecture.md` 与 `docs/web/api.md`:改为两个异步初始化端点,并说明 `job-progress` 同时接 analyze/select-layout callback。

### 6.2 测试隔离存在风险

`apps/agent/.env` 会污染从 `apps/agent` 目录启动的测试。实际后果已经出现:

- 无 key 预期测试误以为有 key。
- 本应纯单测的 `recommend` 路径可真实调用 DeepSeek。
- 模型默认值测试会被本地 `.env` 覆盖。

建议后续修复方向:

- 测试 fixture 显式清空 `ARK_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `*_MODEL` 等 provider env。
- 或让测试环境禁用 dotenv / 指向 `.env.test`。
- 或在项目文档中统一 Python 测试命令为仓库根 `PYTHONPATH=apps/agent apps/agent/.venv/bin/python -m pytest apps/agent/tests`。

### 6.3 编辑路由存在重叠

当前同时有 `/v3/chapter-chat`, `/v3/edit-chat`, `/v3/page-edit`。从 Web 代码搜索结果看,当前主编辑流走 `/v3/edit-chat`,但另外两条路仍可用且行为不同:

- `chapter-chat`: stateless,需要完整 chapter/pages,缺 DeepSeek key 硬失败 502。
- `edit-chat`: stateful,需要 Agent DB + Web agent-data + ack。
- `page-edit`: focused page,失败安全 talk,不含 albumId。

这不是一定错误,但需要文档明确:哪条是正式产品路径,哪些是兼容/实验/内部能力面。

### 6.4 DB 依赖是硬前提

`/v3/edit-chat` 与 `/internal/agent-ack` 依赖 `DATABASE_URL` 和 `agent.*` Alembic schema。无 DB 时 ack 已确认返回 503。生产如果要使用当前 Web 主编辑流,必须确认:

- `DATABASE_URL` 已配置。
- `apps/agent/migrations` 已执行到 head。
- Web 在合并 album transaction 后能可靠调用 ack。

### 6.5 本轮未覆盖的真实外部依赖

本轮没有直接调用真实 Ark/OpenAI/DeepSeek/Gemini。原因是当前 `.env` 含真实 key,而用户要求是全量操作测试与文档,不是消耗外部模型做质量评估。本轮覆盖方式是:

- 自动化单测覆盖模型成功/失败/解析/校验路径。
- live HTTP 覆盖真实 FastAPI envelope、鉴权、确定性成功路径、缺依赖错误路径。

如果要做下一轮线上质量测试,应单独准备可控测试 key、固定测试图片、callback sink、DB schema 和成本上限。

## 7. 一句话实际运行图

```text
Browser/Web
  -> /v3/analyze (base64, async)
  <- callback analyze completed: tree only
  -> /v3/select-layout (200px refs, async)
  <- callback select-layout completed: pages
  -> /v3/edit-chat (stateful story/edit turns, Agent DB pending op)
  -> /internal/agent-ack (Web merged op, Agent commits messages)
  -> /v3/recommend (3 bookThemeOptions)
  -> /v3/apply-theme (deterministic page patches)
  -> /v3/cover (optional cover/ending patches)
  -> /v3/finalize (flat AlbumLayoutPlan)
```
