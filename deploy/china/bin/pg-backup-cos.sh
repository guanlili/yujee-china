#!/usr/bin/env bash
# 每日 PG 全量备份 → 本地保留 7 天 + 上传 COS(私有桶 pg-backups/)。
#
# 2026-11-10 从 ~/yujee-clip/deploy/china/bin 搬出来:脚本和备份产物原本都住在
# 业务代码目录里,清理/重装 yujee-clip 时会连带把备份链一起删掉 —— 备份最不该
# 和业务放同一个篮子。现在统一在 ~/yujee-ops/ 下(仓库 deploy/china/bin 是版本源,
# 部署时同步过去)。
#
# 凭据仍读业务的 env/single.env:密钥只有一份,不复制第二份(复制等于多一个泄漏面)。
# 业务目录重建时 env 本来也必须恢复,这条依赖是可接受的。
set -euo pipefail

OPS_DIR="$HOME/yujee-ops"
ENV_FILE="$HOME/yujee-clip/deploy/china/env/single.env"
BACKUP_DIR="$OPS_DIR/backups"
ALERT="$OPS_DIR/bin/feishu-alert.sh"

# 失败时发飞书告警(成功时静默)
trap 'bash "$ALERT" "PG 备份失败" "每日数据库备份未完成。手动检查: bash $OPS_DIR/bin/pg-backup-cos.sh"' ERR

COS_BUCKET=$(grep "^R2_BUCKET=" "$ENV_FILE" | cut -d= -f2)
COS_KEY=$(grep "^R2_ACCESS_KEY_ID=" "$ENV_FILE" | cut -d= -f2)
COS_SECRET=$(grep "^R2_SECRET_ACCESS_KEY=" "$ENV_FILE" | cut -d= -f2)

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="yujee_pg_${STAMP}.sql.gz"

# 先写临时文件再改名:pg_dump 中途失败时不会留下一个"看起来是完整备份"的坏文件
# (find -mtime +7 只按时间删,gzip 半截文件会被当成有效备份留着)。
TMP="$BACKUP_DIR/.${FILE}.part"
docker exec yujee-postgres-1 pg_dump -U yujee -d yujee --no-owner --no-privileges \
  | gzip > "$TMP"
mv "$TMP" "$BACKUP_DIR/$FILE"

find "$BACKUP_DIR" -name "yujee_pg_*.sql.gz" -mtime +7 -delete

AWS_ACCESS_KEY_ID="$COS_KEY" AWS_SECRET_ACCESS_KEY="$COS_SECRET" \
  aws s3 cp "$BACKUP_DIR/$FILE" \
  "s3://${COS_BUCKET}/pg-backups/${FILE}" \
  --endpoint-url "https://${COS_BUCKET}.cos.ap-beijing.myqcloud.com"

echo "backup OK: $FILE ($(du -h "$BACKUP_DIR/$FILE" | cut -f1))"
