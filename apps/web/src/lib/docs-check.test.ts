// `scripts/docs-check.mjs` 的行为契约。
//
// 为什么这条测试住在 apps/web 下:测试套件是 `tsx --test "src/**/*.test.ts"`,只有
// apps/web/src 下的文件会被扫到;而脚本本身在仓库根。所以这里用子进程把它跑在一个
// 临时 git 仓库里,不碰真实仓库。
//
// 这四条断言对应两个真实事故:
//   1. 覆盖路径(含 glob)下的代码改了却没报 —— 曾经因为 `git ls-tree` 不支持 `**`
//      展开,指纹只覆盖了不含通配符的路径,改 app/api 下的文件永远绿。
//   2. squash 合并后必然红一次 —— 原来按提交号判定,分支提交被改写成新 hash 后
//      `checked-at` 指不到,每次合并都要补第二个 docs PR 修它。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = apps/web/src/lib,往上四层才是仓库根。
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'docs-check.mjs');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=docs-check@test', '-c', 'user.name=docs-check', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function run(cwd: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const DOC_BLOCK = [
  '<!-- doc-scope',
  'paths: src/app/api/**, src/lib/env.ts',
  'checked-at: 00000000',
  '-->',
].join('\n');

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'docs-check-'));
  git(dir, ['init', '-q']);
  mkdirSync(join(dir, 'src/app/api/v1'), { recursive: true });
  mkdirSync(join(dir, 'src/lib'), { recursive: true });
  writeFileSync(join(dir, 'src/app/api/v1/route.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src/lib/env.ts'), 'export const b = 1;\n');
  writeFileSync(join(dir, 'README.md'), `# module\n\n${DOC_BLOCK}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  // stamp 读的是 HEAD,所以必须先有提交再 stamp,然后提交指纹本身。
  const stamp = run(dir, ['--stamp']);
  assert.equal(stamp.code, 0, stamp.out);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'docs: stamp']);
  return dir;
}

const dirs: string[] = [];
after(() => {
  for (const d of dirs) execFileSync('rm', ['-rf', d]);
});

test('stamp 之后基线通过,且写入了 12 位指纹', () => {
  const dir = makeRepo();
  dirs.push(dir);
  assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /fingerprint: [0-9a-f]{12}/);
  const check = run(dir, []);
  assert.equal(check.code, 0, check.out);
});

test('覆盖路径下含 glob 的文件改了并提交 → 判定过期', () => {
  const dir = makeRepo();
  dirs.push(dir);
  // app/api/** 是 glob 覆盖,这是曾经漏判的那条。
  writeFileSync(join(dir, 'src/app/api/v1/route.ts'), 'export const a = 2;\n');
  git(dir, ['commit', '-q', '-am', 'change api']);
  const check = run(dir, []);
  assert.equal(check.code, 1, check.out);
  assert.match(check.out, /README\.md/);
});

test('squash 场景(内容不变只换提交 hash)→ 仍然通过', () => {
  const dir = makeRepo();
  dirs.push(dir);
  const before = git(dir, ['rev-parse', '--short=8', 'HEAD']);
  // squash 改的是提交本身(消息/父提交),树完全不变 —— 用改消息制造新 hash。
  git(dir, ['commit', '-q', '--amend', '-m', 'squash: 同内容不同 hash']);
  const after = git(dir, ['rev-parse', '--short=8', 'HEAD']);
  assert.notEqual(before, after, 'amend 应当改写 hash');
  const check = run(dir, []);
  assert.equal(check.code, 0, check.out);
});

test('只改文档自身不算覆盖路径变更(不报红)', () => {
  const dir = makeRepo();
  dirs.push(dir);
  // 保留 stamp 写进去的块(含 fingerprint),只在前面加一句 —— 模拟「只改了文档正文」。
  const doc = readFileSync(join(dir, 'README.md'), 'utf8');
  writeFileSync(join(dir, 'README.md'), `# module\n\n多一句说明。\n\n${doc.slice(doc.indexOf('<!-- doc-scope'))}`);
  git(dir, ['commit', '-q', '-am', 'docs only']);
  const check = run(dir, []);
  assert.equal(check.code, 0, check.out);
});

test('尚未 stamp 的旧文档仍按提交历史判(兼容分支不炸)', () => {
  const dir = makeRepo();
  dirs.push(dir);
  // 把 fingerprint 摘掉、checked-at 指向当前 HEAD —— 模拟改造前留下的旧块。
  const doc = readFileSync(join(dir, 'README.md'), 'utf8');
  const legacy = doc
    .replace(/fingerprint: [0-9a-f]{12}\n/, '')
    .replace(/checked-at: [0-9a-f]{8}/, `checked-at: ${git(dir, ['rev-parse', '--short=8', 'HEAD'])}`);
  writeFileSync(join(dir, 'README.md'), legacy);
  git(dir, ['commit', '-q', '-am', 'docs: legacy block']);
  const okRun = run(dir, []);
  assert.equal(okRun.code, 0, okRun.out);

  writeFileSync(join(dir, 'src/lib/env.ts'), 'export const b = 2;\n');
  git(dir, ['commit', '-q', '-am', 'change env']);
  const staleRun = run(dir, []);
  assert.equal(staleRun.code, 1, staleRun.out);
  assert.match(staleRun.out, /README\.md/);
});
