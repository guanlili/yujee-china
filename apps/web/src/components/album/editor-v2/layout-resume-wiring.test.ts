import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 排版/设计环节续跑止血(Phase 0,修正版)的接线锁。ChatPanel 是一大坨命令式 DOM effect,
// 仓库没有 jsdom(测试跑在 tsx --test),因此沿用既有源码断言风格(capture-and-act.test.ts /
// editor-flow-fixes.test.ts)。
//
// 设计口径(2026-07 复核后拍板):markChapterDone 在浏览器端没有任何调用方 → allDone 是
// 死信号,不能当续跑闸。改成【0 页单一漏斗】:画板零页时,去向由服务端 job 真相
// (storyGate.layoutState)+ 采访完备性(runChapterGuideOpener)决定 ——
//   · running → 接着等排版落地(waitForLayoutThenRefresh);
//   · 其余(idle/failed/信号缺失)→ opener:对 context 为空的章续采访;全齐了走【链尾】
//     直接 triggerSelectLayout。排版此前只从活的采访链尾部(finishInterview)触发,刷新后
//     链断即死 —— 链尾补在 opener 里,挂载/发消息两条入口共用。
// 真正的运行时行为(layoutState 判定、DB 层)由 agent-job-repo.test.ts /
// album-service.test.ts 覆盖。

const here = dirname(fileURLToPath(import.meta.url));
const chatPanel = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');

// ── 1. opener 链尾:采访全齐 + 画板零页 → 当场触发排版 ─────────────────────────
test('opener tail: all-interviewed + empty canvas fires triggerSelectLayout right there', () => {
  const fn = /async function runChapterGuideOpener\([\s\S]*?\n {4}\}/.exec(chatPanel);
  assert.ok(fn, 'runChapterGuideOpener() 函数体必须可解析');
  const tail = /if \(!first\) \{[\s\S]*?\n {6}\}/.exec(fn![0]);
  assert.ok(tail, 'opener 必须有 if (!first) 链尾块');
  const body = tail![0];

  // 链尾必须能触发排版(这是刷新后唯一的重排入口:覆盖续排/上次 FAILED 重试/job 没提交成功)。
  assert.match(body, /await triggerSelectLayout\(\);/, '链尾必须 await triggerSelectLayout()');

  // 安全边界一:排版还在跑(挂载解析器已在等待)不重复触发。
  assert.match(
    body,
    /storyGate\?\.layoutState !== 'running'/,
    '链尾必须以 layoutState !== running 挡住重复触发',
  );
  // 安全边界二:chapterOrder 为空(storyGate 没加载成功/异常相册)不触发。
  assert.match(
    body,
    /\(storyGate\?\.chapterOrder\.length \?\? 0\) > 0/,
    '链尾必须要求 chapterOrder 非空(storyGate 未加载时不误发排版)',
  );
  // 安全边界三:画板与草稿骨架双读为零才触发(coordinator 未就绪不把已排好的书误判为空)。
  assert.match(body, /getPagesState/, '链尾必须自查画板页数');
  assert.match(body, /draftChapters\?\.pages\.length/, '链尾必须双读草稿骨架页数');

  // 触发后复位 interviewChainStartedRef 再 return(原有复位语义保留)。
  assert.match(
    body,
    /interviewChainStartedRef\.current = false;\s*\n\s*return;/,
    '链尾收尾必须复位 interviewChainStartedRef 并 return',
  );
});

