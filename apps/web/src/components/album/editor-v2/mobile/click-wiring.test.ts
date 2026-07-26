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

test('入口都接到真东西上;仍未实现的(删除页)才给「即将上线」', () => {
  const root = read('MobileEditorRoot.tsx');
  // 导出/分享/更多 现在都是真功能,不再是 toast。
  assert.match(root, /onExport=\{openExport\}/, '导出接闸门 + 导出菜单');
  assert.match(root, /onMore=\{\(\) => setMoreOpen\(true\)\}/, '「更多」打开菜单(里面是照片备份)');
  assert.match(root, /onShare=\{\(\) => \{[\s\S]{0,80}setShareOpen\(true\)/, '分享打开分享弹窗');
  assert.match(root, /onOpenChat=\{\(\) => setAiChatOpen\(true\)\}/);
  // 删除页线上也没有,仍是占位 —— 但必须有反馈,不许是死按钮。
  assert.match(root, /onDeletePage=\{\(\) => soon\(/);
});

test('导出四条格式全部接到真渲染上(不许只开菜单不干活)', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /onLive=\{[\s\S]{0,120}exporter\.exportLive\(\)/);
  assert.match(root, /onSinglePages=\{[\s\S]{0,120}exporter\.exportSinglePages\(\)/);
  assert.match(root, /onPdf=\{[\s\S]{0,120}exporter\.exportPdf\(\)/);
  // 拼图要先问密度,确认时才真导
  assert.match(root, /onCollage=\{[\s\S]{0,140}setCollageOpen\(true\)/);
  assert.match(root, /onConfirm=\{[\s\S]{0,200}exporter\.exportCollage\(/);
});

test('分享接的是真链路(备份照片 → 生成 token),不是 toast', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /onConfirm=\{\(\) => void share\.create\(bookPhotoIds, backup\.backup\)\}/);
  assert.match(root, /onCopy=\{\(\) => void share\.copy\(\)\}/);
  assert.match(root, /link=\{share\.state\.link\}/, '链接要从 hook 出,不许硬写 null');
  assert.doesNotMatch(root, /link=\{null\}/, 'link={null} 意味着第二步永远到不了');
});

test('「更多」里的照片备份接的是真上传(线上顶栏「保存」那条)', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /onBackupPhotos=\{[\s\S]{0,120}backup\.backup\(bookPhotoIds\)/);
  const hook = read('use-photo-backup.ts');
  assert.match(hook, /signPhotoSnapshotUpload/, '走与桌面同一批快照客户端');
  assert.match(hook, /putSnapshotBlob/);
  assert.match(hook, /confirmPhotoSnapshot/);
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

test('图片编辑接的是真几何(复用桌面 image-edit-util,不自己算)', () => {
  const view = read('EditView.tsx');
  assert.match(view, /from '\.\.\/image-edit-util'/, '几何走桌面那份(已单测的夹取/拖动映射)');
  assert.match(view, /dragToImagePos\(/, '平移走 dragToImagePos');
  assert.match(view, /clampImagePos\(/, '捏合缩放要夹进合法区间');
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /applyImagePos\(/);
  assert.match(root, /imagePosPatchBody\(/, '松手要落库');
  // 落库读 ref 不读 state:同一事件里先 live 再 commit,读 state 会拿到旧值把新位置覆盖回去
  assert.match(root, /const pos = imagePosRef\.current;/,
    '落库必须读 ref —— 读 state 会用旧位置覆盖刚预览的新位置(真机抓到过)');
});

test('图片面板开着时画板放行手势,否则拖不动那张图', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /passThrough=\{sheetKind === 'image'\}/);
  const sheet = readFileSync(join(here, 'modals', 'ElementSheet.tsx'), 'utf8');
  assert.match(sheet, /data-passthrough=\{passThrough \? '1' : undefined\}/);
  // 放行只作用在遮罩上,卡片仍要能点(否则又是「弹窗关不掉」)
  const css = readFileSync(join(here, 'mobile-editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.mes-overlay\[data-passthrough='1'\]\s*\{\s*pointer-events:\s*none/);
  assert.match(css, /\.mes-overlay\[data-passthrough='1'\] \.mes-card\s*\{\s*pointer-events:\s*auto/);
});

test('线上没有的功能不许造:换图入口不存在', () => {
  const files = readdirSync(join(here, 'modals'));
  assert.ok(!files.includes('PhotoPickerModal.tsx'),
    '桌面 PICK_PHOTOS 是硬编码占位、confirm 只关弹窗 —— 线上没有换图,移动端不该有');
  const root = read('MobileEditorRoot.tsx');
  assert.doesNotMatch(root, /PhotoPickerModal/);
});
