import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createLatestCommit } from '../filter-controller';

/* ════════════════════════════════════════════════════════════════════════════
   移动端图片 URL 的生命周期。

   ── 真机症状 ────────────────────────────────────────────────────────────────
   同一个浏览器、同一本书:桌面宽度有照片,一缩到移动宽度**整本都是空图槽**。
   控制台数出来是 `{树: true, 图槽: 20, 有图: 0}` —— 页面结构全对,就是一个 URL 都没有。

   ── 根因 ────────────────────────────────────────────────────────────────────
   createLatestCommit 的 dispose() 是**不可逆**的(disposed 没有任何地方改回 false),
   而移动端把提交器放在 `useMemo(..., [])` 里、dispose 挂在一个独立 effect 的 cleanup 上。
   React StrictMode(Next dev 默认开)会「装作卸载一次再重新挂载」:

     挂载 → useMemo 建好提交器 → effect 跑 run() → **模拟卸载** → dispose() 永久置位
          → effect 再跑 run() → 撞上 `if (disposed) return` → 永远不提交

   提交器活在 useMemo 里,同一个组件实例的模拟重挂不会重建它,于是它带着 disposed=true
   活到天荒地老。桌面免疫是因为那条路(EditorAuthoring)用的是朴素 cancelled 标志、
   把结果当 prop 传下去,压根没走这个提交器。

   ── 修法 ────────────────────────────────────────────────────────────────────
   提交器**在 effect 内部创建**:模拟卸载 dispose 掉的是那一对,重跑时会新建一对。
   StrictMode 正确、真卸载也正确,而且不再需要 invalidate(dispose 已经含了它)。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

/** 模拟 React StrictMode 的挂载序列:effect → cleanup → effect(同一个组件实例)。 */
async function runStrictModeCycle(
  mount: () => () => void,
): Promise<void> {
  const cleanup1 = mount();
  cleanup1();
  const cleanup2 = mount();
  await Promise.resolve();
  await Promise.resolve();
  cleanup2();
}

test('回归:提交器活在 effect 外时,StrictMode 的模拟卸载会把它永久废掉', async () => {
  // 这就是出问题的那个形状 —— 提交器在 effect 外只建一次(等价 useMemo([]))。
  const committed: string[] = [];
  const commit = createLatestCommit<string>((v) => committed.push(v));

  await runStrictModeCycle(() => {
    void commit.run(async () => 'urls');
    return () => commit.dispose();
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(committed, [], 'dispose 不可逆:第二轮 run 直接空转,一个 URL 都提交不了');
});

test('提交器在 effect 内部创建时,StrictMode 走完仍然提交得出来', async () => {
  const committed: string[] = [];

  await runStrictModeCycle(() => {
    const commit = createLatestCommit<string>((v) => committed.push(v));
    void commit.run(async () => 'urls');
    return () => commit.dispose();
  });

  assert.deepEqual(committed, ['urls'], '第二轮用的是新提交器,不受第一轮 dispose 影响');
});

test('移动端不再把图片 URL 的提交器挂在 useMemo 外面', () => {
  const root = read('MobileEditorRoot.tsx');

  // 提交器必须在 effect 内建:否则 StrictMode 的模拟卸载会把它废掉,整本书没有图。
  assert.match(
    root,
    /useEffect\(\(\) => \{[\s\S]{0,400}const display = createLatestCommit/,
    '图片 URL 的提交器要在 effect 内部创建',
  );
  assert.doesNotMatch(
    root,
    /const displayCommit = useMemo\(/,
    'useMemo([]) + 独立 dispose effect 正是这次的 bug 形状,不许回来',
  );
  assert.doesNotMatch(
    root,
    /const thumbCommit = useMemo\(/,
  );
  // 两档仍然都要取,依赖仍然是 photoIds + photoFilter。
  assert.match(root, /getTierUrls\(photoIds,\s*'display',\s*photoFilter\)/);
  assert.match(root, /getTierUrls\(photoIds,\s*'thumb',\s*photoFilter\)/);
  // 依赖里必须有 photoIds 与 photoFilter(这条守的是「换书/换滤镜要重解」)。
  // 不写死成恰好两项 —— 2026-09-10 加了 maskEpoch:服务端抠图 mask 到货后要重解一遍,
  // 否则整个会话都停在漫水填充那版。多一个合理依赖不该判失败,少了这两个才是 bug。
  const deps = /\}, \[(photoIds[^\]]*)\]\);/.exec(root)?.[1] ?? '';
  assert.ok(deps.length > 0, '取图 effect 应有依赖数组');
  assert.match(deps, /\bphotoIds\b/);
  assert.match(deps, /\bphotoFilter\b/);
});

test('桌面那条路不受影响 —— 它本来就不靠这个提交器出首帧', () => {
  const editorPort = read('..', 'EditorPort.tsx');
  // EditorAuthoring 用朴素 cancelled 标志解析首帧 URL,再当 prop 传下去。
  assert.match(editorPort, /if \(cancelled\) return;[\s\S]{0,200}setImageUrls\(urls\)/);
  assert.match(editorPort, /initialImageUrls=\{imageUrls\}/);
});
