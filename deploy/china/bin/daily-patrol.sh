#!/usr/bin/env bash
# 49.232 单机每日巡检(只读;WARN 经飞书群机器人告警,不阻断部署)。
# 输出统一进 /var/log/yujee-cron.log,格式带 PATROL 前缀与 [OK]/[WARN] 标记,
# 事后 grep PATROL 即可对账"哪天出过什么事"。
# 巡检项:
#   1. yujee compose 项目的容器状态(running 数 / 非 healthy 数)
#   2. 各容器内存占用快照(design-agent 单机内存态,OOM 重启丢会话 —— 重点盯)
#   3. 过去 24h 各容器日志 error 计数(web=pino JSON,engine=structlog,宽松 grep)
#   4. 根盘使用率
# 告警(2026-11-05 P1):本轮出现 [WARN] 时,结尾把全部 WARN 汇总成一条飞书群
# 机器人消息发出(一轮一条,避免刷屏);webhook 未配置则只打日志。
# 退出语义保持不变:本脚本永远以 0 结束(只读巡检,deploy 的成败由其后续
# 冒烟测试决定,见 deploy-from-git.sh;巡检告警失败绝不让 deploy 红)。
set -uo pipefail   # 故意不用 -e:单项失败不应中断其余巡检项

LOG_PREFIX="PATROL $(date '+%F %T')"
HOST_TAG="$(hostname 2>/dev/null || echo unknown-host)"
TIME_TAG="$(date '+%F %T')"
WARN_LINES=()   # 本轮巡检收集到的 [WARN] 正文行,结尾统一发一条飞书

# ── 告警:飞书群机器人 webhook 解析 + 发送 ──────────────────────
# 两种调用方式都能定位仓库根:deploy-from-git.sh 在仓库根执行(cwd 正确),
# crontab 用绝对路径调(此时 cwd 可能是 $HOME),故一律从脚本自身位置反推。
# 脚本位于 deploy/china/bin/,回仓库根需上溯三层:bin→china→deploy→repo。
PATROL_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$PATROL_DIR/../../.." && pwd)"

alert() {
  local msg="$1" webhook=""
  # 取值优先级:环境变量 → env/single.env 里的同名字段。
  if [ -n "${FEISHU_ALERT_WEBHOOK:-}" ]; then
    webhook="$FEISHU_ALERT_WEBHOOK"
  elif [ -f "$REPO_ROOT/deploy/china/env/single.env" ]; then
    webhook=$(grep -m1 '^FEISHU_ALERT_WEBHOOK=' "$REPO_ROOT/deploy/china/env/single.env" 2>/dev/null | cut -d= -f2-)
  fi
  if [ -z "$webhook" ]; then
    echo "$LOG_PREFIX [SKIP] alert: FEISHU_ALERT_WEBHOOK 未配置"
    return 0
  fi
  # 告警失败绝不影响巡检/部署;msg 内用字面 \n,飞书 text 消息会渲染成换行。
  # WARN 行均为本脚本自产(容器名/整数),不含 " 与反斜杠,直接拼 JSON 安全。
  curl -fsS -m 10 -X POST "$webhook" \
    -H 'Content-Type: application/json' \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"[yujee-cn 巡检告警] host=${HOST_TAG} time=${TIME_TAG}\\n${msg}\"}}" || true
}

# 打一行 PATROL 日志;tag=WARN 时收集进 WARN_LINES,结尾统一告警。
patrol_line() {
  local tag="$1"; shift
  echo "$LOG_PREFIX $*"
  if [ "$tag" = "WARN" ]; then
    WARN_LINES+=("$*")
  fi
}

# ── 1. 容器状态 ────────────────────────────────────────────────
TOTAL=$(docker ps -a --filter label=com.docker.compose.project=yujee --format '{{.Names}}' | wc -l)
RUNNING=$(docker ps --filter label=com.docker.compose.project=yujee --format '{{.Names}}' | wc -l)
UNHEALTHY=$(docker ps --filter label=com.docker.compose.project=yujee --filter health=unhealthy --filter health=starting --format '{{.Names}}' | tr '\n' ' ')
if [ "$RUNNING" -eq "$TOTAL" ] && [ -z "$UNHEALTHY" ]; then
  patrol_line OK "containers [OK] $RUNNING/$TOTAL running"
else
  patrol_line WARN "containers [WARN] running=$RUNNING/$TOTAL unhealthy='$UNHEALTHY'"
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
  patrol_line "$FLAG" "errcount [$FLAG] $c errors_24h=${ERRS:-0}"
done

# ── 4. 磁盘 ──────────────────────────────────────────────────
USE=$(df -h / | awk 'NR==2 {gsub("%","",$5); print $5}')
FLAG=OK; [ "$USE" -ge 80 ] && FLAG=WARN
patrol_line "$FLAG" "disk [$FLAG] root_use=${USE}%"

# ── 5. 告警汇总:本轮有 WARN 才发一条飞书;无 WARN 不打扰 ──────
if [ "${#WARN_LINES[@]}" -gt 0 ]; then
  body="共 ${#WARN_LINES[@]} 条 WARN:"
  for i in "${!WARN_LINES[@]}"; do
    body="${body}\n$((i+1)). ${WARN_LINES[$i]}"
  done
  alert "$body"
fi

# 显式 0 退出:与历史语义一致(最后一行 echo 即 0),告警/curl 任何失败都不透传。
exit 0
