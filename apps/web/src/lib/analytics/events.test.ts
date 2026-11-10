import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_MAX_BATCH,
  ANALYTICS_META_KEYS,
  isAnalyticsEventName,
  isAnalyticsMetaKey,
  sanitizeAnalyticsMessage,
} from './events';

const here = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(join(here, '..', '..', p), 'utf8');

test('only whitelisted event names are accepted', () => {
  assert.equal(isAnalyticsEventName('export_ok'), true);
  assert.equal(isAnalyticsEventName('upload_fail'), true);
  // 拼错/临时调试名一律不认:否则成功率的分子分母不可信
  assert.equal(isAnalyticsEventName('export_sucess'), false);
  assert.equal(isAnalyticsEventName('debug_whatever'), false);
  // 事件名表本身不能塞进任何带个人信息的东西
  assert.ok(ANALYTICS_EVENT_NAMES.every((n) => /^[a-z_]{3,40}$/.test(n)));
});

test('meta keys are whitelisted, so free-form text cannot leak content', () => {
  assert.equal(isAnalyticsMetaKey('step'), true);
  assert.equal(isAnalyticsMetaKey('message'), true);
  assert.equal(isAnalyticsMetaKey('albumTitle'), false);
  assert.equal(isAnalyticsMetaKey('photoUrl'), false);
  assert.equal(isAnalyticsMetaKey('email'), false);
  assert.ok(ANALYTICS_META_KEYS.every((k) => /^[a-zA-Z]{2,20}$/.test(k)));
});

test('error messages are sanitized before landing in the database', () => {
  // query string 里常有 token / 邮箱,必须整段去掉
  assert.equal(sanitizeAnalyticsMessage('Failed at https://x.test/a?email=a@b.com&t=secret'), 'Failed at https://x.test/a');
  // 邮箱与长数字替换掉
  assert.equal(sanitizeAnalyticsMessage('user a.b@c.io phone +86 138 0000 1234'), 'user <email> phone <number>');
  // 空白压缩 + 长度截断(错误消息可以很长)
  const long = 'x'.repeat(500);
  assert.equal(sanitizeAnalyticsMessage(long).length, 120);
  assert.equal(sanitizeAnalyticsMessage('  a\n\nb  '), 'a b');
});

test('the write route enforces the whitelist, batch cap, rate limit and anon id server-side', () => {
  const route = repoFile('app/api/v1/events/route.ts');
  assert.match(route, /ANALYTICS_MAX_BATCH/, 'batch cap must be enforced server-side');
  assert.match(route, /isAnalyticsEventName\(event\.name\)/, 'unknown event names must be dropped');
  assert.match(route, /isAnalyticsMetaKey\(key\)/, 'unknown meta keys must be dropped');
  assert.match(route, /sanitizeAnalyticsMessage\(value\)/, 'error messages must be sanitized');
  assert.match(route, /takeFromBucket\(/, 'anonymous writes need a rate limit');
  assert.match(route, /crypto\.randomUUID\(\)/, 'anonymous id must be a random uuid, not a fingerprint');
  // 隐私红线:不落库任何可直接识别个人的字段
  for (const forbidden of ['email', 'phone', 'ip', 'userAgent', 'referrer']) {
    assert.doesNotMatch(route, new RegExp(`\\b${forbidden}\\s*:`), `route must not persist ${forbidden}`);
  }
  assert.equal(ANALYTICS_MAX_BATCH > 0, true);
});

test('the browser tracker never blocks the product and flushes on page hide', () => {
  const client = repoFile('lib/analytics/track-client.ts');
  // 埋点失败必须吞掉:不能因为上报影响导出/上传
  assert.match(client, /catch \{/, 'tracking errors must be swallowed');
  assert.match(client, /sendBeacon/, 'beacon keeps last events on unload');
  assert.match(client, /pagehide/, 'must flush on page unload');
  assert.match(client, /visibilityState === 'hidden'/, 'must flush when page becomes hidden');
});
