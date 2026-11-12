#!/usr/bin/env bash
# 埋点表保留 90 天:每天清一次。
#
# 为什么要单独一个脚本:analytics-report.sh 是给人看的报表,--prune 只是它的附加
# 动作,输出一大段数字不适合进 cron 日志。这里只做清理并把"删了几条"打成一行。
# 这个数字平时应该一直是 0,突然变大说明有人在刷接口。
#
# 装在服务器 ubuntu 用户的 crontab(每天 4:30,排在 PG 备份 4:00 之后):
#   30 4 * * * bash ~/yujee-ops/bin/analytics-prune.sh >> ~/yujee-ops/backups/analytics-prune.log 2>&1
set -euo pipefail

deleted=$(sudo docker exec yujee-postgres-1 psql -U yujee -d yujee -tA -c \
  "with d as (delete from analytics_events where created_at < now() - interval '90 days' returning 1) select count(*) from d;")

echo "$(date -Iseconds) pruned=$deleted"
