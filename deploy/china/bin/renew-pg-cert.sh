#!/usr/bin/env bash
# PG 自签证书自动续期(49.232 单机,cron 每日一跑)。
#
# 背景:web 的 db 客户端对非 localhost 强制 ssl:'require'(postgres.js 只加密
# 不校验),PG 挂的自签证书一旦过期,web 全线连不上库 —— 静默爆炸。此脚本在
# 证书剩余 ≤30 天时重新生成自签证书并让 PG 热重载(pg_reload_conf,零停机),
# 否则直接退出。幂等:证书未临近过期时无任何写动作。
#
# 替换方式用 `cat new > old` 保 inode:不改变现有文件的属主/权限(PG 对
# ssl key 权限敏感,挂载是 ro,别动 inode 之外的任何属性)。
set -euo pipefail

CERT_DIR="${1:-/root/yujee-clip/deploy/china/pgssl}"
CRT="$CERT_DIR/server.crt"
KEY="$CERT_DIR/server.key"
CONTAINER="${2:-yujee-postgres-1}"

[ -f "$CRT" ] || { echo "cert not found: $CRT" >&2; exit 1; }

# openssl x509 -checkend <秒>:证书在 N 秒内到期则返回非零。
if openssl x509 -checkend $((30 * 24 * 3600)) -noout -in "$CRT" 2>/dev/null; then
  echo "$(date '+%F %T') cert still valid >30d, skip"
  exit 0
fi

echo "$(date '+%F %T') renewing self-signed cert at $CRT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -subj "/CN=yujee-pg" \
  -keyout "$TMP/server.key" -out "$TMP/server.crt" >/dev/null 2>&1

cat "$TMP/server.crt" > "$CRT"
cat "$TMP/server.key" > "$KEY"

# 零停机重载:PG 会重新读取 ssl_cert_file/ssl_key_file。
docker exec "$CONTAINER" psql -U yujee -c "SELECT pg_reload_conf();"
echo "$(date '+%F %T') renewed + pg_reload_conf issued"
