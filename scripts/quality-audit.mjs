#!/usr/bin/env node
// 每周质量巡检:只量「机器能判定」的指标,人判定的(架构/一致性)靠这些指标触发。
//
// 设计原则(踩过的坑都写在这):
//  - 只读,不改仓库(巡检不许顺手改代码,那是另一个 prompt 的事)
//  - 单个指标失败标记 N/A,不拖垮整份报告
//  - 输出 Markdown,workflow 直接当 issue body
//  - 阈值判定只做「明显该动手」的,不制造噪音
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const SRC_ROOTS = [
  'apps/web/src',
  'packages/contracts/src',
  'packages/design-agent/src',
  'packages/agent/src',
  'packages/ai/src',
  'engine/src',
];
const EXTS = ['.ts', '.tsx', '.py'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.venv', 'coverage']);
const BIG_FILE_WATCH = 1500; // 超过就上榜
const BIG_FILE_ALERT = 5000; // 超过就该拆
const LOCALES = ['zh', 'en', 'es', 'ja', 'fr'];

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (EXTS.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

async function countLines(p) {
  const txt = await readFile(p, 'utf8');
  return txt.split('\n').length;
}

function flatten(obj, prefix = '', acc = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, acc);
    else acc.push(key);
  }
  return acc;
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return `__ERR__${(e.stdout || '') + (e.stderr || '')}`;
  }
}

async function metricBigFiles() {
  const all = [];
  for (const r of SRC_ROOTS) {
    for (const f of await walk(r)) all.push({ f, lines: await countLines(f) });
  }
  const big = all.filter((x) => x.lines > BIG_FILE_WATCH).sort((a, b) => b.lines - a.lines);
  const rows = big.slice(0, 10).map((x) => {
    const flag = x.lines > BIG_FILE_ALERT ? '⚠️ ' : '';
    return `| ${flag}\`${x.f}\` | ${x.lines} |`;
  });
  return {
    title: `超大文件(>${BIG_FILE_WATCH} 行)`,
    md: rows.length
      ? `| 文件 | 行数 |\n|---|---|\n${rows.join('\n')}\n\n共 **${big.length}** 个文件超过 ${BIG_FILE_WATCH} 行;>${BIG_FILE_ALERT} 行的标 ⚠️,属于该拆的级别。`
      : `无(干净)`,
    data: { bigCount: big.length, maxFile: big[0]?.f ?? '', maxLines: big[0]?.lines ?? 0 },
  };
}

async function metricTodo() {
  let n = 0;
  const byDir = {};
  for (const r of SRC_ROOTS) {
    for (const f of await walk(r)) {
      const txt = await readFile(f, 'utf8');
      const m = txt.match(/TODO|FIXME|HACK/g);
      if (m) {
        n += m.length;
        byDir[r] = (byDir[r] ?? 0) + m.length;
      }
    }
  }
  const rows = Object.entries(byDir).map(([k, v]) => `| \`${k}\` | ${v} |`);
  return {
    title: '技术债标记(TODO/FIXME/HACK)',
    md: n ? `共 **${n}** 处。\n\n| 目录 | 数量 |\n|---|---|\n${rows.join('\n')}` : '无(干净)',
    data: { todo: n },
  };
}

async function metricUntestedServices() {
  const svcRoot = 'apps/web/src/services';
  const files = (await walk(svcRoot)).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'),
  );
  const untested = [];
  for (const f of files) {
    const testPath = f.replace(/\.ts$/, '.test.ts');
    let exists = false;
    try {
      await readFile(testPath, 'utf8');
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) untested.push(f);
  }
  const rows = untested.slice(0, 12).map((f) => `| \`${f}\` |`);
  return {
    title: 'service 层无同名测试的文件',
    md: untested.length
      ? `**${untested.length}/${files.length}** 个文件没有同名 \`.test.ts\`(只说明没有配对测试,不代表没被覆盖)。\n\n| 文件 |\n|---|\n${rows.join('\n')}${untested.length > 12 ? '\n| … |' : ''}`
      : `全部有配对测试(${files.length} 个文件)`,
    data: { svcTotal: files.length, svcUntested: untested.length },
  };
}

async function metricI18n() {
  const map = {};
  for (const l of LOCALES) {
    const p = `apps/web/src/messages/${l}.json`;
    try {
      map[l] = flatten(JSON.parse(await readFile(p, 'utf8')));
    } catch (e) {
      return { title: 'i18n 键一致性', md: `读取 ${p} 失败: ${e.message}`, data: {} };
    }
  }
  const base = new Set(map.zh);
  const rows = [];
  let total = 0;
  for (const l of LOCALES.filter((x) => x !== 'zh')) {
    const have = new Set(map[l]);
    const missing = [...base].filter((k) => !have.has(k));
    const extra = [...have].filter((k) => !base.has(k));
    total += missing.length + extra.length;
    rows.push(
      `| ${l} | ${base.size} | ${missing.length} | ${extra.length} | ${missing
        .slice(0, 3)
        .map((k) => `\`${k}\``)
        .join(' ') || '—'} |`,
    );
  }
  return {
    title: 'i18n 五语言键差异(基准 zh)',
    md: `zh 共 **${base.size}** 个键。\n\n| 语言 | 键数 | 缺 | 多 | 缺失示例 |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n${
      total === 0 ? '✅ 五语言键完全一致' : `⚠️ 合计 ${total} 处键差异 —— 缺的键会在该语言下显示原文/键名。`
    }`,
    data: { i18nKeys: base.size, i18nDiff: total },
  };
}

function metricDocsCheck() {
  const out = sh('node scripts/docs-check.mjs');
  const ok = !out.startsWith('__ERR__');
  return {
    title: '文档时效(docs:check)',
    md: ok ? '✅ 通过' : `⚠️ 未通过:\n\n\`\`\`\n${out.replace('__ERR__', '').split('\n').slice(0, 8).join('\n')}\n\`\`\``,
    data: { docsCheckOk: ok },
  };
}

