# Agent 内部设计

> **前置阅读**: `CLAUDE.md` -> `docs/architecture.md` -> [`docs/agent/contract.md`](./contract.md)
>
> 本文讲 Agent 内部如何实现当前 V3 authoring flow。HTTP req/res、错误码、状态机看 `contract.md`。

Agent 是分层 LLM 服务,不是通用 agent 框架。Web 拥有 album draft、stage、积分和最终持久化;Agent 每次被喂足上下文后返回 tree/pages/patch/layout。明确例外是 Stage3 `edit-chat`:编辑会话、pending op、pending/committed messages 由 Agent 写同一 Postgres 的独立 `agent` schema,迁移归 Alembic。

---

## 1. 结构

```
apps/agent/src/
├── main.py · settings.py · auth.py · logging_config.py
├── routes.py · errors.py · callback.py
├── ai_client.py · vision_provider.py
├── db.py
├── schemas.py
├── flows/
│   ├── analyze.py
│   └── select_layout.py
├── agents/
│   ├── image_grouping/
│   ├── image_understanding/
│   ├── regroup_unplaced/
│   ├── writing/
│   ├── editing/
│   ├── page_edit/
│   ├── theme_recommend/
│   └── image_edit_intent/
├── engine/
│   ├── templates.py
│   ├── skeleton_v3.py
│   ├── gemini_layout.py
│   ├── generic_copy.py
│   ├── apply_theme_v3.py
│   ├── cover_v3.py
│   ├── finalize_v3.py
│   └── finalize_color.py
└── skills/
    └── replies/
```

职责:

- `routes.py`: HTTP 边界,只做 auth 后的请求解析、调用 flow/agent/engine、包 envelope、写 accepted/completed log。
- `flows/`: 唯一多步异步编排。当前是 `/v3/analyze` 和 `/v3/select-layout`。
- `agents/<cap>/`: 模型能力。组 prompt、调模型、解析/校验/clamp 输出,不直接写 Web draft。共置 `.md` 只描述角色、输入范围、输出 JSON/字段契约和硬格式要求。
- `engine/`: 确定性变换,不调模型,纯函数可单测。
- `db.py`: Agent-owned `agent.*` edit-loop schema 边界,不读写 `public.albums`。
- `schemas.py`: Pydantic mirror of `packages/contracts/src/v3.ts`。

---

## 2. Async Init Flow

### 2.1 Stage1 `/v3/analyze`

`/v3/analyze` 是唯一接收浏览器原图 base64 的端点。`routes.py` 接单即 202,后台运行 `flows/analyze.run_with_timeout(req)`。

实际步骤:

1. `image_grouping.group_photos(req.photos)` 本地按时间/cluster/image metadata 分组。
2. `image_understanding.describe_chapters(...)` 调识图模型,生成每章描述和每图 `sceneDescription`。
3. `regroup_unplaced.group_unplaced(...)` 处理未归组照片。
4. `_assemble_stage1_tree(...)` 校验每张输入图 exactly once,并组装 `V3LayoutTree`。
5. callback `jobKind="analyze", event="completed"` 只返回 `tree + usage`。

Stage1 不生成 pages。它不会选模板、不会 generic copy、不会 wrap cover/ending。

Failure mapping:

- 分组/补组/tree 组装失败 -> `AGENT_OUTPUT_VALIDATION` failed callback。
- 识图失败 -> `AGENT_VISION_FAILED` failed callback。
- timeout -> `AGENT_TIMEOUT` failed callback。
- 未捕获异常 -> `AGENT_INTERNAL_ERROR` failed callback。

### 2.2 Stage2 `/v3/select-layout`

`/v3/select-layout` 接收 Stage1 tree slice 和浏览器保留的 200px refs。它通常复用 init `requestId`,使 callback 回到同一个 Web job。

实际步骤:

1. 按 `select_layout_max_images_per_batch` 拆 layout units/batches。
2. 每批尝试 `gemini_layout.gemini_layout(..., mode="select")`。
3. 单批 Gemini 失败时只 fallback 该批到 `skeleton_v3.build_skeleton_v3(...)`。
4. `gemini_layout.legalize_layout(...)` 合法化输出页。
5. `skeleton_v3.wrap_with_cover_ending(...)` 包 cover/ending anchor。
6. `generic_copy.fill_generic_copy(...)` 填通用装饰文案。
7. callback `jobKind="select-layout", event="completed"` 返回 `pages + usage`。

Failure mapping:

