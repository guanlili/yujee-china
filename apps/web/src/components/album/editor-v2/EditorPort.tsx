'use client';

/* ════════════════════════════════════════════════════════════════════════════
   EditorPort — faithful 1:1 React port of
   /Users/smalldog/Desktop/yujee-editor/editor.html

   Phase A: static, demo-driven. The HTML's <body> markup is transcribed to JSX
   (class→className, self-closing tags, for→htmlFor) preserving class names, DOM
   hierarchy and data-* attributes. The HTML's <script> behaviour (i18n, flipbook,
   zoom, overview, thumbnails, dropdowns, chat, photo picker, new-chapter flow) is
   ported verbatim into one effect that runs the same imperative logic, scoped to
   this component's root element (rootRef) instead of document/body, so motion and
   timing match the original exactly.

   Styling lives in ./editor-port.css (the HTML <style> block, values unchanged).
   ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { signOut } from '@/lib/auth/client';
import { photoStore, RASTER_PDF_IMAGE_MAX_EDGE } from '@/lib/photo/store';
import { UserAvatar } from '@/components/app/UserAvatar';
import { YujeeState } from '@/components/app/YujeeState';
import { getWebTemplate } from '../web-registry';
import { buildSpreads, isSoloSpread, spreadIndexOfPage } from '../spreads';
import { adaptPageToTemplateData, collectPhotoIds, type ResolveImage } from '../adapt-layout';
import { renderPageHtml } from '../templates/html/fill-template';
import { PAGE } from '../templates/constants';
import { clampZoom, paintDecision } from './zoom-util';
import {
  clampImagePos,
  dragToImagePos,
  zoomImagePos,
  DEFAULT_IMAGE_POS,
  SCALE_MIN,
  SCALE_MAX,
  type ImagePosValue,
} from './image-edit-util';
import { computeExportUnlocked } from './export-gate-util';
import { runExportWithRetry, buildExportFailureLog, ExportError } from './export-retry-util';
import { logger } from '@/lib/log/logger';
import { loadAlbumFonts, useAlbumFonts } from '@/lib/font/album-font-loader';
import {
  extractPhotoIds,
  applyPatchToPages,
  type AlbumDetail,
  type EditorPage,
  type LayoutPatchEntry,
  type StoryProgress,
} from '../types';
import {
  fetchDraftSkeleton,
  type DraftEditResult,
  type DraftSkeleton,
} from '@/lib/album/authoring-client';
import type { V3PageTextsPatch } from '@yujee/contracts';
import { getTemplate, TEMPLATE_IDS } from '@yujee/contracts/templates';
import { ChatPanel, type ChatMode } from './ChatPanel';
import {
  ChatCoordinatorContext,
  chatI18n,
  type ChatCoordinator,
  type DraftActApplied,
} from './editor-coordinator';
import './editor-port.css';

// The editor now spans the whole album lifecycle (W10 flow unification): the same
// EditorPort chrome renders for a still-generating album (building), a draft being
// authored (authoring), and a finalized album being edited (editing). page.tsx
// derives the mode from album.status + layoutJson and always mounts EditorPort.
//   • loading   → editor resources are still loading: full-screen app loader only.
//   • building  → AGENT_RUNNING / AI waiting: canvas shell + chat thinking notice.
//   • authoring → EDITING & layoutJson==null: draft skeleton (read-only, invariant
//                 12) feeds the flipbook + rail; init (#161) already wrote the full
//                 first draft, so the chat rail does pointed single-page copy edits
//                 via /draft-edit (#162) — no theme→chapter dialog, no finalize CTA.
//   • editing   → layoutJson set: the original finalized editor, untouched.
export type EditorMode = 'loading' | 'building' | 'authoring' | 'editing';
const CONFIRM_CHAPTER_COMMAND = '[confirm-chapter]';

// Generation progress from the album poll (use-album-poll); only meaningful in
// building mode, where stage drives the loading-chat copy. Optional so the other
// (authoring/editing) call sites are unaffected.
export type GenerationProgress = { stage: string | null; progress: number } | null;

export function EditorPort({
  detail,
  locale,
  mode = 'editing',
  generation = null,
}: {
  detail: AlbumDetail;
  locale: Locale;
  mode?: EditorMode;
  generation?: GenerationProgress;
}) {
  // loading: UI/editor resources are not ready yet. Do not show half-loaded canvas
  // or chat chrome; those appear only after the resource load resolves.
  if (mode === 'loading') {
    return <EditorLoadingState locale={locale} />;
  }
  // building: nothing to render yet — same editor chrome in its building state:
  // cover skeleton + a static loading-chat notice. The poll in page.tsx flips us to
  // authoring/editing, which remounts into the real (stable-shell) editor.
  if (mode === 'building') {
    return <BuildingShell detail={detail} locale={locale} generation={generation} />;
  }
  // authoring: the draft skeleton is async (GET /draft) and the originals resolve
  // from IndexedDB, so we resolve everything first, then mount the stable shell.
  if (mode === 'authoring') {
    return <EditorAuthoring detail={detail} locale={locale} />;
  }
  // editing: the original finalized editor, fed straight from detail.pages, through
  // the same stable shell (canvas EditorBook + stable ChatPanel).
  return (
    <EditorShell
      mode="editing"
      detail={detail}
      locale={locale}
      initialPages={detail.pages}
      draftChapters={null}
      initialImageUrls={{}}
    />
  );
}

function EditorLoadingState({ locale }: { locale: Locale }) {
  return (
    <div className="editor-port font-sans antialiased leading-relaxed bg-bg text-fg" data-screen-label="02 Yujee Editor Loading">
      <div className="page-glow" aria-hidden="true" />
      <div className="ed-loader" role="status" aria-live="polite">
        <YujeeState
          variant="loading"
          title="Loading"
          showDots
        />
      </div>
    </div>
  );
}

// Human-readable copy for the live generation stage shown in the building
// loading chat. Falls back to the first-frame analyze line when the stage is
// null/unknown. Uses the same local
// dictionary convention as the rest of EditorPort (no messages/*.json).
function buildingStageLabel(stage: string | null | undefined, locale: Locale): string {
  const zh = locale === 'zh';
  switch (stage) {
    // V3 分析环节 (五环节状态机, WP1.5/#184): the /v3/analyze job streams these stage
    // labels via the progress callback (agent V3JobStage: describe→group→template→
    // preview). 'describe' is the first beat the user sees after the ≤0.5s nav, so it
    // carries the "正在看照片…" copy the loading chat needs.
    case 'describe':
      return zh ? '正在看照片…' : 'Looking at your photos…';
    case 'group':
      return zh ? '正在整理这些瞬间…' : 'Grouping your moments…';
    case 'template':
      return zh ? '正在编排版式…' : 'Laying out the spreads…';
    case 'preview':
      return zh ? '正在生成预览…' : 'Building your preview…';
    // V2 stage labels (kept until the v1/v2 teardown, #197).
    case 'vision':
      return zh ? '正在看你的照片…' : 'Looking at your photos…';
    case 'grouping':
      return zh ? '正在整理这些瞬间…' : 'Grouping your moments…';
    case 'skeleton':
      return zh ? '正在编排版式…' : 'Laying out the spreads…';
    case 'writing':
      return zh ? '正在撰写文案…' : 'Writing your story…';
    case 'finalize':
      return zh ? '正在生成终稿…' : 'Putting the final touches…';
    default:
      return zh ? '正在看照片…' : 'Looking at your photos…';
  }
}

// building: keep the board itself generic while the chat rail carries the live
// AI progress copy.
function BuildingCanvasState({ locale }: { locale: Locale }) {
  return (
    <div
      className="building-canvas-loading rounded-full bg-white/80 px-5 py-2.5 text-[14px] font-medium text-[var(--muted)] shadow-[0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur"
      role="status"
      aria-live="polite"
    >
      {locale === 'zh' ? '加载中' : 'Loading'}
    </div>
  );
}

// ── authoring: resolve the draft skeleton + originals, then mount EditorBook ──
function EditorAuthoring({ detail, locale }: { detail: AlbumDetail; locale: Locale }) {
  const [skeleton, setSkeleton] = useState<DraftSkeleton | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'gone'>('loading');
  // 每次 pages-ready 刷新自增：设计对话可能只改文字（页数不变），canvasEpoch 进
  // EditorBook 的 key 保证画板仍会重挂重绘。
  const [canvasEpoch, setCanvasEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDraftSkeleton() {
      try {
        const { draft } = await fetchDraftSkeleton(detail.album.id);
        if (cancelled) return;
        if (!draft) {
          setLoadState('gone');
          return;
        }
        // Resolve originals (invariant 1: photos live only in the browser). Missing
        // ids render as empty slots — fine.
        const ids = new Set<string>();
        for (const p of draft.pages) for (const id of Object.values(p.imagesJson)) if (id) ids.add(id);
        // 排版前 pages 为空,照片来自章节(收集面板的章节卡片 + 画板照片平铺都要它)。
        for (const ch of draft.chapters) for (const id of ch.photoIds ?? []) if (id) ids.add(id);
        const urls = await photoStore.getObjectUrls([...ids]);
        if (cancelled) return;
        setImageUrls(urls);
        setSkeleton(draft);
        setLoadState('ready');
        // 关键：epoch 在新草稿设好之后才自增，保证 EditorBook 的 key 变化时拿到的是
        // 最新 pages。若在 fetch 之前自增，只改文字（页数不变）时 key 会先用旧数据
        // 重挂、新数据到达时 key 又相同 → 画板停在旧内容不刷新。
        setCanvasEpoch((epoch) => epoch + 1);
      } catch {
        if (!cancelled) setLoadState('error');
      }
    }

    const onAuthoringPagesReady = () => {
      void loadDraftSkeleton();
    };

    void loadDraftSkeleton();
    window.addEventListener('yujee:authoring-pages-ready', onAuthoringPagesReady);
    return () => {
      cancelled = true;
      window.removeEventListener('yujee:authoring-pages-ready', onAuthoringPagesReady);
    };
  }, [detail.album.id, detail.album.stage, detail.album.status]);

  if (loadState === 'error' || loadState === 'gone') {
    // Don't sit on the "tidying up" screen forever — surface the real dead-end and
    // let the user refresh (a fresh load re-polls and re-derives the mode).
    const zh = locale === 'zh';
    return (
      <div className="editor-port flex h-screen flex-col items-center justify-center bg-bg text-center">
        <YujeeState
          variant="error"
          title={zh ? '出错了' : 'Something went wrong'}
          message={loadState === 'gone'
            ? zh ? '这本相册还没有草稿，或已经完成。' : 'This album has no draft yet, or it is already finished.'
            : zh ? '草稿加载失败。' : 'Failed to load the draft.'}
        >
          <button onClick={() => window.location.reload()} className="text-accent underline underline-offset-2 text-[13px]">
          {zh ? '刷新重试' : 'Refresh'}
          </button>
        </YujeeState>
      </div>
    );
  }
  if (loadState !== 'ready' || !skeleton) {
    return <EditorLoadingState locale={locale} />;
  }

  // Feed the skeleton's flattened page list straight into the flipbook (its shape
  // already matches EditorPage). draftChapters drives the rail with real labels.
  // NOTE: the canvas (EditorBook) is keyed by pages.length inside the shell, so a
  // layout completion (pages 0→N) remounts ONLY the canvas — the stable ChatPanel
  // (keyed by album.id) keeps its history/interview state.
  const pages: EditorPage[] = skeleton.pages.map((p) => ({
    pageIndex: p.pageIndex,
    templateId: p.templateId,
    imagesJson: { ...p.imagesJson },
    textsJson: { ...p.textsJson },
    imagePosJson: { ...(p.imagePosJson ?? {}) },
  }));
  return (
    <EditorShell
      mode="authoring"
      detail={detail}
      locale={locale}
      initialPages={pages}
      draftChapters={skeleton}
      initialImageUrls={imageUrls}
      canvasEpoch={canvasEpoch}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EditorShell — the STABLE outer chrome. It owns the shared outer `.editor-port`
// rootRef, the coordinator ref (EditorBook populates it), and the story-progress
// React state (topbar export gate + breadcrumb read it; chat mutates it). It renders
// the topbar + workspace layout + modals, mounting the canvas EditorBook (keyed by
// pages.length so a layout completion remounts only the canvas) BEFORE the stable
// ChatPanel (keyed by album.id) — EditorBook's effect fires first and populates the
// coordinator before ChatPanel's mount auto-actions run (which also guard on
// coordinator.current?.ready).
// ════════════════════════════════════════════════════════════════════════════
function EditorShell({
  detail,
  locale,
  mode,
  initialPages,
  draftChapters,
  initialImageUrls,
  canvasEpoch,
}: {
  detail: AlbumDetail;
  locale: Locale;
  mode: ChatMode;
  initialPages: EditorPage[];
  draftChapters: DraftSkeleton | null;
  initialImageUrls: Record<string, string>;
  canvasEpoch?: number;
}) {
  const fontsReady = useAlbumFonts(initialPages.map((page) => ({ texts: page.textsJson })));
  const outerRootRef = useRef<HTMLDivElement>(null);
  const coordinator = useRef<ChatCoordinator | null>(null);
  const [storyProgress, setStoryProgress] = useState<StoryProgress | null>(null);
  const [, setStoryProgressLoading] = useState(mode === 'authoring');
  const [, setStoryConfirming] = useState(false);

  const breadcrumbStage = storyProgress?.stage ?? detail.album.stage ?? 'analysing';
  // §4.2: chapter confirmation moved off the breadcrumb into the in-flow satisfaction
  // card. hasStoryGate is kept only for the authoring export-lock口径 below (§4.5a).
  const hasStoryGate = (storyProgress?.chapterOrder.length ?? 0) > 0;
  // 导出闸门(WP5.2 / §4.5a). authoring 以 storyProgress 的 live stage 为准(EDITING 轮询
  // 会停止,detail.album.stage 可能仍停在 story);editing 沿用旧路径,不前端锁。
  const authoringExportLocked =
    mode === 'authoring' &&
    (storyProgress === null ||
      (hasStoryGate && !computeExportUnlocked(breadcrumbStage, storyProgress.allDone)));
  const exportUnlocked = mode !== 'authoring' || !authoringExportLocked;

  return (
    <ChatCoordinatorContext.Provider value={coordinator}>
      <div
        ref={outerRootRef}
        data-album-fonts-ready={fontsReady}
        className="editor-port font-sans antialiased leading-relaxed"
        data-screen-label="02 Yujee Editor"
      >
        <div className="page-glow" aria-hidden="true" />
        <EditorTopbar locale={locale} exportUnlocked={exportUnlocked} coordinator={coordinator} />

        <div className="workspace flex-1 overflow-hidden relative md:flex" style={{ height: 'calc(100vh - 56px)' }}>
          <button className="chat-fold-expand" data-action="toggleChat" data-i18n-title="expandChat" title="展开对话" aria-label="展开对话">
            <img className="fab-jelly" src="/jellyfish-icon.png" alt="" />
            <svg className="fab-chat-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span>{locale === 'zh' ? '对话' : 'Chat'}</span>
          </button>

          {/* Canvas: keyed by pages.length so a layout completion (0→N) remounts ONLY
              the canvas. EditorBook scopes its effect to the shared outer root. */}
          <EditorBook
            key={`${initialPages.length}:${canvasEpoch ?? 0}`}
            mode={mode}
            detail={detail}
            locale={locale}
            initialPages={initialPages}
            draftChapters={draftChapters}
            initialImageUrls={initialImageUrls}
            outerRootRef={outerRootRef}
            coordinator={coordinator}
          />

          {/* Stable chat rail: keyed by album.id so an EditorBook remount doesn't
              touch it. It reaches the canvas/export subsystem via coordinator. */}
          <ChatPanel
            key={detail.album.id}
            detail={detail}
            locale={locale}
            mode={mode}
            draftChapters={draftChapters}
            outerRootRef={outerRootRef}
            coordinator={coordinator}
            breadcrumbStage={breadcrumbStage}
            storyProgress={storyProgress}
            setStoryProgress={setStoryProgress}
            setStoryProgressLoading={setStoryProgressLoading}
            setStoryConfirming={setStoryConfirming}
          />
        </div>

        <EditorModals />
      </div>
    </ChatCoordinatorContext.Provider>
  );
}

