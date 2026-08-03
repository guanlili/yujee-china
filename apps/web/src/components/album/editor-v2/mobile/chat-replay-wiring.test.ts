import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   移动端对话 = 桌面 ChatPanel 的接线守卫。

   前史(两次真实事故,同一个根因):编辑器在响应式分叉点两侧曾有**两套对话壳**,
     ① 生成阶段 → EditorShell + ChatPanel(完整:采访/加照片/封面卡/富渲染)
     ② 成书之后 → MobileEditorRoot + AiChatSheet(瘦客户端:纯文本、没有加照片)
   第一次事故是历史回放在两棵壳里长得不一样(markdown/彩色条全平掉);第二次是用户
   直接看到「怎么会有两个气泡弹窗」(2026-08-03),明确要求以完整版为基础统一。

   修法不是把 ChatPanel 抄成第二份,而是给移动树实现 ChatCoordinator
   (use-chat-coordinator.ts),把桌面 ChatPanel **原样**挂进来,抽屉样式由
   editor-port.css 的 ≤767 规则命中。这里守住「只有一份对话实现」不再回退。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');
/** 剥掉注释再断言 —— 说明里就写着要禁的那些词,那是文字不是代码。 */
const code = (...p: string[]) =>
  read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('第二套对话壳已删,不许再长回来', () => {
  assert.ok(
    !existsSync(join(here, 'modals', 'AiChatSheet.tsx')),
    'AiChatSheet 是被用户否掉的瘦对话壳 —— 统一后不该再有这个文件',
  );
  assert.ok(
    !existsSync(join(here, 'use-design-chat.ts')),
    'use-design-chat 是瘦壳的直连 hook —— 收发/回放都该走 ChatPanel 那一份',
  );
});

test('MobileEditorRoot 挂的是桌面同一份 ChatPanel,经移动协调器接画板', () => {
  const src = code('MobileEditorRoot.tsx');
  assert.match(src, /<ChatPanel/, '成书后的对话必须是 ChatPanel 本体,不是任何仿制壳');
  assert.match(src, /outerRootRef=\{chatRootRef\}/, 'ChatPanel 的 DOM 引擎要以宿主 div 为根');
  assert.match(src, /coordinator=\{chatCoordinator\}/, '画板能力经 use-chat-coordinator 提供');
  assert.match(src, /draftChapters=\{draftChapters\}/, '章节卡/追加照片采访要草稿骨架');
});

test('宿主借桌面样式:editor-port 类 + 初始收起(chat-collapsed)', () => {
  const src = code('MobileEditorRoot.tsx');
  assert.match(
    src,
    /className="editor-port mobile-chat-port chat-collapsed/,
    '宿主必须带 editor-port(命中 ≤767 抽屉规则)且初始收起 —— 一挂载就铺遮罩会盖死画板',
  );
  const css = read('mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('.editor-port.mobile-chat-port');
  assert.ok(at >= 0, '宿主的页面级属性(底色/满高/overflow)必须中和,同 .mobile-modal-host');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /background:\s*none/);
  assert.match(rule, /overflow:\s*visible/);
});

test('FAB 展开走 root class(ChatPanel 收起也走它)—— 收起不能是单程票', () => {
  const src = code('MobileEditorRoot.tsx');
  // ChatPanel 手柄轻点/下拉会给 root 加 chat-collapsed 并把面板 display:none;
  // 重新展开的入口在面板外,必须由移动树的 FAB 摘类,否则收起后再也打不开。
  assert.match(
    src,
    /chatRootRef\.current\?\.classList\.remove\('chat-collapsed'\)/,
    'onOpenChat 必须摘掉宿主的 chat-collapsed',
  );
});

test('协调器整书替换按数组位置重编号(挪页/删页错乱的边界防御,与桌面同口径)', () => {
  const src = code('use-chat-coordinator.ts');
  assert.match(src, /pageIndex:\s*i/, 'replacePages 不信来料 pageIndex,按数组位置重编号');
});

test('EditorPort 的 authoring 挂载点把草稿骨架传给移动树', () => {
  // 原文读取,不剥注释:EditorPort 源里有字符串含 /*,剥注释的 helper 会被它骗到,
  // 把整段挂载代码当注释吞掉。这里断言的是 JSX,注释不碍事。
  const src = read('..', 'EditorPort.tsx');
  assert.match(
    src,
    /shouldMountMobileEditor\(device, pages\)[\s\S]*?<MobileEditorRoot[\s\S]*?draftChapters=\{skeleton\}/,
    '不传骨架 = ChatPanel 的章节卡全瞎、追加照片采访链断',
  );
});

/* ── 抽屉呈现(2026-08-03 用户拍板):左右、底边贴屏,不是四周悬浮的卡片 ── */

test('移动端对话弹窗是贴边抽屉:左右/底边 0,圆角只留顶部', () => {
  const css = read('..', 'editor-port.css');
  const at = css.indexOf('.editor-port .pane-chat-col{\n    position:fixed; left:0; right:0; bottom:0;');
  assert.ok(at >= 0, '≤767 的 .pane-chat-col 必须贴边(left/right/bottom 都是 0)');
  const paneAt = css.indexOf('border-radius:22px 22px 0 0');
  assert.ok(paneAt >= 0, '贴边抽屉圆角只留顶部 —— 底部圆角配贴边会露出底色缺角');
});

test('贴边后作曲区给 iPhone 手势条让位(safe-area)', () => {
  const css = read('..', 'editor-port.css');
  assert.match(
    css,
    /\.editor-port \.composer-group\{\n\s*margin:10px 10px calc\(10px \+ env\(safe-area-inset-bottom/,
    '输入框不能贴着 home 条',
  );
});

/* ── 用户气泡配色同源(历史事故的余守):token 仍是唯一真相 ── */

test('用户气泡走共享 token(桌面 .msg.user .bubble)', () => {
  const shared = read('..', 'editor-tokens.css');
  assert.match(shared, /--chat-user-bubble\s*:/, '气泡底色要留在共享 token');
  const desktop = read('..', 'editor-port.css');
  const dAt = desktop.indexOf('.editor-port .msg.user .bubble{');
  assert.match(
    desktop.slice(dAt, desktop.indexOf('}', dAt)),
    /var\(--chat-user-bubble\)/,
    '气泡底必须引用 token,不复制渐变字面量',
  );
});
