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
# 部署前的线上版本:必须在 reset/compose up 之前记录,作为回滚目标(见 rollback)。
PREV_HEAD=$(git rev-parse HEAD)
git fetch -q --depth=1 origin main
git reset -q --hard FETCH_HEAD
echo "now at $(git log -1 --format='%h %s')"

# ── 回滚(2026-11-04 P0):部署验证失败时恢复到部署前的 PREV_HEAD ──────
# 调用点:migrate 失败 / smoke 失败。此刻新代码已 reset+compose up 上线,
# 必须 git 回退 + 旧代码重建,否则线上跑「新代码+旧 schema」或坏版本。
rollback() {
  local reason="$1"
  echo "=== ROLLBACK ($reason): restoring $PREV_HEAD ==="
  cd /home/ubuntu/yujee-clip
  # git 回退失败(如浅克隆对象被 gc)时工作区仍是新代码,重建无意义 → 停止并人工介入。
  git reset -q --hard "$PREV_HEAD" || {
    echo "FATAL: git reset to $PREV_HEAD failed; manual intervention required"
    exit 1
  }
  echo "now at $(git log -1 --format='%h %s') (rollback)"
  docker compose -f deploy/china/compose.single.yml \
    --env-file deploy/china/env/single.env \
    up -d --build --wait --wait-timeout 300 || {
    echo "FATAL: rollback compose up failed; manual intervention required"
    exit 1
  }
  echo "=== ROLLBACK DONE ==="
  exit 1
}

# --wait 等全部服务 healthy/running;--wait-timeout 防个别 healthcheck 卡死拖住整次部署。
# build 走层缓存:无代码变更的服务秒级跳过重建。
docker compose -f deploy/china/compose.single.yml \
  --env-file deploy/china/env/single.env \
  up -d --build --wait --wait-timeout 300

# 数据库迁移(2026-10-30 standalone 适配 / 2026-11-05 P1 修复):standalone 镜像
# 不含 devDeps 的 drizzle-kit CLI,容器内跑不了 db:migrate,从宿主机 checkout 跑。
# 旧实现两个坑(2026-11-05 定位):① `npx pnpm install` 在 SSH ForceCommand 的非登录
# shell 里会去 npm registry 现拉 pnpm,失败;② `2>/dev/null` 吞掉失败原因,配旧版
# `|| echo WARN` 让这一步从 10-30 起静默坏了(#93/#94 部署日志可见 WARN)。
# 现在:显式解析 pnpm(pnpm → corepack pnpm 兜底)、打印诊断、保留原始 stderr,
# 失败仍走 fail-fast + 回滚(2026-11-04 P0);可重跑;幂等(journal 跟踪)。
NODE_VER=$(node --version 2>/dev/null || echo none)
echo "MIGRATE diag: node=$NODE_VER pnpm=$(command -v pnpm || echo none) corepack=$(command -v corepack || echo none)"
PNPM=""
if command -v pnpm >/dev/null 2>&1; then
  PNPM="pnpm"
elif command -v corepack >/dev/null 2>&1; then
  PNPM="corepack pnpm"
fi
MIGRATE_OK=0
if [ -z "$PNPM" ]; then
  echo "MIGRATE FATAL: 宿主机既没有 pnpm 也没有 corepack"
else
  echo "MIGRATE diag: pnpm_version=$($PNPM --version 2>&1 || echo unknown) cwd=$(pwd)"
  if $PNPM install --frozen-lockfile --prod=false --filter "@yujee/web..."; then
    # postgres 容器未把 5432 publish 到宿主机(localhost:5432 不可达,2026-11-05 定位),
    # 改用容器网桥 IP(宿主机可路由;design-agent health 探测同法)。
    PG_HOST=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' yujee-postgres-1 2>/dev/null)
    [ -n "$PG_HOST" ] || PG_HOST="127.0.0.1"
    echo "MIGRATE diag: pg_host=$PG_HOST (宿主机无 5432 publish,走容器网桥 IP)"
    # 密码不走命令行 env 前缀(会随命令行/排障日志外泄),先 export 再调用;
    # fail-fast + 回滚语义不变(下方 if 仍只看 drizzle-kit 退出码)。
    export DATABASE_URL="postgres://yujee:$(grep ^PG_PASSWORD= deploy/china/env/single.env | cut -d= -f2)@${PG_HOST}:5432/yujee"
    if $PNPM --filter @yujee/web exec drizzle-kit migrate; then
      MIGRATE_OK=1
    else
      echo "MIGRATE FAILED: drizzle-kit migrate 退出码非 0(上方为原始输出)"
    fi
  else
    echo "MIGRATE FAILED: pnpm install 退出码非 0(上方为原始输出)"
  fi
fi
[ "$MIGRATE_OK" = 1 ] || rollback "db:migrate failed"

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
  if [ "$expect" = "no5xx" ]; then
    # 「非 5xx」模式:登录态/重定向类页面,2xx/3xx/4xx 都算过,唯独 5xx 和不可达要拦。
    if [ "$code" != "000" ] && [ "${code:0:1}" != "5" ]; then
      echo "smoke ✓ $name ($code, 非5xx)"
    else
      echo "smoke ✗ $name: got $code (5xx 或不可达)"
      smoke_fail=1
    fi
    return
  fi
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

# ── 层 B(2026-11-04):营销动态路由逐个冒烟 ───────────────────────────
# 这些页面是动态 SSR,build 期不渲染,CI 四门全绿也拦不住 —— ChangelogBadge 曾用
# next-intl 客户端 hook 在无 Provider 的子树里把整面打成 500 且线上才爆(#90)。
# 部署后逐条打一发:营销页必须 200;/zh/my-albums 需登录(未带会话时中间件 307
# 去登录页),故用 no5xx 断言 —— 2xx/3xx/4xx 均可,唯独 5xx 必须拦。
# localePrefix=always,默认 zh,故走 /zh/ 前缀 URL。
for _p in examples guides pricing privacy terms about/story; do
  smoke "marketing /zh/$_p" "http://127.0.0.1:8080/zh/$_p" "200"
done
smoke "marketing /zh/my-albums" "http://127.0.0.1:8080/zh/my-albums" "no5xx"


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
  rollback "SMOKE TEST FAILED"
fi

echo "=== deploy done $(date '+%F %T') ==="
