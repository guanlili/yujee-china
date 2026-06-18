import assert from 'node:assert/strict';
import test from 'node:test';

// Regression for the R2 direct-upload break (2026-06-18): AWS SDK v3's default
// requestChecksumCalculation:'WHEN_SUPPORTED' bakes an x-amz-checksum-crc32 of
// the empty (sign-time) body into presigned PUT URLs; the browser then uploads
// a real body → checksum mismatch → R2 rejects (cover-thumbnail + PDF uploads).
// The client now pins WHEN_REQUIRED so PutObject presigns without a checksum.
// getSignedUrl computes locally, so dummy creds suffice (no network).
test('signed PUT URL carries no auto checksum params', async () => {
  process.env.R2_ACCOUNT_ID ||= 'testaccount';
  process.env.R2_ACCESS_KEY_ID ||= 'testkeyid';
  process.env.R2_SECRET_ACCESS_KEY ||= 'testsecret';
  const { r2 } = await import('./r2-client');

  const url = await r2.signPutUrl('cover-thumbs/u/a.jpg', 'image/jpeg', 300);

  assert.match(url, /X-Amz-Signature=/, 'must be a signed URL');
  assert.doesNotMatch(url, /x-amz-checksum/i, 'no checksum param may be signed in');
  assert.doesNotMatch(url, /x-amz-sdk-checksum-algorithm/i);
});