// The topbar (export button + user menu). Lives in the stable shell; EditorBook's
// mount effect wires its data-action/back/brand/user-menu nodes (it walks the shared
// outer root). The export button's disabled/glow口径 is prop-driven (exportUnlocked)
// AND toggled live via coordinator.setExportGateUi when the story gate advances.
function EditorTopbar({
  locale,
  exportUnlocked,
  coordinator,
}: {
  locale: Locale;
  exportUnlocked: boolean;
  coordinator: RefObject<ChatCoordinator | null>;
}) {
  void coordinator; // the export button's data-action is wired by EditorBook via the shared root
  return (
    <div className="topbar nav-shell sticky top-0 z-50 h-14 flex items-center justify-between px-3 sm:px-6 shrink-0">
      <div className="top-left flex items-center gap-2 sm:gap-3 min-w-0">
        <a href={`/${locale}/my-albums`} className="back-btn flex items-center justify-center w-9 h-9 rounded-pill text-fg2 no-underline transition-colors hover:bg-black/[.05] shrink-0" data-i18n-title="backToDetail" title={locale === 'zh' ? '返回书本明细' : 'Back to albums'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><polyline points="15 18 9 12 15 6" /></svg>
        </a>
        <a href={`/${locale}`} className="brand no-underline text-inherit shrink-0"><img src="/logo-yujee.svg" alt="Yujee" style={{ height: '26px', width: 'auto', display: 'block' }} /></a>
        <span className="crumb text-meta text-[13px] hidden sm:inline">/</span>
        <span className="album-title font-display font-bold text-[14px] text-fg px-2 py-1 rounded-pill border border-transparent transition-colors hover:bg-bg cursor-text truncate" contentEditable suppressContentEditableWarning data-i18n="albumTitle">2024 厦门三日游</span>
        <span className="save-badge text-[11px] text-muted hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-bg rounded-pill" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)', fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}><span className="pulse w-1.5 h-1.5 rounded-full bg-gg" /><span data-i18n="saved">已保存</span></span>
      </div>
      <div className="top-right flex items-center gap-1 sm:gap-2 shrink-0">
        <span className="btn-glow" data-export-gate={exportUnlocked ? 'open' : 'locked'}>
          <button
            className="btn-primary bg-fg text-white px-4 sm:px-7 py-2.5 rounded-pill text-[13px] font-semibold flex items-center gap-1.5 transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}
            data-action="exportPdf"
            data-testid="export-pdf-btn"
            disabled={!exportUnlocked}
            aria-disabled={!exportUnlocked}
            title={exportUnlocked ? undefined : (locale === 'zh' ? '先把每一组都「确定」，才能导出 PDF' : 'Confirm every chapter before exporting the PDF')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            <span className="hidden sm:inline" data-i18n="exportPdf">{locale === 'zh' ? '导出' : 'Export'}</span>
          </button>
        </span>

        <div className="user-menu" id="userMenu">
          <button className="user-trigger flex items-center rounded-pill transition-transform hover:-translate-y-px" data-action="toggleUserMenu" aria-label={locale === 'zh' ? '账户' : 'Account'}>
            <UserAvatar initial="L" size={40} />
          </button>
          <div className="user-dropdown">
            <div className="dropdown-header p-3 border-b border-bdsoft mb-1">
              <div className="dropdown-header-name text-[15px] font-semibold">Liam Chen</div>
              <div className="dropdown-header-email text-[12px] text-meta mt-0.5">liam@example.com</div>
            </div>
            <button className="dropdown-item flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] text-fg2 w-full text-left transition-colors hover:bg-bg"><span className="dropdown-icon w-[18px] h-[18px] flex items-center justify-center text-muted"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span><span>反馈与问题</span></button>
            <div className="dropdown-sep h-px bg-bdsoft my-1" />
            <button className="dropdown-item danger flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] w-full text-left transition-colors text-[#c44] hover:bg-[#fef2f2]"><span className="dropdown-icon w-[18px] h-[18px] flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg></span><span>退出登录</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The two modals (photo picker + export-fail). Rendered by the stable shell; their
// data-action nodes + backdrop-close are wired by EditorBook's effect.
function EditorModals() {
  return (
    <>
      <div className="modal-overlay" id="photoModal" data-overlay-close>
        <div className="modal-card">
          <div className="px-6 pt-5 pb-4 border-b border-bdsoft shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[17px] font-bold" data-i18n="modalTitle">选择照片</h3>
              <button className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg transition-colors" data-action="closePhotoPicker" aria-label="close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <p className="text-[12.5px] text-muted mt-1" data-i18n="modalSub">挑选这一组要用的照片，AI 会据此排版并撰写故事。</p>
          </div>
          <div className="px-6 py-5 overflow-y-auto flex-1">
            <div className="pick-grid" id="pickGrid">
              <div className="pick-upload" data-action="uploadStub">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                <span className="text-[10.5px] leading-tight" data-i18n="modalUpload">上传照片</span>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 border-t border-bdsoft shrink-0 flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-muted"><span data-i18n="modalSelected">已选</span> <span id="pickCount" className="font-semibold text-fg">0</span></span>
            <div className="flex items-center gap-2">
              <button className="px-5 py-2.5 rounded-pill text-[13px] font-medium text-fg2 border border-bd transition-colors hover:bg-bg" data-action="closePhotoPicker" data-i18n="modalCancel">取消</button>
              <span className="btn-glow">
                <button className="btn-create-ch px-5 py-2.5 rounded-pill text-[13px] font-semibold bg-fg text-white transition-transform hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0" id="createChBtn" style={{ boxShadow: '0 1px 3px rgba(0,0,0,.12)' }} data-action="confirmNewChapter" disabled>
                  <span data-i18n="modalCreate">创建分组</span>
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* WP5.3 / §4.5d:导出失败安抚弹框。连续 3 次出 PDF / 上传 R2 失败后由
          openExportFailModal() 加 .open 显示。 */}
      <div className="modal-overlay" id="exportFailModal" data-overlay-close>
        <div className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="exportFailTitle" data-testid="export-fail-modal">
          <div className="px-6 pt-6 pb-3 shrink-0">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-bg text-accent">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></svg>
              </span>
              <h3 id="exportFailTitle" className="font-display text-[17px] font-bold" data-i18n="exportFailTitle">导出遇到了点小麻烦</h3>
            </div>
            <p className="text-[13px] text-muted mt-3 leading-relaxed" data-i18n="exportFailBody">我们试了几次都没能生成你的 PDF，可能是网络不太稳。你的纪念册内容都安全保存着，稍后再点一次「导出 PDF」通常就好了。</p>
          </div>
          <div className="px-6 py-4 shrink-0 flex items-center justify-end gap-2">
            <button className="px-5 py-2.5 rounded-pill text-[13px] font-medium text-fg2 border border-bd transition-colors hover:bg-bg" data-action="closeExportFail" data-i18n="exportFailClose">知道了</button>
            <span className="btn-glow">
              <button className="px-5 py-2.5 rounded-pill text-[13px] font-semibold bg-fg text-white transition-transform hover:-translate-y-px" style={{ boxShadow: '0 1px 3px rgba(0,0,0,.12)' }} data-action="retryExportPdf" data-i18n="exportFailRetry">再试一次</button>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// BuildingShell — the building state (AGENT_RUNNING / draft-skeleton fetch). Same
// topbar chrome, but the canvas is a single cover skeleton and the chat rail is a
// static non-interactive loading notice. No chat engine, no coordinator — the poll
// in page.tsx flips us to authoring/editing (a full remount into EditorShell).
// ════════════════════════════════════════════════════════════════════════════
function BuildingShell({
  detail,
  locale,
  generation,
}: {
  detail: AlbumDetail;
  locale: Locale;
  generation: GenerationProgress;
}) {
  void detail;
  return (
    <div className="editor-port font-sans antialiased leading-relaxed" data-screen-label="02 Yujee Editor">
      <div className="page-glow" aria-hidden="true" />
      <div className="topbar nav-shell sticky top-0 z-50 h-14 flex items-center justify-between px-3 sm:px-6 shrink-0">
        <div className="top-left flex items-center gap-2 sm:gap-3 min-w-0">
          <a href={`/${locale}/my-albums`} className="back-btn flex items-center justify-center w-9 h-9 rounded-pill text-fg2 no-underline transition-colors hover:bg-black/[.05] shrink-0" title={locale === 'zh' ? '返回书本明细' : 'Back to albums'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><polyline points="15 18 9 12 15 6" /></svg>
          </a>
          <a href={`/${locale}`} className="brand no-underline text-inherit shrink-0"><img src="/logo-yujee.svg" alt="Yujee" style={{ height: '26px', width: 'auto', display: 'block' }} /></a>
          <span className="crumb text-meta text-[13px] hidden sm:inline">/</span>
          <span className="flex items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11px] text-muted" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-gg animate-pulse" />
            <span>{locale === 'zh' ? '整理中' : 'Tidying up'}</span>
          </span>
        </div>
      </div>

      <div className="workspace flex-1 overflow-hidden relative md:flex" style={{ height: 'calc(100vh - 56px)' }}>
        <button
          type="button"
          className="chat-fold-expand"
          title={locale === 'zh' ? '展开对话' : 'Expand chat'}
          aria-label={locale === 'zh' ? '展开对话' : 'Expand chat'}
          onClick={(e) => e.currentTarget.closest('.editor-port')?.classList.remove('chat-collapsed')}
        >
          <img className="fab-jelly" src="/jellyfish-icon.png" alt="" />
          <svg className="fab-chat-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <span>{locale === 'zh' ? '对话' : 'Chat'}</span>
        </button>

        <main className="pane pane-center flex flex-col overflow-hidden relative md:order-3 md:flex-1" id="paneCenter">
          <div className="book-stage w-full flex-1 flex items-center justify-center px-4 pt-8 pb-16 overflow-auto relative">
            <BuildingCanvasState locale={locale} />
          </div>
        </main>

        <div className="pane-chat-col md:order-1 md:w-[360px] shrink-0 md:flex">
          <aside className="pane pane-right chat-card relative flex flex-col overflow-hidden bg-surface md:flex-1">
            <div className="chat-drag hidden md:flex items-center gap-2 px-3.5 h-11 border-b border-bdsoft flex-shrink-0" id="chatDrag">
              <span className="chat-grip"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></svg></span>
              <span className="text-[13px] font-semibold text-fg2">{locale === 'zh' ? '对话' : 'Chat'}</span>
              <button
                type="button"
                className="chat-fold-btn chat-fold-collapse ml-auto"
                title={locale === 'zh' ? '折叠对话' : 'Collapse chat'}
                aria-label={locale === 'zh' ? '折叠对话' : 'Collapse chat'}
                onClick={(e) => e.currentTarget.closest('.editor-port')?.classList.add('chat-collapsed')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            </div>
            <div className="chat-mobile-handle md:hidden flex flex-shrink-0 items-center justify-center pt-2.5 pb-1.5">
              <span className="block w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>

            <div className="chat-body flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-6" id="chatBody" style={{ gap: '24px' }}>
              <div className="msg ai max-w-full">
                <div className="thinking-block active">
                  <img className="think-jelly" src="/jellyfish-loop.png" alt="" />
                  <span className="thinking-label">{buildingStageLabel(generation?.stage, locale)}</span>
                  <span className="thinking-dots"><span /><span /><span /></span>
                </div>
              </div>
            </div>

            <div className="composer-group shrink-0">
              <div className="chat-input shrink-0 bg-surface border border-bdsoft flex flex-col transition-all" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)', opacity: 0.6 }}>
                <textarea className="w-full outline-none resize-none bg-transparent text-fg text-[13.5px] leading-relaxed border-none px-4 pt-3.5 pb-1 disabled:cursor-not-allowed" style={{ fontFamily: 'var(--font-body)' }} placeholder="" rows={1} disabled />
                <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-0.5">
                  <button className="add-ch-btn w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted disabled:cursor-not-allowed disabled:opacity-40" title={locale === 'zh' ? '添加图片' : 'Add photos'} aria-label={locale === 'zh' ? '添加图片' : 'Add photos'} disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                  <span className="flex-1" />
                  <span className="btn-glow btn-glow-round shrink-0">
                    <button className="send-btn w-8 h-8 rounded-full bg-fg text-white flex items-center justify-center transition-transform disabled:cursor-not-allowed disabled:opacity-40" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }} title={locale === 'zh' ? '发送' : 'Send'} disabled>
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
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EditorBook — the faithful editor.html port. Mounts once with already-resolved
// pages/chapters/originals; its single mount-time effect runs the imperative
// flipbook/zoom/overview/thumbnail/chat logic. `mode` selects the chat behaviour:
// editing → retired chat-edit guidance; authoring → agent theme/chapter flow + finalize.
// ════════════════════════════════════════════════════════════════════════════
function EditorBook({
  detail,
  locale,
  mode,
  initialPages,
  draftChapters,
  initialImageUrls,
  outerRootRef,
  coordinator,
}: {
  detail: AlbumDetail;
  locale: Locale;
  mode: ChatMode;
  initialPages: EditorPage[];
  draftChapters: DraftSkeleton | null;
  initialImageUrls: Record<string, string>;
  outerRootRef: RefObject<HTMLDivElement | null>;
  coordinator: RefObject<ChatCoordinator | null>;
}) {
  useEffect(() => {
    // The canvas effect scopes to the SHARED outer root (created by the stable shell)
    // so it can reach the topbar + modals it wires (setLang walks the whole tree). Its
    // own DOM (#paneCenter subtree + modals) also lives under this root.
    const root = outerRootRef.current;
    if (!root) return;

    // ── scoped equivalents of document.* / body.* from the original script ──
    const $ = (s: string) => root.querySelector(s) as HTMLElement | null;
    const $$ = (s: string) => root.querySelectorAll(s);
    const byId = (id: string) => root.querySelector('#' + CSS.escape(id)) as HTMLElement | null;
    // Restrict the canvas data-action sweep to its OWN subtree (topbar + #paneCenter +
    // modals) so it never double-binds the chat-owned actions in the ChatPanel aside.
    const canvasScopes = (): Element[] => {
      const out: Element[] = [];
      const add = (el: Element | null) => { if (el) out.push(el); };
      add(root.querySelector('.topbar'));
      add(byId('paneCenter'));
      add(root.querySelector('.chat-fold-expand'));
      add(byId('photoModal'));
      add(byId('exportFailModal'));
      return out;
    };
    const $$scoped = (sel: string): Element[] => {
      const seen = new Set<Element>();
      for (const scope of canvasScopes()) {
        if (scope.matches(sel)) seen.add(scope);
        scope.querySelectorAll(sel).forEach((el) => seen.add(el));
      }
      return [...seen];
    };
    const bodyEl = root; // original toggled body classes (overview-on / chat-collapsed / rail-collapsed); scoped to root here.

    /* ─── i18n translations (verbatim; shared module dict) ─── */
    const i18n: Record<string, Record<string, string>> = chatI18n;

    let currentLang = locale === 'zh' ? 'zh' : 'en';
    const t = (key: string) =>
      (i18n[currentLang] && i18n[currentLang][key]) || i18n.zh[key] || key;

    // expose alert hooks (original uses inline onclick="alert(t('...'))")
    (root as unknown as { __t: (k: string) => string }).__t = t;

    /* ─── Real pages → spreads (cover alone on the right-hand page) ─── */
    const albumId = detail.album.id;

    const isAuthoring = mode === 'authoring';
    // The draft skeleton (read-only render projection; invariant 12). Rendered on
    // entry; the agent persists draft_json server-side, so we don't refetch it.
    const draftSkel: DraftSkeleton | null = draftChapters;
    const aT = (zh: string, en: string) => (currentLang === 'zh' ? zh : en);
    // §4.5a export gate: the topbar export button is prop-disabled by the shell when
    // locked; this mirror lets exportPdf() defend itself and lets the chat toggle the
    // live gate via coordinator.setExportGateUi.
    let exportGateLocked = isAuthoring;
    function setExportGateUi(locked: boolean) {
      exportGateLocked = locked;
      const exportBtn = $('[data-action="exportPdf"]') as HTMLButtonElement | null;
      if (exportBtn && isAuthoring) {
        exportBtn.disabled = locked;
        exportBtn.classList.toggle('is-disabled', locked);
        exportBtn.setAttribute('aria-disabled', locked ? 'true' : 'false');
      }
    }
    // Mutable working copy: chat and inline edits patch this in place and repaint
    // without remounting the effect. Sourced from detail.pages (editing) or the
    // draft skeleton (authoring) — both are EditorPage-shaped.
    let pagesState: EditorPage[] = initialPages.map((p) => ({
      ...p,
      imagesJson: { ...p.imagesJson },
      textsJson: { ...p.textsJson },
      imagePosJson: { ...(p.imagePosJson ?? {}) },
    }));
    const ensureCurrentFonts = () => {
      void loadAlbumFonts(pagesState.map((page) => ({ texts: page.textsJson })))
        .catch(() => undefined);
    };
    const total = initialPages.length;
    // 收集态(排版前):authoring 且 pages 为空 —— draft 有 tree/chapters 但还没排版,
    // 所以没有版式页可画。此时画板不渲染空的版式书,改成显示「当前正在采访的那一章」的
    // 照片平铺网格,让用户确认这组照片(随采访推进切到下一章)。排版完成后 pages 非空,
    // 走正常版式书渲染(pagesState 里有页,isCollectMode 恒 false)。
    const isCollectMode = isAuthoring && total === 0;
    // 画板当前展示的章(收集态用)。goToChapterById 在收集态更新它并重画网格;采访推进到
    // 下一章时 finishInterview → goToChapterById(next) 已调,网格随之切换。
    let collectChapterId: string | null = null;
    // Real-book pagination (issue #158): the cover sits alone on the recto of the
    // first spread (opens leftward), the ending sits alone on the verso of the last
    // spread (closes), interior pages pair two-up. buildSpreads owns this algorithm;
    // a null half is a blank page. spreads is mutable: authoring's refreshDraft may
    // swap pagesState (and change the page count when a chapter is generated), so
    // rebuildSpreads() reruns wherever pagesState is reassigned.
    let spreads = buildSpreads(pagesState);
    const rebuildSpreads = () => {
      spreads = buildSpreads(pagesState);
      // A slot-flip patch can shrink the spread count without changing page
      // count (no remount); clamp the cursor so we never sit on a dropped spread.
      if (currentCh >= spreadCount()) currentCh = spreadCount() - 1;
    };
    const spreadCount = () => Math.max(1, spreads.length);
    const spreadPages = (s: number): [EditorPage | null, EditorPage | null] => {
      const sp = spreads[s];
      if (!sp) return [null, null];
      return [
        sp.left === null ? null : pagesState[sp.left] ?? null,
        sp.right === null ? null : pagesState[sp.right] ?? null,
      ];
    };
    function pageByIndex(idx: number): EditorPage | undefined {
      return pagesState.find((p) => p.pageIndex === idx);
    }
    const spreadLabel = (i: number) =>
      currentLang === 'zh' ? '跨页 ' + (i + 1) : 'Spread ' + (i + 1);

    // Original photos live only in the browser (invariant 1). Resolve photoId →
    // blob: URL from IndexedDB; URLs load async, so we repaint once they arrive.
    // Authoring pre-resolves them (passed in); editing fetches them below.
    let imageUrls: Record<string, string> = { ...initialImageUrls };
    const resolveImage: ResolveImage = (id) => imageUrls[id];

    // Render a real album page through its web template (the same path the live
    // editor/PDF use) as static markup we can drop into the imperative book.
    // HTML 模板已迁移的（如 mag-01）走单一 HTML 渲染器；未迁的回退现有 React 组件。
    function faceInner(page: EditorPage | null): string {
      if (!page) return '';
      const html = renderPageHtml(
        { templateId: page.templateId, images: page.imagesJson, texts: page.textsJson, imagePos: page.imagePosJson },
        resolveImage,
      );
      if (html !== undefined) return html;
      const Template = getWebTemplate(page.templateId);
      if (!Template) {
        return `<div style="padding:24px;font-size:14px">Unknown template: ${page.templateId}</div>`;
      }
      const data = adaptPageToTemplateData(
        { templateId: page.templateId, images: page.imagesJson, texts: page.textsJson },
        resolveImage,
      );
      return renderToStaticMarkup(
        <Template data={data} totalPages={total} imagePos={page.imagePosJson} />,
      );
    }
    // The 794×1123 page scaled to fill the given box (matches FlipBook PageFace).
    function faceHTML(page: EditorPage | null, boxW: number, boxH: number): string {
      const scale = Math.min(boxW / PAGE.width, boxH / PAGE.height) || 1;
      return (
        `<div style="width:${boxW}px;height:${boxH}px;overflow:hidden;background:#fff">` +
        `<div style="transform:scale(${scale});transform-origin:top left;width:${PAGE.width}px;height:${PAGE.height}px">` +
        faceInner(page) +
        `</div></div>`
      );
    }
    function normalizedText(value: string | null | undefined) {
      return (value ?? '').replace(/\s+/g, ' ').trim();
    }
    function markEditableTextKeys(host: HTMLElement, page: EditorPage) {
      const remaining = new Map<string, string>();
      for (const [key, value] of Object.entries(page.textsJson)) {
        const normalized = normalizedText(value);
        if (normalized) remaining.set(key, normalized);
      }
      host.querySelectorAll<HTMLElement>('[data-editable]:not(img)').forEach((node) => {
        if (node.dataset.textKey) return;
        const actual = normalizedText(node.textContent);
        if (!actual) return;
        for (const [key, expected] of remaining.entries()) {
          if (actual === expected) {
            node.dataset.textKey = key;
            remaining.delete(key);
            return;
          }
        }
      });
    }
    function paintEl(el: HTMLElement | null, page: EditorPage | null, attempt = 0) {
      if (!el) return;
      // #158 follow-up: a null page is "no page there" (the empty half of a solo
      // cover/ending spread). Render nothing — faceHTML would otherwise inject a
      // white (#fff) box. The .page-empty/.leaf-empty/.thumb-empty/.ov-solo classes
      // strip the surrounding surface/shadow/spine so the half reads as empty space.
      if (!page) { el.innerHTML = ''; return; }
      // offsetParent === null ⇔ a `display:none` ancestor hides the cell (these
      // page/thumb cells are never position:fixed). See paintDecision for why each
      // branch behaves as it does — notably 'skip' on hidden avoids a per-frame
      // rAF loop that the issue #157 fix would otherwise spin while overview-on.
      const action = paintDecision(el.offsetParent === null, el.clientWidth, el.clientHeight, attempt, 30);
      if (action === 'skip') return;
      if (action === 'defer') {
        requestAnimationFrame(() => paintEl(el, page, attempt + 1));
        return;
      }
      el.innerHTML = faceHTML(page, el.clientWidth, el.clientHeight);
      el.querySelectorAll<HTMLElement>('img[data-image-slot], .ch-mark, .ch-narrative, .photo .cap').forEach((node) => {
        node.setAttribute('data-editable', '');
      });
      markEditableTextKeys(el, page);
    }
    // Repaint every surface that shows page content after an edit.
    function repaintBook() {
      paintSpread(currentCh);
      buildThumbs();
      if (bodyEl.classList.contains('overview-on')) renderOverview();
      // A repaint replaces the painted <img> nodes (#168). If an image is being
      // manually edited, re-bind the overlay to the fresh node for its slot; if
      // that slot no longer exists on the page (an AI edit swapped the photo /
      // template), tear the overlay down so it can't point at a detached node.
      reattachImgEdit();
    }
    // Re-grab the live <img> for the active image-edit selection after a repaint,
    // or clear the selection if the slot is gone. Centralizes the "innerHTML was
    // replaced" concern for every repaintBook() caller (AI patch, draft act,
    // inline text edit, and the manual commit itself).
    function reattachImgEdit() {
      if (!imgEdit) return;
      const fresh = imgEdit.hostEl.querySelector(
        `img[data-image-slot="${CSS.escape(imgEdit.slotId)}"]`,
      ) as HTMLImageElement | null;
      if (fresh && imgEdit.hostEl.dataset.pageIndex === String(imgEdit.pageIndex)) {
        imgEdit.imgEl = fresh;
        fresh.classList.add('img-editing');
        // When not mid-drag, re-sync the working pos from the page's committed
        // value (an external AI patch may have changed/reset this slot); during a
        // drag, keep the live working pos so the gesture isn't interrupted.
        if (!dragging) {
          const page = pageByIndex(imgEdit.pageIndex);
          if (page) imgEdit.pos = currentImagePos(page, imgEdit.slotId);
          if (imgEditSlider) imgEditSlider.value = String(imgEdit.pos.scale);
        }
        applyLiveImagePos(fresh, imgEdit.pos);
        positionImgEditOverlay();
      } else {
        clearImageSelection();
      }
    }
    // ── #165 Phase 3: rasterize the rendered page for the vision diagnosis ──
    // PRIVACY (invariant 1/2): the screenshot contains the user's original photos
    // (already resolved as blob: URLs in this browser) and is sent to the vision
    // model — exactly the same posture as init vision: it is NOT logged, NOT stored,
    // NOT written to draft_json; it lives only in the inspect-render request body.
    // We render the page off-screen at full 794×1123, html2canvas it, then downscale
    // to ~840px wide and JPEG q0.8 to keep the data URI small.
    async function capturePageRender(pageIndex: number): Promise<string> {
      // Test seam: jsdom can't run html2canvas, so tests install a stub here.
      const stub = (root as unknown as { __capturePageRenderStub?: (i: number) => Promise<string> })
        .__capturePageRenderStub;
      if (stub) return stub(pageIndex);

      const page = pageByIndex(pageIndex);
      if (!page) throw new Error(`page ${pageIndex} not in book`);
      // Render the page at full resolution into a detached, off-screen host (so the
      // capture is crisp and independent of the current zoom/flip state).
      const host = document.createElement('div');
      host.style.cssText =
        `position:fixed;left:-99999px;top:0;width:${PAGE.width}px;height:${PAGE.height}px;` +
        `overflow:hidden;background:#fff`;
      host.innerHTML = faceInner(page);
      document.body.appendChild(host);
      try {
        // html2canvas-pro (not the unmaintained html2canvas@1.4.1) — the latter
        // throws on modern CSS color functions (oklch/lab/color-mix) that Tailwind
        // v4 emits, which silently broke the inspect→adjust capture.
        const html2canvas = (await import('html2canvas-pro')).default;
        const canvas = await html2canvas(host, {
          width: PAGE.width,
          height: PAGE.height,
          backgroundColor: '#ffffff',
          scale: 1,
          useCORS: true,
          logging: false,
        });
        // Downscale to ~840px wide (payload stays small; plenty for a crop read).
        const targetW = Math.min(840, canvas.width);
        const targetH = Math.round((canvas.height / canvas.width) * targetW);
        const out = document.createElement('canvas');
        out.width = targetW;
        out.height = targetH;
        const ctx = out.getContext('2d');
        if (!ctx) throw new Error('2d context unavailable');
        ctx.drawImage(canvas, 0, 0, targetW, targetH);
        return out.toDataURL('image/jpeg', 0.8);
      } finally {
        host.remove();
      }
    }

    async function capturePhotoThumb(photoId?: string | null): Promise<string | undefined> {
      if (!photoId) return undefined;
      const stub = (root as unknown as {
        __capturePhotoThumbStub?: (id: string) => Promise<string | undefined>;
      }).__capturePhotoThumbStub;
      if (stub) return stub(photoId);

      const src = imageUrls[photoId];
      if (!src) return undefined;
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('cover photo thumbnail load failed'));
          img.src = src;
        });
        const sourceW = img.naturalWidth || img.width;
        const sourceH = img.naturalHeight || img.height;
        if (sourceW <= 0 || sourceH <= 0) return undefined;
        const scale = Math.min(1, 200 / Math.max(sourceW, sourceH));
        const targetW = Math.max(1, Math.round(sourceW * scale));
        const targetH = Math.max(1, Math.round(sourceH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.drawImage(img, 0, 0, targetW, targetH);
        return canvas.toDataURL('image/jpeg', 0.82);
      } catch {
        return undefined;
      }
    }

    /* ─── apply language ─── */
    function setLang(lang: string) {
      if (!i18n[lang]) return;
      currentLang = lang;
      // (document root lang left to the host page; scoped here)

      $$('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n')!;
        const val = t(key);
        if (val) (el as HTMLElement).textContent = val;
      });
      $$('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title')!;
        const val = t(key);
        if (val) el.setAttribute('title', val);
      });
      $$('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder')!;
        const val = t(key);
        if (val) el.setAttribute('placeholder', val);
      });
      $$('[data-i18n-html]').forEach((el) => {
        const key = el.getAttribute('data-i18n-html')!;
        const val = t(key);
        if (val) (el as HTMLElement).innerHTML = val;
      });

      renderRail();
      buildThumbs();
      paintSpread(currentCh);
    }

    /* ─── Nav dropdown helpers ─── */
    const toggleUserMenu = () => {
      byId('userMenu')?.classList.toggle('open');
      byId('langSelect')?.classList.remove('open');
    };
    const onDocClick = (e: MouseEvent) => {
      const ls = byId('langSelect');
      const um = byId('userMenu');
      if (ls && !ls.contains(e.target as Node)) ls.classList.remove('open');
      if (um && !um.contains(e.target as Node)) um.classList.remove('open');
    };
    document.addEventListener('click', onDocClick);

    /* ─── Book / spread ─── */
    const ctxBadge = $('.chat-context');
    const pageInd = byId('pageInd');
    const bookEl = byId('book')!;
    const pageLeft = byId('pageLeft')!;
    const pageRight = byId('pageRight')!;
    const flipper = byId('flipper')!;
    const leafFront = byId('leafFront')!;
    const leafBack = byId('leafBack')!;
    let currentCh = 0;
    let flipping = false;

    // ── Page selection (W11): click a page to select it; its index is sent with the
    // next edit message so "change this / this page" targets it. Click again to
    // deselect. The highlight rides on #pageLeft/#pageRight, which carry the painted
    // page's index in data-page-index (set by paintSpread).
    let selectedPageIndex: number | null = null;
    function updateSelectionHighlight() {
      for (const el of [pageLeft, pageRight]) {
        const pi = el.dataset.pageIndex;
        el.classList.toggle('page-selected', pi !== undefined && Number(pi) === selectedPageIndex);
      }
    }
    const onPageSelect = (el: HTMLElement) => {
      const pi = el.dataset.pageIndex;
      if (pi === undefined) return;
      const idx = Number(pi);
      selectedPageIndex = selectedPageIndex === idx ? null : idx;
      // Switching/deselecting a page tears down any open image-edit overlay.
      clearImageSelection();
      updateSelectionHighlight();
      if (selectedPageIndex === idx) showElementToolbar(el, 'text');
      else hideElementToolbar();
    };

    // ════════════════════════════════════════════════════════════════════════
    // #168 — manual in-frame image pan + zoom. Once a page is selected, clicking
    // any photo on it selects that image and floats an overlay (drag handle +
    // zoom slider + reset). Drag pans (objectPosition), wheel/slider zooms
    // (scale). Live feedback writes the live <img> style directly (the page is
    // painted as static innerHTML, so we mutate the DOM node rather than React
    // props); on pointer-up we commit to imagePosJson and persist via the same
    // single-page PATCH channel openInlineEdit uses.
    //
    // No-white-edge + clamp geometry lives in ./image-edit-util (unit-tested):
    // object-fit:cover already fills the box, so x,y∈[0,100] + scale≥1 can never
    // expose a white edge — see that module's header for the full reasoning.
    // ════════════════════════════════════════════════════════════════════════
    let imgEdit: {
      pageIndex: number;
      slotId: string;
      hostEl: HTMLElement; // pageLeft/pageRight host whose innerHTML holds the <img>
      imgEl: HTMLImageElement; // the live painted <img> we mutate during drag
      pos: ImagePosValue; // working (committed) position for this image
    } | null = null;
    // The floating control overlay (created lazily, appended to the book so it
    // tracks the spread). Hidden until an image is selected.
    let imgEditOverlay: HTMLElement | null = null;
    let imgEditSlider: HTMLInputElement | null = null;
    let dragging = false;

    function currentImagePos(page: EditorPage, slotId: string): ImagePosValue {
      const p = page.imagePosJson?.[slotId];
      return p ? clampImagePos(p) : { ...DEFAULT_IMAGE_POS };
    }
    // Paint a working position onto the live <img> only (instant, no repaint).
    function applyLiveImagePos(imgEl: HTMLImageElement, pos: ImagePosValue) {
      imgEl.style.objectPosition = `${pos.x}% ${pos.y}%`;
      if (pos.scale > 1) {
        imgEl.style.transform = `scale(${pos.scale})`;
        imgEl.style.transformOrigin = `${pos.x}% ${pos.y}%`;
      } else {
        imgEl.style.transform = '';
        imgEl.style.transformOrigin = '';
      }
    }
    function buildImgEditOverlay(): HTMLElement {
      if (imgEditOverlay) return imgEditOverlay;
      const ov = document.createElement('div');
      ov.className = 'img-edit-overlay';
      ov.style.display = 'none';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'img-edit-zoom';
      slider.min = String(SCALE_MIN);
      slider.max = String(SCALE_MAX);
      slider.step = '0.01';
      slider.title = aT('缩放', 'Zoom');
      slider.addEventListener('input', () => {
        if (!imgEdit) return;
        imgEdit.pos = clampImagePos({ ...imgEdit.pos, scale: parseFloat(slider.value) });
        applyLiveImagePos(imgEdit.imgEl, imgEdit.pos);
      });
      // Commit on release (松手即存) for both mouse and touch.
      slider.addEventListener('change', () => commitImagePos());
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'img-edit-reset';
      reset.textContent = aT('复位', 'Reset');
      reset.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!imgEdit) return;
        imgEdit.pos = { ...DEFAULT_IMAGE_POS };
        applyLiveImagePos(imgEdit.imgEl, imgEdit.pos);
        if (imgEditSlider) imgEditSlider.value = String(imgEdit.pos.scale);
        commitImagePos();
      });
      const hint = document.createElement('span');
      hint.className = 'img-edit-hint';
      hint.textContent = aT('拖动平移', 'Drag to pan');
      ov.appendChild(hint);
      ov.appendChild(slider);
      ov.appendChild(reset);
      // Clicks on the controls must not bubble to the page (which would deselect).
      ov.addEventListener('click', (e) => e.stopPropagation());
      ov.addEventListener('mousedown', (e) => e.stopPropagation());
      bookEl.appendChild(ov);
      imgEditOverlay = ov;
      imgEditSlider = slider;
      return ov;
    }
    // Position the overlay near the bottom edge of the selected image, in
    // book-local (unscaled) coords. The overlay is a child of #book, which is
    // CSS-scaled by `zoom` and clips overflow — so we (a) divide screen px by zoom
    // and (b) anchor the overlay INSIDE the image's lower edge (not below it) so a
    // photo flush with the page bottom doesn't push the controls into the clipped
    // overflow region. translateX(-50%) (CSS) centers it on the computed x.
    function positionImgEditOverlay() {
      if (!imgEdit || !imgEditOverlay) return;
      const bookRect = bookEl.getBoundingClientRect();
      // #168: anchor to the SLOT FRAME (the overflow:hidden wrapper <div> around the
      // <img>), not the <img> itself — once scale>1 the img's rect is the zoomed
      // (larger, clipped-off) size, which would float the overlay off the frame.
      // The wrapper's rect is the fixed frame the user sees. Fall back to the img if
      // (defensively) it has no parent element.
      const frameEl = imgEdit.imgEl.parentElement ?? imgEdit.imgEl;
      const imgRect = frameEl.getBoundingClientRect();
      const z = zoom || 1;
      const localLeft = (imgRect.left - bookRect.left) / z + imgRect.width / z / 2;
      const localBottom = (imgRect.bottom - bookRect.top) / z;
      // ~36px overlay height + 8px inset, anchored inside the image's bottom edge.
      imgEditOverlay.style.left = `${localLeft}px`;
      imgEditOverlay.style.top = `${localBottom - 44}px`;
    }
    function selectImage(hostEl: HTMLElement, imgEl: HTMLImageElement, slotId: string) {
      const pi = hostEl.dataset.pageIndex;
      if (pi === undefined) return;
      const page = pageByIndex(Number(pi));
      if (!page) return;
      clearImageSelection();
      imgEdit = {
        pageIndex: Number(pi),
        slotId,
        hostEl,
        imgEl,
        pos: currentImagePos(page, slotId),
      };
      imgEl.classList.add('img-editing');
      const ov = buildImgEditOverlay();
      if (imgEditSlider) imgEditSlider.value = String(imgEdit.pos.scale);
      ov.style.display = '';
      positionImgEditOverlay();
      showElementToolbar(imgEl.parentElement ?? imgEl, 'photo');
    }
    function clearImageSelection() {
      if (imgEdit) imgEdit.imgEl.classList.remove('img-editing');
      imgEdit = null;
      dragging = false;
      if (imgEditOverlay) imgEditOverlay.style.display = 'none';
    }
    // Commit the working position into imagePosJson + persist (松手即存). Repaints
    // the whole book so thumbnails/overview reflect the move.
    function commitImagePos() {
      if (!imgEdit) return;
      const { pageIndex, slotId, pos } = imgEdit;
      const page = pageByIndex(pageIndex);
      if (!page) return;
      const clamped = clampImagePos(pos);
      imgEdit.pos = clamped;
      page.imagePosJson = { ...(page.imagePosJson ?? {}), [slotId]: clamped };
      // repaintBook() replaces the painted <img> nodes; reattachImgEdit (run
      // inside it) re-binds the overlay to the fresh node for this slot.
      repaintBook();
      // Persist via the same single-page PATCH channel as inline text edits.
      void fetch(`/api/v1/albums/${albumId}/pages/${pageIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePosJson: page.imagePosJson }),
      }).catch(() => {});
    }
    // Pointer drag → pan. Bound on each host; only acts when an image on that
    // host is the active selection.
    let dragStart = { x: 0, y: 0 };
    let dragStartPos: ImagePosValue = { ...DEFAULT_IMAGE_POS };
    let dragMoved = false; // a real drag happened → swallow the trailing click
    const onImgPointerDown = (e: PointerEvent) => {
      if (!imgEdit) return;
      const target = e.target as HTMLElement;
      // Only start a drag when the press lands on the actively-edited image.
      if (target !== imgEdit.imgEl) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      dragMoved = false;
      dragStart = { x: e.clientX, y: e.clientY };
      dragStartPos = { ...imgEdit.pos };
      imgEdit.imgEl.setPointerCapture?.(e.pointerId);
    };
    const onImgPointerMove = (e: PointerEvent) => {
      if (!dragging || !imgEdit) return;
      if (Math.abs(e.clientX - dragStart.x) > 2 || Math.abs(e.clientY - dragStart.y) > 2) {
        dragMoved = true;
      }
      const rect = imgEdit.imgEl.getBoundingClientRect();
      imgEdit.pos = dragToImagePos(
        dragStartPos,
        e.clientX - dragStart.x,
        e.clientY - dragStart.y,
        rect.width,
        rect.height,
      );
      applyLiveImagePos(imgEdit.imgEl, imgEdit.pos);
    };
    const onImgPointerUp = (e: PointerEvent) => {
      if (!dragging || !imgEdit) return;
      dragging = false;
      imgEdit.imgEl.releasePointerCapture?.(e.pointerId);
      if (dragMoved) commitImagePos();
    };
    // Wheel over the selected image → zoom (scale). Debounced commit on idle.
    let wheelCommitTimer: ReturnType<typeof setTimeout> | null = null;
    const onImgWheel = (e: WheelEvent) => {
      if (!imgEdit) return;
      const target = e.target as HTMLElement;
      if (target !== imgEdit.imgEl) return;
      e.preventDefault();
      e.stopPropagation();
      imgEdit.pos = zoomImagePos(imgEdit.pos, e.deltaY < 0 ? 0.05 : -0.05);
      applyLiveImagePos(imgEdit.imgEl, imgEdit.pos);
      if (imgEditSlider) imgEditSlider.value = String(imgEdit.pos.scale);
      if (wheelCommitTimer) clearTimeout(wheelCommitTimer);
      wheelCommitTimer = setTimeout(() => commitImagePos(), 320);
    };
    // A click anywhere on a selected page: if it's on an editable image, enter
    // image-edit mode for that slot; otherwise fall through to page select/deselect.
    const onHostClick = (hostEl: HTMLElement) => (e: MouseEvent) => {
      // A pan gesture ends with a synthetic click — swallow it so a drag doesn't
      // also toggle the image/page selection.
      if (dragMoved) {
        dragMoved = false;
        e.stopPropagation();
        return;
      }
      const pi = hostEl.dataset.pageIndex;
      const target = e.target as HTMLElement;
      const img = target.closest('img[data-image-slot]') as HTMLImageElement | null;
      const editableText = target.closest<HTMLElement>('[data-editable]:not(img)');
      // Image click is only meaningful once the page is selected (two-step: select
      // the page, then pick a photo) — keeps single clicks as page selection.
      if (img && pi !== undefined && Number(pi) === selectedPageIndex) {
        const slotId = img.getAttribute('data-image-slot');
        if (slotId) {
          e.stopPropagation();
          // Toggle: clicking the already-edited image clears it.
          if (imgEdit && imgEdit.slotId === slotId && imgEdit.pageIndex === Number(pi)) {
            clearImageSelection();
          } else {
            selectImage(hostEl, img, slotId);
          }
          return;
        }
      }
      if (editableText && pi !== undefined && Number(pi) === selectedPageIndex) {
        e.stopPropagation();
        clearImageSelection();
        showElementToolbar(editableText, 'text');
        updateEditSizeLabel([editableText]);
        return;
      }
      onPageSelect(hostEl);
    };
    for (const hostEl of [pageLeft, pageRight]) {
      hostEl.addEventListener('click', onHostClick(hostEl));
      hostEl.addEventListener('pointerdown', onImgPointerDown);
      hostEl.addEventListener('pointermove', onImgPointerMove);
      hostEl.addEventListener('pointerup', onImgPointerUp);
      hostEl.addEventListener('wheel', onImgWheel, { passive: false });
    }

    function paintSpread(i: number) {
      // 收集态没有版式页;画板走照片网格(renderCollectGrid),不画空版式书。
      if (isCollectMode) return;
      const [lp, rp] = spreadPages(i);
      // Layout MUST be settled BEFORE paintEl. paintEl scales the page to the cell's
      // live clientWidth/height and SKIPS a cell hidden by display:none (offsetParent
      // === null). A solo cover/ending spread narrows the book to single-page width and
      // collapses the empty half via `.book-single .page-empty{display:none}`. If we
      // painted first, then toggled these classes, a solo→double switch (e.g. flipping
      // off the cover) would paint the right page while it was STILL display:none from
      // the previous solo spread → it'd be skipped and render blank, only reappearing
      // after some later repaint. So toggle the container/half classes first, paint after.
      // #158 follow-up: a null half is "no page there" (cover sits alone on the right,
      // ending alone on the left) — .page-empty renders it as truly empty (no surface,
      // shadow, page-num or click target) and drops the center spine.
      pageLeft.classList.toggle('page-empty', lp === null);
      pageRight.classList.toggle('page-empty', rp === null);
      // Drop the center spine line when either half is empty so a solo cover/ending
      // page has no stray divider next to blank space; keep it for double spreads.
      bookEl.classList.toggle('book-solo', lp === null || rp === null);
      // A *true* cover/ending solo (isSoloSpread, keyed off the page category — NOT
      // off "a null half") renders as one centered single-width page: the empty half
      // leaves the layout and the container narrows to single-page aspect. An interior
      // odd-trailing page is { left:i, right:null } too but is NOT solo — it must keep
      // its double-width spread with a transparent blank half, so we never collapse it.
      bookEl.classList.toggle('book-single', isSoloSpread(spreads[i], pagesState));
      // Content painted last, once the cells are at their final visibility + size.
      paintEl(pageLeft, lp);
      paintEl(pageRight, rp);
      if (lp) pageLeft.dataset.pageIndex = String(lp.pageIndex);
      else delete pageLeft.dataset.pageIndex;
      if (rp) pageRight.dataset.pageIndex = String(rp.pageIndex);
      else delete pageRight.dataset.pageIndex;
      updateSelectionHighlight();
      if (!imgEdit && selectedPageIndex != null) {
        const selectedHost = [pageLeft, pageRight].find((host) => host.dataset.pageIndex === String(selectedPageIndex));
        if (selectedHost) showElementToolbar(selectedHost, 'text');
        else hideElementToolbar();
      }
      if (pageInd) pageInd.textContent = (i + 1) + ' / ' + spreadCount();
      if (ctxBadge) ctxBadge.textContent = spreadLabel(i);
      // Rail items key off their target spread (data-ch), which for AI chapters is
      // a non-contiguous spread index — compare by that, not by list position.
      $$('.chapter').forEach((el) => el.classList.toggle('active', +el.getAttribute('data-ch')! === i));
      updateThumbUI(i);
    }

    function flipTo(nextIdx: number, dir: 'next' | 'prev') {
      if (flipping || nextIdx === currentCh || nextIdx < 0 || nextIdx >= spreadCount()) return;
      // Leaving the spread invalidates the active image-edit overlay (its <img>
      // belongs to the spread we're flipping away from).
      clearImageSelection();
      flipping = true;
      const [curLeft, curRight] = spreadPages(currentCh);
      const [nxtLeft, nxtRight] = spreadPages(nextIdx);
      // Solo cover/ending pages render in a single-page-width container; the leaf
      // flip geometry is built for the double-width container (flipper left:50%/0%,
      // width:50%), so animating across a width change tears/misaligns the leaf. When
      // either endpoint is a true cover/ending solo, skip the leaf and switch directly
      // (the same safe path a reduced-motion jump would take). Double↔double flips keep
      // the leaf animation. (isSoloSpread is category-keyed, so an interior odd-trailing
      // spread does NOT take this branch — it animates normally.)
      if (isSoloSpread(spreads[currentCh], pagesState) || isSoloSpread(spreads[nextIdx], pagesState)) {
        currentCh = nextIdx;
        paintSpread(nextIdx);
        flipping = false;
        return;
      }
      // #158 follow-up: the leaf faces + the half painted directly here also carry
      // a possibly-null page; mark each empty so no white half flashes mid-flip.
      // Set book-solo for the DESTINATION spread now (paintSpread re-asserts it on
      // completion) so the spine doesn't flicker during the flip.
      bookEl.classList.toggle('book-solo', nxtLeft === null || nxtRight === null);

      if (dir === 'next') {
        leafFront.classList.toggle('leaf-empty', curRight === null);
        leafBack.classList.toggle('leaf-empty', nxtLeft === null);
        pageRight.classList.toggle('page-empty', nxtRight === null);
        paintEl(leafFront, curRight);
        paintEl(leafBack, nxtLeft);
        paintEl(pageRight, nxtRight);
        flipper.classList.remove('flip-prev');
        flipper.style.left = '50%';
        flipper.style.transformOrigin = 'left center';
        flipper.style.transform = 'rotateY(0deg)';
        requestAnimationFrame(() => {
          flipper.classList.add('flipping');
          flipper.style.transform = 'rotateY(-180deg)';
        });
        setTimeout(() => {
          currentCh = nextIdx;
          paintSpread(nextIdx);
          flipper.classList.remove('flipping');
          flipper.style.transform = 'rotateY(0deg)';
          flipping = false;
        }, 920);
      } else {
        leafFront.classList.toggle('leaf-empty', curLeft === null);
        leafBack.classList.toggle('leaf-empty', nxtRight === null);
        pageLeft.classList.toggle('page-empty', nxtLeft === null);
        paintEl(leafFront, curLeft);
        paintEl(leafBack, nxtRight);
        paintEl(pageLeft, nxtLeft);
        flipper.style.left = '0%';
        flipper.style.transformOrigin = 'right center';
        flipper.style.transform = 'rotateY(0deg)';
        requestAnimationFrame(() => {
          flipper.classList.add('flipping');
          flipper.style.transform = 'rotateY(180deg)';
        });
        setTimeout(() => {
          currentCh = nextIdx;
          paintSpread(nextIdx);
          flipper.classList.remove('flipping');
          flipper.style.left = '50%';
          flipper.style.transformOrigin = 'left center';
          flipper.style.transform = 'rotateY(0deg)';
          flipping = false;
        }, 920);
      }
    }

    /* ─── Left chapter rail + mobile chips ─── */
    // Rail shows the AI's image-cluster chapters (fetched from the read-only
    // chapter summary) once loaded; until then — or for a finalized album with no
    // draft — it falls back to listing spreads.
    const esc = (s: string) =>
      s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
    let chapters: { label: string; spread: number }[] = [];
    // A chapter "starts" at the spread holding the first page that uses any of its
    // clustered photos (chapter→pages is recovered via photoIds; the flat layout
    // carries no chapter boundary).
    function computeChapterSpread(photoIds: string[]): number {
      const set = new Set(photoIds);
      let minI = Infinity;
      pagesState.forEach((p, i) => {
        if (Object.values(p.imagesJson).some((pid) => set.has(pid))) minI = Math.min(minI, i);
      });
      // minI is a pagesState array index; map it to its spread via buildSpreads
      // (the cover/ending solo-page layout means a flat /2 formula would misplace it).
      if (minI === Infinity) return 0;
      const sp = spreadIndexOfPage(spreads, minI);
      return sp === -1 ? 0 : sp;
    }
    function renderRail() {
      const useCh = chapters.length > 0;
      const items = useCh
        ? chapters.map((c, i) => ({ idx: c.spread, num: String(i + 1).padStart(2, '0'), label: c.label }))
        : Array.from({ length: spreadCount() }, (_, i) => ({ idx: i, num: String(i + 1).padStart(2, '0'), label: spreadLabel(i) }));
      const shortOf = (it: { num: string; label: string }) =>
        useCh ? [...it.label].slice(0, 2).join('') || it.num : it.num;

      const list = byId('chapterList');
      if (list) {
        list.innerHTML = items
          .map(
            (it) => `<div class="chapter${it.idx === currentCh ? ' active' : ''}" data-ch="${it.idx}" title="${esc(it.label)}">
            <span class="chapter-num">${it.num}</span>
            <span class="chapter-title">${esc(shortOf(it))}</span>
          </div>`,
          )
          .join('');
        list.querySelectorAll('.chapter').forEach((el) => {
          el.addEventListener('click', () => {
            const i = +el.getAttribute('data-ch')!;
            if (i !== currentCh) flipTo(i, i > currentCh ? 'next' : 'prev');
          });
        });
      }

    }

    const toggleChat = () => bodyEl.classList.toggle('chat-collapsed');
    const toggleRail = () => bodyEl.classList.toggle('rail-collapsed');

    /* ─── Thumbnail strip ─── */
    // Build the bottom thumbnail strip from real spreads (replaces the design's
    // three hardcoded placeholder thumbs).
    function buildThumbs() {
      // 收集态没有版式页,缩略图条无意义(CSS 也隐藏了它),不构建。
      if (isCollectMode) return;
      const row = byId('thumbRow');
      if (!row) return;
      row.innerHTML = Array.from({ length: spreadCount() }, (_, i) =>
        `<div class="thumb-item${i === currentCh ? ' active' : ''} shrink-0 w-[52px] cursor-pointer" data-gospread="${i}">
          <div class="thumb-img"><div class="thumb-img-left" data-tface="${i}-l"></div><div class="thumb-img-right" data-tface="${i}-r"></div></div>
        </div>`,
      ).join('');
      for (let i = 0; i < spreadCount(); i++) {
        const [lp, rp] = spreadPages(i);
        const tl = row.querySelector(`[data-tface="${i}-l"]`) as HTMLElement | null;
        const tr = row.querySelector(`[data-tface="${i}-r"]`) as HTMLElement | null;
        // #158 follow-up: an empty half is blank space (no surface fill); drop the
        // thumb spine divider when either half is empty (solo cover/ending thumb).
        tl?.classList.toggle('thumb-empty', lp === null);
        tr?.classList.toggle('thumb-empty', rp === null);
        (tl?.closest('.thumb-img') as HTMLElement | null)?.classList.toggle('thumb-solo', lp === null || rp === null);
        paintEl(tl, lp);
        paintEl(tr, rp);
      }
      row.querySelectorAll('[data-gospread]').forEach((el) => {
        el.addEventListener('click', () => goToSpread(parseInt(el.getAttribute('data-gospread')!, 10)));
      });
    }
    function updateThumbUI(chIdx: number) {
      $$('.thumb-item').forEach((el, i) => el.classList.toggle('active', i === chIdx));
      const ti = byId('thumbInd');
      if (ti) ti.textContent = (chIdx + 1) + ' / ' + spreadCount();
    }
    function goToSpread(chIdx: number) {
      if (chIdx === currentCh || chIdx < 0 || chIdx >= spreadCount()) return;
      flipTo(chIdx, chIdx > currentCh ? 'next' : 'prev');
      updateThumbUI(chIdx);
    }
    function thumbNav(dir: number) {
      let next = currentCh + dir;
      if (next < 0) next = spreadCount() - 1;
      if (next >= spreadCount()) next = 0;
      goToSpread(next);
    }
    // ① Flip the book to a chapter's first page. Used when 「确定本章」 advances the
    // live chapter so the canvas follows the chat into the next chapter. The
    // chapter→page map comes from the draft skeleton (DraftSkeletonPage.chapterId);
    // we resolve its first page, find the spread it sits on, and flip there. No-op
    // when the skeleton/chapter/spread can't be resolved (leaves the view as-is).
    function goToChapterById(chapterId: string) {
      // 收集态:没有版式页可翻。goToChapterById 改成「把画板照片网格切到这一章」——
      // 记住当前章 + 重画网格(采访推进到下一章时 finishInterview 调这里,网格随之切)。
      if (isCollectMode) {
        collectChapterId = chapterId;
        renderCollectGrid();
        return;
      }
      const pageIdx = draftSkel?.pages.find((p) => p.chapterId === chapterId)?.pageIndex;
      if (pageIdx == null) return;
      const sp = spreadIndexOfPage(spreads, pageIdx);
      if (sp < 0) return;
      goToSpread(sp);
    }
    function goToPageIndex(pageIndex: number) {
      const sp = spreadIndexOfPage(spreads, pageIndex);
      if (sp < 0) return;
      selectedPageIndex = pageIndex;
      goToSpread(sp);
      updateSelectionHighlight();
    }

    // Chapter meta for the collect board (canvas-side; ChatPanel has its own copy for
    // the chat cards). Resolves a chapter's display title + 1-based number + full
    // photoIds from the read-only draft skeleton (invariant 12).
    function chapterMetaById(chapterId: string): { num: number; title: string; photoIds: string[] } | null {
      const idx = draftSkel?.chapters.findIndex((c) => c.chapterId === chapterId) ?? -1;
      if (idx < 0) return null;
      const c = draftSkel!.chapters[idx]!;
      const photoIds = c.photoIds?.length
        ? [...new Set(c.photoIds)]
        : [
            ...new Set(
              (draftSkel?.pages ?? [])
                .filter((p) => p.chapterId === chapterId)
                .flatMap((p) => Object.values(p.imagesJson).filter(Boolean)),
            ),
          ];
      return { num: idx + 1, title: (c.subject && c.subject.trim()) || c.label, photoIds };
    }

    // 收集态画板:把 collectChapterId 这一章的照片平铺进 #collectBoard(命令式 DOM,
    // 和本文件其余部分同风格)。照片来自 chapterMetaById(优先 chapter.photoIds,排版前就有);
    // imageUrls[id] 是 IndexedDB 解出的 blob: URL(EditorAuthoring 已按 chapters.photoIds 预取,
    // 见 §invariant 1)。URL 还没到时占位灰块。bodyEl 上的 collect-on 类由 CSS 负责隐藏版式书
    // (#book / 缩略图条 / 缩放条 / 概览)并显示这块网格。
    function renderCollectGrid() {
      if (!isCollectMode) return;
      bodyEl.classList.add('collect-on');
      const board = byId('collectBoard');
      if (!board) return;
      board.innerHTML = '';
      const meta = collectChapterId ? chapterMetaById(collectChapterId) : null;
      // 标题条:第 N 章 · 标题 · 张数。没解析到章(还没定位)就留空网格。
      const head = document.createElement('div');
      head.className = 'collect-head';
      if (meta) {
        const title = document.createElement('div');
        title.className = 'collect-title';
        title.textContent = meta.title;
        const sub = document.createElement('div');
        sub.className = 'collect-sub';
        sub.textContent = `${aT(`第 ${meta.num} 组`, `Chapter ${meta.num}`)} · ${meta.photoIds.length} ${t('photosWord')}`;
        head.appendChild(title);
        head.appendChild(sub);
      }
      const grid = document.createElement('div');
      grid.className = 'collect-grid';
      for (const photoId of meta?.photoIds ?? []) {
        const cell = document.createElement('div');
        cell.className = 'collect-cell';
        const url = imageUrls[photoId];
        if (url) {
          cell.style.backgroundImage = `url("${url}")`;
        } else {
          // 原图还没从 IndexedDB 解出来 —— 占位灰块(collect-cell 底色即 --bg)。
          cell.classList.add('collect-cell-empty');
        }
        grid.appendChild(cell);
      }
      if (meta) board.appendChild(head);
      board.appendChild(grid);
    }

    /* ─── Zoom + overview ─── */
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    // ZMIN is the visible lower bound: zooming out clamps the book here (the
    // spread stays scaled + visible). Overview is reachable *only* via ovBtn,
    // never by crossing the zoom floor (issue #157).
    const ZMIN = 0.25, ZMAX = 2, ZSTEP = 0.25;
    function applyZoom() {
      const bk = byId('book');
      if (bk) bk.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      const p = byId('zoomPct');
      if (p) p.textContent = Math.round(zoom * 100) + '%';
      positionElementToolbar();
    }
    function zoomBy(d: number) {
      if (bodyEl.classList.contains('overview-on')) {
        if (d > 0) exitOverview();
        return;
      }
      // Clamp to [ZMIN, ZMAX]. Zooming out past the floor just stops at ZMIN;
      // the book stays scaled + visible and never auto-jumps to overview.
      zoom = clampZoom(zoom + d, ZMIN, ZMAX);
      applyZoom();
    }
    function resetZoom() {
      if (bodyEl.classList.contains('overview-on')) { exitOverview(); return; }
      zoom = 1; panX = 0; panY = 0; applyZoom();
    }
    function renderOverview() {
      const g = byId('ovGrid');
      if (!g) return;
      g.innerHTML = Array.from({ length: spreadCount() }, (_, i) => {
        const [lp, rp] = spreadPages(i);
        // #158 follow-up: drop the ov-book surface fill + spine for a solo spread so
        // the empty half reads as empty space, not a white page.
        const solo = lp === null || rp === null;
        const lpi = lp === null ? '' : String(lp.pageIndex);
        const rpi = rp === null ? '' : String(rp.pageIndex);
        const lSel = lp !== null && lp.pageIndex === selectedPageIndex ? ' ov-page-selected' : '';
        const rSel = rp !== null && rp.pageIndex === selectedPageIndex ? ' ov-page-selected' : '';
        return `<div class="ov-spread${i === currentCh ? ' ov-current' : ''}" data-ovidx="${i}">
          <div class="ov-book${solo ? ' ov-solo' : ''}"><div class="ov-page ov-left${lp === null ? ' ov-empty' : ''}${lSel}" data-oface="${i}-l" data-page-index="${lpi}"></div><div class="ov-page ov-right${rp === null ? ' ov-empty' : ''}${rSel}" data-oface="${i}-r" data-page-index="${rpi}"></div></div>
          <div class="ov-cap">${spreadLabel(i)}</div>
        </div>`;
      }).join('');
      for (let i = 0; i < spreadCount(); i++) {
        const [lp, rp] = spreadPages(i);
        paintEl(g.querySelector(`[data-oface="${i}-l"]`) as HTMLElement | null, lp);
        paintEl(g.querySelector(`[data-oface="${i}-r"]`) as HTMLElement | null, rp);
      }
      // 单页选中(与正常模式一致):点某一页 => 选中该页 + 进入该跨页;空页/无 index => 整跨页跳转。
      g.querySelectorAll('.ov-page:not(.ov-empty)').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const pi = (el as HTMLElement).dataset.pageIndex;
          const spread = el.closest('.ov-spread');
          const ovIdx = spread ? +spread.getAttribute('data-ovidx')! : currentCh;
          if (pi) selectedPageIndex = Number(pi);
          openSpreadFromOverview(ovIdx);
        });
      });
      g.querySelectorAll('.ov-spread').forEach((el) => {
        el.addEventListener('click', () => openSpreadFromOverview(+el.getAttribute('data-ovidx')!));
      });
    }
    function enterOverview() {
      // Show the overview container *before* rendering: while .book-overview is
      // display:none its .ov-page cells measure 0×0, so paintEl would inject
      // 1×1 pages (issue #157). Flip the class, force a synchronous reflow, then
      // render against real box sizes.
      bodyEl.classList.add('overview-on');
      void byId('bookOverview')?.getBoundingClientRect();
      renderOverview();
      byId('ovBtn')?.classList.add('active');
      const p = byId('zoomPct'); if (p) p.textContent = t('overview');
    }
    function exitOverview() {
      bodyEl.classList.remove('overview-on');
      byId('ovBtn')?.classList.remove('active');
      zoom = 1; panX = 0; panY = 0; applyZoom();
    }
    function toggleOverview() {
      bodyEl.classList.contains('overview-on') ? exitOverview() : enterOverview();
    }
    function openSpreadFromOverview(i: number) {
      exitOverview();
      if (i !== currentCh) flipTo(i, i > currentCh ? 'next' : 'prev');
      // 概览里选的页带回正常模式高亮(若选中页就在当前跨页,flipTo 不触发,这里补刷)。
      updateSelectionHighlight();
    }
    const stage = $('.book-stage') as HTMLElement | null;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? ZSTEP : -ZSTEP); }
    };
    stage?.addEventListener('wheel', onWheel, { passive: false });

    const editBar = byId('elBar') as HTMLElement | null;
    let editBarAnchor: HTMLElement | null = null;
    function setEditBarGroup(group: 'text' | 'photo') {
      editBar?.querySelectorAll<HTMLElement>('[data-group]').forEach((el) => {
        el.style.display = el.dataset.group === group ? 'flex' : 'none';
      });
    }
    function positionElementToolbar() {
      if (!editBar || !editBar.classList.contains('show') || !editBarAnchor) return;
      const rect = editBarAnchor.getBoundingClientRect();
      const top = Math.max(62, rect.top - editBar.offsetHeight - 10);
      const left = Math.min(
        window.innerWidth - editBar.offsetWidth - 10,
        Math.max(10, rect.left + rect.width / 2 - editBar.offsetWidth / 2),
      );
      editBar.style.left = `${left}px`;
      editBar.style.top = `${top}px`;
    }
    function showElementToolbar(anchor: HTMLElement, group: 'text' | 'photo') {
      if (!editBar) return;
      editBarAnchor = anchor;
      setEditBarGroup(group);
      editBar.classList.add('show');
      requestAnimationFrame(positionElementToolbar);
    }
    function hideElementToolbar() {
      editBarAnchor = null;
      editBar?.classList.remove('show');
    }
    function selectedTextTargets(): HTMLElement[] {
      if (!editBarAnchor || imgEdit) return [];
      if (editBarAnchor.matches('[data-editable]:not(img)')) return [editBarAnchor];
      return Array.from(editBarAnchor.querySelectorAll<HTMLElement>('[data-editable]:not(img)'));
    }
    function pageForEditableText(textEl: HTMLElement): EditorPage | null {
      const host = textEl.closest<HTMLElement>('.page, .leaf, .ov-page, .thumb-img-left, .thumb-img-right');
      const pageIndex = host?.dataset.pageIndex;
      if (pageIndex === undefined) return null;
      return pageByIndex(Number(pageIndex)) ?? null;
    }
    function updateEditSizeLabel(targets = selectedTextTargets()) {
      const label = byId('ebSize');
      if (!label) return;
      const first = targets[0];
      if (!first) {
        label.textContent = '--';
        return;
      }
      label.textContent = `${Math.round(parseFloat(getComputedStyle(first).fontSize) || 14)}`;
    }
    function flashEditFeedback(text: string) {
      const label = byId('ebSize');
      if (!label) return;
      const prev = label.textContent ?? '--';
      label.textContent = text;
      window.setTimeout(() => { if (label.isConnected) label.textContent = prev; }, 900);
    }
    function persistPagePatch(page: EditorPage) {
      void fetch(`/api/v1/albums/${albumId}/pages/${page.pageIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagesJson: page.imagesJson,
          textsJson: page.textsJson,
          imagePosJson: page.imagePosJson ?? {},
        }),
      }).catch(() => {});
    }
    function editSelectedText() {
      const textEl = selectedTextTargets()[0];
      if (!textEl) return;
      const textKey = textEl.dataset.textKey;
      const page = pageForEditableText(textEl);
      textEl.setAttribute('contenteditable', 'true');
      textEl.style.cursor = 'text';
      textEl.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textEl);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const finish = () => {
        textEl.removeAttribute('contenteditable');
        textEl.style.cursor = '';
        if (!textKey || !page) return;
        page.textsJson = { ...page.textsJson, [textKey]: textEl.textContent ?? '' };
        ensureCurrentFonts();
        persistPagePatch(page);
        repaintBook();
      };
      textEl.addEventListener('blur', finish, { once: true });
    }
    function applyTextToolbarAction(action: string) {
      const targets = selectedTextTargets();
      if (targets.length === 0) return;
      const colorMap: Record<string, string> = {
        'color-ink': '#111111',
        'color-teal': '#13B8A6',
        'color-purple': '#8C5EF4',
        'color-gray': '#777777',
      };
      const fontMap: Record<string, string> = {
        display: 'var(--font-display)',
        playfair: 'Playfair Display, Georgia, serif',
        body: 'var(--font-body)',
        mono: 'var(--font-mono)',
      };
      if (action === 'font-family') {
        const sel = editBar?.querySelector<HTMLSelectElement>('.eb-sel');
        const family = sel ? fontMap[sel.value] : undefined;
        if (family) targets.forEach((el) => { el.style.fontFamily = family; });
      } else if (action === 'font-plus' || action === 'font-minus') {
        targets.forEach((el) => {
          const current = parseFloat(getComputedStyle(el).fontSize) || 14;
          const next = Math.min(72, Math.max(10, current + (action === 'font-plus' ? 2 : -2)));
          el.style.fontSize = `${next}px`;
        });
      } else if (action === 'bold') {
        targets.forEach((el) => { el.style.fontWeight = getComputedStyle(el).fontWeight === '700' ? '' : '700'; });
      } else if (action === 'italic') {
        targets.forEach((el) => { el.style.fontStyle = getComputedStyle(el).fontStyle === 'italic' ? '' : 'italic'; });
      } else if (action.startsWith('align-')) {
        const value = action.replace('align-', '') as 'left' | 'center' | 'right';
        targets.forEach((el) => { el.style.textAlign = value; });
      } else if (colorMap[action]) {
        targets.forEach((el) => { el.style.color = colorMap[action]; });
      }
      updateEditSizeLabel(targets);
      positionElementToolbar();
    }
    function replaceSelectedPhoto() {
      if (!imgEdit) return;
      const page = pageByIndex(imgEdit.pageIndex);
      if (!page) return;
      const pool = bookPhotoIds();
      const current = page.imagesJson[imgEdit.slotId];
      const next = pool.length > 1
        ? pool[(Math.max(0, pool.indexOf(current ?? '')) + 1) % pool.length]
        : undefined;
      if (!next || next === current) {
        flashEditFeedback(aT('无照片', 'No photos'));
        return;
      }
      page.imagesJson = { ...page.imagesJson, [imgEdit.slotId]: next };
      page.imagePosJson = { ...(page.imagePosJson ?? {}) };
      delete page.imagePosJson[imgEdit.slotId];
      imgEdit.pos = { ...DEFAULT_IMAGE_POS };
      repaintBook();
      persistPagePatch(page);
      flashEditFeedback(aT('已换', 'Swapped'));
    }
    function deleteSelectedPhoto() {
      if (!imgEdit) return;
      const page = pageByIndex(imgEdit.pageIndex);
      if (!page) return;
      delete page.imagesJson[imgEdit.slotId];
      page.imagePosJson = { ...(page.imagePosJson ?? {}) };
      delete page.imagePosJson[imgEdit.slotId];
      clearImageSelection();
      repaintBook();
      persistPagePatch(page);
      flashEditFeedback(aT('已删', 'Deleted'));
    }
    function toggleSelectedPhotoFilter() {
      if (!imgEdit) return;
      const active = imgEdit.imgEl.dataset.mockFilter === 'mono';
      imgEdit.imgEl.dataset.mockFilter = active ? '' : 'mono';
      imgEdit.imgEl.style.filter = active ? '' : 'grayscale(1) contrast(1.08)';
      flashEditFeedback(active ? aT('原图', 'Raw') : aT('滤镜', 'Filter'));
    }
    const onEditBarPointerDown = (e: Event) => e.stopPropagation();
    const onEditBarClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const action = target.closest<HTMLElement>('[data-edit-action]')?.dataset.editAction;
      if (!action) return;
      if (action === 'reset-photo') {
        if (!imgEdit) return;
        imgEdit.pos = { ...DEFAULT_IMAGE_POS };
        applyLiveImagePos(imgEdit.imgEl, imgEdit.pos);
        if (imgEditSlider) imgEditSlider.value = String(imgEdit.pos.scale);
        commitImagePos();
      } else if (action === 'replace-photo') {
        replaceSelectedPhoto();
      } else if (action === 'delete-photo') {
        deleteSelectedPhoto();
      } else if (action === 'photo-filter') {
        toggleSelectedPhotoFilter();
      } else if (action === 'edit-text') {
        editSelectedText();
      } else {
        applyTextToolbarAction(action);
      }
    };
    const onEditBarChange = (e: Event) => {
      const target = e.target as HTMLElement;
      const action = target.closest<HTMLElement>('[data-edit-action]')?.dataset.editAction;
      if (action) applyTextToolbarAction(action);
    };
    editBar?.addEventListener('pointerdown', onEditBarPointerDown);
    editBar?.addEventListener('click', onEditBarClick);
    editBar?.addEventListener('change', onEditBarChange);
    const onWindowResize = () => positionElementToolbar();
    window.addEventListener('resize', onWindowResize);

    let canvasDragging = false;
    let canvasStartX = 0;
    let canvasStartY = 0;
    let canvasOriginX = 0;
    let canvasOriginY = 0;
    const shouldSkipCanvasPan = (target: HTMLElement | null) =>
      !target ||
      !!target.closest('.el-bar, .img-edit-overlay, .thumb-strip, .zoom-ctrl, .book-overview, .chapter-card, .mobile-chapter-bar, button, a, input, textarea, select, [contenteditable="true"]');
    const onCanvasPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || shouldSkipCanvasPan(e.target as HTMLElement | null)) return;
      canvasDragging = true;
      canvasOriginX = panX;
      canvasOriginY = panY;
      canvasStartX = e.clientX;
      canvasStartY = e.clientY;
      hideElementToolbar();
      stage?.classList.add('panning');
      stage?.setPointerCapture?.(e.pointerId);
    };
    const onCanvasPointerMove = (e: PointerEvent) => {
      if (!canvasDragging) return;
      panX = canvasOriginX + e.clientX - canvasStartX;
      panY = canvasOriginY + e.clientY - canvasStartY;
      applyZoom();
    };
    const endCanvasPan = (e: PointerEvent) => {
      if (!canvasDragging) return;
      canvasDragging = false;
      stage?.classList.remove('panning');
      stage?.releasePointerCapture?.(e.pointerId);
    };
    const onCanvasDoubleClick = (e: MouseEvent) => {
      if (shouldSkipCanvasPan(e.target as HTMLElement | null)) return;
      panX = 0;
      panY = 0;
      applyZoom();
    };
    stage?.addEventListener('pointerdown', onCanvasPointerDown);
    stage?.addEventListener('pointermove', onCanvasPointerMove);
    stage?.addEventListener('pointerup', endCanvasPan);
    stage?.addEventListener('pointercancel', endCanvasPan);
    stage?.addEventListener('dblclick', onCanvasDoubleClick);

    /* ─── Photo picker ─── */
    const PICK_PHOTOS = [
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=300&q=70',
      'https://images.unsplash.com/photo-1519046904884-53103b34b206?w=300&q=70',
      'https://images.unsplash.com/photo-1505228395891-9a51e7e86bf6?w=300&q=70',
      'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?w=300&q=70',
      'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=300&q=70',
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=300&q=70',
      'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=300&q=70',
      'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=300&q=70',
      'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=300&q=70',
      'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=300&q=70',
      'https://images.unsplash.com/photo-1530789253388-582c481c54b0?w=300&q=70',
    ];
    function buildPickGrid() {
      const grid = byId('pickGrid');
      if (!grid) return;
      grid.querySelectorAll('.pick-photo').forEach((n) => n.remove());
      PICK_PHOTOS.forEach((url) => {
        const d = document.createElement('div');
        d.className = 'pick-photo';
        d.style.backgroundImage = `url('${url}')`;
        d.innerHTML = `<span class="pick-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
        d.addEventListener('click', () => { d.classList.toggle('sel'); updatePickCount(); });
        grid.appendChild(d);
      });
    }
    function updatePickCount() {
      const n = $$('#pickGrid .pick-photo.sel').length;
      const pc = byId('pickCount'); if (pc) pc.textContent = String(n);
      const btn = byId('createChBtn') as HTMLButtonElement | null;
      if (btn) btn.disabled = n === 0;
    }
    function openPhotoPicker() {
      buildPickGrid(); updatePickCount();
      byId('photoModal')?.classList.add('open');
    }
    function closePhotoPicker() {
      byId('photoModal')?.classList.remove('open');
    }

    /* ─── New-chapter flow is creation-phase only (theme/chapter-chat routes),
       not part of the editor — the add-chapter affordance is cut for this pass.
       The picker modal stays dormant; confirm just closes it. ─── */
    function confirmNewChapter() {
      closePhotoPicker();
    }

    // ③④ theme/cover patches fold into pagesState the SAME way the chapter edit-turn
    // does. ChatPanel sends only the user's selections; the Web service re-slices
    // draft_json server-side (invariant 12). BrowserLayoutPatchEntry is
    // shape-compatible with LayoutPatchEntry.
    function applyAuthoringPatch(patch: LayoutPatchEntry[]): boolean {
      if (patch.length === 0) return false;
      pagesState = applyPatchToPages(pagesState, patch);
      ensureCurrentFonts();
      rebuildSpreads();
      repaintBook();
      return true;
    }
    // The book's photo ids (deduped, in page order) — the hero-photo picker pool.
    function bookPhotoIds(): string[] {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const p of pagesState) {
        for (const id of Object.values(p.imagesJson)) {
          if (id && !seen.has(id)) {
            seen.add(id);
            out.push(id);
          }
        }
      }
      return out;
    }
    // Template ids of a given category (sorted, stable) — the cover/ending candidates.
    function templateIdsByCategory(category: 'cover' | 'ending'): string[] {
      return TEMPLATE_IDS.filter((id) => getTemplate(id)?.category === category);
    }
    // The hero image-slot id of a template (its first declared image slot), or 'image'.
    function heroSlotId(templateId: string): string {
      const slots = getTemplate(templateId)?.images ?? [];
      return slots[0]?.id ?? 'image';
    }
    // Render a {template, photo} choice through its real web template into the .cv-opt box.
    function coverOptionHTML(templateId: string, photoId: string | null): string {
      const page: EditorPage = {
        pageIndex: 0,
        templateId,
        imagesJson: photoId ? { [heroSlotId(templateId)]: photoId } : {},
        textsJson: {},
      };
      return faceHTML(page, 132, 176);
    }
    // #162 draft-edit turn: the draft-period chat is a pointed single-page edit,
    // talk/act physically split (no theme→chapter machine, no auto-advance). The
    // message goes to /draft-edit scoped to the page the user is looking at
    // (selectedPageIndex, else the first page of the current spread). On 'act' we
    // merge the returned pageWrite into that page locally + repaint; on 'talk' we
    // just append the reply. The agent already persisted the draft server-side.
    function authoringFocusPageIndex(): number {
      if (selectedPageIndex != null) return selectedPageIndex;
      // No explicit selection → focus the first real page on the current spread
      // (left, else right). Cover sits alone on spread 0's right slot.
      const [lp, rp] = spreadPages(currentCh);
      return (lp ?? rp)?.pageIndex ?? 0;
    }
    // Apply a kind:'act' write locally (the server already persisted it into
    // draft_json — both pageWrite copy edits and imagePosWrite position/scale moves
    // land in draft_json server-side; the browser only mirrors + repaints so a reload
    // re-reads the same draft). Returns a descriptor so ChatPanel can narrate the
    // change (the appendStep line lives in the chat, not here).
    function applyDraftAct(r: DraftEditResult): DraftActApplied {
      if (r.pageWrite) {
        const page = pageByIndex(r.pageWrite.pageIndex);
        if (page) {
          page.textsJson = { ...page.textsJson, ...r.pageWrite.texts };
          ensureCurrentFonts();
          repaintBook();
          return { pageWrite: true };
        }
      }
      if (r.imagePosWrite) {
        const w = r.imagePosWrite;
        const page = pageByIndex(w.pageIndex);
        if (page) {
          // Fold the single per-image {x,y,scale} into imagePosJson[imageId] (the
          // render layer reads it; mirrors the server-persisted draft_json).
          page.imagePosJson = {
            ...(page.imagePosJson ?? {}),
            [w.imageId]: { x: w.x, y: w.y, scale: w.scale },
          };
          repaintBook();
          return { imagePos: { x: w.x, y: w.y, scale: w.scale } };
        }
      }
      return {};
    }

    // ════════════════════════════════════════════════════════════════════════
    // ② 章节故事 — one real /v3/edit-chat turn. This is the active authoring send
    // path; Agent owns committed history/op state and returns a commit bundle:
    //   • pagesTexts → merge each page's rewritten copy into pagesState.
    //   • patches    → fold page patches through the same applyPatch path the
    //                  finalized editor uses.
    // ════════════════════════════════════════════════════════════════════════

    // write: merge the agent's per-page copy rewrites into pagesState + repaint.
    function applyChapterWrite(pagesTexts: V3PageTextsPatch[]): boolean {
      let applied = false;
      for (const pt of pagesTexts) {
        const page = pageByIndex(pt.pageIndex);
        if (!page) continue;
        page.textsJson = { ...page.textsJson, ...pt.texts };
        applied = true;
      }
      if (applied) {
        ensureCurrentFonts();
        repaintBook();
      }
      return applied;
    }

    // edit: fold the agent's deterministic page patch into pagesState via the same
    // applyPatchToPages used by the finalized editor (text / image-slot / template).
    function applyChapterEdit(layoutPatch: LayoutPatchEntry[]): boolean {
      if (layoutPatch.length === 0) return false;
      pagesState = applyPatchToPages(pagesState, layoutPatch);
      ensureCurrentFonts();
      rebuildSpreads();
      repaintBook();
      return true;
    }

    // 设计对话整书刷新：直接用服务端回来的新页整体替换 pagesState，原地重绘（用已加载
    // 的图 URL，不重挂 EditorBook、不重载图，避免"全局刷新闪一下"）。页数不变时当前位置保持。
    function replacePages(pages: EditorPage[]): boolean {
      if (pages.length === 0) return false;
      pagesState = pages.map((p) => ({
        pageIndex: p.pageIndex,
        templateId: p.templateId,
        imagesJson: { ...p.imagesJson },
        textsJson: { ...p.textsJson },
        imagePosJson: { ...(p.imagePosJson ?? {}) },
      }));
      ensureCurrentFonts();
      rebuildSpreads();
      repaintBook();
      return true;
    }

    // Export: render the PDF in the browser (@react-pdf), download it locally,
    // and upload straight to R2 (bytes never touch the Web tier — invariant 4).
    // WP5.3 / §4.5d:连续 3 次导出失败后的安抚弹框开/关。复用编辑器既有的
    // .modal-overlay/.open 视觉(同 photoModal),只读 i18n 文案,不碰积分/不发飞书。
    function openExportFailModal() { byId('exportFailModal')?.classList.add('open'); }
    function closeExportFailModal() { byId('exportFailModal')?.classList.remove('open'); }

    // 导出分两段,语义【解耦】(用户诉求:本地拿到 PDF 就算导出成功):
    //   • render 段 —— 本地出 PDF + 本地下载。这才是用户眼里的「导出」:拿到文件即成功。
    //     连续 3 次 render 失败(真的没出 PDF)才弹安抚框 + 落日志。
    //   • upload 段 —— 传 R2 + 落库(云端留存 / 标 COMPLETED)。失败【完全静默】:后台
    //     自动重试 ≤3 次,耗尽也只 logger.error 落日志,**绝不弹框、不提示**——本地没配
    //     R2 时也不再把「云端上传失败」误报成「导出失败」。
    // 任一环节失败都抛 ExportError(带 phase + 可选 status,供脱敏日志用,§3 隐私)。整段
    // 路径**零 creditService**:导出成功或失败都不碰积分(积分早在 init 成功时已实扣,§5)。
    let didLocalDownload = false;
    async function renderPdfOnce(): Promise<Blob> {
      try {
        const adaptable = pagesState.map((p) => ({
          templateId: p.templateId, images: p.imagesJson, texts: p.textsJson, imagePos: p.imagePosJson,
        }));
        const ids = collectPhotoIds(adaptable);
        // 收敛单渲染器试点：NEXT_PUBLIC_PDF_RASTER=1 时走栅格 PDF（截屏幕渲染，与画布
        // 像素级一致，消除 index↔pdf 分歧）；否则维持现有 @react-pdf 矢量导出。栅格导出
        // 喂高分辨率原图（否则 1600px 源图被放大 3 倍会糊）。
        if (process.env.NEXT_PUBLIC_PDF_RASTER === '1') {
          const dataUrls = await photoStore.getPdfDataUrls(ids, RASTER_PDF_IMAGE_MAX_EDGE);
          const { renderAlbumPdfRaster } = await import('@/lib/pdf/render-raster');
          return await renderAlbumPdfRaster(adaptable, (id) => dataUrls[id], { scale: 3 });
        }
        const dataUrls = await photoStore.getPdfDataUrls(ids);
        const { renderAlbumPdf } = await import('@/lib/pdf/render');
        return await renderAlbumPdf(adaptable, (id) => dataUrls[id]);
      } catch (e) {
        throw new ExportError('render', e instanceof Error ? e.message : String(e));
      }
    }

    // Local download — useful even if R2 isn't configured (e.g. mock runs). Once
    // per export so a retry doesn't trigger a second download.
    function downloadPdfOnce(blob: Blob) {
      if (didLocalDownload) return;
      didLocalDownload = true;
      const url = URL.createObjectURL(blob);
      const aEl = document.createElement('a');
      aEl.href = url;
      aEl.download = (currentTitle || 'album') + '.pdf';
      document.body.appendChild(aEl);
      aEl.click();
      aEl.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async function uploadPdfOnce(blob: Blob): Promise<void> {
      const signRes = await fetch(`/api/v1/albums/${albumId}/pdf-upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: 'application/pdf', size: blob.size }),
      });
      const signJson = await signRes.json();
      if (!signJson.ok) {
        throw new ExportError('upload', signJson.error?.message ?? 'sign failed', signRes.status);
      }
      const { putUrl, r2Key } = signJson.data;
      const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: blob,
      });
      if (!putRes.ok) throw new ExportError('upload', `R2 PUT ${putRes.status}`, putRes.status);
      const confirmRes = await fetch(`/api/v1/albums/${albumId}/pdf`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r2Key }),
      });
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok || confirmJson.ok !== true) {
        throw new ExportError('upload', confirmJson.error?.message ?? 'PDF confirm failed', confirmRes.status);
      }
    }

    let exportingPdf = false;
    async function exportPdf() {
      // The topbar export button is prop-disabled when the gate is locked, and the
      // chat export-ready card only appears when unlocked — but defend anyway.
      if (exportGateLocked) return;
      if (exportingPdf) return;
      exportingPdf = true;
      didLocalDownload = false;
      const btn = $('[data-action="exportPdf"]') as HTMLButtonElement | null;
      if (btn) btn.style.opacity = '0.6';
      try {
        // render 段:出 PDF + 本地下载,自动重试 ≤3 次。连续 3 次失败才是真·导出失败 →
        // 弹安抚框 + 落日志。计数全在前端(runExportWithRetry),**不动积分**(§5)。
        let blob: Blob | null = null;
        const rendered = await runExportWithRetry(
          async () => { const b = await renderPdfOnce(); downloadPdfOnce(b); blob = b; },
          {
            onExhausted: (lastError, attempts) => {
              logger.error(buildExportFailureLog(lastError, { albumId, attempts }), 'pdf export failed');
              openExportFailModal();
            },
          },
        );
        // render 失败:安抚框已弹,到此为止(用户确实没拿到文件)。
        if (!rendered.ok || blob == null) return;

        // 到这里用户已拿到 PDF = 导出成功。云端上传(R2 + 落库)解耦,失败【完全静默】:
        // 后台自动重试 ≤3 次,耗尽也只落日志——不弹框、不提示(用户诉求)。飞书推送后置
        // (§4.5d):此处只 logger.error,不调任何飞书端点。
        await runExportWithRetry(() => uploadPdfOnce(blob!), {
          onExhausted: (lastError, attempts) => {
            logger.error(
              buildExportFailureLog(lastError, { albumId, attempts }),
              'pdf cloud upload failed (silent — local download already succeeded)',
            );
          },
        });
      } finally {
        exportingPdf = false;
        if (btn) btn.style.opacity = '';
      }
    }
    /* ─── Wire the canvas/topbar/modal data-action handlers ───
       Scoped to EditorBook's OWN subtree (topbar + #paneCenter + .chat-fold-expand +
       modals) so it never double-binds the chat-owned actions that ChatPanel binds
       inside its aside (buyShells / pickAddPhotos / toggleChat-collapse). */
    const actions: Record<string, () => void> = {
      exportPdf,
      toggleUserMenu,
      // .chat-fold-expand lives in the shell (canvas scope) and toggles the shared
      // body class; the .chat-fold-collapse button in the aside is
      // bound by ChatPanel.
      toggleChat,
      toggleOverview,
      resetZoom,
      openPhotoPicker,
      closePhotoPicker,
      // WP5.3 / §4.5d: 安抚弹框的两个出口。「再试一次」关弹框后重跑导出;「知道了」只关弹框。
      closeExportFail: closeExportFailModal,
      retryExportPdf: () => { closeExportFailModal(); void exportPdf(); },
      uploadStub: () => alert(t('alertUploadStub')),
      confirmNewChapter,
    };
    const actionHandlers: { el: Element; fn: EventListener }[] = [];
    $$scoped('[data-action]').forEach((el) => {
      const name = el.getAttribute('data-action')!;
      // Only bind the canvas/topbar/modal actions; chat-owned actions (buyShells,
      // pickAddPhotos, and the aside's toggleChat) are bound by ChatPanel.
      if (!(name in actions)) return;
      const fn = (e: Event) => {
        e.stopPropagation();
        actions[name]?.();
      };
      el.addEventListener('click', fn);
      actionHandlers.push({ el, fn });
    });
    // modal overlay: click on the backdrop (target === overlay) closes it
    const overlayEl = byId('photoModal');
    if (overlayEl) {
      const fn = (e: Event) => { if (e.target === overlayEl) closePhotoPicker(); };
      overlayEl.addEventListener('click', fn);
      actionHandlers.push({ el: overlayEl, fn });
    }
    // WP5.3 / §4.5d: same backdrop-click-to-close for the export-failure modal.
    const exportFailOverlay = byId('exportFailModal');
    if (exportFailOverlay) {
      const fn = (e: Event) => { if (e.target === exportFailOverlay) closeExportFailModal(); };
      exportFailOverlay.addEventListener('click', fn);
      actionHandlers.push({ el: exportFailOverlay, fn });
    }
    // zoom buttons carry an amount
    $$('[data-zoom]').forEach((el) => {
      const amt = parseFloat(el.getAttribute('data-zoom')!);
      const fn = () => zoomBy(amt);
      el.addEventListener('click', fn);
      actionHandlers.push({ el, fn });
    });
    // thumb nav buttons
    $$('[data-thumbnav]').forEach((el) => {
      const dir = parseInt(el.getAttribute('data-thumbnav')!, 10);
      const fn = () => thumbNav(dir);
      el.addEventListener('click', fn);
      actionHandlers.push({ el, fn });
    });
    // (thumb items: buildThumbs() rebuilds #thumbRow from real spreads and binds
    // their data-gospread clicks there, so no static binding is needed here.)

    /* ─── Topbar links → real routes ─── */
    $('.back-btn')?.setAttribute('href', `/${locale}/my-albums`);
    $('.brand')?.setAttribute('href', `/${locale}`);

    // Logout (better-auth): sign out, then to the login page.
    const logoutBtn = $('.dropdown-item.danger');
    if (logoutBtn) {
      const fn = (e: Event) => {
        e.preventDefault();
        void signOut().finally(() => { window.location.href = `/${locale}/login`; });
      };
      logoutBtn.addEventListener('click', fn);
      actionHandlers.push({ el: logoutBtn, fn });
    }

    // Language switch (decision: in the user menu). Inject EN / 中文 links; going
    // to the other locale re-renders the whole editor in that language.
    const dropdown = $('.user-dropdown');
    const header = dropdown?.querySelector('.dropdown-header');
    if (dropdown && header) {
      const row = document.createElement('div');
      row.className = 'flex gap-1 px-3 py-2';
      (['en', 'zh'] as const).forEach((l) => {
        const a = document.createElement('a');
        a.href = localizePath(window.location.pathname, l);
        a.textContent = l === 'zh' ? '中文' : 'EN';
        a.className =
          'flex-1 text-center px-2 py-1 rounded-lg text-[12px] no-underline ' +
          (l === locale ? 'bg-bg font-semibold text-fg' : 'text-fg2 hover:bg-bg');
        row.appendChild(a);
      });
      header.after(row);
    }

    // Chat init (history/opener/interview chain) now runs ONCE inside ChatPanel's
    // own mount effect — it is no longer part of the canvas mount. The canvas below
    // only paints the book + rail and populates the coordinator.

    // Real account identity in the user menu (design ships demo placeholders).
    void fetch('/api/v1/user/me')
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) return;
        const u = j.data ?? {};
        const nameEl = $('.dropdown-header-name');
        if (nameEl && u.name) nameEl.textContent = u.name;
        const emailEl = $('.dropdown-header-email');
        if (emailEl && u.email) emailEl.textContent = u.email;
        const av = $('.user-avatar-initial');
        if (av) av.textContent = String(u.name?.[0] ?? u.email?.[0] ?? 'U').toUpperCase();
      })
      .catch(() => {});

    // Editable album title: show the real title (not the demo i18n string) and
    // persist renames via PATCH /albums/:id.
    let currentTitle = detail.album.title;
    const titleEl = $('.album-title');
    if (titleEl) {
      titleEl.removeAttribute('data-i18n');
      titleEl.textContent = currentTitle;
      titleEl.addEventListener('blur', () => {
        const next = (titleEl.textContent ?? '').trim();
        if (!next || next === currentTitle) {
          titleEl.textContent = currentTitle;
          return;
        }
        const prevTitle = currentTitle;
        currentTitle = next;
        void fetch(`/api/v1/albums/${albumId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: next }),
        })
          .then((r) => r.json())
          .then((j) => { if (!j?.ok) throw new Error('rename failed'); })
          .catch(() => { currentTitle = prevTitle; titleEl.textContent = prevTitle; });
      });
    }

    // Chapter rail. Authoring reads it straight from the draft skeleton's chapters
    // (real labels/state, mapped to the spread holding their first page); editing
    // fetches the AI's image-cluster summary (read-only; invariant 12).
    // Declared as a hoisted function (not a const arrow) so the authoring init
    // block above — which may call enterStoryStage(0) immediately when a theme is
    // pre-set — can reference it without hitting the temporal dead zone.
    // i is an array index into draftSkel.pages, which mirrors pagesState in
    // authoring (refreshDraft maps draft.pages → pagesState 1:1). Map it to the
    // spread that holds it via buildSpreads (cover/ending sit solo, so the old flat
    // /2 formula would be off by the solo half-pages).
    function spreadOfFlatPage(i: number) {
      const sp = spreadIndexOfPage(spreads, i);
      return sp === -1 ? 0 : sp;
    }
    function railFromDraft() {
      if (!draftSkel) return;
      chapters = draftSkel.chapters.map((c) => ({
        // Prefer the chapter title (theme `subject`, #236) once the theme stage wrote it;
        // fall back to the generic「Chapter N」label before then.
        label: (c.subject && c.subject.trim()) || c.label,
        spread: spreadOfFlatPage(c.pageStart),
      }));
      renderRail();
    }
    if (isAuthoring) {
      railFromDraft();
    } else {
      void fetch(`/api/v1/albums/${albumId}/chapters`)
        .then((r) => r.json())
        .then((j) => {
          if (!j?.ok || !Array.isArray(j.data?.chapters) || j.data.chapters.length === 0) return;
          chapters = j.data.chapters.map((c: { label: string; photoIds: string[] }) => ({
            label: c.label,
            spread: computeChapterSpread(c.photoIds),
          }));
          renderRail();
        })
        .catch(() => {});
    }

    setLang(currentLang); // also runs renderRail + buildThumbs + paintSpread; walks
    // the shared outer root so it localizes topbar + chat + canvas.

    // collect-on 活在共享 outer root 上(它跨 remount 存活)。排版完成时 EditorBook 会以
    // 新 key(pages 0→N)重挂:新 effect 必须按自己的 isCollectMode 权威地复位这个类,否则
    // 收集态遗留的 collect-on 会继续用 CSS 藏住刚画好的版式书 → 画板空白。收集态由下面的
    // renderCollectGrid 重新加回。
    bodyEl.classList.remove('collect-on');
    if (isCollectMode) {
      // 收集态:没有版式页可画。画板显示当前采访章的照片网格,不碰 paintSpread/thumbs
      // (它们对空 pagesState 会渲染出空版式框)。collect-on 类隐藏版式书 chrome。首帧网格
      // 用初始 collectChapterId(下面 story-gate 加载后 goToChapterById 会切到 live 章)。
      renderCollectGrid();
    } else if (isAuthoring) {
      // Authoring pre-resolved originals from the draft skeleton (passed in as
      // initialImageUrls) — repaint with those rather than re-fetching from an
      // empty detail.pages / null layoutJson.
      paintSpread(currentCh);
      buildThumbs();
      if (bodyEl.classList.contains('overview-on')) renderOverview();
    } else {
      const photoIds = [
        ...new Set([
          ...extractPhotoIds(detail.album.layoutJson),
          ...collectPhotoIds(
            detail.pages.map((p) => ({ templateId: p.templateId, images: p.imagesJson, texts: p.textsJson })),
          ),
        ]),
      ];
      void photoStore.getObjectUrls(photoIds).then((urls) => {
        imageUrls = urls;
        paintSpread(currentCh);
        buildThumbs();
        if (bodyEl.classList.contains('overview-on')) renderOverview();
      });
    }

    // ── Populate the coordinator so the stable ChatPanel can drive the canvas +
    // export subsystem. On each EditorBook remount this effect re-runs and re-populates
    // coordinator.current wholesale with fresh closures — intended (ChatPanel always
    // dereferences coordinator.current.fn at call time, never caches it). ──
    coordinator.current = {
      ready: true,
      goToChapterById,
      goToPageIndex,
      applyChapterWrite,
      applyChapterEdit,
      applyAuthoringPatch,
      replacePages,
      applyDraftAct,
      getPagesState: () => pagesState,
      authoringFocusPageIndex,
      capturePageRender,
      capturePhotoThumb,
      coverOptionHTML,
      bookPhotoIds,
      imageUrl: (id: string) => imageUrls[id],
      setExportGateUi,
      exportPdf,
    };

    return () => {
      document.removeEventListener('click', onDocClick);
      stage?.removeEventListener('wheel', onWheel);
      stage?.removeEventListener('pointerdown', onCanvasPointerDown);
      stage?.removeEventListener('pointermove', onCanvasPointerMove);
      stage?.removeEventListener('pointerup', endCanvasPan);
      stage?.removeEventListener('pointercancel', endCanvasPan);
      stage?.removeEventListener('dblclick', onCanvasDoubleClick);
      editBar?.removeEventListener('pointerdown', onEditBarPointerDown);
      editBar?.removeEventListener('click', onEditBarClick);
      editBar?.removeEventListener('change', onEditBarChange);
      window.removeEventListener('resize', onWindowResize);
      actionHandlers.forEach(({ el, fn }) => el.removeEventListener('click', fn));
      // #168 manual image editor teardown.
      if (wheelCommitTimer) clearTimeout(wheelCommitTimer);
      for (const hostEl of [pageLeft, pageRight]) {
        hostEl.removeEventListener('pointerdown', onImgPointerDown);
        hostEl.removeEventListener('pointermove', onImgPointerMove);
        hostEl.removeEventListener('pointerup', onImgPointerUp);
        hostEl.removeEventListener('wheel', onImgWheel);
      }
      imgEditOverlay?.remove();
      // On remount the coordinator will be repopulated; clear it so a torn-down canvas
      // isn't left addressable via stale closures.
      if (coordinator.current?.exportPdf === exportPdf) coordinator.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Static markup: the canvas subtree only (#paneCenter). The topbar, chat aside
  // and modals are rendered by the stable shell; this component only owns the canvas
  // and scopes its effect to the shared outer root. ──
  return (
    <main className="pane pane-center flex flex-col overflow-hidden relative md:order-3 md:flex-1" id="paneCenter">
      <div className="book-stage w-full flex-1 flex items-center justify-center px-4 pt-8 pb-16 overflow-auto relative">
        <div className="canvas-hint" data-i18n="canvasHint">
          {locale === 'zh' ? '拖拽平移 · ⌘/Ctrl+滚轮缩放 · 点击元素可编辑' : 'Drag to pan · Cmd/Ctrl+wheel to zoom · Click to edit'}
        </div>
        <div className="book bg-surface flex relative overflow-hidden" id="book">
          <div className="page page-left bg-surface" id="pageLeft" />
          <div className="page page-right bg-surface" id="pageRight" />
          <div className="flipper" id="flipper">
            <div className="leaf front" id="leafFront" />
            <div className="leaf back" id="leafBack" />
          </div>
        </div>

        {/* 收集态画板:排版前(authoring + pages 为空)显示当前采访章的照片平铺网格,
            替代空版式书。renderCollectGrid 往里填内容;bodyEl 的 collect-on 类切换可见性。
            排版完成后 pages 非空 → 从不进收集态 → 这块始终隐藏。 */}
        <div className="collect-board" id="collectBoard" />

        <div className="thumb-strip absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center justify-center gap-2 px-3 py-1.5 z-[6] rounded-pill max-w-[92vw]">
          <div className="thumb-nav flex items-center gap-1.5">
            <button className="thumb-nav-btn w-5 h-5 rounded-full flex items-center justify-center text-muted transition-colors hover:text-fg hover:bg-bg" data-thumbnav="-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className="thumb-page-ind text-[10px] font-medium text-fg2 min-w-[36px] text-center" style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }} id="thumbInd">1 / 3</span>
            <button className="thumb-nav-btn w-5 h-5 rounded-full flex items-center justify-center text-muted transition-colors hover:text-fg hover:bg-bg" data-thumbnav="1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
          <div className="thumb-row flex gap-1.5 overflow-x-auto max-w-full p-0.5" id="thumbRow">
            <div className="thumb-item active shrink-0 w-[52px] cursor-pointer" data-gospread="0">
              <div className="thumb-img"><div className="thumb-img-left" style={{ background: 'linear-gradient(180deg, #e8e8e8 40%, #d0d0d0 100%)' }} /><div className="thumb-img-right" style={{ background: 'linear-gradient(135deg, #ddd 30%, #c8c8c8 100%)' }} /></div>
            </div>
            <div className="thumb-item shrink-0 w-[52px] cursor-pointer" data-gospread="1">
              <div className="thumb-img"><div className="thumb-img-left" style={{ background: 'linear-gradient(180deg, #e2e2e2 50%, #ccc 100%)' }} /><div className="thumb-img-right" style={{ background: 'linear-gradient(90deg, #e5e5e5, #d5d5d5)' }} /></div>
            </div>
            <div className="thumb-item shrink-0 w-[52px] cursor-pointer" data-gospread="2">
              <div className="thumb-img"><div className="thumb-img-left" style={{ background: 'linear-gradient(180deg, #e0e0e0 40%, #d2d2d2 100%)' }} /><div className="thumb-img-right" style={{ background: 'linear-gradient(135deg, #e8e8e8, #d8d8d8)' }} /></div>
            </div>
          </div>
        </div>

        <div className="book-overview" id="bookOverview">
          <div className="ov-grid" id="ovGrid" />
        </div>

        <div className="zoom-ctrl">
          <button className="zoom-btn" data-zoom="-0.25" data-i18n-title="zoomOut" title="缩小" aria-label="缩小">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
          <span className="zoom-pct" id="zoomPct" data-action="resetZoom" title="100%">100%</span>
          <button className="zoom-btn" data-zoom="0.25" data-i18n-title="zoomIn" title="放大" aria-label="放大">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
          <span className="zoom-sep" />
          <button className="zoom-btn" id="ovBtn" data-action="toggleOverview" data-i18n-title="overview" title="整本杂志" aria-label="整本杂志">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
          </button>
        </div>

        <div className="el-bar" id="elBar" role="toolbar" aria-label={locale === 'zh' ? '元素编辑工具' : 'Element editing tools'}>
          <div className="eb-group" data-group="text">
            <select className="eb-sel" data-edit-action="font-family" title={locale === 'zh' ? '字体' : 'Font'} aria-label={locale === 'zh' ? '字体' : 'Font'} defaultValue="display">
              <option value="display">{locale === 'zh' ? '思源宋体' : 'Display'}</option>
              <option value="playfair">Playfair</option>
              <option value="body">{locale === 'zh' ? '系统体' : 'System'}</option>
              <option value="mono">{locale === 'zh' ? '等宽' : 'Mono'}</option>
            </select>
            <span className="eb-sep" />
            <button type="button" className="eb-btn" data-edit-action="font-minus" title={locale === 'zh' ? '缩小字号' : 'Smaller'} aria-label={locale === 'zh' ? '缩小字号' : 'Smaller'}><span style={{ fontSize: 11 }}>A</span>-</button>
            <span className="eb-num" id="ebSize">--</span>
            <button type="button" className="eb-btn" data-edit-action="font-plus" title={locale === 'zh' ? '放大字号' : 'Larger'} aria-label={locale === 'zh' ? '放大字号' : 'Larger'}><span style={{ fontSize: 15 }}>A</span>+</button>
            <span className="eb-sep" />
            <button type="button" className="eb-btn" data-edit-action="bold" title={locale === 'zh' ? '加粗' : 'Bold'} aria-label={locale === 'zh' ? '加粗' : 'Bold'}><b>B</b></button>
            <button type="button" className="eb-btn" data-edit-action="italic" title={locale === 'zh' ? '斜体' : 'Italic'} aria-label={locale === 'zh' ? '斜体' : 'Italic'}><i style={{ fontFamily: 'Georgia,serif' }}>I</i></button>
            <span className="eb-sep" />
            <button type="button" className="eb-btn" data-edit-action="align-left" title={locale === 'zh' ? '左对齐' : 'Align left'} aria-label={locale === 'zh' ? '左对齐' : 'Align left'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg></button>
            <button type="button" className="eb-btn" data-edit-action="align-center" title={locale === 'zh' ? '居中' : 'Center'} aria-label={locale === 'zh' ? '居中' : 'Center'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="5" y1="18" x2="19" y2="18" /></svg></button>
            <button type="button" className="eb-btn" data-edit-action="align-right" title={locale === 'zh' ? '右对齐' : 'Align right'} aria-label={locale === 'zh' ? '右对齐' : 'Align right'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" /></svg></button>
            <span className="eb-sep" />
            <span className="eb-swatch" style={{ background: '#111111' }} data-edit-action="color-ink" title={locale === 'zh' ? '墨色' : 'Ink'} role="button" aria-label={locale === 'zh' ? '墨色' : 'Ink'} />
            <span className="eb-swatch" style={{ background: '#13B8A6' }} data-edit-action="color-teal" title={locale === 'zh' ? '青色' : 'Teal'} role="button" aria-label={locale === 'zh' ? '青色' : 'Teal'} />
            <span className="eb-swatch" style={{ background: '#8C5EF4' }} data-edit-action="color-purple" title={locale === 'zh' ? '紫色' : 'Purple'} role="button" aria-label={locale === 'zh' ? '紫色' : 'Purple'} />
            <span className="eb-swatch" style={{ background: '#999999' }} data-edit-action="color-gray" title={locale === 'zh' ? '灰色' : 'Gray'} role="button" aria-label={locale === 'zh' ? '灰色' : 'Gray'} />
            <span className="eb-sep" />
            <button type="button" className="eb-btn" data-edit-action="edit-text" title={locale === 'zh' ? '编辑文字' : 'Edit text'} aria-label={locale === 'zh' ? '编辑文字' : 'Edit text'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg><span>{locale === 'zh' ? '文字' : 'Text'}</span></button>
          </div>
          <div className="eb-group" data-group="photo" style={{ display: 'none' }}>
            <button type="button" className="eb-btn" data-edit-action="replace-photo" title={locale === 'zh' ? '更换照片' : 'Replace photo'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg><span>{locale === 'zh' ? '更换' : 'Replace'}</span></button>
            <span className="eb-sep" />
            <button type="button" className="eb-btn" data-edit-action="reset-photo" title={locale === 'zh' ? '复位照片' : 'Reset photo'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v6h6" /></svg><span>{locale === 'zh' ? '复位' : 'Reset'}</span></button>
            <span className="eb-sep" />
            <button type="button" className="eb-btn" data-edit-action="photo-filter" title={locale === 'zh' ? '滤镜' : 'Filter'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" /></svg><span>{locale === 'zh' ? '滤镜' : 'Filter'}</span></button>
            <span className="eb-sep" />
            <button type="button" className="eb-btn danger" data-edit-action="delete-photo" title={locale === 'zh' ? '删除照片' : 'Delete photo'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></svg><span>{locale === 'zh' ? '删除' : 'Delete'}</span></button>
          </div>
        </div>
      </div>

    </main>
  );
}
