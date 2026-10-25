import assert from 'node:assert/strict';
import test from 'node:test';

// S3_REGION 未显式给时,region 应从 COS 域名推导(cos.<region>.myqcloud.com)——
// SigV4 的 region 错了 COS 直接拒签。独立文件:env/client 是进程级单例。
test('region derives from COS endpoint host when S3_REGION unset', async () => {
  process.env.S3_ENDPOINT = 'https://cos.ap-shanghai.myqcloud.com';
  delete process.env.S3_REGION;
  process.env.R2_ACCESS_KEY_ID ||= 'testkeyid';
  process.env.R2_SECRET_ACCESS_KEY ||= 'testsecret';
  process.env.R2_BUCKET ||= 'yujee-s3-test';
  const { r2 } = await import('./r2-client');

  const url = await r2.signGetUrl('photo-originals/album-1/photo-1.jpg', 60);
  // Credential 查询参数里的 / 会被编码为 %2F,先解码再断言。
  assert.match(decodeURIComponent(url), /ap-shanghai\/s3\/aws4_request/, 'region 应从域名推导为 ap-shanghai');
});
