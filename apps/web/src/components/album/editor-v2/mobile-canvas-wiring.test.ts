import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const editorSrc = () => readFileSync(join(here, 'EditorPort.tsx'), 'utf8') + '\n\n' + readFileSync(join(here, 'EditorBook.tsx'), 'utf8');

test('EditorPort 不再直接调 matchMedia(max-width:767px),改走 resolveDeviceMode', () => {
  const s = editorSrc();
  assert.equal(
    /matchMedia\(\s*['"]\(max-width:\s*767px\)['"]\s*\)/.test(s), false,
    '不应再有裸 matchMedia(max-width:767px)',
  );
  assert.match(s, /resolveDeviceMode\(window\.innerWidth\)\s*===\s*'mobile'/);
  assert.match(s, /from '\.\/mobile-canvas'/);
});

test('EditorBook effect 挂载 initMobileCanvas 且在 cleanup 里 teardown', () => {
  const s = editorSrc();
  assert.match(s, /initMobileCanvas\(/);
  // #304 Important fix2: initMobileCanvas 返回值从裸 teardown 函数改成
  // { teardown, refreshChapters } 对象,cleanup 相应改调 mobileCanvas.teardown()。
  assert.match(s, /mobileCanvas\.teardown\(\)/);
});

const cssSrc = () => readFileSync(join(here, 'editor-port.css'), 'utf8');

test('移动端 book-stage 不再硬编码 220px,改由 --dock-h 记账(缺省 0)', () => {
  const css = cssSrc();
  assert.equal(/padding:\s*20px 12px 220px/.test(css), false, '删掉硬编码 220px');
  assert.match(css, /var\(--dock-h,\s*0px\)/, 'book-stage 底距用 --dock-h 缺省 0');
  assert.match(css, /env\(safe-area-inset-bottom/, '底部安全区');
});

const mobileCanvasSrc = () => readFileSync(join(here, 'mobile-canvas.ts'), 'utf8');

test('浏览态左下角两钮:类名存在且样式引用现成 token,不新造颜色(strip 已删)', () => {
  const css = cssSrc();
  assert.match(css, /\.mc-dens\b/);
  assert.match(css, /\.mc-board-bg\b/);
  // strip 已按用户反馈删除:不应再有 mc-strip 样式
  assert.equal(/\.mc-strip\b/.test(css), false, 'strip 已删,不应再有 mc-strip 样式');
  // 背景/圆角/阴影必须引用现成变量
  assert.match(css, /\.mc-dens[^}]*var\(--surface\)/);
  // 禁止在左下角两钮里出现裸 hex 颜色(强制用 token)
  const block = css.slice(css.indexOf('.mc-dens'), css.indexOf('.mc-board-bg') + 300);
  assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(block), false, '左下角两钮不得写死 hex,一律 var(--*)');
});

test('mobile-canvas 浏览态调用密度/页窗口纯函数并接现有 openBoardBgModal', () => {
  const s = mobileCanvasSrc();
  assert.match(s, /cycleDensity\(/);
  assert.match(s, /pageWindow\(/);
  assert.match(s, /clampStart\(/);
  assert.match(s, /data-mobile-density/);
});

test('浏览态点页进编辑:捕获阶段抢占 surfaceClick,不误弹书页背景 sheet(#304)', () => {
  const s = mobileCanvasSrc();
  // 进编辑的 click 监听必须挂在 #ovGrid 捕获阶段(第三参 true)—— 捕获先于
  // EditorPort 绑在同一元素上的冒泡 surfaceClick 抵达,才拦得住它。
  assert.match(
    s,
    /ovGrid\.addEventListener\(\s*'click',\s*onOvGridEditClick,\s*true\s*\)/,
    '进编辑的 click 监听必须以 capture=true 注册在 #ovGrid',
  );
  // handler 体内必须先判浏览态再 stopImmediatePropagation,只在浏览态命中页格子时
  // 掐断事件,不能无条件拦——否则会连编辑态里 Task10 要用的 surfaceClick 也一起挡掉。
  const fnStart = s.indexOf('const onOvGridEditClick');
  const fnEnd = s.indexOf('ovGrid.addEventListener', fnStart);
  const fnBody = s.slice(fnStart, fnEnd);
  assert.match(fnBody, /if\s*\(state\s*!==\s*'browse'\)\s*return;/, '非浏览态必须提前 return,不拦截');
  const guardIdx = fnBody.indexOf("if (state !== 'browse') return;");
  const stopIdx = fnBody.indexOf('stopImmediatePropagation');
  assert.ok(stopIdx > -1, 'handler 内必须调用 stopImmediatePropagation 抢占 surfaceClick');
  assert.ok(stopIdx > guardIdx, 'stopImmediatePropagation 必须在浏览态判断之后,不能无条件拦截');
});

test('编辑态:点页进 enterEdit,手势走 arbitrateGesture,重绘不靠 transform 放大', () => {
  const s = mobileCanvasSrc();
  assert.match(s, /arbitrateGesture\(/);
  assert.match(s, /enterEdit\(/);
  // 禁止在编辑态放大里用 transform:scale(超过 1) 冒充满屏(会糊)
  assert.equal(/transform:\s*`?scale\(/.test(s), false, '满屏靠重绘,不靠 transform 放大');
});

test('编辑态一级栏 .mc-l1 三格(背景/图片/文字),无删除格(#304 覆盖1搁置删除)', () => {
  const s = mobileCanvasSrc();
  assert.match(s, /\bmc-l1\b/);
  assert.match(s, /背景/, '一级栏须有「背景」格');
  assert.match(s, /图片/, '一级栏须有「图片」格');
  assert.match(s, /文字/, '一级栏须有「文字」格');
  assert.equal(/mc-del/.test(s), false, '搁置删除:不得出现 mc-del');
  assert.equal(/confirmDeletePage/.test(s), false, '搁置删除:不得调用 confirmDeletePage');
  // 一级栏本体(l1 相关代码段)不得夹带「删除」字样;不对全文件断言 —— 文件里既有的
  // panelSpec 设计注释(#304 Task9 遗留,描述删除面板 kind 的通用形态)与本任务的
  // 「搁置删除格」无关,不该被误伞。
  const l1Start = s.indexOf('const l1 = document.createElement');
  const l1End = s.indexOf('return {\n    teardown:');
  assert.ok(l1Start > -1 && l1End > l1Start);
  assert.equal(/删除/.test(s.slice(l1Start, l1End)), false, '一级栏代码段不得出现「删除」字样');
});

test('一级栏「背景」接线到现有 openMobileSheet(page),在 EditorPort 挂载点填入(#304 覆盖3)', () => {
  const s = editorSrc();
  const mountStart = s.indexOf('initMobileCanvas({');
  assert.ok(mountStart > -1, 'EditorPort 必须挂载 initMobileCanvas');
  const mountEnd = s.indexOf('});', mountStart);
  const mountBlock = s.slice(mountStart, mountEnd);
  assert.match(
    mountBlock,
    /openPageBg:\s*\(\)\s*=>\s*openMobileSheet\(\s*['"]page['"]\s*\)/,
    'openPageBg 必须在挂载点接现有 openMobileSheet(\'page\')',
  );
});

test('一级栏 .mc-l1 CSS block 不写死 hex,一律引用 token(#304 覆盖1/3)', () => {
  const css = cssSrc();
  const idx = css.indexOf('.mc-l1');
  assert.ok(idx > -1, '.mc-l1 样式必须存在');
  const block = css.slice(idx, idx + 600);
  assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(block), false, '一级栏不得写死 hex,一律 var(--*)');
});

test('AI 气泡:用产品小水母形象(jellyfish),不是自造图标(#304 真机修)', () => {
  const s = mobileCanvasSrc();
  // 产品 AI 形象是小水母(与 ChatPanel 思考态同素材);气泡必须用它,禁自造 SVG 星芒等。
  assert.match(s, /jellyfish-icon\.png/, 'AI 气泡必须用产品小水母 jellyfish-icon.png');
  const css = cssSrc();
  assert.match(css, /\.mc-ai-fab\b/);
  // 水母呈现沿用休息态 .await-jelly 语言:contain + multiply,不硬编码品牌色。
  assert.match(css, /\.mc-fab-jelly[\s\S]*?mix-blend-mode:\s*multiply/);
});

test('AI 气泡:mobile-canvas.ts 建 .mc-ai-fab 且 click 调 openChat(#304 Task11)', () => {
  const s = mobileCanvasSrc();
  assert.match(s, /mc-ai-fab/, 'mobile-canvas.ts 必须建 .mc-ai-fab');
  assert.match(s, /ctx\.openChat\(\)/, 'AI 气泡点击必须调用 ctx.openChat()');
});

test('AI 气泡:移动端隐藏通用 .chat-fold-expand,避免双气泡并存(#304 Task11)', () => {
  const css = cssSrc();
  const mobileBlockStart = css.indexOf('@media (max-width:767px)');
  assert.ok(mobileBlockStart > -1, '移动端媒体查询段必须存在');
  const mobileBlock = css.slice(mobileBlockStart);
  assert.match(mobileBlock, /\.chat-fold-expand\s*\{\s*display:\s*none/, '移动端应隐藏通用收起气泡,避免和品牌 AI 气泡并存');
});

test('移动端编辑期默认收起对话:mobile 分支 isEditingPhase() 守卫下 add chat-collapsed(#304 fix)', () => {
  const s = mobileCanvasSrc();
  const mobileBranchStart = s.indexOf("resolveDeviceMode(ctx.getWidth()) === 'mobile'");
  assert.ok(mobileBranchStart > -1, 'mobile 分支必须存在');
  const mobileBranch = s.slice(mobileBranchStart);
  assert.match(
    mobileBranch,
    /if\s*\(\s*ctx\.isEditingPhase\(\)\s*\)\s*\{\s*ctx\.root\.classList\.add\(\s*['"]chat-collapsed['"]\s*\)/,
    '编辑期(isEditingPhase())进入时必须 add chat-collapsed,默认收起对话',
  );
  // teardown 必须移除该类,避免卸载/切态后残留影响桌面或创作期对话
  assert.match(
    s,
    /cleanups\.push\(\s*\(\)\s*=>\s*ctx\.root\.classList\.remove\(\s*['"]chat-collapsed['"]\s*\)\s*\)/,
    'teardown 必须移除 chat-collapsed,避免残留',
  );
});

test('EditorPort 挂载点接 isEditingPhase: () => mode === "editing"(#304 fix)', () => {
  const s = editorSrc();
  const mountStart = s.indexOf('initMobileCanvas({');
  assert.ok(mountStart > -1, 'EditorPort 必须挂载 initMobileCanvas');
  const mountEnd = s.indexOf('});', mountStart);
  const mountBlock = s.slice(mountStart, mountEnd);
  assert.match(
    mountBlock,
    /isEditingPhase:\s*\(\)\s*=>\s*mode\s*===\s*'editing'/,
    'isEditingPhase 必须接 mode === \'editing\'(创作期 authoring 不受影响)',
  );
});

test('顶栏精简(#304 Task13):移动端右侧只留 分享 + 导出,保存/头像隐藏,导出降为图标', () => {
  const css = cssSrc();
  const mobileBlockStart = css.indexOf('@media (max-width:767px)');
  assert.ok(mobileBlockStart > -1, '移动端媒体查询段必须存在');
  const mobileBlock = css.slice(mobileBlockStart);

  // (a) 保存按钮移动端整个隐藏
  assert.match(
    mobileBlock,
    /\.editor-port \.save-btn\s*\{[^}]*display:\s*none/,
    '.save-btn 在移动端必须 display:none',
  );

  // (b) 头像/UserMenu(它渲染的根 div 只有通用 className="relative",不可靠选中;
  //     退而用 .top-right 容器的最后一个直接子级 —— EditorPort.tsx 里 <UserMenu> 是
  //     .top-right 下最后一个直接子节点)
  assert.match(
    mobileBlock,
    /\.editor-port \.top-right\s*>\s*\*:last-child\s*\{[^}]*display:\s*none/,
    '.top-right 最后一个直接子级(UserMenu)在移动端必须 display:none',
  );

  // (c) 导出 .btn-primary 移动端去黑底,变透明/非黑背景
  const btnPrimaryStart = mobileBlock.indexOf('.editor-port .btn-primary{');
  assert.ok(btnPrimaryStart > -1, '移动端必须有 .btn-primary 覆盖规则');
  const btnPrimaryBlock = mobileBlock.slice(btnPrimaryStart, mobileBlock.indexOf('}', btnPrimaryStart));
  assert.match(btnPrimaryBlock, /background:\s*transparent/, '.btn-primary 移动端背景必须变透明(去黑 pill)');
  assert.doesNotMatch(btnPrimaryBlock, /bg-fg/, '不应残留 bg-fg 黑底效果的痕迹');

  // 全 token,禁裸 hex(本次新增的顶栏精简规则块内)
  const newBlockSlice = mobileBlock.slice(
    mobileBlock.indexOf('.editor-port .save-btn{ display:none'),
    mobileBlock.indexOf('.editor-port .share-btn{ width:44px') + 200,
  );
  assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(newBlockSlice), false, '顶栏精简新规则不得写死 hex,一律 var(--*)/token');
});

test('位置条存在,dock-h 由 JS 实时写入(参照 --canvas-inset 维护法)(#304 Task14)', () => {
  const s = mobileCanvasSrc();
  assert.match(s, /mc-subbar\b/, '位置条容器 mc-subbar 必须存在于 mobile-canvas.ts');
  assert.match(
    s,
    /setProperty\(\s*['"]--dock-h['"]/,
    '底部住户变化时必须用 JS 实时 setProperty(\'--dock-h\', ...)(参照 --canvas-inset 维护法)',
  );
  assert.match(s, /canvasVisibleHeight\(/, '必须调用 Task3 的 canvasVisibleHeight,不能沦为死代码');

  const css = cssSrc();
  assert.match(css, /\.mc-subbar\b/, '.mc-subbar 样式必须存在于 editor-port.css');
});

test('window resize 有 debounced 监听,挂载态内重测 --dock-h + applyWindow(#304 Task14)', () => {
  const s = mobileCanvasSrc();
  assert.match(
    s,
    /window\.addEventListener\(\s*['"]resize['"]/,
    '必须有 window resize 监听,移动态内 resize 时重测 --dock-h 与密度窗口',
  );
});

test('.mc-subbar CSS block 不写死 hex,一律引用 token(#304 Task14)', () => {
  const css = cssSrc();
  const idx = css.indexOf('.editor-port .mc-subbar{');
  assert.ok(idx > -1, '.mc-subbar 样式必须存在');
  const end = css.indexOf('\n}\n', css.lastIndexOf('.editor-port .mc-subbar-folio{'));
  const block = css.slice(idx, end > -1 ? end : idx + 800);
  assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(block), false, '.mc-subbar 样式块不得写死 hex,一律 var(--*)');
});

test('MobileCanvasCtx 挂 chapters(),EditorPort 挂载点接现有 chapters 变量(#304 Task14)', () => {
  const s = mobileCanvasSrc();
  assert.match(
    s,
    /chapters:\s*\(\)\s*=>\s*\{\s*label:\s*string;\s*spread:\s*number\s*\}\[\]/,
    'MobileCanvasCtx 类型必须新增 chapters: () => {label:string;spread:number}[]',
  );

  const editorSrcNow = editorSrc();
  const mountStart = editorSrcNow.indexOf('initMobileCanvas({');
  assert.ok(mountStart > -1, 'EditorPort 必须挂载 initMobileCanvas');
  const mountEnd = editorSrcNow.indexOf('});', mountStart);
  const mountBlock = editorSrcNow.slice(mountStart, mountEnd);
  assert.match(
    mountBlock,
    /chapters:\s*\(\)\s*=>\s*chapters/,
    '挂载点必须把现有 chapters 变量原样接给 ctx.chapters',
  );
});

test('章节高亮用精确 spreadIndexOfPage,不再用 flat/2 近似换算(#304 Important fix1)', () => {
  const s = mobileCanvasSrc();
  assert.equal(
    /Math\.floor\(\s*currentPage\s*\/\s*2\s*\)/.test(s),
    false,
    'mobile-canvas.ts 不应再有 Math.floor(currentPage / 2) 近似换算',
  );
  assert.match(
    s,
    /ctx\.spreadOfPage\(\s*currentPage\s*\)/,
    '章节高亮必须改用 ctx.spreadOfPage(currentPage) 精确映射',
  );
  assert.match(
    s,
    /spreadOfPage:\s*\(pageIndex:\s*number\)\s*=>\s*number/,
    'MobileCanvasCtx 类型必须新增 spreadOfPage: (pageIndex: number) => number',
  );

  const editorSrcNow = editorSrc();
  const mountStart = editorSrcNow.indexOf('initMobileCanvas({');
  assert.ok(mountStart > -1, 'EditorPort 必须挂载 initMobileCanvas');
  const mountEnd = editorSrcNow.indexOf('});', mountStart);
  const mountBlock = editorSrcNow.slice(mountStart, mountEnd);
  assert.match(
    mountBlock,
    /spreadOfPage:\s*\(i\)\s*=>\s*spreadIndexOfPage\(\s*spreads,\s*i\s*\)/,
    '挂载点必须把 ctx.spreadOfPage 接到桌面同款 spreadIndexOfPage(spreads, i)',
  );
});

test('editing 模式章节 fetch 成功后触发移动端位置条刷新钩子,否则 chips 永不显示(#304 Important fix2)', () => {
  const s = mobileCanvasSrc();
  // initMobileCanvas 必须暴露一个可被外部触发的章节刷新钩子(挂在返回值上,teardown 之外)。
  assert.match(
    s,
    /refreshChapters/,
    'mobile-canvas.ts 必须存在 refreshChapters 刷新钩子',
  );
  assert.match(
    s,
    /return\s*\{\s*teardown:/,
    'initMobileCanvas 返回值必须是 { teardown, refreshChapters } 对象(不再是裸函数)',
  );

  const editorSrcNow = editorSrc();
  // 定位 editing 模式的 chapters fetch 成功回调(fetch(`/api/v1/albums/${albumId}/chapters`)):
  // renderRail() 旁边必须紧跟着触发移动端刷新钩子的调用,否则主线路径下 chips 永远不出现。
  const fetchStart = editorSrcNow.indexOf("fetch(`/api/v1/albums/${albumId}/chapters`)");
  assert.ok(fetchStart > -1, 'EditorPort 必须存在 editing 模式的章节 fetch');
  const fetchEnd = editorSrcNow.indexOf('.catch(() => {});', fetchStart);
  assert.ok(fetchEnd > -1, '章节 fetch 链必须以 .catch(() => {}) 收尾');
  const fetchBlock = editorSrcNow.slice(fetchStart, fetchEnd);
  assert.match(fetchBlock, /renderRail\(\)/, '章节 fetch 成功回调必须仍调 renderRail()(桌面 rail 不能回归)');
  assert.match(
    fetchBlock,
    /mobileCanvas\.refreshChapters\(\)/,
    '章节 fetch 成功回调必须调用 mobileCanvas.refreshChapters(),否则移动端位置条永远等不到章节数据',
  );
  // renderRail() 之后才调刷新钩子(顺序不敏感也行,但确保两者都在同一个 then 回调体内)
  const renderRailIdx = fetchBlock.indexOf('renderRail()');
  const refreshIdx = fetchBlock.indexOf('mobileCanvas.refreshChapters()');
  assert.ok(renderRailIdx > -1 && refreshIdx > -1 && refreshIdx > renderRailIdx,
    'refreshChapters() 应紧跟在 renderRail() 之后触发(同一次章节更新的一对姊妹调用)');

  // 挂载点/cleanup 同步改名为对象解构(teardownMobileCanvas() 裸调用不应再残留)。
  assert.equal(
    /teardownMobileCanvas\(\)/.test(editorSrcNow),
    false,
    'initMobileCanvas 返回结构已改为对象,cleanup 不应再残留裸 teardownMobileCanvas() 调用',
  );
  assert.match(editorSrcNow, /mobileCanvas\.teardown\(\)/, 'cleanup 必须调用 mobileCanvas.teardown()');
});

// ── #304 Task15:浏览态手势接线(单指横滑换屏 + 双指捏合切密度) ──

test('浏览态手势已接:pointer 处理器不再对浏览态无条件 return(#304 Task15)', () => {
  const s = mobileCanvasSrc();
  const downStart = s.indexOf('const onEditPointerDown = (e: PointerEvent) => {');
  const downEnd = s.indexOf('const onEditPointerMove', downStart);
  const moveEnd = s.indexOf('const onEditPointerUp', downEnd);
  const upEnd = s.indexOf('const onEditPointerCancel', moveEnd);
  assert.ok(downStart > -1 && downEnd > -1 && moveEnd > -1 && upEnd > -1, '三个 pointer 处理器必须存在');
  const downBody = s.slice(downStart, downEnd);
  const moveBody = s.slice(downEnd, moveEnd);
  const upBody = s.slice(moveEnd, upEnd);
  assert.equal(
    /if\s*\(\s*state\s*!==\s*'edit'\s*\)\s*return;/.test(downBody),
    false,
    'onEditPointerDown 不应再对浏览态无条件 return',
  );
  assert.equal(
    /if\s*\(\s*state\s*!==\s*'edit'[^)]*\)\s*return;/.test(moveBody),
    false,
    'onEditPointerMove 不应再对浏览态无条件 return',
  );
  assert.equal(
    /if\s*\(\s*state\s*!==\s*'edit'\s*\)\s*return;/.test(upBody),
    false,
    'onEditPointerUp 不应再对浏览态无条件 return',
  );
});

test('浏览态双指捏合走 cycleDensity,一次捏合只切一档(#304 Task15)', () => {
  const s = mobileCanvasSrc();
  const moveStart = s.indexOf('const onEditPointerMove = (e: PointerEvent) => {');
  const moveEnd = s.indexOf('const onEditPointerUp', moveStart);
  assert.ok(moveStart > -1 && moveEnd > -1);
  const moveBody = s.slice(moveStart, moveEnd);
  assert.match(moveBody, /state\s*===\s*'browse'/, '双指分支须判浏览态');
  assert.match(moveBody, /cycleDensity\(density\)/, '浏览态捏合须复用 cycleDensity');
  assert.match(moveBody, /clampStart\(startIdx,\s*density,\s*ctx\.totalPages\(\)\)/, '切档后须 clampStart 夹紧');
  assert.match(moveBody, /render\(\)/, '切档后须 render()');
  // 防连切:必须有消费标志位,且在阈值分支内置位
  assert.match(moveBody, /pinchConsumed/, '须有 pinchConsumed 标志位防止一次捏合连切多档');
  const pinchConsumedTrueIdx = moveBody.indexOf('pinchConsumed = true');
  const cycleDensityIdx = moveBody.indexOf('cycleDensity(density)');
  assert.ok(pinchConsumedTrueIdx > -1 && pinchConsumedTrueIdx > cycleDensityIdx, 'pinchConsumed 必须在触发切档之后置位');
});

test('浏览态单指横滑换屏:按开页(spread)翻,密度1逐页/2一个开页/4两个开页(#304 用户反馈)', () => {
  const s = mobileCanvasSrc();
  assert.match(
    s,
    /const navigateScreen = \(dir: 1 \| -1\) => \{/,
    '须有 navigateScreen 函数(按开页翻)',
  );
  const navStart = s.indexOf('const navigateScreen = (dir: 1 | -1) => {');
  const navEnd = s.indexOf('\n      };', navStart);
  const navBody = s.slice(navStart, navEnd);
  // 密度 1 逐页翻(startIdx ± 1);密度 2/4 按 .ov-spread DOM 顺序移动开页游标(4 档 step=2)。
  assert.match(navBody, /density === 1/, '密度 1 须逐页翻');
  assert.match(navBody, /\.ov-spread/, '密度 2/4 须按 .ov-spread 开页翻');
  assert.match(navBody, /density === 4 \? 2 : 1/, '4 档一次翻两个开页');
  assert.match(navBody, /render\(\)/, '换屏后须 render()');

  const upStart = s.indexOf('const onEditPointerUp = (e: PointerEvent) => {');
  const upEnd = s.indexOf('const onEditPointerCancel', upStart);
  const upBody = s.slice(upStart, upEnd);
  assert.match(upBody, /state\s*===\s*'browse'/, 'pointerup 须按浏览态分支换屏');
  assert.match(upBody, /navigateScreen\(/, 'pointerup 浏览态分支须调用 navigateScreen');
  assert.match(upBody, /state\s*===\s*'edit'/, 'pointerup 编辑态分支须保留(原有翻页行为不变)');
  assert.match(upBody, /navigatePage\(/, 'pointerup 编辑态分支须仍调用 navigatePage(原行为不变)');
});

test('左缘 20px 让位:浏览态与编辑态共用同一套 gestureEdge 判定,不额外分叉(#304 Task15)', () => {
  const s = mobileCanvasSrc();
  assert.match(s, /gestureEdge = e\.clientX <= LEFT_EDGE_PX;/, '左缘守卫必须保留且两态共用(down 阶段不分态)');
  const moveStart = s.indexOf('const onEditPointerMove = (e: PointerEvent) => {');
  const moveEnd = s.indexOf('const onEditPointerUp', moveStart);
  const moveBody = s.slice(moveStart, moveEnd);
  assert.match(moveBody, /if\s*\(gestureEdge \|\| !gestureStart\) return;/, '单指分支仍须让给系统边缘返回手势(两态共用)');
});

test('编辑态手势行为未动:单指横滑翻页/竖滑滚页/pan-image 逻辑保留(#304 Task15 回归)', () => {
  const s = mobileCanvasSrc();
  assert.match(s, /arbitrateGesture\(\{ state, pointers: 1, axis: gestureAxis, onSelectedImage \}\)/);
  assert.match(s, /if \(gestureOwner === 'page-nav' \|\| gestureOwner === 'none'\) e\.preventDefault\(\);/);
  const navPageStart = s.indexOf('const navigatePage = (dir: 1 | -1) => {');
  assert.ok(navPageStart > -1, 'navigatePage(编辑态翻页)必须原样保留');
});

test('设计文档:编辑态双指捏合放大标注本次搁置,浏览态两手势保持已实现(#304 Task15)', () => {
  const designPath = join(here, 'MOBILE-CANVAS-DESIGN.md');
  const design = readFileSync(designPath, 'utf8');
  const tableStart = design.indexOf('## 手势契约');
  assert.ok(tableStart > -1, '手势契约表必须存在');
  const rowsBlock = design.slice(tableStart, tableStart + 1200);
  const pinchRowMatch = rowsBlock.match(/\|\s*双指捏合[^\n]*\n/);
  assert.ok(pinchRowMatch, '双指捏合行必须存在');
  assert.match(pinchRowMatch[0], /【本次搁置】/, '编辑态双指捏合放大那格须标注【本次搁置】');
  // 浏览态那格(1/2/4 三档切)不应被误标搁置
  const browseCell = pinchRowMatch[0].split('|')[2] ?? '';
  assert.equal(/【本次搁置】/.test(browseCell), false, '浏览态 1/2/4 密度切换已实现,不应标注搁置');
});
