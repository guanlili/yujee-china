#!/usr/bin/env bash
# 49.232 单机每日巡检(只读,不告警 —— 上线 uptime-kuma 前的黑匣子)。
# 输出统一进 /var/log/yujee-cron.log,格式带 PATROL 前缀与 [OK]/[WARN] 标记,
# 事后 grep PATROL 即可对账"哪天出过什么事"。
# 巡检项:
#   1. yujee compose 项目的容器状态(running 数 / 非 healthy 数)
#   2. 各容器内存占用快照(design-agent 单机内存态,OOM 重启丢会话 —— 重点盯)
#   3. 过去 24h 各容器日志 error 计数(web=pino JSON,engine=structlog,宽松 grep)
#   4. 根盘使用率
set -uo pipefail   # 故意不用 -e:单项失败不应中断其余巡检项

LOG_PREFIX="PATROL $(date '+%F %T')"

# ── 1. 容器状态 ────────────────────────────────────────────────
TOTAL=$(docker ps -a --filter label=com.docker.compose.project=yujee --format '{{.Names}}' | wc -l)
RUNNING=$(docker ps --filter label=com.docker.compose.project=yujee --format '{{.Names}}' | wc -l)
UNHEALTHY=$(docker ps --filter label=com.docker.compose.project=yujee --filter health=unhealthy --filter health=starting --format '{{.Names}}' | tr '\n' ' ')
if [ "$RUNNING" -eq "$TOTAL" ] && [ -z "$UNHEALTHY" ]; then
  echo "$LOG_PREFIX containers [OK] $RUNNING/$TOTAL running"
else
  echo "$LOG_PREFIX containers [WARN] running=$RUNNING/$TOTAL unhealthy='$UNHEALTHY'"
fi

# ── 2. 内存快照(%:容器用量占其 limit)────────────────────────
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' \
  | grep '^yujee-' | while read -r name usage rest; do
    echo "$LOG_PREFIX mem $name ${usage%%/*}"  # 只记绝对用量,limit 在 compose 里
  done

# ── 3. 24h error 计数 ─────────────────────────────────────────
for c in $(docker ps --filter label=com.docker.compose.project=yujee --format '{{.Names}}'); do
  ERRS=$(docker logs --since 24h "$c" 2>&1 | grep -ci -m 2001 'error' || true)
  FLAG=OK; [ "${ERRS:-0}" -gt 100 ] && FLAG=WARN
  echo "$LOG_PREFIX errcount [$FLAG] $c errors_24h=${ERRS:-0}"
done

# ── 4. 磁盘 ──────────────────────────────────────────────────
USE=$(df -h / | awk 'NR==2 {gsub("%","",$5); print $5}')
FLAG=OK; [ "$USE" -ge 80 ] && FLAG=WARN
echo "$LOG_PREFIX disk [$FLAG] root_use=${USE}%"
