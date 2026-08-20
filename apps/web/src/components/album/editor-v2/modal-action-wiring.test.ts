import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* 弹窗接线守卫(2026-08-20)。
   编辑器桌面端的按钮点击靠挂载时一次性扫描 [data-action] 绑上。扫描范围原先是一份
   手工维护的弹窗白名单(canvasScopes),新加弹窗漏补一行 = 那个弹窗里每个按钮都点不动,
   而类型检查和既有测试全拦不住 —— shareLinkModal、pdfStyleModal(8/06,导出主路锁死
   两周)、imageGenModal(8/19)三次都是这么进的生产。白名单已改成「整棵 root 扫、只排
   对话栏子树」,这里守住它别被改回去,并守住第二个手工同步点:backdrop 关闭表。

   两条规则都刻意不依赖属性顺序、缩进和注释文案 —— 守卫自己会漂的话,等于没有守卫。 */

const here = dirname(fileURLToPath(import.meta.url));
const editor = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const chat = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');

/** 断言只看代码,不看注释 —— 注释里出现某个标识符不能算它「接线了」。 */
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // [^:] 躲开 https://

test('扫描范围按容器排除,不得退回手工白名单', () => {
  assert.doesNotMatch(
    editor,
    /const canvasScopes\s*=/,
    '不得恢复 canvasScopes 手工白名单:漏登记一个弹窗 = 一整屏死按钮,而且没人拦得住',
  );
  const impl = editor.match(/const \$\$scoped = \(sel: string\)[\s\S]{0,400}?;\n/)?.[0] ?? '';
  assert.ok(impl, '$$scoped 应存在');
  assert.match(impl, /root\.querySelectorAll\(sel\)/, '必须从整棵 root 扫,别再枚举容器');
  // 必须带上取反:写成 el.closest(...) 是「只留对话栏」,桌面端每个按钮当场变砖。
  assert.match(impl, /!el\.closest\('\.pane-chat-col'\)/, '必须是 !el.closest —— 掉一个感叹号 = 全屏死按钮');
  assert.doesNotMatch(impl, /filter\(\(el\) => el\.closest/, 'filter 条件被取反了');
});

test('扫描真的被调用,且调用的是 $$scoped 而不是未过滤的 $$', () => {
  // 定义留着、调用点换成未过滤的 $$(或整块删掉),运行时一样坏,但只看定义是看不出来的。
  assert.match(editor, /\$\$scoped\('\[data-action\]'\)\.forEach/, 'data-action 扫描调用点必须在');
  assert.doesNotMatch(editor, /[^$]\$\$\('\[data-action\]'\)/, '不得用未过滤的 $$ 扫 data-action');
});

test('两侧扫描范围互补:canvas 排掉的正是 ChatPanel 认领的那棵子树', () => {
  // 任一侧改了选择器而另一侧没跟,就会变成 aside 漏绑或 toggleChat 双绑。
  assert.match(chat, /querySelector\('\.pane-chat-col'\)/, 'ChatPanel 仍应锁 .pane-chat-col');
  // 选择器和 class 是一对:只改 JSX 里的 class,asideRoot 就变 null,对话栏整栏按钮全死。
  assert.match(chat, /className="pane-chat-col[\s"]/, '.pane-chat-col 这个 class 必须真写在 JSX 上');
  assert.match(chat, /asideRoot\.querySelectorAll\('\[data-action\]'\)/, 'ChatPanel 必须真扫自己的子树');
});

/** 从 modal-overlay 出发回看它所在的开标签 —— 不依赖 className/id 的先后顺序。 */
function modalTags(): { id: string; closable: boolean }[] {
  const out: { id: string; closable: boolean }[] = [];
  for (let i = editor.indexOf('modal-overlay'); i !== -1; i = editor.indexOf('modal-overlay', i + 1)) {
    const open = editor.lastIndexOf('<', i);
    const close = editor.indexOf('>', i);
    if (open === -1 || close === -1) continue;
    const tag = editor.slice(open, close + 1);
    const id = tag.match(/\bid="([\w-]+)"/)?.[1];
    if (!id || out.some((m) => m.id === id)) continue; // 注释/CSS 里提到这个词的不算
    out.push({ id, closable: tag.includes('data-overlay-close') });
  }
  return out;
}

// 唯一豁免:导出进度浮层,渲染中故意不给关。其余弹窗一律必须能点背景关掉 ——
// pdfStyleModal 就是漏了这条,弹出来「继续导出」和「关闭」都点不动,只能刷新。
const NO_CLOSE_BY_DESIGN = new Set(['exportProgressModal']);

test('除进度浮层外,每个弹窗都必须声明可点背景关闭', () => {
  const modals = modalTags();
  assert.ok(modals.length >= 11, `应认出 11+ 个弹窗,实得 ${modals.length}`);
  const silent = modals.filter((m) => !m.closable && !NO_CLOSE_BY_DESIGN.has(m.id)).map((m) => m.id);
  assert.deepEqual(silent, [], `这些弹窗没有 data-overlay-close,点背景关不掉: ${silent.join(', ')}`);
});

