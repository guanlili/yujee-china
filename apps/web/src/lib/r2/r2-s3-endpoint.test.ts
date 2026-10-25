import assert from 'node:assert/strict';
import test from 'node:test';

// 国内 S3 兼容存储(COS/MinIO):S3_ENDPOINT 覆盖 R2 endpoint 后,presign 必须
// 落在自定义域名上、SigV4 region 与桶地域一致,且同样不带 checksum 参数
// (r2-presign.test.ts 那次 R2 事故的同等防线,COS 上一样致命)。
// 注意:env 与 client 是进程级单例,每个用例一个文件(仓内惯例的 env 隔离方式)。
test('S3_ENDPOINT override presigns against the custom endpoint', async () => {
  process.env.S3_ENDPOINT = 'https://cos.ap-beijing.myqcloud.com';
  process.env.S3_REGION = 'ap-beijing';
  process.env.R2_ACCESS_KEY_ID ||= 'testkeyid';
  process.env.R2_SECRET_ACCESS_KEY ||= 'testsecret';
  process.env.R2_BUCKET = 'yujee-s3-test';
  const { r2 } = await import('./r2-client');

  const url = await r2.signPutUrl('analyze-uploads/u/s/p1.jpg', 'image/jpeg', 300);

  assert.match(url, /cos\.ap-beijing\.myqcloud\.com/, 'presign 必须落在自定义 endpoint 域');
  assert.match(url, /X-Amz-Signature=/, 'must be a signed URL');
  // Credential 查询参数里的 / 会被编码为 %2F,先解码再断言。
  const decoded = decodeURIComponent(url);
  assert.match(decoded, new RegExp('ap-beijing/s3/aws4_request'), 'SigV4 region 必须与桶地域一致');
  assert.doesNotMatch(url, /x-amz-checksum/i, 'no checksum param may be signed in');
  assert.doesNotMatch(url, /r2\.cloudflarestorage\.com/, '不得再回退到 R2 域');
});
