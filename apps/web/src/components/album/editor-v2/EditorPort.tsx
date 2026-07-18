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

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type Locale } from '@/lib/i18n/routing';
import { signOut } from '@/lib/auth/client';
import { photoStore, RASTER_PDF_IMAGE_MAX_EDGE } from '@/lib/photo/store';
import {
  signPhotoSnapshotUpload,
  confirmPhotoSnapshot,
  putSnapshotBlob,
} from '@/lib/album/photo-snapshot-client';
import { UserAvatar } from '@/components/app/UserAvatar';
import { UserMenu } from '@/components/app/UserMenu';
import { useChromeSession } from '@/components/app/useChromeSession';
import { YujeeState } from '@/components/app/YujeeState';
import { RetryFailedButton } from '../RetryFailedButton';
import { getWebTemplate } from '../web-registry';
import { buildSpreads, isSoloSpread, pageSlot, spreadIndexOfPage } from '../spreads';
import { adaptPageToTemplateData, collectPhotoIds, type ResolveImage } from '../adapt-layout';
import { applyFolioOverlay, fitTextBoxes, pageFolioNumbers, patchHtmlImagePos, patchHtmlText, patchHtmlTextStyle, preferredPageHtml } from '../page-html-dom';
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
import { loadAlbumFonts, loadFontSubset, useAlbumFonts } from '@/lib/font/album-font-loader';
import { isCjkFontId, type CjkFontId } from '@/services/font/font-manifest';
import { FONT_CATALOG } from '@yujee/contracts/render';
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
import { getTemplate, TEMPLATE_IDS } from '@yujee/contracts/templates';
import { ChatPanel, type ChatMode } from './ChatPanel';
import {
  ChatCoordinatorContext,
  chatI18n,
  type ChatCoordinator,
  type DraftActApplied,
} from './editor-coordinator';
import './editor-port.css';

// ── 字体选择器数据源:项目字体目录(FONT_CATALOG = ArtFontPack,engine 与 web 同一套)
// 去掉抽象遗留载体后的**全部真实字体**。中文 9 + 英文若干,拉丁字体 @font-face 见
// styles/globals.css,中文走 /api/v1/fonts/subset 按需子集,均可真渲染。
// 不按 design_style.md 裁剪(该文档字体未定稿);列全,选中即写回 html 真相。 ──
const EDITOR_FONT_NAMES: Record<string, string> = {
  'noto-serif-sc': '思源宋体', 'noto-sans-sc': '思源黑体', 'zcool-xiaowei': '站酷小薇',
  'lxgw-wenkai': '霞鹜文楷', 'smiley-sans': '得意黑', 'zcool-qingke-huangyou': '站酷庆科黄油',
  'long-cang': '龙藏', 'zhi-mang-xing': '志莽行书', 'liu-jian-mao-cao': '柳建毛草',
  'playfair-display': 'Playfair Display', 'cormorant-garamond': 'Cormorant Garamond',
  'eb-garamond': 'EB Garamond', 'source-serif-4': 'Source Serif 4', lora: 'Lora',
  'libre-baskerville': 'Libre Baskerville', 'abril-fatface': 'Abril Fatface',
  'bebas-neue': 'Bebas Neue', 'archivo-black': 'Archivo Black', montserrat: 'Montserrat',
  inter: 'Inter', 'work-sans': 'Work Sans', 'dm-sans': 'DM Sans', poppins: 'Poppins',
  raleway: 'Raleway', 'ibm-plex-mono': 'IBM Plex Mono', 'jetbrains-mono': 'JetBrains Mono',
  'great-vibes': 'Great Vibes', 'dancing-script': 'Dancing Script', sacramento: 'Sacramento',
  parisienne: 'Parisienne',
};
// 抽象载体不进选择器(它们只是映射到具体字体的历史别名)。
const EDITOR_FONT_SKIP = new Set(['serif-classic', 'sans-modern', 'script-elegant', 'display-bold']);
export interface EditorFont { id: string; name: string; script: 'cjk' | 'latin'; stack: string; cjkId?: CjkFontId; }
const EDITOR_FONTS: EditorFont[] = Object.entries(FONT_CATALOG)
  .filter(([id]) => !EDITOR_FONT_SKIP.has(id) && EDITOR_FONT_NAMES[id])
  .map(([id, entry]) => ({
    id,
    name: EDITOR_FONT_NAMES[id]!,
    script: entry.script,
    // entry.webFontFamily 已是具体 web 字体栈字符串(不是 WEB_FONTS 的 key)。
    stack: entry.webFontFamily,
    cjkId: isCjkFontId(id) ? id : undefined,
  }));
// 中文项预览串:字体名 + 一句短样例(子集化只拉这些字,极小)。
const CJK_PREVIEW_SAMPLE = '字体预览一二三';

