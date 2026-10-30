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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { boundPick, pick, type AT } from '@/lib/i18n/pick';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { signOut } from '@/lib/auth/client';
import { photoStore, RASTER_PDF_IMAGE_MAX_EDGE } from '@/lib/photo/store';
import { fetchPhotoOriginalUrls } from '@/lib/album/photo-original-client';
import { generateImageIntoSlot } from '@/lib/imagegen/generate-client';
import { lutEngine } from '@/lib/photo/lut/engine';
import type { PhotoFilterState } from '@/lib/photo/filter-state';
import { IMAGE_INPUT_ACCEPT, prepareImageBlobForBrowserDecode } from '@/lib/photo/heic';
import { isDefaultPageBackground } from '@/lib/design/page-backgrounds';
import { interiorSpreads } from '@/lib/export/collage';
import { COLOR_PRESETS, IMAGE_PRESETS, presetImageUrl, type BoardBackground } from '@/lib/board-bg/presets';
import {
  signPhotoSnapshotUpload,
  confirmPhotoSnapshot,
  putSnapshotBlob,
} from '@/lib/album/photo-snapshot-client';
import { usePhotoOriginalSync } from '@/lib/hooks/use-photo-original-sync';
import { usePhotoMaskSource } from '@/lib/hooks/use-photo-mask-source';
import { createPageSaveCoordinator, type PagePatch } from '@/lib/collaboration/page-save-coordinator';
import { createFetchPageSaveTransport } from '@/lib/collaboration/page-save-transport';
import { createDraftSync, type SyncChanges } from '@/lib/collaboration/draft-sync';
import { saveAlbumSettings, type SettingsSaveOutcome } from '@/lib/collaboration/settings-save-transport';
import { capabilitiesForRole } from '@/lib/collaboration/capabilities';
import { CollabPanel } from './CollabPanel';
import { authHrefWithFrom } from '@/lib/auth/redirect';
import { UserAvatar } from '@/components/app/UserAvatar';
import { UserMenu } from '@/components/app/UserMenu';
import { useChromeSession } from '@/components/app/useChromeSession';
import { YujeeState } from '@/components/app/YujeeState';
import { RetryFailedButton } from '../RetryFailedButton';
import { buildSpreads, isSoloSpread, pageSlot, spreadIndexOfPage } from '../spreads';
import { collectPhotoIds, type ResolveImage } from '../adapt-layout';
import { fitTextBoxes, pageFolioInfos, patchHtmlImagePos, patchHtmlPageStyle, patchHtmlText, patchHtmlTextStyle, preferredPageHtml, type PageFolioInfo } from '../page-html-dom';
import { PAGE, pageBox } from '../templates/constants';
// 页面渲染是共享层(移动端那棵 UI 树用同一份,见 page-face.tsx 抬头)。main 上新加的
// 双宽页 pageBox / 跨页 folio 都已折进 page-face,这里不再持第二份实现。
import { editableTextOf } from './editable-text';
import { pageFaceInner, pageFaceHTML, type PageFaceCtx } from './page-face';
import { clampZoom, paintDecision } from './zoom-util';
import { resolveDeviceMode, initMobileCanvas } from './mobile-canvas';
import {
  shouldMountLegacyMobileEditor,
  shouldMountMobileEditor,
} from './design-gate-util';
import { useDeviceMode } from './use-device-mode';
import { MobileEditorRoot } from './mobile/MobileEditorRoot';
import { runPhotoBackup } from './mobile/use-photo-backup';
import {
  clampImagePos,
  coverCropFraction,
  normalizeRotate,
  previewDragToImagePos,
  rotateDragDelta,
  rotateImagePos,
  zoomImagePos,
  DEFAULT_IMAGE_POS,
  SCALE_MIN,
  SCALE_MAX,
  type CropFraction,
  type ImagePosValue,
} from './image-edit-util';
import {
  SWAP_LONG_PRESS_MS,
  SWAP_LONG_PRESS_SLOP,
  exceedsLongPressSlop,
  sameSwapSlot,
  swapImageSlots,
  type SwapSlotRef,
} from './image-swap';
import {
  applyMove,
  buildInsertPermutation,
  gapFromPointer,
  isAnchoredTemplate,
  legalGaps,
  type CellRect,
} from './page-reorder';
import {
  editAnchorId,
  editAnchorSelector,
  resolveEditAnchor,
  type EditAnchorId,
} from './edit-anchor-util';
import { computeExportUnlocked } from './export-gate-util';
import { runExportWithRetry, buildExportFailureLog, ExportError } from './export-retry-util';
import { logger } from '@/lib/log/logger';
import { loadAlbumFonts, loadFontSubset, useAlbumFonts } from '@/lib/font/album-font-loader';
import { isCjkFontId, type CjkFontId } from '@/services/font/font-manifest';
import { FONT_CATALOG } from '@yujee/contracts/render';
import { EDITOR_FONTS, CJK_PREVIEW_SAMPLE, type EditorFont } from './editor-fonts';
import { clamp01, hsvToRgb, rgbToHsv, hexToRgb, toHex, rgbToHex } from './color-util';
import { loadRecentColors, saveRecentColor } from './color-recent';
import {
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
import { coverOptionImages } from './cover-option-slots';
import { ChatPanel, type ChatMode } from './ChatPanel';
import { FilterBar } from './FilterBar';
import {
  collectSnapshotEntries,
  correlateSignedSnapshotUploads,
  createFilterSaveController,
  createFrozenBackupPlan,
  createLatestCommit,
  filterSnapshotMismatches,
  shouldDismissFilterPanel,
  prepareSnapshotBlobs,
  uploadCorrelatedSnapshots,
} from './filter-controller';
import { photoSnapshotVersionMissingHint } from './share-error';
import {
  ChatCoordinatorContext,
  chatI18n,
  type ChatCoordinator,
  type DraftActApplied,
} from './editor-coordinator';
import './editor-port.css';

// 字体表已抽到 editor-fonts(移动端弹窗同用一份,见该文件抬头)。


// ── 自定义取色器(参考「填充」面板设计):HSV 拾色 + 色相/透明度条 + 预设色 + hex/不透明度 ──
// 预设色 = 项目文字用色(黑为主 + 品牌青/紫)。
// 吸色工具与画板垫底背景共用同一套常用色板(保持一致)。
const COLOR_SWATCHES = COLOR_PRESETS;
// 颜色换算已抽到共享层 color-util(移动端取色器用同一份,不留第二份真相)。
function hslToHex(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
// 色板/格子模式的常用色:中性列(极低饱和)+ 8 色相族 × 7 深浅 = 63 色。行主序,
// 每行 = [中性, 8 色相]。饱和 58%、明度 92→26,柔和贴合纪念册,不花哨。
const GRID_HUES = [8, 30, 45, 150, 190, 214, 258, 328];
const GRID_LIGHTNESS = [92, 81, 70, 59, 48, 37, 26];
const GRID_SWATCHES = GRID_LIGHTNESS.flatMap((l) => [
  hslToHex(40, 6, l),
  ...GRID_HUES.map((h) => hslToHex(h, 58, l)),
]);

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
  return <ReadyEditor key={detail.album.id} detail={detail} locale={locale} mode={mode} />;
}

// Own live filter state only after the real album detail exists. EditorPort itself
// can survive loading/building STUB_DETAIL frames; keeping state in this ready-only
// child prevents that placeholder null from later being persisted over a real
// filter. This component remains mounted while its desktop/mobile shell switches.
function ReadyEditor({
  detail,
  locale,
  mode,
}: {
  detail: AlbumDetail;
  locale: Locale;
  mode: Extract<EditorMode, 'authoring' | 'editing'>;
}) {
  const device = useDeviceMode();
  const [photoFilter, setPhotoFilter] = useState<PhotoFilterState | null>(
    detail.album.photoFilter ?? null,
  );
  // authoring: the draft skeleton is async (GET /draft) and the originals resolve
  // from IndexedDB, so we resolve everything first, then mount the stable shell.
  if (mode === 'authoring') {
    return (
      <EditorAuthoring
        detail={detail}
        locale={locale}
        device={device}
        photoFilter={photoFilter}
        setPhotoFilter={setPhotoFilter}
      />
    );
  }
  // editing: the original finalized editor, fed straight from detail.pages, through
  // the same lifted state. Keeping the responsive split here prevents a mobile
  // remount from reseeding a stale detail.album.photoFilter value.
  if (shouldMountLegacyMobileEditor(device, detail.pages)) {
    return (
      <MobileEditorRoot
        detail={detail}
        pages={detail.pages}
        locale={locale}
        photoFilter={photoFilter}
        setPhotoFilter={setPhotoFilter}
        // legacy 定稿相册没有草稿骨架;对话与桌面 editing 壳同口径。
        draftChapters={null}
        chatMode="editing"
      />
    );
  }
  return (
    <EditorShell
      mode="editing"
      detail={detail}
      locale={locale}
      initialPages={detail.pages}
      draftChapters={null}
      initialImageUrls={{}}
      photoFilter={photoFilter}
      setPhotoFilter={setPhotoFilter}
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
// null/unknown(第一个 progress 回调到达前的那几百毫秒)。Uses the same local
// dictionary convention as the rest of EditorPort (no messages/*.json).
function buildingStageLabel(stage: string | null | undefined, locale: Locale): string {
  const aT = boundPick(locale);
  switch (stage) {
    // V3 分析环节 (五环节状态机, WP1.5/#184): the /v3/analyze job streams these stage
    // labels via the progress callback. 识图砍掉后 analyze 只发 'group'(0→100),
    // 所以 'group' 就是用户导航后看到的第一个节拍 —— 它必须扛住整段等待的文案。
    // (stage 还没回来的头 ≤0.5s 由下面的 default 兜。)
    case 'group':
      return aT('正在整理这些瞬间…', 'Grouping your moments…');
    // V2 stage labels (kept until the v1/v2 teardown, #197).
    case 'vision':
      return aT('正在看你的照片…', 'Looking at your photos…');
    case 'grouping':
      return aT('正在整理这些瞬间…', 'Grouping your moments…');
    case 'skeleton':
      return aT('正在编排版式…', 'Laying out the spreads…');
    case 'writing':
      return aT('正在撰写文案…', 'Writing your story…');
    case 'finalize':
      return aT('正在生成终稿…', 'Putting the final touches…');
    default:
      return aT('正在整理照片…', 'Getting your photos ready…');
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
      {pick(locale, { zh: '加载中', en: 'Loading' })}
    </div>
  );
}

// ── authoring: resolve the draft skeleton + originals, then mount EditorBook ──
function EditorAuthoring({
  detail,
  locale,
  device,
  photoFilter,
  setPhotoFilter,
}: {
  detail: AlbumDetail;
  locale: Locale;
  device: string;
  photoFilter: PhotoFilterState | null;
  setPhotoFilter: Dispatch<SetStateAction<PhotoFilterState | null>>;
}) {
  const [skeleton, setSkeleton] = useState<DraftSkeleton | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'gone'>('loading');
  // 每次 pages-ready 刷新自增：设计对话可能只改文字（页数不变），canvasEpoch 进
  // EditorBook 的 key 保证画板仍会重挂重绘。
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  // 已加载草稿的内容指纹:pages-ready 事件来源很多(storyProgress 每次变化都会派发),
  // 内容没变时跳过「换 objectUrl + epoch 重挂」,消除采访/确认阶段画板一闪一闪。
  const draftFingerprintRef = useRef<string | null>(null);
  const photoFilterRef = useRef(photoFilter);
  photoFilterRef.current = photoFilter;

  // 页数组按 skeleton 记忆化。**引用必须稳定**:移动端容器(MobileEditorRoot)拿它当
  // 「服务端真相变了」的信号(useEffect 依赖它来整体换掉本地副本)。若每次渲染都新建数组,
  // 父层任何一次重渲都会把用户的本地改动冲回加载时的草稿 —— 而且是时序相关的偶发,
  // 表现为「改完返回,偶尔变回旧文案」。skeleton 本身已由 draftFingerprintRef 保证
  // 内容没变就不换引用,所以按它记忆化即等价于「只在草稿真的变了时才换」。
  const pages: EditorPage[] = useMemo(
    () =>
      (skeleton?.pages ?? []).map((p) => ({
        pageIndex: p.pageIndex,
        templateId: p.templateId,
        imagesJson: { ...p.imagesJson },
        textsJson: { ...p.textsJson },
        imagePosJson: { ...(p.imagePosJson ?? {}) },
        htmlJson: p.htmlJson,
        // 协同(collab plan §7.3):页 OCC 版本随页走,保存协调器以它为 baseVersion。
        version: p.version ?? null,
      })),
    [skeleton],
  );
  const autoBackupSignature = useRef('');
  useEffect(() => {
    if (pages.length === 0) return;
    const photoIds = collectPhotoIds(
      pages.map((page) => ({
        templateId: page.templateId,
        images: page.imagesJson,
        texts: page.textsJson,
      })),
    );
    if (photoIds.length === 0) return;
    const signature = JSON.stringify({
      photoIds,
      photoFilter,
      versions: detail.album.photoSnapshotRenderVersions ?? {},
    });
    if (signature === autoBackupSignature.current) return;
    autoBackupSignature.current = signature;
    void runPhotoBackup({
      albumId: detail.album.id,
      photoIds,
      photoFilter,
      currentVersions: detail.album.photoSnapshotRenderVersions ?? {},
    }).catch(() => undefined);
  }, [
    detail.album.id,
    detail.album.photoSnapshotRenderVersions,
    pages,
    photoFilter,
  ]);

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
        const urls = await photoStore.getTierUrls(
          [...ids],
          'display',
          photoFilterRef.current,
        );
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
    const aT = boundPick(locale);
    return (
      <div className="editor-port flex h-screen flex-col items-center justify-center bg-bg text-center">
        <YujeeState
          variant="error"
          title={aT('出错了', 'Something went wrong')}
          message={loadState === 'gone'
            ? aT('这本相册还没有草稿，或已经完成。', 'This album has no draft yet, or it is already finished.')
            : aT('草稿加载失败。', 'Failed to load the draft.')}
        >
          <button onClick={() => window.location.reload()} className="text-accent underline underline-offset-2 text-[13px]">
          {aT('刷新重试', 'Refresh')}
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
  // 设备分流落在这里,而不是 page.tsx 的 editing 分支:V3 的真实相册永远
  // layoutJson==null → 一直是 authoring,书住在草稿里(pages 带 htmlJson = 页面真相,
  // 落库时服务端 updatePage 也走 draft 分支、认 textStyles/pageStyle)。挂在 editing 上
  // 的移动端一次都不会出现,而且那边的 pages 没有 html 可打补丁 —— 样式改动刷新即丢。
  // 排版前 pages 为空(还在收集故事),那阶段不是「看/改书」,仍走桌面那套采访面板。
  // **选封面主题这一步也留在那套**:排版跑完就有 pages 了,但封面组还没选,而「选择封面 &
  // 封尾」那张必选卡是 ChatPanel 弹的(条件 hasPages)。只看 pages.length 分流的话,
  // 移动端一有页面就整体切进这棵没有 ChatPanel 的树,卡再也弹不出来 —— 手机上没法选主题,
  // 书永远停在没封面没文案。判据见 design-gate-util.ts(与服务端 designed 同口径)。
  if (shouldMountMobileEditor(device, pages)) {
    return (
      <MobileEditorRoot
        detail={detail}
        pages={pages}
        locale={locale}
        photoFilter={photoFilter}
        setPhotoFilter={setPhotoFilter}
        // 草稿骨架给移动树里的 ChatPanel(章节卡/追加照片采访都要它);
        // 过了上面 loadState 闸门 skeleton 必非空。
        draftChapters={skeleton}
        chatMode="authoring"
      />
    );
  }
  return (
    <EditorShell
      mode="authoring"
      detail={detail}
      locale={locale}
      initialPages={pages}
      draftChapters={skeleton}
      initialImageUrls={imageUrls}
      canvasEpoch={canvasEpoch}
      photoFilter={photoFilter}
      setPhotoFilter={setPhotoFilter}
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
  photoFilter,
  setPhotoFilter,
}: {
  detail: AlbumDetail;
  locale: Locale;
  mode: ChatMode;
  initialPages: EditorPage[];
  draftChapters: DraftSkeleton | null;
  initialImageUrls: Record<string, string>;
  canvasEpoch?: number;
  photoFilter: PhotoFilterState | null;
  setPhotoFilter: Dispatch<SetStateAction<PhotoFilterState | null>>;
}) {
  const fontsReady = useAlbumFonts(initialPages.map((page) => ({ texts: page.textsJson })));
  const outerRootRef = useRef<HTMLDivElement>(null);
  const coordinator = useRef<ChatCoordinator | null>(null);
  const [storyProgress, setStoryProgress] = useState<StoryProgress | null>(null);
  const [, setStoryProgressLoading] = useState(mode === 'authoring');
  const [filterScope, setFilterScope] = useState<'book' | 'photo'>('book');
  const [filterPhotoId, setFilterPhotoId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [filterPersistError, setFilterPersistError] = useState<string | null>(null);
  /** 点了「重试」但结果还没回来。防抖 180ms + 一趟网络期间没有任何反馈的话,
   *  提示看起来就是「点了没反应」,用户会连点,把保存无限往后推(schedule 会重置计时器)。 */
  const [filterRetrying, setFilterRetrying] = useState(false);
  const lastPersistedFilter = useRef(JSON.stringify(detail.album.photoFilter ?? null));
  const lutSupported = useMemo(() => lutEngine.isSupported(), []);
  const aT = useMemo(() => boundPick(locale), [locale]);
  // 全局创作设置 OCC 基线(Phase 2B):滤镜(本组件)与标题/画板背景(EditorBook)
  // 三处设置写入共用同一基线 —— ref 穿下去给命令式画布直接读写,避免两套基线
  // 互相看不见(同一客户端自己跟自己 409)。
  const settingsRevisionRef = useRef(detail.album.settingsRevision ?? 0);
  // authoring 分支的 draft skeleton 比 detail 后解析、更"新"(其间可能又发生过设置写);
  // editing 分支 detail.album 即真相。两类来源都同步,后到者覆盖 —— 与移动端
  // structureRevisionRef 同口径。
  useEffect(() => {
    const next = draftChapters?.settingsRevision ?? detail.album.settingsRevision;
    if (typeof next === 'number') settingsRevisionRef.current = next;
  }, [draftChapters, detail.album.settingsRevision]);
  const filterSaver = useMemo(() => {
    // save 与 onSuccess 之间的单飞信箱:save 里判定的冲突/无权限提示,由随后的
    // onSuccess 落到 filterPersistError(它在成功路径开头清 null,闭包变量保证
    // 「先清再设」的顺序不吞冲突提示)。控制器只放行最新一代回调,不会串台。
    let conflictNotice: string | null = null;
    return createFilterSaveController({
      save: async (state, signal) => {
        // 设置 OCC(collab rework §3):提交精确 baseSettingsRevision;成功读回新
        // settingsRevision 推进本地基线。冲突经 save 返回值回滚(而非 onError):
        // 控制器会把返回值当"已确认状态"走 onSuccess 落回本地。
        conflictNotice = null;
        const out: SettingsSaveOutcome = await saveAlbumSettings({
          albumId: detail.album.id,
          patch: { photoFilter: state },
          baseSettingsRevision: settingsRevisionRef.current,
          signal,
        });
        if (out.ok) {
          settingsRevisionRef.current = out.settingsRevision;
          return (out.data as PhotoFilterState | null | undefined) ?? state;
        }
        if (out.kind === 'conflict' || out.kind === 'forbidden') {
          // 冲突:采纳服务器当前基线(否则本地永远落后,之后每次写都 409 死胡同),
          // 本地退回最后确认版本;用户显式点重试 = 在新基线上重新表达这次滤镜意图。
          if (out.kind === 'conflict' && out.currentSettingsRevision != null) {
            settingsRevisionRef.current = out.currentSettingsRevision;
          }
          conflictNotice = out.kind === 'conflict'
            ? aT('滤镜已被他人修改，已恢复为上次保存的版本', 'Filter changed elsewhere — restored the last saved version')
            : aT('已无编辑权限', 'You no longer have edit access');
          return JSON.parse(lastPersistedFilter.current) as PhotoFilterState | null;
        }
        // 网络失败:保留乐观值等重试(与原口径一致),经 onError 说话。
        throw new Error(aT('没保存上，稍后可重试', "Couldn't save — retry later"));
      },
      onSuccess: (normalized) => {
        const serialized = JSON.stringify(normalized);
        lastPersistedFilter.current = serialized;
        setFilterRetrying(false);
        setFilterPersistError(conflictNotice);
        setPhotoFilter((current) =>
          JSON.stringify(current) === serialized ? current : normalized,
        );
      },
      onError: (error) => {
        setFilterRetrying(false);
        setFilterPersistError(error.message);
      },
    });
  }, [detail.album.id, setPhotoFilter, aT]);

  /* 选完滤镜、鼠标点到别处 → 面板自己收起。
     早先只有 × 能关,面板就一直钉在画布底部挡视线。移动端那份是 bottom-sheet,
     ModalHost 早就有「点遮罩关闭」,这里是把桌面补齐到同一口径。
     用 pointerdown 的**捕获**阶段:画布上不少处理器会 stopPropagation(选页、选图、
     工具条),挂冒泡阶段会被它们吃掉,表现是「点某些地方能收、点另一些不能」。
     放行判据在 shouldDismissFilterPanel(面板内部 + 打开它的那枚按钮)。 */
  useEffect(() => {
    if (!filterOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (shouldDismissFilterPanel(e.target)) setFilterOpen(false);
    };
    const onDocKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKeydown, true);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('keydown', onDocKeydown, true);
    };
  }, [filterOpen]);

  const openPhotoFilter = useCallback((scope: 'photo', photoId: string) => {
    if (!lutSupported) return;
    setFilterScope(scope);
    setFilterPhotoId(photoId);
    setFilterOpen(true);
  }, [lutSupported]);

  // Reload every display surface through the imperative editor. Its coordinator
  // owns the generation token because that is where the live image URL map lives.
  useEffect(() => {
    void coordinator.current?.reloadPhotoFilter(photoFilter);
  }, [photoFilter, canvasEpoch, initialPages.length, coordinator]);

  /* 抠图 mask(2026-09-09 那批,手工路径 2026-09-10 补齐):渲染优先用服务端 isnet 的
     分割结果,拿不到才退回浏览器端的漫水填充;并在「开着抠图的那批」变化时请服务端把
     缺的 mask 补上(不等结果)。挂在 EditorShell 而不是 EditorBook —— 这里才有 live 的
     photoFilter(EditorBook 拿到的是挂载那一刻的 initialPhotoFilter),而且它不随画布重挂。 */
  const onMasksReady = useCallback(() => {
    // 新 mask 到货 → 之前那次渲染记住的是「这张没有 mask」(已退回兜底),
    // 重来一次画板才会拿到好的那版,否则用户要刷新页面。
    void coordinator.current?.reloadPhotoFilter(photoFilter);
  }, [coordinator, photoFilter]);
  usePhotoMaskSource(detail.album.id, photoFilter, onMasksReady);

  // Persist only the filter field after 180 ms idle. The production controller
  // coalesces drafts, aborts in-flight saves, and suppresses stale/unmounted results.
  useEffect(() => {
    const serialized = JSON.stringify(photoFilter);
    if (serialized !== lastPersistedFilter.current) filterSaver.schedule(photoFilter);
  }, [filterSaver, photoFilter]);
  useEffect(() => () => filterSaver.dispose(), [filterSaver]);

  /* 设计对话落库后回来的权威滤镜状态。三样一起推,少一样都会出事:
       · settingsRevisionRef —— 不推的话用户下一次改标题/背景/滤镜带的是旧基线,必吃 409;
       · lastPersistedFilter —— 不推的话下面那个防抖保存 effect 会立刻把同一份状态
         再 PATCH 一遍(白白多一次写 + 再推一次 settingsRevision);
       · setPhotoFilter —— 画板重绘靠它(reloadPhotoFilter 的 effect 依赖 photoFilter)。
     滤镜引擎只在 Browser 跑,服务端改完不告诉画板,用户看到的就还是旧观感。 */
  const onAgentPhotoFilter = useCallback(
    (state: PhotoFilterState | null, settingsRevision: number) => {
      settingsRevisionRef.current = settingsRevision;
      lastPersistedFilter.current = JSON.stringify(state);
      setPhotoFilter(state);
    },
    [setPhotoFilter],
  );

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
        <EditorTopbar
          locale={locale}
          exportUnlocked={exportUnlocked}
          coordinator={coordinator}
          detail={detail}
          onOpenCollab={() => setCollabOpen(true)}
        />
        {collabOpen ? (
          <CollabPanel
            albumId={detail.album.id}
            locale={locale}
            onClose={() => setCollabOpen(false)}
          />
        ) : null}

        <div className="workspace flex-1 overflow-hidden relative md:flex" style={{ height: 'calc(100vh - 56px)' }}>
          <button className="chat-fold-expand" data-action="toggleChat" data-i18n-title="expandChat" title="展开对话" aria-label="展开对话">
            <img className="fab-jelly" src="/jellyfish-icon.png" alt="" />
            <svg className="fab-chat-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span>{pick(locale, { zh: '对话', en: 'Chat' })}</span>
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
            initialPhotoFilter={photoFilter}
            outerRootRef={outerRootRef}
            coordinator={coordinator}
            lutSupported={lutSupported}
            openPhotoFilter={openPhotoFilter}
            settingsRevisionRef={settingsRevisionRef}
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
            onAgentPhotoFilter={onAgentPhotoFilter}
          />
        </div>

        <EditorModals locale={locale} />
        {lutSupported && filterOpen && (
          <FilterBar
            locale={locale}
            state={photoFilter}
            scope={filterScope}
            photoId={filterPhotoId}
            persistError={filterPersistError}
            onChange={setPhotoFilter}
            onScopeChange={setFilterScope}
            onRetry={() => filterSaver.retry()}
            onClose={() => setFilterOpen(false)}
          />
        )}
        {filterPersistError && !filterOpen && (
          <button
            type="button"
            className="filter-save-toast"
            role="alert"
            onClick={() => {
              setFilterOpen(true);
              filterSaver.retry();
            }}
          >
            {pick(locale, { zh: '风格保存失败，点此重试', en: 'Style failed to save. Click to retry.' })}
          </button>
        )}
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
  detail,
  onOpenCollab,
}: {
  locale: Locale;
  exportUnlocked: boolean;
  coordinator: RefObject<ChatCoordinator | null>;
  detail: AlbumDetail;
  onOpenCollab: () => void;
}) {
  void coordinator; // the export button's data-action is wired by EditorBook via the shared root
  // 治理入口显隐(capabilities 收口,Phase 5):协作邀请/成员管理是 owner-only
  // 治理能力,判据来自产品授权唯一真相(共享 capabilities),不再手写 isOwner。
  // 创作入口(标题/滤镜/分享/导出/备份)对 owner/editor 全量开放,不加条件。
  const canManageMembers = capabilitiesForRole(detail.album.role).has('manageMembers');
  // 账户菜单统一为 <UserMenu>(与 landing / my-albums 同一组件):真实姓名/邮箱、
  // 积分余额、我的相册、消耗记录、反馈、退出全在。此前编辑页是手搓静态 demo
  // (写死的占位姓名/邮箱)+ 命令式补真名 + 命令式注入语言行,三套逻辑
  // 打架且缺积分/相册/记录。showLangSwitch 保留编辑页菜单内的 EN/中文 切换。
  const session = useChromeSession();
  return (
    <div className="topbar nav-shell sticky top-0 z-50 h-14 flex items-center justify-between px-3 sm:px-6 shrink-0">
      <div className="top-left flex items-center gap-2 sm:gap-3 min-w-0">
        <a href={`/${locale}/my-albums`} className="back-btn flex items-center justify-center w-9 h-9 rounded-pill text-fg2 no-underline transition-colors hover:bg-black/[.05] shrink-0" data-i18n-title="backToDetail" title={pick(locale, { zh: '返回作品列表', en: 'Back to albums' })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><polyline points="15 18 9 12 15 6" /></svg>
        </a>
        <a href={`/${locale}`} className="brand no-underline text-inherit shrink-0"><img src="/logo-yujee.svg" alt="Yujee" style={{ height: '26px', width: 'auto', display: 'block' }} /></a>
        <span className="crumb text-meta text-[13px] hidden sm:inline">/</span>
        <span className="album-title font-display font-bold text-[14px] text-fg px-2 py-1 rounded-pill border border-transparent transition-colors hover:bg-bg cursor-text truncate" contentEditable suppressContentEditableWarning data-i18n="albumTitle">2024 厦门三日游</span>
        {/* 相册留存状态(photo-snapshot):只讲图片安危(书本身一直在云端)。三态由
            refreshBackupStatus 命令式更新 data-book-status(仅本地/已存云端/部分备份),
            none=没用到图 → CSS 隐藏。点色 + 显隐由 CSS 按 data-book-status 出;整句在 title。 */}
        <span className="book-status hidden sm:inline-flex items-center gap-1.5 text-[12px] text-fg2 px-2 py-1 rounded-pill" data-book-status="none" data-testid="book-status">
          <span className="book-status-dot" aria-hidden="true" />
          <span className="book-status-label" />
        </span>
      </div>
      <div className="top-right flex items-center gap-1 sm:gap-2 shrink-0">
        {/* 保存到云端(photo-snapshot):备份照片压缩图,换设备/清缓存也能看到内页。默认只
            图标;点击后按钮上短暂显示「备份中… → 绿点已备份 / 红点备份失败」再回到默认。
            data-action 由 EditorBook 的效果绑到 backupPhotos;备份态由 setSaveState 命令式更新。 */}
        <button
          className="save-btn inline-flex items-center gap-1.5 px-4 py-2.5 rounded-pill text-[13px] font-semibold text-fg2 border border-bd"
          data-action="backupPhotos"
          data-testid="backup-photos-btn"
          data-backup-state="idle"
          title={pick(locale, { zh: '保存到云端:备份照片,换设备也能看', en: 'Save to cloud: back up photos so you can view on any device' })}
        >
          <span className="backup-dot" aria-hidden="true" />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="save-ic w-4 h-4"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
          <span className="save-label" data-backup-label />
        </button>
        {/* 分享链接(免登只读,collab rework §3.1):owner/editor 都是 Creator 都可创建,
            每次生成独立链接(editor 不撤销 owner 已发的)。生成前必须把照片压缩快照上传
            云端(对方浏览器里没有本地原图),弹窗里先说明这点、用户确认后才上传+生成;
            传不齐不发链接。 */}
        <button
          className="share-btn inline-flex items-center gap-1.5 px-4 py-2.5 rounded-pill text-[13px] font-semibold text-fg2 border border-bd"
          data-action="shareLink"
          data-testid="share-link-btn"
          title={pick(locale, { zh: '分享链接:会先上传照片(压缩快照)到云端,对方才能看到', en: 'Share link: uploads compressed photo snapshots first so viewers can see them' })}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
        </button>
        {/* 协作编辑(collab plan §15):治理能力(manageMembers),仅持有该能力的
            角色可见;权限由后端兜底(非 owner 调 edit-link/members 都 403)。 */}
        {canManageMembers ? (
          <button
            className="collab-btn inline-flex items-center gap-1.5 px-4 py-2.5 rounded-pill text-[13px] font-semibold text-fg2 border border-bd"
            data-testid="collab-btn"
            onClick={() => {
              if (!session.user || session.user.isAnonymous) {
                const from = `/${locale}/album/${detail.album.id}`;
                window.location.assign(authHrefWithFrom(`/${locale}/login`, from));
                return;
              }
              onOpenCollab();
            }}
            title={pick(locale, { zh: '协作编辑:邀请他人共同编辑这本书', en: 'Collaborate: invite others to co-edit this book' })}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          </button>
        ) : null}
        {/* 导出(collab rework §3.2):Creator 能力,editor 也导出;key 归 album 命名空间,
            协作者导出不互相覆盖文件。 */}
        <span className="btn-glow" data-export-gate={exportUnlocked ? 'open' : 'locked'}>
          <button
            className="btn-primary bg-fg text-white px-4 py-2.5 rounded-pill text-[13px] font-semibold flex items-center gap-1.5 transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}
            data-action="openExportMenu"
            data-testid="export-pdf-btn"
            data-i18n-title="exportPdf"
            disabled={!exportUnlocked}
            aria-disabled={!exportUnlocked}
            title={exportUnlocked ? (pick(locale, { zh: '导出', en: 'Export' })) : (pick(locale, { zh: '完成故事并选定封面后即可导出', en: 'Finish the story and pick a cover to export' }))}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            {/* 图标按钮:文案隐藏但保留(i18n 同步 + 只读姿态换「下载 PDF」时改它的 textContent)。 */}
            <span className="hidden" data-i18n="exportPdf">{pick(locale, { zh: '导出', en: 'Export' })}</span>
          </button>
        </span>

        <UserMenu user={session.user} locale={locale} showLangSwitch />
      </div>
    </div>
  );
}

// The modals (photo picker + export-fail + export menu/collage/progress). Rendered
// by the stable shell; their data-action nodes + backdrop-close are wired by
// EditorBook's effect.
function EditorModals({ locale }: { locale: Locale }) {
  const aT = boundPick(locale);
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

      {/* 换图选择器:选中某张照片后,图片浮层的「换图」打开它。列本册已有的照片
          (照片只在浏览器本地,不走上传链路),点一张即换即关 —— 换图是可逆的
          (再点一张就换回来),为可逆动作加一道「确定」只是多一次点击。所以这里
          没有确认按钮,只有取消。与移动端 PhotoPickerSheet 同一交互口径。 */}
      <div className="modal-overlay" id="photoSwapModal" data-overlay-close>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="photoSwapTitle">
          <div className="px-6 pt-5 pb-4 border-b border-bdsoft shrink-0">
            <div className="flex items-center justify-between">
              <h3 id="photoSwapTitle" className="font-display text-[17px] font-bold" data-i18n="swapTitle">换一张</h3>
              <button className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg transition-colors" data-action="closePhotoSwap" aria-label="close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <p className="text-[12.5px] text-muted mt-1" data-i18n="swapSub">点一张照片换掉这个位置上的图。位置和缩放会保留。</p>
          </div>
          <div className="px-6 py-5 overflow-y-auto flex-1">
            <div className="pick-grid" id="swapGrid" />
          </div>
          <div className="px-6 py-4 border-t border-bdsoft shrink-0 flex items-center justify-end">
            <button className="px-5 py-2.5 rounded-pill text-[13px] font-medium text-fg2 border border-bd transition-colors hover:bg-bg" data-action="closePhotoSwap" data-i18n="swapCancel">取消</button>
          </div>
        </div>
      </div>

      {/* AI 生图(2026-08-18,docs/specs/2026-08-18-ai-image-generation-design.md):
          用户写一句描述,生成一张图填进当前图槽。产出是一张普通照片(photoId),
          所以导出/分享/备份下游零改动。每次付费生成附带 1 次免费重来 —— 次数是
          按毛利算出来的,不是随手定的。 */}
      <div className="modal-overlay" id="imageGenModal" data-overlay-close>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="imageGenTitle">
          <div className="px-6 pt-5 pb-4 border-b border-bdsoft shrink-0">
            <div className="flex items-center justify-between">
              <h3 id="imageGenTitle" className="font-display text-[17px] font-bold">{aT('AI 生成一张图', 'Generate an image')}</h3>
              <button className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg transition-colors" data-action="closeImageGen" aria-label="close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <p className="text-[12.5px] text-muted mt-1">{aT('描述你想要的画面,生成的图会放进当前这个位置。每次生成消耗 1 积分。', 'Describe what you want. The image goes into the selected slot. Each generation costs 1 credit.')}</p>
          </div>
          <div className="px-6 py-5 overflow-y-auto flex-1">
            <textarea
              id="imageGenPrompt"
              className="w-full min-h-[110px] rounded-lg border border-bd bg-bg px-3 py-2.5 text-[14px] leading-relaxed outline-none focus:border-fg2"
              maxLength={200}
              placeholder={aT('例如:黄昏时海边的礁石,暖色调,安静', 'e.g. sea rocks at dusk, warm tones, quiet')}
            />
            <p className="mt-2 text-[12px] text-muted" id="imageGenHint" />
          </div>
          <div className="px-6 py-4 border-t border-bdsoft shrink-0 flex items-center justify-end gap-2">
            <button className="px-5 py-2.5 rounded-pill text-[13px] font-medium text-fg2 border border-bd transition-colors hover:bg-bg" data-action="closeImageGen">{aT('取消', 'Cancel')}</button>
            <button className="px-5 py-2.5 rounded-pill text-[13px] font-semibold bg-fg text-white transition-transform hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0" id="imageGenSubmit" data-action="submitImageGen">{aT('生成', 'Generate')}</button>
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

      {/* 导出格式选择弹窗。顶栏导出按钮 → openExportMenu 打开。 */}
      <div className="modal-overlay" id="exportMenuModal" data-overlay-close>
        <div className="modal-card export-sheet" role="dialog" aria-modal="true" aria-labelledby="exportMenuTitle" data-testid="export-menu-modal">
          <div className="px-6 pt-5 pb-1">
            <h3 id="exportMenuTitle" className="font-display text-[18px] font-bold">{aT('导出', 'Export')}</h3>
            <p className="text-[13px] text-muted mt-1">{aT('选一种格式导出', 'Pick a format to export')}</p>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2.5" data-export-opts>
            <button className="export-opt" data-action="openCollage" data-testid="export-opt-collage">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
              <span>{aT('多跨页拼图 · JPG', 'Spread collage · JPG')}</span>
            </button>
            <button className="export-opt" data-action="openNineGrid" data-testid="export-opt-live">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8Z" /></svg>
              <span>{aT('Live 图', 'Live video')}</span>
            </button>
            <button className="export-opt" data-action="exportSinglePages" data-testid="export-opt-pages">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L9 20" /></svg>
              <span>{aT('单页 JPG', 'Single pages · JPG')}</span>
            </button>
            {/* PDF 只留一个入口(2026-08-06 版式选择设计):点开先选标准/印刷版式。 */}
            <button className="export-opt" data-action="openPdfStyle" data-testid="export-opt-pdf">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>
              <span>{aT('整本 PDF', 'Full PDF')}</span>
            </button>
          </div>
          <div className="px-5 pb-5">
            <button className="export-cancel" data-action="closeExportMenu">{aT('取消', 'Cancel')}</button>
          </div>
        </div>
      </div>

      {/* 分享链接弹窗,两步:①说明「生成会上传照片快照,否则对方看不到」+ 确认按钮;
          ②照片全部传齐、链接生成后,换成链接 + 复制。显隐由 shareLink/confirmShareLink 切。 */}
      <div className="modal-overlay" id="shareLinkModal" data-overlay-close>
        <div className="modal-card export-sheet" role="dialog" aria-modal="true" aria-labelledby="shareLinkTitle" data-testid="share-link-modal">
          <div className="px-6 pt-5 pb-1">
            <h3 id="shareLinkTitle" className="font-display text-[18px] font-bold">{aT('分享链接', 'Share link')}</h3>
            <p className="text-[13px] text-muted mt-1">{aT('生成链接分享给朋友,免注册即可查看。', 'Create a link to share with friends — no sign-up to view.')}</p>
          </div>
          <div className="px-5 py-3">
            <div id="shareLinkConfirm">
              <p className="text-[13px] leading-relaxed text-[var(--fg)]">{aT('生成链接会上传照片,朋友才能看到。', 'Creating the link uploads your photos so friends can see them.')}</p>
              <button className="mt-3 w-full rounded-lg bg-[var(--fg)] px-4 py-2.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45" data-action="confirmShareLink" data-testid="share-link-confirm">{aT('上传照片并生成链接', 'Upload photos & create link')}</button>
            </div>
            <div id="shareLinkResult" className="hidden">
              <div className="flex items-center gap-2">
                <input id="shareLinkInput" readOnly className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--fg)]" />
                <button className="rounded-lg bg-[var(--fg)] px-4 py-2 text-[13px] font-semibold text-white" data-action="copyShareLink">{aT('复制', 'Copy')}</button>
              </div>
            </div>
            <p id="shareLinkHint" className="text-[12px] text-muted mt-2" />
          </div>
          <div className="px-5 pb-5">
            <button className="export-cancel" data-action="closeShareLink">{aT('关闭', 'Close')}</button>
          </div>
        </div>
      </div>

      {/* 拼图二级弹窗:一张图放几个跨页(1/2/3)。 */}
      <div className="modal-overlay" id="collageModal" data-overlay-close>
        <div className="modal-card collage-card" role="dialog" aria-modal="true" aria-labelledby="collageTitle" data-testid="collage-modal">
          <button className="collage-close" data-action="closeCollage" aria-label="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <div className="px-6 pt-6 text-center">
            <h3 id="collageTitle" className="font-display text-[18px] font-bold">{aT('一张图里放几个跨页?', 'How many spreads per image?')}</h3>
            <p className="text-[13px] text-muted mt-1.5">
              {aT('只导出内页(当前 ', 'Interior spreads only (currently ')}
              <span id="collageCount" className="font-semibold text-fg">0</span>
              {aT(' 个跨页),按选择自动排版', '), auto-arranged by your choice')}
            </p>
          </div>
          <div className="collage-density px-6 pt-5">
            {[1, 2, 3, 6].map((n) => (
              <button key={n} className="density-opt" data-collage-density={n} data-testid={`density-${n}`}>
                <span className={`density-wire${n === 6 ? ' density-wire-grid' : ''}`} data-n={n}>
                  {Array.from({ length: n }).map((_, i) => <span key={i} className="density-cell" />)}
                </span>
                <span className="density-label">{n} {aT('个', '')}</span>
              </button>
            ))}
          </div>
          <div className="px-6 py-6">
            <button className="collage-confirm" data-action="confirmCollage" data-testid="collage-confirm" disabled>{aT('确认导出', 'Export')}</button>
          </div>
        </div>
      </div>

      {/* Live 图:翻页 / 九宫格两种样式共用一个出口。 */}
      <div className="modal-overlay" id="nineGridModal" data-overlay-close>
        <div className="modal-card collage-card" role="dialog" aria-modal="true" aria-labelledby="nineGridTitle" data-testid="nine-grid-modal">
          <button className="collage-close" data-action="closeNineGrid" aria-label="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <div className="px-6 pt-6">
            <h3 id="nineGridTitle" className="font-display text-[18px] font-bold">{aT('Live 图', 'Live video')}</h3>
            <p className="text-[13px] text-muted mt-1.5">{aT('选一种样式,导出一段 Live 视频,可直接发社交平台。', 'Pick a style and export a Live video you can post anywhere.')}</p>
          </div>
          <div className="nine-grid-options px-6 pt-5">
            <fieldset>
              <legend>{aT('Live 样式', 'Live style')}</legend>
              <div className="nine-grid-choice">
                <button className="selected" data-live-style="flip" aria-pressed="true">
                  <span className="motion-example motion-example-flip" aria-hidden="true">
                    <span className="motion-book">
                      <span className="motion-fan motion-fan-left"><i /><i /><i /></span>
                      <span className="motion-fan motion-fan-right"><i /><i /><i /></span>
                      <span className="motion-page motion-page-left" />
                      <span className="motion-page motion-page-right" />
                      <span className="motion-leaf motion-leaf-left" />
                      <span className="motion-leaf motion-leaf-right" />
                    </span>
                  </span>
                  <span className="motion-option-title">{aT('翻页 Live', 'Page-flip Live')}</span>
                  <span className="motion-option-copy">{aT('像翻书一样逐页播放', 'Pages turn like a physical book')}</span>
                </button>
                <button data-live-style="nine-grid" aria-pressed="false">
                  <span className="motion-example motion-example-grid" aria-hidden="true">
                    <span className="motion-grid">
                      {Array.from({ length: 9 }).map((_, index) => <span key={index} />)}
                    </span>
                  </span>
                  <span className="motion-option-title">{aT('九宫格 Live', 'Nine-grid Live')}</span>
                  <span className="motion-option-copy">{aT('每组 9 页整齐切换', 'Nine pages switch as a neat grid')}</span>
                </button>
              </div>
            </fieldset>
          </div>
          <div className="nine-grid-actions px-6 py-6">
            <button className="collage-confirm" data-action="confirmLiveStyle" data-testid="live-style-confirm">{aT('继续导出', 'Continue')}</button>
          </div>
        </div>
      </div>

      {/* PDF 版式:标准 / 印刷(3mm 出血)共用一个出口(2026-08-06 版式选择设计)。
          与 Live 图弹窗同一副骨架;区别只有一条:打开时预选标准版,确认键不置灰。 */}
      <div className="modal-overlay" id="pdfStyleModal" data-overlay-close>
        <div className="modal-card collage-card" role="dialog" aria-modal="true" aria-labelledby="pdfStyleTitle" data-testid="pdf-style-modal">
          <button className="collage-close" data-action="closePdfStyle" aria-label="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <div className="px-6 pt-6">
            <h3 id="pdfStyleTitle" className="font-display text-[18px] font-bold">{aT('整本 PDF', 'Full PDF')}</h3>
            <p className="text-[13px] text-muted mt-1.5">{aT('选一种版式导出整本 PDF。', 'Pick a layout for the full PDF.')}</p>
          </div>
          <div className="nine-grid-options px-6 pt-5">
            <fieldset>
              <legend>{aT('PDF 版式', 'PDF layout')}</legend>
              <div className="nine-grid-choice">
                <button className="selected" data-pdf-style="standard" data-testid="pdf-style-standard" aria-pressed="true">
                  {/* 静态示意:标准=单页。 */}
                  <span className="motion-example" aria-hidden="true">
                    <svg width="72" height="92" viewBox="0 0 72 92" fill="none" stroke="#b9b9b9" strokeWidth="1.5">
                      <rect x="10" y="10" width="52" height="72" rx="2" fill="#dedede" stroke="#d1d1d1" />
                    </svg>
                  </span>
                  <span className="motion-option-title">{aT('标准版', 'Standard')}</span>
                  <span className="motion-option-copy">{aT('屏幕查看、分享用', 'For screens and sharing')}</span>
                </button>
                <button data-pdf-style="bleed" data-testid="pdf-style-bleed" aria-pressed="false">
                  {/* 静态示意:印刷=单页外圈虚线出血框(裁切位)。 */}
                  <span className="motion-example" aria-hidden="true">
                    <svg width="72" height="92" viewBox="0 0 72 92" fill="none" stroke="#b9b9b9" strokeWidth="1.5">
                      <rect x="3" y="3" width="66" height="86" rx="3" strokeDasharray="4 3" />
                      <rect x="10" y="10" width="52" height="72" rx="2" fill="#dedede" stroke="#d1d1d1" />
                    </svg>
                  </span>
                  <span className="motion-option-title">{aT('印刷版 · 3mm 出血', 'Print · 3mm bleed')}</span>
                  <span className="motion-option-copy">{aT('四边各加 3mm 出血，供印刷厂裁切；相当于 216×303mm', 'Adds 3mm bleed on all sides for print trimming; equals 216×303mm')}</span>
                </button>
              </div>
            </fieldset>
          </div>
          <div className="nine-grid-actions px-6 py-6">
            <button className="collage-confirm" data-action="confirmPdfStyle" data-testid="pdf-style-confirm">{aT('继续导出', 'Continue')}</button>
          </div>
        </div>
      </div>

      {/* 导出进度浮层(拼图/单页/PDF 共用)。渲染期间不可关闭。 */}
      <div className="modal-overlay" id="exportProgressModal" data-testid="export-progress">
        <div className="modal-card export-progress-card" role="alertdialog" aria-modal="true" aria-live="polite">
          <div className="px-6 py-6">
            <div className="flex items-center justify-between mb-3">
              <h3 id="expTitle" className="font-display text-[15px] font-semibold">{aT('正在导出…', 'Exporting…')}</h3>
              <span id="expLabel" className="text-[13px] text-muted tabular-nums">…</span>
            </div>
            <div className="exp-bar"><div className="exp-bar-fill" id="expBarFill" /></div>
            <p className="text-[12px] text-muted mt-2.5">{aT('生成中,请稍候,别关闭页面', 'Generating — please keep this page open')}</p>
          </div>
        </div>
      </div>

      {/* 垫底背景选择 sheet:纯色色板 + 自定义取色 + 内置实拍图。选中即时应用到预览并持久化。 */}
      <div className="modal-overlay" id="boardBgModal" data-overlay-close>
        <div className="modal-card board-bg-sheet" role="dialog" aria-modal="true" aria-labelledby="boardBgTitle" data-testid="board-bg-modal">
          <div className="board-bg-head">
            <h3 id="boardBgTitle" className="font-display text-[17px] font-bold">{aT('垫底背景', 'Board background')}</h3>
            <button className="board-bg-close" data-action="closeBoardBg" aria-label="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          {/* 主视图:一排常用基础色 + 无背景 + 「更多颜色」(展开统一 Fill 取色器) + 图片/上传。
              颜色子视图:内联共享 Fill 取色器(色板/拾色器),与文字/书页背景同一个组件。 */}
          <div className="board-bg-body" data-bbg-view="main">
            <div className="bbg-main">
              <div className="bbg-swatches">
                <button className="bbg-swatch bbg-none" data-board-none data-testid="bbg-none" title={aT('无背景', 'None')} aria-label={aT('无背景', 'None')} />
                {COLOR_PRESETS.map((c) => (
                  <button key={c} className="bbg-swatch" data-board-color={c} style={{ background: c }} aria-label={c} title={c} />
                ))}
                {/* 更多颜色:展开统一 Fill 取色器(替代原来的原生系统取色器)。 */}
                <button type="button" className="bbg-swatch bbg-more" data-bbg-more title={aT('更多颜色', 'More colors')} aria-label={aT('更多颜色', 'More colors')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18 3 3 0 0 0 0-6 1.5 1.5 0 0 1 0-3 3 3 0 0 0 0-6Z" /><circle cx="8.5" cy="9.5" r="1" fill="currentColor" stroke="none" /><circle cx="15.5" cy="9.5" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="14.5" r="1" fill="currentColor" stroke="none" /></svg>
                </button>
              </div>
              <p className="bbg-section-label">{aT('图片', 'Images')}</p>
              <div className="bbg-images">
                {IMAGE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className="bbg-image"
                    data-board-preset={p.id}
                    aria-label={p.label}
                    style={{ backgroundImage: `url("${presetImageUrl(p.id)}")` }}
                  />
                ))}
                {/* 上传自己的图当垫底背景(只存本地)。选中时格子显示这张图的缩略。 */}
                <label className="bbg-image bbg-upload" data-board-upload title={aT('上传图片', 'Upload image')}>
                  <input type="file" accept={IMAGE_INPUT_ACCEPT} className="hidden" data-board-upload-input aria-label={aT('上传图片', 'Upload image')} />
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                </label>
              </div>
            </div>
            <div className="bbg-color-view">
              <button type="button" className="bbg-back" data-bbg-back>‹ {aT('返回', 'Go back')}</button>
              <div className="bbg-color-slot" data-bbg-color-slot />
            </div>
          </div>
        </div>
      </div>

      {/* 页序弹窗:网格拖拽插入重排(2026-08-02 设计)。命令式开合,同 boardBgModal 一族;
          网格内容/拖拽全在效应闭包里(renderPreorderGrid + preorder pointer 三兄弟)。 */}
      <div className="modal-overlay" id="pageReorderModal" data-overlay-close>
        <div className="modal-card preorder-card" role="dialog" aria-modal="true" aria-labelledby="preorderTitle" data-testid="page-reorder-modal">
          <div className="preorder-head">
            <h3 id="preorderTitle" className="font-display text-[17px] font-bold">{aT('调整页面顺序', 'Reorder pages')}</h3>
            <p className="preorder-hint">{aT('拖动页面到新位置。封面、目录与封尾固定不动。', 'Drag pages to a new spot. Cover, contents and ending stay fixed.')}</p>
            <button className="board-bg-close" data-action="closePageReorder" aria-label="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div className="preorder-grid" id="preorderGrid" />
          <div className="preorder-foot">
            <button className="preorder-btn" data-action="closePageReorder" data-testid="preorder-cancel">{aT('取消', 'Cancel')}</button>
            <button className="preorder-btn preorder-btn-primary" data-action="confirmPageReorder" data-testid="preorder-done">{aT('完成', 'Done')}</button>
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
          <a href={`/${locale}/my-albums`} className="back-btn flex items-center justify-center w-9 h-9 rounded-pill text-fg2 no-underline transition-colors hover:bg-black/[.05] shrink-0" title={pick(locale, { zh: '返回作品列表', en: 'Back to albums' })}>
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
          title={pick(locale, { zh: '展开对话', en: 'Expand chat' })}
          aria-label={pick(locale, { zh: '展开对话', en: 'Expand chat' })}
          onClick={(e) => e.currentTarget.closest('.editor-port')?.classList.remove('chat-collapsed')}
        >
          <img className="fab-jelly" src="/jellyfish-icon.png" alt="" />
          <svg className="fab-chat-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <span>{pick(locale, { zh: '对话', en: 'Chat' })}</span>
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
              <span className="text-[13px] font-semibold text-fg2">{pick(locale, { zh: '对话', en: 'Chat' })}</span>
              <button
                type="button"
                className="chat-fold-btn chat-fold-collapse ml-auto"
                title={pick(locale, { zh: '折叠对话', en: 'Collapse chat' })}
                aria-label={pick(locale, { zh: '折叠对话', en: 'Collapse chat' })}
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
                  <button className="add-ch-btn w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted disabled:cursor-not-allowed disabled:opacity-40" title={pick(locale, { zh: '添加图片', en: 'Add photos' })} aria-label={pick(locale, { zh: '添加图片', en: 'Add photos' })} disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                  <span className="flex-1" />
                  <span className="btn-glow btn-glow-round shrink-0">
                    <button className="send-btn w-8 h-8 rounded-full bg-fg text-white flex items-center justify-center transition-transform disabled:cursor-not-allowed disabled:opacity-40" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }} title={pick(locale, { zh: '发送', en: 'Send' })} disabled>
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
      status={{ label: pick(locale, { zh: '整理中', en: 'Tidying up' }), tone: 'progress' }}
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
function errorShellCopy(kind: EditorErrorKind, message: string | null, aT: AT) {
  const isNetwork = /lost connection|network|连接/i.test(message ?? '');
  switch (kind) {
    case 'failed':
      return {
        status: aT('出错了', 'Something went wrong'),
        title: aT('出错了', 'Something went wrong'),
        body: aT('生成时出了点问题,可以再试一次。未扣除积分。', 'Something went wrong while generating. You can try again — no credit was charged.'),
        chat: aT('生成时遇到了点问题,可以再试一次。', 'Something interrupted the generation — you can try again.'),
      };
    case 'gone':
      return {
        status: aT('无法打开', 'Unavailable'),
        title: aT('无法打开这本相册', 'Couldn’t open this album'),
        body: aT('它可能已被删除,或不在当前账户下。', 'It may have been removed, or it isn’t available on this account.'),
        chat: aT('我找不到这本相册了。', 'I couldn’t find this memoir.'),
      };
    default:
      return {
        status: isNetwork ? (aT('连接中断', 'Connection lost')) : (aT('处理较慢', 'Taking a while')),
        title: aT('这比预期的时间长一些', 'This is taking longer than expected'),
        body: isNetwork
          ? (aT('网络异常,检查网络后刷新。', 'Network error. Check your connection and refresh.'))
          : (aT('仍在处理中 —— 刷新页面再看看。', 'Still working on it — refresh to check back.')),
        chat: isNetwork
          ? (aT('连接好像断了,刷新一下就好。', 'The connection dropped — a refresh should bring it back.'))
          : (aT('还在处理,稍后刷新看看。', 'Still processing — refresh in a moment.')),
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
  const aT = boundPick(locale);
  const copy = errorShellCopy(kind, message, aT);
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
              {aT('刷新', 'Refresh')}
            </button>
          )}
          <a
            href={`/${locale}/my-albums`}
            className="mt-6 inline-block text-[13px] text-accent underline underline-offset-2"
          >
            {aT('返回我的项目', 'Back to projects')}
          </a>
        </YujeeState>
      }
      chatBody={<p className="text-[13.5px] leading-relaxed text-muted">{copy.chat}</p>}
    />
  );
}

// EditorBook 已拆分至 ./EditorBook.tsx(2026-10-30 拆分)
import { EditorBook } from './EditorBook';