- 单批模型失败不是 job failure。
- 整体 timeout -> `AGENT_TIMEOUT`。
- 未捕获异常 -> `AGENT_OUTPUT_VALIDATION`。

---

## 3. Sync Authoring Endpoints

### 3.1 `/v3/edit-chat` 当前主编辑路径

Web 当前编辑器主路径走 `/v3/edit-chat`,不是 legacy `/v3/chapter-chat`。

`editing.handler.run(...)`:

1. `agent_edit_repo.begin_serialized_turn(...)` 在 `agent.edit_sessions` 上抢 turn lease。
2. 读取同 album/chapter 已 committed 的历史。
3. 通过 `WebAgentDataClient` 调 Web 内部 `agent-data`,取 Web-owned chapter/pages/photos。
4. 对 `[confirm-chapter]` 直接返回 `progressDecision.chapterDone=true`。
5. 对 layout swap 走 `gemini_layout(..., mode="case4-swap")` + legalize。
6. 其他内容编辑委托 `writing.handler.run(...)`。
7. 写 pending `agent.edit_ops` 和 pending `agent.edit_messages`,返回 `opId`。
8. Web 合并并提交 album transaction 后调用 `/internal/agent-ack`。

Agent DB 不可用时,这条路径是基础设施失败。

### 3.2 `/v3/chapter-chat` stateless 单章能力

`writing.handler.run(...)` 一次 DeepSeek 调用同时完成分诊和内容输出:

- `talk`: 只回复,不写 patch。
- `write`: 生成本章每页 authored text slots,按模板槽 clamp。
- `edit`: 只编辑聚焦页。纯文字编辑仍由 DeepSeek;图片/换图意图升级 `image_edit_intent`,再由 `skeleton_v3` 确定性落成 patch。

缺 `DEEPSEEK_API_KEY` 时返回 502 `AGENT_PLANNING_FAILED`。

### 3.3 `/v3/page-edit` 聚焦页 helper

`page_edit.handler.run(...)` 是两段式:

1. 意图路由: `edit_text | change_layout | advance | talk`。
2. 执行:
   - `edit_text`: 第二次写作调用,输入当前 texts,只回该页 text patch。
   - `change_layout`: 无模型,从 legal candidates 选一个不同模板并重排当前页图片。
   - `advance`: 返回 `advanceIntent=true`。
   - `talk`: 只回复。

这条路径设计为稳态保守:任何内部失败、缺 key、模型解析失败、超时都会回 `talk` 且无 patch。

---

## 4. Theme, Cover, Finalize

### 4.1 `/v3/recommend`

`theme_recommend.handler.run(...)` 调 DeepSeek。输入只有文字:章节 description、逐照片 sceneDescription、Stage1 `extractedColor`、可选 `analysisSummary/userMessage/fontHint`。

输出是 3 组 `bookThemeOptions`,每组有一个 `artFont` 和覆盖所有章节的 `{chapterId, subject?, accentColor}`。模型不能输出 template/page/layout 指令。

### 4.2 `/v3/apply-theme`

纯确定性:

- 空 title 槽可写入用户确认的 `subject`。
- 非空 title 保留。
- `variableDecor` SVG 槽写入 accentColor。
- 普通正文不改。
- 多章 choice + pages 因页无 chapterId 而拒绝。

### 4.3 `/v3/cover`

Web 同步等待,内部 async:

- 不选 cover/ending = 合法跳过,返回空 patch。
- 选模板时校验 template id 和 category。
- cover 落第一页,ending 落最后一页;Agent 不凭空造页。
- 200px thumbnails 只用于本地 accent extraction,不进入 prompt。
- Stage5 copy/color seam 可用模型,输出仍经 slot clean 和颜色 finalization。

### 4.4 `/v3/finalize`

纯确定性:

1. 从 tree 收集唯一照片,合成 render contract 需要的 `quality="detail"`。
2. 扁平化 pages 并重排 pageIndex。
3. 通过 page images 的 photoId 映射章节。
4. 将章节 `accentColor/artFont` 烘到 `page.texts`:
   - SVG variableDecor: `texts[slotId] = accentColor`。
   - text variableDecor: `texts[slotId#accentColor]` / `texts[slotId#artFont]`。
5. 建 `AlbumLayoutPlan` 并运行唯一 `validate_v3`。

V3 没有 page0-must-cover 规则。

---

## 5. Model Providers

### 5.1 Vision / layout models