test('标了 data-overlay-close 的弹窗必须真绑上点背景关闭,否则关不掉只能刷新', () => {
  const ids = modalTags().filter((m) => m.closable).map((m) => m.id);
  assert.ok(ids.includes('imageGenModal') && ids.includes('pdfStyleModal'), '踩过坑的两个必须在内');

  // 锚在代码标记上(不锚注释文案),范围切到 .forEach 为止(别把后面别的数组也算进来),
  // 且只认数组字面量项 —— 内联回调里提到某个 id 不算已接线。
  const block = (editor.split('/* @wiring:backdrop-close */')[1] ?? '').split('];')[0];
  assert.ok(block, '@wiring:backdrop-close 标记应存在');
  const bound = new Set([...block.matchAll(/\['([\w-]+)',/g)].map((m) => m[1]));

  // 反向:唯一的豁免项不许混进表里 —— 混进去就能被 Esc/点背景关掉,而导出还在跑,
  // 界面看着「正常」了,实际什么都没结束。
  assert.doesNotMatch(block, /\['exportProgressModal'/, '进度浮层不许进关闭表');

  const missing = ids.filter((id) => !bound.has(id));
  assert.deepEqual(missing, [], `这些弹窗声明了点背景可关却没绑,关不掉只能刷新: ${missing.join(', ')}`);
});

test('Esc 与点背景共用同一张关闭表,两条路的可关集合不可能各走各的', () => {
  // 「共用一个常量」不等于「行为一致」:遍历同一张表但 .slice(0,1)、或者 close() 被删掉,
  // 常量名照样在、断言照样绿,而 Esc 已经废了(实测:16 个变异里 13 个是这么逃掉的)。
  // 所以下面钉的是**代码形状**,不是标识符出现过没有。
  assert.match(editor, /const OVERLAY_CLOSERS/, '关闭表必须提成共享常量');

  const code = stripComments(editor.match(/const onSwapKeydown[\s\S]*?\n    \};/)?.[0] ?? '');
  assert.ok(code, 'Esc handler 应存在');
  const all = stripComments(editor);

  assert.match(all, /window\.addEventListener\('keydown', onSwapKeydown, true\)/, '监听器必须挂上');
  assert.match(all, /window\.removeEventListener\('keydown', onSwapKeydown, true\)/, '卸载时必须摘掉');
  assert.match(code, /e\.key !== 'Escape'/, '键名写错整条路会静默失效');
  assert.match(code, /for \(const \[id, close\] of OVERLAY_CLOSERS\) \{/, 'Esc 必须遍历整张表,不许切片或另列');
  assert.match(code, /if \(!byId\(id\)\?\.classList\.contains\('open'\)\) continue;/, 'open 判据不许取反');
  // 三行必须连着:吞了按键却不关窗 = 原病复发,还顺带把滤镜面板的 Esc 一起吞掉。
  assert.match(code, /e\.stopPropagation\(\);\s*\n\s+close\(\);\s*\n\s+return;/, 'Esc 必须真的关窗');

  // 点背景侧:同一张表 + backdrop 卫兵 + 进 cleanup 名册(丢了会在重挂时叠加监听器)。
  assert.match(all, /OVERLAY_CLOSERS\.forEach/, '点背景也必须遍历同一张表');
  assert.match(all, /if \(e\.target === ov\) close\(\);/, '必须只在点中背景本身时才关');
  assert.match(all, /actionHandlers\.push\(\{ el: ov, fn \}\);/, 'backdrop 监听必须进 cleanup 名册');
  assert.match(
    all,
    /actionHandlers\.forEach\(\(\{ el, fn \}\) => el\.removeEventListener\('click', fn\)\);/,
    '名册必须真的在 cleanup 里被解绑,否则 effect 重挂一次监听器就叠一层',
  );
});

/* 这份守卫能挡什么、挡不住什么(别高估它,高估会让人不再手工核对):
   挡得住 —— 白名单被改回来、扫描范围被改坏(含 filter 取反)、调用点掉包、整块被删、
   ChatPanel 改 class 名、弹窗漏登记、漏绑背景关闭、进度浮层被混进可关表、Esc 键名写错、
   Esc 遍历被切片、Esc 吞键不关窗、stopPropagation 丢失、监听器没挂/没摘、cleanup 丢解绑。
   (以上每条都用 mutation testing 实证过会红。)

   挡不住 —— 它是**文本形状**断言,查得了拼写查不了语义:
     · 表里给某个弹窗配错了关闭函数(['imageGenModal', closePhotoPicker] 照样绿)
     · Esc 分支前面加个无关条件(如 if (!e.shiftKey) return)
     · pageReorder 那条专用分支被短路(它与表里第 7 项等价,短路后由表接管,今天无害)
   要堵这三类,得把判定抽成纯函数(如 pickOverlayCloser(entries, isOpen))单独单测,
   让测试拿假表真跑一遍。今天没做,别当它已经保了。 */
