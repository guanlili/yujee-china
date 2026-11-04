import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..', '..');

function source(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

// 回归:ChangelogBadge 曾用 next-intl 的 useLocale(),而根布局没有
// NextIntlClientProvider —— Sidebar 挂在 MarketingChrome 上,SSR 时
// useContext 拿不到值直接抛错,把 /examples、/guides、/pricing、/privacy、
// /terms 整面打成 500(build 全动态页面,CI 四门全绿也拦不住,线上才爆)。
// 这棵子树的 locale 一律走 prop,不许再引入 next-intl 客户端 hook。
test('ChangelogBadge takes locale via prop, never a next-intl client hook', () => {
  const badge = source('components/changelog/ChangelogBadge.tsx');
  assert.doesNotMatch(
    badge,
    /from ['"]next-intl['"]/,
    'ChangelogBadge renders under MarketingChrome with no NextIntlClientProvider; a next-intl client hook throws during SSR',
  );
  assert.match(badge, /locale: Locale/, 'ChangelogBadge must declare a locale prop');
});

test('Sidebar passes its locale down to ChangelogBadge', () => {
  const sidebar = source('components/app/Sidebar.tsx');
  assert.match(
    sidebar,
    /<ChangelogBadge locale=\{locale\}\s*\/>/,
    'Sidebar owns the locale; ChangelogBadge cannot fetch it itself',
  );
});
