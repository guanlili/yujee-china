# Yujee Agent (FastAPI)

FastAPI service for the V3 album authoring flow. The current service surface is
V3 only; the retired `/v1/layout` mock pipeline is no longer part of the app.

Source of truth:

- HTTP contract: [`docs/agent/contract.md`](../../docs/agent/contract.md)
- Internal design: [`docs/agent/design.md`](../../docs/agent/design.md)
- Current operation audit: [`docs/agent/actual-operation-2026-06-27.md`](../../docs/agent/actual-operation-2026-06-27.md)

## Runtime Shape

```
apps/agent/
├── pyproject.toml
├── .env.example
├── alembic.ini
├── migrations/              # Agent-owned agent.* edit-loop schema
├── src/
│   ├── main.py              # FastAPI app, middleware, exception handlers
│   ├── routes.py            # /health, /v3/*, /internal/agent-ack
│   ├── settings.py          # pydantic-settings
│   ├── auth.py              # Bearer dependency
│   ├── schemas.py           # Python mirror of packages/contracts/src/v3.ts
│   ├── callback.py          # async job callback poster
│   ├── db.py                # Agent-owned edit session/op/message boundary
│   ├── flows/               # async orchestration: analyze, select-layout
│   ├── agents/              # model-backed capabilities
│   ├── engine/              # deterministic transforms
│   └── skills/              # human-authored skills loaded into agent prompts
└── tests/
```

## Setup

```bash
cd apps/agent
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Required local `.env` fields:

| name | note |
|---|---|
| `AGENT_SHARED_SECRET` | required; bearer secret shared with Web |
| `WEB_BASE_URL` | Web origin for edit-chat internal data calls |
| `DATABASE_URL` | required for `/v3/edit-chat` and `/internal/agent-ack`; optional for deterministic endpoints |
| `AGENT_PIPELINE_MODE` | `mock` or `real`; production must use `real` |
| `AGENT_ENV` | `development`, `staging`, or `production` |
| `ARK_API_KEY` | required at startup when `AGENT_PIPELINE_MODE=real` |
| `DEEPSEEK_API_KEY` | required at startup when `AGENT_PIPELINE_MODE=real` |
| `PORT` | default local port is `8001` |

`.env.example` contains a non-empty development placeholder for
`AGENT_SHARED_SECRET`; replace it when connecting to Web.

## Run

From repo root:

```bash
pnpm agent:dev
```

If `8001` is already occupied, keep the existing service running or choose a
different port:

```bash
PORT=8011 pnpm agent:dev
curl http://127.0.0.1:8011/health
```

Directly from `apps/agent`:

```bash
.venv/bin/uvicorn src.main:app --reload --port "${PORT:-8001}"
```

Health response:

```json
{"ok":true,"version":"1.0.0","timestamp":"..."}
```

## Endpoint Surface

| Endpoint | Mode | Purpose |
|---|---:|---|
| `GET /health` | sync | health check |
| `POST /v3/analyze` | async 202 + callback | Stage1 tree-only analysis from browser base64 |
| `POST /v3/select-layout` | async 202 + callback | Stage2 page selection from browser 200px refs |
| `POST /v3/chapter-chat` | sync | stateless single-chapter turn |
| `POST /v3/edit-chat` | sync + DB | current stateful authoring turn with pending op |
| `POST /v3/page-edit` | sync | focused page edit helper with safe talk fallback |
| `POST /v3/recommend` | sync | three book-level theme options |
| `POST /v3/apply-theme` | sync deterministic | apply selected theme to page patches |
| `POST /v3/cover` | sync awaited async | optional cover/ending design or skip |
| `POST /v3/finalize` | sync deterministic | flatten tree + pages into `AlbumLayoutPlan` |
| `POST /internal/agent-ack` | sync + DB | mark Web-committed edit op as committed |

All business endpoints require:

```http
Authorization: Bearer <AGENT_SHARED_SECRET>
Content-Type: application/json
```

## Stage Flow

```text
Web -> /v3/analyze
Web <- callback jobKind=analyze completed: V3LayoutTree only
Web -> /v3/select-layout
Web <- callback jobKind=select-layout completed: Page[]
Web -> /v3/edit-chat
Web -> /internal/agent-ack
Web -> /v3/recommend
Web -> /v3/apply-theme
Web -> /v3/cover
Web -> /v3/finalize
```

`/v3/analyze` no longer returns pages. Web keeps the init job open after the
tree callback and moves the album into editing only after `/v3/select-layout`
returns pages.

## Agent-Owned DB Migrations

The Agent owns only the independent Postgres schema `agent` for Stage3
edit-loop state. Web Drizzle does not manage these tables.

```bash
cd apps/agent
DATABASE_URL=postgresql://... alembic -c alembic.ini upgrade head
```

Production deploys must set `DATABASE_URL`; otherwise `/v3/edit-chat` and
`/internal/agent-ack` return infrastructure errors.

## Tests

Run Python tests from the repo root so the local `apps/agent/.env` does not
pollute provider-key isolation tests:

```bash
PYTHONPATH=apps/agent apps/agent/.venv/bin/python -m pytest apps/agent/tests
```

Useful focused checks:

```bash
PYTHONPATH=apps/agent apps/agent/.venv/bin/python -m pytest apps/agent/tests/test_v3_route_surface.py -q
PYTHONPATH=apps/agent apps/agent/.venv/bin/python -m pytest apps/agent/tests/test_startup_config.py -q
pnpm --filter @yujee/web exec tsx --test scripts/agent-dev-script.test.ts
```

If you intentionally run tests from `apps/agent`, be aware that
`Settings(env_file=".env")` will read `apps/agent/.env`.