- `vision_provider="ark"` 默认走火山 Ark vision slot。
- `vision_provider="openai"` 走 OpenAI vision slot。
- `vision_provider.py` 集中处理 provider-specific extra body:
  - Ark 可带 `thinking: { type: "disabled" }`。
  - OpenAI 不允许带 Ark thinking knob。
  - OpenAI 可用 `response_format=json_object`;Ark 文本模型不强行使用该字段。

Stage2 layout 使用 Gemini OpenAI-compatible slot。`select_layout` 缺 key 或调用失败时按批 fallback 到确定性 skeleton。

### 5.2 Planning / writing model

DeepSeek slot (`DEEPSEEK_*`) 用于:

- chapter-chat
- edit-chat 内部的 writing turn
- page-edit 的 intent/text edit
- recommend
- cover Stage5 copy/color seams

缺 key 的路径差异:

- `chapter-chat` / `recommend`: 502 `AGENT_PLANNING_FAILED`。
- `page-edit`: safe talk fallback。
- deterministic endpoints: 不需要 key。

---

## 6. Prompt System

`load_prompt(path, *, skills=(...), **slots)` 按路径加载 prompt fragment。

- `agents/<cap>/*.md`: 固定 agent 契约,只写角色、输入、输出 JSON/字段形状和硬格式要求。
- `skills/*.md`: 人为可调技能/规则/风格/红线,例如 `grounding`, `chapter_grouping`, `writing_style`, `theme_colors`。
- `skills/replies/*.md`: 可手调的兜底/默认回复。

`json_only`, `persona`, `privacy` 不再是独立 skill 文件:

- 严格 JSON 输出属于 agents 共置 `.md` 的硬格式契约。
- 人设语气不再全局注入。
- 隐私边界由 schema strict、输入结构和 logging redact 承担。

`{KEY}` 占位符用 `str.replace`,不是 `str.format`,避免破坏 JSON 示例里的 `{}`。

---

## 7. Validation

- TS zod 是单一真相源;Python `schemas.py` 全部 strict mirror。
- Agent handler 对模型输出做 JSON parse、schema/coverage 校验、slot clamp。
- `finalize_v3.validate_v3` 是扁平 layout 的唯一校验路径。
- `AGENT_OUTPUT_VALIDATION` 在 Web 侧映射为 `AGENT_INVALID_OUTPUT`。

---

## 8. Logging and Privacy

隐私边界:

- 原图 base64 只在 `/v3/analyze` request memory。
- `/v3/select-layout` 只接收 browser 200px refs。
- `/v3/cover` thumbnail 只给本地颜色提取。
- `takenAt` 是唯一允许的 EXIF 标量;`clusterId` 是 opaque label,不是坐标。
- GPS/place/location/coordinate 字段由 strict schema 拒绝,并由 logging redact 防御。

`logging_config` 会清洗 base64 data URL、authorization/bearer、secret/api key、GPS/place 类 key、prompt/content 原文等敏感内容。

---

## 9. Startup and Local Testing

`Settings(env_file=".env")` 的 `.env` 路径相对当前进程工作目录:

- `cd apps/agent && .venv/bin/uvicorn src.main:app ...` 会读取 `apps/agent/.env`。
- 从 repo root import `src.main` 不会自动读取 `apps/agent/.env`,除非设置 cwd 或显式环境变量。

本地启动:

```bash
pnpm agent:dev
PORT=8011 pnpm agent:dev
```

如果 `8001` 已被占用,使用 `PORT=8011 pnpm agent:dev` 或停止旧进程。不要把端口冲突误判为 import/config 失败。

Python 测试建议从 repo root 运行:

```bash
PYTHONPATH=apps/agent apps/agent/.venv/bin/python -m pytest apps/agent/tests
```

这样可以避免 `apps/agent/.env` 中的真实 provider keys 污染“缺 key”测试。

---

## 10. Error Mapping

| 情形 | Agent code |
|---|---|
| 请求体非法 | `AGENT_INVALID_INPUT` |
| Bearer 无效 | `AGENT_UNAUTHORIZED` |
| 识图模型 / 解析失败 | `AGENT_VISION_FAILED` |
| 文案 / 规划模型失败 | `AGENT_PLANNING_FAILED` |
| patch/layout 非法 | `AGENT_OUTPUT_VALIDATION` |
| async background task 超时 | `AGENT_TIMEOUT` |
| Agent DB 缺失或不可用 | `AGENT_DB_UNAVAILABLE` |
| 未知异常 | `AGENT_INTERNAL_ERROR` |

同步端点通过 `sync_endpoint_errors(...)` 统一映射已知错误和未知错误。异步端点通过 callback 发 terminal failed event。
