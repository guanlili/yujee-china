#!/usr/bin/env bash
# 服务器资源检查:磁盘 ≥80% 或可用内存 <1GB 时发飞书。每小时跑一次。
# 2026-11-10:随告警脚本一起搬到 ~/yujee-ops/bin(不再依赖业务目录)。
set -euo pipefail

ALERT="$HOME/yujee-ops/bin/feishu-alert.sh"

DISK_PCT=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}')
MEM_MB=$(free -m | awk '/^Mem:/ {print $7}')
ALERT_TEXT=""

if [ "$DISK_PCT" -ge 80 ]; then
  ALERT_TEXT="磁盘使用率 ${DISK_PCT}%(阈值80%)<br>"
fi
if [ "$MEM_MB" -lt 1024 ]; then
  ALERT_TEXT="${ALERT_TEXT}可用内存 ${MEM_MB}MB(阈值1GB)<br>"
fi

if [ -n "$ALERT_TEXT" ]; then
  bash "$ALERT" "服务器资源告警" "${ALERT_TEXT}请检查 49.232 服务器"
fi
