#!/usr/bin/env tsx
// sitemap <lastmod> 时效校验。
//
// src/lib/seo/freshness.ts 为每个可收录路由声明:
//
//   '/privacy': { sources: [MARKETING], updatedAt: '2026-07-12', reviewedAt: 'c99f0b01' }
//
// 规则:某路由的 sources 自它的 reviewedAt 以来有新提交,而 reviewedAt 没跟上
// => 判定这条 lastmod 未经核对,退出码 1。
//
// 修复方式(两条路,必须先想清楚是哪一条):
//   - 这个页面读者能看到的内容**真的变了** → 同时更新 updatedAt(改成内容变更那
//     天)和 reviewedAt(改成当前提交)。
//   - 只是共享的源文件被别的页面的改动碰到了,这页没变 → **只**推进 reviewedAt,
//     updatedAt 不动。
//
// 第二条是这个脚本存在的全部意义。messages/marketing.ts 同时支撑首页和法务页,
// 改一句首页文案就会碰到它。如果没有这道闸门,最省事的做法是把所有日期一起刷新,
// 于是每次改文案都在告诉 Google「隐私政策也改了」—— 那正是让 lastmod 失去可信度、
// 进而被整站忽略的行为。宁可报错逼人做判断,也不要一个会撒谎的信号。
//
// 和 docs-check.mjs 是同一套思路(声明覆盖范围 + 锚定提交),两处不同:
//   1. 多了 updatedAt 这个会真正发给搜索引擎的字段,所以「已核对」和「已变更」分开记。
//   2. 直接 import 声明而不是正则解析。第一版用正则,`[^\]]*` 撞上源文件路径里的
//      `[locale]` 提前截断,静默漏掉了 /about/story —— 一个漏页面还报绿的闸门比没有
//      更糟。

import { execFileSync } from 'node:child_process';
import { FRESHNESS_DECLARATIONS } from '../src/lib/seo/freshness';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const FRESHNESS = 'apps/web/src/lib/seo/freshness.ts';
// guides.ts 持有每篇的 updatedAt/reviewedAt,和 freshness.ts 同理:改日期这个动作
// 本身不能触发它自己的闸门。文章正文在 lib/guides/content 下,那才是 sources。
const GUIDES_DECL = 'apps/web/src/lib/guides/guides.ts';

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

const stale: { route: string; updatedAt: string; reviewedAt: string; commits: string[] }[] = [];
const pending: { route: string; dirty: string[] }[] = [];
const broken: string[] = [];

const routes = Object.entries(FRESHNESS_DECLARATIONS);
if (!routes.length) {
  console.error('✖ ROUTE_FRESHNESS 是空的 —— 每个可收录路由都必须声明 lastmod。');
  process.exit(1);
}

for (const [route, { sources, updatedAt, reviewedAt }] of routes) {
  if (!sources.length) {
    broken.push(`${route}: sources 为空,这条 lastmod 永远不会被校验到`);
    continue;
  }
  try {
    git(['rev-parse', '--verify', `${reviewedAt}^{commit}`]);
  } catch {
    broken.push(`${route}: reviewedAt "${reviewedAt}" 不是有效提交`);
    continue;
  }

  // 声明文件自身排除在外,否则改日期这个动作会触发它自己。
  const pathspec = [...sources, `:(exclude)${FRESHNESS}`, `:(exclude)${GUIDES_DECL}`];

  let commits = '';
  let dirty = '';
  try {
    commits = git(['log', '--format=%h %s', `${reviewedAt}..HEAD`, '--', ...pathspec]);
    dirty = git(['status', '--porcelain', '--', ...pathspec]);
  } catch {
    // pathspec 匹配不到已跟踪文件时 git 报错,视为无变更。
  }

  // 和 docs-check 一致:硬失败只看已提交历史,工作区脏只提示 —— 否则改代码过程中
  // 永远跑不绿 typecheck。
  if (commits) stale.push({ route, updatedAt, reviewedAt, commits: commits.split('\n') });
  else if (dirty) pending.push({ route, dirty: dirty.split('\n') });
}

if (broken.length) {
  console.error('freshness 声明本身有问题:\n');
  for (const b of broken) console.error(`  ✖ ${b}`);
  console.error('');
}

if (stale.length) {
  console.error('以下路由的 lastmod 未经核对 —— 支撑它的源文件变了,reviewedAt 没跟上:\n');
  for (const s of stale) {
    console.error(`  ✖ ${s.route}  (updatedAt: ${s.updatedAt}, reviewedAt: ${s.reviewedAt})`);
    for (const c of s.commits.slice(0, 5)) console.error(`      · ${c}`);
    if (s.commits.length > 5) console.error(`      · …还有 ${s.commits.length - 5} 个提交`);
    console.error('');
  }
  console.error('修复:打开这个页面看一眼读者能看到的内容到底变没变。');
  console.error('  变了   → updatedAt 改成内容变更那天,reviewedAt 改成当前提交。');
  console.error('  没变   → 只推进 reviewedAt,updatedAt 不要动。');
  console.error('不要图省事把所有日期一起刷新 —— 那等于告诉 Google 每个页面都改了,');
  console.error('lastmod 会因此被整站忽略。\n');
}

if (broken.length || stale.length) process.exit(1);

console.log(`sitemap lastmod 校验通过(${routes.length} 个路由)。`);
if (pending.length) {
  console.log('以下路由的源文件有**未提交**改动,提交后需要核对:\n');
  for (const p of pending) {
    console.log(`  · ${p.route}`);
    for (const d of p.dirty.slice(0, 3)) console.log(`      ${d.trim()}`);
    if (p.dirty.length > 3) console.log(`      …还有 ${p.dirty.length - 3} 处`);
  }
  console.log('');
}
