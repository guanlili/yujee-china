import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 设计对话回合(runDesignChatTurn)的对话框展示结构(2026-08-08 起为流式过程披露:
// 步骤叙述逐条流出 + 逐工具人话步骤行 + write_todos 实时计划清单 + 更新条 + 终稿)。
// ChatPanel 是一大坨命令式 DOM effect(无 jsdom harness),沿用本目录 *-wiring/
// capture-and-act 的源码断言风格:把 ChatPanel.tsx 当字符串,对载重不变量下断言。
const here = dirname(fileURLToPath(import.meta.url));
const chatSrc = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');
// 写工具→类别的映射 2026-07 搬进了 chat-history.ts:移动端 AiChatSheet 要用同一份口径,
// 留在 ChatPanel 里就会变成两份真相(那正是「手机上历史样式全丢」那个 bug 的成因)。
const historySrc = readFileSync(join(here, 'chat-history.ts'), 'utf8');
const routeSrc = readFileSync(
  join(here, '..', '..', '..', 'app', 'api', 'v3', 'albums', '[uuid]', 'design-chat', 'route.ts'),
  'utf8',
);

// ── 第一段:步骤叙述(AI 边做边说的话),每条 assistant_step 逐条流进过程区 ──
test('步骤叙述:逐条消费 assistant_step,不再只取第一条', () => {
  assert.match(chatSrc, /event\.type === 'assistant_step'/);
  assert.match(chatSrc, /showStep/);
  // 旧的「整回合只取第一条开场白」闸门保持拆除。
  assert.doesNotMatch(chatSrc, /openingShown/);
  assert.doesNotMatch(chatSrc, /showOpening/);
});

// ── 第二段:逐工具人话步骤行(动词+页码,运行中→✓),write_todos 渲染实时计划清单 ──
test('过程披露:每个工具调用一行人话步骤,内部工具名/入参不外露,todos 实时清单', () => {
  assert.match(chatSrc, /TOOL_STEP_LABEL/);
  assert.match(chatSrc, /toolStart/);
  assert.match(chatSrc, /toolDone/);
  // 人话标签(抽查两例):步骤行说「翻看页面/更换版式」,不是 raw toolName 直出。
  assert.match(chatSrc, /翻看页面/);
  assert.match(chatSrc, /更换版式/);
  // write_todos 不占步骤行,渲染成整表覆盖、原地重建的计划清单。
  assert.match(chatSrc, /renderTodos/);
  assert.match(chatSrc, /ep-step-todos/);
  // 安全不变量:工具入参是模型可控内容,只走 textContent,绝不进 innerHTML。
  assert.match(chatSrc, /textEl\.textContent/);
  // 未知工具宁缺毋滥,不硬渲染。
  assert.match(chatSrc, /if \(!label\) return/);
  // 水母仍在回合结束收掉;旧的逐工具富回执卡(op-card 流)不回潮。
  assert.match(chatSrc, /jelly\.remove\(\)/);
  assert.doesNotMatch(chatSrc, /buildDesignOpCard/);
});

// ── 第三段:一条彩色「更新了什么」条(按类别去重,只报真正改了的) ──
test('更新条:彩色摘要按类别去重,字体/颜色/页面三类,含 set_text_fonts 与 write_page_html', () => {
  assert.match(chatSrc, /buildDesignChangeCard/);
  // 六个写工具都要进类别映射(注意 set_text_fonts / write_page_html 之前不在集合里)。
  for (const tool of [
    'set_text_fonts',
    'set_text_colors',
    'update_page_texts',
    'swap_page_template',
    'update_page_images',
    'write_page_html',
  ]) {
    assert.ok(historySrc.includes(tool), `类别映射应含 ${tool}`);
  }
  // 三类中文标签。
  assert.match(chatSrc, /字体/);
  assert.match(chatSrc, /颜色/);
  assert.match(chatSrc, /页面/);
  // 去重:类别用 Set 收敛后按固定顺序输出。
  assert.match(chatSrc, /orderedChangeCategories/);
  // 复用 op-card 设计语言。
  assert.match(chatSrc, /op-card/);
  // 彩色更新条贴进 host,位于终稿回复之前。
  assert.match(chatSrc, /stream\.host\.appendChild\(buildDesignChangeCard\(/);
  // 封面/整体设计两类本次 defer:类别映射里不得出现封面/主题类工具。
  const catBlock = /const DESIGN_CHANGE_CATEGORY[\s\S]*?\n\};/.exec(historySrc)?.[0] ?? '';
  assert.ok(catBlock.length > 0, 'DESIGN_CHANGE_CATEGORY 映射块应存在');
  assert.doesNotMatch(catBlock, /cover|theme|封面|set_cover|apply_theme/i);
});

// ── 第四段:终稿文本气泡(总结回复),置于最底 ──
test('终稿:AI 总结回复贴在最底(change 条之后)', () => {
  assert.match(chatSrc, /appendReplyBody\(stream\.host, final\.assistantReply\)/);
});

// ── 历史回放:同样渲染彩色更新条,而非逐 op 卡 ──
test('历史回放:按 designOps 的 toolName 去重成类别,渲染一条彩色更新条', () => {
  // 仍从落库 designOps 取 toolName。
  assert.match(chatSrc, /readDesignOps/);
  // 回放路径把 toolName 列表映射成类别再造一条 change 条。
  assert.match(chatSrc, /designOpCategories/);
  // 不再逐 op 造 op-card(全局已断言 buildDesignOpCard 移除,这里锁回放语义)。
  const replayBlock = /for \(const op of readDesignOps[\s\S]{0,400}/.exec(chatSrc)?.[0] ?? '';
  assert.equal(replayBlock, '', '历史回放不应再 for-of 逐个 readDesignOps 造卡');
});

// ── 落库侧:写工具集必须含 set_text_fonts / write_page_html,否则历史回放缺这两类 ──
test('route 落库写工具集含全部 6 个写工具(字体/HTML 更新才进 designOps)', () => {
  const block = /const DESIGN_WRITE_TOOLS = new Set\(\[[\s\S]*?\]\)/.exec(routeSrc)?.[0] ?? '';
  assert.ok(block.length > 0, 'route 应有 DESIGN_WRITE_TOOLS 集合');
  for (const tool of [
    'update_page_texts',
    'swap_page_template',
    'update_page_images',
    'set_text_colors',
    'set_text_fonts',
    'write_page_html',
  ]) {
    assert.ok(block.includes(tool), `route DESIGN_WRITE_TOOLS 应含 ${tool}`);
  }
});
