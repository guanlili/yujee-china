#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$HERE/.." && pwd)"
cd "$AGENT_DIR"

if [[ ! -d .venv ]]; then
  echo "[setup] creating .venv"
  python3 -m venv .venv
  ./.venv/bin/pip install -q -e . >/dev/null
fi

SECRET="${AGENT_SHARED_SECRET:-dev_secret_e2e}"
AGENT_PORT="${AGENT_PORT:-8001}"
SINK_PORT="${SINK_PORT:-8002}"
SINK_LOG="$(mktemp -t agent_e2e_sink.XXXXXX.log)"
AGENT_LOG="$(mktemp -t agent_e2e_agent.XXXXXX.log)"
V2_INIT_PAYLOAD="$(mktemp -t agent_e2e_v2init.XXXXXX.json)"

cleanup() {
  set +e
  [[ -n "${AGENT_PID:-}" ]] && kill "$AGENT_PID" 2>/dev/null
  [[ -n "${SINK_PID:-}" ]] && kill "$SINK_PID" 2>/dev/null
  wait 2>/dev/null
  rm -f "$SINK_LOG" "$AGENT_LOG" "$V2_INIT_PAYLOAD"
}
trap cleanup EXIT

cat > "$V2_INIT_PAYLOAD" <<JSON
{
  "requestId": "req_e2e_v2init",
  "albumId": "alb_e2e",
  "callbackUrl": "http://127.0.0.1:${SINK_PORT}/api/v2/internal/job-progress",
  "language": "en",
  "meta": {"promptHint": "A spring day in Kyoto"},
  "photos": [
    {"photoId": "p1", "base64": "data:image/jpeg;base64,AAA", "width": 800, "height": 600, "exif": {"takenAt": "2024-01-01T10:00:00Z"}},
    {"photoId": "p2", "base64": "data:image/jpeg;base64,BBB", "width": 600, "height": 800, "exif": {"takenAt": "2024-01-01T10:01:00Z"}},
    {"photoId": "p3", "base64": "data:image/jpeg;base64,CCC", "width": 800, "height": 800, "exif": {"takenAt": "2024-01-02T10:00:00Z"}}
  ]
}
JSON

echo "[setup] starting callback sink on :${SINK_PORT}"
./.venv/bin/python -c "
import sys, json
from fastapi import FastAPI, Request
import uvicorn
app = FastAPI()
@app.post('/api/v2/internal/job-progress')
async def cb_v2(req: Request):
    body = await req.json()
    has_draft = 'draftTree' in body
    print('V2CALLBACK event=' + str(body.get('event')) + ' stage=' + str(body.get('stage')) + ' draftTree=' + str(has_draft), flush=True)
    return {'ok': True}
uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[1]), log_level='warning')
" "$SINK_PORT" >"$SINK_LOG" 2>&1 &
SINK_PID=$!

echo "[setup] starting agent on :${AGENT_PORT}"
AGENT_SHARED_SECRET="$SECRET" PORT="$AGENT_PORT" \
  ./.venv/bin/uvicorn src.main:app --port "$AGENT_PORT" --log-level warning >"$AGENT_LOG" 2>&1 &
AGENT_PID=$!

for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${AGENT_PORT}/health" >/dev/null; then break; fi
  sleep 0.25
done
for _ in $(seq 1 40); do
  if curl -sf -X OPTIONS "http://127.0.0.1:${SINK_PORT}/api/v2/internal/job-progress" >/dev/null 2>&1 \
    || curl -s -o /dev/null "http://127.0.0.1:${SINK_PORT}/api/v2/internal/job-progress"; then break; fi
  sleep 0.25
done

echo
echo "[test] GET /health"
curl -sf "http://127.0.0.1:${AGENT_PORT}/health"
echo

echo
echo "[test] POST /v2/album/init (happy path)"
curl -sf -X POST "http://127.0.0.1:${AGENT_PORT}/v2/album/init" \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: req_e2e_v2init" \
  -d @"$V2_INIT_PAYLOAD"
echo

echo "[wait] giving the init job 12s to finish..."
sleep 12

echo
echo "[sink] callbacks received:"
echo
cat "$SINK_LOG"

V2_DRAFT=$(grep -c 'V2CALLBACK event=completed stage=None draftTree=True' "$SINK_LOG" || true)
V2_VISION=$(grep -c 'V2CALLBACK event=progress stage=vision' "$SINK_LOG" || true)
V2_GROUPING=$(grep -c 'V2CALLBACK event=progress stage=grouping' "$SINK_LOG" || true)
V2_SKELETON=$(grep -c 'V2CALLBACK event=progress stage=skeleton' "$SINK_LOG" || true)

echo "[summary v2] vision=$V2_VISION grouping=$V2_GROUPING skeleton=$V2_SKELETON draftCompleted=$V2_DRAFT"

if [[ "$V2_DRAFT" -lt 1 ]]; then
  echo "FAIL: expected v2 init completed callback carrying draftTree"
  exit 1
fi
if [[ "$V2_VISION" -lt 1 || "$V2_GROUPING" -lt 1 || "$V2_SKELETON" -lt 1 ]]; then
  echo "FAIL: expected v2 init progress for vision, grouping and skeleton stages"
  exit 1
fi

echo "PASS"
