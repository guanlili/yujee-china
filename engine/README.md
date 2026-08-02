# Yujee Agent

FastAPI service for the current minimal pipeline: deterministic chapter grouping, deterministic layout selection, and a single Gemini compose pass that writes the whole book's copy.

**只有 `/v3/compose` 会调用模型。** `/v3/analyze` 和 `/v3/select-layout` 都是纯确定性的:
分析期已经砍掉识图(不再有豆包 vision 调用),排版期也没有候选/缩略图/评委来回。

The previous edit-chat/theme/cover/finalize surfaces, plus `/v3/judge-layout`, `/v3/judge-page-template` and `/v3/design`, have been removed from the current Agent route surface. If Web still contains callers for those routes, treat that as a Web/Agent alignment task, not as an Agent README promise.

## Current Surface

Exactly four routes (`src/api/routes.py`):

| Endpoint | Mode | Purpose |
|---|---:|---|
| `GET /health` | sync | Health check |
| `POST /v3/analyze` | async `202` + callback | 确定性分组(CLIP embedding / 拍摄时间 / GPS / 像素特征)+ 确定性归散图 + 提取章节主色 → tree-only `V3LayoutTree`;章标题由拍摄时间跨度确定性派生到 `V3Chapter.title`。零 AI 调用 |
| `POST /v3/select-layout` | async `202` + callback | Deterministic layout selection; one `completed` callback returns final `pages` (with template sample copy). 零 AI 调用 |
| `POST /v3/compose` | async `202` + callback | 一次性成稿:按章并发让 Gemini 看真实照片 + 读用户讲的故事写满全书文案,并出封面/封尾文案与字体。**全链路唯一的 AI 调用** |

All business endpoints require:

```http
Authorization: Bearer <AGENT_SHARED_SECRET>
Content-Type: application/json
```

## Runtime Shape

```text
engine/src/
├── main.py                             # App 装配 + 启动期配置校验(fail-fast)
├── settings.py                         # Provider 与运行时开关
├── logging_config.py                   # structlog 配置 / requestId 上下文
├── api/
│   ├── routes.py                       # Thin HTTP surface(上表四个路由)
│   ├── auth.py                         # Bearer 校验依赖
│   └── callback.py                     # 回 Web 的 callback POST
├── contracts/
│   └── schemas.py                      # Pydantic mirror of packages/contracts
├── providers/
│   ├── ai_client.py                    # 通用 LLM 客户端 + trace/脱敏
│   ├── gemini_client.py                # Gemini native 调用(compose 用)
│   ├── vision_provider.py              # 识图槽选择(当前无 workflow 调用,见下)
│   └── pricing.py                      # token 计价表
└── workflows/
    ├── analyze.py                      # ① /v3/analyze 编排(零 AI)
    ├── select_layout.py                # ② /v3/select-layout 编排(零 AI)
    ├── compose.py                      # ③ /v3/compose 编排(按章并发 + 全局封面批)
    ├── prompts.py                       # 共用 prompt 片段
    └── core/
        ├── chaptering/                 # features / grouping / unplaced / tree_builder / schema
        ├── layout/                     # candidate_gen_v3 / legalize / skeleton_v3 /
        │                               #   slot_matcher_v3 / templates / sample_texts /
        │                               #   accent_color / simple_id
        └── compose/                    # handler(两类 Gemini 调用)+ schema
```

`providers/vision_provider.py` 和 `ARK_*` / `DEEPSEEK_*` 设置是砍掉识图后的残留:当前
没有任何 workflow 调用它们,但 `main.py` 的启动校验仍要求这两把 key(见 Setup 表)。

## Pipeline

```text
Web -> /v3/analyze                       (Browser 的轻量图像数据 + EXIF 时间/GPS)
Agent -> callback progress/completed: V3LayoutTree(含确定性 chapter.title)

  ... Web 进 story 环节,用户逐章讲故事 -> chapterContext ...

Web -> /v3/select-layout                 (章 + 200px refs + chapterContext)
Agent -> callback completed: Page[]      (texts 先填模板 sample 示例文案)

  ... 用户在设计卡选封面/封尾组合与书页底色 ...

Web -> /v3/compose                       (内页 + 200px refs + 各章故事)
Agent -> callback progress(逐章心跳) …
Agent -> callback completed: pagesTexts + coverTexts/endingTexts + fonts
  -> Web 组页落库并推 stage='ready'
```

`/v3/analyze` is fully deterministic (no AI call): grouping runs on local CLIP embeddings plus EXIF time/GPS and cheap pixel features, stray photos are re-attached deterministically, and each chapter's `title` is derived from its shooting-time span. `visionCallCount` is therefore always `0`.

`/v3/select-layout` is fully deterministic (no AI call): each unit takes a single seeded candidate, gets finalized into pages, and the template `sample` strings are filled into `texts`. 用户在这一步看到的是**有字的版面**,不是空文字框 —— 但那还不是真文案。

