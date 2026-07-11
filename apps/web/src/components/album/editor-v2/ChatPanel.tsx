'use client';

/* ════════════════════════════════════════════════════════════════════════════
   ChatPanel — the STABLE chat rail extracted out of EditorBook.

   EditorBook (the canvas) remounts on layout completion (pages 0→N) via
   key={pages.length}. When it did, the chat rail — which lived inside EditorBook's
   single mount effect — remounted too, wiping the interview/history state and
   flashing the DOM. ChatPanel is now a sibling, keyed by album.id only, so the
   canvas can remount without touching the chat.

   Architectural rule (from architect): STATE STAYS WHERE IT IS MUTATED; only
   behaviour crosses the boundary. ChatPanel NEVER owns pagesState or any canvas
   `let`. It reaches the canvas + export subsystem through a coordinator ref
   (ChatCoordinatorContext) that EditorBook populates at the end of its mount
   effect. ChatPanel ALWAYS dereferences `coordinator.current.fn` at call time
   (never caches a coordinator function), so an EditorBook remount that
   repopulates coordinator.current is transparent.

   ChatPanel keeps the命令式 DOM style (document.createElement, root.querySelector)
   exactly as the original — its mount effect scopes to the SHARED outer root (the
   `.editor-port` div created by the stable shell) so #chatBody / #stateStepper /
   #balanceAlert etc. resolve, and its data-action handlers bind only within its
   own aside subtree (EditorBook binds only within #paneCenter + topbar + modals),
   so no action is double-bound.
   ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, type RefObject } from 'react';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { IMAGE_INPUT_ACCEPT } from '@/lib/photo/heic';
import { renderMarkdownSafe } from '@/lib/markdown/render';
import {
  chatI18n,
  type ChatCoordinator,
} from './editor-coordinator';
import { computeExportUnlocked } from './export-gate-util';
import { runInspectAdjustLoop } from './draft-edit-orchestrator';
import type {
  AlbumDetail,
  EditorPage,
  LayoutPatchEntry,
  StoryProgress,
} from '../types';
import {
  postEditChat,
  postRecommend,
  postApplyTheme,
  postCover,
  postDraftEdit,
  postInspectRender,
  type CoverInput,
  type DraftEditResult,
  type DraftSkeleton,
  type DraftPageKind,
} from '@/lib/album/authoring-client';
import type {
  V3ChatTurn,
  V3EditChatResponse,
  V3PageTextsPatch,
  V3RecommendResponse,
  V3ChapterThemeChoice,
} from '@yujee/contracts';
import { getTemplate, TEMPLATE_IDS } from '@yujee/contracts/templates';
import {
  UnauthorizedError,
  CreditInsufficientError,
  clusterCompressedPhotos,
  interviewDataFromStore,
  selectLayoutRefsFromStore,
  submitAddPhotosV3,
  submitSelectLayoutV3,
  PhotosUnavailableError,
} from '@/lib/generation/client';
import { compressFile, type CompressedPhoto } from '@/lib/photo/compress';
import { photoStore } from '@/lib/photo/store';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';
import { albumRecipe } from '@/lib/generation/draft';
import { fetchChapterSummary, fetchDraftSkeleton, postChapterContexts } from '@/lib/album/authoring-client';
import {
  buildChapterInterviews,
  buildChapterContext,
  classifyInterviewCase,
  interviewMessages,
  type ChapterInterviewInput,
} from '@/lib/interview/interview';

const CONFIRM_CHAPTER_COMMAND = '[confirm-chapter]';

export type ChatMode = 'authoring' | 'editing';

type HistoryMessage = {
  seq?: number;
  role: string;
  content: string;
  chapterId?: string | null;
  createdAt?: string;
  // design chat 写类操作摘要（{ designOps: [{toolName, input}] }），用于历史回放 op-card。
  layoutPatch?: unknown;
};

// ════════════════════════════════════════════════════════════════════════════
// ChatPanel — stable chat rail. Keyed by album.id in the shell so it survives an
// EditorBook (canvas) remount. Its mount effect runs the imperative chat engine
// against the SHARED outer root; it reaches the canvas/export subsystem through
// the coordinator ref (always dereferenced at call time — never cached).
// ════════════════════════════════════════════════════════════════════════════
export function ChatPanel({
  detail,
  locale,
  mode,
  draftChapters,
  outerRootRef,
  coordinator,
  breadcrumbStage,
  storyProgress,
  setStoryProgress,
  setStoryProgressLoading,
  setStoryConfirming,
}: {
  detail: AlbumDetail;
  locale: Locale;
  mode: ChatMode;
  draftChapters: DraftSkeleton | null;
  outerRootRef: RefObject<HTMLDivElement | null>;
  coordinator: RefObject<ChatCoordinator | null>;
  breadcrumbStage: string;
  storyProgress: StoryProgress | null;
  setStoryProgress: (p: StoryProgress | null) => void;
  setStoryProgressLoading: (v: boolean) => void;
  setStoryConfirming: (v: boolean) => void;
}) {
  const latestAuthoringRef = useRef({ draftChapters, storyProgress, mode });
  latestAuthoringRef.current = { draftChapters, storyProgress, mode };

  // #236 ①: the per-chapter guide-opener dedup set lives at COMPONENT scope (a ref),
  // not inside the mount effect, so React StrictMode's double-invoke doesn't hand each
  // invocation its own empty set (which fires the opener twice). A shared ref survives
  // re-invocation → one opener.
  const guidedChaptersRef = useRef<Set<string>>(new Set());
  const interviewChainStartedRef = useRef(false);
  const interviewedChaptersRef = useRef<Set<string>>(new Set());
  const shownChapterCardsRef = useRef<Set<string>>(new Set());
  const recommendInFlightRef = useRef(false);
  const historyReplaySeqRef = useRef(0);
  const historyFetchPromiseRef = useRef<Promise<HistoryMessage[]> | null>(null);

  useEffect(() => {
    const root = outerRootRef.current;
    if (!root) return;
    let disposed = false;

    // ── scoped equivalents of document.* from the original script ──
    const $ = (s: string) => root.querySelector(s) as HTMLElement | null;
    const $$ = (s: string) => root.querySelectorAll(s);
    const byId = (id: string) => root.querySelector('#' + CSS.escape(id)) as HTMLElement | null;

    // Language switch does a full window navigation (see the shell's user menu), so
    // per-mount locale is constant — no live setLang is needed in ChatPanel. Derive
    // t/aT from the module-level dictionary directly.
    const currentLang = locale === 'zh' ? 'zh' : 'en';
    const t = (key: string) =>
      (chatI18n[currentLang] && chatI18n[currentLang][key]) || chatI18n.zh[key] || key;
    const aT = (zh: string, en: string) => (currentLang === 'zh' ? zh : en);

    const albumId = detail.album.id;
    const isAuthoring = mode === 'authoring';
    const MESSAGE_MAX = 500;
    const CHAT_HISTORY_MAX = 20;
    const draftSkel: DraftSkeleton | null = draftChapters;

    // The draft page-index total; used only to decide whether the book was laid out
    // yet (collect mode). Read from the coordinator's live pages when available.
    const initialTotal = draftSkel?.pages.length ?? 0;
    const isCollectMode = isAuthoring && initialTotal === 0;

    // ── coordinator dereference helpers (never cache a coordinator fn) ──
    const co = () => coordinator.current;

    const chapterHistory: V3ChatTurn[] = [];
    const coverHistory: V3ChatTurn[] = [];
    let lastCoverSelection: CoverInput = {};
    const guidedChapters = guidedChaptersRef.current;
    const openerInFlight = new Set<string>();
    let awaitingSatisfaction = false;
    const interviewedChapters = interviewedChaptersRef.current;
    let pendingInterview: {
      chapterId: string;
      input: ChapterInterviewInput;
      questions: readonly string[];
    } | null = null;
    let storyGate: StoryProgress | null = storyProgress;
    function isAuthoringExportLocked(progress: StoryProgress | null = storyGate) {
      if (!isAuthoring) return false;
      if (!progress) return true;
      if (progress.chapterOrder.length === 0) return false;
      return !computeExportUnlocked(progress.stage, progress.allDone);
    }
    let confirmingStoryChapter = false;
    let lastRecommend: V3RecommendResponse | null = null;
    void lastRecommend;

    const exportReadyLabel = aT('太棒了，你的书已经准备好了！', 'Wonderful — your book is ready!');

    // ── chat DOM handles ──
    const chatBody = byId('chatBody');
    const input = byId('msgInput') as HTMLTextAreaElement | null;
    const sendBtnEl = byId('sendBtn');
    let sending = false;

    function setChatState(n: number) {
      $$('#stateStepper .state-pill').forEach((p) => {
        const s = +p.getAttribute('data-state')!;
        p.classList.toggle('done', s < n);
        p.classList.toggle('active', s === n);
      });
    }
    function scrollChat() { const b = byId('chatBody'); if (b) b.scrollTop = b.scrollHeight; }

    function hideAwait() { const w = byId('awaitUser'); if (w) w.style.display = 'none'; }
    function restAwait() {
      const w = byId('awaitUser');
      if (!w) return;
      if (awaitingSatisfaction || chatBody?.querySelector('.thinking-block.active')) {
        w.style.display = 'none';
        return;
      }
      chatBody!.appendChild(w);
      w.style.display = 'flex';
    }

    async function send() {
      if (!input || sending) return;
      const txt = input.value.trim();
      if (!txt) return;
      const u = document.createElement('div');
      u.className = 'msg user max-w-full';
      u.innerHTML = `<div class="bubble"></div>`;
      u.querySelector('.bubble')!.textContent = txt;
      chatBody!.appendChild(u);
      input.value = ''; input.style.height = 'auto';
      hideAwait();
      scrollChat();
      if (pendingInterview) {
        await finishInterview(txt);
        return;
      }
      if (isAuthoring && storyGate?.stage === 'cover') {
        await runCover({
          ...lastCoverSelection,
          userMessage: txt.slice(0, MESSAGE_MAX),
          history: coverHistory.slice(-CHAT_HISTORY_MAX),
        });
        return;
      }
      sending = true;
      if (isAuthoring) {
        // 阶段3：authoring 期的对话改书走设计 Agent（原 runEditChatTurn 保留备切换）。
        await runDesignChatTurn(txt);
      } else {
        await runEdit(txt);
      }
      sending = false;
    }

    function appendAiText(text: string, opts?: { historyReplay?: boolean }) {
      const a = document.createElement('div');
      a.className = 'msg ai max-w-full';
      if (opts?.historyReplay) a.dataset.historyReplay = 'true';
      const body = document.createElement('div');
      body.className = 'ai-text';
      // AI 文本按 markdown 渲染(renderMarkdownSafe 已消毒);用户气泡仍走 textContent。
      body.innerHTML = renderMarkdownSafe(text);
      a.appendChild(body);
      chatBody!.appendChild(a);
      scrollChat();
    }
    function appendUserText(text: string, opts?: { historyReplay?: boolean }) {
      const u = document.createElement('div');
      u.className = 'msg user max-w-full';
      if (opts?.historyReplay) u.dataset.historyReplay = 'true';
      u.innerHTML = `<div class="bubble"></div>`;
      u.querySelector('.bubble')!.textContent = text;
      chatBody!.appendChild(u);
    }
    async function loadHistory(): Promise<number> {
      const replaySeq = ++historyReplaySeqRef.current;
      try {
        historyFetchPromiseRef.current ??= fetch(`/api/v1/albums/${albumId}/messages?limit=50`)
          .then(async (res) => {
            const j = await res.json();
            if (!j?.ok) return [];
            const msgs = (j.data?.messages ?? []) as HistoryMessage[];
            // 按追加序 seq 回放(写入顺序 = 用户操作顺序);seq 缺省时退回 createdAt。
            msgs.sort((a, b) =>
              a.seq != null && b.seq != null
                ? a.seq - b.seq
                : String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')),
            );
            return msgs;
          })
          .catch(() => {
            historyFetchPromiseRef.current = null;
            return [];
          });
        const msgs = await historyFetchPromiseRef.current;
        if (disposed || replaySeq !== historyReplaySeqRef.current) return 0;
        chatBody?.querySelectorAll('[data-history-replay]').forEach((n) => n.remove());
        chapterHistory.splice(0, chapterHistory.length);
        let shown = 0;
        let lastCardChapterId: string | null = null;
        for (const m of msgs) {
          const c = (m.content ?? '').trim();
          if (!c || c.startsWith('[inspection of page')) continue;
          // 章节卡片也是对话历史的一部分:采访时每章开头先出卡片(缩略图+查看排版)再出问句气泡。
          // 卡片不单独存库(能从 chapterId 经 chapterMetaById 完全重建),所以重建历史时,在该章
          // 第一条消息之前补插一次卡片,还原「卡片→问1→问2→问3→答」的原始顺序。appendChapterCard
          // 自身按 data-chapter-card 幂等,重复调用安全。
          if (m.chapterId && m.chapterId !== lastCardChapterId) {
            appendChapterCard(m.chapterId);
            lastCardChapterId = m.chapterId;
          }
          if (m.role === 'user') {
            appendUserText(c, { historyReplay: true });
            if (!m.chapterId || !storyGate?.currentChapterId || m.chapterId === storyGate.currentChapterId) {
              chapterHistory.push({ role: 'user', content: c });
            }
          } else {
            // design chat 的写类操作回执卡：贴在这条 AI 回复之前（还原「op-card→回复」顺序）。
            for (const op of readDesignOps(m.layoutPatch)) {
              const card = buildDesignOpCard(op.toolName, op.input);
              card.setAttribute('data-history-replay', '1');
              chatBody?.appendChild(card);
            }
            appendAiText(c, { historyReplay: true });
            if (!m.chapterId || !storyGate?.currentChapterId || m.chapterId === storyGate.currentChapterId) {
              chapterHistory.push({ role: 'assistant', content: c });
            }
          }
          shown += 1;
        }
        if (shown) scrollChat();
        return shown;
      } catch {
        return 0;
      }
    }
    function appendStep(text: string) {
      const d = document.createElement('div');
      d.className = 'ep-step';
      d.textContent = text;
      chatBody!.appendChild(d);
      scrollChat();
    }
    function setComposerThinking(on: boolean) {
      root?.querySelector('.composer-group')?.classList.toggle('thinking', on);
    }
    function appendThinkingShell(): HTMLElement {
      hideAwait();
      const a = document.createElement('div');
      a.className = 'msg ai max-w-full';
      a.innerHTML =
        `<div class="thinking-block active">` +
        `<img class="think-jelly" src="/jellyfish-loop.png" alt="">` +
        `<span class="thinking-label">${t('thinking')}</span>` +
        `<span class="thinking-dots"><span></span><span></span><span></span></span>` +
        `</div>`;
      chatBody!.appendChild(a);
      scrollChat();
      return a;
    }
    function settleThinking(host: HTMLElement, labelKey: string) {
      host.querySelector('.thinking-block')?.classList.remove('active');
      const label = host.querySelector('.thinking-label') as HTMLElement | null;
      if (label) label.textContent = t(labelKey);
    }
    // 保持水母 active，只把灰色 label 换成当前操作文案（workflow 进度用）。
    function setThinkingLabel(host: HTMLElement, text: string) {
      const label = host.querySelector('.thinking-label') as HTMLElement | null;
      if (label) label.textContent = text;
    }
    function appendReplyBody(host: HTMLElement, reply: string): HTMLElement {
      const body = document.createElement('div');
      body.className = 'ai-text';
      body.innerHTML = renderMarkdownSafe(reply);
      host.appendChild(body);
      return body;
    }
    function authErr(host: HTMLElement, e: unknown): boolean {
      host.querySelector('.thinking-block')?.classList.remove('active');
      if (e instanceof UnauthorizedError) {
        window.location.assign(localizePath(`/login?from=/album/${albumId}`, locale));
        return true;
      }
      if (e instanceof CreditInsufficientError) {
        showPurchaseCard();
        return true;
      }
      appendAiText(e instanceof Error ? e.message : String(e));
      return false;
    }

    function shouldUseMockEditFallback(e: unknown): boolean {
      return !(e instanceof UnauthorizedError) && !(e instanceof CreditInsufficientError);
    }

    function mockEditChatResponse(
      userMessage: string,
      chapterId: string,
      focusedPageIndex: number,
    ): V3EditChatResponse {
      const pages = co()?.getPagesState?.() ?? [];
      const page = pages.find((p) => p.pageIndex === focusedPageIndex) ?? pages[0] ?? null;
      const textKey = page
        ? ['body', 'explain', 'title', 'label']
            .find((key) => typeof page.textsJson?.[key] === 'string' && page.textsJson[key]!.trim().length > 0)
          ?? Object.keys(page.textsJson ?? {}).find((key) => typeof page.textsJson?.[key] === 'string')
        : undefined;
      const isConfirm = userMessage === CONFIRM_CHAPTER_COMMAND;
      const mockCopy = aT(
        '我先用本地 mock 帮你接住这一步：把这段回忆压成更柔和的语气，保留你刚补充的细节。等 AI 服务恢复后，可以继续让我精修。',
        'I caught this with a local mock for now: softer wording, keeping the detail you just added. Once AI is back, I can polish it further.',
      );
      return {
        kind: textKey && page && !isConfirm ? 'write' : 'talk',
        assistantReply: isConfirm
          ? aT('我先记下这个确认动作。当前 AI 服务不可用，正式推进分组时需要再点一次确认。', 'I noted that confirmation locally. AI is unavailable, so confirm again once the service is back to advance the chapter.')
          : aT('AI 服务暂时不可用，我先用本地 mock 给你一版可编辑结果。', 'AI is temporarily unavailable, so I generated a local mock result you can keep editing.'),
        patches: [],
        ...(textKey && page && !isConfirm
          ? { pagesTexts: [{ pageIndex: page.pageIndex, texts: { [textKey]: mockCopy } }] }
          : {}),
        navigation: page ? { pageIndex: page.pageIndex } : { chapterId },
        opId: `mock-edit-chat-${chapterId}-${focusedPageIndex}`,
        usage: {
          durationMs: 0,
          visionCallCount: 0,
          geminiCallCount: 0,
          planningInputTokens: 0,
          planningOutputTokens: 0,
          repairAttempts: 0,
          models: { planning: 'local-mock' },
        },
      };
    }

    function appendMockToolReceipt(host: HTMLElement, label: string) {
      const card = document.createElement('div');
      card.className = 'op-card';
      card.innerHTML =
        `<div class="op-icon">⌁</div>` +
        `<div class="op-body"><div class="op-kicker">${aT('Mock 已执行', 'Mock executed')}</div>` +
        `<div class="op-label"></div></div>` +
        `<div class="op-check">✓</div>`;
      const labelEl = card.querySelector('.op-label') as HTMLElement | null;
      if (labelEl) labelEl.textContent = label;
      host.appendChild(card);
    }

    function updateStoryGateUi(progress: StoryProgress | null = storyGate) {
      // §4.2: only the export-lock UI is gate-driven now. The topbar export button lives
      // in the stable shell; toggle it via the coordinator so its disabled/glow口径 tracks
      // the live gate. (No-op until EditorBook populates the coordinator.)
      if (isAuthoring) co()?.setExportGateUi?.(isAuthoringExportLocked(progress));
    }

    let exportReadyCardShown = false;
    function appendExportReadyCard() {
      if (exportReadyCardShown) return;
      exportReadyCardShown = true;
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'export-ready-card';
      const line = document.createElement('div');
      line.className = 'er-line';
      line.textContent = exportReadyLabel;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'er-btn';
      btn.textContent = aT('导出 PDF', 'Export PDF');
      btn.addEventListener('click', () => { void co()?.exportPdf?.(); });
      inner.appendChild(line);
      inner.appendChild(btn);
      card.appendChild(inner);
      chatBody!.appendChild(card);
      restAwait();
      scrollChat();
    }
    function maybeAppendExportReadyCard() {
      if (isAuthoring && storyGate?.stage === 'ready') appendExportReadyCard();
    }

    async function loadStoryGate() {
      if (!isAuthoring) return;
      try {
        const res = await fetch(`/api/v3/albums/${albumId}/story-progress`);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error?.message ?? 'story progress failed');
        storyGate = json.data as StoryProgress;
        setStoryProgress(storyGate);
        updateStoryGateUi(storyGate);
      } catch {
        storyGate = null;
        updateStoryGateUi(null);
      } finally {
        setStoryProgressLoading(false);
      }
    }

    async function applyEditChatProgressDecision(prevChapterId: string) {
      await loadStoryGate();
      if (!storyGate) return;

      const advancedTo = storyGate.currentChapterId;
      const advanced = advancedTo != null && advancedTo !== prevChapterId;
      if (advanced) {
        chapterHistory.length = 0;
        awaitingSatisfaction = false;
        co()?.goToChapterById?.(advancedTo!);
        appendChapterCard(advancedTo!);
      }
      maybeAppendExportReadyCard();
      if (advanced && storyGate.stage !== 'theme') {
        if (currentChapterHasDraftPages()) {
          appendEditLoopReadyCard(advancedTo!);
        } else {
          await runChapterGuideOpener({ allowDuringSend: true });
        }
      }
      if (storyGate.stage === 'theme') {
        confirmingStoryChapter = false;
        setStoryConfirming(false);
        await runRecommendTheme(undefined, { allowDuringSend: true });
      }
    }

    async function confirmCurrentChapterViaEditChat() {
      if (
        !isAuthoring ||
        confirmingStoryChapter ||
        !storyGate?.currentChapterId ||
        storyGate.chapterOrder.length === 0
      ) return;
      confirmingStoryChapter = true;
      sending = true;
      setStoryConfirming(true);
      updateStoryGateUi();
      try {
        await runEditChatTurn(CONFIRM_CHAPTER_COMMAND);
      } catch (e) {
        appendAiText(
          e instanceof Error
            ? e.message
            : aT('确定分组失败，请重试。', 'Could not confirm the chapter. Please try again.'),
        );
      } finally {
        sending = false;
        confirmingStoryChapter = false;
        setStoryConfirming(false);
        updateStoryGateUi();
      }
    }

    function applyAuthoringPatch(patch: LayoutPatchEntry[]): boolean {
      return co()?.applyAuthoringPatch?.(patch) ?? false;
    }
    function mirrorStage(stage: string) {
      if (!storyGate || storyGate.stage === stage) return;
      storyGate = { ...storyGate, stage };
      setStoryProgress(storyGate);
      updateStoryGateUi(storyGate);
      maybeAppendExportReadyCard();
    }

    async function runRecommendTheme(userMessage?: string, opts?: { allowDuringSend?: boolean }) {
      if (!isAuthoring || (!opts?.allowDuringSend && sending)) return;
      if (recommendInFlightRef.current) return;
      if (!userMessage && chatBody?.querySelector('.palette-card:not(.is-recap)')) return;
      recommendInFlightRef.current = true;
      sending = true;
      const host = appendThinkingShell();
      try {
        const res = await postRecommend(albumId, userMessage);
        lastRecommend = res;
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, res.assistantReply);
        appendPaletteCard(res);
      } catch (e) {
        if (authErr(host, e)) { sending = false; recommendInFlightRef.current = false; return; }
      }
      sending = false;
      recommendInFlightRef.current = false;
      restAwait();
      scrollChat();
    }

    function appendPaletteCard(res: V3RecommendResponse) {
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'palette-card';
      const title = document.createElement('div');
      title.className = 'pc-title';
      title.textContent = aT('选择一套主题', 'Choose a theme option');
      const groups = document.createElement('div');
      groups.className = 'pc-groups';
      res.bookThemeOptions.forEach((option, i) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'pc-chapter-row';
        const head = document.createElement('div');
        head.className = 'pc-group-head';
        const num = document.createElement('span');
        num.className = 'pc-chapter-num';
        num.textContent = String(i + 1).padStart(2, '0');
        head.appendChild(num);
        const label = document.createElement('span');
        label.className = 'pc-group-label';
        label.textContent = option.label ?? option.style ?? option.optionId;
        head.appendChild(label);
        rowEl.appendChild(head);
        if (option.style) {
          const style = document.createElement('div');
          style.className = 'pc-style';
          style.textContent = option.style;
          rowEl.appendChild(style);
        }
        const sw = document.createElement('div');
        sw.className = 'pc-swatches';
        option.chapters.slice(0, 4).forEach((c) => {
          const dot = document.createElement('span');
          dot.style.background = c.accentColor;
          sw.appendChild(dot);
        });
        rowEl.appendChild(sw);
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'pc-apply';
        applyBtn.textContent = aT('应用', 'Apply');
        applyBtn.addEventListener('click', () => {
          if (sending) return;
          applyBtn.disabled = true;
          appendUserText(aT('就用这套主题', 'Use this theme'));
          hideAwait();
          scrollChat();
          void runApplyTheme({
            chapters: option.chapters.map((c) => ({
              chapterId: c.chapterId,
              ...(c.subject ? { subject: c.subject } : {}),
              accentColor: c.accentColor,
              artFont: option.artFont,
            })),
          });
        });
        rowEl.appendChild(applyBtn);
        groups.appendChild(rowEl);
      });

      inner.appendChild(title);
      inner.appendChild(groups);
      card.appendChild(inner);
      chatBody!.appendChild(card);
      scrollChat();
    }

    function appendThemeSummary() {
      const chapters = draftSkel?.chapters ?? [];
      if (chapters.length === 0) return;
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'palette-card is-recap';
      const title = document.createElement('div');
      title.className = 'pc-title';
      title.textContent = aT('已应用的主题 · 各组标题', 'Applied theme · chapter titles');
      const groups = document.createElement('div');
      groups.className = 'pc-groups';
      chapters.forEach((c, i) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'pc-chapter-row';
        const head = document.createElement('div');
        head.className = 'pc-group-head';
        const num = document.createElement('span');
        num.className = 'pc-chapter-num';
        num.textContent = String(i + 1).padStart(2, '0');
        head.appendChild(num);
        const label = document.createElement('span');
        label.className = 'pc-group-label';
        label.textContent = (c.subject && c.subject.trim()) || c.label;
        head.appendChild(label);
        rowEl.appendChild(head);
        groups.appendChild(rowEl);
      });
      inner.appendChild(title);
      inner.appendChild(groups);
      card.appendChild(inner);
      chatBody!.appendChild(card);
    }

    function appendCoverSummary() {
      const kindByPageIndex = new Map<number, DraftPageKind>();
      for (const p of draftSkel?.pages ?? []) kindByPageIndex.set(p.pageIndex, p.kind);
      const pagesState = co()?.getPagesState?.() ?? [];
      const coverPage = pagesState.find((p) => kindByPageIndex.get(p.pageIndex) === 'cover') ?? null;
      const endingPage = pagesState.find((p) => kindByPageIndex.get(p.pageIndex) === 'ending') ?? null;
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'cover-card is-recap';
      const title = document.createElement('div');
      title.className = 'cv-title';
      title.textContent = aT('已选的封面与封底', 'Chosen cover & back cover');
      inner.appendChild(title);
      if (!coverPage && !endingPage) {
        const skip = document.createElement('div');
        skip.className = 'cv-label';
        skip.textContent = aT('已跳过封面设计', 'Cover design skipped');
        inner.appendChild(skip);
      } else {
        for (const [page, zh, en] of [
          [coverPage, '封面', 'Cover'],
          [endingPage, '封底', 'Back cover'],
        ] as const) {
          if (!page) continue;
          const sec = document.createElement('div');
          sec.className = 'cv-section';
          const label = document.createElement('div');
          label.className = 'cv-label';
          label.textContent = aT(zh, en);
          const opt = document.createElement('div');
          opt.className = 'cv-opt';
          const heroPhoto = Object.values(page.imagesJson)[0] ?? null;
          opt.innerHTML = co()?.coverOptionHTML?.(page.templateId, heroPhoto) ?? '';
          sec.appendChild(label);
          sec.appendChild(opt);
          inner.appendChild(sec);
        }
      }
      card.appendChild(inner);
      chatBody!.appendChild(card);
    }

    async function runApplyTheme(selection?: { chapters: V3ChapterThemeChoice[] }) {
      if (!isAuthoring || sending) return;
      const chapters = selection?.chapters;
      if (!chapters || chapters.length === 0) {
        await runRecommendTheme();
        return;
      }
      sending = true;
      const host = appendThinkingShell();
      try {
        const res = await postApplyTheme(albumId, { chapters });
        settleThinking(host, 'analyzedFeedback');
        applyAuthoringPatch(res.layoutPatch as LayoutPatchEntry[]);
        mirrorStage(res.stage);
        appendReplyBody(
          host,
          res.assistantReply ??
            aT('已应用主题色与字体。', 'Applied the theme colors and fonts.'),
        );
        if (res.stage === 'cover') {
          sending = false;
          appendCoverCard();
        }
      } catch (e) {
        if (authErr(host, e)) { sending = false; return; }
      }
      sending = false;
      restAwait();
      scrollChat();
    }

    async function runCover(input?: CoverInput) {
      if (!isAuthoring || sending) return;
      sending = true;
      const host = appendThinkingShell();
      try {
        const payload: CoverInput = { ...(input ?? {}) };
        if (payload.coverPhoto === undefined && payload.coverPhotoId) {
          const thumb = await co()?.capturePhotoThumb?.(payload.coverPhotoId);
          if (thumb) payload.coverPhoto = thumb;
        }
        if (payload.endingPhoto === undefined && payload.endingPhotoId) {
          const thumb = await co()?.capturePhotoThumb?.(payload.endingPhotoId);
          if (thumb) payload.endingPhoto = thumb;
        }
        const selection: CoverInput = {};
        if (payload.coverTemplateId !== undefined) selection.coverTemplateId = payload.coverTemplateId;
        if (payload.endingTemplateId !== undefined) selection.endingTemplateId = payload.endingTemplateId;
        if (payload.coverPhotoId !== undefined) selection.coverPhotoId = payload.coverPhotoId;
        if (payload.endingPhotoId !== undefined) selection.endingPhotoId = payload.endingPhotoId;
        if (payload.coverPhoto !== undefined) selection.coverPhoto = payload.coverPhoto;
        if (payload.endingPhoto !== undefined) selection.endingPhoto = payload.endingPhoto;
        if (Object.keys(selection).length > 0) lastCoverSelection = selection;
        const res = await postCover(albumId, payload);
        settleThinking(host, 'analyzedFeedback');
        const applied = applyAuthoringPatch(res.layoutPatch as LayoutPatchEntry[]);
        mirrorStage(res.stage);
        appendReplyBody(
          host,
          res.assistantReply ??
            (applied
              ? aT('已应用封面与封尾设计。', 'Applied the cover and ending design.')
              : aT('已跳过封面设计。', 'Skipped the cover design.')),
        );
        const userMessage = payload.userMessage?.trim();
        if (userMessage) coverHistory.push({ role: 'user', content: userMessage });
        if (res.assistantReply?.trim()) {
          coverHistory.push({ role: 'assistant', content: res.assistantReply });
        }
      } catch (e) {
        if (authErr(host, e)) { sending = false; return; }
      }
      sending = false;
      restAwait();
      scrollChat();
    }

    // The book's photo ids (deduped, in page order) — the hero-photo picker pool.
    function bookPhotoIds(): string[] {
      return co()?.bookPhotoIds?.() ?? [];
    }
    function templateIdsByCategory(category: 'cover' | 'ending'): string[] {
      return TEMPLATE_IDS.filter((id) => getTemplate(id)?.category === category);
    }
    function coverOptionHTML(templateId: string, photoId: string | null): string {
      return co()?.coverOptionHTML?.(templateId, photoId) ?? '';
    }
    function imageUrl(id: string): string | undefined {
      return co()?.imageUrl?.(id);
    }
    function appendCoverCard() {
      const kindByPageIndex = new Map<number, DraftPageKind>();
      for (const p of draftSkel?.pages ?? []) kindByPageIndex.set(p.pageIndex, p.kind);
      const pagesState = co()?.getPagesState?.() ?? [];
      const coverPage = pagesState.find((p) => kindByPageIndex.get(p.pageIndex) === 'cover') ?? null;
      const endingPage = pagesState.find((p) => kindByPageIndex.get(p.pageIndex) === 'ending') ?? null;
      const coverTemplateId = coverPage?.templateId ?? null;
      const endingTemplateId = endingPage?.templateId ?? null;
      if (coverTemplateId == null && endingTemplateId == null) {
        void runCover({});
        return;
      }
      const checkSvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
        'stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'cover-card';

      const title = document.createElement('div');
      title.className = 'cv-title';
      title.textContent = aT('挑一个封面和封底吧', 'Pick a cover and back cover');
      inner.appendChild(title);

      const photos = bookPhotoIds();

      const section = (
        labelZh: string,
        labelEn: string,
        category: 'cover' | 'ending',
        page: EditorPage | null,
      ): (() => { templateId: string | null; photoId: string | null }) => {
        const candidateIds = templateIdsByCategory(category);
        let selTemplateId: string | null =
          page?.templateId ?? candidateIds[0] ?? null;
        let selPhotoId: string | null =
          (page ? Object.values(page.imagesJson)[0] : undefined) ??
          photos[0] ??
          null;

        const sec = document.createElement('div');
        sec.className = 'cv-section';
        const label = document.createElement('div');
        label.className = 'cv-label';
        label.textContent = aT(labelZh, labelEn);
        sec.appendChild(label);

        const row = document.createElement('div');
        row.className = 'cv-row';
        const optByTemplate = new Map<string, HTMLButtonElement>();
        const repaintOptions = () => {
          for (const [tid, opt] of optByTemplate) {
            opt.innerHTML = coverOptionHTML(tid, selPhotoId);
            opt.classList.toggle('selected', tid === selTemplateId);
            const check = document.createElement('span');
            check.className = 'cv-check';
            check.innerHTML = checkSvg;
            opt.appendChild(check);
            if (tid === (page?.templateId ?? candidateIds[0])) {
              const reco = document.createElement('span');
              reco.className = 'cv-reco';
              reco.textContent = aT('推荐', 'Recommended');
              opt.appendChild(reco);
            }
          }
        };
        for (const tid of candidateIds) {
          const opt = document.createElement('button');
          opt.type = 'button';
          opt.className = 'cv-opt';
          opt.addEventListener('click', () => {
            selTemplateId = tid;
            repaintOptions();
          });
          optByTemplate.set(tid, opt);
          row.appendChild(opt);
        }
        sec.appendChild(row);

        if (photos.length > 1) {
          const photoLabel = document.createElement('div');
          photoLabel.className = 'cv-sublabel';
          photoLabel.textContent = aT('换一张照片', 'Change photo');
          sec.appendChild(photoLabel);
          const photoRow = document.createElement('div');
          photoRow.className = 'cv-photos';
          const thumbByPhoto = new Map<string, HTMLButtonElement>();
          const repaintPhotos = () => {
            for (const [pid, thumb] of thumbByPhoto) {
              thumb.classList.toggle('selected', pid === selPhotoId);
            }
          };
          for (const pid of photos) {
            const thumb = document.createElement('button');
            thumb.type = 'button';
            thumb.className = 'cv-photo';
            const url = imageUrl(pid);
            if (url) thumb.style.backgroundImage = `url("${url}")`;
            thumb.addEventListener('click', () => {
              selPhotoId = pid;
              repaintPhotos();
              repaintOptions();
            });
            thumbByPhoto.set(pid, thumb);
            photoRow.appendChild(thumb);
          }
          sec.appendChild(photoRow);
          repaintPhotos();
        }

        repaintOptions();
        inner.appendChild(sec);
        return () => ({ templateId: selTemplateId, photoId: selPhotoId });
      };

      const getCover = coverPage
        ? section('封面', 'Cover', 'cover', coverPage)
        : () => ({ templateId: null as string | null, photoId: null as string | null });
      const getEnding = endingPage
        ? section('封底', 'Back cover', 'ending', endingPage)
        : () => ({ templateId: null as string | null, photoId: null as string | null });

      const actionsRow = document.createElement('div');
      actionsRow.className = 'cv-actions';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'cv-action cv-action-primary';
      applyBtn.textContent = aT('应用封面设计', 'Apply cover design');
      applyBtn.addEventListener('click', () => {
        if (sending) return;
        const cover = getCover();
        const ending = getEnding();
        const coverTemplateId = cover.templateId;
        const endingTemplateId = ending.templateId;
        const hasSelection = coverTemplateId != null || endingTemplateId != null;
        if (!hasSelection) {
          void runCover({});
          return;
        }
        applyBtn.disabled = true;
        applyBtn.textContent = aT('已应用', 'Applied');
        const userMessage = aT('就用这个封面设计', 'Use this cover design');
        appendUserText(userMessage);
        hideAwait();
        scrollChat();
        void runCover({
          ...(coverTemplateId != null ? { coverTemplateId } : {}),
          ...(endingTemplateId != null ? { endingTemplateId } : {}),
          ...(coverTemplateId != null && cover.photoId ? { coverPhotoId: cover.photoId } : {}),
          ...(endingTemplateId != null && ending.photoId ? { endingPhotoId: ending.photoId } : {}),
          userMessage,
          history: coverHistory.slice(-CHAT_HISTORY_MAX),
        });
      });
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'cv-action cv-action-ghost';
      skipBtn.textContent = aT('跳过', 'Skip');
      skipBtn.addEventListener('click', () => {
        if (sending) return;
        lastCoverSelection = {};
        const userMessage = aT('先跳过封面设计', 'Skip the cover design for now');
        appendUserText(userMessage);
        hideAwait();
        scrollChat();
        void runCover({
          userMessage,
          history: coverHistory.slice(-CHAT_HISTORY_MAX),
        });
      });
      actionsRow.appendChild(skipBtn);
      actionsRow.appendChild(applyBtn);
      inner.appendChild(actionsRow);

      card.appendChild(inner);
      chatBody!.appendChild(card);
      scrollChat();
    }

    function authoringFocusPageIndex(): number {
      return co()?.authoringFocusPageIndex?.() ?? 0;
    }
    function draftFocusPageIndex(): number {
      return authoringFocusPageIndex();
    }
    function applyDraftAct(r: DraftEditResult): boolean {
      const act = co()?.applyDraftAct?.(r);
      if (!act) return false;
      if (act.pageWrite) {
        appendStep(aT('✏️ 已更新这页文案。', '✏️ Updated this page’s copy.'));
        return true;
      }
      if (act.imagePos) {
        const w = act.imagePos;
        appendStep(
          aT(
            `🎯 已调整图片位置：横向 ${w.x}%、纵向 ${w.y}%、缩放 ${w.scale}×。`,
            `🎯 Adjusted the photo: x ${w.x}%, y ${w.y}%, zoom ${w.scale}×.`,
          ),
        );
        return true;
      }
      return false;
    }

    async function runDraftEditTurn(message: string) {
      const host = appendThinkingShell();
      const focusIndex = draftFocusPageIndex();
      const markAuth = (e: unknown): never => {
        if (e instanceof UnauthorizedError) (e as unknown as { isAuthError: boolean }).isAuthError = true;
        throw e;
      };
      try {
        const r = await runInspectAdjustLoop(focusIndex, message, {
          postDraftEdit: (pi, msg) => postDraftEdit(albumId, pi, msg).catch(markAuth),
          capturePageRender: (pi) => co()!.capturePageRender(pi),
          postInspectRender: (pi, msg, shot) =>
            postInspectRender(albumId, pi, msg, shot).catch(markAuth),
          capReply: aT(
            '我已经尽力调整了——如果还有点偏，告诉我往哪个方向移。',
            "I've adjusted it as best I can — tell me which direction if it's still off.",
          ),
          inspectFailReply: aT(
            '我暂时没法看清这一页，你可以直接告诉我把图往哪个方向移、放大还是缩小。',
            "I couldn't get a clear look at this page — just tell me which way to move the photo, or to zoom in/out.",
          ),
          onVisionRound: () => {
            settleThinking(host, 'thinking');
            host.querySelector('.thinking-block')?.classList.add('active');
          },
          onStep: (s) => {
            if (s.kind === 'inspecting') {
              appendStep(
                aT(
                  `🔍 第 ${s.round} 轮：截图查看这一页的图片排版…`,
                  `🔍 Round ${s.round}: capturing this page to look at the photo…`,
                ),
              );
            } else if (s.kind === 'diagnosed') {
              const conf = Math.round(s.confidence * 100);
              appendStep(
                aT(
                  `🩺 看图诊断：${s.problem}（目标位置 x ${s.targetX}、y ${s.targetY}、缩放 ${s.scale}×，置信度 ${conf}%）`,
                  `🩺 Diagnosis: ${s.problem} (target x ${s.targetX}, y ${s.targetY}, zoom ${s.scale}×, conf ${conf}%)`,
                ),
              );
            } else if (s.kind === 'capped') {
              appendStep(aT('↳ 已到复查上限（3 轮），先停在这。', '↳ Hit the 3-round inspection cap.'));
            }
          },
          messageMax: MESSAGE_MAX,
        });

        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, r.assistantReply);
        if (r.kind === 'act') applyDraftAct(r);
      } catch (e) {
        if (authErr(host, e)) return;
      }
      restAwait();
      scrollChat();
      updateAuthInputPlaceholder();
    }
    void runDraftEditTurn;

    function applyChapterWrite(pagesTexts: V3PageTextsPatch[]): boolean {
      const applied = co()?.applyChapterWrite?.(pagesTexts) ?? false;
      if (applied) appendStep(aT('✏️ 已为本组写好文案。', '✏️ Wrote this chapter’s copy.'));
      return applied;
    }

    function applyChapterEdit(layoutPatch: LayoutPatchEntry[]): boolean {
      const applied = co()?.applyChapterEdit?.(layoutPatch) ?? false;
      if (applied) appendStep(aT('🛠️ 已更新这一页的排版。', '🛠️ Updated this page’s layout.'));
      return applied;
    }

    // 设计 Agent 全书对话（阶段3接线，NDJSON 流式）。渲染遵循 editor 设计语言：
    // 动态小水母始终钉在对话最底部；AI 每调用一个工具，就在水母上方流式冒出一行
    // 可见的操作（读/写都暴露），工具返回时该行打勾 ✓；一轮结束后收掉水母、贴出
    // 回复。committed 时派发刷新事件让画板重取草稿。done 时 pages 已写回 draft_json。
    const DESIGN_TOOL_LABEL: Record<string, [string, string]> = {
      get_book_summary: ['翻阅整本相册', 'Reading the whole album'],
      read_page: ['查看页面内容', 'Reading a page'],
      search_book: ['在全书中检索', 'Searching the book'],
      list_templates: ['挑选合适的版式', 'Browsing templates'],
      read_skill: ['查阅设计规则', 'Consulting design rules'],
      update_page_texts: ['写页面文字', 'Writing page copy'],
      swap_page_template: ['更换版式', 'Swapping the template'],
      update_page_images: ['调整图片', 'Adjusting images'],
      set_text_colors: ['设定文字配色', 'Setting text colors'],
    };
    const WRITE_TOOLS = new Set([
      'update_page_texts',
      'swap_page_template',
      'update_page_images',
      'set_text_colors',
    ]);
    const OP_PENCIL_SVG =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    // 富回执卡的绿色圆圈勾（对齐 demo 设计）。
    const OP_CIRCLE_CHECK_SVG =
      '<svg class="op-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M8.3 12.4l2.6 2.6 4.7-5.3"/></svg>';
    function designToolLabel(toolName: string): string {
      const label = DESIGN_TOOL_LABEL[toolName];
      return label ? aT(label[0], label[1]) : toolName;
    }
    // 写类工具的具体动作描述（从工具入参生成，落在回执卡的 op-label）。
    function designWriteDescription(toolName: string, input: unknown): string {
      const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
      const pageNo = typeof rec.pageNo === 'number' ? rec.pageNo : undefined;
      // pageNo 已是 1 起（与工具口径一致），直接用。
      const pageLabel = pageNo !== undefined ? aT(`第 ${pageNo} 页`, `page ${pageNo}`) : '';
      switch (toolName) {
        case 'update_page_texts':
          return pageLabel ? aT(`更新${pageLabel}的文案`, `Updated ${pageLabel} copy`) : aT('更新页面文案', 'Updated page copy');
        case 'swap_page_template':
          return pageLabel ? aT(`重新排版${pageLabel}`, `Re-laid out ${pageLabel}`) : aT('更换页面版式', 'Swapped the template');
        case 'update_page_images':
          return pageLabel ? aT(`调整${pageLabel}的图片`, `Adjusted ${pageLabel} images`) : aT('调整页面图片', 'Adjusted images');
        case 'set_text_colors':
          return aT('设定文字配色', 'Set text colors');
        default:
          return designToolLabel(toolName);
      }
    }
    // 写类工具的富回执卡（流式与历史回放共用）。
    function buildDesignOpCard(toolName: string, input: unknown): HTMLElement {
      const card = document.createElement('div');
      card.className = 'op-card';
      card.innerHTML =
        `<div class="op-ic">${OP_PENCIL_SVG}</div>` +
        `<div class="op-body"><div class="op-kicker">${aT('已执行', 'Done')}</div><div class="op-label"></div></div>` +
        OP_CIRCLE_CHECK_SVG;
      (card.querySelector('.op-label') as HTMLElement).textContent = designWriteDescription(toolName, input);
      return card;
    }
    // 从落库的 layout_patch 里解析 design chat 写操作（{ designOps: [{toolName, input}] }）。
    function readDesignOps(layoutPatch: unknown): Array<{ toolName: string; input: unknown }> {
      if (!layoutPatch || typeof layoutPatch !== 'object') return [];
      const ops = (layoutPatch as { designOps?: unknown }).designOps;
      if (!Array.isArray(ops)) return [];
      return ops.filter(
        (op): op is { toolName: string; input: unknown } =>
          !!op && typeof op === 'object' && typeof (op as { toolName?: unknown }).toolName === 'string',
      );
    }

    // 底部钉着水母的流式操作面板。读类工具冒出轻量行（转圈→打勾）；写类工具执行成功后
    // 替换成富回执卡（op-ic 图标 + 「已执行」+ 具体描述 + 绿色圆圈勾）。结束时收掉水母。
    function createDesignStreamHost(): {
      host: HTMLElement;
      jelly: HTMLElement;
      startOp: (toolCallId: string, toolName: string, input: unknown) => void;
      finishOp: (toolCallId: string, toolName: string, isError: boolean) => void;
      settle: () => void;
    } {
      hideAwait();
      const host = document.createElement('div');
      host.className = 'msg ai max-w-full';
      const jelly = document.createElement('div');
      jelly.className = 'thinking-block active ep-stream-jelly';
      jelly.innerHTML =
        `<img class="think-jelly" src="/jellyfish-loop.png" alt="">` +
        `<span class="thinking-label">${t('thinking')}</span>` +
        `<span class="thinking-dots"><span></span><span></span><span></span></span>`;
      host.appendChild(jelly);
      chatBody!.appendChild(host);
      scrollChat();

      const labelEl = jelly.querySelector('.thinking-label') as HTMLElement | null;
      const inputByCall = new Map<string, unknown>();
      const setLabel = (text: string) => {
        if (labelEl) labelEl.textContent = text;
      };
      return {
        host,
        jelly,
        startOp(toolCallId, toolName, input) {
          // 读/写都只更新水母旁的灰色小字（当前在做什么），不单独做行样式。
          setLabel(WRITE_TOOLS.has(toolName) ? designWriteDescription(toolName, input) : designToolLabel(toolName));
          if (toolCallId) inputByCall.set(toolCallId, input);
          scrollChat();
        },
        finishOp(toolCallId, toolName, isError) {
          // 只有写类工具执行成功留下富回执卡；读类是纯思考，随水母灰字过一下、不留痕。
          if (isError || !WRITE_TOOLS.has(toolName)) return;
          const card = buildDesignOpCard(toolName, inputByCall.get(toolCallId));
          // 回执卡冒在水母上方；jelly 仍是 host 子节点才用 insertBefore，否则直接追加（防 DOM 抛错）。
          if (jelly.parentNode === host) host.insertBefore(card, jelly);
          else host.appendChild(card);
          setLabel(t('thinking')); // 回执卡插入后灰字回到「思考中」
          scrollChat();
        },
        settle() {
          jelly.remove(); // 收掉底部水母（读类灰字随之消失，不留痕）
        },
      };
    }

    async function readDesignChatStream(
      res: Response,
      onEvent: (event: Record<string, unknown>) => void,
    ): Promise<void> {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const consume = (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) onEvent(JSON.parse(line) as Record<string, unknown>);
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        consume(decoder.decode(value, { stream: true }));
      }
      consume(decoder.decode());
      if (buffer.trim()) onEvent(JSON.parse(buffer) as Record<string, unknown>);
    }

    async function runDesignChatTurn(message: string) {
      const stream = createDesignStreamHost();
      setComposerThinking(true);
      const userMessage = message.slice(0, MESSAGE_MAX);
      try {
        const res = await fetch(`/api/v3/albums/${albumId}/design-chat?stream=1`, {
          method: 'POST',
          headers: { accept: 'application/x-ndjson', 'content-type': 'application/json' },
          // currentPageIndex:用户此刻停留的页(选中页,否则当前跨页首页)。agent 用它
          // 消解"这页/当前页"指代,不再反问用户在哪页。
          body: JSON.stringify({ userMessage, currentPageIndex: authoringFocusPageIndex() }),
        });
        if (!res.ok || !res.body) {
          if (res.status === 401) throw new UnauthorizedError();
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error?.message ?? 'Request failed');
        }
        const outcome: {
          final: {
            assistantReply: string;
            committed: boolean;
            pages?: Array<{
              pageIndex: number;
              templateId: string;
              images?: Record<string, string>;
              texts?: Record<string, string>;
              imagePos?: Record<string, { x: number; y: number; scale: number }> | null;
            }>;
          } | null;
          error: string | null;
        } = { final: null, error: null };
        await readDesignChatStream(res, (event) => {
          const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
          if (event.type === 'tool_call' && typeof event.toolName === 'string') {
            stream.startOp(toolCallId, event.toolName, event.input);
          } else if (event.type === 'tool_result' && typeof event.toolName === 'string') {
            stream.finishOp(toolCallId, event.toolName, event.isError === true);
          } else if (event.type === 'done') {
            outcome.final = event.response as {
              assistantReply: string;
              committed: boolean;
              pages?: Array<{
                pageIndex: number;
                templateId: string;
                images?: Record<string, string>;
                texts?: Record<string, string>;
                imagePos?: Record<string, { x: number; y: number; scale: number }> | null;
              }>;
            };
          } else if (event.type === 'error') {
            outcome.error = typeof event.error === 'string' ? event.error : 'stream failed';
          }
        });
        if (outcome.error) throw new Error(outcome.error);
        const final = outcome.final;
        if (!final) throw new Error('stream ended without result');
        stream.settle();
        appendReplyBody(stream.host, final.assistantReply);
        if (final.committed) {
          // 原地重绘：把服务端回来的新页整体喂给画板（不重挂、不重载图，无"全局刷新闪一下"）。
          // 拿不到 pages 或 coordinator 未就绪时，回退到旧的重挂式刷新事件。
          const applied =
            final.pages && final.pages.length > 0
              ? (co()?.replacePages?.(
                  final.pages.map((p) => ({
                    pageIndex: p.pageIndex,
                    templateId: p.templateId,
                    imagesJson: { ...(p.images ?? {}) },
                    textsJson: { ...(p.texts ?? {}) },
                    imagePosJson: { ...(p.imagePos ?? {}) },
                  })),
                ) ?? false)
              : false;
          if (!applied) {
            const root = outerRootRef.current;
            root?.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
            window.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
          }
        }
        chapterHistory.push({ role: 'user', content: userMessage });
        chapterHistory.push({ role: 'assistant', content: final.assistantReply });
      } catch (e) {
        stream.settle();
        setComposerThinking(false);
        if (authErr(stream.host, e)) return;
        appendReplyBody(
          stream.host,
          aT('设计助手暂时不可用，请稍后再试。', 'The design assistant is unavailable right now — please try again shortly.') +
            (e instanceof Error && e.message ? `（${e.message}）` : ''),
        );
      }
      setComposerThinking(false);
      restAwait();
      scrollChat();
      updateAuthInputPlaceholder();
    }

    async function runEditChatTurn(message: string) {
      const host = appendThinkingShell();
      const chapterId = storyGate?.currentChapterId ?? null;
      if (!chapterId) {
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(
          host,
          aT('这一组已经确定了——你可以继续下一步，或者从左侧选另一组来调整。',
             "This chapter is already confirmed — move on, or pick another chapter on the left to tweak."),
        );
        restAwait();
        scrollChat();
        return;
      }
      const userMessage = message.slice(0, MESSAGE_MAX);
      const focusedPageIndex = authoringFocusPageIndex();
      try {
        const pagePhotoRefs = await captureChapterPagePhotoRefs(chapterId);
        const res = await postEditChat(albumId, {
          language: currentLang === 'zh' ? 'zh' : 'en',
          chapterId,
          userMessage,
          ...(Object.keys(pagePhotoRefs).length > 0 ? { pagePhotoRefs: pagePhotoRefs } : {}),
          focusedPageIndex,
        });
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, res.assistantReply);
        let wroteChapter = false;
        if (res.pagesTexts) {
          wroteChapter = applyChapterWrite(res.pagesTexts);
        }
        if (res.patches.length > 0) {
          applyChapterEdit(
            res.patches.map((e) => ({
              pageIndex: e.pageIndex,
              ...(e.templateId !== undefined ? { templateId: e.templateId } : {}),
              ...(e.images !== undefined ? { imagesJson: e.images } : {}),
              ...(e.texts !== undefined ? { textsJson: e.texts } : {}),
            })),
          );
        }
        if (res.navigation?.pageIndex !== undefined) {
          co()?.goToPageIndex?.(res.navigation.pageIndex);
        }
        chapterHistory.push({ role: 'user', content: userMessage });
        chapterHistory.push({ role: 'assistant', content: res.assistantReply });
        if (res.progressDecision?.chapterDone) {
          await applyEditChatProgressDecision(chapterId);
        }
        if (wroteChapter && !res.progressDecision?.chapterDone) {
          appendSatisfactionCard();
        }
      } catch (e) {
        if (!shouldUseMockEditFallback(e)) {
          if (authErr(host, e)) return;
        } else {
          const res = mockEditChatResponse(userMessage, chapterId, focusedPageIndex);
          settleThinking(host, 'analyzedFeedback');
          appendReplyBody(host, res.assistantReply);
          appendMockToolReceipt(
            host,
            res.pagesTexts?.length
              ? aT('生成本地 mock 文案并同步到当前页', 'Generated local mock copy and synced it to the current page')
              : aT('记录本地 mock 对话回合', 'Recorded a local mock chat turn'),
          );
          let wroteChapter = false;
          if (res.pagesTexts) {
            wroteChapter = applyChapterWrite(res.pagesTexts);
          }
          if (res.navigation?.pageIndex !== undefined) {
            co()?.goToPageIndex?.(res.navigation.pageIndex);
          }
          chapterHistory.push({ role: 'user', content: userMessage });
          chapterHistory.push({ role: 'assistant', content: res.assistantReply });
          if (wroteChapter) appendSatisfactionCard();
        }
      }
      restAwait();
      scrollChat();
      updateAuthInputPlaceholder();
    }

    function chapterMetaById(chapterId: string): { num: number; title: string; tag: string; photoIds: string[] } | null {
      // 优先读活骨架(EditorPort 每次 pages-ready 重取后经 prop 更新):追加照片的新章节
      // 只存在于活骨架里,mount 时捕获的 draftSkel 是旧的。
      const skel = latestAuthoringRef.current.draftChapters ?? draftSkel;
      const idx = skel?.chapters.findIndex((c) => c.chapterId === chapterId) ?? -1;
      if (idx < 0) return null;
      const c = skel!.chapters[idx]!;
      const tag = aT(`第 ${idx + 1} 组`, `Chapter ${idx + 1}`);
      const photoIds = c.photoIds?.length
        ? [...new Set(c.photoIds)]
        : [
            ...new Set(
              (skel?.pages ?? [])
                .filter((p) => p.chapterId === chapterId)
                .flatMap((p) => Object.values(p.imagesJson).filter(Boolean)),
            ),
          ];
      return { num: idx + 1, title: (c.subject && c.subject.trim()) || c.label, tag, photoIds };
    }

    async function captureChapterPagePhotoRefs(chapterId: string): Promise<Record<string, string>> {
      const meta = chapterMetaById(chapterId);
      const refs: Record<string, string> = {};
      if (!meta) return refs;

      await Promise.all(
        meta.photoIds.map(async (photoId) => {
          const thumb = await co()?.capturePhotoThumb?.(photoId);
          if (thumb) refs[photoId] = thumb;
        }),
      );
      return refs;
    }

    const shownChapterCards = shownChapterCardsRef.current;

    function appendChapterCard(chapterId: string) {
      if (chatBody?.querySelector(`[data-chapter-card="${chapterId}"]`)) return;
      shownChapterCards.add(chapterId);
      const meta = chapterMetaById(chapterId);
      if (!meta) return;
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      card.setAttribute('data-chapter-card', chapterId);
      const inner = document.createElement('div');
      inner.className = 'chap-card';
      const thumbs = document.createElement('div');
      thumbs.className = 'cc-thumbs';
      for (const photoId of meta.photoIds.slice(0, 4)) {
        const thumb = document.createElement('div');
        thumb.className = 'cc-thumb';
        const url = imageUrl(photoId);
        if (url) thumb.style.backgroundImage = `url("${url}")`;
        thumbs.appendChild(thumb);
      }
      const foot = document.createElement('div');
      foot.className = 'cc-foot';
      const info = document.createElement('div');
      info.className = 'cc-info';
      const titleRow = document.createElement('div');
      titleRow.className = 'cc-title-row';
      const title = document.createElement('span');
      title.className = 'cc-title';
      title.textContent = meta.title;
      const tag = document.createElement('span');
      tag.className = 'cc-tag';
      tag.textContent = meta.tag;
      titleRow.appendChild(title);
      titleRow.appendChild(tag);
      const metaLine = document.createElement('div');
      metaLine.className = 'cc-meta';
      metaLine.textContent = `${meta.photoIds.length} ${t('photosWord')}`;
      info.appendChild(titleRow);
      info.appendChild(metaLine);
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'cc-view';
      view.setAttribute('aria-label', t('viewLayout'));
      view.innerHTML = `${t('viewLayout')}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
      view.addEventListener('click', () => {
        co()?.goToChapterById?.(chapterId);
      });
      foot.appendChild(info);
      foot.appendChild(view);
      if (thumbs.children.length > 0) inner.appendChild(thumbs);
      inner.appendChild(foot);
      card.appendChild(inner);
      chatBody!.appendChild(card);
      scrollChat();
    }

    const AUTHORED_TEXT_ROLES = new Set(['title', 'body', 'explain']);
    function pageHasWritableTextSlot(templateId: string): boolean {
      const texts = getTemplate(templateId)?.texts ?? [];
      if (texts.some((slot) => AUTHORED_TEXT_ROLES.has(slot.role))) return true;
      const itemTexts = getTemplate(templateId)?.items?.texts ?? [];
      return itemTexts.some((slot) => AUTHORED_TEXT_ROLES.has(slot.role));
    }
    function isPhotoOnlyChapter(chapterId: string): boolean {
      const pages = (latestAuthoringRef.current.draftChapters?.pages ?? draftSkel?.pages ?? []).filter(
        (p) => p.chapterId === chapterId,
      );
      if (pages.length === 0) return false;
      return pages.every((p) => !pageHasWritableTextSlot(p.templateId));
    }

    function currentChapterHasDraftPages(): boolean {
      const cid = storyGate?.currentChapterId;
      if (!cid) return false;
      return (latestAuthoringRef.current.draftChapters?.pages ?? draftSkel?.pages ?? []).some(
        (p) => p.chapterId === cid,
      );
    }

    const chapterSummaryCache = new Map<string, { chapterContext: string }>();
    async function loadChapterSummaryContexts(): Promise<void> {
      if (chapterSummaryCache.size > 0) return;
      try {
        const { chapters } = await fetchChapterSummary(albumId);
        for (const c of chapters) chapterSummaryCache.set(c.chapterId, { chapterContext: c.chapterContext });
      } catch {
        // 采访是可选的:摘要拉取失败就当没采访过(仍会问一次),绝不阻断引导流程。
      }
    }
    async function typeInterviewMessages(messages: readonly [string, string, string]): Promise<boolean> {
      for (let i = 0; i < messages.length; i += 1) {
        if (disposed) return false;
        appendAiText(messages[i]!);
        if (i < messages.length - 1) await new Promise((r) => setTimeout(r, 650));
      }
      return !disposed;
    }
    async function finishInterview(answer: string) {
      if (disposed) return;
      const pending = pendingInterview;
      if (!pending) return;
      pendingInterview = null;
      updateAuthInputPlaceholder();
      const context = buildChapterContext(pending.input, answer);
      const cid = pending.chapterId;
      // 采访的三条气泡(伪装成对话的表单问句)按「显示即存储」的粒度落库:每条问句存成一条
      // 独立 assistant 消息,而非 join 成一条。这样刷新/重进后 loadHistory 逐条渲染,重建出的
      // 历史与实时一模一样(三个气泡 + 回答),而不是塌成一个多行气泡。
      const interviewMsgs: { chapterId: string; role: 'user' | 'assistant'; content: string }[] =
        pending.questions
          .map((q) => q.trim())
          .filter((q) => q.length > 0)
          .map((q) => ({ chapterId: cid, role: 'assistant' as const, content: q }));
      if (answer.trim()) interviewMsgs.push({ chapterId: cid, role: 'user', content: answer.trim() });
      try {
        await postChapterContexts(albumId, [{ chapterId: cid, chapterContext: context }], interviewMsgs);
      } catch {
        // 采访可选:存失败不阻塞,照样往下走。
      }
      if (disposed) return;
      interviewedChapters.add(pending.chapterId);
      chapterSummaryCache.set(pending.chapterId, { chapterContext: context });

      const next = nextUninterviewedChapter();
      if (next) {
        chapterHistory.length = 0;
        co()?.goToChapterById?.(next);
        appendChapterCard(next);
        const meta = chapterMetaById(next);
        await startChapterInterview(next, meta?.photoIds ?? []);
        return;
      }
      await triggerSelectLayout();
    }

    function nextUninterviewedChapter(): string | null {
      const order = storyGate?.chapterOrder ?? [];
      for (const cid of order) {
        if (interviewedChapters.has(cid)) continue;
        if (isPhotoOnlyChapter(cid)) { interviewedChapters.add(cid); continue; }
        return cid;
      }
      return null;
    }

    // 加照片增量重跑(spec §1):追加范围 —— 采访链尽头据此转向增量排版而非全书重排。
    let appendScope: { chapterIds: string[]; photoIds: string[]; prevPageCount: number } | null = null;
    let appendInFlight = false;

    let selectLayoutTriggered = false;
    async function triggerSelectLayout() {
      if (disposed) return;
      if (appendScope) {
        await triggerAppendSelectLayout();
        return;
      }
      if (selectLayoutTriggered) return;
      const recipe = albumRecipe.load(albumId);
      const host = appendThinkingShell();
      if (!recipe?.requestId) {
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, aT('原始照片在本设备上找不到了,没法继续排版。', 'Original photos are no longer available on this device.'));
        return;
      }
      selectLayoutTriggered = true;
      sending = true;
      try {
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, aT('好的,我这就根据你讲的故事,为整本相册排版并写好文案~',
                                 'Great — I’ll now lay out the whole album and write the copy from your stories.'));
        // workflow 进度：一个水母，灰色 label 依次显示两个固定操作（英文即可）。
        const working = appendThinkingShell();
        setThinkingLabel(working, 'Choosing layouts…');
        const refs = await selectLayoutRefsFromStore(recipe.photoIds);
        if (disposed) return;
        setThinkingLabel(working, 'Writing copy from your stories…');
        await submitSelectLayoutV3(albumId, {
          requestId: recipe.requestId,
          language: recipe.language,
          refs,
        });
        if (disposed) return;
        // select-layout runs async on the Agent (inline → completed 直接;two-phase →
        // candidates→judge). Either path lands the finished pages in the server-side
        // draft. Poll it and, once pages appear, fire yujee:authoring-pages-ready so the
        // canvas refreshes IN PLACE (EditorPort refetches; only EditorBook remounts).
        // ChatPanel keeps its state — no full reload, so no re-run/duplication.
        void waitForLayoutThenRefresh(working);
      } catch (e) {
        if (disposed) return;
        selectLayoutTriggered = false;
        if (authErr(host, e)) { sending = false; return; }
        const msg = e instanceof PhotosUnavailableError
          ? aT('原始照片在本设备上找不到了,没法继续排版。', 'Original photos are no longer available on this device.')
          : aT('排版没能开始,稍后再试一下。', 'Couldn’t start layout — please try again in a moment.');
        appendAiText(msg);
      } finally {
        sending = false;
        if (!disposed) {
          restAwait();
          scrollChat();
        }
      }
    }
    // 排版是 Agent 异步跑的,完成的页落进服务端 draft(inline / 两段式都如此)。
    // 轮询 draft,pages 一出现就派发 `yujee:authoring-pages-ready`:EditorPort 收到后重取
    // 草稿,canvas(按 pages.length key)只重挂自己渲染出版面;ChatPanel(按 album.id key)
    // 不重挂,保留对话历史 —— 所以不会像整页 reload 那样重复采访/错乱顺序。以 draft.pages
    // 为准,不依赖具体评委路径。
    async function waitForLayoutThenRefresh(
      host: HTMLElement,
      opts?: { minPages?: number; append?: boolean },
    ) {
      // 兜底封顶:Agent 自身预算 600s,但排版通常 < 1 分钟落地。
      const deadline = Date.now() + 3 * 60 * 1000;
      const minPages = opts?.minPages ?? 1;
      while (!disposed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        if (disposed) return;
        try {
          const { draft } = await fetchDraftSkeleton(albumId);
          if (draft && draft.pages.length >= minPages) {
            if (disposed) return;
            // 收掉「排版中」的 thinking,原地刷画板(不整页 reload)。
            settleThinking(host, 'analyzedFeedback');
            const root = outerRootRef.current;
            root?.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
            window.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
            if (opts?.append) {
              // 追加完成:新章已被服务端记 done,闸门随 allDone 恢复;设计过的书样式已继承。
              appendScope = null;
              appendInFlight = false;
              appendReplyBody(
                host,
                aT('新照片排进书里了,样式跟全书保持一致。想调整就在对话里告诉我。',
                   'The new photos are in — styled to match the rest of the book. Ask me here to tweak anything.'),
              );
              await loadStoryGate();
              maybeAppendExportReadyCard();
            } else {
              appendReplyBody(
                host,
                aT('排版完成了，我已经把画板刷新出来。', 'Layout is ready — I refreshed the canvas.'),
              );
              // 设计环节 phase 0:排版落地后立刻给封面组选择卡(用户选定 = 设计触发时机)。
              void offerDesignCard();
            }
            return;
          }
        } catch (e) {
          if (e instanceof UnauthorizedError) return; // 会话没了:停轮询,下一次用户操作会跳登录
          // 其它瞬时错误:继续轮询到封顶,不把错误灌进对话
        }
      }
      if (!disposed) {
        if (opts?.append) {
          appendScope = null;
          appendInFlight = false;
        }
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(
          host,
          aT('排版好像慢了点,刷新一下页面看看结果。', 'Layout is taking a while — refresh the page to see the result.'),
        );
      }
    }

    // ── 加照片增量重跑(spec §1):压缩入库 → add-photos 提交 → 等新章节 → 采访 → 增量排版 ──

    async function triggerAppendSelectLayout() {
      if (disposed || !appendScope) return;
      const scope = appendScope;
      const host = appendThinkingShell();
      setThinkingLabel(host, 'Laying out the new photos…');
      sending = true;
      try {
        const refs = await selectLayoutRefsFromStore(scope.photoIds);
        if (disposed) return;
        await submitSelectLayoutV3(albumId, {
          requestId: albumRecipe.load(albumId)?.requestId ?? crypto.randomUUID(),
          language: currentLang === 'zh' ? 'zh' : 'en',
          refs,
          chapterIds: scope.chapterIds,
        });
        if (disposed) return;
        void waitForLayoutThenRefresh(host, { minPages: scope.prevPageCount + 1, append: true });
      } catch (e) {
        if (disposed) return;
        appendScope = null;
        appendInFlight = false;
        if (authErr(host, e)) { sending = false; return; }
        appendAiText(e instanceof PhotosUnavailableError
          ? aT('新照片在本设备上找不到了,没法排版。', 'The new photos are no longer available on this device.')
          : aT('新照片排版没能开始,稍后再试一下。', "Couldn't start laying out the new photos — try again in a moment."));
      } finally {
        sending = false;
        if (!disposed) { restAwait(); scrollChat(); }
      }
    }

    // 轮询 story-progress 等追加的新章节出现(analyze 合并完成),随后走既有采访链;
    // 采访链尽头 finishInterview→triggerSelectLayout,由 appendScope 转向增量排版。
    async function waitForAppendChapters(prevOrder: string[], photoIds: string[], prevPageCount: number, host: HTMLElement) {
      const known = new Set(prevOrder);
      const deadline = Date.now() + 3 * 60 * 1000;
      while (!disposed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        if (disposed) return;
        await loadStoryGate();
        const fresh = (storyGate?.chapterOrder ?? []).filter((id) => !known.has(id));
        if (fresh.length === 0) continue;

        appendScope = { chapterIds: fresh, photoIds, prevPageCount };
        // 旧章节一律视为已采访(页面刷新后重进时 in-memory 集合是空的,不补标会把
        // 老章节重新采访一遍)。追加只采访 fresh 里的新章。
        for (const cid of storyGate?.chapterOrder ?? []) {
          if (!fresh.includes(cid)) interviewedChapters.add(cid);
        }
        settleThinking(host, 'analyzedFeedback');
        // 刷活骨架:EditorPort 重取草稿(新章节 photoIds/新照片 objectUrl),章节卡才有料。
        window.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
        await new Promise((r) => setTimeout(r, 600));
        if (disposed) return;

        const first = fresh.find((cid) => !interviewedChapters.has(cid) && !isPhotoOnlyChapter(cid)) ?? null;
        if (first) {
          chapterHistory.length = 0;
          co()?.goToChapterById?.(first);
          appendChapterCard(first);
          const meta = chapterMetaById(first);
          await startChapterInterview(first, meta?.photoIds ?? photoIds);
        } else {
          // 没有可采访的新章(photo-only 等):直接进增量排版。
          fresh.forEach((cid) => interviewedChapters.add(cid));
          await triggerSelectLayout();
        }
        return;
      }
      if (!disposed) {
        appendInFlight = false;
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, aT('新照片处理超时了,请刷新页面再试一次。', 'Processing the new photos timed out — refresh and try again.'));
      }
    }

    async function handleAddPhotos(files: File[]) {
      if (!files.length || appendInFlight || disposed) return;
      appendInFlight = true;
      const prevOrder = storyGate?.chapterOrder ?? [];
      const prevPageCount = co()?.getPagesState?.()?.length ?? 0;
      const taking = files.slice(0, MAX_PHOTOS_PER_GENERATION);
      appendUserText(aT(`添加了 ${taking.length} 张照片`, `Added ${taking.length} photo${taking.length > 1 ? 's' : ''}`));
      hideAwait();
      scrollChat();
      const host = appendThinkingShell();
      setThinkingLabel(host, 'Understanding new photos…');
      try {
        // 压缩 + 原图入 IndexedDB(HeroComposer.onFiles 同款链路;原图绝不上服务器)。
        const compressed: CompressedPhoto[] = [];
        for (const file of taking) {
          const photoId = crypto.randomUUID();
          compressed.push(await compressFile(file, photoId));
          await photoStore.put(photoId, file);
        }
        const photos = clusterCompressedPhotos(compressed);
        const newPhotoIds = photos.map((p) => p.photoId);
        await submitAddPhotosV3(albumId, {
          requestId: crypto.randomUUID(),
          language: currentLang === 'zh' ? 'zh' : 'en',
          photos,
        });
        // recipe 追加新 photoIds:排版 refs/重试都从 IndexedDB 按这份清单重建。
        const recipe = albumRecipe.load(albumId);
        if (recipe) albumRecipe.save(albumId, { ...recipe, photoIds: [...recipe.photoIds, ...newPhotoIds] });
        appendReplyBody(host, aT('收到!我先看看这些新照片,然后问你几个问题,再把它们排进书里。',
          'Got them! Let me study the new photos, ask you a couple of questions, then lay them into the book.'));
        void waitForAppendChapters(prevOrder, newPhotoIds, prevPageCount, host);
      } catch (e) {
        appendInFlight = false;
        settleThinking(host, 'analyzedFeedback');
        if (!authErr(host, e)) {
          appendAiText(aT('照片没能加进来,稍后再试一下。', "Couldn't add the photos — please try again in a moment."));
        }
        restAwait();
        scrollChat();
      }
    }
    // 设计环节:封面组选择卡。规则组(服务端 GET)→ 用户点选一组 → POST /design
    // (engine 出字体/颜色/封面封尾文案,Web 落 draft)→ 刷画板。幂等:已设计过不再弹。
    let designOfferShown = false;
    async function offerDesignCard() {
      if (disposed || designOfferShown) return;
      let sets: Array<{ coverTemplateId: string; coverPhotoId: string; endingTemplateId: string; endingPhotoId: string }> = [];
      try {
        const res = await fetch(`/api/v3/albums/${albumId}/design`);
        const json = await res.json();
        if (!json.ok) return;
        if (json.data.designed || !json.data.hasPages) return;
        sets = json.data.sets ?? [];
      } catch {
        return; // 拿不到选项就静默不弹,不打断编辑
      }
      if (disposed || sets.length === 0) return;
      designOfferShown = true;

      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'cover-card';
      const title = document.createElement('div');
      title.className = 'cv-title';
      title.textContent = aT('最后一步:挑一组封面吧(含封底)', 'Last step: pick a cover set (with back cover)');
      inner.appendChild(title);

      let selected = 0;
      const row = document.createElement('div');
      row.className = 'cv-row';
      const opts: HTMLButtonElement[] = [];
      const repaint = () => {
        opts.forEach((opt, i) => {
          const set = sets[i];
          opt.innerHTML =
            (co()?.coverOptionHTML?.(set.coverTemplateId, set.coverPhotoId) ?? '');
          opt.classList.toggle('selected', i === selected);
        });
      };
      sets.forEach((_, i) => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'cv-opt';
        opt.addEventListener('click', () => {
          selected = i;
          repaint();
        });
        opts.push(opt);
        row.appendChild(opt);
      });
      inner.appendChild(row);
      const hint = document.createElement('div');
      hint.className = 'cv-sublabel';
      hint.textContent = aT('选定后我会为全书定字体和颜色,并写好封面封底文案。', 'I will then set fonts & colors for the whole book and write the cover copy.');
      inner.appendChild(hint);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'cv-actions';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'cv-action cv-action-primary';
      applyBtn.textContent = aT('就这组,开始设计', 'Use this set — design it');
      applyBtn.addEventListener('click', () => {
        if (sending) return;
        void runApplyDesign(sets[selected], card);
      });
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'cv-action cv-action-ghost';
      skipBtn.textContent = aT('先跳过', 'Skip for now');
      skipBtn.addEventListener('click', () => {
        card.remove();
        appendAiText(aT('好,先不做封面。想做的时候跟我说"设计封面"。', 'OK, skipping the cover for now — just say "design the cover" whenever.'));
      });
      actionsRow.appendChild(skipBtn);
      actionsRow.appendChild(applyBtn);
      inner.appendChild(actionsRow);
      card.appendChild(inner);
      chatBody!.appendChild(card);
      repaint();
      scrollChat();
    }

    async function runApplyDesign(
      set: { coverTemplateId: string; coverPhotoId: string; endingTemplateId: string; endingPhotoId: string },
      card: HTMLElement,
    ) {
      sending = true;
      card.remove();
      appendUserText(aT('就用这组封面', 'Use this cover set'));
      const host = appendThinkingShell();
      setThinkingLabel(host, 'Designing fonts, colors & cover…');
      try {
        const res = await fetch(`/api/v3/albums/${albumId}/design`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: currentLang === 'zh' ? 'zh' : 'en', ...set }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'design failed');
        settleThinking(host, 'analyzedFeedback');
        const root = outerRootRef.current;
        root?.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
        window.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
        appendReplyBody(
          host,
          aT('设计好了:封面封底就位,全书字体和配色也统一刷好了。不满意随时在对话里改。', 'Design done — cover & back cover are in, fonts and colors applied across the book. Ask me here to tweak anything.'),
        );
        // 设计完成 = stage 已推进到 ready:同步前端闸门(顶栏导出按钮),并弹导出就绪卡。
        await loadStoryGate();
        maybeAppendExportReadyCard();
      } catch (e) {
        settleThinking(host, 'analyzedFeedback');
        if (e instanceof UnauthorizedError) return;
        appendReplyBody(host, aT('设计这步没跑成,稍后再试一下。', 'The design step failed — try again in a moment.'));
        designOfferShown = false;
        void offerDesignCard();
      } finally {
        sending = false;
        if (!disposed) { restAwait(); scrollChat(); }
      }
    }

    async function startChapterInterview(chapterId: string, photoIds: string[]) {
      if (disposed) return;
      let input: ChapterInterviewInput = { earliestTakenAt: null, latestTakenAt: null, place: null };
      try {
        const data = await interviewDataFromStore(photoIds);
        const [built] = buildChapterInterviews(
          [{ chapterId, label: '', photoIds }],
          data.photoToCluster,
          data.prefills,
        );
        if (built) input = built.input;
      } catch {
        // 原图取不到 / 计算失败 => 空输入(neither,全问),不阻断。
      }
      const messages = interviewMessages(
        classifyInterviewCase(input),
        currentLang === 'zh' ? 'zh' : 'en',
      );
      if (disposed) return;
      pendingInterview = { chapterId, input, questions: messages };
      if (!(await typeInterviewMessages(messages))) return;
      if (disposed || pendingInterview?.chapterId !== chapterId) return;
      const skipRow = document.createElement('div');
      skipRow.className = 'msg ai max-w-full';
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'interview-skip';
      skipBtn.textContent = t('interviewSkip');
      skipBtn.addEventListener('click', () => {
        if (!pendingInterview || pendingInterview.chapterId !== chapterId) return;
        skipBtn.disabled = true;
        void finishInterview('');
      });
      skipRow.appendChild(skipBtn);
      chatBody!.appendChild(skipRow);
      updateAuthInputPlaceholder();
      restAwait();
      scrollChat();
    }

    async function runChapterGuideOpener(opts?: { allowDuringSend?: boolean }) {
      if (disposed) return;
      if (!isAuthoring || (!opts?.allowDuringSend && sending) || awaitingSatisfaction) return;
      if (pendingInterview) return;
      if (interviewChainStartedRef.current) return;
      interviewChainStartedRef.current = true;
      await loadChapterSummaryContexts();
      if (disposed) return;
      const order = storyGate?.chapterOrder ?? [];
      for (const cid of order) {
        if (interviewedChapters.has(cid)) continue;
        if ((chapterSummaryCache.get(cid)?.chapterContext.trim().length ?? 0) > 0) {
          interviewedChapters.add(cid);
          continue;
        }
        if (isPhotoOnlyChapter(cid)) { interviewedChapters.add(cid); continue; }
      }
      const first = nextUninterviewedChapter();
      if (!first) { interviewChainStartedRef.current = false; return; }
      guidedChapters.add(first);
      chapterHistory.length = 0;
      co()?.goToChapterById?.(first);
      appendChapterCard(first);
      const meta = chapterMetaById(first);
      await startChapterInterview(first, meta?.photoIds ?? []);
    }
    void openerInFlight;

    function appendSatisfactionCard(opts?: { photoOnly?: boolean }) {
      awaitingSatisfaction = true;
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'satisfaction-card';
      const title = document.createElement('div');
      title.className = 'sc-title';
      title.textContent = opts?.photoOnly
        ? aT('这一组只有照片,准备好进入下一组了吗?',
             'This chapter is photo-only — ready for the next one?')
        : aT('这一组写好了,你满意吗?', "Here's this chapter — happy with it?");
      const row = document.createElement('div');
      row.className = 'sc-actions';

      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'sc-btn sc-yes';
      yes.textContent = aT('满意,下一组', 'Looks great');
      yes.addEventListener('click', () => {
        if (sending || confirmingStoryChapter) return;
        row.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
        awaitingSatisfaction = false;
        appendUserText(aT('满意,继续下一组', 'Looks great — next chapter'));
        scrollChat();
        void confirmCurrentChapterViaEditChat();
      });

      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'sc-btn sc-no';
      no.textContent = aT('想改改', 'Tweak it');
      no.addEventListener('click', () => {
        if (sending) return;
        row.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
        awaitingSatisfaction = false;
        appendUserText(aT('还想再改改', "I'd like to tweak it"));
        appendAiText(
          aT('好的,这一组先留着。哪里不太满意?点开那一页,告诉我想怎么改。',
             "Sure — let's keep this chapter. What's not quite right? Tap the page you mean and tell me what to change."),
        );
        restAwait();
        scrollChat();
      });

      row.appendChild(yes);
      row.appendChild(no);
      inner.appendChild(title);
      inner.appendChild(row);
      card.appendChild(inner);
      chatBody!.appendChild(card);
      scrollChat();
    }

    function appendEditLoopReadyCard(chapterId: string) {
      if (!isAuthoring || latestAuthoringRef.current.mode !== 'authoring') return;
      if (awaitingSatisfaction || pendingInterview || confirmingStoryChapter) return;
      if (!storyGate || storyGate.stage !== 'story') return;
      if (storyGate.doneChapterIds.includes(chapterId)) return;
      if (!currentChapterHasDraftPages()) return;
      if (chatBody?.querySelector(`[data-edit-loop-ready="${chapterId}"]`)) return;
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      card.setAttribute('data-edit-loop-ready', chapterId);
      const body = document.createElement('div');
      body.className = 'ai-text edit-loop-ready';
      body.textContent = aT(
        '排版完成了。现在直接告诉我这一组哪里要改；如果满意，说“可以了”就会继续下一步。',
        'The layout is ready. Tell me what to change in this chapter, or say “looks good” to continue.',
      );
      card.appendChild(body);
      chatBody!.appendChild(card);
      restAwait();
      scrollChat();
    }

    function appendNameChips(host: HTMLElement, names: string[]) {
      const row = document.createElement('div');
      row.className = 'chips';
      for (const name of names.slice(0, 4)) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip-select';
        chip.textContent = name;
        chip.addEventListener('click', () => {
          if (sending) return;
          sending = true;
          row.querySelectorAll('.chip-select').forEach((c) => c.classList.remove('selected'));
          chip.classList.add('selected');
          appendUserText(aT(`就用「${name}」`, `Use "${name}"`));
          hideAwait();
          scrollChat();
          void runEditChatTurn(aT(`这一组就叫「${name}」`, `Name this chapter "${name}"`))
            .finally(() => { sending = false; });
        });
        row.appendChild(chip);
      }
      host.appendChild(row);
    }
    void appendNameChips;

    function showPurchaseCard() {
      const card = byId('balanceAlert');
      if (card) {
        card.style.display = '';
        chatBody!.appendChild(card);
      } else {
        appendAiText(aT('积分不足，去充值后即可继续。', 'Out of credits — top up to keep creating.'));
      }
      scrollChat();
    }

    function updateAuthInputPlaceholder() {
      if (!input) return;
      input.setAttribute('placeholder', '');
    }

    async function runEdit(_message: string) {
      appendAiText(
        aT(
          '旧版聊天改稿已下线，不会再改动当前版面。请继续使用 V3 流程：确认分组故事、选择主题与封面，然后导出 PDF。',
          'Legacy chat editing has been retired and will no longer change this layout. Continue with the V3 flow: confirm chapter stories, choose the theme and cover, then export the PDF.',
        ),
      );
      restAwait();
      scrollChat();
    }

    // ── chat send / input wiring ──
    sendBtnEl?.addEventListener('click', send);
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };
    const onInput = () => {
      if (!input) return;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    };
    input?.addEventListener('keydown', onKeydown);
    input?.addEventListener('input', onInput);

    // 中途加图:隐藏 picker 的 change → 增量追加链路(压缩入库→提交→采访→排版)。
    const addPhotoInputEl = byId('addPhotoInput') as HTMLInputElement | null;
    const onAddPhotosChange = () => {
      const files = Array.from(addPhotoInputEl?.files ?? []);
      if (addPhotoInputEl) addPhotoInputEl.value = '';
      void handleAddPhotos(files);
    };
    addPhotoInputEl?.addEventListener('change', onAddPhotosChange);

    // ── data-action handlers within ChatPanel's OWN subtree only (the aside). The
    // canvas/topbar/modals bind their own data-action nodes in EditorBook, so we scope
    // the sweep to the chat column to avoid double-binding. ──
    const asideRoot = root.querySelector('.pane-chat-col') as HTMLElement | null;
    const actions: Record<string, () => void> = {
      buyShells: () => { window.location.href = `/${locale}/credits`; },
      // 中途加图(spec §1):排版完成后可用;采访/发送/追加进行中不响应。
      pickAddPhotos: () => {
        if (!isAuthoring || sending || appendInFlight || pendingInterview) return;
        if ((co()?.getPagesState?.()?.length ?? 0) === 0) {
          appendAiText(aT('先等这本书排版完成,再来添加照片哦。', 'Please wait until the book is laid out before adding photos.'));
          restAwait();
          scrollChat();
          return;
        }
        (byId('addPhotoInput') as HTMLInputElement | null)?.click();
      },
      toggleChat: () => root.classList.toggle('chat-collapsed'),
    };
    const actionHandlers: { el: Element; fn: EventListener }[] = [];
    if (asideRoot) {
      asideRoot.querySelectorAll('[data-action]').forEach((el) => {
        const name = el.getAttribute('data-action')!;
        // Only bind the aside-owned actions here; anything else is EditorBook's.
        if (!(name in actions)) return;
        const fn = (e: Event) => {
          e.stopPropagation();
          actions[name]?.();
        };
        el.addEventListener('click', fn);
        actionHandlers.push({ el, fn });
      });
    }
    function bindChatMotion() {
      const rootEl = root;
      if (!rootEl) return () => {};
      const chatCol = rootEl.querySelector('.pane-chat-col') as HTMLElement | null;
      const dragHandle = byId('chatDrag');
      const resizeHandle = byId('chatResize');
      if (!chatCol || !dragHandle || !resizeHandle) return () => {};
      const chatColEl = chatCol;
      const dragHandleEl = dragHandle;
      const resizeHandleEl = resizeHandle;

      const desktop = () => window.matchMedia('(min-width: 768px)').matches;
      const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
      const margin = 14;
      let activeCleanup: Array<() => void> = [];

      function clearActiveMotion() {
        activeCleanup.forEach((fn) => fn());
        activeCleanup = [];
        document.body.classList.remove('chat-dragging');
      }

      function freezeRect(rect = chatColEl.getBoundingClientRect()) {
        chatColEl.style.left = `${rect.left}px`;
        chatColEl.style.top = `${rect.top}px`;
        chatColEl.style.width = `${rect.width}px`;
        chatColEl.style.height = `${rect.height}px`;
        chatColEl.style.right = 'auto';
        chatColEl.style.bottom = 'auto';
      }

      function resetChatPos() {
        clearActiveMotion();
        chatColEl.style.removeProperty('left');
        chatColEl.style.removeProperty('top');
        chatColEl.style.removeProperty('right');
        chatColEl.style.removeProperty('bottom');
        chatColEl.style.removeProperty('width');
        chatColEl.style.removeProperty('height');
      }

      function resetForViewport() {
        if (!desktop()) resetChatPos();
      }

      function bindWindowMove(move: (e: PointerEvent) => void, end: (e: PointerEvent) => void) {
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        activeCleanup.push(() => window.removeEventListener('pointermove', move));
        activeCleanup.push(() => window.removeEventListener('pointerup', end));
        activeCleanup.push(() => window.removeEventListener('pointercancel', end));
      }

      const onDragDown = (e: PointerEvent) => {
        if (!desktop() || e.button !== 0) return;
        if ((e.target as HTMLElement | null)?.closest('[data-action], button, a, input, textarea, select')) return;
        e.preventDefault();
        clearActiveMotion();
        const start = chatColEl.getBoundingClientRect();
        freezeRect(start);
        const offsetX = e.clientX - start.left;
        const offsetY = e.clientY - start.top;
        document.body.classList.add('chat-dragging');
        dragHandleEl.setPointerCapture?.(e.pointerId);

        const move = (ev: PointerEvent) => {
          const maxLeft = window.innerWidth - start.width - margin;
          const maxTop = window.innerHeight - start.height - margin;
          chatColEl.style.left = `${clamp(ev.clientX - offsetX, margin, maxLeft)}px`;
          chatColEl.style.top = `${clamp(ev.clientY - offsetY, 64, maxTop)}px`;
        };
        const end = (ev: PointerEvent) => {
          dragHandleEl.releasePointerCapture?.(ev.pointerId);
          clearActiveMotion();
        };
        bindWindowMove(move, end);
      };

      const onResizeDown = (e: PointerEvent) => {
        if (!desktop() || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        clearActiveMotion();
        const start = chatColEl.getBoundingClientRect();
        freezeRect(start);
        document.body.classList.add('chat-dragging');
        resizeHandleEl.setPointerCapture?.(e.pointerId);

        const move = (ev: PointerEvent) => {
          const maxWidth = window.innerWidth - start.left - margin;
          const maxHeight = window.innerHeight - start.top - margin;
          chatColEl.style.width = `${clamp(start.width + ev.clientX - e.clientX, 308, maxWidth)}px`;
          chatColEl.style.height = `${clamp(start.height + ev.clientY - e.clientY, 320, maxHeight)}px`;
        };
        const end = (ev: PointerEvent) => {
          resizeHandleEl.releasePointerCapture?.(ev.pointerId);
          clearActiveMotion();
        };
        bindWindowMove(move, end);
      };

      dragHandleEl.addEventListener('pointerdown', onDragDown);
      dragHandleEl.addEventListener('dblclick', resetChatPos);
      resizeHandleEl.addEventListener('pointerdown', onResizeDown);
      window.addEventListener('resize', resetForViewport);
      resetForViewport();

      return () => {
        clearActiveMotion();
        dragHandleEl.removeEventListener('pointerdown', onDragDown);
        dragHandleEl.removeEventListener('dblclick', resetChatPos);
        resizeHandleEl.removeEventListener('pointerdown', onResizeDown);
        window.removeEventListener('resize', resetForViewport);
      };
    }

    const cleanupChatMotion = bindChatMotion();

    const onAuthoringPagesReady = () => {
      void (async () => {
        await loadStoryGate();
        const currentChapterId = storyGate?.currentChapterId ?? null;
        if (currentChapterId) appendEditLoopReadyCard(currentChapterId);
      })();
    };
    root.addEventListener('yujee:authoring-pages-ready', onAuthoringPagesReady);

    if (isAuthoring) {
      hideAwait();
    }
    else {
      restAwait();
      // 先 loadStoryGate 再 loadHistory:历史重建要补插章节卡片(appendChapterCard 依赖
      // chapterMetaById→storyGate/draftSkel);storyGate 未就绪时卡片会插不出来。
      void loadStoryGate().then(() => loadHistory()).then((shown) => {
        restAwait();
      });
    }

    if (isAuthoring) {
      $('.authoring-finish-bar')?.remove();
      setChatState(3);
      updateAuthInputPlaceholder();
      void loadStoryGate().then(() => loadHistory()).then((shown) => {
        restAwait();
        const liveChapterId = storyGate?.currentChapterId ?? null;
        if (liveChapterId) co()?.goToChapterById?.(liveChapterId);
        const stage = storyGate?.stage;
        if (liveChapterId) {
          appendChapterCard(liveChapterId);
          if (currentChapterHasDraftPages()) {
            appendEditLoopReadyCard(liveChapterId);
          } else if (shown === 0) {
            void runChapterGuideOpener();
          }
        } else if (stage === 'theme' || stage === 'cover' || stage === 'ready') {
          if (stage === 'theme') {
            void runRecommendTheme();
          } else if (stage === 'cover') {
            appendThemeSummary();
            appendCoverCard();
          } else {
            appendThemeSummary();
            appendCoverSummary();
          }
        }
        maybeAppendExportReadyCard();
      });
    }

    // Keep the buy-credits card (#balanceAlert) hidden on entry.
    const balanceAlert = byId('balanceAlert');
    if (balanceAlert) balanceAlert.style.display = 'none';

    // Stepper: editing (finalized album) has no creation flow — hide it. Authoring is
    // driven by the opener block above; don't override.
    if (!isAuthoring) {
      const stepperEl = byId('stateStepper');
      if (stepperEl) stepperEl.style.display = 'none';
    }

    return () => {
      disposed = true;
      sendBtnEl?.removeEventListener('click', send);
      input?.removeEventListener('keydown', onKeydown);
      input?.removeEventListener('input', onInput);
      addPhotoInputEl?.removeEventListener('change', onAddPhotosChange);
      actionHandlers.forEach(({ el, fn }) => el.removeEventListener('click', fn));
      cleanupChatMotion();
      root.removeEventListener('yujee:authoring-pages-ready', onAuthoringPagesReady);
      guidedChaptersRef.current.clear();
      interviewedChaptersRef.current.clear();
      shownChapterCardsRef.current.clear();
      interviewChainStartedRef.current = false;
      recommendInFlightRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== 'authoring') return;
    const root = outerRootRef.current;
    if (!root) return;
    root.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
    window.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
  }, [
    mode,
    outerRootRef,
    draftChapters?.pages.length,
    storyProgress?.stage,
    storyProgress?.currentChapterId,
    storyProgress?.doneChapterIds.join('|'),
  ]);

  return (
    <div className="pane-chat-col md:order-1 md:w-[360px] shrink-0 md:flex">
      <aside className="pane pane-right chat-card relative flex flex-col overflow-hidden bg-surface md:flex-1">
        <div className="chat-drag hidden md:flex items-center gap-2 px-3.5 h-11 border-b border-bdsoft flex-shrink-0" id="chatDrag">
          <span className="chat-grip"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></svg></span>
          <span className="text-[13px] font-semibold text-fg2">{locale === 'zh' ? '对话' : 'Chat'}</span>
          <button type="button" className="chat-fold-btn chat-fold-collapse ml-auto" data-action="toggleChat" data-i18n-title="collapseChat" title="折叠对话" aria-label="折叠对话">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </div>
        <div className="chat-mobile-handle md:hidden flex flex-shrink-0 items-center justify-center pt-2.5 pb-1.5">
          <span className="block w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        <div className="chat-body flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-6" id="chatBody" style={{ gap: '24px' }}>
          <div className="await-user" id="awaitUser">
            <img className="await-jelly" src="/jellyfish-icon.png" alt="" style={{ width: '40px', height: '40px' }} />
            <span className="await-label" data-i18n="awaitUser">{locale === 'zh' ? '在听，随时和我说～' : "I'm listening - talk to me anytime"}</span>
          </div>
        </div>

        <div className="composer-group shrink-0">
          <div className="buy-banner" id="balanceAlert">
            <div className="buy-banner-row">
              <div className="buy-banner-title flex-1 min-w-0" data-i18n="bpLead">{locale === 'zh' ? '积分已用完，补充积分继续' : 'Out of credits. Top up to continue.'}</div>
              <button className="buy-banner-btn" data-action="buyShells" data-i18n="bpBuy">{locale === 'zh' ? '去购买' : 'Buy'}</button>
              <button className="buy-close" type="button" onClick={(e) => (e.currentTarget.closest('#balanceAlert') as HTMLElement | null)?.style.setProperty('display', 'none')} aria-label={locale === 'zh' ? '关闭' : 'Close'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>
          <div className="chat-input shrink-0 bg-surface border border-bdsoft flex flex-col transition-all" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <textarea className="w-full outline-none resize-none bg-transparent text-fg text-[13.5px] leading-relaxed border-none px-4 pt-3.5 pb-1 disabled:cursor-not-allowed" style={{ fontFamily: 'var(--font-body)' }} placeholder="" rows={1} id="msgInput" />
            <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-0.5">
              <button className="add-ch-btn w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted" data-action="pickAddPhotos" data-i18n-title="addPhoto" title="添加图片" aria-label="添加图片">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              {/* 中途加图(W11):"+" 打开这个隐藏 picker;accept 用共享的 HEIC-aware 串,和主上传口
                  一致(#284)。加图流程本身在 V3 上仍是占位(见 pickAddPhotos),但选择器格式要对。 */}
              <input type="file" id="addPhotoInput" accept={IMAGE_INPUT_ACCEPT} multiple className="hidden" />
              <span className="flex-1" />
              <span className="btn-glow btn-glow-round shrink-0">
                <button className="send-btn w-8 h-8 rounded-full bg-fg text-white flex items-center justify-center cursor-pointer transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }} id="sendBtn" data-i18n-title="send" title="发送">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[17px] h-[17px]"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
                </button>
              </span>
            </div>
          </div>
        </div>
        <div className="chat-resize" id="chatResize" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15 15 21M21 9 9 21" /></svg>
        </div>
      </aside>
    </div>
  );
}
