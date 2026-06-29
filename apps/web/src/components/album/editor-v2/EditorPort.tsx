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

import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { signOut } from '@/lib/auth/client';
import { photoStore } from '@/lib/photo/store';
import { getWebTemplate } from '../web-registry';
import { buildSpreads, isSoloSpread, spreadIndexOfPage } from '../spreads';
import { adaptPageToTemplateData, collectPhotoIds, type ResolveImage } from '../adapt-layout';
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
import { runInspectAdjustLoop } from './draft-edit-orchestrator';
import { StageBreadcrumb } from './StageBreadcrumb';
import { computeExportUnlocked } from './export-gate-util';
import { runExportWithRetry, buildExportFailureLog, ExportError } from './export-retry-util';
import { logger } from '@/lib/log/logger';
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
  postEditChat,
  postRecommend,
  postApplyTheme,
  postCover,
  postDraftEdit,
  postInspectRender,
  type BrowserLayoutPatchEntry,
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
import { UnauthorizedError, CreditInsufficientError } from '@/lib/generation/client';
import './editor-port.css';

// The editor now spans the whole album lifecycle (W10 flow unification): the same
// EditorPort chrome renders for a still-generating album (building), a draft being
// authored (authoring), and a finalized album being edited (editing). page.tsx
// derives the mode from album.status + layoutJson and always mounts EditorPort.
//   • building  → AGENT_RUNNING / first load: flipbook shows a loading placeholder,
//                 chat rail is a non-interactive "tidying up" notice.
//   • authoring → EDITING & layoutJson==null: draft skeleton (read-only, invariant
//                 12) feeds the flipbook + rail; init (#161) already wrote the full
//                 first draft, so the chat rail does pointed single-page copy edits
//                 via /draft-edit (#162) — no theme→chapter dialog, no finalize CTA.
//   • editing   → layoutJson set: the original finalized editor, untouched.
export type EditorMode = 'building' | 'authoring' | 'editing';
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
  // building: nothing to render yet — same editor chrome (EditorBook) in its
  // building state: cover skeleton + unified loading chat. The poll in page.tsx
  // flips us to authoring/editing, which remounts EditorBook with real pages.
  if (mode === 'building') {
    return (
      <EditorBook
        mode="building"
        detail={detail}
        locale={locale}
        initialPages={[]}
        draftChapters={null}
        initialImageUrls={{}}
        generation={generation}
      />
    );
  }
  // authoring: the draft skeleton is async (GET /draft) and the originals resolve
  // from IndexedDB, so we resolve everything first, then mount the same book the
  // editing path uses. EditorBook keeps its single mount-time effect ([] deps).
  if (mode === 'authoring') {
    return <EditorAuthoring detail={detail} locale={locale} />;
  }
  // editing: the original finalized editor, fed straight from detail.pages.
  return (
    <EditorBook
      mode="editing"
      detail={detail}
      locale={locale}
      initialPages={detail.pages}
      draftChapters={null}
      initialImageUrls={{}}
    />
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
    // carries the "正在分析照片…" copy the acceptance calls for.
    case 'describe':
      return zh ? '正在分析照片…' : 'Looking at your photos…';
    case 'group':
      return zh ? '正在整理这些瞬间…' : 'Grouping your moments…';
    case 'template':
      return zh ? '正在编排版式…' : 'Laying out the spreads…';
    case 'preview':
      return zh ? '正在生成预览…' : 'Building your preview…';
    // V2 stage labels (kept until the v1/v2 teardown, #197).
    case 'vision':
      return zh ? '正在分析你的照片…' : 'Looking at your photos…';
    case 'grouping':
      return zh ? '正在整理这些瞬间…' : 'Grouping your moments…';
    case 'skeleton':
      return zh ? '正在编排版式…' : 'Laying out the spreads…';
    case 'writing':
      return zh ? '正在撰写文案…' : 'Writing your story…';
    case 'finalize':
      return zh ? '正在生成终稿…' : 'Putting the final touches…';
    default:
      return zh ? '正在分析照片…' : 'Looking at your photos…';
  }
}

