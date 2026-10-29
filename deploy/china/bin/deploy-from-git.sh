#!/usr/bin/env bash
# GitHub Actions 经 restricted SSH key 触发的自动部署。
# authorized_keys 侧 ForceCommand 锁死本脚本,CI 端 ssh 发什么命令都无关。
#
# 数据流:git fetch(仓为 public,免凭证)→ reset --hard(未跟踪的
# env/pgssl/weights 不受影响)→ compose build+up(层缓存增量)→ 验证。
# weights/(540MB CLIP/isnet 权重)不进 git:新机器重建时须单独传输(README 有记)。
set -euo pipefail

cd /home/ubuntu/yujee-clip
mkdir -p logs
LOG=logs/deploy.log

# 输出双写:CI job log(经 ssh stdout 回传)+ 本地留档。
exec > >(tee -a "$LOG") 2>&1

# ── 自愈(2026-10-29):清理孤儿构建进程 ─────────────────────────────
# 部署并发组(cancel-in-progress:false)排队不取消,但 GitHub Actions 侧 job
# 超时或手动取消时,服务器上的 docker compose build 可能已被杀掉客户端但
# buildkit 守护进程侧还在跑 —— 留下一个占着锁/带宽的孤儿进程,下一轮部署
# 会撞上或被拖慢。2026-10-28 连环取消踩过三次。
# 注意 pkill 模式不能用自身命令行匹配(会自杀 SSH 会话,踩过的坑)。
if pgrep -f "docker[ ]compose.*yujee" >/dev/null 2>&1; then
  echo "orphan compose detected, killing..."
  pkill -f "docker[ ]compose.*yujee" || true
  sleep 2
fi

echo "=== deploy start $(date '+%F %T') from $(git rev-parse --short HEAD) ==="
git fetch -q --depth=1 origin main
git reset -q --hard FETCH_HEAD
echo "now at $(git log -1 --format='%h %s')"

# --wait 等全部服务 healthy/running;--wait-timeout 防个别 healthcheck 卡死拖住整次部署。
# build 走层缓存:无代码变更的服务秒级跳过重建。
docker compose -f deploy/china/compose.single.yml \
  --env-file deploy/china/env/single.env \
  up -d --build --wait --wait-timeout 300

# 数据库迁移(2026-10-27 起):web 容器带完整 builder 工作区(devDeps +
# migrations),容器内跑 drizzle-kit migrate —— 幂等(journal 跟踪),单 web
# 实例无并发迁移问题。此前迁移只在建站时手动跑过一次,之后的新迁移全部漏掉
# (0033 手机号列是第一例)。放 compose up 之后:新迁移都是加性可空列,新代码
# 在迁移完成前的短窗口不碰新列;迁移失败 deploy 红(set -e),可重跑。
docker compose -f deploy/china/compose.single.yml \
  --env-file deploy/china/env/single.env \
  exec -T web pnpm --filter @yujee/web db:migrate

# 部署后验证:首页 200(308→/en 相对跳转)+ 巡检(容器/内存/error/磁盘)。
# web 刚 Started 时 Next.js 监听未就绪,curl 会被 reset —— retry-connrefused 等它。
curl -fsS -m 15 -L --retry 6 --retry-connrefused --retry-delay 3 \
  -o /dev/null -w "home http %{http_code}\n" http://127.0.0.1:8080/
bash deploy/china/bin/daily-patrol.sh

# ── 冒烟测试(2026-10-29):五容器关键端点逐个验证 ────────────────────
# daily-patrol 查的是容器层面(healthy);这里补应用层冒烟——每个容器的
# 核心端点各打一发,确认不是「容器活着但应用挂了」。
smoke_fail=0

smoke() {
  local name="$1" url="$2" expect="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$url" 2>/dev/null) || code="000"
  if [ "$code" = "$expect" ] || [ "$code" = "308" ]; then
    echo "smoke ✓ $name ($code)"
  else
    echo "smoke ✗ $name: expected $expect got $code"
    smoke_fail=1
  fi
}

smoke web        "http://127.0.0.1:8080/"                                  "200"
smoke web-api    "http://127.0.0.1:8080/api/v1/health"                      "200"
smoke agent      "http://127.0.0.1:8002/health"                             "200"
smoke design     "http://$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' yujee-design-agent-1 2>/dev/null):8787/health" "200"
smoke postgres   "http://127.0.0.1:5432/"                                   "000"  # PG 不走 HTTP,容器 healthy 即可
smoke clip       "http://127.0.0.1:8001/health"                             "200"

# postgres/clip 的 HTTP 码不适用,用 docker inspect 兜底:
for c in yujee-postgres-1 yujee-clip-1; do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null) || status="unknown"
  if [ "$status" = "healthy" ]; then
    echo "smoke ✓ $c (healthy)"
  else
    echo "smoke ✗ $c: $status"
    smoke_fail=1
  fi
done

if [ "$smoke_fail" = "1" ]; then
  echo "SMOKE TEST FAILED"
  exit 1
fi

echo "=== deploy done $(date '+%F %T') ==="
