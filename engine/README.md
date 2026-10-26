# Yujee Agent

FastAPI service for the current minimal pipeline: deterministic chapter grouping, deterministic layout selection, and a single compose pass that writes the whole book's copy (Gemini by default; `COMPOSE_PROVIDER=ark` switches it to 火山 Ark for the China deployment).

**只有 `/v3/compose` 会调用模型。** `/v3/analyze` 和 `/v3/select-layout` 都是纯确定性的:
分析期已经砍掉识图(不再有豆包 vision 调用),排版期也没有候选/缩略图/评委来回。

The previous edit-chat/theme/cover/finalize surfaces, plus `/v3/judge-layout`, `/v3/judge-page-template` and `/v3/design`, have been removed from the current Agent route surface. If Web still contains callers for those routes, treat that as a Web/Agent alignment task, not as an Agent README promise.

## Current Surface

四个对外路由 + 两个 internal(`src/api/routes.py`):

| Endpoint | Mode | Purpose |
|---|---:|---|
| `GET /health` | sync | Health check |
| `POST /v3/analyze` | async `202` + callback | 确定性分组(CLIP embedding / 拍摄时间 / GPS / 像素特征)+ 确定性归散图 + 提取章节主色 → tree-only `V3LayoutTree`;章标题由拍摄时间跨度确定性派生到 `V3Chapter.title`。零 AI 调用 |
| `POST /v3/select-layout` | async `202` + callback | Deterministic layout selection; one `completed` callback returns final `pages` (with template sample copy). 零 AI 调用 |
| `POST /v3/compose` | async `202` + callback | 一次性成稿:按章并发让成稿模型(默认 Gemini,`COMPOSE_PROVIDER=ark` 时走火山 Ark 的 OpenAI 兼容通路,消息体本就是 image_url 多模态格式)看真实照片 + 读用户讲的故事写满全书文案,并出封面/封尾文案与字体。**全链路唯一的 AI 调用** |

另有两个 internal 路由,**只在专用的 2GB CLIP worker 上开**
(国内为 compose 的 clip 容器,`AGENT_ENABLE_CLIP_EMBEDDINGS=true`);普通 1GB Agent
开关关着 => 404。
鉴权走 `GROUPING_CLIP_SECRET`(未设则回落 `AGENT_SHARED_SECRET`):

| Endpoint | Purpose |
|---|---|
| `POST /internal/open-clip/embeddings` | 分章用的 CLIP 图片 embedding。调用方 `chaptering/features.py` |
| `POST /internal/photo-profile` | 照片视觉档案(几何/色彩/语义三组)。调用方 `profile/remote.py`。带 `persistMask=true` 时额外跑一次 isnet/1024² 出高精度抠图 mask |

⚠️ 这两个口都有活的调用方,**别当「后续环节端点」清掉**(2026-07-06 的 `0cfc019d`
就那么删过第一个)。`tests/test_v3_route_surface.py` 有守卫钉着。

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

`/v3/analyze` is deterministic by default (no AI call): grouping runs on local CLIP embeddings plus EXIF time/GPS and cheap pixel features, stray photos are re-attached deterministically, and each chapter's `title` is derived from its shooting-time span.

**唯一的例外是照片视觉档案**(`AGENT_ENABLE_PHOTO_PROFILE`,**默认关**)。打开之后
analyze 会多一步:把照片委托给 2GB CLIP worker 的 `/internal/photo-profile`,每张跑一次
分割推理(u2netp/320²,只取主体包围盒)+ 一次视觉模型调用(五个语义字段),然后

1. 把 `composition` / `description` 回填进章节树的
   `V3ChapterPhoto.composition` / `.sceneDescription`(此前分别恒 `None` / 恒空,
   前者让模板槽位的构图约束在生产里完全没生效);
2. 把档案本体 POST 回 web 的 `/api/v3/internal/photo-profiles` 落
   `album_photos.profile` —— **这一步是三个照片能力(整本调色 / 构图裁切 / 抠图)的
   唯一数据来源**,不回传的话 design-agent 什么都看不到。

开关打开后 `visionCallCount` 是**真实计数**(每张照片一次视觉调用,只计真的发出去
并回来了的);关着时分析期零 AI 调用,计数为 `0`。

建档整条链路的失败一律降级、绝不打挂 analyze:单张坏图只丢那一张;单批失败只丢那一批;
总时长有预算(`PHOTO_PROFILE_BUDGET_SECONDS`,默认 240s,超了就用已拿到的部分继续)。
每一处降级都打带 photoId 的日志 —— 静默丢档案在生产上查不出来。