async function metricMigrations() {
  const dir = 'apps/web/src/db/migrations';
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return { title: '数据库迁移', md: '读取迁移目录失败', data: {} };
  }
  return {
    title: '数据库迁移',
    md: files.length
      ? `共 **${files.length}** 个迁移,最新: \`${files[files.length - 1]}\``
      : '无迁移文件',
    data: { migrations: files.length, latestMigration: files[files.length - 1] ?? '' },
  };
}

function metricDeps() {
  let deps = 0;
  try {
    deps = Object.keys(JSON.parse(sh('cat apps/web/package.json') || '{}').dependencies ?? {}).length;
  } catch {
    deps = 0;
  }
  const out = sh('pnpm outdated --format json 2>/dev/null || true');
  if (out.startsWith('__ERR__') || !out.trim().startsWith('{')) {
    return {
      title: '依赖过时',
      md: `web 运行时依赖 **${deps}** 个。依赖过时检测跳过(本环境无 pnpm 或解析失败)。`,
      data: { deps, outdated: null },
    };
  }
  let behind = 0;
  let total = 0;
  try {
    for (const [name, info] of Object.entries(JSON.parse(out))) {
      total += 1;
      if (info.latest && info.current && info.latest !== info.current) behind += 1;
    }
  } catch {
    return { title: '依赖过时', md: `web 运行时依赖 **${deps}** 个。解析 pnpm outdated 失败。`, data: { deps } };
  }
  return {
    title: '依赖过时',
    md: `web 运行时依赖 **${deps}** 个;可升级 **${behind}/${total}** 个。`,
    data: { deps, outdated: behind },
  };
}

/**
 * 远程分支残留。只读 refs,不需要完整历史。
 *
 * 为什么必须单列这一项:仓库约定「临时分支用完即删」,但 squash 合并会让分支提交
 * 永远不是 main 的祖先 —— `git branch -d` 对每个已合并的分支都"正确"地拒绝,
 * 于是一个也删不掉,而拒绝本身不报错、不显眼。2026-11-12 一次性清出 44 个本地
 * 分支 + 1 个远程残留(关闭 PR 时漏了 --delete-branch)。靠人想起来才清等于没有。
 */
async function metricBranches() {
  const out = sh('git ls-remote --heads origin');
  if (out.startsWith('__ERR__')) {
    return { title: '远程分支残留', md: '读取远程分支失败(无 origin remote 或网络不可达)。', data: {} };
  }
  const names = out
    .split('\n')
    .map((l) => l.replace(/^.*refs\/heads\//, '').trim())
    .filter(Boolean);
  // 允许存在:main、dependabot 自动分支、发布分支(rb-*)、revert 分支
  const allowed = /^(main$|dependabot\/|rb-|revert-)/;
  const stale = names.filter((n) => !allowed.test(n));
  const rows = stale.slice(0, 15).map((n) => `| \`${n}\` |`);
  return {
    title: '远程分支残留(用完即删)',
    md: stale.length
      ? `${stale.length} 个分支既不是 main、也不是 dependabot/release:\n\n| 分支 |\n|---|\n${rows.join('\n')}\n\n> 判据看 **PR 是否 merged**,不看 \`merge-base --is-ancestor\`(squash 合并后分支提交不是 main 祖先)。删除用 \`git branch -D\` + \`git push origin --delete\`。`
      : '无(干净)',
    data: { staleBranches: stale.length },
  };
}

async function main() {
  const started = new Date();
  const sections = [];
  const metrics = {};
  const tasks = [
    metricBigFiles,
    metricTodo,
    metricUntestedServices,
    metricI18n,
    async () => metricDocsCheck(),
    metricMigrations,
    async () => metricDeps(),
    async () => metricBranches(),
  ];
  for (const t of tasks) {
    try {
      const r = await t();
      sections.push(`### ${r.title}\n\n${r.md}`);
      Object.assign(metrics, r.data ?? {});
    } catch (e) {
      sections.push(`### 巡检项失败\n\n\`${t.name}\`: ${e.message}`);
    }
  }

  const lines = [
    `## 质量巡检 ${started.toISOString().slice(0, 10)}`,
    '',
    `> 自动生成(${started.toISOString()})。只量机器可判定的指标;新出现的 ⚠️ 才是该动手的信号。`,
    '',
    ...sections.flatMap((s) => [s, '']),
    '### 关键数值(供下次对比)',
    '',
    '```json',
    JSON.stringify(metrics, null, 2),
    '```',
    '',
    '<!-- quality-audit-metrics',
    JSON.stringify(metrics),
    '-->',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

main();
