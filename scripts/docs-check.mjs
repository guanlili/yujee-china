#!/usr/bin/env node
// 文档时效校验。
//
// 每份模块文档尾部声明一个 doc-scope 块:
//
//   <!-- doc-scope
//   paths: engine/src/**, apps/web/src/lib/env.ts
//   checked-at: 98d40cb8
//   -->
//
// 规则:covered paths 自 checked-at 以来有新提交(或工作区有未提交改动),
// 而 checked-at 没跟上 => 判定文档已过期,退出码 1。
//
// 修复方式:回头核对该文档,确认描述仍属实(不属实就改),然后把 checked-at 更新到
// 当前提交。checked-at 记录的是「已核对」,不是「已改写」—— 内容无需改动时也要更新它。
//
// 这么做是因为「改完记得更新文档」这类软约束在实践中一定会被跳过。让它在 typecheck
// 里报错,比写在文档尾巴上靠自觉可靠。

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const REPO_ROOT = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', 'dist', 'build',
  '.venv', '__pycache__', '.pytest_cache', '.worktrees', '.superpowers',
]);

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function findMarkdown(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    // 跳过符号链接:AGENTS.md -> CLAUDE.md 是同一份内容,跟进去会重复报同一条。
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) findMarkdown(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const BLOCK = /<!--\s*doc-scope\s+([\s\S]*?)-->/;

function parseBlock(text) {
  const m = BLOCK.exec(text);
  if (!m) return null;
  const body = m[1];
  const paths = /^\s*paths:\s*(.+)$/m.exec(body)?.[1] ?? '';
  const checkedAt = /^\s*checked-at:\s*(\S+)\s*$/m.exec(body)?.[1] ?? '';
  return {
    paths: paths.split(',').map((p) => p.trim()).filter(Boolean),
    checkedAt,
  };
}

const stale = [];
const pending = [];
const broken = [];

for (const file of findMarkdown(REPO_ROOT)) {
  const rel = relative(REPO_ROOT, file).split(sep).join('/');
  const block = parseBlock(readFileSync(file, 'utf8'));
  if (!block) continue;

  if (!block.paths.length || !block.checkedAt) {
    broken.push(`${rel}: doc-scope 块缺 paths 或 checked-at`);
    continue;
  }

  try {
    git(['rev-parse', '--verify', `${block.checkedAt}^{commit}`]);
  } catch {
    broken.push(`${rel}: checked-at "${block.checkedAt}" 不是有效提交`);
    continue;
  }

  // 文档描述的是别处的代码;把文档自身排除,免得改文档触发自己。
  const pathspec = [...block.paths, `:(exclude)${rel}`];

  let commits = '';
  let dirty = '';
  try {
    commits = git(['log', '--format=%h %s', `${block.checkedAt}..HEAD`, '--', ...pathspec]);
    dirty = git(['status', '--porcelain', '--', ...pathspec]);
  } catch {
    // pathspec 匹配不到任何已跟踪文件时 git 会报错,视为无变更。
  }

  // 硬失败只看已提交历史。工作区脏不算失败 —— 否则你在改代码的过程中永远跑不绿
  // typecheck。未提交的改动只作提示,等它提交进来了自然会变成硬失败。
  if (commits) {
    stale.push({ rel, checkedAt: block.checkedAt, commits: commits.split('\n') });
  } else if (dirty) {
    pending.push({ rel, dirty: dirty.split('\n') });
  }
}

if (broken.length) {
  console.error('doc-scope 块本身有问题:\n');
  for (const b of broken) console.error(`  ✖ ${b}`);
  console.error('');
}

if (stale.length) {
  console.error('以下文档已过期 —— 覆盖范围内的代码变了,但 checked-at 没跟上:\n');
  for (const s of stale) {
    console.error(`  ✖ ${s.rel}  (checked-at: ${s.checkedAt})`);
    for (const c of s.commits.slice(0, 5)) console.error(`      · ${c}`);
    if (s.commits.length > 5) console.error(`      · …还有 ${s.commits.length - 5} 个提交`);
    console.error('');
  }
  console.error('修复:核对文档内容是否仍属实(不属实就改),然后把 checked-at 更新到当前提交。');
  console.error('内容确实无需改动时也要更新 —— checked-at 记录的是「已核对」,不是「已改写」。\n');
}

if (broken.length || stale.length) process.exit(1);

if (pending.length) {
  console.log('文档时效校验通过。以下文档的覆盖范围有**未提交**改动,提交后需要回头核对:\n');
  for (const p of pending) {
    console.log(`  · ${p.rel}`);
    for (const d of p.dirty.slice(0, 3)) console.log(`      ${d.trim()}`);
    if (p.dirty.length > 3) console.log(`      …还有 ${p.dirty.length - 3} 处`);
  }
  console.log('');
} else {
  console.log('文档时效校验通过。');
}
