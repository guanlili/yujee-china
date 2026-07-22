# Yujee Agent

FastAPI service for the current minimal AI pipeline: image analysis, chapter grouping, and deterministic layout selection.

The previous edit-chat/theme/cover/finalize surfaces have been removed from the current Agent route surface. If Web still contains callers for those routes, treat that as a Web/Agent alignment task, not as an Agent README promise.

## Current Surface

| Endpoint | Mode | Purpose |
|---|---:|---|
| `GET /health` | sync | Health check |
| `POST /v3/analyze` | async `202` + callback | Image analysis and chapter tree generation |
| `POST /v3/select-layout` | async `202` + callback | Deterministic layout selection; one `completed` callback returns final `pages` (with template sample copy) |

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
```

`/v3/select-layout` is fully deterministic (no AI call): each unit takes a single seeded candidate, gets finalized into pages, and the template `sample` strings are filled into `texts`. It does not write real chapter copy.

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
| `SELECT_LAYOUT_API_KEY` | Gemini layout judge slot; missing/unavailable falls back where code allows |
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
