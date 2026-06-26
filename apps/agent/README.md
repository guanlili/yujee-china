# Yujee Agent (FastAPI)

Stateless layout service. Web posts `POST /v1/layout`, Agent 202-accepts and runs
the pipeline on a `BackgroundTask`, then pushes `progress` / `completed` / `failed`
events to the caller's `callbackUrl`.

Source of truth: [`docs/agent/contract.md`](../../docs/agent/contract.md).

This first version ships a **mock pipeline** — no Volc / DeepSeek calls. It walks
the three stages (`vision` -> `writing` -> `composing`), pauses 1 s per step,
and emits a synthetic `AlbumLayoutPlan` so Web can dogfood the full callback /
polling loop end to end.

## Layout

```
apps/agent/
├── pyproject.toml
├── .env.example
├── tests/
│   └── test_e2e.sh          # spins up agent + sink, asserts callback counts
└── src/
    ├── main.py              # FastAPI app, middleware, exception handlers
    ├── settings.py          # pydantic-settings
    ├── auth.py              # Bearer dependency
    ├── schemas.py           # request + AlbumLayoutPlan + callback envelope
    ├── logging_config.py    # structlog + requestId contextvar
    ├── routes/
    │   ├── health.py        # GET /health
    │   └── layout.py        # POST /v1/layout (202 + BackgroundTasks)
    └── services/
        ├── pipeline.py      # orchestrates vision -> writing -> composing
        ├── vision_mock.py   # synthetic PhotoAnalysis
        ├── planning_mock.py # synthetic AlbumLayoutPlan
        └── callback.py      # httpx POST, 10s timeout, 2 retries (1s/4s)
```

## Setup

```bash
cd apps/agent
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
echo "AGENT_SHARED_SECRET=dev_secret_$(date +%s)" >> .env
```

Required envs (see `.env.example`):

| name | default | note |
|---|---|---|
| `AGENT_SHARED_SECRET` | — | required; startup fails if missing |
| `WEB_BASE_URL` | `http://localhost:3000` | Web origin (not used by mock pipeline) |
| `DATABASE_URL` | — | required for agent-owned `agent.*` edit-loop tables and `/internal/agent-ack` |
| `BACKGROUND_TASK_TIMEOUT_SECONDS` | `180` | soft cap for pipeline.run |
| `PORT` | `8001` | uvicorn port |
| `LOG_LEVEL` | `info` | structlog filtering bound logger level |

## Agent-owned DB migrations

The Agent owns only the independent Postgres schema `agent` for Stage3 edit-loop
state. Web Drizzle does not manage these tables. Migration assets live in
`apps/agent/alembic.ini` and `apps/agent/migrations/` and are copied into the
Docker image.

```bash
cd apps/agent
DATABASE_URL=postgresql://... alembic -c alembic.ini upgrade head
```

Production deploys must set `DATABASE_URL`; otherwise `/internal/agent-ack`
returns an infrastructure error instead of treating the op as unknown.

## Run

From repo root:

```bash
pnpm agent:dev
```

Or directly:

```bash
cd apps/agent && source .venv/bin/activate
uvicorn src.main:app --reload --port 8001
```

Smoke:

```bash
curl http://localhost:8001/health
# {"ok":true,"version":"1.0.0","timestamp":"..."}
```

## End-to-end verification

`tests/test_e2e.sh` starts a local sink on `:8002`, starts the agent on `:8001`,
fires a happy-path request and a `prompt=="FAIL_TEST"` request, then asserts the
sink received >= 9 progress callbacks, >= 1 completed, and >= 1 failed.

```bash
bash apps/agent/tests/test_e2e.sh
```

Expected tail:

```
[summary] progress=9 completed=1 failed=1
PASS
```

Last verified run on this machine (2026-05-27):

```
[test] GET /health
{"ok":true,"version":"1.0.0","timestamp":"2026-05-26T18:25:51.332677Z"}

[test] POST /v1/layout (happy path)
{"ok":true,"data":{"requestId":"req_e2e_ok","accepted":true}}

[test] POST /v1/layout (FAIL_TEST)
{"ok":true,"data":{"requestId":"req_e2e_fail","accepted":true}}

CALLBACK {"requestId":"req_e2e_ok","event":"progress","stage":"vision","progress":0}
CALLBACK {"requestId":"req_e2e_fail","event":"failed","error":{"code":"AGENT_VISION_FAILED","message":"forced failure for test"}}
CALLBACK {"requestId":"req_e2e_ok","event":"progress","stage":"vision","progress":50}
CALLBACK {"requestId":"req_e2e_ok","event":"progress","stage":"vision","progress":100}
CALLBACK {"requestId":"req_e2e_ok","event":"progress","stage":"writing","progress":0}
CALLBACK {"requestId":"req_e2e_ok","event":"progress","stage":"writing","progress":50}
CALLBACK {"requestId":"req_e2e_ok","event":"progress","stage":"writing","progress":100}
CALLBACK {"requestId":"req_e2e_ok","event":"progress","stage":"composing","progress":0}
CALLBACK {"requestId":"req_e2e_ok","event":"progress","stage":"composing","progress":50}
CALLBACK {"requestId":"req_e2e_ok","event":"progress","stage":"composing","progress":100}
CALLBACK {"requestId":"req_e2e_ok","event":"completed","layout":{...full AlbumLayoutPlan...}}

[summary] progress=9 completed=1 failed=1
PASS
```

## Mock pipeline behaviour

For each request the background task emits, per stage in
`vision -> writing -> composing`:

1. `event=progress progress=0` -> sleep 1s
2. `event=progress progress=50` -> sleep 1s
3. `event=progress progress=100`

Then a synthetic `AlbumLayoutPlan` (cover-01 + spread-01 + spread-02 pages) and
`event=completed` with `usage.durationMs`.

Test hook: `prompt == "FAIL_TEST"` skips the stages and emits a single
`event=failed` with `code=AGENT_VISION_FAILED`.

Total wall time per request: ~6-7 s.

## Hot points

- No state: the process holds no DB / disk / cache. Restarts drop in-flight tasks.
- Callbacks: 10 s timeout, 2 retries with 1 s / 4 s backoff, then log and drop.
  Web has its own zombie-job sweeper as the safety net.
- Bearer secret is read from env at module import. It is not logged.