// building: a single magazine-cover page rendered as a skeleton screen (shimmer +
// placeholder blocks). It mirrors the editor's page surface (radius/shadow) so the
// loading canvas reads as the same book — just not painted yet. No spread,
// thumbnails, zoom or chapter rail: the cover is the whole canvas while we wait.
function CoverSkeleton({ locale }: { locale: Locale }) {
  const scale = 0.5;
  return (
    <div
      className="relative overflow-hidden bg-surface"
      style={{ width: PAGE.width * scale, height: PAGE.height * scale, borderRadius: '2px', boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.08)' }}
      role="img"
      aria-label={locale === 'zh' ? '正在加载封面' : 'Loading cover'}
      aria-busy="true"
    >
      <div className="absolute inset-0 animate-pulse" style={{ background: 'linear-gradient(135deg, var(--surface), var(--bg) 50%, var(--border-soft))' }} />
      {/* hero image */}
      <div className="absolute inset-x-8 top-8 rounded-md bg-bdsoft" style={{ height: '46%' }} />
      {/* title + subtitle */}
      <div className="absolute left-8 right-16 rounded-full" style={{ top: '64%', height: '22px', backgroundColor: 'var(--border)' }} />
      <div className="absolute left-8 right-28 rounded-full bg-bdsoft" style={{ top: '71%', height: '14px' }} />
      {/* byline */}
      <div className="absolute left-8 rounded-full bg-bdsoft" style={{ bottom: '7%', height: '10px', width: '42%' }} />
    </div>
  );
}

// ── authoring: resolve the draft skeleton + originals, then mount EditorBook ──
function EditorAuthoring({ detail, locale }: { detail: AlbumDetail; locale: Locale }) {
  const [skeleton, setSkeleton] = useState<DraftSkeleton | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'gone'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
        const urls = await photoStore.getObjectUrls([...ids]);
        if (cancelled) return;
        setImageUrls(urls);
        setSkeleton(draft);
        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.album.id]);

  if (loadState === 'error' || loadState === 'gone') {
    // Don't sit on the "tidying up" screen forever — surface the real dead-end and
    // let the user refresh (a fresh load re-polls and re-derives the mode).
    const zh = locale === 'zh';
    return (
      <div className="editor-port flex h-screen flex-col items-center justify-center gap-3 bg-bg text-center">
        <p className="text-muted text-[14px]">
          {loadState === 'gone'
            ? zh ? '这本相册还没有草稿，或已经完成。' : 'This album has no draft yet, or it is already finished.'
            : zh ? '草稿加载失败。' : 'Failed to load the draft.'}
        </p>
        <button onClick={() => window.location.reload()} className="text-accent underline underline-offset-2 text-[13px]">
          {zh ? '刷新重试' : 'Refresh'}
        </button>
      </div>
    );
  }
  if (loadState !== 'ready' || !skeleton) {
    // A READY draft's skeleton fetch is sub-second — reuse the building state so the
    // chrome is identical. key="building" forces a remount into the authoring book
    // (key=pages.length) once the skeleton resolves, so its mount effect runs.
    return (
      <EditorBook
        key="building"
        mode="building"
        detail={detail}
        locale={locale}
        initialPages={[]}
        draftChapters={null}
        initialImageUrls={{}}
      />
    );
  }

  // Feed the skeleton's flattened page list straight into the flipbook (its shape
  // already matches EditorPage). draftChapters drives the rail with real labels.
  const pages: EditorPage[] = skeleton.pages.map((p) => ({
    pageIndex: p.pageIndex,
    templateId: p.templateId,
    imagesJson: { ...p.imagesJson },
    textsJson: { ...p.textsJson },
    imagePosJson: { ...(p.imagePosJson ?? {}) },
  }));
  return (
    <EditorBook
      key={skeleton.pages.length}
      mode="authoring"
      detail={detail}
      locale={locale}
      initialPages={pages}
      draftChapters={skeleton}
      initialImageUrls={imageUrls}
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
  generation = null,
}: {
  detail: AlbumDetail;
  locale: Locale;
  mode: EditorMode;
  initialPages: EditorPage[];
  draftChapters: DraftSkeleton | null;
  initialImageUrls: Record<string, string>;
  generation?: GenerationProgress;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // #236 ①: the per-chapter guide-opener dedup set lives at COMPONENT scope (a ref), not
  // inside the mount effect. React StrictMode double-invokes the effect in dev; an
  // effect-local `new Set()` gives each invocation its own empty set, so both fire the
  // opener (the reported double开场). A shared ref survives re-invocation → one opener.
  const guidedChaptersRef = useRef<Set<string>>(new Set());
  const [storyProgress, setStoryProgress] = useState<StoryProgress | null>(null);
  const [, setStoryProgressLoading] = useState(mode === 'authoring');
  const [, setStoryConfirming] = useState(false);
  // building: the album is still generating (AGENT_RUNNING) — same editor chrome,
  // but the canvas shows a single cover skeleton and the chat shows the unified
  // loading state with the input disabled. The imperative flipbook/chat engine
  // below has no pages to drive yet, so it short-circuits.
  const building = mode === 'building';
  const breadcrumbStage = building ? 'analysing' : storyProgress?.stage ?? detail.album.stage;
  // §4.2: chapter confirmation moved off the breadcrumb into the in-flow satisfaction
  // card, so the standing「确定本章」button + its label/disabled state are gone. We keep
  // hasStoryGate only for the authoring export-lock口径 below (§4.5a).
  const hasStoryGate = (storyProgress?.chapterOrder.length ?? 0) > 0;
  const exportReadyLabel = locale === 'zh'
    ? '太棒了，你的书已经准备好了！'
    : 'Wonderful — your book is ready!';

  // 导出闸门(WP5.2 / §4.5a). 复用 WP2.4 的 exportUnlocked 口径(album-service
  // .getStoryProgress:导出解锁 ⇔ allDone && stage ∉ {analysing, story})。仅当
  // 「章节故事」全章完成(stage 推进过 story)才让导出 PDF 按钮可用 + 出「太棒了…」
  // 提示;主题/封面在 story 之后,跳过不影响导出(§4.5a)。editing 模式的相册已
  // finalize,导出沿用旧路径,即使 post-migration V2 行的 stage 仍停在 analysing/story
  // 也不前端锁;building 隐藏。authoring 以 storyProgress 的 live stage 为准,因为
  // EDITING 轮询会停止,detail.album.stage 可能仍停在 story。
  const authoringExportLocked =
    mode === 'authoring' &&
    (storyProgress === null ||
      (hasStoryGate && !computeExportUnlocked(breadcrumbStage, storyProgress.allDone)));
  const exportUnlocked = !building && !authoringExportLocked;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (building) return;

    // ── scoped equivalents of document.* / body.* from the original script ──
    const $ = (s: string) => root.querySelector(s) as HTMLElement | null;
    const $$ = (s: string) => root.querySelectorAll(s);
    const byId = (id: string) => root.querySelector('#' + CSS.escape(id)) as HTMLElement | null;
    const bodyEl = root; // original toggled body classes (overview-on / detail-open / chat-collapsed / rail-collapsed); scoped to root here.

    /* ─── i18n translations (verbatim) ─── */
    const i18n: Record<string, Record<string, string>> = {
      zh: {
        pageTitle: 'Yujee — 编辑你的纪念册',
        backToProjects: '返回我的项目',
        albumTitle: '2024 厦门三日游',
        saved: '已保存',
        undo: '撤销',
        redo: '重做',
        share: '分享',
        exportPdf: '导出 PDF',
        // WP5.2 / §4.5b: 全章 done 后的「流程结束」提示,出现在导出按钮解锁时。
        exportReady: '太棒了，你的书已经准备好了！',
        // WP5.3 / §4.5d: 连续 3 次导出失败后的安抚弹框文案。不甩锅、不暴露技术细节。
        exportFailTitle: '导出遇到了点小麻烦',
        exportFailBody: '我们试了几次都没能生成你的 PDF，可能是网络不太稳。你的纪念册内容都安全保存着，稍后再点一次「导出 PDF」通常就好了。',
        exportFailRetry: '再试一次',
        exportFailClose: '知道了',
        alertUndo: '撤销上一步操作',
        alertRedo: '重做已撤销的操作',
        alertLinkCopied: '链接已复制到剪贴板！',
        alertExportPdf: 'PDF 导出中…\n\n杂志「2024 厦门三日游」正在生成高清 PDF，完成后将自动下载。',
        chapters: '章节',
        newChapter: '新增章节',
        alertNewChapter: '新增章节 — 请输入章节标题',
        ch1Title: '海边时光',
        ch1Desc: '6 张照片 · 沙滩、日出、海浪',
        ch2Title: '古街探味',
        ch2Desc: '7 张照片 · 小巷、美食、灯笼',
        ch3Title: '日落归途',
        ch3Desc: '4 张照片 · 山路、晚霞、剪影',
        prevPage: '上一页',
        nextPage: '下一页',
        zoomOut: '缩小',
        zoomIn: '放大',
        overview: '整本',
        toggleChapters: '收起 / 展开章节',
        fullscreen: '全屏预览',
        aiAvatarChar: '己',
        chatSubtitle: '和我聊聊这段回忆',
        chatCtxCh1: '第 1 章',
        thinkingAnalyzed: '分析了 6 张照片和地点信息',
        aiMsg1: '我已经为「海边时光」这一章写好了叙事文案。如果你想分享更多记忆，比如那天的天气、和谁同行、当时的心情，我可以把这些融进文字里。',
        userMsg1: '那天其实下午起风了，我还差点把帽子吹丢，能加进去吗？',
        thinkingReorg: '重新组织第二段，融入风和帽子的细节',
        aiMsg2: '好的，我把这个细节融进了第二段。你看看这版：',
        aiQuote1: '那天午后风忽然大了起来，差点把帽子从你头顶卷走。我们笑着追了几步，又坐回沙滩——海浪一遍又一遍地把脚印抹平，又一遍又一遍地让我们重新走过。',
        chipAccept: '采纳',
        chipRewrite: '再写一版',
        chipEditMyself: '我来改',
        alertAccepted: '已采纳这个版本！文案已更新到杂志预览中。',
        alertRewrite: '好的，我重新写一版...',
        alertEditMyself: '你可以直接编辑上方文案了',
        userMsg2: '很好。再帮我想个更有诗意的章节名？',
        thinkingChapterName: '正在构思章节名',
        aiMsg3: '几个备选，挑一个或告诉我感觉：',
        chipName1: '浪把时间洗薄了',
        chipName2: '风从海上来',
        chipName3: '咸味的下午',
        chipName4: '那只差点飞走的帽子',
        alertChapterUpdated: '章节名已更新为「',
        inputPlaceholder: '输入消息...',
        send: '发送',
        thinking: '正在思考',
        analyzedFeedback: '分析了你的反馈',
        aiReplyDefault: '收到，我重新写一版给你看看…',
        awaitUser: '在听，随时和我说～',
        justNow: '刚刚',
        thinkingComplete: '构思了 4 个章节名方案',
        railChapters: '章节',
        addChapter: '新增章节',
        addPhoto: '添加图片',
        detailChapters: '详细章节',
        balLow: '余额不足',
        balDesc: '当前余额不足以生成新章节，充值后即可继续创作',
        balRecharge: '去充值',
        bpLead: '哎呀，积分不够啦，充点积分继续生成你的纪念册～',
        bpTitle: '购买积分',
        bpSub: '<b>1 积分</b>，可处理一批照片',
        bpBuy: '去购买',
        editingNow: '正在编辑',
        chapterWord: '第',
        photosWord: '张照片',
        viewChapter: '查看章节',
        viewLayout: '查看排版',
        justEdited: '刚刚编辑',
        nowEditing: '正在编辑',
        chaptersLabel: '章节',
        collapseChapters: '收起章节',
        chatPanel: '对话',
        collapseChat: '折叠对话',
        expandChat: '展开对话',
        modalTitle: '选择照片',
        modalSub: '挑选这一章要用的照片，AI 会据此排版并撰写故事。',
        modalUpload: '上传照片',
        modalSelected: '已选',
        modalCancel: '取消',
        modalCreate: '创建章节',
        alertUploadStub: '上传照片 — 选择本地图片（演示占位）',
        stateLoading: '加载',
        stateTheme: '确定主题',
        stateStory: '章节故事',
        loadingNewChapter: '正在创建新章节…',
        themeThinking: '分析了这 {n} 张照片的场景与情绪',
        themeAsk: '我从这组照片里看到几个可能的主题，你想用哪一个？',
        themeOpt1: '海边漫步',
        themeOpt2: '城市夜色',
        themeOpt3: '山间清晨',
        themeConfirmed: '好的，就用「{theme}」作为这一章的主题',
        storyStart: '现在我们来聊聊这一章的故事吧——那天发生了什么？和谁一起？当时的心情是怎样的？',
        newChapterMeta: '新章节 · {n} 张照片',
        newChapterNarrative: '这一章的故事还没写。和右侧的 Yujee AI 聊聊那天的细节，我就把它写成文字。',
        ch1TitleBook: '海边时光',
        ch1Meta: '2024.04.06 · 厦门 · 6 张照片',
        ch1Narrative: '那天的<span class="hl">风很轻</span>，沙子是温热的。我们沿着环岛路一直走，海浪一遍又一遍地把脚印抹平，又一遍又一遍地让我们重新走过。你说想看一次完整的潮起潮落，于是我们坐了整个下午，看远处的船像一只被慢慢拉远的风筝。后来才知道，<span class="hl">那种叫不出名字的安静</span>，就是旅行最珍贵的部分。',
        ch1PhotoCap: '环岛路 · 上午十点',
        ch1PageNum: '02 · 海边时光',
        ch1Footer: '厦门 · 鼓浪屿',
        ch1CtxTag: '第 1 章',
        ch2TitleBook: '古街探味',
        ch2Meta: '2024.04.07 · 中山路 · 7 张照片',
        ch2Narrative: '老巷子里有<span class="hl">沙茶面的烟火气</span>，墙根贴着早褪色的招牌。卖花生汤的阿姨说，她在这条街做了三十二年了，她记得每一个常客的口味。我们点了一碗最老派的，她笑着多舀了一勺。<span class="hl">所谓人情味</span>，大概就是这样的一勺。',
        ch2PhotoCap: '中山路 · 黄昏',
        ch2PageNum: '08 · 古街探味',
        ch2Footer: '厦门 · 中山路',
        ch2CtxTag: '第 2 章',
        ch3TitleBook: '日落归途',
        ch3Meta: '2024.04.08 · 演武大桥 · 4 张照片',
        ch3Narrative: '回程的车上，<span class="hl">夕阳把云烧成橘子味</span>。你靠在窗边睡着了，我没忍心叫你。高铁穿过一段又一段海岸，每一次海面被切开，光就跟着碎一次。我想，这趟旅行最完整的画面，<span class="hl">大概不在相机里</span>，在你睡着时窗外那片橘色里。',
        ch3PhotoCap: '演武大桥 · 17:42',
        ch3PageNum: '14 · 日落归途',
        ch3Footer: '厦门 · 演武大桥',
        ch3CtxTag: '第 3 章',
      },
      en: {
        pageTitle: 'Yujee — Edit Your Album',
        backToProjects: 'Back to projects',
        albumTitle: '2024 Xiamen 3-Day Trip',
        saved: 'Saved',
        undo: 'Undo',
        redo: 'Redo',
        share: 'Share',
        exportPdf: 'Export PDF',
        // WP5.2 / §4.5b: the "you're done" line shown once the export gate opens.
        exportReady: 'Wonderful — your book is ready!',
        // WP5.3 / §4.5d: reassurance modal copy after 3 consecutive export failures.
        // Calm, no blame, no tech detail.
        exportFailTitle: 'Export hit a small snag',
        exportFailBody: "We tried a few times but couldn't generate your PDF — it may be a shaky connection. Your memoir is saved safe and sound. Tapping “Export PDF” again in a moment usually does the trick.",
        exportFailRetry: 'Try again',
        exportFailClose: 'Got it',
        alertUndo: 'Undo last action',
        alertRedo: 'Redo undone action',
        alertLinkCopied: 'Link copied to clipboard!',
        alertExportPdf: 'Exporting PDF...\n\nGenerating high-resolution PDF for "2024 Xiamen 3-Day Trip". It will download automatically when ready.',
        chapters: 'Chapters',
        newChapter: '+ New chapter',
        alertNewChapter: 'New chapter — Enter a chapter title',
        ch1Title: 'By the Sea',
        ch1Desc: '6 photos · beach, sunrise, waves',
        ch2Title: 'Old Town Flavors',
        ch2Desc: '7 photos · alleys, food, lanterns',
        ch3Title: 'Sunset Return',
        ch3Desc: '4 photos · mountain road, sunset, silhouettes',
        prevPage: 'Previous page',
        nextPage: 'Next page',
        zoomOut: 'Zoom out',
        zoomIn: 'Zoom in',
        overview: 'All',
        toggleChapters: 'Collapse / expand chapters',
        fullscreen: 'Fullscreen preview',
        aiAvatarChar: 'Y',
        chatSubtitle: 'Tell me about this memory',
        chatCtxCh1: 'Ch. 1',
        thinkingAnalyzed: 'Analyzed 6 photos and location info',
        aiMsg1: 'I\'ve written the narrative for the "By the Sea" chapter. If you\'d like to share more memories — the weather that day, who you were with, how you felt — I can weave those details into the text.',
        userMsg1: 'Actually it got windy that afternoon and I almost lost my hat — can you add that?',
        thinkingReorg: 'Reorganizing paragraph two, adding wind and hat details',
        aiMsg2: 'Done — I wove that detail into the second paragraph. Take a look:',
        aiQuote1: 'That afternoon the wind picked up suddenly, nearly snatching the hat right off your head. We laughed and chased it a few steps, then sat back down on the sand — the waves erasing our footprints over and over, and over and over we walked them again.',
        chipAccept: 'Accept',
        chipRewrite: 'Rewrite',
        chipEditMyself: 'Edit myself',
        alertAccepted: 'Accepted! The copy has been updated in the magazine preview.',
        alertRewrite: 'OK, let me rewrite a new version...',
        alertEditMyself: 'You can now edit the text above directly',
        userMsg2: 'Great. Can you come up with a more poetic chapter title?',
        thinkingChapterName: 'Brainstorming chapter names',
        aiMsg3: 'Here are some options — pick one or tell me what feels right:',
        chipName1: 'Waves Thinning Time',
        chipName2: 'Wind from the Sea',
        chipName3: 'A Salty Afternoon',
        chipName4: 'The Hat That Almost Flew Away',
        alertChapterUpdated: 'Chapter title updated to "',
        inputPlaceholder: 'Type a message...',
        send: 'Send',
        thinking: 'Thinking',
        analyzedFeedback: 'Analyzed your feedback',
        aiReplyDefault: 'Got it, let me rewrite a new version for you...',
        awaitUser: "I'm listening — talk to me anytime",
        justNow: 'Just now',
        thinkingComplete: 'Brainstormed 4 chapter name ideas',
        railChapters: 'Chapters',
        addChapter: 'New chapter',
        addPhoto: 'Add photos',
        detailChapters: 'Chapter details',
        balLow: 'Balance running low',
        balDesc: 'Not enough balance to generate a new chapter — top up to keep creating',
        balRecharge: 'Top up',
        bpLead: 'Oops, you\'re running low on credits. Add a few more to keep creating your album.',
        bpTitle: 'Buy credits',
        bpSub: '<b>1 credit</b> covers one batch of photos',
        bpBuy: 'Buy credits',
        editingNow: 'Editing',
        chapterWord: 'Ch.',
        photosWord: 'photos',
        viewChapter: 'View chapter',
        viewLayout: 'View layout',
        justEdited: 'Just edited',
        nowEditing: 'Editing',
        chaptersLabel: 'Chapters',
        collapseChapters: 'Collapse chapters',
        chatPanel: 'Chat',
        collapseChat: 'Collapse',
        expandChat: 'Chat',
        modalTitle: 'Select photos',
        modalSub: 'Pick the photos for this chapter — AI will lay them out and write the story.',
        modalUpload: 'Upload',
        modalSelected: 'Selected',
        modalCancel: 'Cancel',
        modalCreate: 'Create chapter',
        alertUploadStub: 'Upload — choose local images (demo placeholder)',
        stateLoading: 'Loading',
        stateTheme: 'Theme',
        stateStory: 'Story',
        loadingNewChapter: 'Creating new chapter…',
        themeThinking: 'Analyzed the scenes and mood across these {n} photos',
        themeAsk: 'I see a few possible themes in these photos — which one would you like?',
        themeOpt1: 'Seaside Walk',
        themeOpt2: 'City Nights',
        themeOpt3: 'Mountain Morning',
        themeConfirmed: 'Great — using "{theme}" as this chapter\'s theme',
        storyStart: 'Now let\'s talk about this chapter\'s story — what happened that day? Who were you with? How did it feel?',
        newChapterMeta: 'New chapter · {n} photos',
        newChapterNarrative: 'This chapter\'s story isn\'t written yet. Tell Yujee AI on the right about that day, and I\'ll turn it into words.',
        ch1TitleBook: 'By the Sea',
        ch1Meta: '2024.04.06 · Xiamen · 6 photos',
        ch1Narrative: 'The <span class="hl">breeze was gentle</span> that day, the sand warm underfoot. We walked along the coastal road as waves erased our footprints over and over, and over and over we walked them again. You said you wanted to watch a full tide come and go, so we sat the whole afternoon, watching the boats in the distance drift like kites slowly pulled away. Only later did we realize that <span class="hl">the nameless quiet</span> was the most precious part of any journey.',
        ch1PhotoCap: 'Coastal Road · 10 AM',
        ch1PageNum: '02 · By the Sea',
        ch1Footer: 'Xiamen · Gulangyu',
        ch1CtxTag: 'Ch. 1',
        ch2TitleBook: 'Old Town Flavors',
        ch2Meta: '2024.04.07 · Zhongshan Rd · 7 photos',
        ch2Narrative: 'The old alleys smelled of <span class="hl">satay noodle smoke</span>, faded signs clinging to the walls. The peanut-soup auntie said she\'d been on this street for thirty-two years; she remembered every regular\'s taste. We ordered the most old-school bowl, and she smiled, ladling an extra scoop. <span class="hl">The flavor of kindness</span> — that\'s roughly what one extra scoop tastes like.',
        ch2PhotoCap: 'Zhongshan Rd · Dusk',
        ch2PageNum: '08 · Old Town Flavors',
        ch2Footer: 'Xiamen · Zhongshan Rd',
        ch2CtxTag: 'Ch. 2',
        ch3TitleBook: 'Sunset Return',
        ch3Meta: '2024.04.08 · Yanwu Bridge · 4 photos',
        ch3Narrative: 'On the ride back, the <span class="hl">sunset burned the clouds tangerine</span>. You fell asleep against the window; I didn\'t have the heart to wake you. The high-speed train cut through stretch after stretch of coast, and every time the sea was sliced open, the light shattered with it. I think the most complete picture from this trip <span class="hl">isn\'t in any camera</span> — it\'s in that tangerine glow outside the window while you slept.',
        ch3PhotoCap: 'Yanwu Bridge · 17:42',
        ch3PageNum: '14 · Sunset Return',
        ch3Footer: 'Xiamen · Yanwu Bridge',
        ch3CtxTag: 'Ch. 3',
      },
    };

    let currentLang = locale === 'zh' ? 'zh' : 'en';
    const t = (key: string) =>
      (i18n[currentLang] && i18n[currentLang][key]) || i18n.zh[key] || key;

    // expose alert hooks (original uses inline onclick="alert(t('...'))")
    (root as unknown as { __t: (k: string) => string }).__t = t;

    /* ─── Real pages → spreads (cover alone on the right-hand page) ─── */
    const albumId = detail.album.id;

    /* ─── Authoring (draft) chat state (#162: render-first + pointed single-page
       edits). Empty in editing mode; in authoring mode each message routes through
       /draft-edit scoped to the focused page (no theme→chapter dialog machine). ─── */
    const isAuthoring = mode === 'authoring';
    const MESSAGE_MAX = 500; // v2 draft-edit body schema caps free text at 500.
    // ② 章节故事 chat history (缺口#20). The chapter-chat endpoint is stateless and
    // does NOT persist messages, so the browser holds the running turn log in-session
    // and replays it on each turn (contract caps it at 20 turns). Trimmed to the most
    // recent turns before each send.
    const CHAT_HISTORY_MAX = 20;
    const chapterHistory: V3ChatTurn[] = [];
    const coverHistory: V3ChatTurn[] = [];
    let lastCoverSelection: CoverInput = {};
    // §4.2「AI 先开口提问,不擅自动笔」(引导优先). Track which chapters have already had
    // their auto-guide opener fired this session so re-renders / chapter hops don't
    // double-prompt. A chapter is "guided" once its opening引导 turn has been sent.
    // #236 ①: shared across StrictMode re-invocations (the set lives on a component ref).
    const guidedChapters = guidedChaptersRef.current;
    // In-flight openers keyed by chapterId: guidedChapters is added synchronously before
    // the await, but the in-flight set makes the dedupe intent explicit and also blocks a
    // second concurrent opener for the same chapter on the advance path.
    const openerInFlight = new Set<string>();
    // §4.2 满意/不满意: true between the AI finishing a write turn and the user choosing
    // 满意/不满意. While awaiting the choice we don't fire another auto-guide opener
    // (the satisfaction card is the live affordance).
    let awaitingSatisfaction = false;
    let storyGate: StoryProgress | null = storyProgress;
    // The effect is installed once; storyGate is refreshed by the authoring progress calls.
    function isAuthoringExportLocked(progress: StoryProgress | null = storyGate) {
      if (!isAuthoring) return false;
      if (!progress) return true;
      if (progress.chapterOrder.length === 0) return false;
      return !computeExportUnlocked(progress.stage, progress.allDone);
    }
    let confirmingStoryChapter = false;
    // ③④ theme/cover (缺口#20). The last /v3/recommend response (theme candidates +
    // per-chapter recommended {accentColor, artFont}) is held in-session so the apply
    // step can send the user's pick back; the browser never holds the authoring tree
    // (invariant 12) — recommend re-derives the overview server-side from draft_json.
    let lastRecommend: V3RecommendResponse | null = null;
    // The draft skeleton (read-only render projection; invariant 12). Rendered on
    // entry; the agent persists draft_json server-side, so we don't refetch it.
    const draftSkel: DraftSkeleton | null = draftChapters;
    const aT = (zh: string, en: string) => (currentLang === 'zh' ? zh : en);
    // Mutable working copy: chat and inline edits patch this in place and repaint
    // without remounting the effect. Sourced from detail.pages (editing) or the
    // draft skeleton (authoring) — both are EditorPage-shaped.
    let pagesState: EditorPage[] = initialPages.map((p) => ({
      ...p,
      imagesJson: { ...p.imagesJson },
      textsJson: { ...p.textsJson },
      imagePosJson: { ...(p.imagePosJson ?? {}) },
    }));
    const total = initialPages.length;
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
    function faceInner(page: EditorPage | null): string {
      if (!page) return '';
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
      if (pageInd) pageInd.textContent = (i + 1) + ' / ' + spreadCount();
      if (ctxBadge) ctxBadge.textContent = spreadLabel(i);
      // Rail items key off their target spread (data-ch), which for AI chapters is
      // a non-contiguous spread index — compare by that, not by list position.
      $$('.chapter').forEach((el) => el.classList.toggle('active', +el.getAttribute('data-ch')! === i));
      $$('.m-chapter-chip').forEach((el) => el.classList.toggle('active', +el.getAttribute('data-ch')! === i));
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

      const mbar = byId('mobileChapterBar');
      if (mbar) {
        mbar.innerHTML = items
          .map(
            (it) =>
              `<button class="m-chapter-chip${it.idx === currentCh ? ' active' : ''}" data-ch="${it.idx}">${esc(it.label)}</button>`,
          )
          .join('');
        mbar.querySelectorAll('.m-chapter-chip').forEach((el) => {
          el.addEventListener('click', () => {
            const i = +el.getAttribute('data-ch')!;
            if (i !== currentCh) flipTo(i, i > currentCh ? 'next' : 'prev');
          });
        });
      }
    }

    const openDetail = () => bodyEl.classList.add('detail-open');
    const closeDetail = () => bodyEl.classList.remove('detail-open');
    const toggleChat = () => bodyEl.classList.toggle('chat-collapsed');
    const toggleRail = () => bodyEl.classList.toggle('rail-collapsed');

    /* ─── Thumbnail strip ─── */
    // Build the bottom thumbnail strip from real spreads (replaces the design's
    // three hardcoded placeholder thumbs).
    function buildThumbs() {
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
      const pageIdx = draftSkel?.pages.find((p) => p.chapterId === chapterId)?.pageIndex;
      if (pageIdx == null) return;
      const sp = spreadIndexOfPage(spreads, pageIdx);
      if (sp < 0) return;
      goToSpread(sp);
    }

    /* ─── Zoom + overview ─── */
    let zoom = 1;
    // ZMIN is the visible lower bound: zooming out clamps the book here (the
    // spread stays scaled + visible). Overview is reachable *only* via ovBtn,
    // never by crossing the zoom floor (issue #157).
    const ZMIN = 0.25, ZMAX = 2, ZSTEP = 0.25;
    function applyZoom() {
      const bk = byId('book');
      if (bk) bk.style.transform = 'scale(' + zoom + ')';
      const p = byId('zoomPct');
      if (p) p.textContent = Math.round(zoom * 100) + '%';
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
      zoom = 1; applyZoom();
    }
    function renderOverview() {
      const g = byId('ovGrid');
      if (!g) return;
      g.innerHTML = Array.from({ length: spreadCount() }, (_, i) => {
        const [lp, rp] = spreadPages(i);
        // #158 follow-up: drop the ov-book surface fill + spine for a solo spread so
        // the empty half reads as empty space, not a white page.
        const solo = lp === null || rp === null;
        return `<div class="ov-spread${i === currentCh ? ' ov-current' : ''}" data-ovidx="${i}">
          <div class="ov-book${solo ? ' ov-solo' : ''}"><div class="ov-page ov-left${lp === null ? ' ov-empty' : ''}" data-oface="${i}-l"></div><div class="ov-page ov-right${rp === null ? ' ov-empty' : ''}" data-oface="${i}-r"></div></div>
          <div class="ov-cap">${spreadLabel(i)}</div>
        </div>`;
      }).join('');
      for (let i = 0; i < spreadCount(); i++) {
        const [lp, rp] = spreadPages(i);
        paintEl(g.querySelector(`[data-oface="${i}-l"]`) as HTMLElement | null, lp);
        paintEl(g.querySelector(`[data-oface="${i}-r"]`) as HTMLElement | null, rp);
      }
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
      zoom = 1; applyZoom();
    }
    function toggleOverview() {
      bodyEl.classList.contains('overview-on') ? exitOverview() : enterOverview();
    }
    function openSpreadFromOverview(i: number) {
      exitOverview();
      if (i !== currentCh) flipTo(i, i > currentCh ? 'next' : 'prev');
    }
    const stage = $('.book-stage');
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? ZSTEP : -ZSTEP); }
    };
    stage?.addEventListener('wheel', onWheel, { passive: false });

    /* ─── Conversation states ─── */
    function setChatState(n: number) {
      $$('#stateStepper .state-pill').forEach((p) => {
        const s = +p.getAttribute('data-state')!;
        p.classList.toggle('done', s < n);
        p.classList.toggle('active', s === n);
      });
    }
    function scrollChat() { const b = byId('chatBody'); if (b) b.scrollTop = b.scrollHeight; }

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

    /* ─── Chat send ─── */
    const chatBody = byId('chatBody');
    const input = byId('msgInput') as HTMLTextAreaElement | null;
    const sendBtnEl = byId('sendBtn');
    let sending = false;

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

    /* ─── Authoring chat round-trip (#162: draft-period single-page edit) ───
       Each user message goes to /draft-edit scoped to the focused page; the server
       slices that one page (invariant 12) and answers talk (reply only) or act
       (reply + the page's rewritten copy). No theme/chapter machine, no cursor. */
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
    // A past user message (history replay) — same bubble as a live send().
    function appendUserText(text: string) {
      const u = document.createElement('div');
      u.className = 'msg user max-w-full';
      u.innerHTML = `<div class="bubble"></div>`;
      u.querySelector('.bubble')!.textContent = text;
      chatBody!.appendChild(u);
    }
    // Load + render persisted chat history (album_messages) on entry so reopening
    // the album shows the prior conversation, not just the opener. Returns how many
    // turns were rendered. Skips the internal inspect-diagnosis strings the #165
    // loop threads to the model (they are not real user chat).
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
        for (const m of msgs) {
          const c = (m.content ?? '').trim();
          if (!c || c.startsWith('[inspection of page')) continue;
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
    // A fresh AI message shell with an active "thinking" block — the caller fills
    // in the reply (and chips) once the round-trip resolves. Mirrors the design's
    // jellyfish-loop thinking spinner.
    // A compact, muted status line that exposes what the AI is doing during the
    // inspect→adjust loop (#165) — screenshotting, what it diagnosed, adjusting —
    // so the process isn't a black box to the user.
    function appendStep(text: string) {
      const d = document.createElement('div');
      d.className = 'ep-step';
      d.textContent = text;
      chatBody!.appendChild(d);
      scrollChat();
    }
    function appendThinkingShell(): HTMLElement {
      // Thinking ⇔ idle-jellyfish are mutually exclusive: the moment a thinking block
      // goes active, the resting「水母浮动」float must be gone. Every thinking entry funnels
      // through here, so hiding the await float here covers ALL paths (chat turn, opener,
      // recommend/apply-theme/cover, advance) without each call site re-pairing hideAwait().
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
      // §4.2: only the export-lock UI is gate-driven now — the「确定本章」button is gone
      // (confirmation lives in the in-flow satisfaction card). Keep the export PDF gate.
      const exportBtn = $('[data-action="exportPdf"]') as HTMLButtonElement | null;
      if (exportBtn && isAuthoring) {
        const locked = isAuthoringExportLocked(progress);
        exportBtn.disabled = locked;
        exportBtn.classList.toggle('is-disabled', locked);
        exportBtn.setAttribute('aria-disabled', locked ? 'true' : 'false');
      }
    }

    // #236 ⑦⑧ 收尾卡片: the wrap-up line ("Wonderful — your book is ready!") + a 导出 entry,
    // appended as小水母's LAST ai message at the bottom of the thread (not a pinned banner).
    // Shown exactly once (exportReadyCardShown) so re-running the story-gate refresh /
    // mirrorStage doesn't spam it. The 导出 button reuses the existing exportPdf() path
    // (computeExportUnlocked gate + runExportWithRetry).
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
      btn.addEventListener('click', () => { void exportPdf(); });
      inner.appendChild(line);
      inner.appendChild(btn);
      card.appendChild(inner);
      chatBody!.appendChild(card);
      // Keep the idle await-jellyfish below the closing card so it stays the last node.
      restAwait();
      scrollChat();
    }
    // #236 ⑦⑧: append the closing card only when the export gate is actually open. Called
    // from the mount tail (entry into an already-unlocked album — after history rendered,
    // so it lands last) and from mirrorStage (the live cover→ready transition). One-shot.
    function maybeAppendExportReadyCard() {
      // 导出模块只在整本完成(封面环节走完 → stage=ready)后才出现在对话框,不在主题/
      // 封面阶段弹出,以免干扰用户继续选封面等后续操作。网页右上角导出按钮的解锁口径
      // (exportUnlocked / computeExportUnlocked,主题后即可用)不受此影响。
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
        // A fresh per-chapter context: clear the running log AND the awaiting flag so
        // the new chapter opens clean (its own引导 opener, not the old chapter's gate).
        chapterHistory.length = 0;
        awaitingSatisfaction = false;
        goToChapterById(advancedTo!);
      }
      maybeAppendExportReadyCard();
      if (advanced && storyGate.stage !== 'theme') {
        void runChapterGuideOpener();
      }
      if (storyGate.stage === 'theme') {
        confirmingStoryChapter = false;
        setStoryConfirming(false);
        await runRecommendTheme();
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
    // §4.2: confirmCurrentChapterViaEditChat is invoked directly from the in-flow
    // satisfaction card — no DOM-button ref/publish needed.

    // ── ③④ theme/cover drivers (缺口#20) ──────────────────────────────────────
    // These fold a returned page-level patch into pagesState the SAME way the chapter
    // edit-turn does (applyPatchToPages → rebuildSpreads → repaintBook). The browser
    // sends only its SELECTIONS; the Web service re-slices draft_json server-side
    // (invariant 12) and is the sole truth source for stage. When the server reports a
    // new stage we mirror it into storyGate so the breadcrumb advances live.
    function applyAuthoringPatch(patch: BrowserLayoutPatchEntry[]): boolean {
      if (patch.length === 0) return false;
      // BrowserLayoutPatchEntry is shape-compatible with LayoutPatchEntry
      // (pageIndex + templateId?/imagesJson?/textsJson?).
      pagesState = applyPatchToPages(pagesState, patch as LayoutPatchEntry[]);
      rebuildSpreads();
      repaintBook();
      return true;
    }
    function mirrorStage(stage: string) {
      if (!storyGate || storyGate.stage === stage) return;
      storyGate = { ...storyGate, stage };
      setStoryProgress(storyGate);
      updateStoryGateUi(storyGate);
      // #236 ⑦⑧: cover→ready (or any stage that opens the gate) surfaces the closing card.
      maybeAppendExportReadyCard();
    }

    // ③ 主题/章节色 · 推荐: ask /v3/recommend for theme candidates + per-chapter色/字体.
    // Stores the response so the apply step can send the user's pick back. Display only —
    // nothing is written until apply-theme. The reply is followed by the palette-card
    // (设计稿 palette-card): the user picks ONE theme option, then apply-theme writes it
    // along with the recommended per-chapter {accentColor, artFont}. The 自动套第一候选
    // fallback is gone — apply only fires from a user pick on the card.
    async function runRecommendTheme(userMessage?: string) {
      if (!isAuthoring || sending) return;
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
        if (authErr(host, e)) { sending = false; return; }
      }
      sending = false;
      restAwait();
      scrollChat();
    }

    // ─── palette-card (设计稿 palette-card,对话流内) ────────────────────────────
    // Stage4 returns exactly three book theme options. The user picks one option; Web
    // expands that option into per-chapter apply-theme choices using the option's single
    // artFont plus each chapter's accentColor/subject.
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

    // ─── 只读回放卡 (fix: restore chat decision cards) ──────────────────────────
    // The theme/cover decision cards are session-only DOM and are never persisted
    // (album_messages is text-only), so loadHistory can't rebuild them. These helpers
    // re-derive a read-only recap from draftSkel/pagesState for stages already passed.
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
          opt.innerHTML = coverOptionHTML(page.templateId, heroPhoto);
          sec.appendChild(label);
          sec.appendChild(opt);
          inner.appendChild(sec);
        }
      }
      card.appendChild(inner);
      chatBody!.appendChild(card);
    }

    // ③ 主题/章节色 · 应用: send the per-chapter {subject, accentColor, artFont} to
    // /v3/apply-theme, fold the returned patch into the canvas, advance stage theme→cover.
    // A provided subject can be persisted as its chapter title (#236). Driven only by a user
    // click on the palette-card「应用」— there is NO "auto-apply" fallback (缺口#20). If called with no
    // selection (e.g. no recommendation yet), we fetch a recommendation so the user gets the
    // card, and apply nothing.
    async function runApplyTheme(selection?: { chapters: V3ChapterThemeChoice[] }) {
      if (!isAuthoring || sending) return;
      const chapters = selection?.chapters;
      if (!chapters || chapters.length === 0) {
        // No user pick to apply — surface the picker instead of silently applying a default.
        await runRecommendTheme();
        return;
      }
      sending = true;
      const host = appendThinkingShell();
      try {
        const res = await postApplyTheme(albumId, { chapters });
        settleThinking(host, 'analyzedFeedback');
        applyAuthoringPatch(res.layoutPatch);
        mirrorStage(res.stage);
        appendReplyBody(
          host,
          res.assistantReply ??
            aT('已应用主题色与字体。', 'Applied the theme colors and fonts.'),
        );
        appendTime(host);
        // ④ 书籍设计: apply-theme advances stage theme → cover. Surface the cover-card so
        // the user picks/keeps 封面/封底 (or 跳过) right after the theme lands (缺口#20).
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

    // ④ 书籍设计 — 封面/封尾: send the chosen 封面/封尾 template ids (null/absent = 跳过) to
    // /v3/cover, fold the returned patch into the canvas, advance stage cover→ready. Skip
    // (no selection) returns an empty patch and never errors (§4.4 封面可跳过).
    async function runCover(input?: CoverInput) {
      if (!isAuthoring || sending) return;
      sending = true;
      const host = appendThinkingShell();
      try {
        const payload: CoverInput = { ...(input ?? {}) };
        if (payload.coverPhoto === undefined && payload.coverPhotoId) {
          const thumb = await capturePhotoThumb(payload.coverPhotoId);
          if (thumb) payload.coverPhoto = thumb;
        }
        if (payload.endingPhoto === undefined && payload.endingPhotoId) {
          const thumb = await capturePhotoThumb(payload.endingPhotoId);
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
        const applied = applyAuthoringPatch(res.layoutPatch);
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

    // ─── cover-card (封面/封底选择,对话流内,缺口#20 + 封面选择缺口) ──────────────
    // ④ 书籍设计: the user picks/keeps/swaps 封面 + 封底. analyze now seeds a real
    // category=cover page (first photo) + category=ending page (last photo) into the draft
    // skeleton, so this card always resolves them by KIND. For EACH of 封面/封底 we offer:
    //   • the system TEMPLATE candidates of that category (cover: mag-01/mag-13/p01; ending:
    //     mag-20), each previewed through its REAL web template (the same render path the
    //     book uses), the current one pre-selected;
    //   • a PHOTO strip (the book's photos) so the user can change which photo is the hero.
    // Picking 应用 forwards the chosen {coverTemplateId, endingTemplateId} (contract) plus the
    // WEB-ONLY {coverPhotoId, endingPhotoId} (the Web service swaps the photo into the page
    // before the deterministic /v3/cover auto-fill; the Agent contract is untouched). 跳过
    // sends an empty selection → empty patch, never errors (§4.4 封面可跳过). Everything stays
    // page-level + invariant 12: the browser holds no tree; the service re-slices draft_json.

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
    function appendCoverCard() {
      // Resolve the 封面/封底 pages by their skeleton KIND, keyed on pageIndex so a folded
      // apply-theme/cover patch (which patches by pageIndex, not array position) can't
      // misalign the lookup. draftSkel is the read-only render projection (invariant 12).
      const kindByPageIndex = new Map<number, DraftPageKind>();
      for (const p of draftSkel?.pages ?? []) kindByPageIndex.set(p.pageIndex, p.kind);
      const coverPage = pagesState.find((p) => kindByPageIndex.get(p.pageIndex) === 'cover') ?? null;
      const endingPage = pagesState.find((p) => kindByPageIndex.get(p.pageIndex) === 'ending') ?? null;
      const coverTemplateId = coverPage?.templateId ?? null;
      const endingTemplateId = endingPage?.templateId ?? null;
      // #236 ⑥: the root cause of "应用 → 已跳过" was a null lookup: when neither a cover nor
      // an ending page exists in the skeleton (legacy drafts created before analyze seeded
      // them), both ids are null, so "应用" sent {coverTemplateId:null, endingTemplateId:null}
      // — which the agent reads as 跳过 (§4.4 跳过=空) and returns an empty patch labelled
      // "已跳过". There is genuinely nothing to apply here, so don't offer a misleading apply
      // button: auto-advance through cover (empty selection), exactly as an explicit 跳过.
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

      // One live-editable section (封面 OR 封底): a template-candidate row + a photo-pick row,
      // both re-rendering the selected option preview. Returns a getter for the current pick.
      const section = (
        labelZh: string,
        labelEn: string,
        category: 'cover' | 'ending',
        page: EditorPage | null,
      ): (() => { templateId: string | null; photoId: string | null }) => {
        const candidateIds = templateIdsByCategory(category);
        // Current selection seeds: the page's template + its hero photo (analyze put the
        // book's first/last photo there). Fall back to the first candidate / first photo.
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

        // Template-candidate row: one .cv-opt per category template, previewed live.
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

        // Photo-pick row: small thumbs of the book's photos; click sets the hero photo.
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
            const url = imageUrls[pid];
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

      // Only offer a section when that page exists (skeleton has cover/ending); legacy
      // drafts may have one but not the other.
      const getCover = coverPage
        ? section('封面', 'Cover', 'cover', coverPage)
        : () => ({ templateId: null as string | null, photoId: null as string | null });
      const getEnding = endingPage
        ? section('封底', 'Back cover', 'ending', endingPage)
        : () => ({ templateId: null as string | null, photoId: null as string | null });

      // Actions: 应用 (forward the chosen templates + photos) / 跳过 (empty patch).
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
        // #236 ⑥: send only the ids that actually resolved. A null id reads as 跳过 agent
        // -side, so passing null would turn an "应用" into a silent skip. Apply ONLY when at
        // least one template resolved (the both-null case auto-skipped above); forward the
        // chosen non-null template ids + their picked hero photos.
        const coverTemplateId = cover.templateId;
        const endingTemplateId = ending.templateId;
        const hasSelection = coverTemplateId != null || endingTemplateId != null;
        if (!hasSelection) {
          void runCover({});
          return;
        }
        // 点完「应用」即置为已应用态,按钮不再可点(同 palette-card 的 pc-apply 行为)。
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
        }); // empty selection → empty patch, never errors (§4.4)
      });
      actionsRow.appendChild(skipBtn);
      actionsRow.appendChild(applyBtn);
      inner.appendChild(actionsRow);

      card.appendChild(inner);
      chatBody!.appendChild(card);
      scrollChat();
    }

    // #162 draft-edit turn: the draft-period chat is a pointed single-page edit,
    // talk/act physically split (no theme→chapter machine, no auto-advance). The
    // message goes to /draft-edit scoped to the page the user is looking at
    // (selectedPageIndex, else the first page of the current spread). On 'act' we
    // merge the returned pageWrite into that page locally + repaint; on 'talk' we
    // just append the reply. The agent already persisted the draft server-side.
    function draftFocusPageIndex(): number {
      if (selectedPageIndex != null) return selectedPageIndex;
      // No explicit selection → focus the first real page on the current spread
      // (left, else right). Cover sits alone on spread 0's right slot.
      const [lp, rp] = spreadPages(currentCh);
      return (lp ?? rp)?.pageIndex ?? 0;
    }
    // Apply a kind:'act' write locally (the server already persisted it into
    // draft_json — both pageWrite copy edits and imagePosWrite position/scale moves
    // land in draft_json server-side; the browser only mirrors + repaints so a
    // reload re-reads the same draft). Returns true if anything was applied.
    function applyDraftAct(r: DraftEditResult): boolean {
      if (r.pageWrite) {
        const page = pageByIndex(r.pageWrite.pageIndex);
        if (page) {
          page.textsJson = { ...page.textsJson, ...r.pageWrite.texts };
          repaintBook();
          appendStep(aT('✏️ 已更新这页文案。', '✏️ Updated this page’s copy.'));
          return true;
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
          appendStep(
            aT(
              `🎯 已调整图片位置：横向 ${w.x}%、纵向 ${w.y}%、缩放 ${w.scale}×。`,
              `🎯 Adjusted the photo: x ${w.x}%, y ${w.y}%, zoom ${w.scale}×.`,
            ),
          );
          return true;
        }
      }
      return false;
    }

    // #162/#165 draft-edit turn — an inspect→adjust orchestration loop. The control
    // flow (inspect loop, 3-round cap, graceful degradations) lives in the pure,
    // unit-tested runInspectAdjustLoop; here we only wire the deps and apply the
    // terminal result (repaint + reply). On a kind:'inspect' the loop screenshots
    // the page → /inspect-render → threads the diagnosis back into the next
    // /draft-edit so the model calls adjust_image_position; the follow-up act
    // (imagePosWrite) then applies as a normal act.
    async function runDraftEditTurn(message: string) {
      const host = appendThinkingShell();
      const focusIndex = draftFocusPageIndex();
      // Mark auth errors so the orchestrator rethrows them (it degrades only the
      // inspect-render path to talk — it must not swallow a login redirect).
      const markAuth = (e: unknown): never => {
        if (e instanceof UnauthorizedError) (e as unknown as { isAuthError: boolean }).isAuthError = true;
        throw e;
      };
      try {
        const r = await runInspectAdjustLoop(focusIndex, message, {
          postDraftEdit: (pi, msg) => postDraftEdit(albumId, pi, msg).catch(markAuth),
          capturePageRender,
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
          // Show the multi-second vision round as a live "thinking" state again.
          onVisionRound: () => {
            settleThinking(host, 'thinking');
            host.querySelector('.thinking-block')?.classList.add('active');
          },
          // Expose each step to the user: what page it's looking at, what the
          // vision model diagnosed, and when it hits the inspection cap.
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
        repaintBook();
        appendStep(aT('✏️ 已为本章写好文案。', '✏️ Wrote this chapter’s copy.'));
      }
      return applied;
    }

    // edit: fold the agent's deterministic page patch into pagesState via the same
    // applyPatchToPages used by the finalized editor (text / image-slot / template).
    function applyChapterEdit(layoutPatch: LayoutPatchEntry[]): boolean {
      if (layoutPatch.length === 0) return false;
      pagesState = applyPatchToPages(pagesState, layoutPatch);
      rebuildSpreads();
      repaintBook();
      appendStep(aT('🛠️ 已更新这一页的排版。', '🛠️ Updated this page’s layout.'));
      return true;
    }

    // Send one edit-chat message and apply the returned commit bundle. `message` is
    // the user's text. Returns nothing; UI side effects only.
    async function runEditChatTurn(message: string) {
      const host = appendThinkingShell();
      const chapterId = storyGate?.currentChapterId ?? null;
      if (!chapterId) {
        // No live chapter (all chapters confirmed) — nothing to author. Degrade to a
        // calm reply rather than POSTing an invalid (chapter-less) turn.
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
        const res = await postEditChat(albumId, {
          language: currentLang === 'zh' ? 'zh' : 'en',
          chapterId,
          userMessage,
          ...(Object.keys(pagePhotoRefs).length > 0 ? { pagePhotoRefs: pagePhotoRefs } : {}),
          // ③ 改页: when a page is selected, "change this / this page" targets it.
          ...(selectedPageIndex != null ? { focusedPageIndex: selectedPageIndex } : {}),
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
        appendTime(host);
        // Record the turn for the next round's history (user + assistant).
        chapterHistory.push({ role: 'user', content: userMessage });
        chapterHistory.push({ role: 'assistant', content: res.assistantReply });
        if (res.progressDecision?.chapterDone) {
          await applyEditChatProgressDecision(chapterId);
        }
        // §4.2 满意/不满意: the moment the AI finishes WRITING this chapter, offer the
        // satisfaction choice in the flow. 满意→edit-chat progressDecision→下一章/主题;
        // 不满意→留本章逐页调整. Not on talk/edit turns — only a fresh full-chapter write opens the gate.
        // talk turns no longer surface a write-now button: the agent decides on its own
        // when enough has been said and dispatches kind=write (handler.py 红线已撤). The
        // satisfaction card after a write is the only standing affordance.
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

    // 问题③ 章节卡片: which chapter are we in? Resolve a chapter's display title +
    // its 1-based number from the draft skeleton (subject once the theme stage wrote it,
    // else the generic「Chapter N」label).
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
      const photoIds = [
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
          const thumb = await capturePhotoThumb(photoId);
          if (thumb) refs[photoId] = thumb;
        }),
      );
      return refs;
    }

    // 问题③ 章节卡片: when entering a chapter, push a chapter-styled card into the chat so
    // the user always knows WHICH chapter they're in (前面引导开场之前/同时出现). Fires once
    // per chapter per session (`shownChapterCards` guard) so re-entry/advance doesn't spam.
    const shownChapterCards = new Set<string>();
    function appendChapterCard(chapterId: string) {
      if (shownChapterCards.has(chapterId)) return;
      const meta = chapterMetaById(chapterId);
      if (!meta) return;
      shownChapterCards.add(chapterId);
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'chap-card';
      const thumbs = document.createElement('div');
      thumbs.className = 'cc-thumbs';
      for (const photoId of meta.photoIds.slice(0, 4)) {
        const thumb = document.createElement('div');
        thumb.className = 'cc-thumb';
        const url = imageUrls[photoId];
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
      view.innerHTML = `${t('viewLayout')}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
      view.addEventListener('click', () => {
        goToChapterById(chapterId);
        const book = byId('book');
        if (book) {
          book.classList.remove('book-flash');
          void book.offsetWidth;
          book.classList.add('book-flash');
        }
      });
      foot.appendChild(info);
      foot.appendChild(view);
      if (thumbs.children.length > 0) inner.appendChild(thumbs);
      inner.appendChild(foot);
      card.appendChild(inner);
      chatBody!.appendChild(card);
      scrollChat();
    }

    // §4.2 引导优先「AI 先开口提问,不擅自动笔」: entering an unfinished chapter, the
    // Agent opens the turn — it asks (引导 Skill 话术: who/what/how/why) instead of
    // waiting for the user. We fire ONE chapter-chat turn with an empty userMessage so
    // the model dispatches kind=talk (引导) and returns a question; Frame 4 红线 keeps it
    // patch-free. Only fires for a LIVE, NOT-yet-done chapter with no prior history this
    // session (a chapter the user already conversed in re-opens to its own log, not a
    // fresh opener). Never auto-writes.
    // A chapter is PHOTO-ONLY when none of its pages carry a writable text slot, so the
    // writer (Agent) has nothing to author — it always returns kind=talk, never kind=write,
    // and the post-write satisfaction card never appears, stranding the user with no way to
    // confirm/advance. "Writable" matches the Agent's own AUTHORED_ROLES (writing/guides.py):
    // title/body/explain are authored; decoration is code-filled (themable) and doesn't count.
    // We read the slots from the SAME template defs the rest of the editor uses (getTemplate),
    // over the chapter's pages in the read-only draft skeleton (invariant 12).
    const AUTHORED_TEXT_ROLES = new Set(['title', 'body', 'explain']);
    function pageHasWritableTextSlot(templateId: string): boolean {
      const texts = getTemplate(templateId)?.texts ?? [];
      if (texts.some((slot) => AUTHORED_TEXT_ROLES.has(slot.role))) return true;
      // items.texts (repeat groups) are authored too — a page with only those is not photo-only.
      const itemTexts = getTemplate(templateId)?.items?.texts ?? [];
      return itemTexts.some((slot) => AUTHORED_TEXT_ROLES.has(slot.role));
    }
    function isPhotoOnlyChapter(chapterId: string): boolean {
      const pages = (draftSkel?.pages ?? []).filter((p) => p.chapterId === chapterId);
      if (pages.length === 0) return false; // unknown shape → don't auto-surface (let the opener run)
      return pages.every((p) => !pageHasWritableTextSlot(p.templateId));
    }

    async function runChapterGuideOpener() {
      if (!isAuthoring || sending || awaitingSatisfaction) return;
      const chapterId = storyGate?.currentChapterId ?? null;
      if (!chapterId) return;
      // Already confirmed chapter, or already opened/conversed this session → skip.
      if (storyGate?.doneChapterIds.includes(chapterId)) return;
      if (guidedChapters.has(chapterId) || openerInFlight.has(chapterId) || chapterHistory.length > 0) return;
      // PHOTO-ONLY chapter: there's nothing to write, so the Agent would only ever talk and
      // the post-write satisfaction card never fires. Skip the (pointless) guide opener and
      // surface the satisfaction/next-chapter card directly so the user can confirm → advance
      // through the satisfaction card's existing confirm path. guidedChapters marks it
      // done-once so re-entry/advance/re-render won't re-append (same dedupe the real opener
      // uses). The card itself (not this branch) is what advances — Frame 4 红线 intact.
      if (isPhotoOnlyChapter(chapterId)) {
        guidedChapters.add(chapterId);
        appendChapterCard(chapterId);
        appendSatisfactionCard({ photoOnly: true });
        return;
      }
      // 问题③: surface the chapter card (which chapter) BEFORE the AI's opener question.
      appendChapterCard(chapterId);
      // #236 ①: mark both guards synchronously, BEFORE any await, so a second same-tick
      // call (mount兜底 + advance, or a StrictMode re-mount) sees them and bails.
      guidedChapters.add(chapterId);
      openerInFlight.add(chapterId);
      // Hold the send lock for the opener round-trip so a user send can't race it onto
      // the same chapter (both would POST). send()/runEditChatTurn already respect it.
      sending = true;
      const host = appendThinkingShell();
      try {
        const res = await postEditChat(albumId, {
          language: currentLang === 'zh' ? 'zh' : 'en',
          chapterId,
          // Empty userMessage = "open the chapter": the model has nothing to write yet,
          // so it dispatches a 引导 (talk) question. contract allows max(500), no min.
          userMessage: '',
        });
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, res.assistantReply);
        appendTime(host);
        // Frame 4 红线: the opener is引导 only. A drifted model that still tried to
        // write/edit is ignored here — the opener never applies a patch nor advances.
        chapterHistory.push({ role: 'user', content: '' });
        chapterHistory.push({ role: 'assistant', content: res.assistantReply });
      } catch (e) {
        // A failed opener shouldn't strand the chapter: let the user type to retry.
        guidedChapters.delete(chapterId);
        if (authErr(host, e)) { sending = false; openerInFlight.delete(chapterId); return; }
      }
      openerInFlight.delete(chapterId);
      sending = false;
      restAwait();
      scrollChat();
    }

    // §4.2 满意/不满意: after the AI writes a chapter (kind=write), surface two buttons in
    // the chat flow — 满意 confirms through edit-chat progressDecision (next chapter /
    // 末章→主题), 不满意 keeps this chapter and asks the user where it falls short, then the
    // existing focusedPageIndex + edit-turn machinery does逐页 adjustment (no stage推进
    // until满意, §8.3 stage 推进权在 Web service). Replaces the old always-on「确定本章」
    // breadcrumb button: confirmation is now a per-write affordance, not a standing CTA.
    function appendSatisfactionCard(opts?: { photoOnly?: boolean }) {
      awaitingSatisfaction = true;
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      const inner = document.createElement('div');
      inner.className = 'satisfaction-card';
      const title = document.createElement('div');
      title.className = 'sc-title';
      // Photo-only chapters have no copy to write, so don't claim we wrote one — just ask
      // if they're ready to move on (the only meaningful action for such a chapter).
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
        // Lock the card so a double-tap can't double-confirm; the next chapter's
        // opener fires after the edit-chat progressDecision updates the projection.
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
        // Stay on this chapter. Ask which page falls short and run逐页 adjustment via
        // the existing focusedPageIndex + edit-turn path (user taps a page, says what
        // to change). This is a引导 (talk) ask — no patch, no stage推进.
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

    // Render the chapter-title candidates (≤4) as picker chips under the reply.
    // Picking one feeds it back as the next chapter-chat message so the model can
    // adopt the chosen title — the browser never writes the tree (§3 数据归属).
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
          // Echo the pick as a user bubble, then run it as a normal edit-chat turn.
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
    // ── Purchase card (积分不足引导卡): on CreditInsufficientError, surface the
    // design's buy-credits card at the bottom of the conversation (it carries its
    // own "去购买" button → /credits) instead of hard-redirecting. ──
    function showPurchaseCard() {
      const card = byId('balanceAlert');
      if (card) {
        card.style.display = '';
        chatBody!.appendChild(card); // float to the end of the thread
      } else {
        appendAiText(aT('积分不足，去充值后即可继续。', 'Out of credits — top up to keep creating.'));
      }
      scrollChat();
    }

    function updateAuthInputPlaceholder() {
      // Input stays blank by design (no prompt text in the box).
      if (!input) return;
      input.setAttribute('placeholder', '');
    }

    // Finalized albums no longer support the legacy synchronous chat-edit path.
    // Keep the chat rail stable, but do not call a retired endpoint or patch layout.
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
      if (isAuthoringExportLocked()) {
        appendAiText(aT('全部章节确定后才能导出 PDF。', 'Confirm all chapters before exporting PDF.'));
        return;
      }
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
    function hideAwait() { const w = byId('awaitUser'); if (w) w.style.display = 'none'; }
    // Show the resting「水母浮动」idle indicator ONLY when the AI is truly idle and waiting
    // for the user to speak. Guard against the two non-idle states that still funnel through
    // restAwait()'s finally-block callers: (a) a thinking block is still active (the round-trip
    // hasn't settled), and (b) we're awaiting a 满意/不满意 card choice (the affordance is the
    // card, not free chat). In either case stay hidden so the float and thinking never coexist.
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

    /* ─── Wire the static onclick handlers transcribed as data-action ─── */
    // ── Mid-edit add-photos (W11): finalized albums only. Compress + store the new
    // photos, POST them, show a processing bubble, poll the add job, then reload to
    // render the appended pages (in-place injection is a future refinement).
    const addPhotoInput = byId('addPhotoInput') as HTMLInputElement | null;
    async function runAddPhotos(files: FileList) {
      if (isAuthoring || sending || !files.length) return;
      sending = true;
      hideAwait();
      const bubble = document.createElement('div');
      bubble.className = 'msg ai max-w-full';
      bubble.innerHTML =
        '<div class="thinking-block active"><img class="think-jelly" src="/jellyfish-loop.png" alt="" />' +
        '<span class="thinking-label"></span><span class="thinking-dots"><span></span><span></span><span></span></span></div>';
      (bubble.querySelector('.thinking-label') as HTMLElement).textContent = aT(
        '正在分析新照片，整合进画册…',
        'Analyzing the new photos and weaving them in…',
      );
      chatBody!.appendChild(bubble);
      scrollChat();
      const fail = (msg: string) => {
        bubble.querySelector('.thinking-block')?.classList.remove('active');
        (bubble.querySelector('.thinking-label') as HTMLElement).textContent = msg;
        sending = false;
        restAwait();
      };
      fail(aT('加图功能正在迁移到新版流程，请先完成当前编辑。', 'Adding photos is being moved to the new flow. Finish the current edit first.'));
    }
    const onAddPhotoChange = () => {
      const files = addPhotoInput?.files;
      if (files && files.length) void runAddPhotos(files);
      if (addPhotoInput) addPhotoInput.value = ''; // allow re-selecting the same file
    };
    addPhotoInput?.addEventListener('change', onAddPhotoChange);

    const actions: Record<string, () => void> = {
      exportPdf,
      toggleUserMenu,
      toggleChat,
      toggleRail,
      openDetail,
      closeDetail,
      toggleOverview,
      resetZoom,
      // §4.2: confirmCurrentChapterViaEditChat has no data-action node — the standing
      // 「确定本章」breadcrumb button was replaced by the in-flow satisfaction card, whose
      // 满意 button confirms through edit-chat (see appendSatisfactionCard).
      // ③④ theme/cover drivers (缺口#20). Wired as data-action entry points.
      //   • recommendTheme → fetch candidates + render the palette-card; the user picks ONE
      //     theme on the card, which fires apply-theme (no auto-apply-first fallback).
      //   • openCoverCard → render the cover-card; the user 应用/跳过 on it drives /v3/cover.
      //   • skipCover → direct skip (cover→ready, empty patch), kept for callers that want
      //     to bypass the picker entirely.
      recommendTheme: () => { void runRecommendTheme(); },
      openCoverCard: () => { appendCoverCard(); },
      skipCover: () => { void runCover({}); },
      openPhotoPicker,
      closePhotoPicker,
      // WP5.3 / §4.5d: 安抚弹框的两个出口。「再试一次」关弹框后重跑导出(重新一轮
      // ≤3 次重试);「知道了」只关弹框。两者都不碰积分。
      closeExportFail: closeExportFailModal,
      retryExportPdf: () => { closeExportFailModal(); void exportPdf(); },
      // The "+" in the input: finalized albums → real add-photos flow; while still
      // authoring there's no finalized layout to append to, so fall back to the
      // (dormant) picker rather than erroring.
      pickAddPhotos: () => (isAuthoring ? openPhotoPicker() : addPhotoInput?.click()),
      uploadStub: () => alert(t('alertUploadStub')),
      confirmNewChapter,
      buyShells: () => { window.location.href = `/${locale}/credits`; },
    };
    const actionHandlers: { el: Element; fn: EventListener }[] = [];
    $$('[data-action]').forEach((el) => {
      const name = el.getAttribute('data-action')!;
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

    /* Chat chips (accept / rewrite / edit-myself) are built per assistant reply
       in renderProposal; the design's demo seed messages are cleared on init.
       Chapter-name suggestion chips need a creation-phase source and are deferred. */

    /* ─── Topbar links → real routes ─── */
    $('.back-btn')?.setAttribute('href', `/${locale}/my-albums`);
    $('.brand')?.setAttribute('href', `/${locale}/my-albums`);

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

    /* ─── Init: clear the design's demo chat, paint the book, load originals ─── */
    chatBody?.querySelectorAll('.msg').forEach((n) => n.remove());
    // The "await" jellyfish is a persistent (non-.msg) node, so clearing the demo
    // strands it at the TOP of the thread. It belongs at the END when idle: editing
    // has no opening turn (idle immediately) → float + show it now; authoring hides
    // it until the opening turn finishes, where restAwait() floats it to the bottom.
    if (isAuthoring) hideAwait();
    else {
      // Editing (post-finalize): render the prior conversation, then sit idle.
      restAwait();
      void loadHistory().then(() => restAwait());
      // Authoring loads the story-gate together with history below (so the auto-guide
      // opener can read the live currentChapterId); editing only needs the gate for
      // the export-lock UI, so fetch it here.
      void loadStoryGate();
    }

    /* ─── Authoring init (#162: render-first + pointed single-page edits) ───
       No theme→chapter dialog machine, no auto-advance, no finalize CTA. init
       (#161) already wrote the full first draft, so we just render it (the book is
       painted from draftSkel below) and open with one system message inviting the
       user to tap any page they want to change. Each message then routes through
       /draft-edit scoped to the focused page (runDraftEditTurn). ─── */
    if (isAuthoring) {
      // The add-photo "+" in the input stays visible during authoring too (its real
      // "append photos to this album" flow is the mid-edit add feature — still WIP
      // server-side; for now it opens the dormant picker like editing does).
      // (Removed) The "完成全书" finish bar + disclaimer used to live above the input
      // here. Per product decision it's gone entirely — no finalize CTA in this
      // surface anymore.
      $('.authoring-finish-bar')?.remove();

      // ③ The fixed self-intro greeting ("我是 Yujee…/Hi, I'm Yujee…") is gone — the
      // user writes their own opening per chapter via chapter-chat, so a canned banner
      // is redundant. The chat opens straight into the rendered draft + the user's own
      // conversation (loaded below).
      // No theme step anymore; the stepper sits on the editing/story pill, and the
      // idle await jellyfish floats to the bottom of the thread.
      setChatState(3);
      updateAuthInputPlaceholder();
      // ④ Render the prior conversation. The old "我已经写好第一版,点开那页跟我说" copy was
      // a V2 leftover (render-first single-page edit flow). V3 authors chapter by chapter
      // through chapter-chat — there is no pre-written "first version" to tap-edit — so the
      // onboarding line is removed; the brand-new-album path now just settles to idle.
      // §4.2 引导优先: once history + story-gate are loaded, if this chapter has no prior
      // conversation and isn't confirmed yet, the Agent OPENS the chapter with a引导
      // question (runChapterGuideOpener) instead of sitting idle waiting for the user.
      void loadStoryGate().then(() => loadHistory()).then((shown) => {
        restAwait();
        // 问题③ 画板定位: once the story gate is loaded, flip the canvas to the chapter
        // we're currently authoring so the preview tracks the live chapter on entry.
        const liveChapterId = storyGate?.currentChapterId ?? null;
        if (liveChapterId) goToChapterById(liveChapterId);
        const stage = storyGate?.stage;
        if (liveChapterId) {
          if (shown === 0) {
            void runChapterGuideOpener();
          } else {
            // Returning to an in-progress chapter (prior conversation): the opener won't
            // re-fire, but still show the chapter card so the user knows where they are.
            appendChapterCard(liveChapterId);
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
        // #236 ⑦⑧: entering an already-export-unlocked album → close the thread with the
        // wrap-up card. Runs after history rendered (Promise.all resolved) so it lands last.
        maybeAppendExportReadyCard();
      });
    }

    // Keep the buy-credits card (#balanceAlert) hidden on entry. The CSS default
    // is display:block, so we must explicitly hide it here. It is surfaced ONLY
    // on demand by showPurchaseCard() when a turn throws CreditInsufficientError —
    // entering the editor must never lead with a "you're out of credits" card
    // (the first chat node is always the greeting + task message).
    const balanceAlert = byId('balanceAlert');
    if (balanceAlert) balanceAlert.style.display = 'none';
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
        const av = $('.user-avatar');
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

    setLang(currentLang); // also runs renderRail + buildThumbs + paintSpread
    // Stepper: editing (finalized album) has no creation flow — hide it. Authoring
    // is driven by the opener block above (theme → 2, story → 3); don't override.
    if (!isAuthoring) {
      const stepperEl = byId('stateStepper');
      if (stepperEl) stepperEl.style.display = 'none';
    }

    if (isAuthoring) {
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

    // Demo-seed safety net (editing only): the seeded chat had a perpetually
    // "active" thinking block. Authoring manages its own thinking lifecycle, so
    // skip this there (it would otherwise stomp an in-flight theme/story call).
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
      document.removeEventListener('click', onDocClick);
      stage?.removeEventListener('wheel', onWheel);
      sendBtnEl?.removeEventListener('click', send);
      input?.removeEventListener('keydown', onKeydown);
      input?.removeEventListener('input', onInput);
      actionHandlers.forEach(({ el, fn }) => el.removeEventListener('click', fn));
      addPhotoInput?.removeEventListener('change', onAddPhotoChange);
      clearTimeout(completeTimer);
      // #168 manual image editor teardown.
      if (wheelCommitTimer) clearTimeout(wheelCommitTimer);
      for (const hostEl of [pageLeft, pageRight]) {
        hostEl.removeEventListener('pointerdown', onImgPointerDown);
        hostEl.removeEventListener('pointermove', onImgPointerMove);
        hostEl.removeEventListener('pointerup', onImgPointerUp);
        hostEl.removeEventListener('wheel', onImgWheel);
      }
      imgEditOverlay?.remove();
    };
  }, []);

  // §4.2: the standing「确定本章」breadcrumb button (and its post-mount click binding)
  // is removed — chapter confirmation is driven from the in-flow satisfaction card
  // (appendSatisfactionCard → confirmCurrentChapterViaEditChat), which lives inside the mount
  // effect and binds its own buttons as it appends them. No DOM-button re-binding
  // effect is needed anymore.

  // ── Static markup: transcription of editor.html <body> (class→className etc.) ──
  return (
    <div
      ref={rootRef}
      className="editor-port font-sans antialiased leading-relaxed"
      data-screen-label="02 Yujee Editor"
    >
      <div className="topbar h-[52px] flex items-center justify-between px-3 sm:px-6 bg-surface border-b border-bdsoft shrink-0">
        <div className="top-left flex items-center gap-2 sm:gap-4 min-w-0">
          <a href="#" className="back-btn flex items-center justify-center w-8 h-8 rounded-pill text-muted no-underline transition-colors hover:bg-bg hover:text-fg shrink-0" data-i18n-title="backToProjects" title="返回我的项目">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><polyline points="15 18 9 12 15 6" /></svg>
          </a>
          <a href="#" className="brand no-underline text-inherit shrink-0"><img src="/logo-yujee.svg" alt="Yujee" style={{ height: '30px', width: 'auto', display: 'block' }} /></a>
          <span className="crumb text-meta text-[13px] hidden sm:inline">/</span>
          {building ? (
            <span className="flex items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11px] text-muted" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-gg animate-pulse" />
              <span>{locale === 'zh' ? '整理中' : 'Tidying up'}</span>
            </span>
          ) : (
            <>
              <span className="album-title font-display font-bold text-[14px] text-fg px-2 py-1 rounded-pill border border-transparent transition-colors hover:bg-bg cursor-text truncate" contentEditable suppressContentEditableWarning data-i18n="albumTitle">2024 厦门三日游</span>
              <span className="save-badge text-[11px] text-muted hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-bg rounded-pill" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)', fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}><span className="pulse w-1.5 h-1.5 rounded-full bg-gg" /><span data-i18n="saved">已保存</span></span>
            </>
          )}
        </div>
        {!building && <div className="top-right flex items-center gap-1 sm:gap-2 shrink-0">
          {/* 导出闸门(WP5.2 / §4.5a):章节故事未全章 done(stage∈{analysing,story})时
              按钮 disabled —— 既不可点也无 glow(.btn-glow:has(button:disabled) 已置零)。
              全章 done(stage 推进过 story)后解锁,主题/封面跳过不影响。disabled 时
              exportPdf 这个 data-action 不会触发(浏览器不派发 disabled 按钮的 click)。 */}
          <span className="btn-glow" data-export-gate={exportUnlocked ? 'open' : 'locked'}>
            <button
              className="btn-primary bg-fg text-white px-4 sm:px-7 py-2.5 rounded-pill text-[13px] font-semibold flex items-center gap-1.5 transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}
              data-action="exportPdf"
              data-testid="export-pdf-btn"
              disabled={!exportUnlocked}
              aria-disabled={!exportUnlocked}
              title={exportUnlocked ? undefined : (locale === 'zh' ? '先把每一章都「确定」，才能导出 PDF' : 'Confirm every chapter before exporting the PDF')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              <span className="hidden sm:inline" data-i18n="exportPdf">导出 PDF</span>
            </button>
          </span>

          <div className="user-menu" id="userMenu">
            <button className="user-trigger flex items-center p-1 rounded-pill transition-colors hover:bg-black/[0.04]" data-action="toggleUserMenu">
              <span className="user-avatar w-9 h-9 rounded-full bg-accent text-surface flex items-center justify-center text-[13px] font-bold shrink-0">L</span>
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
        </div>}
      </div>

      <div className="workspace flex-1 overflow-hidden relative md:flex" style={{ height: 'calc(100vh - 53px)' }}>

        <button className="chat-fold-btn chat-fold-expand" data-action="toggleChat" data-i18n-title="expandChat" title="展开对话" aria-label="展开对话">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="m6 17 5-5-5-5" /><path d="m13 17 5-5-5-5" /></svg>
        </button>

        <main className="pane pane-center flex flex-col overflow-hidden bg-bg relative md:order-3 md:flex-1" id="paneCenter">

          <div className="detail-mobile-bar items-center justify-between px-4 h-12 bg-surface border-b border-bdsoft shrink-0">
            <span className="font-display text-[14px] font-bold" data-i18n="detailChapters">详细章节</span>
            <button data-action="closeDetail" className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg transition-colors" aria-label="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div className="mobile-chapter-bar gap-2 px-4 py-2.5 overflow-x-auto bg-surface border-b border-bdsoft shrink-0" id="mobileChapterBar" />

          <div className="book-stage w-full flex-1 flex items-center justify-center px-4 pt-8 pb-16 overflow-auto bg-bg relative">
            {building ? (
              <CoverSkeleton locale={locale} />
            ) : (
            <>
            <div className="book bg-surface flex relative overflow-hidden" id="book">
              <div className="page page-left bg-surface" id="pageLeft" />
              <div className="page page-right bg-surface" id="pageRight" />
              <div className="flipper" id="flipper">
                <div className="leaf front" id="leafFront" />
                <div className="leaf back" id="leafBack" />
              </div>
            </div>

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

            {/* (Removed) The floating chapter rail (章节浮标) used to sit here as an
                absolute-positioned frosted panel over the canvas. Cut per design —
                renderRail() is null-safe on the absent #chapterList. */}
            </>
            )}
          </div>

        </main>

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

            {/* 五环节面包屑(WP2.4 / §2): 分析 → 章节故事 → 确定主题 → 书籍设计 →
                待导出, with the current 环节 lit from the live stage. Building albums
                report 'analysing'; authoring prefers storyProgress.stage because
                albums.stage can be stale after polling stops in EDITING. story 环节
                also shows per-chapter done ticks (一章一确定, §4.2(1)) when the editor
                surfaces chapterProgress. */}
            {mode !== 'editing' && (
              <StageBreadcrumb
                stage={breadcrumbStage}
                locale={locale}
                chapterProgress={storyProgress}
              />
            )}
            {/* §4.2 满意/不满意: the standing「确定本章」breadcrumb button is gone — chapter
                confirmation is now a per-write affordance (appendSatisfactionCard, in the
                chat flow): the AI writes a chapter → 满意/不满意 buttons appear inline. 满意
                → edit-chat progressDecision (advances chapter / 末章→主题); 不满意 → stays on the
                chapter for逐页 adjustment. No always-on CTA in the breadcrumb. */}

            {/* #236 ⑦⑧: the「太棒了，你的书已经准备好了！」closing line + 导出 entry no longer
                live as a fixed banner pinned above the thread. They are appended into the
                chat flow as the last AI message (appendExportReadyCard) when the export gate
                opens, so the wrap-up reads as小水母's final turn and the 导出 button sits at
                the bottom of the conversation (the top-bar 导出 PDF stays as a secondary
                entry). See appendExportReadyCard() in the effect. */}

            <div className="chat-body flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-6" id="chatBody" style={{ gap: '24px' }}>
              {building ? (
                <div className="msg ai max-w-full">
                  <div className="thinking-block active">
                    <img className="think-jelly" src="/jellyfish-loop.png" alt="" />
                    <span className="thinking-label">{buildingStageLabel(generation?.stage, locale)}</span>
                    <span className="thinking-dots"><span /><span /><span /></span>
                  </div>
                </div>
              ) : (
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
              )}
            </div>

            <div className="chat-input m-3 shrink-0 bg-surface border border-bdsoft rounded-pill flex items-end transition-all" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)', opacity: building ? 0.6 : undefined }}>
              <button className="add-ch-btn w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg m-2 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted" data-action="pickAddPhotos" data-i18n-title="addPhoto" title="添加图片" aria-label="添加图片" disabled={building}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              {/* Mid-edit add-photos (W11): the "+" opens this hidden picker; the
                  selection runs the add flow (compress → POST → poll → reload). */}
              <input type="file" id="addPhotoInput" accept="image/*" multiple className="hidden" />
              <textarea className="flex-1 outline-none resize-none bg-transparent text-fg text-[13.5px] leading-relaxed border-none pl-1 py-3 disabled:cursor-not-allowed" style={{ fontFamily: 'var(--font-body)' }} placeholder="" rows={1} id="msgInput" disabled={building} />
              <span className="btn-glow btn-glow-round shrink-0 m-2">
                <button className="send-btn w-8 h-8 rounded-full bg-fg text-white flex items-center justify-center cursor-pointer transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }} id="sendBtn" data-i18n-title="send" title="发送" disabled={building}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                </button>
              </span>
            </div>
          </aside>
        </div>
      </div>

      <div className="modal-overlay" id="photoModal" data-overlay-close>
        <div className="modal-card">
          <div className="px-6 pt-5 pb-4 border-b border-bdsoft shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[17px] font-bold" data-i18n="modalTitle">选择照片</h3>
              <button className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg transition-colors" data-action="closePhotoPicker" aria-label="close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <p className="text-[12.5px] text-muted mt-1" data-i18n="modalSub">挑选这一章要用的照片，AI 会据此排版并撰写故事。</p>
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
                  <span data-i18n="modalCreate">创建章节</span>
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* WP5.3 / §4.5d:导出失败安抚弹框。连续 3 次出 PDF / 上传 R2 失败后由
          openExportFailModal() 加 .open 显示。复用 .modal-overlay/.modal-card 视觉。
          文案安抚、不暴露技术细节;两个出口都不碰积分。飞书推送后置(此处不发,见
          export-retry-util.ts 顶注 + 需求 §4.5d)。 */}
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
    </div>
  );
}