// ── 自定义取色器(参考「填充」面板设计):HSV 拾色 + 色相/透明度条 + 预设色 + hex/不透明度 ──
// 预设色 = 项目文字用色(黑为主 + 品牌青/紫)。
const COLOR_SWATCHES = ['#111111', '#FFFFFF', '#13B8A6', '#8C5EF4', '#C9B6F7', '#999999'];
function clamp01(x: number) { return Math.min(1, Math.max(0, x)); }
function hsvToRgb(h: number, s: number, v: number) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * ((((g - b) / d) % 6 + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hexToRgb(hex: string) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function toHex(n: number) { return Math.round(n).toString(16).padStart(2, '0'); }
function rgbToHex(r: number, g: number, b: number) { return `#${toHex(r)}${toHex(g)}${toHex(b)}`; }

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
//   • error     → terminal album state (FAILED / gone / transient-exhausted): the
//                 SAME static chrome as building, error illustration on the canvas.
export type EditorMode = 'loading' | 'building' | 'authoring' | 'editing' | 'error';

// Which terminal album state produced the error surface (from useAlbumPoll's phase).
export type EditorErrorKind = 'failed' | 'gone' | 'error';
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
  errorKind,
  errorMessage = null,
}: {
  detail: AlbumDetail;
  locale: Locale;
  mode?: EditorMode;
  generation?: GenerationProgress;
  errorKind?: EditorErrorKind;
  errorMessage?: string | null;
}) {
  // loading: UI/editor resources are not ready yet. Do not show half-loaded canvas
  // or chat chrome; those appear only after the resource load resolves.
  if (mode === 'loading') {
    return <EditorLoadingState locale={locale} />;
  }
  // error: terminal album state. Renders through the same static chrome as building
  // (W10 flow unification) — never the retired full-page AlbumGeneratingShell.
  if (mode === 'error') {
    return (
      <ErrorShell
        locale={locale}
        albumId={detail.album.id}
        kind={errorKind ?? 'error'}
        message={errorMessage ?? null}
      />
    );
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
  // 已加载草稿的内容指纹:pages-ready 事件来源很多(storyProgress 每次变化都会派发),
  // 内容没变时跳过「换 objectUrl + epoch 重挂」,消除采访/确认阶段画板一闪一闪。
  const draftFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    draftFingerprintRef.current = null; // 换相册/换阶段重置,首次必加载

    async function loadDraftSkeleton() {
      try {
        const { draft } = await fetchDraftSkeleton(detail.album.id);
        if (cancelled) return;
        if (!draft) {
          setLoadState('gone');
          return;
        }
        // 内容未变 → 不换 URL、不重挂(objectUrl 每次都是新串,盲目 setState 会闪)。
        const fingerprint = JSON.stringify(draft);
        if (fingerprint === draftFingerprintRef.current) return;
        // Resolve display-tier urls (invariant 1: photos live only in the browser;
        // 屏显用 ~1600px 派生图,原图只留给 PDF 导出)。Missing ids render as empty
        // slots — fine.
        const ids = new Set<string>();
        for (const p of draft.pages) for (const id of Object.values(p.imagesJson)) if (id) ids.add(id);
        // 排版前 pages 为空,照片来自章节(收集面板的章节卡片 + 画板照片平铺都要它)。
        for (const ch of draft.chapters) for (const id of ch.photoIds ?? []) if (id) ids.add(id);
        const urls = await photoStore.getTierUrls([...ids], 'display');
        if (cancelled) return;
        draftFingerprintRef.current = fingerprint;
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
    htmlJson: p.htmlJson,
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
  // 排完版进入编辑器默认落在【画板(编辑)视图】(用户拍板 2026-07-18):非收集态(已有版式页)
  // 首帧就带 overview-on,#ovGrid 画板直出,不再先闪一下画册预览。收集态还没版式页可编辑,
  // 保留照片网格、不进画板。EditorBook 的 enter/exitOverview 之后再命令式增删这个类。
  const startOnCanvas = !(mode === 'authoring' && initialPages.length === 0);

  return (
    <ChatCoordinatorContext.Provider value={coordinator}>
      <div
        ref={outerRootRef}
        data-album-fonts-ready={fontsReady}
        className={`editor-port font-sans antialiased leading-relaxed${startOnCanvas ? ' overview-on' : ''}`}
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
  // 账户菜单统一为 <UserMenu>(与 landing / my-albums 同一组件):真实姓名/邮箱、
  // 积分余额、我的相册、消耗记录、反馈、退出全在。此前编辑页是手搓静态 demo
  // (写死的占位姓名/邮箱)+ 命令式补真名 + 命令式注入语言行,三套逻辑
  // 打架且缺积分/相册/记录。showLangSwitch 保留编辑页菜单内的 EN/中文 切换。
  const session = useChromeSession();
  return (
    <div className="topbar nav-shell sticky top-0 z-50 h-14 flex items-center justify-between px-3 sm:px-6 shrink-0">
      <div className="top-left flex items-center gap-2 sm:gap-3 min-w-0">
        <a href={`/${locale}/my-albums`} className="back-btn flex items-center justify-center w-9 h-9 rounded-pill text-fg2 no-underline transition-colors hover:bg-black/[.05] shrink-0" data-i18n-title="backToDetail" title={locale === 'zh' ? '返回书本明细' : 'Back to albums'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><polyline points="15 18 9 12 15 6" /></svg>
        </a>
        <a href={`/${locale}`} className="brand no-underline text-inherit shrink-0"><img src="/logo-yujee.svg" alt="Yujee" style={{ height: '26px', width: 'auto', display: 'block' }} /></a>
        <span className="crumb text-meta text-[13px] hidden sm:inline">/</span>
        <span className="album-title font-display font-bold text-[14px] text-fg px-2 py-1 rounded-pill border border-transparent transition-colors hover:bg-bg cursor-text truncate" contentEditable suppressContentEditableWarning data-i18n="albumTitle">2024 厦门三日游</span>
      </div>
      <div className="top-right flex items-center gap-1 sm:gap-2 shrink-0">
        {/* 保存到云端(photo-snapshot):备份照片压缩图,换设备/清缓存也能看到内页。默认只
            图标;点击后按钮上短暂显示「备份中… → 绿点已备份 / 红点备份失败」再回到默认。
            data-action 由 EditorBook 的效果绑到 backupPhotos;备份态由 setSaveState 命令式更新。 */}
        <button
          className="save-btn hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-pill text-[13px] font-semibold text-fg2 border border-bd"
          data-action="backupPhotos"
          data-testid="backup-photos-btn"
          data-backup-state="idle"
          title={locale === 'zh' ? '保存到云端:备份照片,换设备也能看' : 'Save to cloud: back up photos so you can view on any device'}
        >
          <span className="backup-dot" aria-hidden="true" />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="save-ic w-4 h-4"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
          <span className="save-label" data-backup-label />
        </button>
        <span className="btn-glow" data-export-gate={exportUnlocked ? 'open' : 'locked'}>
          <button
            className="btn-primary bg-fg text-white px-4 py-2.5 rounded-pill text-[13px] font-semibold flex items-center gap-1.5 transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}
            data-action="exportPdf"
            data-testid="export-pdf-btn"
            data-i18n-title="exportPdf"
            disabled={!exportUnlocked}
            aria-disabled={!exportUnlocked}
            title={exportUnlocked ? (locale === 'zh' ? '导出 PDF' : 'Export PDF') : (locale === 'zh' ? '完成故事并选定封面后即可导出 PDF' : 'Finish the story and pick a cover to export the PDF')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            {/* 图标按钮:文案隐藏但保留(i18n 同步 + 只读姿态换「下载 PDF」时改它的 textContent)。 */}
            <span className="hidden" data-i18n="exportPdf">{locale === 'zh' ? '导出' : 'Export'}</span>
          </button>
        </span>

        <UserMenu user={session.user} locale={locale} showLangSwitch />
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
// StaticEditorShell — the non-interactive editor chrome shared by the building and
// terminal-error states (W10 flow unification): the same topbar + workspace + chat
// rail as the live editor, but with no coordinator/effect. The three varying slots
// (status pill, canvas body, chat body) are props so building AND error render
// through ONE chrome — the retired AlbumGeneratingShell full-page error layout is
// gone, so there is no second, stale error surface to drift out of sync.
// ════════════════════════════════════════════════════════════════════════════
function StaticEditorShell({
  locale,
  status,
  canvas,
  chatBody,
}: {
  locale: Locale;
  status: { label: string; tone: 'progress' | 'error' };
  canvas: ReactNode;
  chatBody: ReactNode;
}) {
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
            <span
              className={`w-1.5 h-1.5 rounded-full ${status.tone === 'progress' ? 'bg-gg animate-pulse' : ''}`}
              style={status.tone === 'error' ? { background: 'var(--accent)' } : undefined}
            />
            <span>{status.label}</span>
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
          <div className="book-stage w-full flex-1 flex items-center justify-center pt-8 pb-16 overflow-auto relative">
            {canvas}
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
              {chatBody}
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
// BuildingShell — the building state (AGENT_RUNNING / draft-skeleton fetch): the
// shared static chrome with a "tidying up" pill, a cover-skeleton canvas, and a
// non-interactive loading-chat notice. No chat engine, no coordinator — the poll
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
    <StaticEditorShell
      locale={locale}
      status={{ label: locale === 'zh' ? '整理中' : 'Tidying up', tone: 'progress' }}
      canvas={<BuildingCanvasState locale={locale} />}
      chatBody={
        <div className="msg ai max-w-full">
          <div className="thinking-block active">
            <img className="think-jelly" src="/jellyfish-loop.png" alt="" />
            <span className="thinking-label">{buildingStageLabel(generation?.stage, locale)}</span>
            <span className="thinking-dots"><span /><span /><span /></span>
          </div>
        </div>
      }
    />
  );
}

// Per-terminal-state copy for the error shell. EditorPort keeps its own inline
// zh/en dictionary (no messages/*.json) — same convention as buildingStageLabel.
// The raw backend errorMessage (e.g. "describe-chapters primary failed: upstream_4xx
// status=403 …") is NEVER shown — users don't need the internal diagnostic. `message`
// only distinguishes a network drop from a slow run; the real error still lives in
// album.errorMessage / server logs for debugging.
function errorShellCopy(kind: EditorErrorKind, message: string | null, zh: boolean) {
  const isNetwork = /lost connection|network|连接/i.test(message ?? '');
  switch (kind) {
    case 'failed':
      return {
        status: zh ? '出错了' : 'Something went wrong',
        title: zh ? '出错了' : 'Something went wrong',
        body: zh
          ? '生成时出了点问题,可以再试一次。未扣除积分。'
          : 'Something went wrong while generating. You can try again — no credit was charged.',
        chat: zh ? '生成时遇到了点问题,可以再试一次。' : 'Something interrupted the generation — you can try again.',
      };
    case 'gone':
      return {
        status: zh ? '无法打开' : 'Unavailable',
        title: zh ? '无法打开这本相册' : 'Couldn’t open this album',
        body: zh ? '它可能已被删除,或不在当前账户下。' : 'It may have been removed, or it isn’t available on this account.',
        chat: zh ? '我找不到这本相册了。' : 'I couldn’t find this memoir.',
      };
    default:
      return {
        status: isNetwork ? (zh ? '连接中断' : 'Connection lost') : (zh ? '处理较慢' : 'Taking a while'),
        title: zh ? '这比预期的时间长一些' : 'This is taking longer than expected',
        body: isNetwork
          ? (zh ? '网络异常,检查网络后刷新。' : 'Network error. Check your connection and refresh.')
          : (zh ? '仍在处理中 —— 刷新页面再看看。' : 'Still working on it — refresh to check back.'),
        chat: isNetwork
          ? (zh ? '连接好像断了,刷新一下就好。' : 'The connection dropped — a refresh should bring it back.')
          : (zh ? '还在处理,稍后刷新看看。' : 'Still processing — refresh in a moment.'),
      };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ErrorShell — terminal album states (FAILED / gone / transient-exhausted) render
// through the SAME static chrome as building. The unified error illustration
// (YujeeState, shared with the rest of the app) sits on the canvas with the
// recovery action (retry for FAILED, refresh for transient); the chat rail carries
// a short, calm line instead of echoing the raw upstream error string.
// ════════════════════════════════════════════════════════════════════════════
function ErrorShell({
  locale,
  albumId,
  kind,
  message,
}: {
  locale: Locale;
  albumId: string;
  kind: EditorErrorKind;
  message: string | null;
}) {
  const zh = locale === 'zh';
  const copy = errorShellCopy(kind, message, zh);
  return (
    <StaticEditorShell
      locale={locale}
      status={{ label: copy.status, tone: 'error' }}
      canvas={
        <YujeeState variant="error" title={copy.title} message={copy.body}>
          {kind === 'failed' && (
            <div className="flex justify-center">
              <RetryFailedButton albumId={albumId} />
            </div>
          )}
          {kind === 'error' && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-full bg-fg px-8 py-3 text-[13px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform hover:-translate-y-px"
            >
              {zh ? '刷新' : 'Refresh'}
            </button>
          )}
          <a
            href={`/${locale}/my-albums`}
            className="mt-6 inline-block text-[13px] text-accent underline underline-offset-2"
          >
            {zh ? '返回我的项目' : 'Back to projects'}
          </a>
        </YujeeState>
      }
      chatBody={<p className="text-[13.5px] leading-relaxed text-muted">{copy.chat}</p>}
    />
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
      // pagesState 变了 → 页签缓存作废(模板类别变化会改变内页编号)。
      foliosCache = null;
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
    // 画布格/章节栏/上下文徽标共用的跨页标题:给「人话」页位而非 Spread 序号。
    // 封面 / 封底按页面类别判定;内页用展示层真实页码(封面/目录/封尾不计),
    // 双页跨页给出页码区间(第 X–Y 页)。folio 全缺(如残留目录页)回退跨页序号。
    const spreadLabel = (i: number) => {
      const zh = currentLang === 'zh';
      const [lp, rp] = spreadPages(i);
      const present = [lp, rp].filter((p): p is EditorPage => p !== null);
      const slots = present.map(pageSlot);
      if (slots.includes('cover')) return zh ? '封面' : 'Cover';
      if (slots.includes('ending')) return zh ? '封底' : 'Back cover';
      const folios = foliosOfBook();
      const nums = present
        .map((p) => folios[pagesState.indexOf(p)])
        .filter((n): n is number => n != null);
      if (nums.length >= 2) {
        const lo = nums[0];
        const hi = nums[nums.length - 1];
        return zh ? `第 ${lo}–${hi} 页` : `Pages ${lo}–${hi}`;
      }
      if (nums.length === 1) return zh ? `第 ${nums[0]} 页` : `Page ${nums[0]}`;
      return zh ? '跨页 ' + (i + 1) : 'Spread ' + (i + 1);
    };

    // Photos live only in the browser (invariant 1). 屏显分级(性能):主画布/翻页叶
    // 用 display 派生图(~1600px),缩略图条/总览格用 thumb 派生图(~240px);原图只
    // 留给 PDF 导出。thumb 还没解出来时回退 display,绝不回退原图。
    let imageUrls: Record<string, string> = { ...initialImageUrls };
    // 服务器压缩图回退(photo-snapshot §5.3):本地原图/派生没有时,用备份过的服务器
    // 压缩图,换设备/清缓存后内页不空白。备份过才有;都没有则空槽(版面文字仍在)。
    const snapshotUrls: Record<string, string> = detail.album.photoSnapshotUrls ?? {};
    const resolveImage: ResolveImage = (id) => imageUrls[id] ?? snapshotUrls[id];

    // 展示层页签缓存:faceInner 每页都要 folio,此前每次调用都全量重算
    // (O(页数) map + indexOf → 全量 repaint 时 O(n²))。页序只在 pagesState
    // 重排时变,rebuildSpreads()/replace 处置空缓存。
    let foliosCache: (number | null)[] | null = null;
    const foliosOfBook = () => {
      if (!foliosCache) foliosCache = pageFolioNumbers(pagesState.map((p) => p.templateId));
      return foliosCache;
    };

    // Render a real album page through its web template (the same path the live
    // editor/PDF use) as static markup we can drop into the imperative book.
    // HTML 模板已迁移的（如 mag-01）走单一 HTML 渲染器；未迁的回退现有 React 组件。
    function faceInner(page: EditorPage | null, resolve: ResolveImage = resolveImage): string {
      if (!page) return '';
      // 页面真相 = 存库 html(含 AI/用户手工版面);页签按当前页序展示层计算,
      // 覆盖模板遗留 folio(封面/封尾不编号)。
      const folio = foliosOfBook()[pagesState.indexOf(page)] ?? null;
      const html = preferredPageHtml(page, resolve);
      if (html !== undefined) return applyFolioOverlay(html, folio);
      const Template = getWebTemplate(page.templateId);
      if (!Template) {
        return `<div style="padding:24px;font-size:14px">Unknown template: ${page.templateId}</div>`;
      }
      const data = adaptPageToTemplateData(
        { templateId: page.templateId, images: page.imagesJson, texts: page.textsJson },
        resolve,
      );
      return applyFolioOverlay(
        renderToStaticMarkup(<Template data={data} totalPages={total} imagePos={page.imagePosJson} />),
        folio,
      );
    }
    // The 794×1123 page scaled to fill the given box (matches FlipBook PageFace).
    function faceHTML(
      page: EditorPage | null,
      boxW: number,
      boxH: number,
      resolve: ResolveImage = resolveImage,
    ): string {
      const scale = Math.min(boxW / PAGE.width, boxH / PAGE.height) || 1;
      return (
        `<div style="width:${boxW}px;height:${boxH}px;overflow:hidden;background:#fff">` +
        `<div style="transform:scale(${scale});transform-origin:top left;width:${PAGE.width}px;height:${PAGE.height}px">` +
        faceInner(page, resolve) +
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
      // white (#fff) box. The .page-empty/.leaf-empty/.ov-solo classes strip the
      // surrounding surface/shadow/spine so the half reads as empty space.
      if (!page) { el.innerHTML = ''; return; }
      // offsetParent === null ⇔ a `display:none` ancestor hides the cell (these
      // page cells are never position:fixed). See paintDecision for why each
      // branch behaves as it does — notably 'skip' on hidden avoids a per-frame
      // rAF loop that the issue #157 fix would otherwise spin while overview-on.
      const action = paintDecision(el.offsetParent === null, el.clientWidth, el.clientHeight, attempt, 30);
      if (action === 'skip') return;
      if (action === 'defer') {
        requestAnimationFrame(() => paintEl(el, page, attempt + 1));
        return;
      }
      // 全表面统一全保真:display 派生图 + 可编辑标记 + fitTextBoxes(记忆化)。
      // (迷你缩略图条已移除,不再有 thumb 降级表面。)
      el.innerHTML = faceHTML(page, el.clientWidth, el.clientHeight, resolveImage);
      // 可编辑标记:图片槽 + 所有文字槽。已迁 HTML 的模板把文字渲染成
      // `<div data-text-key=…>`(无 .ch-* 类),旧选择器只认 .ch-mark/.ch-narrative/
      // .photo .cap → 这些模板的文字全都标不上 data-editable,导致「选不中文字/改不了
      // 字体」。这里统一以 [data-text-key] 为文字槽的权威标记(隐藏的 folio 槽是
      // display:none,点不到,无害)。旧类名保留,兼容未迁模板。
      el.querySelectorAll<HTMLElement>(
        'img[data-image-slot], [data-text-key]:not(img), .ch-mark, .ch-narrative, .photo .cap',
      ).forEach((node) => {
        node.setAttribute('data-editable', '');
      });
      markEditableTextKeys(el, page);
      fitTextBoxes(el);
    }
    // Repaint every surface that shows page content after an edit.
    function repaintBook() {
      paintSpread(currentCh);
      updateThumbUI(currentCh);
      if (bodyEl.classList.contains('overview-on')) renderOverview();
      // A repaint replaces the painted <img> nodes (#168). If an image is being
      // manually edited, re-bind the overlay to the fresh node for its slot; if
      // that slot no longer exists on the page (an AI edit swapped the photo /
      // template), tear the overlay down so it can't point at a detached node.
      reattachImgEdit();
    }
    // 脏页重绘:单页编辑(改字/换图/挪图)只重画受影响 spread 的画布格+缩略图格
    // (+总览格),不再全书 innerHTML 重建 —— 20+ 页时全量 repaint 是主卡顿源之一。
    // 前提:页数/页序没变(变了走 repaintBook)。
    function repaintPages(pageIndices: number[]) {
      const dirtySpreads = new Set<number>();
      for (const pi of pageIndices) {
        const arrayIdx = pagesState.findIndex((p) => p.pageIndex === pi);
        if (arrayIdx === -1) continue;
        const s = spreadIndexOfPage(spreads, arrayIdx);
        if (s >= 0) dirtySpreads.add(s);
      }
      if (dirtySpreads.size === 0) return;
      if (dirtySpreads.has(currentCh)) paintSpread(currentCh);
      if (bodyEl.classList.contains('overview-on')) {
        const g = byId('ovGrid');
        for (const s of dirtySpreads) {
          const [lp, rp] = spreadPages(s);
          // 画板格全保真(同 renderOverview):它是主编辑表面,不是缩略图。
          paintEl(g?.querySelector(`[data-oface="${s}-l"]`) as HTMLElement | null, lp);
          paintEl(g?.querySelector(`[data-oface="${s}-r"]`) as HTMLElement | null, rp);
        }
      }
      reattachImgEdit();
    }
    // Re-grab the live <img> for the active image-edit selection after a repaint,
    // or clear the selection if the slot is gone. Centralizes the "innerHTML was
    // replaced" concern for every repaintBook() caller (AI patch, draft act,
    // inline text edit, and the manual commit itself).
    function reattachImgEdit() {
      if (!imgEdit) return;
      // 画板格子由 renderOverview 整体 innerHTML 重建 —— 旧宿主节点会失联。
      // 按页号在画板里重找同一页,编辑态(overlay/选中)无缝续上。
      if (!imgEdit.hostEl.isConnected) {
        const fresh = byId('ovGrid')?.querySelector<HTMLElement>(
          `.ov-page[data-page-index="${imgEdit.pageIndex}"]`,
        );
        if (fresh) imgEdit.hostEl = fresh;
      }
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
      fitTextBoxes(host);
      try {
        // html2canvas-pro (not the unmaintained html2canvas@1.4.1) — the latter
        // throws on modern CSS color functions (oklch/lab/color-mix) that Tailwind
        // v4 emits, which silently broke the inspect→adjust capture.
        const html2canvas = (await import('html2canvas-pro')).default;
        const { injectDocumentFontsInto } = await import('@/lib/font/clone-document-fonts');
        const canvas = await html2canvas(host, {
          width: PAGE.width,
          height: PAGE.height,
          backgroundColor: '#ffffff',
          scale: 1,
          useCORS: true,
          logging: false,
          // 相册子集字体注入克隆文档,防止截图里文字词距错位(clone-document-fonts)。
          onclone: injectDocumentFontsInto,
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
      // 悬停气泡(视图切换等 [data-tip] 元素)的文案跟随语言切换。
      $$('[data-i18n-tip]').forEach((el) => {
        const key = el.getAttribute('data-i18n-tip')!;
        const val = t(key);
        if (val) el.setAttribute('data-tip', val);
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
      updateThumbUI(currentCh);
      paintSpread(currentCh);
    }

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
      // 画板(overview)上的同一页也要亮:画板即工作面,选中态两边同步。
      // ⚠️ 空白半页的 data-page-index="",而 Number("")===0 —— 选中封面(pageIndex 0)
      // 时会让全书所有空白半页都误亮成选中态(封面/封尾的空侧尤其明显)。必须先排除
      // 空串/缺失,再比对页码。
      byId('ovGrid')
        ?.querySelectorAll<HTMLElement>('.ov-page[data-page-index]')
        .forEach((el) => {
          const pi = el.dataset.pageIndex;
          el.classList.toggle(
            'ov-page-selected',
            pi !== undefined && pi !== '' && Number(pi) === selectedPageIndex,
          );
        });
    }
    const onPageSelect = (el: HTMLElement) => {
      const pi = el.dataset.pageIndex;
      if (pi === undefined) return;
      const idx = Number(pi);
      selectedPageIndex = selectedPageIndex === idx ? null : idx;
      // Switching/deselecting a page tears down any open image-edit overlay.
      clearImageSelection();
      updateSelectionHighlight();
      // 选中的是「页」而非具体文字/图片 → 不出工具条(用户拍板)。要编辑再点具体的文字或图片。
      hideElementToolbar();
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
      // 画布(编辑)模式下 #book 是 display:none —— 浮层若挂在 #book 上会 0×0 不可见,
      // 缩放/复位控件就永远看不到。挂到 .book-stage(#book 的父级,与 #elBar 同一 fixed 包含
      // 块,两种视图都在),position:fixed + setFixedPos 按选中图片的视口 rect 定位。
      (bookEl.parentElement ?? bookEl).appendChild(ov);
      imgEditOverlay = ov;
      imgEditSlider = slider;
      return ov;
    }
    // Float the overlay near the bottom edge of the selected image, in VIEWPORT
    // coords via setFixedPos (position:fixed, subtracting the perspective containing
    // block like #elBar). Works in canvas mode where #book is hidden and the live
    // image is an #ovGrid thumbnail — getBoundingClientRect gives the on-screen rect
    // regardless of which view is active, so no per-view zoom math is needed.
    function positionImgEditOverlay() {
      if (!imgEdit || !imgEditOverlay) return;
      const ov = imgEditOverlay;
      // #168: anchor to the SLOT FRAME (the overflow:hidden wrapper <div> around the
      // <img>), not the <img> itself — once scale>1 the img's rect is the zoomed
      // (larger, clipped-off) size, which would float the overlay off the frame.
      const frameEl = imgEdit.imgEl.parentElement ?? imgEdit.imgEl;
      const r = frameEl.getBoundingClientRect();
      const w = ov.offsetWidth, h = ov.offsetHeight;
      // Centered on the frame, anchored inside its lower edge (8px inset), then
      // clamped into the viewport (and clear of the chat rail on the left).
      let left = r.left + r.width / 2 - w / 2;
      let top = r.bottom - h - 8;
      left = Math.min(window.innerWidth - w - 8, Math.max(canvasLeftBound(), left));
      top = Math.min(window.innerHeight - h - 8, Math.max(r.top + 4, top));
      setFixedPos(ov, left, top);
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
      // 图片调整 = 拖动平移(前后左右)+ 滑块/滚轮缩放(尺寸)+ 复位,全在浮层里;
      // 不再弹 el-bar 照片工具条(换照片/黑白已按用户拍板去掉)。先收掉可能开着的文字工具条。
      hideElementToolbar();
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
      // 位置固化进 html 真相(必须在 repaint 之前 —— repaint 走 preferredPageHtml,
      // html 不更新的话这一笔拖动当场回退)。服务端 updatePage 对 draft 做同样 patch。
      syncPageHtml(page, (html) => patchHtmlImagePos(html, slotId, clamped));
      // 脏页重绘替换全书重绘;reattachImgEdit(在里面跑)re-binds overlay。
      repaintPages([pageIndex]);
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
    const surfaceClick = (hostEl: HTMLElement, e: MouseEvent) => {
      // 手动编辑只在画布(overview)模式发生。预览(书籍)模式是纯只读:点页面/图片/
      // 文字都不选中、不弹工具条。#book 与 #ovGrid 各自只在自己的模式可见,但书籍视图
      // 的 pageLeft/pageRight 也走这条链路,这里统一挡在预览态之外。
      if (!bodyEl.classList.contains('overview-on')) return;
      // A pan gesture ends with a synthetic click — swallow it so a drag doesn't
      // also toggle the image/page selection.
      if (dragMoved) {
        dragMoved = false;
        e.stopPropagation();
        return;
      }
      // 真实点选(非平移收尾)= 新的选取意图 → 复位工具条「已手动移动」,让它重新贴到新图层上方。
      editBarMoved = false;
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
    const onHostClick = (hostEl: HTMLElement) => (e: MouseEvent) => surfaceClick(hostEl, e);
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
      // (选中「页」不再弹工具条 —— 只有具体文字/图片才出;故重绘后不为页选中态补显工具条。)
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

    /* ─── Bottom nav (页面切换 ‹ n/N ›) ─── */
    // 迷你页面预览条已移除(2026-07-15):20+ 页时那是一排完整页面 DOM,纯性能
    // 负担;全书总览的职责归画布模式。这里只剩页码指示与前后翻页。
    // 空闲帧调度:画布模式的批量 paint 不挡交互帧。连发时取消上一批,只跑最新。
    const idleHandles = new Map<string, number>();
    function scheduleIdle(key: string, run: () => void) {
      const prev = idleHandles.get(key);
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (prev !== undefined) (cic ?? window.clearTimeout)(prev);
      const handle = ric ? ric(() => run(), { timeout: 300 }) : window.setTimeout(run, 0);
      idleHandles.set(key, handle);
    }
    function updateThumbUI(chIdx: number) {
      const ti = byId('thumbInd');
      if (ti) ti.textContent = (chIdx + 1) + '/' + spreadCount();
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
        sub.textContent = `${aT(`第 ${meta.num} 组`, `Group ${meta.num}`)} · ${meta.photoIds.length} ${t('photosWord')}`;
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
      // 画板是无限画布:+/− 就地缩放画布,【绝不】跳回单跨页书籍视图 ——
      // 「放大 = 换视图」正是用户点名要去掉的行为。
      if (bodyEl.classList.contains('overview-on')) {
        const ovEl = byId('bookOverview');
        const r = ovEl?.getBoundingClientRect();
        ovZoomAt(r ? r.left + r.width / 2 : 0, r ? r.top + r.height / 2 : 0, d > 0 ? 1.25 : 0.8);
        return;
      }
      // Clamp to [ZMIN, ZMAX]. Zooming out past the floor just stops at ZMIN;
      // the book stays scaled + visible and never auto-jumps to overview.
      zoom = clampZoom(zoom + d, ZMIN, ZMAX);
      applyZoom();
    }
    function resetZoom() {
      if (bodyEl.classList.contains('overview-on')) {
        ovZoom = 1; ovPanX = 0; ovPanY = 0; applyOvTransform();
        return;
      }
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
      // 懒 paint:格子进入视口才渲(20+ 页的总览一次性全渲是强制重排+解码风暴)。
      // IntersectionObserver 不可用(旧引擎/jsdom)时回退空闲帧全量渲。
      // ⚠️ 全保真模式,不是 thumb:总览网格就是主画板(无限画布,可缩放到 3x,
      // 编辑工具直接在上面用),必须和书籍视图渲染一致 —— display 派生图 +
      // fitTextBoxes(记忆化命中,近零成本)+ data-editable 标记。
      const paintOvSpread = (i: number) => {
        const [lp, rp] = spreadPages(i);
        paintEl(g.querySelector(`[data-oface="${i}-l"]`) as HTMLElement | null, lp);
        paintEl(g.querySelector(`[data-oface="${i}-r"]`) as HTMLElement | null, rp);
      };
      if (typeof IntersectionObserver === 'function') {
        const io = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            io.unobserve(entry.target);
            const i = +(entry.target.getAttribute('data-ovidx') ?? '-1');
            if (i >= 0) paintOvSpread(i);
          }
        }, { rootMargin: '200px' });
        g.querySelectorAll('.ov-spread').forEach((el) => io.observe(el));
      } else {
        scheduleIdle('overview', () => {
          for (let i = 0; i < spreadCount(); i++) paintOvSpread(i);
        });
      }
      // 点击不再「跳回书籍视图」:画板就是工作面,选中/编辑全部就地发生
      // (委托绑定在 #ovGrid 上,见下方 canvas editing 段)。双击跨页仍可进书籍
      // 视图翻页 —— 那是逃生门,不是主路径。
    }
    function enterOverview() {
      // Show the overview container *before* rendering: while .book-overview is
      // display:none its .ov-page cells measure 0×0, so paintEl would inject
      // 1×1 pages (issue #157). Flip the class, force a synchronous reflow, then
      // render against real box sizes.
      bodyEl.classList.add('overview-on');
      void byId('bookOverview')?.getBoundingClientRect();
      renderOverview();
      byId('viewCanvasBtn')?.classList.add('active');
      byId('viewBookBtn')?.classList.remove('active');
      applyOvTransform();
    }
    function exitOverview() {
      bodyEl.classList.remove('overview-on');
      // 默认进画板后 #book 一直是 display:none —— 里面的页从未按真实尺寸画过(paintEl 在
      // offsetParent===null / 0×0 时会跳过),直接切预览会是空白。现在它变可见了,先 force
      // reflow 再重画当前跨页(对称 enterOverview 的 issue #157 处理),预览才有内容。
      void byId('book')?.getBoundingClientRect();
      paintSpread(currentCh);
      // 回到预览(只读):清掉画布态下的选中页/图片编辑/浮动工具条,别把编辑残留带进预览。
      selectedPageIndex = null;
      clearImageSelection();
      hideElementToolbar();
      updateSelectionHighlight();
      byId('viewCanvasBtn')?.classList.remove('active');
      byId('viewBookBtn')?.classList.add('active');
      zoom = 1; panX = 0; panY = 0; applyZoom();
    }
    function toggleOverview() {
      bodyEl.classList.contains('overview-on') ? exitOverview() : enterOverview();
    }

    /* ─── 画板 = 无限画布(用户拍板 2026-07-15) ───────────────────────────────
       手指捏合/触控板捏合/⌘+滚轮 → 就地缩放;拖空白处 → 平移;所有编辑工具
       (选页 → 选图拖动/缩放、点文字 → 工具条/内联改字)直接在画板上用 ——
       缩放永不切换视图。书籍视图仍在:双击某跨页进去翻页,属逃生门。 */
    let ovZoom = 1;
    let ovPanX = 0;
    let ovPanY = 0;
    const OV_ZMIN = 0.2, OV_ZMAX = 3;
    const ovGridEl = byId('ovGrid');
    const ovStageEl = byId('bookOverview');
    // 手势窗口内挂 will-change(合成层跟手),停 180ms 摘掉让浏览器按最终缩放比
    // 重新光栅化 —— 否则画板放大是在放大低分辨率位图快照,永远糊(见 CSS 注释)。
    let ovGestureTimer: number | null = null;
    function markOvGesture() {
      if (!ovGridEl) return;
      ovGridEl.classList.add('ov-gesturing');
      if (ovGestureTimer) window.clearTimeout(ovGestureTimer);
      ovGestureTimer = window.setTimeout(() => {
        ovGridEl.classList.remove('ov-gesturing');
        ovGestureTimer = null;
      }, 180);
    }
    function applyOvTransform() {
      if (ovGridEl) {
        markOvGesture();
        ovGridEl.style.transformOrigin = '0 0';
        ovGridEl.style.transform = `translate(${ovPanX}px, ${ovPanY}px) scale(${ovZoom})`;
      }
      const pct = byId('zoomPct');
      if (pct && bodyEl.classList.contains('overview-on')) pct.textContent = `${Math.round(ovZoom * 100)}%`;
      positionElementToolbar();
      positionImgEditOverlay();
    }
    // 以屏幕坐标 (cx,cy) 为锚点缩放:锚点处的内容在缩放前后钉在原地。
    function ovZoomAt(cx: number, cy: number, factor: number) {
      const stageRect = ovStageEl?.getBoundingClientRect();
      if (!stageRect) return;
      const nextZoom = clampZoom(ovZoom * factor, OV_ZMIN, OV_ZMAX);
      if (nextZoom === ovZoom) return;
      const px = cx - stageRect.left;
      const py = cy - stageRect.top;
      ovPanX = px - ((px - ovPanX) / ovZoom) * nextZoom;
      ovPanY = py - ((py - ovPanY) / ovZoom) * nextZoom;
      ovZoom = nextZoom;
      applyOvTransform();
    }
    const onOvWheel = (e: WheelEvent) => {
      if (!bodyEl.classList.contains('overview-on')) return;
      e.preventDefault();
      // 画板嵌在 .book-stage 里,stage 自己也监听 ctrl+wheel(书籍视图缩放)——
      // 不拦住冒泡就是一次手势两处缩放。
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        // 触控板捏合会被浏览器合成为 ctrlKey+wheel —— 这就是「手指放大缩小」的桌面形态。
        ovZoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.08 : 1 / 1.08);
      } else {
        ovPanX -= e.deltaX;
        ovPanY -= e.deltaY;
        applyOvTransform();
      }
    };
    ovStageEl?.addEventListener('wheel', onOvWheel, { passive: false });

    // 单指(左键)拖空白 → 平移;双指(触屏)→ 捏合缩放。编辑中的图片按下不抢
    //(onImgPointerDown 先于本处理器在 #ovGrid 上运行并置 dragging)。
    const ovPointers = new Map<number, { x: number; y: number }>();
    let ovPanning = false;
    let ovPanMoved = false;
    let ovPanOrigin = { x: 0, y: 0, panX: 0, panY: 0 };
    let ovPinchStart: { dist: number; zoom: number; cx: number; cy: number } | null = null;
    const ovInteractive = (target: HTMLElement | null) =>
      !!target?.closest(
        '.el-bar, .img-edit-overlay, button, a, input, textarea, select, [contenteditable="true"]',
      );
    const onOvPointerDown = (e: PointerEvent) => {
      if (!bodyEl.classList.contains('overview-on')) return;
      if (dragging) return; // 图片拖动进行中,画布不动
      if (ovInteractive(e.target as HTMLElement | null)) return;
      ovPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ovPointers.size === 2) {
        const [a, b] = [...ovPointers.values()];
        ovPinchStart = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: ovZoom,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        };
        ovPanning = false;
      } else if (ovPointers.size === 1 && (e.pointerType !== 'mouse' || e.button === 0)) {
        ovPanning = true;
        ovPanMoved = false;
        ovPanOrigin = { x: e.clientX, y: e.clientY, panX: ovPanX, panY: ovPanY };
        // 不在 pointerdown 就抓指针 / 上 panning 态:pointer capture 会把随后的
        // click 事件重定向到 .book-overview(#ovGrid 的父级),而 panning 态的
        // `*{pointer-events:none}` 又让 mouseup/click 落到容器上 —— 两者都会让
        // #ovGrid 的 click 委托收不到,真实鼠标在画布模式「点不动」(选页/编辑失效)。
        // 改为真正拖动越过阈值时才抓指针 + 上 panning 态,见 onOvPointerMove;
        // 单纯点击永远走不到那一步,click 照常落到 .ov-page。
      }
    };
    const onOvPointerMove = (e: PointerEvent) => {
      if (!ovPointers.has(e.pointerId)) return;
      ovPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ovPinchStart && ovPointers.size === 2) {
        const [a, b] = [...ovPointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > 0 && ovPinchStart.dist > 0) {
          const target = clampZoom(ovPinchStart.zoom * (dist / ovPinchStart.dist), OV_ZMIN, OV_ZMAX);
          ovZoomAt(ovPinchStart.cx, ovPinchStart.cy, target / ovZoom);
        }
        return;
      }
      if (!ovPanning) return;
      if (!ovPanMoved && (Math.abs(e.clientX - ovPanOrigin.x) > 3 || Math.abs(e.clientY - ovPanOrigin.y) > 3)) {
        // 真的开始拖了:此刻才抓指针 + 上 panning 态(子级 pointer-events:none),
        // 保证拖出元素也能继续平移。单纯点击到不了这里,click 照常选页/编辑。
        ovPanMoved = true;
        ovStageEl?.setPointerCapture?.(e.pointerId);
        ovStageEl?.classList.add('panning');
      }
      if (!ovPanMoved) return; // 尚未越过阈值:先不平移,给 click 让路
      ovPanX = ovPanOrigin.panX + e.clientX - ovPanOrigin.x;
      ovPanY = ovPanOrigin.panY + e.clientY - ovPanOrigin.y;
      applyOvTransform();
    };
    const endOvPointer = (e: PointerEvent) => {
      ovPointers.delete(e.pointerId);
      if (ovPointers.size < 2) ovPinchStart = null;
      if (ovPanning && ovPointers.size === 0) {
        ovPanning = false;
        // 只有真拖动过才抓了指针 —— 没抓过就别 release(避免无谓抛错),panning 态同理。
        if (ovStageEl?.hasPointerCapture?.(e.pointerId)) ovStageEl.releasePointerCapture(e.pointerId);
        ovStageEl?.classList.remove('panning');
      }
    };
    ovStageEl?.addEventListener('pointerdown', onOvPointerDown);
    ovStageEl?.addEventListener('pointermove', onOvPointerMove);
    ovStageEl?.addEventListener('pointerup', endOvPointer);
    ovStageEl?.addEventListener('pointercancel', endOvPointer);

    // 编辑委托:格子内容由 innerHTML 重建,监听绑在恒存的 #ovGrid 上。
    // 点击链路与书籍视图【同一套】(surfaceClick):选页 → 点图进入图片编辑
    // (拖动 pan / 滚轮缩放,rect 比例换算天然抗画布 scale)、点文字弹工具条。
    ovGridEl?.addEventListener('click', (e) => {
      if (ovPanMoved) {
        // 平移收尾的合成 click 不当作选页。
        ovPanMoved = false;
        e.stopPropagation();
        return;
      }
      const host = (e.target as HTMLElement).closest<HTMLElement>(
        '.ov-page[data-page-index]:not(.ov-empty)',
      );
      if (host && host.dataset.pageIndex !== '') {
        surfaceClick(host, e);
        return;
      }
      // 点空白 → 全部取消选中(与书籍视图点页面外行为一致)。
      selectedPageIndex = null;
      clearImageSelection();
      hideElementToolbar();
      updateSelectionHighlight();
    });
    ovGridEl?.addEventListener('pointerdown', onImgPointerDown);
    ovGridEl?.addEventListener('pointermove', onImgPointerMove);
    ovGridEl?.addEventListener('pointerup', onImgPointerUp);
    ovGridEl?.addEventListener('wheel', onImgWheel, { passive: false });
    // 取消「双击跨页 → 跳回书籍预览」的逃生门:用户在画布(编辑)模式双击想放大/聚焦
    // 跨页,却被弹回预览,体验割裂。要回预览走底部的「预览模式」切换按钮即可,画布模式
    // 内不再因双击而切视图。
    const stage = $('.book-stage') as HTMLElement | null;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? ZSTEP : -ZSTEP); }
    };
    stage?.addEventListener('wheel', onWheel, { passive: false });

    const editBar = byId('elBar') as HTMLElement | null;
    let editBarAnchor: HTMLElement | null = null;
    let editBarMoved = false; // 用户拖动过工具条 → 停止自动贴图层(选新图层时复位)。
    // #elBar / 面板都是 position:fixed,但它们在 .book-stage(perspective:2400px)内 ——
    // perspective 会成为 fixed 的包含块,style.top/left 变成【相对该祖先】而非视口。所有定位/
    // 拖动算的都是视口坐标(getBoundingClientRect),写 style 前必须减去包含块偏移才落到对的位置。
    function fixedContainerOffset(el: HTMLElement): { left: number; top: number } {
      let p = el.parentElement;
      while (p) {
        const s = getComputedStyle(p);
        if (s.transform !== 'none' || s.perspective !== 'none' || s.filter !== 'none' || (s.willChange || '').includes('transform')) {
          const r = p.getBoundingClientRect();
          return { left: r.left, top: r.top };
        }
        p = p.parentElement;
      }
      return { left: 0, top: 0 };
    }
    function setFixedPos(el: HTMLElement, left: number, top: number) {
      const off = fixedContainerOffset(el);
      el.style.left = `${left - off.left}px`;
      el.style.top = `${top - off.top}px`;
    }
    function setEditBarGroup(group: 'text' | 'photo') {
      editBar?.querySelectorAll<HTMLElement>('[data-group]').forEach((el) => {
        el.style.display = el.dataset.group === group ? 'flex' : 'none';
      });
    }
    // 工具条/弹层的左安全边界:对话栏(.pane-chat-col)展开时占着画布左侧,居中贴到左侧
    // 文字(如封面标题)会把工具条最左的颜色/字体控件塞到对话栏下面看不见。以对话栏右缘 +8
    // 作为左边界(折叠或不存在时退回视口 10px),保证整条工具条始终露在画布可视区里。
    function canvasLeftBound(): number {
      if (bodyEl.classList.contains('chat-collapsed')) return 10;
      const chat = bodyEl.querySelector('.pane-chat-col') as HTMLElement | null;
      if (!chat) return 10;
      const r = chat.getBoundingClientRect();
      return r.width > 0 && r.right > 0 ? r.right + 8 : 10;
    }
    function positionElementToolbar() {
      if (!editBar || !editBar.classList.contains('show') || !editBarAnchor) return;
      if (editBarMoved) return; // 用户已手动挪过 → 尊重其位置,不自动贴。
      const rect = editBarAnchor.getBoundingClientRect();
      // 工具条【始终贴在被编辑图层的正上方】:top = 图层顶 − 工具条高 − 6(≈5pt),把图层露出来。
      // 不再往下方翻(往下会盖住图层下面的内容);顶到 62px 安全线才夹住,是极端靠顶的兜底。
      const top = Math.max(62, rect.top - editBar.offsetHeight - 6);
      const minLeft = canvasLeftBound();
      const left = Math.min(
        window.innerWidth - editBar.offsetWidth - 10,
        Math.max(minLeft, rect.left + rect.width / 2 - editBar.offsetWidth / 2),
      );
      setFixedPos(editBar, left, top);
    }
    function showElementToolbar(anchor: HTMLElement, group: 'text' | 'photo') {
      if (!editBar) return;
      editBarAnchor = anchor;
      setEditBarGroup(group);
      editBar.classList.add('show');
      // 颜色圆点跟随选中文字的当前颜色。
      if (group === 'text') {
        const t = selectedTextTargets()[0];
        if (t) { setColorFromCss(getComputedStyle(t).color); updateColorDot(); }
      }
      requestAnimationFrame(positionElementToolbar);
    }
    function hideElementToolbar() {
      editBarAnchor = null;
      editBarMoved = false;
      editBar?.classList.remove('show');
      closeEbPanels();
    }
    function selectedTextTargets(): HTMLElement[] {
      if (!editBarAnchor || imgEdit) return [];
      // 只改被选中的那一个文字节点,绝不波及整页其它文字(用户拍板:单独编辑不联动)。
      // 锚点不是具体文字(如选中的是「页」)→ 无目标,样式工具对它不生效。
      return editBarAnchor.matches('[data-editable]:not(img)') ? [editBarAnchor] : [];
    }
    function pageForEditableText(textEl: HTMLElement): EditorPage | null {
      const host = textEl.closest<HTMLElement>('.page, .leaf, .ov-page, .thumb-img-left, .thumb-img-right');
      const pageIndex = host?.dataset.pageIndex;
      if (pageIndex === undefined) return null;
      return pageByIndex(Number(pageIndex)) ?? null;
    }
    function updateEditSizeLabel(targets = selectedTextTargets()) {
      const input = byId('ebSizeInput') as HTMLInputElement | null;
      if (!input) return;
      const first = targets[0];
      // 编辑中避免打断用户输入:输入框聚焦时不回填。
      if (document.activeElement === input) return;
      input.value = first ? `${Math.round(parseFloat(getComputedStyle(first).fontSize) || 14)}` : '';
    }
    function flashEditFeedback(text: string) {
      const label = byId('ebSize');
      if (!label) return;
      const prev = label.textContent ?? '--';
      label.textContent = text;
      window.setTimeout(() => { if (label.isConnected) label.textContent = prev; }, 900);
    }
    function persistPagePatch(
      page: EditorPage,
      textStyles?: Record<string, Record<string, string | null>>,
    ) {
      void fetch(`/api/v1/albums/${albumId}/pages/${page.pageIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagesJson: page.imagesJson,
          textsJson: page.textsJson,
          imagePosJson: page.imagePosJson ?? {},
          ...(textStyles ? { textStyles } : {}),
        }),
      }).catch(() => {});
    }
    // 手工编辑固化进本地 htmlJson(与服务端 updatePage 同一套 patcher)。
    // C 方案:页面真相 = html —— 只写 textsJson 的话,下一次重绘 preferredPageHtml
    // 又渲染旧 html,编辑当场回退。patch 失败(锚点缺失等)则丢弃 htmlJson,
    // 让渲染回退到「模板 + 数据」现场重烘,宁可丢版面微调也不显示旧内容。
    function syncPageHtml(page: EditorPage, apply: (html: string) => string | null) {
      if (typeof page.htmlJson !== 'string' || page.htmlJson.length === 0) return;
      page.htmlJson = apply(page.htmlJson) ?? undefined;
    }
    function editSelectedText() {
      const textEl = selectedTextTargets()[0];
      if (!textEl) return;
      const textKey = textEl.dataset.textKey;
      const page = pageForEditableText(textEl);
      textEl.setAttribute('contenteditable', 'true');
      textEl.style.cursor = 'text';
      // preventScroll:.book-stage 是 overflow:auto,默认 focus 会把这段文字滚进视口 ——
      // 在画布模式里它会被滚到「固定定位的浮动工具条」下面,于是用户想点文字改内容时
      // 点到的其实是工具条按钮 → 触发 blur 收尾 → 编辑当场退出(表现为「编辑文案不可用」)。
      // 不滚动 + 随后把工具条重新贴到文字上方,文字就一直露在外面可点可改。
      textEl.focus({ preventScroll: true });
      requestAnimationFrame(positionElementToolbar);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textEl);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const finish = () => {
        textEl.removeAttribute('contenteditable');
        textEl.style.cursor = '';
        if (!textKey || !page) return;
        const nextText = textEl.textContent ?? '';
        page.textsJson = { ...page.textsJson, [textKey]: nextText };
        syncPageHtml(page, (html) => patchHtmlText(html, textKey, nextText));
        ensureCurrentFonts();
        persistPagePatch(page);
        repaintPages([page.pageIndex]);
      };
      textEl.addEventListener('blur', finish, { once: true });
    }
    // 选中文字统一改样式:每个目标先改画出来的 DOM(即时反馈),再把同样的 CSS 写回
    // html 真相并落库(patchHtmlTextStyle);var(--…) 不能进 html(导出/AI 渲染环境没有
    // 编辑器变量),字体一律用具体字体栈。styleForEl 返回该元素要写的 CSS(null=跳过)。
    function applyTextStyle(styleForEl: (el: HTMLElement) => Record<string, string | null> | null) {
      const targets = selectedTextTargets();
      if (targets.length === 0) return;
      const styledPages = new Map<EditorPage, Record<string, Record<string, string | null>>>();
      for (const el of targets) {
        const props = styleForEl(el);
        const textKey = el.dataset.textKey;
        const page = pageForEditableText(el);
        if (!props || !textKey || !page) continue;
        syncPageHtml(page, (html) => patchHtmlTextStyle(html, textKey, props));
        const perPage = styledPages.get(page) ?? {};
        perPage[textKey] = { ...(perPage[textKey] ?? {}), ...props };
        styledPages.set(page, perPage);
      }
      for (const [page, textStyles] of styledPages) persistPagePatch(page, textStyles);
      updateEditSizeLabel(targets);
      positionElementToolbar();
    }
    // 加粗 / 斜体 / 对齐(开关或设定型)。
    function applyTextToolbarAction(action: string) {
      applyTextStyle((el): Record<string, string | null> | null => {
        if (action === 'bold') {
          const on = getComputedStyle(el).fontWeight !== '700';
          el.style.fontWeight = on ? '700' : '';
          return { 'font-weight': on ? '700' : null };
        }
        if (action === 'italic') {
          const on = getComputedStyle(el).fontStyle !== 'italic';
          el.style.fontStyle = on ? 'italic' : '';
          return { 'font-style': on ? 'italic' : null };
        }
        if (action.startsWith('align-')) {
          const value = action.replace('align-', '');
          el.style.textAlign = value;
          return { 'text-align': value };
        }
        return null;
      });
    }
    function applyColorToSelection(hex: string) {
      applyTextStyle((el) => { el.style.color = hex; return { color: hex }; });
    }
    function applyFontSizeToSelection(px: number) {
      const size = Math.min(200, Math.max(6, Math.round(px)));
      applyTextStyle((el) => { el.style.fontSize = `${size}px`; return { 'font-size': `${size}px` }; });
    }
    // 字体:套用项目字体栈 + 更新触发按钮名;中文艺术字按选中正文的实际字符按需子集化后重绘。
    function applyFontToSelection(font: EditorFont) {
      const targets = selectedTextTargets();
      applyTextStyle((el) => { el.style.fontFamily = font.stack; return { 'font-family': font.stack }; });
      const nameEl = byId('ebFontName');
      if (nameEl) nameEl.textContent = font.name;
      if (font.cjkId) {
        const charset = targets.map((el) => el.textContent ?? '').join('');
        void loadFontSubset({ fontIds: [font.cjkId], charset }).then(() => {
          // 字体加载完成后,浏览器会自动把已设 font-family 的活节点换成真字形 —— 不能
          // repaintPages:它会用模板数据重烘整格、把刚设的字体丢掉(终稿页无 htmlJson 尤其),
          // 还会把 editBarAnchor 指向的文字节点换成新节点 → 之后点「编辑文案」落到已脱离
          // DOM 的旧节点、看起来「打不开」。改为只对受影响格重跑 fitTextBoxes(不换节点,
          // 按新字体度量重排字号)。
          const hosts = new Set<HTMLElement>();
          for (const el of targets) {
            const host = el.closest<HTMLElement>('.ov-page, .page, .leaf');
            if (host) hosts.add(host);
          }
          hosts.forEach((h) => fitTextBoxes(h));
        }).catch(() => {});
      }
    }
    // ── 字体面板(带搜索,列全部项目字体,自身字体预览)+ 字号预设面板 ──
    const SIZE_PRESETS = [12, 14, 16, 18, 24, 32, 40, 48, 64, 80, 96, 120];
    function closeEbPanels() {
      byId('ebFontPanel')?.classList.remove('open');
      byId('ebSizePanel')?.classList.remove('open');
      byId('ebColorPanel')?.classList.remove('open');
      byId('ebFontTrigger')?.classList.remove('active');
    }
    // 面板定位(position:fixed),须在 .open(可测量尺寸)后调用,最后一律夹进视口不裁切:
    // - 取色气泡:放在工具条【右侧】(右边放不下就放左侧),不遮下方图层;
    // - 字体/字号:贴触发器、往上弹(工具条本就在图层上方,面板再往上不遮图层)。
    function positionEbPanel(panel: HTMLElement) {
      if (!editBar) return;
      const bar = editBar.getBoundingClientRect();
      const pw = panel.offsetWidth, ph = panel.offsetHeight;
      const M = 10;
      if (panel.id === 'ebColorPanel') {
        let left = bar.right + M;
        if (left + pw > window.innerWidth - M) left = bar.left - pw - M; // 右边放不下 → 左侧
        left = Math.max(M, Math.min(left, window.innerWidth - pw - M));
        const top = Math.max(62, Math.min(bar.top, window.innerHeight - ph - M));
        setFixedPos(panel, left, top);
        return;
      }
      const ctrl = panel.closest<HTMLElement>('.eb-ctrl');
      const anchorLeft = (ctrl ?? editBar).getBoundingClientRect().left;
      const left = Math.max(M, Math.min(anchorLeft, window.innerWidth - pw - M));
      let top = bar.top - M - ph;
      if (top < 62) top = bar.bottom + M;
      top = Math.max(62, Math.min(top, window.innerHeight - ph - M));
      setFixedPos(panel, left, top);
    }
    // 通用拖动:按住 handle 拖动 moveEl(position:fixed),夹进视口。onMove 用于置「已手动移动」标志。
    function startDrag(moveEl: HTMLElement, handle: HTMLElement, e: PointerEvent, onMove?: () => void) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const r = moveEl.getBoundingClientRect();
      const ox = r.left, oy = r.top, sx = e.clientX, sy = e.clientY;
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        onMove?.();
        const nx = Math.max(6, Math.min(ox + ev.clientX - sx, window.innerWidth - moveEl.offsetWidth - 6));
        const ny = Math.max(56, Math.min(oy + ev.clientY - sy, window.innerHeight - moveEl.offsetHeight - 6));
        setFixedPos(moveEl, nx, ny);
      };
      const up = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    }
    function buildFontPanel() {
      const panel = byId('ebFontPanel');
      if (!panel || panel.dataset.built) return;
      panel.dataset.built = '1';
      const zh = currentLang === 'zh';
      const esc = (s: string) => s.replace(/"/g, '&quot;');
      const item = (f: EditorFont) =>
        `<button type="button" class="eb-font-item" data-font-id="${f.id}" data-name="${esc(f.name.toLowerCase())}" style="font-family:${esc(f.stack)}">${f.name}</button>`;
      const group = (label: string, list: EditorFont[]) =>
        list.length ? `<div class="eb-panel-group">${label}</div>${list.map(item).join('')}` : '';
      panel.innerHTML =
        `<div class="eb-panel-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>` +
        `<input class="eb-font-search" type="text" placeholder="${zh ? '搜索字体' : 'Search fonts'}" /></div>` +
        `<div class="eb-panel-list">` +
        group(zh ? '中文' : 'Chinese', EDITOR_FONTS.filter((f) => f.script === 'cjk')) +
        group(zh ? '英文' : 'Latin', EDITOR_FONTS.filter((f) => f.script === 'latin')) +
        `</div>`;
    }
    function filterFontItems(q: string) {
      const panel = byId('ebFontPanel');
      if (!panel) return;
      const query = q.trim().toLowerCase();
      panel.querySelectorAll<HTMLElement>('.eb-font-item').forEach((el) => {
        el.style.display = !query || (el.dataset.name ?? '').includes(query) ? '' : 'none';
      });
      panel.querySelectorAll<HTMLElement>('.eb-panel-group').forEach((g) => {
        let sib = g.nextElementSibling as HTMLElement | null;
        let any = false;
        while (sib && sib.classList.contains('eb-font-item')) {
          if (sib.style.display !== 'none') any = true;
          sib = sib.nextElementSibling as HTMLElement | null;
        }
        g.style.display = any ? '' : 'none';
      });
    }
    function toggleFontPanel() {
      const panel = byId('ebFontPanel');
      if (!panel) return;
      const willOpen = !panel.classList.contains('open');
      closeEbPanels();
      if (!willOpen) return;
      buildFontPanel();
      panel.classList.add('open');
      positionEbPanel(panel);
      byId('ebFontTrigger')?.classList.add('active');
      // 中文艺术字预览:把所有中文项名字 + 样例串子集化,面板里就能显示真字形。
      // /api/v1/fonts/subset 单次最多 3 个 fontId(schema max 3),必须分批,否则整批 400。
      const cjkIds = EDITOR_FONTS.map((f) => f.cjkId).filter((v): v is CjkFontId => !!v);
      const charset = CJK_PREVIEW_SAMPLE + EDITOR_FONTS.filter((f) => f.script === 'cjk').map((f) => f.name).join('');
      for (let i = 0; i < cjkIds.length; i += 3) {
        void loadFontSubset({ fontIds: cjkIds.slice(i, i + 3), charset }).catch(() => {});
      }
      panel.querySelector<HTMLInputElement>('.eb-font-search')?.focus({ preventScroll: true });
    }
    function buildSizePanel() {
      const panel = byId('ebSizePanel');
      if (!panel || panel.dataset.built) return;
      panel.dataset.built = '1';
      panel.innerHTML =
        `<div class="eb-panel-list">${SIZE_PRESETS.map((s) => `<button type="button" class="eb-size-item" data-size="${s}">${s}</button>`).join('')}</div>`;
    }
    function toggleSizePanel() {
      const panel = byId('ebSizePanel');
      if (!panel) return;
      const willOpen = !panel.classList.contains('open');
      closeEbPanels();
      if (!willOpen) return;
      buildSizePanel();
      panel.classList.add('open');
      positionEbPanel(panel);
    }

    // ── 自定义取色器(「填充」弹层):HSV 方块 + 色相/透明度条 + 预设 + hex/不透明度 ──
    const ebColor = { h: 0, s: 0, v: 0, a: 1 };
    const ebColorRgb = () => hsvToRgb(ebColor.h, ebColor.s, ebColor.v);
    function ebColorCss() {
      const { r, g, b } = ebColorRgb();
      return ebColor.a >= 1 ? rgbToHex(r, g, b) : `rgba(${r}, ${g}, ${b}, ${Math.round(ebColor.a * 100) / 100})`;
    }
    function updateColorDot() {
      const dot = byId('ebColorDot');
      if (dot) dot.style.background = ebColorCss();
    }
    function setColorFromCss(css: string) {
      const rgb = hexToRgb(css);
      if (rgb) { ebColor.a = 1; Object.assign(ebColor, rgbToHsv(rgb.r, rgb.g, rgb.b)); return; }
      const m = /rgba?\(([^)]+)\)/.exec(css);
      if (m) {
        const parts = m[1]!.split(',').map((s) => parseFloat(s));
        Object.assign(ebColor, rgbToHsv(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0));
        ebColor.a = parts[3] === undefined ? 1 : clamp01(parts[3]);
      }
    }
    function renderColorPanel() {
      const p = byId('ebColorPanel');
      if (!p) return;
      const hue = hsvToRgb(ebColor.h, 1, 1);
      const { r, g, b } = ebColorRgb();
      const set = (sel: string, fn: (el: HTMLElement) => void) => { const el = p.querySelector<HTMLElement>(sel); if (el) fn(el); };
      set('[data-sv-bg]', (el) => { el.style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgb(${hue.r},${hue.g},${hue.b}))`; });
      set('[data-sv-cursor]', (el) => { el.style.left = `${ebColor.s * 100}%`; el.style.top = `${(1 - ebColor.v) * 100}%`; });
      set('[data-hue-thumb]', (el) => { el.style.left = `${(ebColor.h / 360) * 100}%`; });
      set('[data-alpha-bg]', (el) => { el.style.background = `linear-gradient(to right, rgba(${r},${g},${b},0), rgb(${r},${g},${b}))`; });
      set('[data-alpha-thumb]', (el) => { el.style.left = `${ebColor.a * 100}%`; });
      const hex = p.querySelector<HTMLInputElement>('[data-hex]');
      if (hex && document.activeElement !== hex) hex.value = rgbToHex(r, g, b).slice(1).toUpperCase();
      const ai = p.querySelector<HTMLInputElement>('[data-alpha-input]');
      if (ai && document.activeElement !== ai) ai.value = String(Math.round(ebColor.a * 100));
      p.querySelectorAll<HTMLElement>('[data-swatch]').forEach((el) => {
        el.classList.toggle('active', (el.dataset.swatch ?? '').toLowerCase() === rgbToHex(r, g, b).toLowerCase());
      });
      updateColorDot();
    }
    function emitColor() { applyColorToSelection(ebColorCss()); updateColorDot(); }
    function buildColorPanel() {
      const p = byId('ebColorPanel');
      if (!p || p.dataset.built) return;
      p.dataset.built = '1';
      const zh = currentLang === 'zh';
      p.innerHTML =
        `<div class="eb-color-head"><span>${zh ? '填充' : 'Fill'}</span><button type="button" class="eb-color-close" data-color-close aria-label="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>` +
        `<div class="eb-sv" data-sv><div class="eb-sv-bg" data-sv-bg></div><div class="eb-sv-cursor" data-sv-cursor></div></div>` +
        `<div class="eb-track eb-hue" data-hue><div class="eb-track-thumb" data-hue-thumb></div></div>` +
        `<div class="eb-track eb-alpha" data-alpha><div class="eb-alpha-bg" data-alpha-bg></div><div class="eb-track-thumb" data-alpha-thumb></div></div>` +
        `<div class="eb-swatch-row">${COLOR_SWATCHES.map((c) => `<button type="button" class="eb-color-swatch" data-swatch="${c}" style="background:${c}"></button>`).join('')}</div>` +
        `<div class="eb-color-fields"><span class="eb-hex-field"><b>#</b><input class="eb-hex-input" data-hex maxlength="6" spellcheck="false" /></span><span class="eb-alpha-field"><input class="eb-alpha-input" data-alpha-input inputmode="numeric" /><b>%</b></span></div>`;
      // 顶部「填充」标题条 = 拖动手柄,整个气泡可挪。
      const head = p.querySelector<HTMLElement>('.eb-color-head');
      if (head) head.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('[data-color-close]')) return;
        startDrag(p, head, e as PointerEvent);
      });
      const dragTrack = (track: HTMLElement | null, onRatioXY: (e: PointerEvent, r: DOMRect) => void) => {
        if (!track) return;
        const move = (e: PointerEvent) => { onRatioXY(e, track.getBoundingClientRect()); renderColorPanel(); emitColor(); };
        track.addEventListener('pointerdown', (e) => { e.preventDefault(); track.setPointerCapture(e.pointerId); move(e); });
        track.addEventListener('pointermove', (e) => { if (track.hasPointerCapture(e.pointerId)) move(e); });
        track.addEventListener('pointerup', (e) => { if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId); });
      };
      dragTrack(p.querySelector('[data-sv]'), (e, r) => {
        ebColor.s = clamp01((e.clientX - r.left) / r.width);
        ebColor.v = clamp01(1 - (e.clientY - r.top) / r.height);
      });
      dragTrack(p.querySelector('[data-hue]'), (e, r) => { ebColor.h = clamp01((e.clientX - r.left) / r.width) * 360; });
      dragTrack(p.querySelector('[data-alpha]'), (e, r) => { ebColor.a = clamp01((e.clientX - r.left) / r.width); });
      p.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-color-close]')) { closeEbPanels(); return; }
        const sw = t.closest<HTMLElement>('[data-swatch]');
        if (sw?.dataset.swatch) { setColorFromCss(sw.dataset.swatch); renderColorPanel(); emitColor(); }
      });
      p.addEventListener('input', (e) => {
        const t = e.target as HTMLElement;
        if (t.matches('[data-hex]')) {
          const rgb = hexToRgb((t as HTMLInputElement).value);
          if (rgb) { const a = ebColor.a; Object.assign(ebColor, rgbToHsv(rgb.r, rgb.g, rgb.b)); ebColor.a = a; renderColorPanel(); emitColor(); }
        } else if (t.matches('[data-alpha-input]')) {
          const v = parseFloat((t as HTMLInputElement).value);
          if (!Number.isNaN(v)) { ebColor.a = clamp01(v / 100); renderColorPanel(); emitColor(); }
        }
      });
    }
    function toggleColorPanel() {
      const p = byId('ebColorPanel');
      if (!p) return;
      const willOpen = !p.classList.contains('open');
      closeEbPanels();
      if (!willOpen) return;
      buildColorPanel();
      const first = selectedTextTargets()[0];
      if (first) setColorFromCss(getComputedStyle(first).color);
      renderColorPanel();
      p.classList.add('open');
      positionEbPanel(p);
    }

    const onEditBarPointerDown = (e: Event) => {
      e.stopPropagation();
      if (!editBar) return;
      const target = e.target as HTMLElement;
      // 交互控件不触发拖动;在空白/分隔线上按下 → 拖动整个工具条(position:fixed)。
      if (target.closest('button, input, select, textarea, .eb-panel, [contenteditable="true"]')) return;
      startDrag(editBar, editBar, e as PointerEvent, () => { editBarMoved = true; closeEbPanels(); });
    };
    const onEditBarClick = (e: Event) => {
      const target = e.target as HTMLElement;
      // 输入类控件(取色/字号输入/搜索)保留原生行为:不 preventDefault,否则打不开取色器/聚焦不了。
      if (!target.closest('input')) e.preventDefault();
      e.stopPropagation();
      // 字体项 → 套用
      const fontItem = target.closest<HTMLElement>('.eb-font-item[data-font-id]');
      if (fontItem) {
        const f = EDITOR_FONTS.find((x) => x.id === fontItem.dataset.fontId);
        if (f) applyFontToSelection(f);
        closeEbPanels();
        return;
      }
      // 字号预设 → 套用
      const sizeItem = target.closest<HTMLElement>('.eb-size-item[data-size]');
      if (sizeItem) {
        const px = Number(sizeItem.dataset.size);
        if (px) {
          applyFontSizeToSelection(px);
          const inp = byId('ebSizeInput') as HTMLInputElement | null;
          if (inp) inp.value = String(px);
        }
        closeEbPanels();
        return;
      }
      if (target.closest('.eb-panel-search')) return; // 点搜索框:保持面板开
      const action = target.closest<HTMLElement>('[data-edit-action]')?.dataset.editAction;
      if (!action) return;
      if (action === 'font-open') { toggleFontPanel(); return; }
      if (action === 'font-size-open') { toggleSizePanel(); return; }
      if (action === 'color-open') { toggleColorPanel(); return; }
      if (action === 'font-size-input') return; // 交给 input/change
      closeEbPanels(); // 其它按钮点击 → 收起面板
      if (action === 'edit-text') {
        editSelectedText();
      } else {
        applyTextToolbarAction(action); // bold / italic / align-*
      }
    };
    const onEditBarInput = (e: Event) => {
      const target = e.target as HTMLElement;
      // 取色器内部的 hex/透明度输入由色板自己的监听处理(见 buildColorPanel);这里只管字体搜索。
      if (target.classList.contains('eb-font-search')) { filterFontItems((target as HTMLInputElement).value); return; }
    };
    const onEditBarChange = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.id === 'ebSizeInput') {
        const px = parseFloat((target as HTMLInputElement).value);
        if (px > 0) applyFontSizeToSelection(px);
      }
    };
    const onEditBarKeydown = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.id === 'ebSizeInput' && (e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        const px = parseFloat((target as HTMLInputElement).value);
        if (px > 0) applyFontSizeToSelection(px);
        (target as HTMLInputElement).blur();
      }
    };
    editBar?.addEventListener('pointerdown', onEditBarPointerDown);
    editBar?.addEventListener('click', onEditBarClick);
    editBar?.addEventListener('input', onEditBarInput);
    editBar?.addEventListener('change', onEditBarChange);
    editBar?.addEventListener('keydown', onEditBarKeydown);
    // 响应式整体缩放:.book 尺寸是纯 CSS(min(94%, 80vh*1.414, 1010px) + aspect-ratio),
    // 随视口/容器缩放;但页内容的 scale 是 paintEl/faceHTML 在 paint 那一刻按 clientWidth
    // 算死写进 innerHTML 的,不重绘就不跟随 —— 手机/平板整体缩放时内容溢出/不缩。
    // 视口 resize + book-stage 容器尺寸变(聊天面板 resize/折叠改 --canvas-inset → book 缩)
    // 都 debounced 重绘当前 spread(按新 clientWidth 重算 scale);总览态重绘总览。
    let resizeRepaintTimer: number | null = null;
    const debouncedRepaint = () => {
      if (resizeRepaintTimer !== null) clearTimeout(resizeRepaintTimer);
      resizeRepaintTimer = window.setTimeout(() => {
        resizeRepaintTimer = null;
        if (isCollectMode) return; // 收集态是 CSS 自适应照片网格,无需重绘
        if (bodyEl.classList.contains('overview-on')) renderOverview();
        else paintSpread(currentCh);
      }, 120);
    };
    const onWindowResize = () => { positionElementToolbar(); debouncedRepaint(); };
    window.addEventListener('resize', onWindowResize);
    // ResizeObserver 比 window resize 更全:容器宽度变化(聊天面板 resize/折叠导致的
    // --canvas-inset 变、断点切换)不改视口、window resize 抓不到,但会缩 book。transform
    // 的 zoom 是视觉缩放、不改 layout 尺寸,故 zoom/pan 不会误触发重绘。
    const stageRO = stage ? new ResizeObserver(debouncedRepaint) : null;
    if (stage) stageRO?.observe(stage);

    let canvasDragging = false;
    let canvasStartX = 0;
    let canvasStartY = 0;
    let canvasOriginX = 0;
    let canvasOriginY = 0;
    const shouldSkipCanvasPan = (target: HTMLElement | null) =>
      !target ||
      !!target.closest('.el-bar, .img-edit-overlay, .ctrl-dock, .zoom-ctrl, .book-overview, .chapter-card, .mobile-chapter-bar, button, a, input, textarea, select, [contenteditable="true"]');
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
      const prevSpreadCount = spreadCount();
      pagesState = applyPatchToPages(pagesState, patch);
      ensureCurrentFonts();
      rebuildSpreads();
      // spread 结构没变 → 只重绘补丁涉及的页;变了(slot-flip 改模板类别)→ 全量。
      if (spreadCount() === prevSpreadCount) {
        repaintPages(patch.map((entry) => entry.pageIndex));
      } else {
        repaintBook();
      }
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
    // boxW/boxH 可选:设计选择卡的封面+封底并排小预览用更小的盒(默认保持 132×176)。
    function coverOptionHTML(templateId: string, photoId: string | null, boxW = 132, boxH = 176): string {
      const page: EditorPage = {
        pageIndex: 0,
        templateId,
        imagesJson: photoId ? { [heroSlotId(templateId)]: photoId } : {},
        textsJson: {},
      };
      return faceHTML(page, boxW, boxH);
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
          repaintPages([r.pageWrite.pageIndex]);
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
          repaintPages([w.pageIndex]);
          return { imagePos: { x: w.x, y: w.y, scale: w.scale } };
        }
      }
      return {};
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
        htmlJson: p.htmlJson,
      }));
      ensureCurrentFonts();
      rebuildSpreads();
      repaintBook();
      return true;
    }

    // Export: render the PDF in the browser (raster screenshot), download it
    // locally, and upload straight to R2 (bytes never touch the Web tier — invariant 4).
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
          html: p.htmlJson,
        }));
        const ids = collectPhotoIds(adaptable);
        // C 方案:PDF 导出 = 栅格截屏幕渲染(存库 html 优先,与画布像素级一致)。
        // 矢量导出路径已退役(消费不了自由 HTML)。喂高分辨率原图,防放大糊。
        const dataUrls = await photoStore.getPdfDataUrls(ids, RASTER_PDF_IMAGE_MAX_EDGE);
        const { renderAlbumPdfRaster } = await import('@/lib/pdf/render-raster');
        return await renderAlbumPdfRaster(adaptable, (id) => dataUrls[id], { scale: 3 });
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
    /* ─── 手动照片备份(photo-snapshot-design.md §5.1)───
       用户点顶栏「保存」→ 把书里用到、本地有、尚未备份的照片的 display 档压缩图直传 R2。
       原图仍不上传。备份状态直接显示在「保存」按钮上:备份中 → 绿点「已备份」/ 红点
       「备份失败」,短暂展示后按钮回到默认(只图标)。点色由 CSS 按 data-backup-state 出。 */
    const backedUpIds = new Set(Object.keys(snapshotUrls));
    type BackupState = 'idle' | 'backing-up' | 'backed-up' | 'failed';
    let saveRevertTimer: ReturnType<typeof setTimeout> | null = null;
    function setSaveState(state: BackupState) {
      const btn = $('[data-action="backupPhotos"]') as HTMLElement | null;
      if (!btn) return;
      if (saveRevertTimer) {
        clearTimeout(saveRevertTimer);
        saveRevertTimer = null;
      }
      btn.dataset.backupState = state;
      const label = btn.querySelector('[data-backup-label]');
      const text: Record<BackupState, string> = {
        idle: '',
        'backing-up': aT('备份中…', 'Backing up…'),
        'backed-up': aT('已备份', 'Backed up'),
        failed: aT('备份失败', 'Backup failed'),
      };
      if (label) label.textContent = text[state];
      // 成功/失败在按钮上短暂展示后,回到默认(只图标)。
      if (state === 'backed-up' || state === 'failed') {
        saveRevertTimer = setTimeout(() => setSaveState('idle'), state === 'failed' ? 2600 : 2000);
      }
    }
    let backingUp = false;
    async function backupPhotos() {
      if (backingUp) return;
      const todo = bookPhotoIds().filter((id) => !backedUpIds.has(id));
      if (todo.length === 0) return setSaveState('backed-up');
      backingUp = true;
      setSaveState('backing-up');
      try {
        // 只备份本地有的:getTierBlob 为空 = 原图不在本机,跳过(那些只能在有原图的设备上备份)。
        const pairs: { photoId: string; blob: Blob }[] = [];
        for (const id of todo) {
          const blob = await photoStore.getTierBlob(id, 'display').catch(() => undefined);
          if (blob) pairs.push({ photoId: id, blob });
        }
        // 一张本地都没有(比如换了设备)→ 没法备份,当失败提示。
        if (pairs.length === 0) return setSaveState('failed');
        const signed = await signPhotoSnapshotUpload(albumId, pairs.map((p) => p.photoId));
        const urlById = new Map(signed.map((s) => [s.photoId, s.putUrl]));
        const uploaded: string[] = [];
        const queue = [...pairs];
        // 限并发 4 直传;单张失败不阻断其余,confirm 只登记成功的(不谎报全备份)。
        const worker = async () => {
          for (;;) {
            const item = queue.shift();
            if (!item) return;
            const putUrl = urlById.get(item.photoId);
            if (!putUrl) continue;
            try {
              await putSnapshotBlob(putUrl, item.blob);
              uploaded.push(item.photoId);
            } catch {
              /* skip; reported as failed below if none succeed */
            }
          }
        };
        await Promise.all(Array.from({ length: 4 }, worker));
        if (uploaded.length === 0) return setSaveState('failed');
        await confirmPhotoSnapshot(albumId, uploaded);
        uploaded.forEach((id) => backedUpIds.add(id));
        const remaining = bookPhotoIds().filter((id) => !backedUpIds.has(id));
        setSaveState(remaining.length === 0 ? 'backed-up' : 'failed');
      } catch {
        setSaveState('failed');
      } finally {
        backingUp = false;
      }
    }

    /* ─── 只读姿态(photo-snapshot §5.4)───
       本书任一用到照片的原图不在本机 → 出不了高清 PDF。把顶栏「导出」改成「下载 PDF」
       (下之前已导出的那份 pdfUrl);连 PDF 都没有则禁用并提示。异步探测,不阻塞挂载。 */
    void (async () => {
      const ids = bookPhotoIds();
      if (ids.length === 0) return;
      let anyMissing = false;
      for (const id of ids) {
        const blob = await photoStore.getBlob(id).catch(() => undefined);
        if (!blob) { anyMissing = true; break; }
      }
      if (!anyMissing) return;
      const exportBtn = $('[data-action="exportPdf"]') as HTMLButtonElement | null;
      if (!exportBtn) return;
      const labelEl = exportBtn.querySelector('[data-i18n="exportPdf"]') as HTMLElement | null;
      const pdfUrl = detail.album.pdfUrl;
      if (pdfUrl) {
        if (labelEl) labelEl.textContent = aT('下载 PDF', 'Download PDF');
        exportBtn.disabled = false;
        exportBtn.removeAttribute('aria-disabled');
        exportBtn.title = aT('本机没有原图,下载之前导出的 PDF', 'Originals not on this device — download the exported PDF');
        // 捕获阶段拦截,stopImmediatePropagation 挡掉冒泡阶段的 exportPdf 处理器。
        exportBtn.addEventListener(
          'click',
          (e) => {
            e.stopImmediatePropagation();
            e.preventDefault();
            window.open(pdfUrl, '_blank', 'noopener');
          },
          true,
        );
      } else {
        exportBtn.disabled = true;
        exportBtn.setAttribute('aria-disabled', 'true');
        exportBtn.title = aT('本机没有原图,请在有原图的设备上导出', 'Originals not on this device — export where the photos are');
      }
    })();

    /* ─── Wire the canvas/topbar/modal data-action handlers ───
       Scoped to EditorBook's OWN subtree (topbar + #paneCenter + .chat-fold-expand +
       modals) so it never double-binds the chat-owned actions that ChatPanel binds
       inside its aside (buyShells / pickAddPhotos / toggleChat-collapse). */
    const actions: Record<string, () => void> = {
      exportPdf,
      backupPhotos,
      // .chat-fold-expand lives in the shell (canvas scope) and toggles the shared
      // body class; the .chat-fold-collapse button in the aside is
      // bound by ChatPanel.
      toggleChat,
      toggleOverview,
      // 视图切换两档(底部栏最右):预览模式 = 翻页书,画布模式 = 无限画布。
      viewBook: () => { if (bodyEl.classList.contains('overview-on')) exitOverview(); },
      viewCanvas: () => { if (!bodyEl.classList.contains('overview-on')) enterOverview(); },
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

    // Chat init (history/opener/interview chain) now runs ONCE inside ChatPanel's
    // own mount effect — it is no longer part of the canvas mount. The canvas below
    // only paints the book + rail and populates the coordinator.

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

    setLang(currentLang); // also runs renderRail + updateThumbUI + paintSpread; walks
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
      // Authoring pre-resolved display-tier urls from the draft skeleton (passed in
      // as initialImageUrls) — repaint with those rather than re-fetching from an
      // empty detail.pages / null layoutJson.
      paintSpread(currentCh);
      updateThumbUI(currentCh);
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
      void photoStore.getTierUrls(photoIds, 'display').then((urls) => {
        imageUrls = urls;
        paintSpread(currentCh);
        updateThumbUI(currentCh);
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
        stage?.removeEventListener('wheel', onWheel);
      stage?.removeEventListener('pointerdown', onCanvasPointerDown);
      stage?.removeEventListener('pointermove', onCanvasPointerMove);
      stage?.removeEventListener('pointerup', endCanvasPan);
      stage?.removeEventListener('pointercancel', endCanvasPan);
      stage?.removeEventListener('dblclick', onCanvasDoubleClick);
      editBar?.removeEventListener('pointerdown', onEditBarPointerDown);
      editBar?.removeEventListener('click', onEditBarClick);
      editBar?.removeEventListener('input', onEditBarInput);
      editBar?.removeEventListener('change', onEditBarChange);
      editBar?.removeEventListener('keydown', onEditBarKeydown);
      window.removeEventListener('resize', onWindowResize);
      if (resizeRepaintTimer !== null) clearTimeout(resizeRepaintTimer);
      stageRO?.disconnect();
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
          {locale === 'zh' ? '切换到编辑模式，点击可手动编辑' : 'Switch to edit mode · click to edit manually'}
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

        <div className="book-overview" id="bookOverview">
          <div className="ov-grid" id="ovGrid" />
        </div>

        {/* 底部控制(2026-07-15 拍板):翻页 pill 居中挂在预览下方,缩放只留一个
            百分比数字(点它复位;缩放操作走 ⌘/Ctrl+滚轮/捏合,+/− 按钮删除);
            视图切换单独一个 pill 在右下、按钮更大。 */}
        <div className="zoom-ctrl">
          {/* 预览模式只留上一页/下一页箭头,页码(#thumbInd)按用户拍板去掉。 */}
          <span className="nav-seg flex items-center gap-1.5">
            <button className="zoom-btn" data-thumbnav="-1" data-i18n-title="prevPage" title={locale === 'zh' ? '上一页' : 'Previous page'} aria-label={locale === 'zh' ? '上一页' : 'Previous page'}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button className="zoom-btn" data-thumbnav="1" data-i18n-title="nextPage" title={locale === 'zh' ? '下一页' : 'Next page'} aria-label={locale === 'zh' ? '下一页' : 'Next page'}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
            <span className="zoom-sep" />
          </span>
          <span className="zoom-pct" id="zoomPct" data-action="resetZoom" data-i18n-title="resetZoom" title={locale === 'zh' ? '点击复位缩放' : 'Click to reset zoom'}>100%</span>
        </div>
        <div className="ctrl-dock">
          <div className="view-ctrl">
            {/* 视图切换两档:预览模式(翻页书)/ 画布模式(无限画布)。悬停气泡由
                [data-tip] CSS 出;运行时换语言走 data-i18n-tip(setLang 同步)。 */}
            {/* 画板(编辑)按钮在左、且默认 active —— 现在排完版默认进画板,主视图排首位。 */}
            <button
              className="zoom-btn view-btn active"
              id="viewCanvasBtn"
              data-action="viewCanvas"
              data-tip={locale === 'zh' ? '画布模式' : 'Canvas mode'}
              data-i18n-tip="canvasMode"
              aria-label={locale === 'zh' ? '画布模式' : 'Canvas mode'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
            </button>
            <button
              className="zoom-btn view-btn"
              id="viewBookBtn"
              data-action="viewBook"
              data-tip={locale === 'zh' ? '预览模式' : 'Preview mode'}
              data-i18n-tip="previewMode"
              aria-label={locale === 'zh' ? '预览模式' : 'Preview mode'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2Z" /><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8Z" /></svg>
            </button>
          </div>
        </div>

        <div className="el-bar" id="elBar" role="toolbar" aria-label={locale === 'zh' ? '元素编辑工具' : 'Element editing tools'}>
          <div className="eb-group" data-group="text">
            {/* 颜色:自定义取色器(点开「填充」弹层,见 buildColorPanel)。 */}
            <span className="eb-ctrl">
              <button type="button" className="eb-color-trigger" data-edit-action="color-open" title={locale === 'zh' ? '颜色' : 'Color'} aria-label={locale === 'zh' ? '文字颜色' : 'Text color'}>
                <span className="eb-color-dot" id="ebColorDot" />
              </button>
              <div className="eb-panel eb-color-panel" id="ebColorPanel" />
            </span>
            <span className="eb-sep" />
            {/* 字体:触发按钮 + 带搜索的字体面板(imperative 填充,见 buildFontPanel)。 */}
            <span className="eb-ctrl">
              <button type="button" className="eb-trigger eb-font-trigger" id="ebFontTrigger" data-edit-action="font-open" title={locale === 'zh' ? '字体' : 'Font'}>
                <span className="eb-font-name" id="ebFontName">{locale === 'zh' ? '字体' : 'Font'}</span>
                <svg className="eb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              <div className="eb-panel eb-font-panel" id="ebFontPanel" />
            </span>
            <span className="eb-sep" />
            {/* 字号:可编辑数字 + 预设下拉。 */}
            <span className="eb-ctrl eb-size">
              <input className="eb-size-input" id="ebSizeInput" data-edit-action="font-size-input" inputMode="numeric" placeholder="--" aria-label={locale === 'zh' ? '字号' : 'Font size'} />
              <button type="button" className="eb-size-caret" data-edit-action="font-size-open" title={locale === 'zh' ? '字号预设' : 'Size presets'} aria-label={locale === 'zh' ? '字号预设' : 'Size presets'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg></button>
              <div className="eb-panel eb-size-panel" id="ebSizePanel" />
            </span>
            <span className="eb-sep" />
            <button type="button" className="eb-btn" data-edit-action="bold" title={locale === 'zh' ? '加粗' : 'Bold'} aria-label={locale === 'zh' ? '加粗' : 'Bold'}><b>B</b></button>
            <button type="button" className="eb-btn" data-edit-action="italic" title={locale === 'zh' ? '斜体' : 'Italic'} aria-label={locale === 'zh' ? '斜体' : 'Italic'}><i style={{ fontFamily: 'Georgia,serif' }}>I</i></button>
            <span className="eb-sep" />
            <button type="button" className="eb-btn" data-edit-action="align-left" title={locale === 'zh' ? '左对齐' : 'Align left'} aria-label={locale === 'zh' ? '左对齐' : 'Align left'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg></button>
            <button type="button" className="eb-btn" data-edit-action="align-center" title={locale === 'zh' ? '居中' : 'Center'} aria-label={locale === 'zh' ? '居中' : 'Center'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="5" y1="18" x2="19" y2="18" /></svg></button>
            <button type="button" className="eb-btn" data-edit-action="align-right" title={locale === 'zh' ? '右对齐' : 'Align right'} aria-label={locale === 'zh' ? '右对齐' : 'Align right'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" /></svg></button>
            <span className="eb-sep" />
            <button type="button" className="eb-btn eb-primary" data-edit-action="edit-text" title={locale === 'zh' ? '编辑文案' : 'Edit text'} aria-label={locale === 'zh' ? '编辑文案' : 'Edit text'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg><span>{locale === 'zh' ? '编辑文案' : 'Edit text'}</span></button>
          </div>
          {/* 图片编辑不再用 el-bar:选中图片=拖动平移(前后左右)+ 滑块/滚轮缩放 + 复位,
              全在图片浮层(img-edit-overlay)里完成。换照片/黑白已去掉。 */}
        </div>
      </div>

    </main>
  );
}
