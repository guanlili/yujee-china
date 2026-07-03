import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// §4.2 引导优先 + 满意/不满意 (v3/chapter-guide-satisfaction). EditorPort is one large
// imperative DOM effect with no jsdom harness in this repo (tests run under tsx/node:test),
// so — following the repo's existing source-assertion style (balance-alert-on-mount.test.ts,
// editor-layout.test.ts) — we assert the structural invariants the flow relies on:
//   B. 进章自动引导: an empty-userMessage chapter-chat opener fires on entering an
//      unfinished chapter and on advancing to the next one (AI opens, never auto-writes).
//   C. 满意/不满意: a write turn surfaces the in-flow satisfaction card; 满意 confirms the
//      chapter, 不满意 stays for逐页 adjustment — and the standing「确定本章」breadcrumb
//      button + its post-mount binding effect are gone.

const here = dirname(fileURLToPath(import.meta.url));
// The chat/interview logic was extracted out of EditorPort.tsx into ChatPanel.tsx
// (dialogue/interview) and editor-coordinator.ts (the canvas↔chat bridge). These
// structural guards don't care which of the three files a symbol lives in, so a
// request for the editor source returns the three merged — the assertions still
// hit, and doesNotMatch guards still hold across all three.
const EDITOR_SOURCES = ['EditorPort.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts'];
function source(file: string): string {
  if (file === 'EditorPort.tsx') {
    return EDITOR_SOURCES.map((f) => readFileSync(join(here, f), 'utf8')).join('\n\n');
  }
  return readFileSync(join(here, file), 'utf8');
}

// 新流程(逐章收集补充说明 → 全部收集完一次性写全部 → 按页编辑):
// runChapterGuideOpener 现在是「采访链的入口」,启动逐章采访(章节卡片 + startChapterInterview
// 的三条引导气泡);它不再发空 userMessage 让 AI 开场写作。答完一章由 finishInterview 驱动进
// 下一章 / 收尾 writeAllChapters。
test('B: runChapterGuideOpener starts the per-chapter interview (not an empty-message write opener)', () => {
  const src = source('EditorPort.tsx');

  assert.match(src, /async function runChapterGuideOpener\([^)]*\)/, 'runChapterGuideOpener() must exist');
  const fn = /async function runChapterGuideOpener\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runChapterGuideOpener() body must be parseable');

  // 它启动采访(startChapterInterview),而不是发空 userMessage 让 AI 开场写作。
  assert.match(fn![0], /startChapterInterview\(/, 'opener must start the interview');
  assert.doesNotMatch(fn![0], /userMessage:\s*''/, 'opener no longer sends an empty-message write opener');

  // 采访阶段不写文案/不确认章(收集完才统一写)。
  assert.doesNotMatch(fn![0], /applyChapterWrite|markCurrentChapterDone/,
    'the interview entry must not write pages nor confirm the chapter');
});