`/v3/compose` 是全流程**唯一**的 AI 成稿调用:一章一次 Gemini(照片以真图进上下文、
`chapterContext` 是最高优先级素材),外加一次全局调用出封面/封尾文案与字体
(AI 只输出场景名,字体由代码按 场景×语言 查表填)。失败绝不阻断交付 —— 章/全局批次
单次失败先原地重试一次(瞬时网络抖动、空正文、JSON 解析不出都在此列;截断/少括号的
输出会先走 `parse_json_loose` 的修复兜底),仍写不出来该章页面才保留模板 sample 文案,
不发 `failed`。**超时同理**:预算是按章的
(`COMPOSE_CHAPTER_TIMEOUT_SECONDS`,默认 180s),卡住的章按「这一章掉队」处理,已经写完
的章照常成稿;外层只留一个按「章数 ÷ 并发」摊开的兜底(封顶 11 分钟,压在 Web 侧 compose
僵尸超时 12 分钟之内)。

## Source Of Truth

- Project overview: [`../README.md`](../README.md)
- TS contract: [`../packages/contracts/src/v3.ts`](../packages/contracts/src/v3.ts) 与 [`../packages/contracts/src/layout.ts`](../packages/contracts/src/layout.ts)
- Python contract mirror: [`src/contracts/schemas.py`](src/contracts/schemas.py)
- Runtime switches: [`src/settings.py`](src/settings.py)
- HTTP surface: [`src/api/routes.py`](src/api/routes.py)

## Setup

```bash
cd engine
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Important local `.env` fields:

| Name | Note |
|---|---|
| `AGENT_SHARED_SECRET` | Bearer secret shared with Web |
| `WEB_BASE_URL` | Web origin for callbacks |
| `AGENT_PIPELINE_MODE` | `mock` or `real` |
| `ARK_API_KEY` / `DEEPSEEK_API_KEY` | 砍掉识图后的残留槽:`mode=real` 启动仍必检,但当前没有 workflow 调用它们 |
| `OPENAI_API_KEY` | 备用 vision 槽(`VISION_PROVIDER=openai` 时),同样无 workflow 调用 |
| `SELECT_LAYOUT_API_KEY` | The one Gemini slot (name is historical). Its only consumer is ④ `/v3/compose`; `/v3/select-layout` itself is deterministic and needs no key. `mode=real` fails fast without it: compose degrades *silently* (green `completed`, empty `pagesTexts`, book full of template samples). |
| `COMPOSE_CHAPTER_TIMEOUT_SECONDS` | 每章成稿的预算(默认 180 = 2 × 60s 单次调用重试上限 + 余量)。超时只让这一章掉队,不作废整本书 |
| `PORT` | Defaults to `8001` |

## Run

From repo root:

```bash
pnpm agent:dev
curl http://127.0.0.1:8001/health
```

If `8001` is occupied:

```bash
PORT=8011 pnpm agent:dev
curl http://127.0.0.1:8011/health
```

Directly from `engine`:

```bash
.venv/bin/uvicorn src.main:app --reload --port "${PORT:-8001}"
```

## Tests

Run from the repo root so `engine/.env` does not accidentally change provider-key isolation tests:

```bash
PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests
PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_v3_route_surface.py -q
PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_vision_groups.py -q
```

## Deploy

Agent 不走自动部署,合并后要**手动** `flyctl deploy`(从干净的 `origin/main` worktree,
带 `--depot=false`):

```bash
fly deploy -c engine/fly.toml --dockerfile engine/Dockerfile --depot=false .
```

上线前置动作,顺序不要跳:

1. **先确认 Fly 上 `yujee-agent` 有 `SELECT_LAYOUT_API_KEY`**(即 compose 的 Gemini key,
   名字是历史产物)。`fly secrets list -a yujee-agent` 看得到就行。
   缺它时 `AGENT_PIPELINE_MODE=real` 会在 `src/main.py` 的启动校验里 **fail-fast,
   服务直接起不来**。这是刻意的:缺 key 时 compose 不会报错,它会每章记一条 warning、
   照常发 `completed` + 空 `pagesTexts`,观测台一片绿,用户却拿到一本全是模板示例文案
   的书。宁可开不起来,也不静默交付这种书。
   同理 `ARK_API_KEY` / `DEEPSEEK_API_KEY` 目前也在必检清单里(虽已无 workflow 消费)。
2. **Web 和 Agent 必须同版本部署。** 这一版是契约变更:删了 `/v3/judge-layout`、
   `/v3/judge-page-template`、`/v3/design`,新增 `/v3/compose`,`V3Chapter` 加了 `title`。
   只更新一边会当场契约漂移。
3. Web 侧的迁移 `0020` 给 `agent_jobs.kind` 加了 `'compose'`;PG 不允许在同一个事务里
   使用刚加的枚举值,所以将来引用 `'compose'` 的迁移必须与 0020 分批部署。

CLIP embedding worker 是另一个 app(`engine/fly.clip.toml` → `yujee-agent-clip`),
按需单独部署。

## Change Notes

- Keep `api/routes.py` thin; route handlers should parse, log, enqueue background work, and return envelopes.
- Put multi-step orchestration under `workflows/`(一个文件对一个端点)。
- Put deterministic transforms under `workflows/core/`。
- Put provider/SDK boundaries under `providers/`。
- Do not document removed endpoints as active until they exist again in `api/routes.py` and tests.

<!-- doc-scope
paths: engine/src/**, engine/fly*.toml, engine/pyproject.toml
checked-at: ec301c2a
-->
