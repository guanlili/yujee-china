import assert from 'node:assert/strict';
import test from 'node:test';

// MinIO 等自建存储需要 path-style(桶名在路径而非子域)。独立文件:env/client 单例。
test('S3_FORCE_PATH_STYLE puts the bucket in the path (MinIO style)', async () => {
  process.env.S3_ENDPOINT = 'http://minio.internal:9000';
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.R2_ACCESS_KEY_ID ||= 'testkeyid';
  process.env.R2_SECRET_ACCESS_KEY ||= 'testsecret';
  process.env.R2_BUCKET = 'yujee-minio';
  const { r2 } = await import('./r2-client');

  const url = await r2.signPutUrl('pdfs/album-1/out.pdf', 'application/pdf', 300);
  assert.match(url, /minio\.internal:9000\/yujee-minio\//, 'path-style: 桶名必须在路径里');
  assert.doesNotMatch(url, /yujee-minio\.minio\.internal/, '不得用虚拟主机风格');
});
