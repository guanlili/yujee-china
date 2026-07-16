import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 设计对话回合(runDesignChatTurn)的对话框展示锁成四段结构。ChatPanel 是一大坨命令式
// DOM effect(无 jsdom harness),沿用本目录 *-wiring/capture-and-act 的源码断言风格:把
// ChatPanel.tsx 当字符串,对四段的载重不变量下断言。
const here = dirname(fileURLToPath(import.meta.url));
const chatSrc = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');
const routeSrc = readFileSync(
  join(here, '..', '..', '..', 'app', 'api', 'v3', 'albums', '[uuid]', 'design-chat', 'route.ts'),
  'utf8',
);

// ── 第一段:开场白气泡(AI 回合开头对用户说的话),消费 assistant_step,置顶 ──
test('开场白:消费 assistant_step 事件,气泡插到进度条上方(置顶)', () => {
  assert.match(chatSrc, /event\.type === 'assistant_step'/);
  assert.match(chatSrc, /showOpening/);
  // 开场白气泡 insertBefore 进度条 host —— 顶在整回合最上方。
  assert.match(chatSrc, /insertBefore\([^)]*host\)/);
});

// ── 第二段:单条「使用工具中」进度条(不逐工具冒卡、不报工具名、结束即收) ──
test('进度条:整回合一条笼统状态条,不逐工具冒 op-card、不报工具名', () => {
  // 旧的逐工具富回执卡 builder 及其工具名 label 全部移除。
  assert.doesNotMatch(chatSrc, /buildDesignOpCard/);
  assert.doesNotMatch(chatSrc, /designToolLabel/);
  assert.doesNotMatch(chatSrc, /designWriteDescription/);
  assert.doesNotMatch(chatSrc, /DESIGN_TOOL_LABEL/);
  // 一条笼统状态条:通用文案(不含具体工具名),工具跑完随水母收掉。
  assert.match(chatSrc, /markToolRunning/);
  assert.match(chatSrc, /正在使用工具|Using tools/);
  assert.match(chatSrc, /jelly\.remove\(\)/);
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
    assert.ok(chatSrc.includes(tool), `类别映射应含 ${tool}`);
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
  const catBlock = /const DESIGN_CHANGE_CATEGORY[\s\S]*?\n {4}\};/.exec(chatSrc)?.[0] ?? '';
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
