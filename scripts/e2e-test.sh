#!/usr/bin/env bash
# End-to-end test: simulate browser submitting a job, then poll until COMPLETED.
# Assumes: web on :3002, agent on :8001, both with AGENT_SHARED_SECRET=dev_secret_2026.

set -e
WEB="${WEB:-http://127.0.0.1:3002}"
REQ_ID="$(uuidgen | tr 'A-Z' 'a-z')"
PIXEL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEAPwA/AKACgD/2Q=="

echo "▶ POST /api/v1/jobs (requestId=$REQ_ID)"
RES="$(curl -s -X POST "$WEB/api/v1/jobs" \
  -H 'Content-Type: application/json' \
  -d "$(cat <<JSON
{
  "requestId": "$REQ_ID",
  "prompt": "A spring trip to Kyoto with my mother",
  "language": "en",
  "photos": [
    {"photoId":"p1","base64":"$PIXEL","width":800,"height":600},
    {"photoId":"p2","base64":"$PIXEL","width":600,"height":800},
    {"photoId":"p3","base64":"$PIXEL","width":800,"height":800}
  ]
}
JSON
)")"
echo "  ↳ $RES"

ALBUM_ID="$(echo "$RES" | grep -oE '"albumId":"[^"]*"' | head -1 | cut -d'"' -f4)"
if [ -z "$ALBUM_ID" ]; then
  echo "✗ no albumId; aborting"
  exit 1
fi
echo "  ↳ albumId=$ALBUM_ID"

echo ""
echo "▶ polling /api/v1/jobs/$REQ_ID …"
for i in $(seq 1 30); do
  S="$(curl -s "$WEB/api/v1/jobs/$REQ_ID")"
  STATUS="$(echo "$S" | grep -oE '"status":"[A-Z_]+"' | head -1 | cut -d'"' -f4)"
  STAGE="$(echo "$S" | grep -oE '"stage":"[a-z]+"' | head -1 | cut -d'"' -f4)"
  PROG="$(echo "$S" | grep -oE '"progress":[0-9]+' | head -1 | cut -d':' -f2)"
  printf '  %02ds  status=%-10s  stage=%-10s  progress=%s\n' "$i" "${STATUS:-?}" "${STAGE:-?}" "${PROG:-?}"
  if [ "$STATUS" = "COMPLETED" ] || [ "$STATUS" = "FAILED" ]; then break; fi
  sleep 1
done

echo ""
echo "▶ GET /api/v1/albums/$ALBUM_ID"
DETAIL="$(curl -s "$WEB/api/v1/albums/$ALBUM_ID")"
echo "$DETAIL" | head -c 800
echo ""
echo ""
if [ "$STATUS" = "COMPLETED" ]; then
  echo "✓ PASS — end-to-end OK"
else
  echo "✗ FAIL — final status=$STATUS"
  exit 1
fi
