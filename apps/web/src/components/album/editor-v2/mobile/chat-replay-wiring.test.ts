import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   移动端对话历史回放的接线守卫。

   起因是一个真实事故:用户在手机上「把对话收起、再展开」,历史看起来全变了 ——
   气泡还在,但 markdown 没了、「已更新」彩色条没了,像是历史丢了。

   真相不是丢:编辑器在响应式分叉点两侧有**两棵壳**,
     ① 未选封面组 → EditorShell + ChatPanel(命令式 DOM,富渲染)
     ② 已选封面组 → MobileEditorRoot + AiChatSheet(JSX,当时是纯文本)
   compose 落库封面页那一刻 isDesigned(pages) 翻 true,①→② 整棵换掉。同一段消息
   被一个有损的组件重新渲染了一遍,于是「样式全丢」。

   消息本身一直在库里(design-chat 路由的 done 事件走 albumService.persistDesignChat,
   user/assistant 两条都落,designOps 存进 layout_patch)。所以修的不是持久化,是回放:
   两棵壳必须用同一份口径,渲染层各写各的。口径在 ../chat-history.ts。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');
/** 剥掉注释再断言 —— 说明里就写着要禁的那些词,那是文字不是代码。 */
const code = (...p: string[]) =>
  read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('移动端历史回放走共用口径 chat-history,不再自己 filter/map 一遍', () => {
  const src = code('use-design-chat.ts');
  assert.match(
    src,
    /from '\.\.\/chat-history'/,
    'useDesignChat 必须用共用的 buildChatHistory —— 自己写一份就会再次和桌面走偏',
  );
  assert.doesNotMatch(
    src,
    /rows\s*\n?\s*\.filter\(/,
    '不许再手搓一份「哪些行算历史」的规则',
  );
});

test('历史合并不整体覆盖本地消息(回归:刚发的话被晚到的历史抹掉)', () => {
  const src = code('use-design-chat.ts');
  assert.match(src, /mergeChatHistory\(/, '必须用 mergeChatHistory 合并,不是 setMessages(服务端那份)');
});

test('每次打开都刷新历史 —— 不是一辈子只拉一次', () => {
  const src = code('use-design-chat.ts');
  // 桌面端可能在另一台设备/另一棵壳里继续聊;load-once 会让手机上永远停在第一次拉到的那份。
  assert.doesNotMatch(
    src,
    /if\s*\(\s*historyLoaded\s*\)\s*return/,
    'load-once 守卫会让历史永远停在第一次;要用「在飞中」守卫防并发,不是永久闸门',
  );
});

test('AI 回复按 markdown 渲染,与桌面 ChatPanel 同一个 renderMarkdownSafe', () => {
  const src = code('modals/AiChatSheet.tsx');
  assert.match(
    src,
    /renderMarkdownSafe/,
    'assistant 气泡纯文本渲染 = 桌面那边的加粗/列表/换行到了手机上全平掉',
  );
});

test('「已更新」彩色条在移动端也回放(designOps 已经落库,别浪费)', () => {
  const src = code('modals/AiChatSheet.tsx');
  assert.match(src, /changes/, 'AiChatSheet 要消费 ChatHistoryItem.changes,把改了哪几类显示出来');
});

/* ── 用户气泡配色两端同源 ──
   移动端把用户说的话渲成纯黑底白字(background:var(--fg)),桌面是浅色渐变卡 + 深色字。
   同一段对话在两棵壳里长得不一样,而黑色在这套设计里另有所指 —— AiChatSheet 的文件头
   就写着「黑色只属于收起时那枚浮标(.mai),弹窗不是黑的」。移动端违背了自己的注释。 */

test('用户气泡不是纯黑底白字(黑色在这套设计里只属于收起浮标)', () => {
  const css = read('mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf(".mai-msg[data-role='user']");
  assert.ok(at >= 0, '应该有用户气泡规则');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.doesNotMatch(rule, /background:\s*var\(--fg\)/, '纯黑底是收起浮标的专属');
  assert.doesNotMatch(rule, /color:\s*var\(--surface\)/, '白字跟着黑底一起走');
});

test('两端用户气泡走同一个共享 token,不各写一份渐变', () => {
  const shared = read('..', 'editor-tokens.css');
  assert.match(shared, /--chat-user-bubble\s*:/, '气泡底色要进共享 token');
  const mobile = read('mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = mobile.indexOf(".mai-msg[data-role='user']");
  assert.match(
    mobile.slice(at, mobile.indexOf('}', at)),
    /var\(--chat-user-bubble\)/,
    '移动端用 token,不复制一份渐变字面量',
  );
  const desktop = read('..', 'editor-port.css');
  const dAt = desktop.indexOf('.editor-port .msg.user .bubble{');
  assert.match(
    desktop.slice(dAt, desktop.indexOf('}', dAt)),
    /var\(--chat-user-bubble\)/,
    '桌面也改用同一个 token —— 否则改一边忘一边又漂移',
  );
});