`/v3/select-layout` is fully deterministic (no AI call): each unit takes a single seeded candidate, gets finalized into pages, and the template `sample` strings are filled into `texts`. 用户在这一步看到的是**有字的版面**,不是空文字框 —— 但那还不是真文案。

`/v3/compose` 是全流程**唯一**的 AI 成稿调用:一章一次(`_completion` 单一汇聚点,provider 由 `COMPOSE_PROVIDER` 决定:默认 Gemini,`ark` 走 `ai_client.chat_completion`,doubao 侧强制 thinking disabled 且不传 `response_format`;模型可用 `COMPOSE_ARK_MODEL` 单独指定,缺省回落 `ark_vision_model`)(照片以真图进上下文、
`chapterContext` 是最高优先级素材),外加一次全局调用出封面/封尾文案与字体
(AI 只输出场景名,字体由代码按 场景×语言 查表填)。失败绝不阻断交付 —— 章/全局批次
单次失败先原地重试一次(瞬时网络抖动、空正文、JSON 解析不出都在此列;截断/少括号的
输出会先走 `parse_json_loose` 的修复兜底),仍写不出来该章页面才保留模板 sample 文案,
不发 `failed`。**超时同理**:预算是按章的
(`COMPOSE_CHAPTER_TIMEOUT_SECONDS`,默认 180s),卡住的章按「这一章掉队」处理,已经写完
的章照常成稿;外层只留一个按「章数 ÷ 并发」摊开的兜底(封顶 11 分钟,压在 Web 侧 compose
僵尸超时 12 分钟之内)。

**`coverSlots`/`endingSlots` 两个数组全空时,全局批次直接跳过**(`compose.py` 的
`global_task` 开头短路):不调 Gemini,回调的 `coverTexts`/`endingTexts`/`fonts` 全空;
章节批次照常并发写文案。这是给 Web 侧「追加范围成稿」用的窄口径请求 —— 已设计的书加
照片、增量排版落地后,只为新章再发一次这样的空槽 `/v3/compose`,只补新页文案,不动
封面/字体。

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
| `SELECT_LAYOUT_API_KEY` | The one Gemini slot (name is historical). Its only consumer is ④ `/v3/compose`; `/v3/select-layout` itself is deterministic and needs no key. `mode=real` fails fast without it (仅当 `COMPOSE_PROVIDER=gemini`;`ark` 线改查 `ARK_API_KEY`,Gemini 槽整条不被消费): compose degrades *silently* (green `completed`, empty `pagesTexts`, book full of template samples). |
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

2026-10-26 起 engine 侧改动同样 **merge 到 main 即自动部署**:CI 全绿后 deploy job
SSH 到 49.232 跑 `deploy/china/bin/deploy-from-git.sh`(reset --hard + 五容器
`compose up -d --build`),详见 [`deploy/china/README.md`](../deploy/china/README.md)
「自动部署」。海外 Fly 线(`engine/fly*.toml`)已随单机方案退场删除(2026-10-26),
历史版本在 git;CLIP worker 不再是独立 app,是同一 compose 里的 clip 容器。

部署仍要记住:

1. **Web 和 Agent 必须同版本部署。** 跨服务契约是手工镜像、没有 codegen,只部署一边
   会当场契约漂移(merge 自动部署天然保证同批上线)。
2. `AGENT_PIPELINE_MODE=real` 启动必检 provider key(密钥在服务器
   `deploy/china/env/single.env`):`COMPOSE_PROVIDER=ark` 查 `ARK_API_KEY`,
   gemini 线查 `SELECT_LAYOUT_API_KEY`(compose 的 Gemini key,名字是历史产物)。
   缺 key 会 **fail-fast 起不来,这是刻意的**:缺 key 时 compose 不会报错,它会
   每章记一条 warning、照常发 `completed` + 空 `pagesTexts`,观测台一片绿,用户
   却拿到一本全是模板示例文案的书。宁可开不起来,也不静默交付这种书。
   `DEEPSEEK_API_KEY` 目前也在必检清单里(虽已无 workflow 消费)。
3. Web 侧的迁移 `0020` 给 `agent_jobs.kind` 加了 `'compose'`;PG 不允许在同一个事务里
   使用刚加的枚举值,所以将来引用 `'compose'` 的迁移必须与 0020 分批部署。

## Change Notes

- Keep `api/routes.py` thin; route handlers should parse, log, enqueue background work, and return envelopes.
- Put multi-step orchestration under `workflows/`(一个文件对一个端点)。
- Put deterministic transforms under `workflows/core/`。
- Put provider/SDK boundaries under `providers/`。
- Do not document removed endpoints as active until they exist again in `api/routes.py` and tests.

<!-- doc-scope
paths: engine/src/**
checked-at: 45f31aaa
-->
