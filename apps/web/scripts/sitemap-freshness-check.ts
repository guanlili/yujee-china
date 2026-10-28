#!/usr/bin/env tsx
// sitemap <lastmod> 时效校验（squash-friendly）。
//
// src/lib/seo/freshness.ts 为每个可收录路由声明:
//
//   '/privacy': { sources: [MARKETING], updatedAt: '2026-07-12', reviewedSources: 'a84144e97509' }
//
// 规则:某路由 sources 在 HEAD 上的内容指纹 ≠ 声明的 reviewedSources
// => 判定这条 lastmod 未经核对,退出码 1。
//
// 指纹算法(稳定、与提交 SHA / squash 无关):
//   sha256( git ls-tree -r HEAD -- <sources> ).hex[:12]
// 只用 tree 元数据(blob OID + path),不读文件内容;同一棵内容树无论经
// squash / rebase / merge-commit 落地,指纹不变。
// 声明文件 freshness.ts / guides.ts 在哈希前从 listing 里剔除,避免「只 stamp
// 自己」自触发。(git ls-tree 不支持 :(exclude) pathspec magic。)
//
// 修复方式(两条路,必须先想清楚是哪一条):
//   - 这个页面读者能看到的内容**真的变了** → 同时更新 updatedAt(改成内容变更那
//     天)和 reviewedSources(改成 `pnpm --filter @yujee/web sitemap:stamp` 打印的值)。
//   - 只是共享的源文件被别的页面的改动碰到了,这页没变 → **只**推进 reviewedSources,
//     updatedAt 不动。
//
// 为什么不用 commit SHA 作锚(旧 reviewedAt):
//   squash-merge 会丢掉 PR 分支 tip SHA → main 上 `rev-parse` 失败或 range 失真,
//   逼人要么改用 merge-commit、要么合完立刻开跟进 PR 刷 SHA(#58→#59 模式)。
//   内容指纹绑定的是「看过的那份源码」,不是「某一个会消失的提交」。

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { FRESHNESS_DECLARATIONS } from '../src/lib/seo/freshness';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const FRESHNESS = 'apps/web/src/lib/seo/freshness.ts';
// guides.ts 持有每篇的 updatedAt/reviewedSources,和 freshness.ts 同理:改指纹这个动作
// 本身不能触发它自己的闸门。文章正文在 lib/guides/content 下,那才是 sources。
const GUIDES_DECL = 'apps/web/src/lib/guides/guides.ts';
const FINGERPRINT_LEN = 12;
const EXCLUDED_PATHS = new Set([FRESHNESS, GUIDES_DECL]);

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/** Content fingerprint of a pathspec at HEAD (or another tree-ish). */
export function sourcesFingerprint(sources: readonly string[], treeIsh = 'HEAD'): string {
  let listing = '';
  try {
    // Keep git's trailing newline — hashing the raw ls-tree stdout is what the
    // gate and sitemap:stamp both promise. Do not .trim() here.
    listing = execFileSync('git', ['ls-tree', '-r', treeIsh, '--', ...sources], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch {
    // pathspec 匹配不到已跟踪文件时 git 报错,视为空树。
    listing = '';
  }
  const filtered = listing
    .split('\n')
    .filter((line) => {
      if (!line) return false;
      const path = line.split('\t')[1] ?? '';
      return !EXCLUDED_PATHS.has(path);
    })
    .join('\n');
  const normalized = filtered.length ? `${filtered}\n` : '';
  return createHash('sha256').update(normalized).digest('hex').slice(0, FINGERPRINT_LEN);
}

const stale: { route: string; updatedAt: string; reviewedSources: string; actual: string }[] = [];
const pending: { route: string; dirty: string[] }[] = [];
const broken: string[] = [];

const routes = Object.entries(FRESHNESS_DECLARATIONS);
if (!routes.length) {
  console.error('✖ ROUTE_FRESHNESS 是空的 —— 每个可收录路由都必须声明 lastmod。');
  process.exit(1);
}

for (const [route, decl] of routes) {
  const { sources, updatedAt } = decl;
  const reviewedSources =
    'reviewedSources' in decl && typeof decl.reviewedSources === 'string'
      ? decl.reviewedSources
      : // 迁移窗口:旧字段 reviewedAt(commit SHA)一律视为失效声明,逼一次重 stamp。
        '';

  if (!sources.length) {
    broken.push(`${route}: sources 为空,这条 lastmod 永远不会被校验到`);
    continue;
  }
  if (!/^[0-9a-f]{12}$/.test(reviewedSources)) {
    broken.push(
      `${route}: reviewedSources "${reviewedSources || '(missing)'}" 不是 12 位 hex 内容指纹(跑 pnpm --filter @yujee/web sitemap:stamp)`,
    );
    continue;
  }

  const actual = sourcesFingerprint(sources);
  // status 支持 :(exclude);ls-tree 不支持,所以 dirty 仍用 pathspec magic。
  const pathspec = [...sources, `:(exclude)${FRESHNESS}`, `:(exclude)${GUIDES_DECL}`];

  let dirty = '';
  try {
    dirty = git(['status', '--porcelain', '--', ...pathspec]);
  } catch {
    // ignore
  }

  if (actual !== reviewedSources) {
    stale.push({ route, updatedAt, reviewedSources, actual });
  } else if (dirty) {
    pending.push({ route, dirty: dirty.split('\n') });
  }
}

if (broken.length) {
  console.error('freshness 声明本身有问题:\n');
  for (const b of broken) console.error(`  ✖ ${b}`);
  console.error('');
}

if (stale.length) {
  console.error('以下路由的 lastmod 未经核对 —— 支撑它的源文件内容指纹变了,reviewedSources 没跟上:\n');
  for (const s of stale) {
    console.error(`  ✖ ${s.route}  (updatedAt: ${s.updatedAt})`);
    console.error(`      declared: ${s.reviewedSources}`);
    console.error(`      at HEAD:  ${s.actual}`);
    console.error('');
  }
  console.error('修复:打开这个页面看一眼读者能看到的内容到底变没变。');
  console.error('  变了   → updatedAt 改成内容变更那天,reviewedSources 改成 stamp 输出。');
  console.error('  没变   → 只推进 reviewedSources,updatedAt 不要动。');
  console.error('跑: pnpm --filter @yujee/web sitemap:stamp');
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
