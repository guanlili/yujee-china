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
echo "=== deploy done $(date '+%F %T') ==="
