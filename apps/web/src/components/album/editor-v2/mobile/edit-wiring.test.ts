import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   移动端「编辑真的生效」的接线守卫。

   起因是两个真实事故,都不是样式问题、也不是某个 handler 漏接:

   ① **挂错了分支**:分流条件曾是 `mode === 'editing'`,而 mode 的判据是
      album.layoutJson != null。V3 生产代码里没有任何一处写 layout_json(只有读),
      所以真实相册永远 layoutJson==null → 永远是 authoring → 移动端一次都不会挂。
      而且 editing 那支的 pages 来自 album_pages(表里没有 html 列、getDetail 也不
      返回 htmlJson)→ 就算挂上了也没有 html 真相可打补丁,样式改动刷新即丢。
      书住在草稿里(authoring),那边的 pages 带 htmlJson,服务端 updatePage 也走
      draft 分支、认 textStyles/pageStyle —— 只有接那里才是端到端通的。

   ② **编辑焦点放在了展示层**:editPage 曾是 MobileEditor 的内部 state,而弹窗与
      落库都在 MobileEditorRoot。容器层不知道用户在编哪一页,任何页级改动都无处可落。

   这两条都是「看着做完了、其实一点用没有」的洞,靠点界面点不出来。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');
/** 剥掉注释再断言 —— 这些文件的说明里就写着要禁的那些词,那是文字不是代码。 */
const code = (...p: string[]) =>
  read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('移动端挂在 authoring(书住在草稿里)—— 不是只挂在 layoutJson 落地的遗留分支上', () => {
  const port = read('..', 'EditorPort.tsx');
  assert.match(port, /import \{ MobileEditorRoot \}/, 'EditorAuthoring 必须能挂移动端');
  // EditorAuthoring 里那句分流:拿的是草稿 skeleton 出来的 pages(带 htmlJson)。
  // 判据本身已抽到 design-gate-util(还要求「已选过封面组」,否则留在 ChatPanel 选主题),
  // 这里只管它仍挂在 authoring 且交出去的是草稿 pages —— 条件怎么算由那边的单测盯。
  assert.match(
    port,
    /shouldMountMobileEditor\(device, pages\)[\s\S]{0,320}<MobileEditorRoot[\s\S]{0,120}pages=\{pages\}/,
    'authoring 分支必须把草稿 pages(带 htmlJson = 页面真相)交给移动端',
  );
});

test('移动端拿到的 pages 必须是外部传进来的(不许再自己读 detail.pages)', () => {
  const root = code('MobileEditorRoot.tsx');
  assert.match(root, /pages: EditorPage\[\]/, 'pages 必须是 prop');
  // detail.pages 走的是没有 html 列的旧表 —— 用它就等于放弃页面真相。
  assert.doesNotMatch(
    root,
    /detail\.pages/,
    'MobileEditorRoot 不许读 detail.pages(那条路径没有 htmlJson,样式改动刷新即丢)',
  );
});

test('编辑焦点住在容器层:editPage / 选中 / 面板快照都在 Root', () => {
  const root = read('MobileEditorRoot.tsx');
  for (const s of ['editPage', 'selection', 'draftBase']) {
    assert.match(root, new RegExp(`useState[^\\n]*\\n?[^\\n]*${s}|\\[${s},`), `${s} 必须住在 Root`);
  }
  const view = read('MobileEditor.tsx');
  assert.doesNotMatch(
    view,
    /useState<number \| null>\(null\)/,
    'MobileEditor 不许再自己持有 editPage —— 容器层就不知道在编哪一页了',
  );
  assert.match(view, /editPage,/, 'editPage 必须从 props 来(纯受控)');
});

test('落库真的发生:完成 → PATCH pages/{index},走与桌面同一条通道', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(
    root,
    /fetch\(`\/api\/v1\/albums\/\$\{detail\.album\.id\}\/pages\/\$\{pageIndex\}`/,
    '页级改动必须 PATCH 到 pages/{index}',
  );
  assert.match(root, /method: 'PATCH'/);
  // 页索引用 page.pageIndex(存库口径),不是数组下标
  assert.match(root, /persistPage\(page\.pageIndex/, '落库要用 page.pageIndex,不是数组下标');
  // 文字与底色两条都要真的调
  assert.match(root, /textPatchBody\(/);
  assert.match(root, /pageBgPatchBody\(/);
});

test('内容改动失败必须出声(静默失败 = 用户以为改好了,刷新才发现白改)', () => {
  const root = read('MobileEditorRoot.tsx');
  const at = root.indexOf('const persistPage');
  const body = root.slice(at, at + 700);
  assert.match(body, /res\.ok/, '要看 HTTP 结果');
  assert.match(body, /say\(/, '失败要给用户反馈');
});

test('取消 = 把面板打开那一刻的整页快照放回去(不做反向撤销)', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /const cancelSheet = \(\) => \{[\s\S]{0,300}draftBase/);
  assert.match(root, /onCancel=\{cancelSheet\}/, 'sheet 的取消必须接到快照还原上');
});

test('预览与落库共用同一套 patcher(所见即所存)', () => {
  const root = code('MobileEditorRoot.tsx');
  const edit = read('page-edit.ts');
  // Root 不自己拼 html:一律经 page-edit 的 apply*,而它内部用的是与服务端同一批 patcher
  assert.doesNotMatch(root, /patchHtml/, 'Root 不许直接调 patcher —— 经 page-edit 走单一口径');
  assert.match(root, /applyTextEdit\(/);
  assert.match(root, /applyPageBg\(/);
  assert.match(edit, /from '\.\.\/\.\.\/page-html-dom'/, 'page-edit 必须复用共享 patcher');
});

test('传给移动端的页数组引用必须稳定(否则父层一重渲就把本地改动冲回加载时的草稿)', () => {
  // 真实事故(偶发,时序相关):EditorAuthoring 每次渲染都新建 pages 数组 →
  // MobileEditorRoot 的 useEffect(依赖 incomingPages)把本地副本整体换回服务端那份 →
  // 「改完返回,偶尔变回旧文案」。skeleton 已由 draftFingerprintRef 保证内容没变就不换引用,
  // 所以按 skeleton 记忆化即等价于「只在草稿真的变了时才换」。
  const port = read('..', 'EditorPort.tsx');
  assert.match(
    port,
    /const pages: EditorPage\[\] = useMemo\(/,
    'authoring 的 pages 必须 useMemo,引用不能每次渲染都变',
  );
  assert.match(port, /\[skeleton\],\s*\n\s*\);/, 'pages 应按 skeleton 记忆化');
  // Root 侧那条「服务端真相变了就整体换掉」的 effect 仍在(它靠上面的稳定引用才安全)
  const root = code('MobileEditorRoot.tsx');
  assert.match(root, /useEffect\(\(\) => setPages\(incomingPages\), \[incomingPages\]\)/);
});

test('换页/退出编辑时清掉选中(高亮框的 rect 是那一刻算的,换页就不对了)', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /onEnterEdit=\{[\s\S]{0,260}setSelection\(null\)/);
  assert.match(root, /onExitEdit=\{[\s\S]{0,200}setSelection\(null\)/);
});