// ── 2. 挂载解析器:0 页为第一判据 ────────────────────────────────────────────────
test('mount resolver: empty canvas routes to the funnel (running→wait, else→opener), before design branches', () => {
  // 抓 0 页漏斗块:锚在挂载解析器特有的 `const stage = storyGate?.stage;` 之后(加照片入口
  // 也有一处 0 页判据,不锚会串块),捕获组取从 0 页判据到 pages>0 的 liveChapterId 分支
  // 之间。匹配成功即证明 0 页判据在最前(置于 offerDesignCard 的 theme/ready 分支之前)。
  const branch =
    /const stage = storyGate\?\.stage;[\s\S]{0,1600}?(if \(\(co\(\)\?\.getPagesState\?\.\(\)\?\.length \?\? 0\) === 0\) \{[\s\S]*?\n {8}\} else if \(liveChapterId\) \{)/.exec(
      chatPanel,
    );
  assert.ok(branch, '挂载解析器必须以画板 0 页为第一判据,且 pages>0 分支保持原样在后');
  const body = branch![1]!;

  // running → 接着等排版落地,不重排。
  assert.match(body, /storyGate\?\.layoutState === 'running'/, 'running 分支必须按 layoutState 判定');
  assert.match(
    body,
    /waitForLayoutThenRefresh\(host, \{ minPages: 1 \}\)/,
    'running 分支必须接着等排版落地(waitForLayoutThenRefresh)',
  );
  // 其余 → 采访续跑漏斗(opener),且不受 shown===0 门限制。
  assert.match(body, /\} else \{[\s\S]*?void runChapterGuideOpener\(\);/, '非 running 必须进 opener 漏斗');
  assert.doesNotMatch(body, /shown === 0/, '0 页漏斗不得被 shown===0 门挡住(刷新后历史非空也要续跑)');

  // running(等待)判定在 opener 之前。
  assert.ok(
    body.indexOf("layoutState === 'running'") < body.indexOf('runChapterGuideOpener'),
    'running(等待)必须先于 opener 漏斗',
  );
});

// ── 3. send() 0 页守卫:同一漏斗,设计 Agent 不可达 ─────────────────────────────
test('send(): authoring 0-page path routes to the funnel and never reaches the design agent', () => {
  const guard = /if \(pagesNow\.length === 0\) \{[\s\S]*?\n {8}\}/.exec(chatPanel);
  assert.ok(guard, 'send() 必须有 pagesNow.length === 0 的守卫块');
  const body = guard![0];

  // 硬不变量:守卫块内绝不调用设计 Agent(否则空书 422)。
  assert.doesNotMatch(body, /runDesignChatTurn/, '零页守卫块内绝不能调用 runDesignChatTurn');

  // storyGate 为 null 先加载;已判 running 的也重取一次(防浏览器轮询超时后 job 已 FAILED,
  // 用户被 stale 的「还在排版中」困死)。
  assert.match(
    body,
    /if \(!storyGate \|\| storyGate\.layoutState === 'running'\) await loadStoryGate\(\);/,
    '判 layoutState 前必须兜 storyGate 为 null / 复核 stale running',
  );

  // running → 只提示稍等,return(不触发、不进 opener)。
  assert.match(
    body,
    /if \(storyGate\?\.layoutState === 'running'\) \{[\s\S]*?return;/,
    'running 分支必须提示后 return',
  );
  // 其余 → opener 漏斗(要么续采访,要么走链尾直接排版),然后 return。
  assert.match(
    body,
    /await runChapterGuideOpener\(\{ allowDuringSend: true \}\);\s*\n\s*return;/,
    '非 running 必须进 opener 漏斗后 return',
  );
  // 死端文案已删(opener 自己会弹采访卡或触发排版)。
  assert.doesNotMatch(body, /先完成每章的小采访/, '「先完成小采访」死端提示必须删除');
  // allDone 死信号不再参与判定(条件形;根因注释里叙述旧 bug 提到它是允许的)。
  assert.doesNotMatch(body, /if \(storyGate\?\.allDone\)/, 'allDone(死信号)不得再作为 0 页守卫的分支条件');

  // runDesignChatTurn 只在守卫块【之后】出现 —— 只有 pages>0 才可达。
  assert.ok(
    chatPanel.indexOf('if (pagesNow.length === 0)') < chatPanel.indexOf('await runDesignChatTurn(txt)'),
    'runDesignChatTurn 必须位于零页守卫之后(只有画板有页时可达)',
  );
});

// ── 4. 设计失败重试已锁(防回归)─────────────────────────────────────────────────
test('runApplyDesign: on failure it unlocks and re-offers the cover card (designOfferShown reset + offerDesignCard)', () => {
  const fn = /async function runApplyDesign\([\s\S]*?\n {4}\}/.exec(chatPanel);
  assert.ok(fn, 'runApplyDesign() 函数体必须可解析');
  const body = fn![0];
  // catch 里复位 designOfferShown 并重新弹选择卡,用户设计失败后还能再选一次。
  assert.match(
    body,
    /designOfferShown = false;\s*\n\s*void offerDesignCard\(\);/,
    '设计失败必须复位 designOfferShown 并重新 offerDesignCard',
  );
});
