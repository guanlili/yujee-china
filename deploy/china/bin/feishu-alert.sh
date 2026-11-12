#!/usr/bin/env bash
# 飞书群告警(2026-10-30 建立;2026-11-10 补响应校验)。
# 用法: feishu-alert.sh "标题" "详情"
#
# 为什么必须校验响应:飞书 webhook 在「机器人被移出群 / 被停用」时返回 HTTP 200 +
# {"code":19007,"msg":"Bot Not Enabled"} —— curl 本身是成功的,exit 0。
# 2026-11-10 实测就撞上了这个:告警每一条都"发出去了",群里一条没收到,
# 而巡检日志里没有任何痕迹。只看 exit code 等于不校验。
set -euo pipefail

ENV_FILE="$HOME/yujee-clip/deploy/china/env/single.env"
WEBHOOK=$(grep "^FEISHU_ALERT_WEBHOOK=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
if [ -z "$WEBHOOK" ]; then
  echo "feishu-alert: FEISHU_ALERT_WEBHOOK 未配置,跳过" >&2
  exit 0
fi

TITLE="${1:-告警}"
DETAIL="${2:-}"

RESP=$(curl -sS --max-time 10 -X POST "$WEBHOOK" \
  -H "Content-Type: application/json" \
  -d @- << JSON
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": { "tag": "plain_text", "content": "🚨 ${TITLE}" },
      "template": "red"
    },
    "elements": [
      { "tag": "div", "text": { "tag": "lark_md", "content": "${DETAIL}" } },
      { "tag": "note", "elements": [{ "tag": "plain_text", "content": "遇己生产告警 · $(hostname) · $(date '+%H:%M:%S')" }] }
    ]
  }
}
JSON
)

# 飞书成功响应:{"code":0,...}(新版) 或 {"StatusCode":0,...}(老版).
case "$RESP" in
  *'"code":0'*|*'"StatusCode":0'*) exit 0 ;;
  *)
    echo "feishu-alert FAILED: $RESP" >&2
    exit 1
    ;;
esac
