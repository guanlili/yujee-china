#!/usr/bin/env bash
# 埋点看数:在服务器上直接读 analytics_events,输出漏斗、成功率与耗时。
#
# 为什么不是网页看板:先要「能看见数」,不是先要一个 UI。这个脚本三秒出结果,
# 不改代码就能加一条查询;真到需要天天看的时候再谈看板。
#
# 用法(在服务器上):
#   bash deploy/china/bin/analytics-report.sh            # 近 7 天
#   bash deploy/china/bin/analytics-report.sh 30         # 近 30 天
#   bash deploy/china/bin/analytics-report.sh 7 --prune  # 顺带删掉 90 天前的
set -euo pipefail

DAYS="${1:-7}"
PRUNE=0
for arg in "$@"; do [ "$arg" = "--prune" ] && PRUNE=1; done
PSQL="sudo docker exec yujee-postgres-1 psql -U yujee -d yujee -tA"

q() { $PSQL -c "$1"; }

if [ "$PRUNE" = "1" ]; then
  deleted=$(q "with d as (delete from analytics_events where created_at < now() - interval '90 days' returning 1) select count(*) from d;")
  echo "pruned_older_than_90d=$deleted"
fi

echo "── 近 ${DAYS} 天事件计数 ──"
q "select name, count(*) from analytics_events where created_at > now() - interval '${DAYS} days' group by name order by 2 desc;"

echo "── 漏斗(近 ${DAYS} 天)──"
q "select
  (select count(*) from analytics_events where name='landing_view' and created_at > now() - interval '${DAYS} days') as landing,
  (select count(distinct subject_id) from analytics_events where name='landing_view' and created_at > now() - interval '${DAYS} days') as landing_visitors,
  (select count(distinct subject_id) from analytics_events where name='book_start' and created_at > now() - interval '${DAYS} days') as book_start,
  (select count(distinct subject_id) from analytics_events where name='export_ok' and created_at > now() - interval '${DAYS} days') as export_users,
  (select count(distinct subject_id) from analytics_events where name='checkout_click' and created_at > now() - interval '${DAYS} days') as checkout_users;"

echo "── 导出成功率(近 ${DAYS} 天)──"
q "select
  count(*) filter (where name='export_start') as starts,
  count(*) filter (where name='export_ok') as oks,
  count(*) filter (where name='export_fail' and (meta->>'step')='render') as render_fails,
  count(*) filter (where name='export_fail' and (meta->>'step')='upload') as upload_fails
  from analytics_events where created_at > now() - interval '${DAYS} days'
  and name in ('export_start','export_ok','export_fail');"

echo "── 导出耗时 p50 / p95(ms,近 ${DAYS} 天)──"
q "select
  round(percentile_cont(0.5) within group (order by value)::numeric) as p50,
  round(percentile_cont(0.95) within group (order by value)::numeric) as p95,
  count(*) as samples
  from analytics_events where name='export_ok' and value is not null
  and created_at > now() - interval '${DAYS} days';"

echo "── 云端备份上传(近 ${DAYS} 天)──"
q "select
  count(*) filter (where name='upload_ok') as ok_batches,
  coalesce(sum(value) filter (where name='upload_ok'),0) as photos_ok,
  count(*) filter (where name='upload_fail') as fail_batches,
  coalesce(sum(value) filter (where name='upload_fail'),0) as photos_failed
  from analytics_events where created_at > now() - interval '${DAYS} days'
  and name in ('upload_ok','upload_fail');"

echo "── 前端错误 Top(近 ${DAYS} 天)──"
q "select count(*) as hits, meta->>'kind' as kind, left(meta->>'message', 60) as message
  from analytics_events where name='client_error' and created_at > now() - interval '${DAYS} days'
  group by 2,3 order by 1 desc limit 10;"

echo "── 表体积 ──"
q "select pg_size_pretty(pg_total_relation_size('analytics_events')) as total, count(*) from analytics_events;"