test('B: interview collects every chapter first, then triggers layout (writes at layout time)', () => {
  const src = source('EditorPort.tsx');

  // finishInterview 只存 chapterContext,进下一章 / 收尾触发排版 —— 不在采访阶段写文案。
  const fi = /async function finishInterview\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fi, 'finishInterview() must be parseable');
  assert.match(fi![0], /postChapterContexts\(/, 'finishInterview stores chapterContext');
  assert.match(fi![0], /nextUninterviewedChapter\(\)/, 'finishInterview advances to the next uninterviewed chapter');
  assert.match(fi![0], /triggerSelectLayout\(\)/, 'finishInterview triggers layout once collection is done');
  assert.doesNotMatch(fi![0], /appendSatisfactionCard\(/, 'per-chapter satisfaction card is gone in the interview step');

  // triggerSelectLayout 触发排版(select-layout),文案在排版时由 judge_layout 写 —— 采访阶段
  // 不逐章 postWriteChapter(时序反转:收集完 → 排版并一并写全部文案)。
  const tl = /async function triggerSelectLayout\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(tl, 'triggerSelectLayout() must be parseable');
  assert.match(tl![0], /submitSelectLayoutV3\(/, 'triggerSelectLayout dispatches select-layout');
  assert.doesNotMatch(fi![0], /postWriteChapter\(/, 'interview step no longer writes copy per-chapter');

  // 采访进度是纯前端的(interviewedChapters),不靠服务端 done 推进。
  // 采访进度前端追踪,且放组件级 ref(interviewedChaptersRef)—— 跨 StrictMode 双调持久,
  // 否则第一章会重复发(#236 同款坑)。
  assert.match(src, /interviewedChaptersRef = useRef<Set<string>>/, 'interview progress tracked in a component-level ref');
  assert.match(src, /const interviewedChapters = interviewedChaptersRef\.current/, 'aliased from the ref inside the effect');
});

// 采访对话 = 系统表单伪装成 AI 对话;它的三条问句气泡 + 章节卡片 + 用户回答都必须作为
// 历史留在对话面板,刷新/重进后可完整重建。守住三个实现点,防回退:
//   ① finishInterview 把三条问句拆成独立 assistant 消息(不 join 成一条多行气泡);
//   ② loadHistory 重建时,每章第一条消息前补插一次章节卡片(卡片不入库,从 chapterId 重建);
//   ③ loadHistory 先等 storyGate 就绪再跑(卡片重建依赖 chapterMetaById→storyGate)。
test('interview history is fully reconstructable: separate bubbles + chapter cards on reload', () => {
  const src = source('EditorPort.tsx');

  // ① 三条问句气泡各自独立落库 —— 用 questions.map(...→assistant) 而非 questions.join。
  const fi = /async function finishInterview\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fi, 'finishInterview() must be parseable');
  assert.match(
    fi![0],
    /pending\.questions[\s\S]*?\.map\(\([^)]*\)\s*=>\s*\(\{[^}]*role:\s*'assistant'/,
    'each interview question must be stored as its own assistant message',
  );
  assert.doesNotMatch(
    fi![0],
    /pending\.questions\.join\(/,
    'interview questions must NOT be collapsed into one joined bubble',
  );

  // ② loadHistory 每章首消息前补插章节卡片,还原「卡片→问→答」的原始顺序。
  const lh = /async function loadHistory\([^)]*\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(lh, 'loadHistory() must be parseable');
  assert.match(
    lh![0],
    /m\.chapterId !== lastCardChapterId[\s\S]*?appendChapterCard\(m\.chapterId\)/,
    'loadHistory must re-insert the chapter card before each chapter\'s first message',
  );

  // ③ 非 authoring 路径也先 loadStoryGate 再 loadHistory(否则卡片重建拿不到 chapter meta)。
  assert.match(
    src,
    /loadStoryGate\(\)\.then\(\(\)\s*=>\s*loadHistory\(\)\)/,
    'loadHistory must run after storyGate is ready so chapter cards can be rebuilt',
  );
});

test('C: a write turn surfaces the satisfaction card (满意/不满意), not on talk/edit', () => {
  const src = source('EditorPort.tsx');

  assert.match(src, /function appendSatisfactionCard\(/, 'appendSatisfactionCard() must exist');

  // Only a real full-chapter WRITE opens the gate — the card is appended behind the
  // wroteChapter flag set by applyChapterWrite's return.
  assert.match(src, /wroteChapter = applyChapterWrite\(res\.pagesTexts\)/,
    'the write-turn result must drive the wroteChapter flag');
  // (#236 ④: the write branch now also drops the write-now exit before the satisfaction
  // card, so the satisfaction card lives inside an `if (wroteChapter) { … }` block.)
  assert.match(src, /if \(wroteChapter && !res\.progressDecision\?\.chapterDone\) \{[\s\S]*?appendSatisfactionCard\(\);/,
    'the satisfaction card must appear only after a successful write turn');
});

test('C: 满意 confirms the chapter; 不满意 stays for逐页 adjustment (no stage推进)', () => {
  const src = source('EditorPort.tsx');
  const card = /function appendSatisfactionCard\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(card, 'appendSatisfactionCard() body must be parseable');

  // 满意 → edit-chat progressDecision (advance chapter / 末章→主题) inside the acked bundle.
  assert.match(card![0], /confirmCurrentChapterViaEditChat\(\)/,
    '满意 must confirm through edit-chat');

  // 不满意 → stays on the chapter and asks the user which page to change (a talk/引导 ask);
  // it must NOT confirm the chapter or push stage. The existing focusedPageIndex + edit
  // turn machinery then does the逐页 adjustment — so the 不满意 branch itself applies no
  // patch and never advances.
  const noBranch = card![0].slice(card![0].indexOf('sc-no'));
  assert.doesNotMatch(noBranch, /confirmCurrentChapterViaEditChat/,
    '不满意 must NOT confirm the chapter (stays for逐页 adjustment, no stage推进)');
});

test('C: the standing「确定本章」breadcrumb button + its binding effect are removed', () => {
  const src = source('EditorPort.tsx');

  // No story-gate button JSX, no markCurrentChapterDone data-action node, no ref/bind effect.
  assert.doesNotMatch(src, /data-action="markCurrentChapterDone"/,
    'the breadcrumb「确定本章」button (data-action) must be gone');
  assert.doesNotMatch(src, /story-gate-btn/, 'the story-gate button class must no longer be rendered');
  assert.doesNotMatch(src, /markChapterDoneRef/,
    'the post-render ref/binding for the breadcrumb button must be gone');
});

test('focusedPageIndex逐页 edit path is preserved (不满意 reuses it)', () => {
  const src = source('EditorPort.tsx');
  // The edit turn still threads the selected page so "change this page" targets it.
  assert.match(
    src,
    /const focusedPageIndex = authoringFocusPageIndex\(\);/,
    'edit-chat must still send focusedPageIndex for逐页 edit turns',
  );
});
