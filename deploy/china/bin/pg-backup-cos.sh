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

# 凭证不再在宿主机解析:容器 yujee-web-1 里已有 R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY
# 与 R2_BUCKET,上传直接读容器 env,密钥不用再过一遍 shell 变量(少一个泄漏面)。

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

# 上传走容器里的 AWS SDK,不用 aws cli。原因(2026-11-17 实测):
# ① aws cli 打自定义 endpoint 时强制 path-style → COS 直接拒
#    (PathStyleDomainForbidden);
# ② 换成桶级域名(https://<bucket>.cos...)会被 cli 再把桶名拼进 key,
#    备份落到 <bucket>/pg-backups/...(已攒了 20 个错前缀对象,恢复时按
#    pg-backups/ 找不到);
# ③ SDK(virtual-hosted style)+ 区域级 endpoint 才是 COS 认的写法——
#    和 apps/web/src/lib/r2/r2-client.ts 用的是同一套,key 落点一致。
docker cp "$BACKUP_DIR/$FILE" yujee-web-1:/tmp/pg-upload.sql.gz >/dev/null
docker exec -e BACKUP_FILE="$FILE" yujee-web-1 node -e '
const fs = require("fs");
import("@aws-sdk/client-s3").then(async ({ S3Client, PutObjectCommand }) => {
  const client = new S3Client({
    region: process.env.S3_REGION || "ap-beijing",
    endpoint: "https://cos.ap-beijing.myqcloud.com",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  const key = `pg-backups/${process.env.BACKUP_FILE}`;
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: fs.readFileSync("/tmp/pg-upload.sql.gz"),
    ContentType: "application/gzip",
  }));
  console.log("uploaded", key);
});'
docker exec yujee-web-1 rm -f /tmp/pg-upload.sql.gz

echo "backup OK: $FILE ($(du -h "$BACKUP_DIR/$FILE" | cut -f1))"
