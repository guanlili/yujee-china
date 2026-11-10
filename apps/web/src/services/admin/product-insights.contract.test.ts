import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(join(here, '..', '..', p), 'utf8');
const message = (loc: string) =>
  JSON.parse(repoFile(`messages/${loc}.json`)) as {
    admin: { analytics: { product: Record<string, string> } };
  };

// 看板的口径比样式重要:同一份数据如果被两个人用不同方式算,数就不可信了。
// 这几个断言锁住的是口径,不是实现细节。

test('funnel counts unique people, not raw event volume', () => {
  const service = repoFile('services/admin/admin-service.ts');
  assert.match(service, /distinctSubjectsByNameSince/, 'funnel must use distinct subjects');
  // 次数口径会让一个人反复导出把转化率拉过 100%
  assert.doesNotMatch(
    service,
    /funnel:\s*\{[\s\S]{0,200}countByNameSince[\s\S]{0,80}landing/,
    'funnel must not be built from raw counts',
  );
});

test('export success is split from cloud-upload failure', () => {
  const service = repoFile('services/admin/admin-service.ts');
  const repo = repoFile('db/repos/analytics-repo.ts');
  const page = repoFile('app/[locale]/admin/analytics/page.tsx');
  // 上传失败时用户已经拿到文件,混进成功率会让这个核心指标失真
  assert.match(repo, /renderFails/, 'repo must expose render failures separately');
  assert.match(repo, /uploadFails/, 'repo must expose cloud-upload failures separately');
  assert.match(service, /\.\.\.exportOutcomes/, 'service must pass both failure kinds through');
  assert.match(page, /product\.export\.renderFails/);
  assert.match(page, /product\.export\.uploadFails/);
  // 成功率只由 ok / start 决定
  assert.match(service, /exportOutcomes\.oks\s*\/\s*exportOutcomes\.starts/);
});

test('the dashboard only accepts 7/30/90 day windows', () => {
  const page = repoFile('app/[locale]/admin/analytics/page.tsx');
  // days 直接来自 query string,不限定取值就是让人把任意天数灌进 SQL 窗口
  assert.match(page, /Number\(rawDays\) === 30 \|\| Number\(rawDays\) === 90/);
  const service = repoFile('services/admin/admin-service.ts');
  assert.match(service, /\[7, 30, 90\]\.includes\(days\)/);
});

test('the page reads through the service, never the database directly', () => {
  const page = repoFile('app/[locale]/admin/analytics/page.tsx');
  assert.doesNotMatch(page, /from '@\/db\//, 'admin page must not import the db layer');
  assert.match(page, /adminService\.getProductInsights/);
  // 页面本身不做 SQL,所有聚合都在 repo/service 里
  assert.doesNotMatch(page, /sql`/, 'no raw SQL in the page');
});

test('every funnel stage has a real emit point in the app', () => {
  // 白名单里有事件名不等于有人在发 —— book_start 曾经就是「定义了但没人调用」,
  // 漏斗第二格只能标「尚未接入」。这条测试盯的是这个回归。
  const sources = [
    repoFile('components/landing/YujeeLandingHomeClient.tsx'),
    repoFile('components/landing/HeroComposer.tsx'),
    repoFile('components/album/editor-v2/EditorBook.tsx'),
    repoFile('components/album/editor-v2/CreditsPurchaseModal.tsx'),
  ].join('\n');
  for (const event of ['landing_view', 'book_start', 'export_ok', 'checkout_click']) {
    assert.match(sources, new RegExp(`track\\('${event}'`), `${event} has no emit point`);
  }
});

test('every locale carries the same product-dashboard keys', () => {
  const locales = ['en', 'zh', 'es', 'ja', 'fr'];
  const base = Object.keys(message('en').admin.analytics.product).sort();
  assert.ok(base.length >= 30, 'product block looks incomplete');
  for (const loc of locales) {
    const keys = Object.keys(message(loc).admin.analytics.product).sort();
    assert.deepEqual(keys, base, `${loc}.json is missing product keys`);
  }
});
