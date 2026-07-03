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
  V3PageTextsPatch,
  V3RecommendResponse,
  V3ChapterThemeChoice,
} from '@yujee/contracts';
import { getTemplate, TEMPLATE_IDS } from '@yujee/contracts/templates';
import {
  UnauthorizedError,
  CreditInsufficientError,
  interviewDataFromStore,
  selectLayoutRefsFromStore,
  submitSelectLayoutV3,
  PhotosUnavailableError,
} from '@/lib/generation/client';
import { albumRecipe } from '@/lib/generation/draft';
import { fetchChapterSummary, postChapterContexts } from '@/lib/album/authoring-client';
import {
  buildChapterInterviews,
  buildChapterContext,
  classifyInterviewCase,
  interviewMessages,
  type ChapterInterviewInput,
} from '@/lib/interview/interview';
import { StageBreadcrumb } from './StageBreadcrumb';

const CONFIRM_CHAPTER_COMMAND = '[confirm-chapter]';

export type ChatMode = 'authoring' | 'editing';

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
        await runEditChatTurn(txt);
      } else {
        await runEdit(txt);
      }
      sending = false;
    }

    function appendAiText(text: string) {
      const a = document.createElement('div');
      a.className = 'msg ai max-w-full';
      const body = document.createElement('div');
      body.className = 'ai-text';
      body.textContent = text;
      a.appendChild(body);
      const time = document.createElement('div');
      time.className = 'name-time';
      time.textContent = t('justNow');
      a.appendChild(time);
      chatBody!.appendChild(a);
      scrollChat();
    }
    function appendUserText(text: string) {
      const u = document.createElement('div');
      u.className = 'msg user max-w-full';
      u.innerHTML = `<div class="bubble"></div>`;
      u.querySelector('.bubble')!.textContent = text;
      chatBody!.appendChild(u);
    }
    async function loadHistory(): Promise<number> {
      try {
        const res = await fetch(`/api/v1/albums/${albumId}/messages?limit=50`);
        const j = await res.json();
        if (!j?.ok) return 0;
        const msgs = (j.data?.messages ?? []) as Array<{
          role: string;
          content: string;
          chapterId?: string | null;
          createdAt?: string;
        }>;
        msgs.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
        chapterHistory.splice(0, chapterHistory.length);
        let shown = 0;
        let lastCardChapterId: string | null = null;
        for (const m of msgs) {
          const c = (m.content ?? '').trim();
          if (!c || c.startsWith('[inspection of page')) continue;
          // 章节卡片也是对话历史的一部分:采访时每章开头先出卡片(缩略图+查看详细)再出问句气泡。
          // 卡片不单独存库(能从 chapterId 经 chapterMetaById 完全重建),所以重建历史时,在该章
          // 第一条消息之前补插一次卡片,还原「卡片→问1→问2→问3→答」的原始顺序。appendChapterCard
          // 自身按 data-chapter-card 幂等,重复调用安全。
          if (m.chapterId && m.chapterId !== lastCardChapterId) {
            appendChapterCard(m.chapterId);
            lastCardChapterId = m.chapterId;
          }
          if (m.role === 'user') {
            appendUserText(c);
            if (!m.chapterId || !storyGate?.currentChapterId || m.chapterId === storyGate.currentChapterId) {
              chapterHistory.push({ role: 'user', content: c });
            }
          } else {
            appendAiText(c);
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
    function appendReplyBody(host: HTMLElement, reply: string): HTMLElement {
      const body = document.createElement('div');
      body.className = 'ai-text';
      body.textContent = reply;
      host.appendChild(body);
      return body;
    }
    function appendTime(host: HTMLElement) {
      const time = document.createElement('div');
      time.className = 'name-time';
      time.textContent = t('justNow');
      host.appendChild(time);
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
            : aT('确定章节失败，请重试。', 'Could not confirm the chapter. Please try again.'),
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
        appendTime(host);
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
      title.textContent = aT('已应用的主题 · 各章标题', 'Applied theme · chapter titles');
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
        appendTime(host);
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
        appendTime(host);
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
        appendTime(host);
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
      if (applied) appendStep(aT('✏️ 已为本章写好文案。', '✏️ Wrote this chapter’s copy.'));
      return applied;
    }

    function applyChapterEdit(layoutPatch: LayoutPatchEntry[]): boolean {
      const applied = co()?.applyChapterEdit?.(layoutPatch) ?? false;
      if (applied) appendStep(aT('🛠️ 已更新这一页的排版。', '🛠️ Updated this page’s layout.'));
      return applied;
    }

    async function runEditChatTurn(message: string) {
      const host = appendThinkingShell();
      const chapterId = storyGate?.currentChapterId ?? null;
      if (!chapterId) {
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(
          host,
          aT('这一章已经确定了——你可以继续下一步，或者从左侧选另一章来调整。',
             "This chapter is already confirmed — move on, or pick another chapter on the left to tweak."),
        );
        appendTime(host);
        restAwait();
        scrollChat();
        return;
      }
      const userMessage = message.slice(0, MESSAGE_MAX);
      try {
        const pagePhotoRefs = await captureChapterPagePhotoRefs(chapterId);
        const focusedPageIndex = authoringFocusPageIndex();
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
        appendTime(host);
        chapterHistory.push({ role: 'user', content: userMessage });
        chapterHistory.push({ role: 'assistant', content: res.assistantReply });
        if (res.progressDecision?.chapterDone) {
          await applyEditChatProgressDecision(chapterId);
        }
        if (wroteChapter && !res.progressDecision?.chapterDone) {
          appendSatisfactionCard();
        }
      } catch (e) {
        if (authErr(host, e)) return;
      }
      restAwait();
      scrollChat();
      updateAuthInputPlaceholder();
    }

    function chapterMetaById(chapterId: string): { num: number; title: string; tag: string; photoIds: string[] } | null {
      const idx = draftSkel?.chapters.findIndex((c) => c.chapterId === chapterId) ?? -1;
      if (idx < 0) return null;
      const c = draftSkel!.chapters[idx]!;
      const tag =
        c.role === 'opening'
          ? aT('开篇', 'Opening')
          : c.role === 'closing'
            ? aT('收尾', 'Closing')
            : aT('章节', 'Chapter');
      const photoIds = c.photoIds?.length
        ? [...new Set(c.photoIds)]
        : [
            ...new Set(
              (draftSkel?.pages ?? [])
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

    function openChapterPhotosOverlay(photoIds: string[]) {
      const ov = document.createElement('div');
      ov.className = 'chapter-photos-overlay';
      const sheet = document.createElement('div');
      sheet.className = 'cpo-sheet';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'cpo-close';
      close.setAttribute('aria-label', t('interviewClose'));
      close.textContent = '✕';
      const grid = document.createElement('div');
      grid.className = 'cpo-grid';
      for (const photoId of photoIds) {
        const cell = document.createElement('div');
        cell.className = 'cpo-thumb';
        const url = imageUrl(photoId);
        if (url) cell.style.backgroundImage = `url("${url}")`;
        grid.appendChild(cell);
      }
      const dismiss = () => ov.remove();
      close.addEventListener('click', dismiss);
      ov.addEventListener('click', (e) => {
        if (e.target === ov) dismiss();
      });
      sheet.appendChild(close);
      sheet.appendChild(grid);
      ov.appendChild(sheet);
      // The overlay is a whole-viewport modal; append it to the shared outer root so it
      // covers the entire editor (same as the original bodyEl scope).
      outerRootRef.current?.appendChild(ov);
    }

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
      const chapterLine = document.createElement('div');
      chapterLine.className = 'cc-meta';
      chapterLine.textContent = aT(`第 ${meta.num} 章`, `Chapter ${meta.num}`);
      const metaLine = document.createElement('div');
      metaLine.className = 'cc-meta';
      metaLine.textContent = `${meta.photoIds.length} ${t('photosWord')} · ${t('nowEditing')}`;
      info.appendChild(titleRow);
      info.appendChild(chapterLine);
      info.appendChild(metaLine);
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'cc-view';
      view.innerHTML = `${t('viewDetails')}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
      view.addEventListener('click', () => {
        openChapterPhotosOverlay(meta.photoIds);
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

    let selectLayoutTriggered = false;
    async function triggerSelectLayout() {
      if (disposed) return;
      if (selectLayoutTriggered) return;
      const recipe = albumRecipe.load(albumId);
      const host = appendThinkingShell();
      if (!recipe?.requestId) {
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, aT('原始照片在本设备上找不到了,没法继续排版。', 'Original photos are no longer available on this device.'));
        appendTime(host);
        return;
      }
      selectLayoutTriggered = true;
      sending = true;
      try {
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, aT('好的,我这就根据你讲的故事,为整本相册排版并写好文案~',
                                 'Great — I’ll now lay out the whole album and write the copy from your stories.'));
        appendTime(host);
        appendStep(aT('🎨 正在挑选版式…', '🎨 Choosing layouts…'));
        appendStep(aT('✍️ 正在根据你的故事写文案…', '✍️ Writing copy from your stories…'));
        const refs = await selectLayoutRefsFromStore(recipe.photoIds);
        if (disposed) return;
        await submitSelectLayoutV3(albumId, {
          requestId: recipe.requestId,
          language: recipe.language,
          refs,
        });
        if (disposed) return;
        const working = appendThinkingShell();
        void working;
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
        ? aT('这一章只有照片,准备好进入下一章了吗?',
             'This chapter is photo-only — ready for the next one?')
        : aT('这一章写好了,你满意吗?', "Here's this chapter — happy with it?");
      const row = document.createElement('div');
      row.className = 'sc-actions';

      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'sc-btn sc-yes';
      yes.textContent = aT('满意,下一章', 'Looks great');
      yes.addEventListener('click', () => {
        if (sending || confirmingStoryChapter) return;
        row.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
        awaitingSatisfaction = false;
        appendUserText(aT('满意,继续下一章', 'Looks great — next chapter'));
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
          aT('好的,这一章先留着。哪里不太满意?点开那一页,告诉我想怎么改。',
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
        '排版完成了。现在直接告诉我这一章哪里要改；如果满意，说“可以了”就会继续下一步。',
        'The layout is ready. Tell me what to change in this chapter, or say “looks good” to continue.',
      );
      card.appendChild(body);
      const time = document.createElement('div');
      time.className = 'name-time';
      time.textContent = t('justNow');
      card.appendChild(time);
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
          void runEditChatTurn(aT(`这一章就叫「${name}」`, `Name this chapter "${name}"`))
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
          '旧版聊天改稿已下线，不会再改动当前版面。请继续使用 V3 流程：确认章节故事、选择主题与封面，然后导出 PDF。',
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

    // ── data-action handlers within ChatPanel's OWN subtree only (the aside). The
    // canvas/topbar/modals bind their own data-action nodes in EditorBook, so we scope
    // the sweep to the chat column to avoid double-binding. The chrome toggles that live
    // in the aside (toggleChat-collapse / openDetail) toggle body classes on the shared
    // outer root — consistent with EditorBook toggling the same classes for its own
    // chrome nodes (chat-fold-expand / closeDetail). ──
    const asideRoot = root.querySelector('.pane-chat-col') as HTMLElement | null;
    const actions: Record<string, () => void> = {
      buyShells: () => { window.location.href = `/${locale}/credits`; },
      // 中途加图 authoring-dormant: the "+" during authoring is a no-op (the dormant
      // picker + real add-photos flow live in EditorBook's modal/topbar scope).
      pickAddPhotos: () => { /* authoring: dormant */ },
      // chrome toggles on the shared body root (the aside owns these nodes):
      toggleChat: () => root.classList.toggle('chat-collapsed'),
      openDetail: () => root.classList.add('detail-open'),
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
    const onAuthoringPagesReady = () => {
      void (async () => {
        await loadStoryGate();
        const currentChapterId = storyGate?.currentChapterId ?? null;
        if (currentChapterId) appendEditLoopReadyCard(currentChapterId);
      })();
    };
    root.addEventListener('yujee:authoring-pages-ready', onAuthoringPagesReady);

    // ── Init: clear the design's demo chat, then run the mode-specific opening. ──
    chatBody?.querySelectorAll('.msg').forEach((n) => n.remove());
    if (isAuthoring) hideAwait();
    else {
      restAwait();
      // 先 loadStoryGate 再 loadHistory:历史重建要补插章节卡片(appendChapterCard 依赖
      // chapterMetaById→storyGate/draftSkel);storyGate 未就绪时卡片会插不出来。
      void loadStoryGate().then(() => loadHistory()).then(() => restAwait());
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

    // Demo-seed safety net (editing only): the seeded chat had a perpetually "active"
    // thinking block. Authoring manages its own thinking lifecycle, so skip it there.
    const completeTimer = isAuthoring
      ? (undefined as unknown as ReturnType<typeof setTimeout>)
      : setTimeout(() => {
          const active = $('.thinking-block.active');
          if (active) {
            active.classList.remove('active');
            const label = active.querySelector('.thinking-label');
            if (label) label.textContent = t('thinkingComplete');
          }
        }, 3000);

    return () => {
      disposed = true;
      sendBtnEl?.removeEventListener('click', send);
      input?.removeEventListener('keydown', onKeydown);
      input?.removeEventListener('input', onInput);
      actionHandlers.forEach(({ el, fn }) => el.removeEventListener('click', fn));
      root.removeEventListener('yujee:authoring-pages-ready', onAuthoringPagesReady);
      guidedChaptersRef.current.clear();
      interviewedChaptersRef.current.clear();
      shownChapterCardsRef.current.clear();
      interviewChainStartedRef.current = false;
      recommendInFlightRef.current = false;
      clearTimeout(completeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== 'authoring') return;
    const root = outerRootRef.current;
    if (!root) return;
    root.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
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
        <button className="chat-fold-btn chat-fold-collapse" data-action="toggleChat" data-i18n-title="collapseChat" title="折叠对话" aria-label="折叠对话">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="m18 17-5-5 5-5" /><path d="m11 17-5-5 5-5" /></svg>
        </button>
        <div className="md:hidden flex items-center px-4 py-3 border-b border-bdsoft flex-shrink-0">
          <button className="ml-auto flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-pill bg-bg text-fg2 text-[12.5px] font-semibold hover:bg-border-soft transition-colors shrink-0" data-action="openDetail">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[15px] h-[15px]"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
            <span data-i18n="detailChapters">详细章节</span>
          </button>
        </div>

        {mode !== 'editing' && (
          <StageBreadcrumb
            stage={breadcrumbStage}
            locale={locale}
            chapterProgress={storyProgress}
          />
        )}

        <div className="chat-body flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-6" id="chatBody" style={{ gap: '24px' }}>
          <>
            <div className="msg ai max-w-full">
              <div className="thinking-block">
                <span className="thinking-icon" />
                <span className="thinking-label" data-i18n="thinkingAnalyzed">分析了 6 张照片和地点信息</span>
                <span className="thinking-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
              </div>
              <div className="ai-text" data-i18n="aiMsg1">
                我已经为「海边时光」这一章写好了叙事文案。如果你想分享更多记忆，比如那天的天气、和谁同行、当时的心情，我可以把这些融进文字里。
              </div>
              <div className="name-time">10:41</div>
            </div>

            <div className="msg user max-w-full">
              <div className="bubble" data-i18n="userMsg1">那天其实下午起风了，我还差点把帽子吹丢，能加进去吗？</div>
            </div>

            <div className="msg ai max-w-full">
              <div className="thinking-block">
                <span className="thinking-icon" />
                <span className="thinking-label" data-i18n="thinkingReorg">重新组织第二段，融入风和帽子的细节</span>
                <span className="thinking-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
              </div>
              <div className="ai-text" data-i18n="aiMsg2">好的，我把这个细节融进了第二段。你看看这版：</div>
              <div className="ai-quote" data-i18n="aiQuote1">
                那天午后风忽然大了起来，差点把帽子从你头顶卷走。我们笑着追了几步，又坐回沙滩——海浪一遍又一遍地把脚印抹平，又一遍又一遍地让我们重新走过。
              </div>
              <div className="ai-actions flex gap-2 mt-3.5 flex-wrap">
                <button className="chip" data-i18n="chipAccept" data-chip="accept">采纳</button>
                <button className="chip" data-i18n="chipRewrite" data-chip="rewrite">再写一版</button>
                <button className="chip" data-i18n="chipEditMyself" data-chip="editMyself">我来改</button>
              </div>
              <div className="name-time">10:42</div>
            </div>

            <div className="msg user max-w-full">
              <div className="bubble" data-i18n="userMsg2">很好。再帮我想个更有诗意的章节名？</div>
            </div>

            <div className="msg ai max-w-full">
              <div className="thinking-block active">
                <img className="think-jelly" src="/jellyfish-loop.png" alt="" />
                <span className="thinking-label" data-i18n="thinkingChapterName">正在构思章节名</span>
                <span className="thinking-dots"><span /><span /><span /></span>
              </div>
              <div className="ai-text" data-i18n="aiMsg3">几个备选，挑一个或告诉我感觉：</div>
              <div className="ai-actions flex gap-2 mt-3.5 flex-wrap">
                <button className="chip-select" data-i18n="chipName1" data-name-chip>浪把时间洗薄了</button>
                <button className="chip-select" data-i18n="chipName2" data-name-chip>风从海上来</button>
                <button className="chip-select" data-i18n="chipName3" data-name-chip>咸味的下午</button>
                <button className="chip-select" data-i18n="chipName4" data-name-chip>那只差点飞走的帽子</button>
              </div>
              <div className="name-time">10:43</div>
            </div>

            <div className="balance-alert" id="balanceAlert">
              <div className="bp-lead" data-i18n="bpLead">哎呀，积分不够啦，充点积分继续生成你的纪念册～</div>
              <div className="bp-card">
                <span className="bp-ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[26px] h-[26px]"><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /><line x1="2" y1="12" x2="22" y2="12" /></svg>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="bp-title" data-i18n="bpTitle">购买积分</div>
                  <div className="bp-sub" data-i18n-html="bpSub"><b>1 积分</b>，可处理一批照片</div>
                </div>
                <button className="bp-buy" data-action="buyShells" data-i18n="bpBuy">去购买</button>
              </div>
            </div>
            <div className="await-user" id="awaitUser">
              <img className="await-jelly" src="/jellyfish-icon.png" alt="" style={{ width: '40px', height: '40px' }} />
            </div>
          </>
        </div>

        <div className="chat-input m-3 shrink-0 bg-surface border border-bdsoft rounded-pill flex items-end transition-all" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <button className="add-ch-btn w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg m-2 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted" data-action="pickAddPhotos" data-i18n-title="addPhoto" title="添加图片" aria-label="添加图片">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
          {/* 中途加图(W11):"+" 打开这个隐藏 picker;accept 用共享的 HEIC-aware 串,和主上传口
              一致(#284)。加图流程本身在 V3 上仍是占位(见 pickAddPhotos),但选择器格式要对。 */}
          <input type="file" id="addPhotoInput" accept={IMAGE_INPUT_ACCEPT} multiple className="hidden" />
          <textarea className="flex-1 outline-none resize-none bg-transparent text-fg text-[13.5px] leading-relaxed border-none pl-1 py-3 disabled:cursor-not-allowed" style={{ fontFamily: 'var(--font-body)' }} placeholder="" rows={1} id="msgInput" />
          <span className="btn-glow btn-glow-round shrink-0 m-2">
            <button className="send-btn w-8 h-8 rounded-full bg-fg text-white flex items-center justify-center cursor-pointer transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }} id="sendBtn" data-i18n-title="send" title="发送">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </span>
        </div>
      </aside>
    </div>
  );
}
