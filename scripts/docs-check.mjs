#!/usr/bin/env node
// 文档时效校验。
//
// 每份模块文档尾部声明一个 doc-scope 块:
//
//   <!-- doc-scope
//   paths: engine/src/**, apps/web/src/lib/env.ts
//   checked-at: 98d40cb8
//   fingerprint: 3f1a92b7c0de
//   -->
//
// 规则:covered paths 的内容跟 `fingerprint` 对不上,说明代码变了而文档没回头核对 =>
// 判定文档已过期,退出码 1。
//
// 为什么用内容指纹而不是提交号(2026-11-17 修):
// 原来判定的是「自 checked-at 提交以来这些路径有没有新提交」。但 squash 合并会把分支
// 提交改写成新 hash —— `checked-at` 指向的提交根本不在 main 历史里,于是每次合并后
// docs job 必然红一次,还得再补一个 docs PR 修它。两跳修一次、每次合并踩一次。
// 指纹比较的是**文件内容**,squash / rebase / amend 都不改变 blob,所以天然免疫。
// `checked-at` 保留成人可读的「上次核对到哪个提交」,不参与判定。
//
// 修复方式:`pnpm docs:stamp`(重算所有文档的 fingerprint,并把 checked-at 指到 HEAD)。
// 前提是你真的回头核对过内容 —— 指纹能证明「内容没变」,不能证明「人看过」。
//
// 这么做是因为「改完记得更新文档」这类软约束在实践中一定会被跳过。让它在 CI 里报错,
// 比写在文档尾巴上靠自觉可靠。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const REPO_ROOT = process.cwd();
const STAMP = process.argv.includes('--stamp');
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', 'dist', 'build',
  '.venv', '__pycache__', '.pytest_cache', '.worktrees', '.superpowers',
  // 别的分支的 worktree 检出:它们是同一个仓在另一个提交上的副本,doc-scope 里的
  // 路径会被拿到**主仓历史**上比对,于是主线一提交就把人家的文档判成过期 —— 纯误报,
  // 那条分支自己跑 docs:check 时会管好自己的 checked-at。`.worktrees` 早就在名单里,
  // 这里补上 `.claude/worktrees/` 这个位置(git worktree add 的落点不止一处)。
  'worktrees',
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
  const fingerprint = /^\s*fingerprint:\s*(\S+)\s*$/m.exec(body)?.[1] ?? '';
  return {
    paths: paths.split(',').map((p) => p.trim()).filter(Boolean),
    checkedAt,
    fingerprint,
  };
}

const EMPTY_FP = createHash('sha1').update('').digest('hex').slice(0, 12);

/**
 * 覆盖路径的内容指纹。
 *
 * 取 `git ls-tree` 的「mode + blob hash + path」三列再哈希 —— 只跟内容有关、与提交
 * 历史无关,所以 squash / rebase / amend 之后完全一致。删掉一个被覆盖的文件同样会变
 * (三元组少一行),不会因为「文件没了」而漏报。
 */
function fingerprintOf(paths, rel) {
  // `ls-tree` 不支持 `:(exclude)` 这种 pathspec magic,所以先取全部、再把文档自己那行剔掉
  // —— 否则「改文档」会被算成「覆盖路径变了」,文档永远 stamp 不完。
  let tree;
  try {
    tree = git(['ls-tree', '-r', '--full-tree', 'HEAD', '--', ...paths]);
  } catch {
    // pathspec 一个已跟踪文件都匹配不到时 git 会报错,视为空集。
    tree = '';
  }
  const rows = tree
    .split('\n')
    .filter((line) => {
      if (!line) return false;
      const tab = line.indexOf('\t');
      return tab === -1 ? true : line.slice(tab + 1) !== rel;
    })
    .join('\n');
  return createHash('sha1').update(rows).digest('hex').slice(0, 12);
}

const stale = [];
const pending = [];
const broken = [];
const stamped = [];

