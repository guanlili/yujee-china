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

test('入口都接到真东西上', () => {
  const root = read('MobileEditorRoot.tsx');
  // 导出/分享/更多 现在都是真功能,不再是 toast。
  assert.match(root, /onExport=\{openExport\}/, '导出接闸门 + 导出菜单');
  assert.match(root, /onMore=\{\(\) => setMoreOpen\(true\)\}/, '「更多」打开菜单(里面是照片备份)');
  assert.match(root, /onShare=\{\(\) => \{[\s\S]{0,80}setShareOpen\(true\)/, '分享打开分享弹窗');
  assert.match(
    root,
    /onOpenChat=\{[\s\S]{0,240}classList\.remove\('chat-collapsed'\)/,
    'AI 气泡展开对话抽屉(摘宿主的 chat-collapsed,与桌面 openChat 同机制)',
  );
  // 删除页(2026-08-03 落地):不再是「即将上线」占位,接到确认弹窗流程 ——
  // 接线细节(单发射点/回滚/守卫)在 ../delete-page-wiring.test.ts。
  assert.match(root, /onDeletePage=\{requestDeletePage\}/);
  assert.doesNotMatch(root, /onDeletePage=\{\(\) => soon\(/, '占位 toast 已退场,不许回来');
});

test('导出四条格式全部接到真渲染上(不许只开菜单不干活)', () => {
  const root = read('MobileEditorRoot.tsx');
  // Live 与拼图同形:先选样式(翻页/九宫格)再导 —— 与桌面同一步骤,不在菜单里直接开跑。
  assert.match(root, /onLive=\{[\s\S]{0,160}setLiveStyleOpen\(true\)/);
  assert.match(root, /picked === 'nine-grid'\) void exporter\.exportNineGrid\(\)/, '九宫格样式要接到九宫格导出');
  assert.match(root, /else if \(picked === 'flip'\) void exporter\.exportLive\(\)/, '翻页样式要接到翻页导出');
  assert.match(root, /onSinglePages=\{[\s\S]{0,120}exporter\.exportSinglePages\(\)/);
  assert.match(root, /onPdf=\{[\s\S]{0,120}exporter\.exportPdf\(\)/);
  // 拼图要先问密度,确认时才真导
  assert.match(root, /onCollage=\{[\s\S]{0,140}setCollageOpen\(true\)/);
  assert.match(root, /onConfirm=\{[\s\S]{0,200}exporter\.exportCollage\(/);
});

test('移动端 Live 生成完成后必须出现保存入口,由第二次点击触发系统交付', () => {
  const root = read('MobileEditorRoot.tsx');
  const hook = read('use-export.ts');

  assert.match(
    hook,
    /setExportReady\(\{[\s\S]{0,100}kind: 'live'[\s\S]{0,180}video:/,
    '视频生成完应先暂存为待保存产物',
  );
  assert.match(hook, /deliverExport/, 'hook 必须暴露由保存按钮调用的交付动作');
  assert.match(root, /<ExportReadyModal/, '生成结束必须显示明确的保存弹窗');
  assert.match(root, /open=\{exporter\.exportReady\}/);
  assert.match(root, /onSave=\{[\s\S]{0,180}exporter\.deliverExport\(\)/);
});

test('移动端所有导出格式都先生成待保存产物,再由明确点击统一交付', () => {
  const root = read('MobileEditorRoot.tsx');
  const hook = read('use-export.ts');

  assert.match(hook, /type ExportReadyAsset/, '待保存状态不能只服务 Live');
  assert.match(
    hook,
    /const exportCollage[\s\S]{0,1800}stageExportFiles\(/,
    '拼图必须进入待保存状态',
  );
  assert.match(
    hook,
    /const exportSinglePages[\s\S]{0,1000}stageExportFiles\(/,
    '单页图片必须进入待保存状态',
  );
  assert.match(
    hook,
    /const exportPdf[\s\S]{0,2200}setExportReady\(\{/,
    'PDF 必须进入待保存状态',
  );
  assert.doesNotMatch(
    hook,
    /\bdownloadBlobs?\(/,
    '异步渲染结束后直接伪造下载点击会被移动端静默拦截',
  );
  assert.match(root, /<ExportReadyModal/, '所有格式生成结束后都应显示统一保存入口');
  assert.match(root, /open=\{exporter\.exportReady\}/);
  assert.match(root, /onSave=\{[\s\S]{0,180}exporter\.deliverExport\(\)/);
});

test('分享接的是真链路(备份照片 → 生成 token),不是 toast', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /onConfirm=\{\(\) => void share\.create\(bookPhotoIds, backup\.backup\)\}/);
  assert.match(root, /onCopy=\{\(\) => void share\.copy\(\)\}/);
  assert.match(root, /link=\{share\.state\.link\}/, '链接要从 hook 出,不许硬写 null');
  assert.doesNotMatch(root, /link=\{null\}/, 'link={null} 意味着第二步永远到不了');
});

test('照片备份接的是真上传(顶栏「保存」与「更多」共用那条)', () => {
  const root = read('MobileEditorRoot.tsx');
  // 备份逻辑抽成了 runBackup(顶栏「保存」与「更多」共用),不再内联在 onBackupPhotos 上,
  // 所以这里盯 runBackup 里真调了上传,而不是盯某个 prop 后面跟着什么。
  assert.match(root, /const runBackup = useCallback\([\s\S]{0,200}backup\.backup\(bookPhotoIds\)/);
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

test('图片编辑不靠弹窗:选中即可在画布上捏合/拖动', () => {
  // 旧实现是「开图片面板 + 遮罩 passThrough 放行手势」,绕一大圈才够得着那张图。
  // 现在缩放/平移直接在画布上做,面板整个去掉了 —— 判据只看选中。
  const view = read('EditView.tsx');
  assert.match(
    view,
    /const imageEditing = imagePos != null;/,
    '手势判据只看「选中的是图槽」',
  );
  assert.doesNotMatch(
    view,
    /imagePos != null && sheetOpen/,
    '再挂 sheetOpen 就等于手势永远不生效(没有图片面板了)',
  );
  const root = read('MobileEditorRoot.tsx');
  assert.doesNotMatch(root, /setSheetKind\('image'\)/, '图片不该再开面板');
  assert.ok(
    !readdirSync(join(here, 'modals')).includes('ImagePanel.tsx'),
    '图片面板已废弃,不留死代码',
  );
});

test('换图必须接本册真照片,不许再造一个硬编码占位', () => {
  // 这条原本是「换图入口不存在」:桌面 PICK_PHOTOS 是 8 条写死的 unsplash URL、
  // confirm 只关弹窗,那是个假功能,所以当时禁止移动端照抄一个。
  // 现在移动端先行做了**真**换图(用户拍板):照片取自本册 photoIds + photoStore 缩略图,
  // 选完只改 imagesJson 并落库(html 的 {{IMG_SRC}} token 不动)。守卫因此改为盯住
  // 「不许再出现假的」—— 桌面那份占位仍未清理,别让它被抄过来。
  const picker = readFileSync(join(here, 'modals', 'PhotoPickerSheet.tsx'), 'utf8');
  assert.doesNotMatch(picker, /unsplash|https?:\/\//i, '不许硬编码图片 URL');
  assert.match(picker, /photoIds/, '照片必须来自本册');
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /applyImageSwap\(/, '换图要真改数据层');
  assert.match(root, /imagesPatchBody\(/, '换图要真落库,不能只关弹窗');
});

test('顶栏「保存」= 备份照片到云端,与「更多」里那条同一个 handler', () => {
  // 桌面顶栏一直有这枚(EditorPort 的 save-btn / data-action="backupPhotos"),移动端原先
  // 只藏在「更多」里,两端不齐。照片只存在本地(invariant 1),不备份换设备就是空白页,
  // 这个入口不该要点两次才找得到。
  const bar = readFileSync(join(here, 'MobileTopbar.tsx'), 'utf8');
  assert.match(bar, /onClick=\{onSave\}/, '顶栏必须有保存按钮');
  assert.match(bar, /data-backup-state=\{backupState\}/, '备份态要长在按钮上,别让人不知道有没有传完');
  assert.match(bar, /disabled=\{backupState === 'backing-up'\}/, '备份中要禁点');

  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /const runBackup = useCallback/, '两个入口必须共用一份 handler');
  assert.match(root, /onSave=\{runBackup\}/, '顶栏接的是它');
  assert.match(root, /onBackupPhotos=\{runBackup\}/, '「更多」接的也是它');
  assert.doesNotMatch(
    root,
    /onBackupPhotos=\{\(\) =>/,
    '别把备份逻辑再内联一份 —— 改口径时必漏一处',
  );
});

test('AI 对话 = 桌面 ChatPanel 本体,移动树不许再自连 design-chat', () => {
  // 流式收发、done 兜底文案、历史回放这些行为全住在 ChatPanel(那一份有自己的守卫);
  // 移动树只负责挂载 + 协调器。「挂的是本体」的细则见 chat-replay-wiring.test.ts。
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /<ChatPanel/, '成书后的对话必须是 ChatPanel 本体');
  assert.doesNotMatch(
    root,
    /design-chat/,
    '移动树自连 design-chat = 第二套对话壳的开端(2026-08-03 被用户否掉的路线)',
  );
});

test('设计对话的「当前页」跟编辑焦点走(消解「这页」类指代)', () => {
  const coordinator = read('use-chat-coordinator.ts');
  assert.match(
    coordinator,
    /authoringFocusPageIndex: \(\) => deps\(\)\.editPage \?\? 0/,
    'ChatPanel 发 design-chat 时的 currentPageIndex 要来自移动树的编辑焦点',
  );
});

test('AI 改完书要原地换页,并收掉过期的选中', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(
    root,
    /const replacePagesFromChat = useCallback\(\(next: EditorPage\[\]\) => \{\s*\n\s*setPages\(next\);\s*\n\s*setSelection\(null\)/,
    'committed 的 pages 直接换上(不重拉草稿),且选中框的 rect 不再对得上,必须收掉',
  );
});
