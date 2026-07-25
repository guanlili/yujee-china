import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   点击接线守卫。

   起因是真实事故:onMore / onOpenChat 是可选 handler,MobileEditorRoot 漏传 →
   按钮画在界面上却点不动(死按钮)。根治办法是把交互 handler 改成**必填**:
   漏接编译不过。这条测试盯住「必填」这个契约不被人偷偷改回可选。

   为什么用源码断言而不是渲染点击:React 的 onClick 不落进静态 HTML,renderToStaticMarkup
   看不到某个按钮是否真绑了 handler;而「handler 必填」这一步能在编译期挡住漏接,
   是比运行时更强的保证。这里守住那一步。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');

/** 抽出组件 props 类型体(从 `export type XProps = {` 到匹配的 `};`)。 */
function propsBlock(src: string, typeName: string): string {
  const start = src.indexOf(`export type ${typeName} = {`);
  assert.ok(start >= 0, `找不到 ${typeName}`);
  const end = src.indexOf('\n};', start);
  return src.slice(start, end);
}

// 两态的交互 handler 都必须必填(on...: () => void,不带 ?)。漏一个 = 允许死按钮。
const REQUIRED = [
  'onShare',
  'onExport',
  'onMore',
  'onOpenChat',
  'onPageBg',
  'onPickImage',
  'onPickText',
  'onDeletePage',
];

test('MobileEditor:所有交互 handler 必填(不许 on...?: —— 那会放行死按钮)', () => {
  const block = propsBlock(read('MobileEditor.tsx'), 'MobileEditorProps');
  for (const h of [...REQUIRED, 'onBoardBg']) {
    assert.match(block, new RegExp(`${h}: \\(\\) => void`), `${h} 必须必填`);
    assert.doesNotMatch(block, new RegExp(`${h}\\?:`), `${h} 不许改回可选(会放行死按钮)`);
  }
});

test('EditView:所有交互 handler 必填', () => {
  const block = propsBlock(read('EditView.tsx'), 'EditViewProps');
  for (const h of REQUIRED) {
    assert.match(block, new RegExp(`${h}: \\(\\) => void`), `${h} 必须必填`);
    assert.doesNotMatch(block, new RegExp(`${h}\\?:`), `${h} 不许改回可选`);
  }
});

test('MobileEditorRoot:每个必填 handler 都真的传下去了(不是空占)', () => {
  const root = read('MobileEditorRoot.tsx');
  for (const h of REQUIRED) {
    assert.match(root, new RegExp(`${h}=\\{`), `MobileEditorRoot 必须传 ${h}`);
  }
});

test('未实现功能不做死按钮:更多 / 删除接「即将上线」,AI 打开对话弹框', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /onMore=\{\(\) => soon\(/);
  assert.match(root, /onDeletePage=\{\(\) => soon\(/);
  // AI 气泡打开黑底小水母对话弹框,不再是 toast。
  assert.match(root, /onOpenChat=\{\(\) => setAiChatOpen\(true\)\}/);
});

/* ── 上面那三条只守住了「组件 props 必填」。真实事故里还有另外两类漏法,
      它们从 props 那一侧看不出来,得单独盯: ────────────────────────────────── */

/** mobile/ 下所有 .tsx(含 modals/)。 */
function allSources(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  for (const dir of ['.', 'modals']) {
    for (const f of readdirSync(join(here, dir))) {
      if (!f.endsWith('.tsx')) continue;
      out.push({ file: join(dir, f), src: readFileSync(join(here, dir, f), 'utf8') });
    }
  }
  return out;
}

test('漏法一:组件内部的空 onClick —— 画着能点、点了什么都不发生', () => {
  // 真实事故:TextPanel 的「更多颜色」曾是 onClick={() => { /* 待接 */ }}。
  // props 那一侧完全看不出来,因为它压根没有 handler prop。
  for (const { file, src } of allSources()) {
    // onClick={() => {}} / onClick={() => { 只有注释 }} / onClick={noop}
    assert.doesNotMatch(
      src,
      /onClick=\{\(\)\s*=>\s*\{\s*(\/\/[^\n]*\n\s*)*\}\}/,
      `${file} 有空 onClick —— 未实现就把 handler 提成必填 prop,由父层给反馈`,
    );
  }
});

test('漏法二:行为型可选 handler —— 父层漏传就是亮着的死按钮', () => {
  // 真实事故:PhotoPickerModal 的 onConfirm 与 CollageModal 的 onConfirm 都是可选,
  // MobileEditorRoot 两个都没传 → 选完照片/选完密度后按钮亮起,点了没反应。
  // 「确认/发送/提交」这类**动作**不许可选;onUpload 这类附加能力可以。
  const ACTIONS = /\b(onConfirm|onDone|onSend|onSubmit|onApply)\?:/;
  for (const { file, src } of allSources()) {
    assert.doesNotMatch(src, ACTIONS, `${file} 的动作 handler 不许可选(可选 = 可以不接 = 死按钮)`);
  }
});

test('漏法三:传下去的 handler 不许是空函数(等于没接)', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.doesNotMatch(
    root,
    /on[A-Z]\w*=\{\(\)\s*=>\s*\{\s*\}\}/,
    'MobileEditorRoot 里出现 on…={() => {}} —— 那是死按钮的另一种写法',
  );
});

test('AI 气泡用产品小水母素材,不用自造星芒', () => {
  for (const f of ['MobileEditor.tsx', 'EditView.tsx']) {
    const src = read(f);
    assert.match(src, /mai-jelly[^]*jellyfish-icon\.png/, `${f} AI 气泡应是小水母`);
    assert.doesNotMatch(src, /IconSparkle/, `${f} 不该再用自造星芒`);
  }
});

test('dev 预览返回键有反馈(不是 () => {} 空操作)', () => {
  const dev = readFileSync(
    join(here, '..', '..', '..', '..', 'app', '[locale]', 'dev', 'mobile', 'page.tsx'),
    'utf8',
  );
  assert.doesNotMatch(dev, /onBack=\{\(\) => \{\}\}/, 'dev 返回键不许是空操作');
  assert.match(dev, /window\.history\.back\(\)/, 'dev 返回键至少 history.back 有反馈');
});
