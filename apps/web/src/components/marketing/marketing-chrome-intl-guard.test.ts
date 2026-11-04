import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';

// ── 背景 ─────────────────────────────────────────────────────────────
// ChangelogBadge 曾用 next-intl 的 useLocale(),而根布局没有
// NextIntlClientProvider —— Sidebar 挂在 MarketingChrome 上,SSR 时
// useContext 拿不到值直接抛错,把 /examples、/guides、/pricing、/privacy、
// /terms、/about/story 整面打成 500,登录用户的 /my-albums 也中招
// (build 全动态页面,CI 四门全绿也拦不住,线上才爆,2026-11-04 #90)。
//
// 这棵子树一律在无 Provider 的 SSR 上下文里渲染,任何 next-intl **客户端
// hook**(useTranslations/useLocale/useFormatter/useNow/useTimeZone/
// useMessages 等)都会在 useContext 处炸。本守卫从锚点(整棵 MarketingChrome
// 子树 + /my-albums)递归解析 import 图,断言图内任何源文件都不得有
// next-intl 的 value import —— 只允许 `import type`(编译期擦除)和
// `next-intl/server`(服务端函数,不走 Provider)。新增营销页若用了
// MarketingChrome,会自动进图,无需改锚点清单。

const SRC = resolve(import.meta.dirname, '..', '..'); // apps/web/src(本文件在 components/marketing/,上两级即 src)

// next-intl 客户端 hook —— 出现在 value import 里就是雷。
const CLIENT_HOOKS = [
  'useTranslations',
  'useLocale',
  'useFormatter',
  'useNow',
  'useTimeZone',
  'useMessages',
  'NextIntlClientProvider',
];

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) listFiles(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// 锚点:MarketingChrome + 所有引用它的营销页 + /my-albums(同样 500 过的登录页)。
function anchors(): string[] {
  const pages = listFiles(join(SRC, 'app', '[locale]')).filter((f) =>
    readFileSync(f, 'utf8').includes('MarketingChrome'),
  );
  return [
    join(SRC, 'components', 'marketing', 'MarketingChrome.tsx'),
    join(SRC, 'app', '[locale]', 'my-albums', 'page.tsx'),
    ...pages,
  ];
}

function resolveTarget(spec: string, fromFile: string): string | null {
  if (spec.startsWith('@/')) return join(SRC, spec.slice(2));
  if (spec.startsWith('.')) return resolve(dirname(fromFile), spec);
  return null; // 外部包,不深入
}

function toSourceFile(base: string): string | null {
  const exts = ['.ts', '.tsx', '.js', '.jsx'];
  for (const e of exts) {
    try {
      if (statSync(base + e).isFile()) return base + e;
    } catch {}
  }
  try {
    if (statSync(base).isDirectory()) {
      for (const e of exts) {
        try {
          if (statSync(join(base, 'index' + e)).isFile()) return join(base, 'index' + e);
        } catch {}
      }
    }
  } catch {}
  return null;
}

// 递归 import 图。只跟 import/export ... from + import 'side' 的源码文件。
function walkGraph(anchors: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...anchors];
  const IMPORT_RE =
    /(?:import|export)\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
  while (stack.length) {
    const file = stack.pop();
    if (!file) continue; // 收窄 stack.pop() 的 string | undefined
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(text))) {
      const spec: string | undefined = m[2] ?? m[3];
      if (!spec) continue;
      const target = resolveTarget(spec, file);
      if (!target) continue;
      const src = toSourceFile(target);
      if (src && !seen.has(src)) stack.push(src);
    }
  }
  return seen;
}

// 找出图内文件里的 next-intl **value** import(不允许)。
// 返回 [{ file, lines: string[] }]。
function findIntlValueImports(
  graph: Set<string>,
): { file: string; lines: string[] }[] {
  const violations: { file: string; lines: string[] }[] = [];
  for (const file of [...graph].sort()) {
    const text = readFileSync(file, 'utf8');
    const bad: string[] = [];
    // 只匹配真实声明:import ... from / export { } from / export * from。
    // 刻意**不**用 `(?:import|export)\s+...` —— 那会把 `export function X() {...}`
    // 的整个函数体吞进来,误命中函数体里后续出现的 `from 'next-intl'`(假阳性)。
    const IMP_RE =
      /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]|export\s+(type\s+)?\{[\s\S]*?\}\s+from\s+['"]([^'"]+)['"]|export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
    let m;
    IMP_RE.lastIndex = 0;
    while ((m = IMP_RE.exec(text))) {
      // 三选一分支:import → spec=g3,type=g1;export{ } → spec=g5,type=g4;export* → spec=g6
      const spec = m[3] ?? m[5] ?? m[6];
      if (spec !== 'next-intl') continue; // 只盯客户端 next-intl,server/其它包放行
      const typeFlag = m[1] ?? m[4];
      if (typeFlag) continue; // import type / export type 编译期擦除,无害
      const body = (m[2] ?? m[5] ?? '')
        .replace(/\{|\}/g, '')
        .trim()
        .replace(/\s+/g, ' ');
      bad.push(`import { ${body} } from 'next-intl'`);
    }
    if (bad.length) violations.push({ file, lines: [...new Set(bad)] });
  }
  return violations;
}

test('MarketingChrome 整棵子树 + /my-albums 不得使用 next-intl 客户端 hook', () => {
  const roots = anchors();
  assert.ok(roots.length >= 3, '锚点应至少包含 MarketingChrome、my-albums 与一个营销页');
  const graph = walkGraph(roots);
  const violations = findIntlValueImports(graph);

  assert.deepEqual(
    violations,
    [],
    [
      '以下文件在无 NextIntlClientProvider 的子树里 import 了 next-intl value(会触发 SSR 500):',
      ...violations.flatMap((v) => [
        `  ${relative(process.cwd(), v.file)}`,
        ...v.lines.map((l) => `      ${l}`),
      ]),
      '',
      '修复:改用 next-intl 的 server 侧 API(如 getTranslations/getLocale,或把 locale 当 prop 传入),',
      '或确需客户端文案时改从 `import type` 引入纯类型。',
    ].join('\n'),
  );
});
