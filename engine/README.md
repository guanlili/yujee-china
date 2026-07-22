# Yujee Agent

FastAPI service for the current minimal AI pipeline: image analysis, chapter grouping, deterministic layout selection, and a single Gemini compose pass that writes the whole book's copy.

The previous edit-chat/theme/cover/finalize surfaces have been removed from the current Agent route surface. If Web still contains callers for those routes, treat that as a Web/Agent alignment task, not as an Agent README promise.

## Current Surface

| Endpoint | Mode | Purpose |
|---|---:|---|
| `GET /health` | sync | Health check |
| `POST /v3/analyze` | async `202` + callback | Image analysis and chapter tree generation |
| `POST /v3/select-layout` | async `202` + callback | Deterministic layout selection; one `completed` callback returns final `pages` (with template sample copy) |
| `POST /v3/compose` | async `202` + callback | 一次性成稿:按章并发让 Gemini 看真实照片 + 读用户讲的故事写满全书文案,并出封面/封尾文案与字体 |

All business endpoints require:

```http
Authorization: Bearer <AGENT_SHARED_SECRET>
Content-Type: application/json
```

## Runtime Shape

```text
engine/
├── src/routes.py              # Thin HTTP surface
├── src/flows/
│   ├── analyze.py             # Stage1 确定性分组 + 建树 callback(无 AI 调用)
│   └── select_layout.py       # Deterministic layout selection -> Page[] callback
├── src/chaptering/            # Deterministic grouping, unplaced assignment, tree builder
├── src/engine/                # Deterministic candidate/template/legalize helpers
├── src/skills/                # Prompt support material
├── src/schemas.py             # Pydantic mirror of contracts
└── src/settings.py            # Provider and runtime switches
```

## Pipeline

```text
Web -> /v3/analyze
Agent -> callback progress/completed: V3LayoutTree

Web -> /v3/select-layout
Agent -> callback completed: Page[]

Web -> /v3/compose(用户选完设计之后)
Agent -> callback completed: pagesTexts + coverTexts/endingTexts + fonts
```

`/v3/select-layout` is fully deterministic (no AI call): each unit takes a single seeded candidate, gets finalized into pages, and the template `sample` strings are filled into `texts`. It does not write real chapter copy.

`/v3/compose` 是全流程**唯一**的 AI 成稿调用:一章一次 Gemini(照片以真图进上下文、
`chapterContext` 是最高优先级素材),外加一次全局调用出封面/封尾文案与字体
(AI 只输出场景名,字体由代码按 场景×语言 查表填)。失败绝不阻断交付 —— 某章写不出来,
该章页面就保留模板 sample 文案,不发 `failed`。

## Source Of Truth

- Project overview: [`../../README.md`](../../README.md)
- TS contract: [`../../packages/contracts/src/v3.ts`](../../packages/contracts/src/v3.ts)
- Python contract mirror: [`src/schemas.py`](src/schemas.py)
- Runtime switches: [`src/settings.py`](src/settings.py)
- HTTP surface: [`src/routes.py`](src/routes.py)

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
| `ARK_API_KEY` / `OPENAI_API_KEY` | Vision provider slots, depending on settings |
| `SELECT_LAYOUT_API_KEY` | The one Gemini slot (name is historical). Its only consumer is ④ `/v3/compose`; `/v3/select-layout` itself is deterministic and needs no key. `mode=real` fails fast without it: compose degrades *silently* (green `completed`, empty `pagesTexts`, book full of template samples). |
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

## Change Notes

- Keep `routes.py` thin; route handlers should parse, log, enqueue background work, and return envelopes.
- Put multi-step work under `flows/`.
- Put model-backed capability code under `agents/`.
- Put deterministic transforms under `engine/`.
- Do not document removed endpoints as active until they exist again in `routes.py` and tests.