for (const file of findMarkdown(REPO_ROOT)) {
  const rel = relative(REPO_ROOT, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const block = parseBlock(text);
  if (!block) continue;

  if (!block.paths.length || !block.checkedAt) {
    broken.push(`${rel}: doc-scope 块缺 paths 或 checked-at`);
    continue;
  }

  // 文档描述的是别处的代码;把文档自身排除,免得改文档触发自己。
  const pathspec = [...block.paths, `:(exclude)${rel}`];
  const current = fingerprintOf(block.paths, rel);

  if (STAMP) {
    if (block.fingerprint === current) continue;
    const head = git(['rev-parse', '--short=8', 'HEAD']);
    const body = [
      'doc-scope',
      `paths: ${block.paths.join(', ')}`,
      `checked-at: ${head}`,
      `fingerprint: ${current}`,
    ].join('\n');
    const next = text.replace(BLOCK, `<!-- ${body} -->`);
    if (next !== text) {
      writeFileSync(file, next);
      stamped.push(rel);
    }
    continue;
  }

  if (block.fingerprint) {
    if (block.fingerprint !== current) {
      stale.push({ rel, kind: 'fingerprint', recorded: block.fingerprint, current, paths: block.paths });
    }
    continue;
  }

  // 兼容路径:还没 stamp 过的文档仍按提交历史判。squash 之后 checked-at 解析不到,
  // 这时给一条能直接执行的修复指令,而不是含糊的「不是有效提交」。
  try {
    git(['rev-parse', '--verify', `${block.checkedAt}^{commit}`]);
  } catch {
    broken.push(`${rel}: checked-at "${block.checkedAt}" 解析不到,且没有 fingerprint —— 跑 pnpm docs:stamp`);
    continue;
  }

  let commits = '';
  let dirty = '';
  try {
    commits = git(['log', '--format=%h %s', `${block.checkedAt}..HEAD`, '--', ...pathspec]);
    dirty = git(['status', '--porcelain', '--', ...pathspec]);
  } catch {
    // pathspec 匹配不到任何已跟踪文件时 git 会报错,视为无变更。
  }

  // 硬失败只看已提交历史。工作区脏不算失败 —— 否则你在改代码的过程中永远跑不绿
  // 本地校验。未提交的改动只作提示,等它提交进来了自然会变成硬失败。
  if (commits) {
    stale.push({ rel, kind: 'commits', checkedAt: block.checkedAt, commits: commits.split('\n') });
  } else if (dirty) {
    pending.push({ rel, dirty: dirty.split('\n') });
  }
}

if (STAMP) {
  if (stamped.length) {
    for (const rel of stamped) console.log(`  ✔ ${rel}`);
    console.log(`\n已更新 ${stamped.length} 份文档的 fingerprint。前提是这些文档的内容你确实核对过。`);
  } else {
    console.log('所有文档的 fingerprint 都是最新的。');
  }
  process.exit(0);
}

if (broken.length) {
  console.error('doc-scope 块本身有问题:\n');
  for (const b of broken) console.error(`  ✖ ${b}`);
  console.error('');
}

if (stale.length) {
  console.error('以下文档已过期 —— 覆盖路径的内容变了,但文档没有回头核对:\n');
  for (const s of stale) {
    if (s.kind === 'fingerprint') {
      console.error(`  ✖ ${s.rel}`);
      console.error(`      记录: ${s.recorded}   现状: ${s.current}`);
      // 逐个路径给落点:哪条覆盖路径下面现在有多少文件,方便定位改了什么。
      // 计数走同一套 glob 匹配 —— 直接拿 `ls-tree -- <glob>` 会恒等于 0,看着像没文件。
      for (const p of s.paths) {
        const re = globToRegex(p);
        const count = TREE_ROWS.filter((row) => row.path !== s.rel && re.test(row.path)).length;
        console.error(`      · ${p}（当前 ${count} 个文件）`);
      }
    } else {
      console.error(`  ✖ ${s.rel}  (checked-at: ${s.checkedAt})`);
      for (const c of s.commits.slice(0, 5)) console.error(`      · ${c}`);
      if (s.commits.length > 5) console.error(`      · …还有 ${s.commits.length - 5} 个提交`);
    }
    console.error('');
  }
  console.error('修复:回头核对该文档,确认描述仍属实(不属实就改),然后跑 pnpm docs:stamp。');
  console.error('内容确实无需改动时也要 stamp —— 它记录的是「已核对」,不是「已改写」。\n');
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
