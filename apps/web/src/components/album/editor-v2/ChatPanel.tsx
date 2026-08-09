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

import { useEffect, useRef, useState, type RefObject } from 'react';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { useChromeSession } from '@/components/app/useChromeSession';
import { CreditsPurchaseModal } from './CreditsPurchaseModal';
import { IMAGE_INPUT_ACCEPT } from '@/lib/photo/heic';
import { renderMarkdownSafe } from '@/lib/markdown/render';
import {
  designChangeCategoryOf,
  designOpCategories,
  orderedChangeCategories,
  readDesignOps,
  type DesignChangeCategory,
} from './chat-history';
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
  postDraftEdit,
  postInspectRender,
  type DraftEditResult,
  type DraftSkeleton,
  type DraftPageKind,
} from '@/lib/album/authoring-client';
import type { V3ChatTurn } from '@yujee/contracts';
import { getTemplate, TEMPLATE_IDS } from '@yujee/contracts/templates';
import {
  UnauthorizedError,
  CreditInsufficientError,
  clusterCompressedPhotos,
  interviewDataFromStore,
  selectLayoutRefsFromStore,
  submitAddPhotosV3,
  submitSelectLayoutV3,
  composeAppendV3,
  fetchDesignState,
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
import { YUJEE_STATE_ASSETS } from '@/components/app/YujeeState';

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

  // In-editor "buy credits" modal (replaces the old navigate-to-/credits jump). The
  // imperative chat engine opens it via setCreditsModalOpen(true); on top-up the modal
  // calls back through toppedUpHandlerRef.current(), which the mount effect populates so
  // it can re-enable #sendBtn / hide #balanceAlert using the effect's own DOM helpers.
  const [creditsModalOpen, setCreditsModalOpen] = useState(false);
  const toppedUpHandlerRef = useRef<() => void>(() => {});

  // 游客态(匿名影子账号):/user/me 的 isAnonymous。null = 还没拿到(未知)。
  // 命令式聊天引擎经 ref 读取 —— 门禁只在明确 true 时拦(未知放行,服务端 403 兜底);
  // 占位书自动补跑真 compose 只在明确 false 时触发。
  const chromeSession = useChromeSession();
  const viewerAnonRef = useRef<boolean | null>(null);
  // 占位书升级触发器:mount effect 里的 maybeUpgradePlaceholder 注册进来,身份晚于
  // 聊天引擎就绪时(/user/me 慢)由下面的 effect 补触发。
  const upgradeTriggerRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (chromeSession.loading) return;
    viewerAnonRef.current = chromeSession.user ? chromeSession.user.isAnonymous : null;
    if (chromeSession.user && !chromeSession.user.isAnonymous) {
      upgradeTriggerRef.current?.();
    }
  }, [chromeSession.loading, chromeSession.user]);

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
    const guidedChapters = guidedChaptersRef.current;
    const openerInFlight = new Set<string>();
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

    const exportReadyLabel = aT('太棒了，你的书已经准备好了！', 'Wonderful — your book is ready!');

    // ── chat DOM handles ──
    const chatBody = byId('chatBody');
    const input = byId('msgInput') as HTMLTextAreaElement | null;
    const sendBtnEl = byId('sendBtn') as HTMLButtonElement | null;
    let sending = false;
    // 送出键禁用的单一真相源:AI 在忙(sending)或积分不足(outOfCredits)任一为真即禁用。
    // 二者都经 refreshSendDisabled 落到原生 disabled 上,于是一条 CSS :disabled 同时覆盖两种禁用。
    let outOfCredits = false;
    // 必选封面卡盖住输入时锁发送(design-work 的 cover-lock);并进单一真相源,不单独摸 send.disabled。
    let coverLocked = false;
    // 「小水母在跑」= 后台工作流忙(排版 waitForLayoutThenRefresh / 加图分析 waitForAppendChapters)。
    // 这些是 void 起的后台轮询,sending 早已释放(triggerSelectLayout 的 finally),若不另计,用户能在
    // 排版中发消息 → 直接报错。用计数器(可重入/可叠加:加图分析→排版会短暂重叠),>0 即禁用发送。
    // 采访是用户的回合(startChapterInterview 贴完问题就 restAwait 返回),故不计入 → 采访时照常可发。
    let workflowBusy = 0;
    function bumpWorkflowBusy(delta: number) {
      workflowBusy = Math.max(0, workflowBusy + delta);
      refreshSendDisabled();
    }
    // 把一段后台工作流(排版/加图分析)标记为「小水母在跑」:进入 +1、结束 -1,期间禁用发送。
    // 后台轮询都经它起(void withWorkflowBusy(() => waitFor…()));.finally 保证任何退出路径都 -1。
    function withWorkflowBusy<T>(run: () => Promise<T>): Promise<T> {
      bumpWorkflowBusy(1);
      return run().finally(() => bumpWorkflowBusy(-1));
    }
    function refreshSendDisabled() {
      if (sendBtnEl) sendBtnEl.disabled = sending || workflowBusy > 0 || outOfCredits || coverLocked;
    }
    function setSending(v: boolean) { sending = v; refreshSendDisabled(); }

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
      if (chatBody?.querySelector('.thinking-block.active')) {
        w.style.display = 'none';
        return;
      }
      chatBody!.appendChild(w);
      w.style.display = 'flex';
    }

    async function send() {
      if (!input || sending || workflowBusy > 0) return;
      // 暂存了照片 → 发送就是把这些照片一起提交进排版(HeroComposer 同款「先攒后发」)。文字留在框里。
      // 全程包 withWorkflowBusy:从「Understanding new photos…」到分析/排版结束,发送按钮一直禁用
      // ——否则 submitAddPhotosV3 那段(waitForAppendChapters 之前)workflowBusy 还是 0,用户能插队发消息。
      if (stagedPhotos.length > 0) {
        void withWorkflowBusy(() => submitStagedPhotos());
        return;
      }
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
      setSending(true);
      if (isAuthoring) {
        // 空书硬不变量(堵 422,用户拍板 2026-07-15):authoring 期一旦画板零页,这条消息
        // 【绝不】进设计 Agent —— 它对空书只会回「book 契约不合法:没有页面」(422),异常
        // 直接灌进对话且用户无从恢复。零页消息一律进续跑漏斗,与挂载解析器同一套判定。
        const pagesNow = co()?.getPagesState?.() ?? [];
        if (pagesNow.length === 0) {
          // storyGate 异步加载,挂载初期可能为 null(旧守卫读 storyGate?.allDone,未就绪时
          // 恒为假 → 守卫失效 → 空书进设计 Agent → 422,这正是要堵的 bug #2);为 null 先取。
          // 已判 running 的也重取一次:浏览器 3 分钟轮询超时会提示"发消息我会重新排版",
          // 若那时 job 其实已 FAILED,不刷新会把用户永远困在 stale 的「还在排版中」里。
          if (!storyGate || storyGate.layoutState === 'running') await loadStoryGate();
          if (storyGate?.layoutState === 'running') {
            appendAiText(aT('排版还在进行中,稍等片刻~', 'Layout is still running — one moment.'));
            setSending(false);
            return;
          }
          // 其余(idle/failed/信号缺失)→ 采访续跑漏斗:opener 要么续下一章采访,要么(全齐了)
          // 走链尾直接重排。先放开 sending —— opener 可能停在采访等用户回答,锁着会永久吞掉
          // 后续消息;triggerSelectLayout 自己管理 sending。
          setSending(false);
          await runChapterGuideOpener({ allowDuringSend: true });
          return;
        }
        // authoring 期、画板已有页:对话改书统一走设计 Agent。
        // 游客门禁:自由输入的对话改书是真实账号能力(采访答题/讲故事在上面早已分流,
        // 匿名照常可用)。明确是游客 → 不跳转不打断,亮出输入框上方的迷你登录横幅
        // (硬跳转会把正在讲故事的游客甩出编辑器,输入的字也丢 —— 上线首日实测教训)。
        // 身份未知放行,服务端 403 兜底。
        if (viewerAnonRef.current === true) {
          setSending(false);
          showGuestNudge();
          return;
        }
        await runDesignChatTurn(txt);
      } else {
        if (viewerAnonRef.current === true) {
          setSending(false);
          showGuestNudge();
          return;
        }
        await runEdit(txt);
      }
      setSending(false);
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
    // 历史里是否已原位重建过封面回执卡(designApplied 标记):有则 ready 分支不再尾部补卡。
    let historyHadCoverRecap = false;
    // applyDesign 落库的封面选择标记(album-service):形状不对就当没有,退回老行为。
    function readDesignApplied(layoutPatch: unknown): {
      coverTemplateId: string | null;
      coverPhotoId: string | null;
      endingTemplateId: string | null;
      endingPhotoId: string | null;
    } | null {
      if (!layoutPatch || typeof layoutPatch !== 'object') return null;
      const applied = (layoutPatch as { designApplied?: unknown }).designApplied;
      if (!applied || typeof applied !== 'object') return null;
      const pick = (key: string): string | null => {
        const v = (applied as Record<string, unknown>)[key];
        return typeof v === 'string' && v ? v : null;
      };
      const set = {
        coverTemplateId: pick('coverTemplateId'),
        coverPhotoId: pick('coverPhotoId'),
        endingTemplateId: pick('endingTemplateId'),
        endingPhotoId: pick('endingPhotoId'),
      };
      return set.coverTemplateId || set.endingTemplateId ? set : null;
    }
    /** 只把历史消息**请求**发出去(顺带排好序),不碰 DOM。
     *
     *  渲染必须等 storyGate —— 历史回放要按 chapterMetaById 补插章节卡片。但「等它」
     *  指的是等**渲染**,不是等**请求**:原先写成 loadStoryGate().then(() => loadHistory()),
     *  两个网络往返被串成了一条,面板要等 story-progress 回来才开始取消息,耗时直接相加
     *  (dev 上首次编译时两边各好几秒,面板就空在那儿)。
     *  这里把请求提前发出去与 storyGate 并行跑,loadHistory 里 ??= 会直接拿到同一个
     *  promise —— 渲染顺序一点没变,省掉的是纯等待。 */
    function primeHistoryFetch(): Promise<HistoryMessage[]> {
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
      return historyFetchPromiseRef.current;
    }

    async function loadHistory(): Promise<number> {
      const replaySeq = ++historyReplaySeqRef.current;
      try {
        const msgs = await primeHistoryFetch();
        if (disposed || replaySeq !== historyReplaySeqRef.current) return 0;
        chatBody?.querySelectorAll('[data-history-replay]').forEach((n) => n.remove());
        historyHadCoverRecap = false;
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
            // 封面选择消息(applyDesign 落库,layoutPatch.designApplied):先原位重建
            // 只读回执卡,再放用户气泡 —— 还原实时时「回执卡→就用这组封面」的顺序。
            const applied = readDesignApplied(m.layoutPatch);
            if (applied) {
              historyHadCoverRecap = true;
              const recap = buildCoverRecapCard(applied);
              recap.setAttribute('data-history-replay', '1');
              chatBody?.appendChild(recap);
            }
            appendUserText(c, { historyReplay: true });
            if (!m.chapterId || !storyGate?.currentChapterId || m.chapterId === storyGate.currentChapterId) {
              chapterHistory.push({ role: 'user', content: c });
            }
          } else {
            // design chat 的「更新了什么」彩色条:按落库 designOps 的 toolName 去重成类别,贴在这条
            // AI 回复之前(还原「更新条→回复」顺序);不再逐 op 冒卡。开场白历史未落库,回放省略。
            const cats = designOpCategories(readDesignOps(m.layoutPatch).map((op) => op.toolName));
            if (cats.length > 0) {
              const card = buildDesignChangeCard(cats);
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
    // Unified in-chat error surface: the app's error identity (shared error
    // illustration + 出错了) rendered inside the conversation, NEVER the raw
    // upstream string (e.g. `403: {"code":"AccountOverdueError",…}`). Optional
    // retry re-runs the failed action; the card removes itself before retrying so
    // errors don't pile up. Mirrors EditorPort's ErrorShell so every exception
    // surface — page and chat — reads the same.
    function appendChatError(opts?: { message?: string; retry?: () => void }) {
      hideAwait();
      const wrap = document.createElement('div');
      wrap.className = 'msg ai max-w-full';
      const card = document.createElement('div');
      card.className =
        'flex flex-col items-center text-center gap-1.5 rounded-2xl border border-bdsoft bg-surface px-4 py-4';
      const img = document.createElement('img');
      img.src = YUJEE_STATE_ASSETS.error;
      img.alt = '';
      img.draggable = false;
      img.className = 'w-[116px] h-auto select-none';
      const title = document.createElement('div');
      title.className = 'text-[14px] font-semibold text-fg';
      title.textContent = aT('出错了', 'Something went wrong');
      const msg = document.createElement('div');
      msg.className = 'text-[12.5px] leading-relaxed text-muted max-w-[240px]';
      msg.textContent = opts?.message ?? aT('这次没成功,点下面重试一下。', 'That didn’t go through — tap retry to try again.');
      card.append(img, title, msg);
      if (opts?.retry) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-[12.5px] font-semibold text-white transition-transform hover:-translate-y-px';
        btn.innerHTML =
          `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>` +
          `<span>${aT('重试', 'Try again')}</span>`;
        btn.addEventListener('click', () => {
          wrap.remove();
          opts.retry!();
        });
        card.appendChild(btn);
      }
      wrap.appendChild(card);
      chatBody!.appendChild(wrap);
      scrollChat();
    }
    // Handles the two special recoverable states (session gone → sign-in, no credit
    // → purchase card) and returns true when it did. Returns false for everything
    // else, leaving the caller to render appendChatError with its own context — the
    // raw error string is never shown.
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
      return false;
    }

    function updateStoryGateUi(progress: StoryProgress | null = storyGate) {
      // §4.2: only the export-lock UI is gate-driven now. The topbar export button lives
      // in the stable shell; toggle it via the coordinator so its disabled/glow口径 tracks
      // the live gate. (No-op until EditorBook populates the coordinator.)
      if (isAuthoring) co()?.setExportGateUi?.(isAuthoringExportLocked(progress));
    }

    function appendExportReadyCard() {
      // 幂等看 DOM 不看 closure:dev 双挂载/效果重跑时两个实例各持 closure 标志,
      // 会各append一张;DOM 里已有就不再加。
      if (chatBody?.querySelector('[data-export-ready-card]')) return;
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      card.setAttribute('data-export-ready-card', '1');
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
      // 与右上角导出按钮同口径(computeExportUnlocked):卡片出现 ⇔ 按钮可点,
      // 避免"聊天里能导、右上角禁用"的割裂。
      if (isAuthoring && storyGate && computeExportUnlocked(storyGate.stage, storyGate.allDone)) {
        appendExportReadyCard();
      }
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

    function applyAuthoringPatch(patch: LayoutPatchEntry[]): boolean {
      return co()?.applyAuthoringPatch?.(patch) ?? false;
    }
    // 已选封面组回执卡(只读):与选择卡同一套 chap-card 体系,封面+封底成对小预览。
    // 选完后原位替换选择卡留在历史里;刷新后 stage=ready 的历史重建也用它。
    function buildCoverRecapCard(set: {
      coverTemplateId: string | null;
      coverPhotoId: string | null;
      endingTemplateId: string | null;
      endingPhotoId: string | null;
      // 只有 appendCoverSummary(成书后回放)传;runApplyDesign 的即时卡和
      // loadHistory 的历史回放卡都没有真文案可传,留空走模板 sample。
      coverTexts?: Record<string, string>;
      endingTexts?: Record<string, string>;
    }, pageBackground?: string): HTMLElement {
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'chap-card cv-card';
      const titleRow = document.createElement('div');
      titleRow.className = 'cc-title-row';
      const title = document.createElement('span');
      title.className = 'cc-title';
      title.textContent = aT('已选的封面与封底', 'Chosen cover & back cover');
      const tag = document.createElement('span');
      tag.className = 'cc-tag';
      tag.textContent = aT('设计', 'Design');
      titleRow.appendChild(title);
      titleRow.appendChild(tag);
      inner.appendChild(titleRow);
      const row = document.createElement('div');
      row.className = 'cv-row';
      const pair = document.createElement('div');
      pair.className = 'cv-opt is-recap';
      let html = '';
      if (set.coverTemplateId) {
        html +=
          `<span class="cv-face">${co()?.coverOptionHTML?.(set.coverTemplateId, set.coverPhotoId, 92, 122, pageBackground, set.coverTexts) ?? ''}` +
          `<i class="cv-face-tag">${aT('封面', 'Cover')}</i></span>`;
      }
      if (set.endingTemplateId) {
        html +=
          `<span class="cv-face">${co()?.coverOptionHTML?.(set.endingTemplateId, set.endingPhotoId, 92, 122, pageBackground, set.endingTexts) ?? ''}` +
          `<i class="cv-face-tag">${aT('封底', 'Back')}</i></span>`;
      }
      pair.innerHTML = html;
      row.appendChild(pair);
      inner.appendChild(row);
      card.appendChild(inner);
      return card;
    }

    function appendCoverSummary() {
      const kindByPageIndex = new Map<number, DraftPageKind>();
      const skel = latestAuthoringRef.current.draftChapters ?? draftSkel;
      for (const p of skel?.pages ?? []) kindByPageIndex.set(p.pageIndex, p.kind);
      const pagesState = co()?.getPagesState?.() ?? [];
      const coverPage = pagesState.find((p) => kindByPageIndex.get(p.pageIndex) === 'cover') ?? null;
      const endingPage = pagesState.find((p) => kindByPageIndex.get(p.pageIndex) === 'ending') ?? null;
      if (!coverPage && !endingPage) return; // 设计已必选;老数据没有封面就不渲染占位
      // 刷新回放:从已落库页面 html 的页根读回书页底色,recap 预览也染上(和选定时一致)。
      const bgOfPage = (page: { htmlJson?: string } | null): string | undefined => {
        const html = page?.htmlJson;
        if (typeof html !== 'string') return undefined;
        const root = /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i.exec(html)?.[0] ?? '';
        return /background-color:\s*(#[0-9a-fA-F]{6})/i.exec(root)?.[1];
      };
      chatBody!.appendChild(
        buildCoverRecapCard({
          coverTemplateId: coverPage?.templateId ?? null,
          coverPhotoId: coverPage ? (Object.values(coverPage.imagesJson)[0] ?? null) : null,
          endingTemplateId: endingPage?.templateId ?? null,
          endingPhotoId: endingPage ? (Object.values(endingPage.imagesJson)[0] ?? null) : null,
          // 成书后回放:真页 textsJson 直接传,回执卡不再恒渲模板 sample。
          coverTexts: coverPage?.textsJson,
          endingTexts: endingPage?.textsJson,
        }, bgOfPage(coverPage) ?? bgOfPage(endingPage)),
      );
    }

    function imageUrl(id: string): string | undefined {
      return co()?.imageUrl?.(id);
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
        if (!authErr(host, e)) appendChatError({ retry: () => { void runDraftEditTurn(message); } });
      }
      restAwait();
      scrollChat();
      updateAuthInputPlaceholder();
    }
    void runDraftEditTurn;

    // 设计 Agent 全书对话（NDJSON 流式）。对话框展示锁成四段:①开场白气泡(AI 回合开头对用户
    // 说的话,assistant_step 事件)顶在最上;②单条「使用工具中」进度条(不逐工具、不报工具名,整
    // 回合只一条笼统状态条,工具跑完随水母收掉);③一条彩色「更新了什么」条(按类别去重,只报真正改
    // 了的:字体/颜色/页面);④终稿总结回复置于最底。committed 时把新页原地重绘;done 时 pages 已
    // 写回 draft_json。
    //
    // 写类工具 → 更新类别的口径在 ./chat-history(唯一真相,单测直取)。
    // 这里只留展示用的词。
    const DESIGN_CHANGE_LABEL: Record<DesignChangeCategory, [string, string]> = {
      fonts: ['字体', 'Fonts'],
      colors: ['颜色', 'Colors'],
      pages: ['页面', 'Pages'],
      order: ['页序', 'Order'],
    };
    function designChangeLabel(cat: DesignChangeCategory): string {
      const label = DESIGN_CHANGE_LABEL[cat];
      return aT(label[0], label[1]);
    }
    // 「更新了什么」的对勾图标(op-ic 内,青紫渐变底)。
    const OP_DONE_SVG =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    // 一条彩色「更新了什么」摘要条:复用 op-card 设计语言(渐变底)+ cc-tag 同款渐变胶囊标签。
    // 流式与历史回放共用;categories 已去重且按固定顺序。文案走 textContent(不进 innerHTML)。
    function buildDesignChangeCard(categories: DesignChangeCategory[]): HTMLElement {
      const card = document.createElement('div');
      card.className = 'op-card op-card-change';
      const slots = categories.map(() => '<span class="op-tag"></span>').join('');
      card.innerHTML =
        `<div class="op-ic">${OP_DONE_SVG}</div>` +
        `<div class="op-body"><div class="op-kicker">${aT('已更新', 'Updated')}</div>` +
        `<div class="op-tags">${slots}</div></div>`;
      const tagEls = card.querySelectorAll('.op-tag');
      categories.forEach((c, i) => {
        (tagEls[i] as HTMLElement).textContent = designChangeLabel(c);
      });
      return card;
    }
    // 从落库的 layout_patch 里解析 design chat 写操作（{ designOps: [{toolName, input}] }）。

    // 底部钉着水母的流式过程面板。2026-08-08 起逐步披露(此前整回合只有一条笼统「使用工具中」、
    // 中间步文本只放第一条,用户盯着水母转半天突然冒结果):
    // ①每条步骤叙述(assistant_step,AI 边做边说的话)按时间流进过程区;
    // ②每个工具调用一行人话步骤(「翻看页面 · 第 3 页」,运行中→✓),内部工具名/入参不外露;
    // ③write_todos 不占步骤行,渲染成一块实时计划清单(整表覆盖,原地更新,✓/→/○);
    // ④settle 收水母,过程区保留 —— 它就是本回合的操作披露;终稿回复与「已更新」条仍置最底。
    // 安全:步骤文本走 renderMarkdownSafe;工具入参(模型可控)一律 textContent,绝不进 innerHTML。
    const TOOL_STEP_LABEL: Record<string, [string, string]> = {
      read_page: ['翻看页面', 'Reading pages'],
      search_book: ['搜索全书', 'Searching the book'],
      list_templates: ['挑选版式', 'Browsing layouts'],
      read_skill: ['查阅设计规范', 'Consulting design notes'],
      update_page_texts: ['修改文字', 'Editing text'],
      write_page_html: ['重排版面', 'Rebuilding the layout'],
      swap_page_template: ['更换版式', 'Swapping the layout'],
      update_page_images: ['调整照片', 'Adjusting photos'],
      set_text_colors: ['调整配色', 'Updating colors'],
      set_text_fonts: ['更换字体', 'Changing fonts'],
      move_pages: ['调整页序', 'Reordering pages'],
      delete_page: ['删除页面', 'Removing a page'],
    };
    // 从工具入参里提取「对象」摘要(页码引用),给步骤行做人话后缀;取不到就不带后缀。
    function stepPageDetail(input: unknown): string {
      if (typeof input !== 'object' || input === null) return '';
      const source = input as Record<string, unknown>;
      const refs: unknown[] = [];
      if (source.pageNo !== undefined) refs.push(source.pageNo);
      if (Array.isArray(source.pageNos)) refs.push(...source.pageNos);
      if (Array.isArray(source.updates)) {
        for (const u of source.updates) {
          if (typeof u === 'object' && u !== null && (u as Record<string, unknown>).pageNo !== undefined) {
            refs.push((u as Record<string, unknown>).pageNo);
          }
        }
      }
      const label = (ref: unknown): string | null => {
        if (typeof ref === 'number') return String(ref);
        if (typeof ref !== 'string') return null;
        if (ref === 'cover') return aT('封面', 'cover');
        if (ref === 'toc') return aT('目录', 'contents');
        if (ref === 'ending') return aT('封尾', 'back page');
        return /^\d+(-\d+)?$/.test(ref) ? ref : null;
      };
      const parts = refs.map(label).filter((v): v is string => v !== null);
      if (parts.length === 0) return '';
      const shown = parts.slice(0, 4).join('、');
      const more = parts.length > 4 ? aT(` 等 ${parts.length} 页`, ` +${parts.length - 4} more`) : '';
      const numeric = parts.some((p) => /^\d/.test(p));
      return numeric ? aT(`第 ${shown} 页${more}`, `p. ${shown}${more}`) : `${shown}${more}`;
    }
    function createDesignStreamHost(): {
      host: HTMLElement;
      showStep: (text: string) => void;
      toolStart: (toolCallId: string, toolName: string, input: unknown) => void;
      toolDone: (toolCallId: string, isError: boolean) => void;
      settle: () => void;
    } {
      hideAwait();
      const host = document.createElement('div');
      host.className = 'msg ai max-w-full';
      const feed = document.createElement('div');
      feed.className = 'ep-step-feed';
      host.appendChild(feed);
      const jelly = document.createElement('div');
      jelly.className = 'thinking-block active ep-stream-jelly';
      jelly.innerHTML =
        `<img class="think-jelly" src="/jellyfish-loop.png" alt="">` +
        `<span class="thinking-label">${t('thinking')}</span>` +
        `<span class="thinking-dots"><span></span><span></span><span></span></span>`;
      host.appendChild(jelly);
      chatBody!.appendChild(host);
      scrollChat();

      const toolRows = new Map<string, HTMLElement>();
      let todosBlock: HTMLElement | null = null;
      // write_todos 整表覆盖 → 清单原地重建(块只一个);内容全部 textContent。
      function renderTodos(input: unknown): void {
        if (typeof input !== 'object' || input === null) return;
        const todos = (input as Record<string, unknown>).todos;
        if (!Array.isArray(todos)) return;
        if (!todosBlock) {
          todosBlock = document.createElement('div');
          todosBlock.className = 'ep-step-todos';
          feed.appendChild(todosBlock);
        }
        todosBlock.replaceChildren();
        for (const todo of todos) {
          if (typeof todo !== 'object' || todo === null) continue;
          const { content, status } = todo as Record<string, unknown>;
          if (typeof content !== 'string') continue;
          const row = document.createElement('div');
          row.className =
            status === 'completed' ? 'todo-row todo-done' : status === 'in_progress' ? 'todo-row todo-active' : 'todo-row';
          const mark = document.createElement('span');
          mark.className = 'todo-mark';
          mark.textContent = status === 'completed' ? '✓' : status === 'in_progress' ? '→' : '○';
          const text = document.createElement('span');
          text.textContent = content;
          row.append(mark, text);
          todosBlock.appendChild(row);
        }
        scrollChat();
      }
      return {
        host,
        // ①步骤叙述:AI 边做边说的话,逐条进过程区(不再只取第一条)。
        showStep(text) {
          const trimmed = text.trim();
          if (!trimmed) return;
          const row = document.createElement('div');
          row.className = 'ep-step-text ai-text';
          row.innerHTML = renderMarkdownSafe(trimmed);
          feed.appendChild(row);
          scrollChat();
        },
        // ②工具步骤行:人话动词 + 页码摘要,运行中带脉冲点;write_todos 走计划清单。
        toolStart(toolCallId, toolName, input) {
          if (toolName === 'write_todos') {
            renderTodos(input);
            return;
          }
          const label = TOOL_STEP_LABEL[toolName];
          if (!label) return; // 未知工具不硬渲染,宁缺毋滥
          const row = document.createElement('div');
          row.className = 'ep-step-tool running';
          const dot = document.createElement('span');
          dot.className = 'ep-step-dot';
          const textEl = document.createElement('span');
          const detail = stepPageDetail(input);
          textEl.textContent = detail ? `${aT(label[0], label[1])} · ${detail}` : aT(label[0], label[1]);
          row.append(dot, textEl);
          feed.appendChild(row);
          if (toolCallId) toolRows.set(toolCallId, row);
          scrollChat();
        },
        toolDone(toolCallId, isError) {
          const row = toolRows.get(toolCallId);
          if (!row) return;
          row.classList.remove('running');
          row.classList.add(isError ? 'err' : 'done');
          const dot = row.querySelector('.ep-step-dot');
          if (dot) dot.textContent = isError ? '!' : '✓';
        },
        settle() {
          jelly.remove(); // 收水母;过程区保留,作为本回合做了什么的记录
          for (const row of toolRows.values()) row.classList.remove('running'); // 兜底:不留悬空脉冲
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
      // 本回合真正改了的类别(去重)。写类工具 tool_call 时按 toolCallId 记下待确认类别,
      // 其 tool_result 成功(非 error)时才计入 —— 与 route 落库 designOps 的口径一致。
      const pendingWriteCat = new Map<string, DesignChangeCategory>();
      const changedCats = new Set<DesignChangeCategory>();
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
          // 游客撞门(前置闸漏了/身份未知时的服务端兜底):同 401 处置 → authErr 跳登录。
          if (payload?.error?.code === 'ANON_UPGRADE_REQUIRED') throw new UnauthorizedError();
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
              // C 方案页面真相:AI 的改动可能只落在烘焙 html 里,原地重绘必须带上。
              html?: string | null;
            }>;
          } | null;
          error: string | null;
        } = { final: null, error: null };
        await readDesignChatStream(res, (event) => {
          const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
          if (event.type === 'assistant_step' && typeof event.text === 'string') {
            // ①步骤叙述:AI 边做边说的话,逐条流进过程区。
            stream.showStep(event.text);
          } else if (event.type === 'tool_call' && typeof event.toolName === 'string') {
            // ②过程披露:每个工具调用渲染成人话步骤行(write_todos → 实时计划清单)。
            // 写类工具同时记下待确认类别。
            stream.toolStart(toolCallId, event.toolName, event.input);
            const cat = designChangeCategoryOf(event.toolName);
            if (cat && toolCallId) pendingWriteCat.set(toolCallId, cat);
          } else if (event.type === 'tool_result' && typeof event.toolName === 'string') {
            // 步骤行落 ✓/!;写类工具成功执行(非 error)才算"真的改了",计入更新类别。
            stream.toolDone(toolCallId, event.isError === true);
            if (event.isError !== true) {
              const cat = pendingWriteCat.get(toolCallId);
              if (cat) changedCats.add(cat);
            }
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
                html?: string | null;
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
        // ③一条彩色「更新了什么」条:按类别去重,只报真正改了的;贴在终稿回复之前。
        const cats = orderedChangeCategories(changedCats);
        if (cats.length > 0) stream.host.appendChild(buildDesignChangeCard(cats));
        // ④终稿总结回复,置于最底。
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
                    // 关键:画板按 preferredPageHtml 优先渲染烘焙 html。丢了它,AI 写进
                    // html 的改动就"应用了但画面没变",要整页刷新才能看到(实测根因)。
                    ...(typeof p.html === 'string' && p.html.length > 0 ? { htmlJson: p.html } : {}),
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
        if (!authErr(stream.host, e)) {
          appendChatError({
            message: aT('设计助手暂时不可用,请稍后再试。', 'The design assistant is unavailable right now — please try again shortly.'),
            retry: () => { void runDesignChatTurn(userMessage); },
          });
        }
      }
      setComposerThinking(false);
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
      const tag = aT(`第 ${idx + 1} 组`, `Group ${idx + 1}`);
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

    const shownChapterCards = shownChapterCardsRef.current;

    // 章节卡缩略图补填:卡片创建时画板骨架/objectUrl 可能还没就绪(首次进入的第一张卡、
    // 追加照片刚合并完新章节),缺图的 thumb 带 data-photo-id 占位,这里有界轮询补上。
    function fillChapterCardThumbs(chapterId: string, attempt = 0) {
      if (disposed || attempt > 30) return;
      const card = chatBody?.querySelector(`[data-chapter-card="${chapterId}"]`);
      if (!card) return;
      const pending = [...card.querySelectorAll<HTMLElement>('.cc-thumb[data-photo-id]')];
      if (pending.length === 0) return;
      let missing = 0;
      for (const thumb of pending) {
        const url = imageUrl(thumb.dataset.photoId!);
        if (url) {
          thumb.style.backgroundImage = `url("${url}")`;
          thumb.removeAttribute('data-photo-id');
        } else {
          missing += 1;
        }
      }
      if (missing > 0) setTimeout(() => fillChapterCardThumbs(chapterId, attempt + 1), 500);
    }

    function appendChapterCard(chapterId: string, attempt = 0) {
      if (chatBody?.querySelector(`[data-chapter-card="${chapterId}"]`)) {
        fillChapterCardThumbs(chapterId); // 已有卡片:只补缺失的缩略图
        return;
      }
      const meta = chapterMetaById(chapterId);
      if (!meta) {
        // 画板骨架还没加载完(首次进入/追加合并的竞态):有界重试,而不是放弃导致卡片永远缺失。
        if (!disposed && attempt < 30) setTimeout(() => appendChapterCard(chapterId, attempt + 1), 500);
        return;
      }
      shownChapterCards.add(chapterId);
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      card.setAttribute('data-chapter-card', chapterId);
      const inner = document.createElement('div');
      inner.className = 'chap-card';
      const thumbs = document.createElement('div');
      thumbs.className = 'cc-thumbs';
      let missingThumb = false;
      for (const photoId of meta.photoIds.slice(0, 4)) {
        const thumb = document.createElement('div');
        thumb.className = 'cc-thumb';
        const url = imageUrl(photoId);
        if (url) {
          thumb.style.backgroundImage = `url("${url}")`;
        } else {
          thumb.setAttribute('data-photo-id', photoId); // 占位,fillChapterCardThumbs 补填
          missingThumb = true;
        }
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
      if (missingThumb) setTimeout(() => fillChapterCardThumbs(chapterId), 500);
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
        // place 随采访一并写回树(V3Chapter.place):城市级地名文字,写文案 AI 逐照片用。
        const place = pending.input.place?.trim();
        await postChapterContexts(
          albumId,
          [{ chapterId: cid, chapterContext: context, ...(place ? { place } : {}) }],
          interviewMsgs,
        );
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

    // 跳过剩下全部:所有未采访章一次性标记(参照 waitForAppendChapters 的批量补标),直接去排版。
    async function skipRemainingInterviews() {
      if (disposed) return;
      pendingInterview = null;
      updateAuthInputPlaceholder();
      const order = storyGate?.chapterOrder ?? [];
      order.forEach((cid) => interviewedChapters.add(cid));
      await triggerSelectLayout();
    }

    // 加照片增量重跑(spec §1):追加范围 —— 采访链尽头据此转向增量排版而非全书重排。
    let appendScope: {
      chapterIds: string[];
      photoIds: string[];
      prevPageCount: number;
      // 增量排版实际范围(fresh ∪ 滞留章)与其照片:triggerAppendSelectLayout 填,
      // 追加成稿(triggerAppendCompose)按同一范围写文案 —— 两者必须同源。
      layoutChapterIds?: string[];
      refsPhotoIds?: string[];
    } | null = null;
    let appendInFlight = false;

    let selectLayoutTriggered = false;
    async function triggerSelectLayout() {
      if (disposed) return;
      setInterviewSkips(null); // 采访链结束、进入排版:收起跳过 pill,恢复普通输入框
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
      setSending(true);
      try {
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, aT('好的,我这就根据你讲的故事,为整本相册排版并写好文案~',
                                 'Great — I’ll now lay out the whole album and write the copy from your stories.'));
        // workflow 进度：一个水母，灰色 label 依次显示两个固定操作（英文即可）。
        const working = appendThinkingShell();
        setThinkingLabel(working, 'Choosing layouts…');
        const refs = await selectLayoutRefsFromStore(recipe.photoIds);
        if (disposed) return;
        setThinkingLabel(working, 'Laying out your pages…');
        await submitSelectLayoutV3(albumId, {
          requestId: recipe.requestId,
          language: recipe.language,
          refs,
        });
        if (disposed) return;
        // select-layout runs async on the Agent:确定性选版一把出 pages,由 completed 回调
        // 落进服务端 draft。Poll it and, once pages appear, fire yujee:authoring-pages-ready so the
        // canvas refreshes IN PLACE (EditorPort refetches; only EditorBook remounts).
        // ChatPanel keeps its state — no full reload, so no re-run/duplication.
        void withWorkflowBusy(() => waitForLayoutThenRefresh(working));
      } catch (e) {
        if (disposed) return;
        selectLayoutTriggered = false;
        if (!authErr(host, e)) {
          appendChatError({
            message: e instanceof PhotosUnavailableError
              ? aT('原始照片在本设备上找不到了,没法继续排版。', 'Original photos are no longer available on this device.')
              : aT('排版没能开始,稍后再试一下。', 'Couldn’t start layout — please try again in a moment.'),
          });
        }
      } finally {
        setSending(false);
        if (!disposed) {
          restAwait();
          scrollChat();
        }
      }
    }
    // 排版是 Agent 异步跑的,完成的页落进服务端 draft。
    // 轮询 draft,pages 一出现就派发 `yujee:authoring-pages-ready`:EditorPort 收到后重取
    // 草稿,canvas(按 pages.length key)只重挂自己渲染出版面;ChatPanel(按 album.id key)
    // 不重挂,保留对话历史 —— 所以不会像整页 reload 那样重复采访/错乱顺序。
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
              const scope = appendScope;
              appendScope = null;
              appendInFlight = false;
              await loadStoryGate();
              const designed = draft.pages.some((p) => p.kind === 'cover');
              if (!designed || !scope?.layoutChapterIds?.length) {
                // 书还没设计:新页文案等选封面时随全书成稿一起写,保持既有收尾。
                appendReplyBody(
                  host,
                  aT('新照片排进书里了,样式跟全书保持一致。想调整就在对话里告诉我。',
                     'The new photos are in — styled to match the rest of the book. Ask me here to tweak anything.'),
                );
                maybeAppendExportReadyCard();
              } else {
                appendReplyBody(
                  host,
                  aT('新照片排进书里了。我再给新页面写上文案,稍等片刻。',
                     'The new photos are in — now writing their copy, one moment.'),
                );
                await triggerAppendCompose({
                  chapterIds: scope.layoutChapterIds,
                  photoIds: scope.refsPhotoIds ?? scope.photoIds,
                });
              }
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
        // 复位触发开关:排版可能真的失败了(而非慢)。不复位的话本会话内
        // selectLayoutTriggered 永远为 true,用户在对话里怎么发消息都无法重试。
        selectLayoutTriggered = false;
        appendReplyBody(
          host,
          aT(
            '排版好像慢了点。可以刷新页面看看结果；如果还是空白，在对话里随便发一条消息，我会重新排版。',
            'Layout is taking a while — refresh to check. If the canvas is still empty, send any message here and I’ll restart the layout.',
          ),
        );
      }
    }

    // ── 加照片增量重跑(spec §1):压缩入库 → add-photos 提交 → 等新章节 → 采访 → 增量排版 ──

    async function triggerAppendSelectLayout() {
      if (disposed || !appendScope) return;
      const scope = appendScope;
      const host = appendThinkingShell();
      setThinkingLabel(host, 'Laying out the new photos…');
      setSending(true);
      try {
        // 防御性:要排的章 = 本批 fresh ∪ 仍未排版的滞留章(story-progress 里不在 doneChapterIds 的)。
        // 一起补排,自愈之前级联卡住的章。**refs 从「要排的这些章里实际用到的 photoId」推**(并集当批)——
        // 与 chapterIds 同源、必然对齐,不会再出现「排的章里有张照片却没带它的 200px ref」→ 服务端 400。
        // 缺原图的照片走 PhotosUnavailableError(诚实失败),而不是让人摸不着头脑的 missing ref。
        const lingering = (storyGate?.chapterOrder ?? []).filter(
          (cid) => !(storyGate?.doneChapterIds ?? []).includes(cid),
        );
        const layoutChapterIds = [...new Set([...scope.chapterIds, ...lingering])];
        const chapterPhotoIds = layoutChapterIds.flatMap((cid) => chapterMetaById(cid)?.photoIds ?? []);
        const refsPhotoIds = [...new Set([...scope.photoIds, ...chapterPhotoIds])];
        const refs = await selectLayoutRefsFromStore(refsPhotoIds);
        if (disposed) return;
        appendScope = { ...scope, layoutChapterIds, refsPhotoIds };
        await submitSelectLayoutV3(albumId, {
          requestId: albumRecipe.load(albumId)?.requestId ?? crypto.randomUUID(),
          language: currentLang === 'zh' ? 'zh' : 'en',
          refs,
          chapterIds: layoutChapterIds,
        });
        if (disposed) return;
        void withWorkflowBusy(() => waitForLayoutThenRefresh(host, { minPages: scope.prevPageCount + 1, append: true }));
      } catch (e) {
        if (disposed) return;
        appendScope = null;
        appendInFlight = false;
        if (!authErr(host, e)) {
          appendChatError({
            message: e instanceof PhotosUnavailableError
              ? aT('新照片在本设备上找不到了,没法排版。', 'The new photos are no longer available on this device.')
              : aT('新照片排版没能开始,稍后再试一下。', "Couldn't start laying out the new photos — try again in a moment."),
          });
        }
      } finally {
        setSending(false);
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

    // 加图「先攒后发」(HeroComposer 同款):点 + 只把照片压缩后暂存进输入框上方(可反复加、可 ×
    // 移除),点发送才提交进排版/扣款。原图仍只在浏览器。
    type StagedPhoto = { photoId: string; previewUrl: string; compressed: CompressedPhoto };
    let stagedPhotos: StagedPhoto[] = [];
    function renderStagedThumbs() {
      const box = byId('stagedPhotos');
      if (!box) return;
      box.style.display = stagedPhotos.length ? 'flex' : 'none';
      box.innerHTML = '';
      for (const p of stagedPhotos) {
        const cell = document.createElement('div');
        cell.className = 'staged-thumb';
        const img = document.createElement('img');
        img.src = p.previewUrl;
        img.alt = '';
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'staged-remove';
        rm.setAttribute('aria-label', aT('移除', 'Remove'));
        rm.innerHTML =
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        rm.addEventListener('click', () => {
          stagedPhotos = stagedPhotos.filter((s) => s.photoId !== p.photoId);
          renderStagedThumbs();
        });
        cell.appendChild(img);
        cell.appendChild(rm);
        box.appendChild(cell);
      }
    }
    // 点 +:压缩 + 原图入 IndexedDB(HeroComposer.onFiles 同款链路;原图绝不上服务器),只暂存不提交。
    // 上限跨「已暂存」计:反复点 + 累加到 MAX 为止。
    async function stageAddedPhotos(files: File[]) {
      if (!files.length || disposed) return;
      const room = MAX_PHOTOS_PER_GENERATION - stagedPhotos.length;
      if (room <= 0) return;
      const batch = files.slice(0, room);
      // 逐张压缩会转圈,给个「正在处理照片 N/M」进度条,别让用户盲等(和首页同口径)。
      const prog = byId('stagedProgress');
      const showProg = (done: number) => {
        if (!prog) return;
        prog.style.display = '';
        prog.textContent = aT(`正在处理照片 ${done}/${batch.length}`, `Processing photos ${done}/${batch.length}`);
      };
      try {
        showProg(0);
        let done = 0;
        for (const file of batch) {
          const photoId = crypto.randomUUID();
          const compressed = await compressFile(file, photoId);
          await photoStore.put(photoId, file);
          if (disposed) return;
          stagedPhotos.push({ photoId, previewUrl: compressed.base64, compressed });
          renderStagedThumbs();
          done++;
          showProg(done);
        }
      } finally {
        if (prog) prog.style.display = 'none';
      }
    }
    // 点发送:把暂存的照片一起提交 → 排版 + 扣款 + 采访。提交后清空暂存条。
    async function submitStagedPhotos() {
      if (!stagedPhotos.length || appendInFlight || disposed) return;
      appendInFlight = true;
      const batch = stagedPhotos;
      stagedPhotos = [];
      renderStagedThumbs();
      const prevOrder = storyGate?.chapterOrder ?? [];
      const prevPageCount = co()?.getPagesState?.()?.length ?? 0;
      appendUserText(aT(`添加了 ${batch.length} 张照片`, `Added ${batch.length} photo${batch.length > 1 ? 's' : ''}`));
      hideAwait();
      scrollChat();
      const host = appendThinkingShell();
      setThinkingLabel(host, 'Understanding new photos…');
      try {
        const photos = clusterCompressedPhotos(batch.map((s) => s.compressed));
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
        void withWorkflowBusy(() => waitForAppendChapters(prevOrder, newPhotoIds, prevPageCount, host));
      } catch (e) {
        appendInFlight = false;
        settleThinking(host, 'analyzedFeedback');
        if (!authErr(host, e)) {
          appendChatError({ message: aT('照片没能加进来,稍后再试一下。', "Couldn't add the photos — please try again in a moment.") });
        }
        restAwait();
        scrollChat();
      }
    }
    // 设计环节:封面组选择卡。规则组(服务端 GET)→ 用户点选一组 → POST /design
    // (服务端派发 engine /v3/compose 一次性成稿,回调落 draft)→ 轮询到封面页即刷画板。
    // 幂等:已设计过(designed)或成稿在跑(composing)都不再弹。
    let designOfferShown = false;
    // 必选封面步骤:把选择卡盖在输入框上方(#coverDock),并锁住输入——禁用发送 + 置灰输入框。
    function setCoverLock(on: boolean) {
      outerRootRef.current?.querySelector('.composer-group')?.classList.toggle('cover-locked', on);
      coverLocked = on;
      refreshSendDisabled();
    }
    async function offerDesignCard() {
      if (disposed || designOfferShown) return;
      let sets: Array<{ coverTemplateId: string; coverPhotoId: string; endingTemplateId: string; endingPhotoId: string; pageBackground?: string }> = [];
      try {
        const res = await fetch(`/api/v3/albums/${albumId}/design`);
        const json = await res.json();
        if (!json.ok) return;
        if (json.data.designed) {
          // 已设计:普通书到此为止;游客占位书(copySource='placeholder')两条接法 ——
          // 还是游客:刷新回来自动亮迷你登录横幅(不打断);
          // 已转正:自动补跑真 compose(函数内部自判身份/在途状态)。
          if (viewerAnonRef.current === true && detail.album.copySource === 'placeholder') {
            showGuestNudge({ auto: true });
          } else {
            void maybeUpgradePlaceholder(Boolean(json.data.composing));
          }
          return;
        }
        if (!json.data.hasPages) return;
        // 成稿正在跑(刷新重进):不重弹选择卡,直接接回轮询等这一单成书。
        if (json.data.composing) {
          designOfferShown = true;
          const resuming = appendThinkingShell();
          setThinkingLabel(resuming, 'Writing your book…');
          void withWorkflowBusy(() => waitForComposeThenRefresh(resuming));
          return;
        }
        sets = json.data.sets ?? [];
      } catch {
        return; // 拿不到选项就静默不弹,不打断编辑
      }
      if (disposed || sets.length === 0) return;
      designOfferShown = true;

      // 必选封面卡:盖在输入框上一层(#coverDock),竖排整行选项,对齐设计草稿。
      const inner = document.createElement('div');
      inner.className = 'chap-card cv-card cv-pick-card';
      const LOCK_SVG =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
      const kicker = document.createElement('div');
      kicker.className = 'cv-kicker';
      kicker.innerHTML = `${LOCK_SVG}<span>${aT('需要你选一个 · 封面', 'Pick one · cover')}</span>`;
      inner.appendChild(kicker);
      const title = document.createElement('div');
      title.className = 'cv-head-title';
      title.textContent = aT('选择封面 & 封尾', 'Choose cover & back cover');
      inner.appendChild(title);
      const sub = document.createElement('div');
      sub.className = 'cv-head-sub';
      sub.textContent = aT(
        '选定后会把标题字体、配色套用到整本书 —— 这一步不能跳过',
        'Fonts and colors apply across the whole book — this step can’t be skipped',
      );
      inner.appendChild(sub);

      let selected = 0;
      const list = document.createElement('div');
      list.className = 'cv-picks';
      const picks: HTMLButtonElement[] = [];
      const repaint = () => {
        picks.forEach((p, i) => p.setAttribute('aria-checked', i === selected ? 'true' : 'false'));
      };
      const CHECK_SVG =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      const ZOOM_SVG =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>';
      // 竖排整行:[封面+封底小图(封面带放大镜)] + [标签] + [右侧圆形单选]。
      sets.forEach((set, i) => {
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'cv-pick';
        pick.setAttribute('role', 'radio');
        pick.innerHTML =
          `<span class="cv-pick-thumbs">` +
            `<span class="cv-face sm">${co()?.coverOptionHTML?.(set.coverTemplateId, set.coverPhotoId, 46, 60, set.pageBackground) ?? ''}` +
            `<button type="button" class="cv-zoom" aria-label="${aT('放大查看', 'Zoom')}" title="${aT('放大查看', 'Zoom')}">${ZOOM_SVG}</button></span>` +
            `<span class="cv-face sm">${co()?.coverOptionHTML?.(set.endingTemplateId, set.endingPhotoId, 46, 60, set.pageBackground) ?? ''}</span>` +
          `</span>` +
          `<span class="cv-pick-label">${aT('第 ' + (i + 1) + ' 套', 'Set ' + (i + 1))}<i>${aT('封面 + 封底', 'Cover + back')}</i></span>` +
          `<span class="cv-radio">${CHECK_SVG}</span>`;
        pick.addEventListener('click', (e) => {
          // 点缩略图上的小放大镜 → 气泡放大;点其余任何地方 → 选中。
          if ((e.target as HTMLElement).closest?.('.cv-zoom')) { openCoverZoom(sets[i]); return; }
          selected = i;
          repaint();
        });
        picks.push(pick);
        list.appendChild(pick);
      });
      inner.appendChild(list);

      // 书页底色不再单独选:每套推荐封面自带一个底色(见 buildCoverSets),已染进上面的
      // 缩略图预览;用户选哪套 = 连那套底色一起刷全书(下方确认时透传 set.pageBackground)。

      // 底部:黑色「确认并继续」(必选,无跳过),带品牌光晕。
      const foot = document.createElement('div');
      foot.className = 'cv-foot2';
      const ARROW_SVG =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'cv-confirm';
      go.innerHTML = `${aT('确认并继续', 'Confirm')}${ARROW_SVG}`;
      go.addEventListener('click', () => {
        if (sending) return;
        void runApplyDesign(sets[selected], sets[selected]?.pageBackground);
      });
      const glow = document.createElement('span');
      glow.className = 'btn-glow';
      glow.appendChild(go);
      foot.appendChild(glow);
      inner.appendChild(foot);
      // 挂进输入框上方的覆盖层并锁定输入(必选,盖住 chat-input)。
      const dock = byId('coverDock');
      if (dock) {
        dock.replaceChildren(inner);
        dock.style.display = '';
        setCoverLock(true);
      } else {
        chatBody!.appendChild(inner);
      }
      repaint();
      scrollChat();
    }

    async function runApplyDesign(
      set: { coverTemplateId: string; coverPhotoId: string; endingTemplateId: string; endingPhotoId: string; pageBackground?: string },
      pageBackground?: string,
      coverColorway?: string,
    ) {
      // main 的送出键单一真相源(setSending)+ design-work 的封面覆盖层清理,两者都保留。
      setSending(true);
      // 收起输入框覆盖层、解锁输入;选择作为「只读回执卡 + 用户气泡」进对话历史(与刷新回放同序)。
      closeCoverZoom();
      const dock = byId('coverDock');
      if (dock) { dock.replaceChildren(); dock.style.display = 'none'; }
      setCoverLock(false);
      const recap = buildCoverRecapCard(set, pageBackground);
      chatBody!.appendChild(recap);
      appendUserText(aT('就用这组封面', 'Use this cover set'));
      const host = appendThinkingShell();
      setThinkingLabel(host, 'Writing your book…');
      try {
        // 成稿要让模型**看真实照片**:原图只在浏览器,和排版一样把 200px 缩略图带上。
        // 本机照片没了也不拦着成书 —— 退化成只凭故事/章标题写(refs 空)。
        let refs: Record<string, string> = {};
        const photoIds = albumRecipe.load(albumId)?.photoIds ?? [];
        if (photoIds.length > 0) {
          try {
            refs = await selectLayoutRefsFromStore(photoIds);
          } catch {
            refs = {};
          }
        }
        if (Object.keys(refs).length === 0) {
          // 静默退化留痕:一张真图都没带上,整本书会变成「不看图写文案」(换浏览器、
          // 清站点数据、跨设备继续做都会走到这)。只记录,不拦成书。
          console.warn('[compose] no photo refs from IndexedDB — 整本书将不看图写文案', {
            albumId,
            photoIds: photoIds.length,
          });
        }
        if (disposed) return;
        const res = await fetch(`/api/v3/albums/${albumId}/design`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            language: currentLang === 'zh' ? 'zh' : 'en',
            // 不能 ...set 整个展开:第三套(mag-62)的 set 在运行时带着
            // design-apply.ts buildCoverSets 挂上的 colorways(类型里没有,
            // JSON 里有),route.ts 的 BodySchema 是 .strict(),未知键会被
            // 直接拒收(400),书组不出来。逐字段显式列,加字段以后不会再
            // 静默炸一次。
            coverTemplateId: set.coverTemplateId,
            coverPhotoId: set.coverPhotoId,
            endingTemplateId: set.endingTemplateId,
            endingPhotoId: set.endingPhotoId,
            ...(pageBackground ? { pageBackground } : {}),
            ...(coverColorway ? { coverColorway } : {}),
            refs,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'design failed');
        // compose 在 Agent 侧按章并发跑(几十秒起),完成回调才把成书落进服务端 draft。
        // 这里进轮询态:封面页一出现就原地刷画板(与排版同一套 waitFor… 机制)。
        // 游客占位成稿是同步落库的,轮询立刻兑现;成书亮相后跟一条迷你登录横幅
        // (不打断导出/加照片,只提示「登录解锁 AI 修改」)。
        void withWorkflowBusy(() => waitForComposeThenRefresh(host, recap)).then(() => {
          if (viewerAnonRef.current === true) showGuestNudge({ auto: true });
        });
      } catch (e) {
        settleThinking(host, 'analyzedFeedback');
        if (e instanceof UnauthorizedError) return;
        recap.remove(); // 设计没成:回执撤掉,重新给选择卡
        appendReplyBody(host, aT('设计这步没跑成,稍后再试一下。', 'The design step failed — try again in a moment.'));
        designOfferShown = false;
        void offerDesignCard();
      } finally {
        setSending(false);
        if (!disposed) { restAwait(); scrollChat(); }
      }
    }

    // 游客占位书 → 登录后自动补跑真 compose。占位成稿(copySource='placeholder')里
    // 文字只是模板示例样稿;真实账号第一次打开这本书时,从落库的 designApplied 恢复
    // 封面组,走 runApplyDesign 原路重发 POST /design —— 这次服务端按真成稿处理
    // (precheck+hold 计费、Gemini 写真文案、回调升 copySource='ai')。
    // 触发点两个:offerDesignCard 的 designed 分支(身份已知时),以及组件层
    // upgradeTriggerRef(/user/me 比聊天引擎晚就绪时补触发)。
    let placeholderUpgradeStarted = false;
    async function maybeUpgradePlaceholder(composingHint?: boolean) {
      if (disposed || placeholderUpgradeStarted) return;
      if (detail.album.copySource !== 'placeholder') return;
      if (viewerAnonRef.current !== false) return; // 游客或身份未知:不触发
      placeholderUpgradeStarted = true;
      let composing = composingHint;
      if (composing === undefined) {
        try {
          composing = Boolean((await fetchDesignState(albumId)).composing);
        } catch {
          placeholderUpgradeStarted = false;
          return;
        }
      }
      // 已有在途真 compose(比如另一个标签页触发过):接回轮询即可。
      if (composing) {
        const resuming = appendThinkingShell();
        setThinkingLabel(resuming, 'Writing your book…');
        void withWorkflowBusy(() => waitForComposeThenRefresh(resuming));
        return;
      }
      // 从消息历史恢复封面组(applyPlaceholderDesign 落库的 designApplied 带全量字段)。
      try {
        const res = await fetch(`/api/v1/albums/${albumId}/messages?limit=100`);
        const json = await res.json();
        if (!json.ok) throw new Error('messages fetch failed');
        const msgs = (json.data as Array<{ layoutPatch?: unknown }>) ?? [];
        let applied: {
          coverTemplateId: string;
          coverPhotoId: string;
          endingTemplateId: string;
          endingPhotoId: string;
          pageBackground?: string;
          coverColorway?: string;
        } | null = null;
        for (const m of msgs) {
          const patch = m.layoutPatch as { designApplied?: Record<string, unknown> } | null;
          const a = patch?.designApplied;
          if (
            a &&
            typeof a.coverTemplateId === 'string' &&
            typeof a.coverPhotoId === 'string' &&
            typeof a.endingTemplateId === 'string' &&
            typeof a.endingPhotoId === 'string'
          ) {
            applied = {
              coverTemplateId: a.coverTemplateId,
              coverPhotoId: a.coverPhotoId,
              endingTemplateId: a.endingTemplateId,
              endingPhotoId: a.endingPhotoId,
              ...(typeof a.pageBackground === 'string' && a.pageBackground
                ? { pageBackground: a.pageBackground }
                : {}),
              ...(typeof a.coverColorway === 'string' && a.coverColorway
                ? { coverColorway: a.coverColorway }
                : {}),
            };
          }
        }
        if (!applied) {
          console.warn('[placeholder-upgrade] no designApplied in history', { albumId });
          return;
        }
        appendAiText(
          aT(
            '登录成功!现在照你讲的故事把真文案写进书里,稍等片刻。',
            'Signed in — now writing your real story into the book, one moment.',
          ),
        );
        await runApplyDesign(applied, applied.pageBackground, applied.coverColorway);
      } catch {
        placeholderUpgradeStarted = false; // 网络抖动等,放过;下次进来再试
      }
    }
    upgradeTriggerRef.current = () => void maybeUpgradePlaceholder();

    // 成稿是 Agent 异步跑的(按章并发调 Gemini),成书落进服务端 draft 后回调推 stage='ready'。
    // 轮询草稿骨架,封面页一出现就派发 `yujee:authoring-pages-ready` 原地刷画板 —— 与
    // waitForLayoutThenRefresh 同一套机制(ChatPanel 不重挂,对话历史不丢)。
    async function waitForComposeThenRefresh(host: HTMLElement, recap?: HTMLElement) {
      // 兜底封顶:与服务端 job-service.COMPOSE_ZOMBIE_TIMEOUT_MS 同档(12 分钟),两处同改。
      // 10 章的大书按章并发看图写文案,跑过 5 分钟很正常 —— 封顶太短会在书落地前就
      // 把回执撤掉并谎报失败,几十秒后书又冒出来。
      const deadline = Date.now() + 12 * 60 * 1000;
      while (!disposed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        if (disposed) return;
        try {
          const { draft } = await fetchDraftSkeleton(albumId);
          if (draft && draft.pages.some((p) => p.kind === 'cover')) {
            if (disposed) return;
            settleThinking(host, 'analyzedFeedback');
            const root = outerRootRef.current;
            root?.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
            window.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
            appendReplyBody(
              host,
              aT('写好了:封面封底就位,全书文案、字体和配色也一起刷上了。不满意随时在对话里改。',
                 'All set — cover & back cover are in, and the whole book now has its copy, fonts and colors. Ask me here to tweak anything.'),
            );
            // 成稿完成 = stage 已推进到 ready:同步前端闸门(顶栏导出按钮),并弹导出就绪卡。
            await loadStoryGate();
            maybeAppendExportReadyCard();
            return;
          }
        } catch (e) {
          if (e instanceof UnauthorizedError) return; // 会话没了:停轮询,下一次用户操作会跳登录
          // 其它瞬时错误:继续轮询到封顶,不把错误灌进对话
        }
      }
      if (!disposed) {
        // 轮询到封顶不等于成稿失败:job 可能还在跑(服务端同档超时才判死)。回执卡留着
        // (撤了不会重建),也不重新给选择卡 —— 只告诉用户还在写,回头再来看。
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(
          host,
          aT('还在写呢,这本有点长。稍后回来看看,写好会直接出现在画板上。',
             'Still writing — this one is a long book. Come back in a bit and it will show up on the canvas.'),
        );
      }
    }

    // 追加范围成稿:排版落地后只为新章写文案(服务端派发 engine /v3/compose 空槽单)。
    async function triggerAppendCompose(scope: { chapterIds: string[]; photoIds: string[] }) {
      if (disposed) return;
      const host = appendThinkingShell();
      setThinkingLabel(host, 'Writing copy for the new pages…');
      setSending(true);
      try {
        let refs: Record<string, string> = {};
        try {
          refs = await selectLayoutRefsFromStore(scope.photoIds);
        } catch {
          // 原图不在本设备也照写:模型少看图,文案仍从章节上下文出。
        }
        if (disposed) return;
        const res = await composeAppendV3(albumId, {
          language: currentLang === 'zh' ? 'zh' : 'en',
          chapterIds: scope.chapterIds,
          refs,
        });
        if (disposed) return;
        if (!res.composed) {
          settleThinking(host, 'analyzedFeedback');
          maybeAppendExportReadyCard();
          return;
        }
        void withWorkflowBusy(() => waitForAppendComposeThenRefresh(host));
      } catch (e) {
        settleThinking(host, 'analyzedFeedback');
        if (!authErr(host, e)) {
          appendReplyBody(host, aT(
            '新照片排进去了,但文案没能开始写。在对话里跟我说「给新页写文案」,我来补。',
            "The new photos are in, but I couldn't start writing their copy. Tell me here to write it and I'll fill them in.",
          ));
          maybeAppendExportReadyCard();
        }
      } finally {
        setSending(false);
        if (!disposed) { restAwait(); scrollChat(); }
      }
    }

    // 轮询 /design 等追加成稿收尾:RUNNING → COMPLETED/FAILED。封顶与全书成稿同档 12 分钟。
    async function waitForAppendComposeThenRefresh(host: HTMLElement) {
      const deadline = Date.now() + 12 * 60 * 1000;
      while (!disposed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        if (disposed) return;
        try {
          const state = await fetchDesignState(albumId);
          if (state.composing) continue;
          settleThinking(host, 'analyzedFeedback');
          window.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
          // COMPLETED 不等于「真写出来了」:整章掉队时(pagesTexts 全空,或被 F1 的章
          // 归属守卫全数跳过)job 依旧 COMPLETED,只有 lastComposeWrote===false 才知道
          // 这次没写出东西 —— 这里改走与回调侧(job-service)同款的诚实文案,不再当场
          // 报假成功。lastComposeWrote 为 true 或 null(非追加单/信息缺失)时维持成功文案。
          appendReplyBody(host, state.lastComposeStatus === 'COMPLETED' && state.lastComposeWrote === false
            ? aT('新照片排进书里了,但这次文案没写出来。在对话里跟我说「给新页写文案」,我来补。',
                 "The new photos are in, but their copy didn't come through this time. Tell me here to write it and I'll fill them in.")
            : state.lastComposeStatus === 'COMPLETED'
              ? aT('新页面的文案写好了,和全书一个声音。不合口味随时在对话里改。',
                   'The new pages now have their copy, in the same voice as the rest of the book. Ask me here to tweak anything.')
              : aT('新照片排进去了,但文案没写上。在对话里跟我说「给新页写文案」,我来补。',
                   "The new photos are in, but their copy didn't come through. Tell me here to write it and I'll fill them in."));
          await loadStoryGate();
          maybeAppendExportReadyCard();
          return;
        } catch (e) {
          if (e instanceof UnauthorizedError) return;
          // 其它瞬时错误:继续轮询到封顶,不把错误灌进对话
        }
      }
      if (!disposed) {
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, aT('还在写新页面的文案,稍后回来看看,写好会直接出现在画板上。',
          'Still writing the new pages — come back in a bit and the copy will show up on the canvas.'));
      }
    }

    // 封面缩略图气泡放大:无遮罩,浮层 + 透明点击关闭层。
    function openCoverZoom(set: { coverTemplateId: string; coverPhotoId: string; endingTemplateId: string; endingPhotoId: string; pageBackground?: string }) {
      // 挂在整块聊天面板(.chat-card:relative + overflow-hidden)上居中浮现,
      // 而不是只有输入框高的 composer-group —— 否则气泡会溢出到面板/屏幕外。
      const host = outerRootRef.current?.querySelector('.chat-card');
      if (!host) return;
      closeCoverZoom();
      const X_SVG =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      const layer = document.createElement('div');
      layer.className = 'cv-zoom-layer';
      layer.innerHTML =
        `<div class="cv-bubble" role="dialog" aria-label="${aT('封面放大', 'Cover preview')}">` +
          `<button type="button" class="cv-bubble-x" aria-label="${aT('关闭', 'Close')}">${X_SVG}</button>` +
          `<div class="cv-bubble-faces">` +
            `<span class="cv-bubble-face">${co()?.coverOptionHTML?.(set.coverTemplateId, set.coverPhotoId, 132, 176, set.pageBackground) ?? ''}<i class="cv-face-tag">${aT('封面', 'Cover')}</i></span>` +
            `<span class="cv-bubble-face">${co()?.coverOptionHTML?.(set.endingTemplateId, set.endingPhotoId, 132, 176, set.pageBackground) ?? ''}<i class="cv-face-tag">${aT('封底', 'Back')}</i></span>` +
          `</div>` +
        `</div>`;
      layer.addEventListener('click', (e) => { if (e.target === layer) closeCoverZoom(); });
      layer.querySelector('.cv-bubble-x')?.addEventListener('click', () => closeCoverZoom());
      host.appendChild(layer);
    }
    function closeCoverZoom() {
      outerRootRef.current?.querySelector('.cv-zoom-layer')?.remove();
    }

    // 采访跳过:输入框上方并排两颗轻量小 pill(跳过本组 / 跳过剩下全部);整块 composer 变渐变容器。
    // 传 null = 采访结束/轮到 AI,收起 pill 并恢复普通输入框。
    function setInterviewSkips(chapterId: string | null) {
      const cg = outerRootRef.current?.querySelector('.composer-group');
      const slot = byId('interviewSkips');
      if (!slot) return;
      if (!chapterId) {
        slot.replaceChildren();
        slot.style.display = 'none';
        cg?.classList.remove('interview-active');
        return;
      }
      const disableSkip = () =>
        slot.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      const kicker = document.createElement('div');
      kicker.className = 'iv-kicker';
      kicker.textContent = aT('照片故事收集 · 可跳过', 'Photo notes · optional');
      const title = document.createElement('div');
      title.className = 'iv-title';
      title.textContent = aT('补充这组照片的背景', 'Add background for this group');
      const row = document.createElement('div');
      row.className = 'iv-skips-row';
      const skipOne = document.createElement('button');
      skipOne.type = 'button';
      skipOne.className = 'iv-skip';
      skipOne.textContent = aT('跳过本组', 'Skip this group');
      skipOne.addEventListener('click', () => {
        if (!pendingInterview || pendingInterview.chapterId !== chapterId) return;
        disableSkip();
        appendUserText(aT('这组照片背景先跳过', 'Skip this group'));
        void finishInterview('');
      });
      const skipAll = document.createElement('button');
      skipAll.type = 'button';
      skipAll.className = 'iv-skip iv-skip-ghost';
      skipAll.textContent = aT('跳过剩下全部', 'Skip all remaining');
      skipAll.addEventListener('click', () => {
        if (!pendingInterview || pendingInterview.chapterId !== chapterId) return;
        disableSkip();
        appendUserText(aT('剩下的照片背景都先跳过', 'Skip all remaining'));
        void skipRemainingInterviews();
      });
      row.append(skipOne, skipAll);
      slot.replaceChildren(kicker, title, row);
      slot.style.display = '';
      cg?.classList.add('interview-active');
    }

    async function startChapterInterview(chapterId: string, photoIds: string[]) {
      if (disposed) return;
      setInterviewSkips(null); // 轮到 AI 提问:先收起上一组的跳过 pill,答/问完再显示
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
      // 采访轮到用户:composer 变成渐变容器,输入框上方并排两颗轻量小跳过 pill(输入框照常可用)。
      setInterviewSkips(chapterId);
      updateAuthInputPlaceholder();
      restAwait();
      scrollChat();
    }

    async function runChapterGuideOpener(opts?: { allowDuringSend?: boolean }) {
      if (disposed) return;
      if (!isAuthoring || (!opts?.allowDuringSend && sending)) return;
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
      if (!first) {
        // 采访链尾巴(Phase 0 续跑修正,2026-07 复核拍板):排版此前只从"活的采访链"尾部
        // 触发(finishInterview 最后一章 → triggerSelectLayout)。刷新/重进后链是断的:
        // 所有章的故事都齐了(或全为 photo-only)却零页 —— 上个会话的 layout job 本会话
        // 没人等,FAILED/没提交成功更没人重试,画板永远空白。这里把链尾补回来:零页且未在
        // 排版中 → 当场触发整本排版。triggerSelectLayout 自带 selectLayoutTriggered 防重入、
        // 服务端 QUEUED/RUNNING 幂等去重、recipe 缺失(原始照片不在本设备)的兜底文案。
        // 安全边界:
        // · chapterOrder 为空(storyGate 没加载成功/异常相册)不触发 —— 空 order 时 first
        //   恒为 null,不挡会对"没有章节"的相册误发排版;
        // · layoutState==='running' 不触发 —— 挂载解析器已在 waitForLayoutThenRefresh 等它;
        // · 画板与草稿骨架双读为零才触发 —— coordinator 未就绪的瞬间不把已排好的书误判为空;
        // · selectLayoutTriggered 已置(本会话已触发、轮询在跑)不重复提示/触发。
        const canvasPages = co()?.getPagesState?.()?.length ?? 0;
        const skeletonPages =
          latestAuthoringRef.current.draftChapters?.pages.length ?? draftSkel?.pages.length ?? 0;
        if (
          canvasPages === 0 &&
          skeletonPages === 0 &&
          !selectLayoutTriggered &&
          (storyGate?.chapterOrder.length ?? 0) > 0 &&
          storyGate?.layoutState !== 'running'
        ) {
          appendAiText(
            aT(
              '所有章节的故事都齐了,我这就为整本书排版~',
              'All your chapter stories are in — laying out the whole book now.',
            ),
          );
          await triggerSelectLayout();
        }
        interviewChainStartedRef.current = false;
        return;
      }
      guidedChapters.add(first);
      chapterHistory.length = 0;
      co()?.goToChapterById?.(first);
      appendChapterCard(first);
      const meta = chapterMetaById(first);
      await startChapterInterview(first, meta?.photoIds ?? []);
    }
    void openerInFlight;

    function appendEditLoopReadyCard(chapterId: string) {
      if (!isAuthoring || latestAuthoringRef.current.mode !== 'authoring') return;
      if (pendingInterview) return;
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
        'The layout is ready. Tell me what to change in this group, or say “looks good” to continue.',
      );
      card.appendChild(body);
      chatBody!.appendChild(card);
      restAwait();
      scrollChat();
    }


    // 游客迷你登录横幅(#guestAlert,balanceAlert 同款容器):固定在输入框正上方,
    // 只切显隐、不进消息流、不锁输入 —— 采访/加照片/导出照常,点「登录」才离开。
    // 手动关过(×)本次挂载内不再自动弹;游客再次打字仍会重新亮起(那是明确意图)。
    let guestNudgeDismissed = false;
    function showGuestNudge(opts?: { auto?: boolean }) {
      if (opts?.auto && guestNudgeDismissed) return;
      const card = byId('guestAlert');
      if (!card) return;
      card.style.display = '';
      scrollChat();
    }

    function showPurchaseCard() {
      // 横幅固定在 composer-group 内(输入框正上方),只切显隐、绝不搬进消息流;
      // 同时禁用发送按钮 —— 没积分就别让消息发出去再报错。
      const card = byId('balanceAlert');
      if (card) {
        card.style.display = '';
      } else {
        appendAiText(aT('积分不足，去充值后即可继续。', 'Out of credits — top up to keep creating.'));
      }
      outOfCredits = true;
      refreshSendDisabled();
      scrollChat();
    }

    // Called by CreditsPurchaseModal once it detects the balance topped up (webhook
    // settled). Undo showPurchaseCard(): hide the banner, re-enable send, and drop a
    // light confirmation. We do NOT auto-resend the blocked message — the user's draft
    // is still in the input (send was only disabled, never cleared), so re-enabling send
    // lets them continue on their own.
    toppedUpHandlerRef.current = () => {
      const alert = byId('balanceAlert');
      if (alert) alert.style.display = 'none';
      outOfCredits = false;
      refreshSendDisabled();
      appendAiText(aT('积分已到账，继续吧～', 'Credits added — let’s keep going.'));
      restAwait();
      scrollChat();
    };

    function updateAuthInputPlaceholder() {
      if (!input) return;
      input.setAttribute('placeholder', '');
    }

    async function runEdit(_message: string) {
      appendAiText(
        aT(
          '旧版聊天改稿已下线，不会再改动当前版面。请继续使用 V3 流程：确认分组故事、选择主题与封面，然后导出 PDF。',
          'Legacy chat editing has been retired and will no longer change this layout. Continue with the V3 flow: confirm group stories, choose the theme and cover, then export the PDF.',
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
      void stageAddedPhotos(files);
    };
    addPhotoInputEl?.addEventListener('change', onAddPhotosChange);

    // ── data-action handlers within ChatPanel's OWN subtree only (the aside). The
    // canvas/topbar/modals bind their own data-action nodes in EditorBook, so we scope
    // the sweep to the chat column to avoid double-binding. ──
    const asideRoot = root.querySelector('.pane-chat-col') as HTMLElement | null;
    const actions: Record<string, () => void> = {
      // Open the in-editor purchase modal instead of navigating to /credits — the editor
      // tab must never leave the task. Covers both entry points (the #balanceAlert "去购买"
      // button and any showPurchaseCard() surface), since both route through data-action.
      buyShells: () => { setCreditsModalOpen(true); },
      // #balanceAlert 的关闭按钮:收起横幅并清掉「缺积分」禁用。走 data-action(而非 JSX 内联),
      // 才能落到 outOfCredits + refreshSendDisabled 这个单一真相源上,与 sending 统一。
      dismissBalanceAlert: () => {
        const alert = byId('balanceAlert');
        if (alert) alert.style.display = 'none';
        outOfCredits = false;
        refreshSendDisabled();
      },
      // 游客横幅:登录带回跳(登录成功即转正过户 + 自动补跑真文案,回到本相册继续)。
      guestLogin: () => {
        window.location.assign(localizePath(`/login?from=/album/${albumId}`, locale));
      },
      dismissGuestAlert: () => {
        const alert = byId('guestAlert');
        if (alert) alert.style.display = 'none';
        guestNudgeDismissed = true;
      },
      // 中途加图(spec §1):排版完成后可用;采访/发送/追加进行中不响应。
      pickAddPhotos: () => {
        // 加图现在只「暂存」不立即提交(先攒后发),所以 AI 思考 / 排版中(sending /
        // appendInFlight)也允许打开图库攒照片 —— 只有「发送」键在忙时禁用,「添加」不禁用。
        // 采访轮到用户(pendingInterview)时不弹,避免和「回答问题」的发送语义打架。
        if (!isAuthoring || pendingInterview) return;
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

      // 画板中线补偿:聊天面板是左侧浮层(position:fixed,脱离文档流),书用 flex 居中
      // 会偏到面板底下。把面板实时占据的左侧宽度写进 root 的 --canvas-inset,book-stage /
      // 底部居中 pill / 顶部提示条据它右移,居中于面板右侧的可见区(见 editor-port.css)。
      // 折叠 / 移动端 / 面板被拖到右半区 => 0(不补偿)。
      const canvasInset = () => {
        if (!desktop() || root.classList.contains('chat-collapsed')) return 0;
        const r = chatColEl.getBoundingClientRect();
        if (r.width < 1) return 0;
        if (r.left > window.innerWidth * 0.4) return 0; // 面板不在左侧停靠区,不挡中线
        return Math.max(0, Math.round(r.right + margin));
      };
      const updateCanvasInset = () => {
        root.style.setProperty('--canvas-inset', `${canvasInset()}px`);
      };
      // ResizeObserver 抓面板宽度变化(resize 手柄 / 折叠展开的 width 动画 / 断点切换);
      // MutationObserver 抓 root 的 class 变化(折叠 chat-collapsed 即时归零);拖动改
      // inline left 不改尺寸,由 drag move 里手动调用兜住。
      const insetRO = new ResizeObserver(updateCanvasInset);
      insetRO.observe(chatColEl);
      const insetMO = new MutationObserver(updateCanvasInset);
      insetMO.observe(root, { attributes: true, attributeFilter: ['class'] });

      function resetForViewport() {
        if (!desktop()) resetChatPos();
        updateCanvasInset();
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
          updateCanvasInset(); // 拖动只改 left,ResizeObserver 不触发,手动跟随
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

      // ── 移动端底部高弹窗(bottom sheet)──
      // 底边钉死;拖动手柄 = 折叠/展开【面板自身高度】(不整体位移):下拉缩短、上拉增高
      // (上限 90vh、下限 150px)。拖到明显低于下限 / 轻点 → 完全收起成黑色小气泡(.chat-collapsed
      // 隐藏弹窗 + 显示 .chat-fold-expand FAB);点气泡(toggleChat)再展开,恢复上次高度。
      const mobileHandleEl = rootEl.querySelector('.chat-mobile-handle') as HTMLElement | null;
      let sheetRestoreH: number | null = null; // 记住手动拉出的高度,收起再展开时恢复
      const onSheetDown = (e: PointerEvent) => {
        if (desktop() || e.button !== 0 || !mobileHandleEl) return;
        e.preventDefault();
        const vh = window.innerHeight;
        const minH = 150;
        const maxH = Math.round(vh * 0.9);
        const startH = chatColEl.getBoundingClientRect().height;
        const startY = e.clientY;
        let dy = 0;
        let curH = startH;
        let collapseIntent = false;
        document.body.classList.add('chat-dragging');
        root.classList.add('chat-dragging');
        mobileHandleEl.setPointerCapture?.(e.pointerId);
        const move = (ev: PointerEvent) => {
          dy = ev.clientY - startY;
          const raw = startH - dy; // 底部固定:下拉(dy>0)高度减小
          collapseIntent = raw < minH - 28; // 拖到明显低于下限 → 意图完全收起
          curH = clamp(raw, minH, maxH);
          chatColEl.style.height = `${curH}px`;
        };
        const end = (ev: PointerEvent) => {
          mobileHandleEl.releasePointerCapture?.(ev.pointerId);
          document.body.classList.remove('chat-dragging');
          root.classList.remove('chat-dragging');
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          if (Math.abs(dy) <= 6 || collapseIntent) {
            // 完全收起 → 黑色气泡;为下次展开留一个合理高度(拖没了就回落默认 46vh)
            const restore = sheetRestoreH ?? (Math.abs(dy) <= 6 ? startH : Math.round(vh * 0.46));
            chatColEl.style.height = `${clamp(restore, minH, maxH)}px`;
            root.classList.add('chat-collapsed');
            return;
          }
          sheetRestoreH = curH; // 记住这次拉出的高度
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
      };
      mobileHandleEl?.addEventListener('pointerdown', onSheetDown);

      dragHandleEl.addEventListener('pointerdown', onDragDown);
      dragHandleEl.addEventListener('dblclick', resetChatPos);
      resizeHandleEl.addEventListener('pointerdown', onResizeDown);
      window.addEventListener('resize', resetForViewport);
      resetForViewport();

      return () => {
        clearActiveMotion();
        insetRO.disconnect();
        insetMO.disconnect();
        root.style.removeProperty('--canvas-inset');
        mobileHandleEl?.removeEventListener('pointerdown', onSheetDown);
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
      void primeHistoryFetch(); // 与 storyGate 并行取,渲染仍等 storyGate(见上)
      void loadStoryGate().then(() => loadHistory()).then((shown) => {
        if (disposed) return;
        restAwait();
      });
    }

    if (isAuthoring) {
      $('.authoring-finish-bar')?.remove();
      setChatState(3);
      updateAuthInputPlaceholder();
      void primeHistoryFetch(); // 与 storyGate 并行取,渲染仍等 storyGate(见上)
      void loadStoryGate().then(() => loadHistory()).then((shown) => {
        // dev 双挂载/快速路由切换:被清理实例的异步链在这之后还会 resolve,
        // 不拦会把回执卡/导出卡追加到新实例的 DOM 里(实测出现重复卡)。
        if (disposed) return;
        restAwait();
        const liveChapterId = storyGate?.currentChapterId ?? null;
        if (liveChapterId) co()?.goToChapterById?.(liveChapterId);
        const stage = storyGate?.stage;
        // 0 页单一漏斗(Phase 0 续跑修正,2026-07 复核拍板):排版中断的真实形态是
        // stage=story、currentChapterId 非空、allDone=false(markChapterDone 无浏览器调用方,
        // allDone 是死信号,不能当续跑闸)—— 旧代码按 stage/shown 分支接不住它:0 页重进
        // 会被 shown>0 的空当或 offerDesignCard 的 hasPages=false 静默 return 吞掉,画板
        // 死白无入口。改成画板 0 页一律先进续跑漏斗,由服务端 job 真相(layoutState)+
        // 采访完备性(runChapterGuideOpener)决定去向:
        // · running → 接着等它落地(完成分支刷画板+弹设计卡,超时分支复位并提示);
        // · 其余(idle/failed/信号缺失)→ opener:对 context 为空的章续采访(历史回放过的
        //   问答不会重复),全部齐了走 opener 链尾直接重排。不受 shown===0 门限制(opener
        //   自带 interviewChainStartedRef/pendingInterview 防重入)。
        if ((co()?.getPagesState?.()?.length ?? 0) === 0) {
          if (liveChapterId) appendChapterCard(liveChapterId);
          if (storyGate?.layoutState === 'running') {
            appendAiText(
              aT(
                '上次的排版还在进行中,完成后会自动出现~',
                'Your last layout is still running — it will show up here automatically once it finishes.',
              ),
            );
            const host = appendThinkingShell();
            void withWorkflowBusy(() => waitForLayoutThenRefresh(host, { minPages: 1 }));
          } else {
            void runChapterGuideOpener();
          }
        } else if (liveChapterId) {
          appendChapterCard(liveChapterId);
          if (currentChapterHasDraftPages()) {
            appendEditLoopReadyCard(liveChapterId);
          } else if (shown === 0) {
            void runChapterGuideOpener();
          }
        } else if (stage === 'theme' || stage === 'ready') {
          // 设计环节可重入(导出闸门收紧后设计是必经步骤):采访做完(stage=theme)或刷新后
          // 回到 ready,都要能重新拿到封面组选择卡。offerDesignCard 自查 designed/hasPages,
          // 已设计过或无排版页则静默不弹,幂等安全。
          void offerDesignCard();
          if (stage === 'ready') {
            // 封面回执:designApplied 标记落库后由 loadHistory 原位重建;这里只给
            // 标记落库前设计完的老相册兜底(尾部补一张,别让回执彻底消失)。
            if (!historyHadCoverRecap && !chatBody?.querySelector('.cv-opt.is-recap')) {
              appendCoverSummary();
            }
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
      upgradeTriggerRef.current = null;
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
    <>
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
          {/* 必选封面选择卡的挂载点:盖在输入框上方的覆盖层,offerDesignCard 填充 */}
          <div className="cover-dock" id="coverDock" style={{ display: 'none' }} />
          {/* 采访时输入框上方并排的两颗轻量跳过 pill,setInterviewSkips 填充 */}
          <div className="interview-skips" id="interviewSkips" style={{ display: 'none' }} />
          <div className="buy-banner" id="balanceAlert">
            <div className="buy-banner-row">
              <div className="buy-banner-title flex-1 min-w-0" data-i18n="bpLead">{locale === 'zh' ? '积分已用完，补充积分继续' : 'Out of credits. Top up to continue.'}</div>
              <button className="buy-banner-btn" data-action="buyShells" data-i18n="bpBuy">{locale === 'zh' ? '去购买' : 'Buy'}</button>
              <button className="buy-close" type="button" data-action="dismissBalanceAlert" aria-label={locale === 'zh' ? '关闭' : 'Close'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>
          {/* 游客迷你登录横幅:占位成书后提示「登录解锁 AI 修改」。showGuestNudge 切显隐,
              不锁输入不进消息流;样式复用 buy-banner(与积分横幅同款,天然不突兀)。 */}
          <div className="buy-banner" id="guestAlert" style={{ display: 'none' }}>
            <div className="buy-banner-row">
              <div className="buy-banner-title flex-1 min-w-0">
                {locale === 'zh' ? '文字是示例样稿 · 登录后 AI 按你讲的故事写真文案、改设计' : 'Sample copy for now · sign in and AI writes your real story'}
              </div>
              <button className="buy-banner-btn" data-action="guestLogin">{locale === 'zh' ? '登录' : 'Sign in'}</button>
              <button className="buy-close" type="button" data-action="dismissGuestAlert" aria-label={locale === 'zh' ? '关闭' : 'Close'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>
          <div className="chat-input shrink-0 bg-surface border border-bdsoft flex flex-col transition-all" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {/* 加图「先攒后发」:点 + 暂存的照片缩略图排这里(× 可移除),点发送才提交。renderStagedThumbs 命令式填充。 */}
            <div className="staged-photos" id="stagedPhotos" style={{ display: 'none' }} />
            {/* 暂存压缩进度:stageAddedPhotos 逐张压缩时显示「正在处理照片 N/M」,命令式切换。 */}
            <div className="staged-progress" id="stagedProgress" role="status" aria-live="polite" style={{ display: 'none' }} />
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
                <button className="send-btn w-8 h-8 rounded-full bg-fg text-white flex items-center justify-center cursor-pointer transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:hover:translate-y-0" id="sendBtn" data-i18n-title="send" title="发送">
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
    <CreditsPurchaseModal
      open={creditsModalOpen}
      locale={locale}
      onClose={() => setCreditsModalOpen(false)}
      onToppedUp={() => {
        setCreditsModalOpen(false);
        toppedUpHandlerRef.current();
      }}
    />
    </>
  );
}
