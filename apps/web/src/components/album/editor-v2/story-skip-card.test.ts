import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 采访阶段的跳过:2 颗轻量小 pill 并排在输入框上方,整块 composer 变一个渐变容器
// (跳过 pill + 输入框一体,不分离),输入框全程可打字。读源码字符串做正则断言。
const here = dirname(fileURLToPath(import.meta.url));
const chatPanel = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');
const css = readFileSync(join(here, 'editor-port.css'), 'utf8');

function fnBody(name: string): string {
  const re = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n {4}\\}`);
  const m = re.exec(chatPanel);
  assert.ok(m, `${name}() 函数体必须可解析`);
  return m![0];
}

test('采访跳过挂在输入框上方的 #interviewSkips 槽,不再塞进消息流', () => {
  assert.match(chatPanel, /id="interviewSkips"/, '需要输入框上方的跳过 pill 槽');
  const start = fnBody('startChapterInterview');
  assert.match(start, /setInterviewSkips\(chapterId\)/, 'startChapterInterview 通过 setInterviewSkips 显示跳过 pill');
  assert.doesNotMatch(start, /chatBody!\.appendChild\(skipRow\)/, '跳过不再作为消息流卡片');
  assert.doesNotMatch(start, /skip-card/, '不再用旧的 skip-card');
});

test('两颗并排轻量小 pill:跳过本组 / 跳过剩下全部,各发用户消息后推进', () => {
  const fn = fnBody('setInterviewSkips');
  assert.match(fn, /className = 'iv-skip'/, '第一颗 pill');
  assert.match(fn, /className = 'iv-skip iv-skip-ghost'/, '第二颗 pill(ghost 更轻)');
  assert.match(fn, /aT\('跳过本组', 'Skip this group'\)/);
  assert.match(fn, /aT\('跳过剩下全部', 'Skip all remaining'\)/);
  assert.match(
    fn,
    /appendUserText\(aT\('这组照片背景先跳过'[\s\S]*?void finishInterview\(''\)/,
    '跳过本组:发用户气泡 + finishInterview("")',
  );
  assert.match(
    fn,
    /appendUserText\(aT\('剩下的照片背景都先跳过'[\s\S]*?void skipRemainingInterviews\(\)/,
    '跳过剩下全部:发用户气泡 + 批量推进',
  );
  // 传 null = 收起 pill 并恢复普通输入框(移除渐变容器类);显示时加上
  assert.match(fn, /classList\.remove\('interview-active'\)/, 'null 时移除渐变容器');
  assert.match(fn, /classList\.add\('interview-active'\)/, '显示时加渐变容器');
});

test('进入排版收起跳过 pill;批量跳过不引回满意度/markChapterDone', () => {
  assert.match(fnBody('triggerSelectLayout'), /setInterviewSkips\(null\)/, '进入排版时收起跳过 pill');
  const skip = fnBody('skipRemainingInterviews');
  assert.match(skip, /order\.forEach\(\(cid\) => interviewedChapters\.add\(cid\)\)/, '剩余章一次性补标');
  assert.match(skip, /await triggerSelectLayout\(\)/, '批量跳过后直接去排版');
  assert.doesNotMatch(
    skip,
    /appendSatisfactionCard|markCurrentChapterDone|postWriteChapter/,
    '不得引回已删的逐章满意度/markChapterDone',
  );
});

test('采访跳过卡:很淡的渐变(非强调型,不用购买横幅那套响亮渐变)+ 并排白描边按钮,不套外框', () => {
  assert.match(css, /\.interview-skips\{[^}]*radial-gradient/, '很淡的 chap-card 式 radial 渐变');
  assert.doesNotMatch(css, /\.interview-skips\{[^}]*linear-gradient/, '不用购买横幅那种响亮的 linear-gradient');
  assert.match(css, /\.iv-skips-row\{[^}]*display:\s*flex/, '两颗按钮并排(横向)');
  assert.doesNotMatch(css, /\.composer-group\.interview-active\{/, '不给整个 composer 套外框');
  assert.match(css, /\.iv-title\{/, '有小标题样式');
  assert.match(css, /\.iv-skip\{/, '按钮样式');
});
