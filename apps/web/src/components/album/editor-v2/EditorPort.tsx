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
import { compressFile } from '@/lib/photo/compress';
import { getWebTemplate } from '../web-registry';
import { adaptPageToTemplateData, collectPhotoIds, type ResolveImage } from '../adapt-layout';
import { PAGE } from '../templates/constants';
import {
  applyPatchToPages,
  extractPhotoIds,
  type AlbumDetail,
  type EditorPage,
  type LayoutPatchEntry,
} from '../types';
import {
  fetchDraftSkeleton,
  postTheme,
  postChapterChat,
  postFinalize,
  type DraftSkeleton,
  type DraftSkeletonChapter,
  type DraftTheme,
  type ThemeOption,
} from '@/lib/album/authoring-client';
import { UnauthorizedError, CreditInsufficientError } from '@/lib/generation/client';
import './editor-port.css';

// The editor now spans the whole album lifecycle (W10 flow unification): the same
// EditorPort chrome renders for a still-generating album (building), a draft being
// authored (authoring), and a finalized album being edited (editing). page.tsx
// derives the mode from album.status + layoutJson and always mounts EditorPort.
//   • building  → AGENT_RUNNING / first load: flipbook shows a loading placeholder,
//                 chat rail is a non-interactive "tidying up" notice.
//   • authoring → EDITING & layoutJson==null: draft skeleton (read-only, invariant
//                 12) feeds the flipbook + rail; the chat rail drives the agent
//                 single-thread theme→chapter creation flow + "finish the book".
//   • editing   → layoutJson set: the original finalized editor, untouched.
export type EditorMode = 'building' | 'authoring' | 'editing';

// A theme counts as "set" once the agent populated any field (the user wrote a
// prompt at creation, or already answered the theme question) — decides whether
// the chat opens on the theme step or jumps straight into chapters.
function hasTheme(theme: DraftTheme | null): boolean {
  if (!theme) return false;
  return Object.values(theme).some((v) => typeof v === 'string' && v.trim().length > 0);
}

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
// loading chat. Falls back to the generic "tidying up" line when the stage is
// null/unknown (preserves the prior static behaviour). Uses the same local
// dictionary convention as the rest of EditorPort (no messages/*.json).
function buildingStageLabel(stage: string | null | undefined, locale: Locale): string {
  const zh = locale === 'zh';
  switch (stage) {
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
      return zh ? '正在收尾…' : 'Tidying up…';
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
// editing → /chat (applyPatch); authoring → agent theme/chapter flow + finalize.
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
  // building: the album is still generating (AGENT_RUNNING) — same editor chrome,
  // but the canvas shows a single cover skeleton and the chat shows the unified
  // loading state with the input disabled. The imperative flipbook/chat engine
  // below has no pages to drive yet, so it short-circuits.
  const building = mode === 'building';

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
    // The album's *content* language (what the agent writes in) is fixed at
    // generation time and read from the layout — distinct from the UI locale.
    const contentLang: 'zh' | 'en' =
      (detail.album.layoutJson as { magazine?: { language?: string } } | null)?.magazine?.language === 'zh'
        ? 'zh'
        : 'en';

    /* ─── Authoring (draft) chat state — single-thread cursor over theme + chapters.
       Empty in editing mode; in authoring mode it drives the agent creation flow
       (postTheme / postChapterChat / postFinalize) instead of the /chat editor. ─── */
    const isAuthoring = mode === 'authoring';
    // ASK_LIMIT mirrors the contract's askCount>=2 auto-advance rule.
    const ASK_LIMIT = 2;
    const MESSAGE_MAX = 500; // v2 theme/chapter-chat body schemas cap free text at 500.
    // Mutable working copy of the draft chapters; refetched after each turn.
    let draftSkel: DraftSkeleton | null = draftChapters;
    // Cursor: 'theme' until a theme is set, then walks the chapter list. We never
    // expose theme/prev/next buttons — the cursor advances on its own.
    let authStage: 'theme' | 'chapter' = draftSkel && hasTheme(draftSkel.theme) ? 'chapter' : 'theme';
    let authChapterIdx = 0;
    let finishing = false;
    const aT = (zh: string, en: string) => (currentLang === 'zh' ? zh : en);
    // Mutable working copy: chat and inline edits patch this in place and repaint
    // without remounting the effect. Sourced from detail.pages (editing) or the
    // draft skeleton (authoring) — both are EditorPage-shaped.
    let pagesState: EditorPage[] = initialPages.map((p) => ({
      ...p,
      imagesJson: { ...p.imagesJson },
      textsJson: { ...p.textsJson },
    }));
    const total = initialPages.length;
    // Lead with a blank slot so the cover (page 0) sits on the right of the first
    // spread (book-opening convention); the rest pair up two-per-spread.
    const spreadCount = Math.max(1, Math.ceil((pagesState.length + 1) / 2));
    const slotAt = (k: number): EditorPage | null => (k === 0 ? null : pagesState[k - 1] ?? null);
    const spreadPages = (s: number): [EditorPage | null, EditorPage | null] => [
      slotAt(s * 2),
      slotAt(s * 2 + 1),
    ];
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
      return renderToStaticMarkup(<Template data={data} totalPages={total} />);
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
    function paintEl(el: HTMLElement | null, page: EditorPage | null) {
      if (!el) return;
      el.innerHTML = faceHTML(page, el.clientWidth || 1, el.clientHeight || 1);
    }
    // Repaint every surface that shows page content after an edit.
    function repaintBook() {
      paintSpread(currentCh);
      buildThumbs();
      if (bodyEl.classList.contains('overview-on')) renderOverview();
    }
    // Mirror a layout patch (already persisted server-side) into the preview.
    function applyLocalPatch(patch: LayoutPatchEntry[]) {
      pagesState = applyPatchToPages(pagesState, patch);
      repaintBook();
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
      updateSelectionHighlight();
    };
    pageLeft.addEventListener('click', () => onPageSelect(pageLeft));
    pageRight.addEventListener('click', () => onPageSelect(pageRight));

    function paintSpread(i: number) {
      const [lp, rp] = spreadPages(i);
      paintEl(pageLeft, lp);
      paintEl(pageRight, rp);
      if (lp) pageLeft.dataset.pageIndex = String(lp.pageIndex);
      else delete pageLeft.dataset.pageIndex;
      if (rp) pageRight.dataset.pageIndex = String(rp.pageIndex);
      else delete pageRight.dataset.pageIndex;
      updateSelectionHighlight();
      if (pageInd) pageInd.textContent = (i + 1) + ' / ' + spreadCount;
      if (ctxBadge) ctxBadge.textContent = spreadLabel(i);
      // Rail items key off their target spread (data-ch), which for AI chapters is
      // a non-contiguous spread index — compare by that, not by list position.
      $$('.chapter').forEach((el) => el.classList.toggle('active', +el.getAttribute('data-ch')! === i));
      $$('.m-chapter-chip').forEach((el) => el.classList.toggle('active', +el.getAttribute('data-ch')! === i));
      updateThumbUI(i);
    }

    function flipTo(nextIdx: number, dir: 'next' | 'prev') {
      if (flipping || nextIdx === currentCh || nextIdx < 0 || nextIdx >= spreadCount) return;
      flipping = true;
      const [curLeft, curRight] = spreadPages(currentCh);
      const [nxtLeft, nxtRight] = spreadPages(nextIdx);

      if (dir === 'next') {
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
      return minI === Infinity ? 0 : Math.floor((minI + 1) / 2);
    }
    function renderRail() {
      const useCh = chapters.length > 0;
      const items = useCh
        ? chapters.map((c, i) => ({ idx: c.spread, num: String(i + 1).padStart(2, '0'), label: c.label }))
        : Array.from({ length: spreadCount }, (_, i) => ({ idx: i, num: String(i + 1).padStart(2, '0'), label: spreadLabel(i) }));
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
      row.innerHTML = Array.from({ length: spreadCount }, (_, i) =>
        `<div class="thumb-item${i === currentCh ? ' active' : ''} shrink-0 w-[52px] cursor-pointer" data-gospread="${i}">
          <div class="thumb-img"><div class="thumb-img-left" data-tface="${i}-l"></div><div class="thumb-img-right" data-tface="${i}-r"></div></div>
        </div>`,
      ).join('');
      for (let i = 0; i < spreadCount; i++) {
        const [lp, rp] = spreadPages(i);
        paintEl(row.querySelector(`[data-tface="${i}-l"]`) as HTMLElement | null, lp);
        paintEl(row.querySelector(`[data-tface="${i}-r"]`) as HTMLElement | null, rp);
      }
      row.querySelectorAll('[data-gospread]').forEach((el) => {
        el.addEventListener('click', () => goToSpread(parseInt(el.getAttribute('data-gospread')!, 10)));
      });
    }
    function updateThumbUI(chIdx: number) {
      $$('.thumb-item').forEach((el, i) => el.classList.toggle('active', i === chIdx));
      const ti = byId('thumbInd');
      if (ti) ti.textContent = (chIdx + 1) + ' / ' + spreadCount;
    }
    function goToSpread(chIdx: number) {
      if (chIdx === currentCh || chIdx < 0 || chIdx >= spreadCount) return;
      flipTo(chIdx, chIdx > currentCh ? 'next' : 'prev');
      updateThumbUI(chIdx);
    }
    function thumbNav(dir: number) {
      let next = currentCh + dir;
      if (next < 0) next = spreadCount - 1;
      if (next >= spreadCount) next = 0;
      goToSpread(next);
    }

    /* ─── Zoom + overview ─── */
    let zoom = 1;
    const ZMIN = 0.5, ZMAX = 2, ZSTEP = 0.25;
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
      const nz = Math.round((zoom + d) * 100) / 100;
      if (nz < ZMIN) { enterOverview(); return; }
      zoom = Math.min(ZMAX, nz);
      applyZoom();
    }
    function resetZoom() {
      if (bodyEl.classList.contains('overview-on')) { exitOverview(); return; }
      zoom = 1; applyZoom();
    }
    function renderOverview() {
      const g = byId('ovGrid');
      if (!g) return;
      g.innerHTML = Array.from({ length: spreadCount }, (_, i) =>
        `<div class="ov-spread${i === currentCh ? ' ov-current' : ''}" data-ovidx="${i}">
          <div class="ov-book"><div class="ov-page ov-left" data-oface="${i}-l"></div><div class="ov-page ov-right" data-oface="${i}-r"></div></div>
          <div class="ov-cap">${spreadLabel(i)}</div>
        </div>`).join('');
      for (let i = 0; i < spreadCount; i++) {
        const [lp, rp] = spreadPages(i);
        paintEl(g.querySelector(`[data-oface="${i}-l"]`) as HTMLElement | null, lp);
        paintEl(g.querySelector(`[data-oface="${i}-r"]`) as HTMLElement | null, rp);
      }
      g.querySelectorAll('.ov-spread').forEach((el) => {
        el.addEventListener('click', () => openSpreadFromOverview(+el.getAttribute('data-ovidx')!));
      });
    }
    function enterOverview() {
      renderOverview();
      bodyEl.classList.add('overview-on');
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
    let lastUserMessage = '';

    async function send() {
      if (!input || sending) return;
      const txt = input.value.trim();
      if (!txt) return;
      sending = true;
      const u = document.createElement('div');
      u.className = 'msg user max-w-full';
      u.innerHTML = `<div class="bubble"></div>`;
      u.querySelector('.bubble')!.textContent = txt;
      chatBody!.appendChild(u);
      input.value = ''; input.style.height = 'auto';
      hideAwait();
      scrollChat();
      if (isAuthoring) {
        await runAuthoringTurn(txt);
      } else {
        await runEdit(txt);
      }
      sending = false;
    }

    /* ─── Authoring chat round-trip (draft creation flow) ───
       Single thread, agent-driven: postTheme while no theme, then postChapterChat
       for the current chapter. After each turn refetch the skeleton (read-only;
       invariant 12), repaint the book + rail, and auto-advance the cursor when the
       agent marks the chapter done (state generated/skipped/finalized or askCount
       hit the limit). No theme/prev/next buttons are exposed. */
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
    // A fresh AI message shell with an active "thinking" block — the caller fills
    // in the reply (and chips) once the round-trip resolves. Mirrors the design's
    // jellyfish-loop thinking spinner.
    function appendThinkingShell(): HTMLElement {
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

    // ── Stepper helper: highlight the right pill for the current cursor. ──
    function syncStepper() {
      if (!isAuthoring) return;
      setChatState(authStage === 'theme' ? 2 : 3);
    }

    function chapterDone(c: DraftSkeletonChapter | undefined): boolean {
      if (!c) return true;
      return (
        c.state === 'generated' ||
        c.state === 'skipped' ||
        c.state === 'finalized' ||
        c.state === 'brief_ready' ||
        c.askCount >= ASK_LIMIT
      );
    }
    async function refreshDraft() {
      try {
        const { draft } = await fetchDraftSkeleton(albumId);
        if (!draft) return;
        draftSkel = draft;
        // Repaint the book from the refreshed skeleton (agent may have rewritten
        // text/captions for this chapter).
        pagesState = draft.pages.map((p) => ({
          pageIndex: p.pageIndex,
          templateId: p.templateId,
          imagesJson: { ...p.imagesJson },
          textsJson: { ...p.textsJson },
        }));
        // Re-resolve any newly referenced originals, then repaint.
        const ids = new Set<string>();
        for (const p of draft.pages) for (const id of Object.values(p.imagesJson)) if (id) ids.add(id);
        const urls = await photoStore.getObjectUrls([...ids]);
        imageUrls = { ...imageUrls, ...urls };
        repaintBook();
        railFromDraft();
      } catch {
        /* keep the current view; the next turn retries */
      }
    }

    // ── Chapter card (in conversation flow) — tells the user which chapter the
    // story chat is about. Read from the draft skeleton: label + photo count + a
    // "view layout" button that flips the book to the chapter's first spread. ──
    function chapterPhotoCount(c: DraftSkeletonChapter): number {
      const ids = new Set<string>();
      for (let i = c.pageStart; i < c.pageEnd; i++) {
        const p = draftSkel?.pages[i];
        if (!p) continue;
        for (const id of Object.values(p.imagesJson)) if (id) ids.add(id);
      }
      return ids.size;
    }
    // Up to 4 resolved thumbnail URLs for a chapter (page order), for the design's
    // .cc-thumbs row. Returns [] when no originals are resolved yet (graceful: the
    // card then renders foot-only, same as before).
    function chapterThumbUrls(c: DraftSkeletonChapter): string[] {
      const urls: string[] = [];
      const seen = new Set<string>();
      for (let i = c.pageStart; i < c.pageEnd && urls.length < 4; i++) {
        const p = draftSkel?.pages[i];
        if (!p) continue;
        for (const id of Object.values(p.imagesJson)) {
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const u = imageUrls[id];
          if (u) urls.push(u);
          if (urls.length >= 4) break;
        }
      }
      return urls;
    }
    function pushChapterCard(idx: number) {
      const c = draftSkel?.chapters[idx];
      if (!c) return;
      const sp = spreadOfFlatPage(c.pageStart);
      const tag = currentLang === 'zh' ? `第 ${idx + 1} 章` : `Ch. ${idx + 1}`;
      const d = document.createElement('div');
      d.className = 'msg ai max-w-full';
      const card = document.createElement('div');
      card.className = 'chap-card';
      // Design's .cc-thumbs row — a strip of the chapter's photos above the foot.
      const thumbs = chapterThumbUrls(c)
        .map((u) => `<div class="cc-thumb" style="background-image:url('${u.replace(/'/g, "\\'")}')"></div>`)
        .join('');
      card.innerHTML =
        (thumbs ? `<div class="cc-thumbs">${thumbs}</div>` : '') +
        `<div class="cc-foot"><div class="cc-info">` +
        `<div class="cc-title-row"><span class="cc-title"></span><span class="cc-tag"></span></div>` +
        `<div class="cc-meta"></div></div>` +
        `<button class="cc-view" type="button">${esc(t('viewLayout'))}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>` +
        `</div>`;
      (card.querySelector('.cc-title') as HTMLElement).textContent = c.label;
      (card.querySelector('.cc-tag') as HTMLElement).textContent = tag;
      (card.querySelector('.cc-meta') as HTMLElement).textContent =
        `${chapterPhotoCount(c)} ${t('photosWord')}`;
      card.querySelector('.cc-view')?.addEventListener('click', () => {
        if (sp !== currentCh) flipTo(sp, sp > currentCh ? 'next' : 'prev');
      });
      d.appendChild(card);
      chatBody!.appendChild(d);
      scrollChat();
    }

    // ── Theme stage: postTheme. If the agent hasn't fixed a theme yet it returns
    // themeOptions → render them as pickable chip-selects (the user can also free-
    // type). Once a theme is set, advance the cursor to the first chapter. ──
    async function runThemeTurn(message?: string) {
      const host = appendThinkingShell();
      try {
        const r = await postTheme(albumId, message ? message.slice(0, MESSAGE_MAX) : undefined);
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, r.assistantReply);
        await refreshDraft();
        if (draftSkel && hasTheme(draftSkel.theme) && (!r.themeOptions || r.themeOptions.length === 0)) {
          // Theme decided → confirm + move into the story stage on the first chapter.
          appendTime(host);
          enterStoryStage(0, /*announce*/ true);
        } else if (r.themeOptions && r.themeOptions.length > 0) {
          renderThemeOptions(host, r.themeOptions);
          appendTime(host);
        } else {
          appendTime(host);
        }
      } catch (e) {
        if (authErr(host, e)) return;
      }
      restAwait();
      scrollChat();
      updateAuthInputPlaceholder();
    }
    function renderThemeOptions(host: HTMLElement, options: ThemeOption[]) {
      const wrap = document.createElement('div');
      wrap.className = 'ai-actions flex gap-2 mt-3.5 flex-wrap';
      options.forEach((opt) => {
        const b = document.createElement('button');
        b.className = 'chip-select';
        b.type = 'button';
        b.textContent = opt.label || opt.subject;
        b.addEventListener('click', () => {
          if (sending) return;
          wrap.querySelectorAll('.chip-select').forEach((c) => c.classList.remove('selected'));
          b.classList.add('selected');
          wrap.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = true));
          // Echo the pick as a user turn, then send it back as the /theme nudge.
          appendUserBubble(b.textContent || '');
          hideAwait();
          void (async () => {
            sending = true;
            await runThemeTurn(opt.subject || opt.label);
            sending = false;
          })();
        });
        wrap.appendChild(b);
      });
      host.appendChild(wrap);
    }

    // ── Story stage: chat about the current chapter. postChapterChat returns the
    // updated state (+ optional nameOptions). Render the AI copy with accept /
    // rewrite / edit-myself chips and (when present) chapter-name chips. ──
    async function runStoryTurn(message: string) {
      const cur = draftSkel?.chapters[authChapterIdx];
      if (!cur) {
        // No chapter to talk to (theme not yet decided) — fall back to theme.
        authStage = 'theme';
        syncStepper();
        await runThemeTurn(message);
        return;
      }
      lastStoryMessage = message;
      const host = appendThinkingShell();
      try {
        const r = await postChapterChat(albumId, cur.chapterId, message.slice(0, MESSAGE_MAX));
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, r.assistantReply);
        await refreshDraft();
        renderStoryActions(host, cur.chapterId);
        if (r.nameOptions && r.nameOptions.length > 0) {
          renderNameOptions(host, cur.chapterId, r.nameOptions);
        }
        appendTime(host);
        maybeAdvanceChapter();
      } catch (e) {
        if (authErr(host, e)) return;
      }
      restAwait();
      scrollChat();
      updateAuthInputPlaceholder();
    }
    // 采纳 / 再写一版 / 我来改 on the story copy.
    function renderStoryActions(host: HTMLElement, chapterId: string) {
      const wrap = document.createElement('div');
      wrap.className = 'ai-actions flex gap-2 mt-3.5 flex-wrap';
      const mkChip = (label: string) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.type = 'button';
        b.textContent = label;
        wrap.appendChild(b);
        return b;
      };
      const disable = () =>
        wrap.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      // 采纳 = keep this version and move forward (advance if the chapter is done).
      const acceptBtn = mkChip(t('chipAccept'));
      acceptBtn.addEventListener('click', () => {
        disable();
        acceptBtn.classList.add('selected');
        maybeAdvanceChapter(/*force*/ true);
      });
      // 再写一版 = ask the agent for another take on the same story beat.
      const rewriteBtn = mkChip(t('chipRewrite'));
      rewriteBtn.addEventListener('click', () => {
        if (sending) return;
        disable();
        const nudge = aT('再写一版，换个角度。', 'Rewrite this — try another angle.');
        appendUserBubble(nudge);
        hideAwait();
        void (async () => {
          sending = true;
          await runStoryTurn(lastStoryMessage ? `${lastStoryMessage}\n\n${nudge}` : nudge);
          sending = false;
        })();
      });
      // 我来改 = edit the chapter's story text in place (local, persisted via the
      // single-page PATCH the editing path already uses).
      const editTarget = firstStoryTextSlot(chapterId);
      if (editTarget) {
        const editBtn = mkChip(t('chipEditMyself'));
        editBtn.addEventListener('click', () => {
          disable();
          openInlineEdit(host, editTarget);
        });
      }
      host.appendChild(wrap);
    }
    // Locate the first text slot in this chapter's pages (the narrative the user
    // would hand-edit). Returns null if the chapter has no editable text yet.
    function firstStoryTextSlot(chapterId: string): { pageIndex: number; slot: string } | null {
      if (!draftSkel) return null;
      const ch = draftSkel.chapters.find((c) => c.chapterId === chapterId);
      if (!ch) return null;
      for (let i = ch.pageStart; i < ch.pageEnd; i++) {
        const sp = draftSkel.pages[i];
        if (!sp) continue;
        const slots = Object.keys(sp.textsJson).filter((k) => (sp.textsJson[k] ?? '').trim().length > 0);
        if (slots.length > 0) return { pageIndex: sp.pageIndex, slot: slots[0] };
      }
      return null;
    }
    // Chapter-name candidate chips. Picking one sends it back through chapter-chat
    // as the user's chosen title (display-only options never touch draft_json —
    // invariant 12; the agent applies the rename and we refetch the skeleton).
    function renderNameOptions(host: HTMLElement, chapterId: string, names: string[]) {
      const wrap = document.createElement('div');
      wrap.className = 'ai-actions flex gap-2 mt-3.5 flex-wrap';
      names.forEach((name) => {
        const b = document.createElement('button');
        b.className = 'chip-select';
        b.type = 'button';
        b.textContent = name;
        b.addEventListener('click', () => {
          if (sending) return;
          wrap.querySelectorAll('.chip-select').forEach((c) => c.classList.remove('selected'));
          b.classList.add('selected');
          wrap.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = true));
          const pick = aT(`用这个章节名：${name}`, `Use this chapter title: ${name}`);
          appendUserBubble(pick);
          hideAwait();
          void (async () => {
            sending = true;
            const shell = appendThinkingShell();
            try {
              const r = await postChapterChat(albumId, chapterId, pick.slice(0, MESSAGE_MAX));
              settleThinking(shell, 'analyzedFeedback');
              appendReplyBody(shell, r.assistantReply);
              await refreshDraft();
              appendTime(shell);
            } catch (e) {
              authErr(shell, e);
            }
            restAwait();
            scrollChat();
            sending = false;
          })();
        });
        wrap.appendChild(b);
      });
      host.appendChild(wrap);
    }

    // Enter the story stage on chapter `idx`: flip the book to it, flip the
    // stepper to 章节故事, drop a chapter card + the storyStart prompt.
    function enterStoryStage(idx: number, announce: boolean) {
      authStage = 'chapter';
      authChapterIdx = idx;
      syncStepper();
      showFinishBar(); // "完成全书" appears only once we're in the story stage
      const ch = draftSkel?.chapters[idx];
      if (ch) {
        const sp = spreadOfFlatPage(ch.pageStart);
        if (sp !== currentCh) flipTo(sp, sp > currentCh ? 'next' : 'prev');
        pushChapterCard(idx);
        if (announce) appendAiText(t('storyStart'));
      }
      updateAuthInputPlaceholder();
    }
    // Advance to the next undone chapter when the current one is done (or when the
    // user hit 采纳). At the last chapter, stay put — the finish bar takes over.
    function maybeAdvanceChapter(force = false) {
      if (!draftSkel) return;
      const cur = draftSkel.chapters[authChapterIdx];
      if (!force && !chapterDone(cur)) return;
      const nextIdx = authChapterIdx + 1;
      if (nextIdx < draftSkel.chapters.length) {
        enterStoryStage(nextIdx, /*announce*/ true);
      }
    }
    function appendUserBubble(text: string) {
      const u = document.createElement('div');
      u.className = 'msg user max-w-full';
      u.innerHTML = `<div class="bubble"></div>`;
      u.querySelector('.bubble')!.textContent = text;
      chatBody!.appendChild(u);
      scrollChat();
    }
    let lastStoryMessage = '';

    // ── Finish bar visibility (red line: "完成全书" exists ONLY in the story
    // stage — never while still picking the theme). Created once during init;
    // these toggles flip it as the cursor crosses theme → story. ──
    let finishBar: HTMLElement | null = null;
    function showFinishBar() {
      if (finishBar) finishBar.style.display = '';
    }
    function hideFinishBar() {
      if (finishBar) finishBar.style.display = 'none';
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

    async function runAuthoringTurn(message: string) {
      if (authStage === 'theme') {
        await runThemeTurn(message);
      } else {
        await runStoryTurn(message);
      }
    }
    function updateAuthInputPlaceholder() {
      // Input stays blank by design (no prompt text in the box).
      if (!input) return;
      input.setAttribute('placeholder', '');
    }

    // One chat-edit round trip: POST the message, mirror the returned layout
    // patch into the book (the server already persisted it), then offer the
    // accept / rewrite / edit-myself chips on the assistant reply.
    async function runEdit(message: string) {
      lastUserMessage = message;
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
      try {
        const res = await fetch(`/api/v1/albums/${albumId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            language: contentLang,
            ...(selectedPageIndex != null ? { pageIndex: selectedPageIndex } : {}),
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error?.message ?? 'chat failed');
        const patch: LayoutPatchEntry[] = json.data.layoutPatch ?? [];
        const reply: string = json.data.assistantReply ?? '';
        applyLocalPatch(patch); // reflect the server-applied edit in the preview
        a.querySelector('.thinking-block')!.classList.remove('active');
        (a.querySelector('.thinking-label') as HTMLElement).textContent = t('analyzedFeedback');
        renderProposal(a, reply, patch);
      } catch {
        a.querySelector('.thinking-block')?.classList.remove('active');
        const err = document.createElement('div');
        err.className = 'ai-text';
        err.textContent = t('aiReplyDefault');
        a.appendChild(err);
      }
      restAwait();
      scrollChat();
    }

    function renderProposal(host: HTMLElement, reply: string, patch: LayoutPatchEntry[]) {
      if (reply) {
        const textEl = document.createElement('div');
        textEl.className = 'ai-text';
        textEl.textContent = reply;
        host.appendChild(textEl);
      }
      // First changed text slot — the target "我来改" lets the user edit by hand.
      const textEntry = patch.find((e) => e.textsJson && Object.keys(e.textsJson).length > 0);
      const editTarget = textEntry
        ? { pageIndex: textEntry.pageIndex, slot: Object.keys(textEntry.textsJson!)[0] }
        : null;

      const actionsEl = document.createElement('div');
      actionsEl.className = 'ai-actions flex gap-2 mt-3.5 flex-wrap';
      const mkChip = (label: string) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = label;
        actionsEl.appendChild(b);
        return b;
      };
      const disable = () =>
        actionsEl.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));

      const acceptBtn = mkChip(t('chipAccept'));
      acceptBtn.addEventListener('click', () => { disable(); acceptBtn.classList.add('selected'); });

      const rewriteBtn = mkChip(t('chipRewrite'));
      rewriteBtn.addEventListener('click', () => { disable(); void runEdit(lastUserMessage); });

      if (editTarget) {
        const editBtn = mkChip(t('chipEditMyself'));
        editBtn.addEventListener('click', () => { disable(); openInlineEdit(host, editTarget); });
      }
      host.appendChild(actionsEl);

      const time = document.createElement('div');
      time.className = 'name-time';
      time.textContent = t('justNow');
      host.appendChild(time);
    }

    // "我来改": edit the changed text in place and persist via the single-page
    // PATCH (the existing slot-edit endpoint), then repaint the book.
    function openInlineEdit(host: HTMLElement, target: { pageIndex: number; slot: string }) {
      const page = pageByIndex(target.pageIndex);
      if (!page) return;
      const box = document.createElement('div');
      box.className = 'ai-quote';
      box.setAttribute('contenteditable', 'true');
      box.textContent = page.textsJson[target.slot] ?? '';
      host.appendChild(box);
      box.focus();
      box.addEventListener('blur', () => {
        const val = box.textContent ?? '';
        const cur = pageByIndex(target.pageIndex);
        if (!cur || val === (cur.textsJson[target.slot] ?? '')) return;
        cur.textsJson = { ...cur.textsJson, [target.slot]: val };
        repaintBook();
        void fetch(`/api/v1/albums/${albumId}/pages/${target.pageIndex}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ textsJson: cur.textsJson }),
        });
      });
    }
    // Export: render the PDF in the browser (@react-pdf), download it locally,
    // and upload straight to R2 (bytes never touch the Web tier — invariant 4).
    let exportingPdf = false;
    async function exportPdf() {
      if (exportingPdf) return;
      exportingPdf = true;
      const btn = $('[data-action="exportPdf"]') as HTMLButtonElement | null;
      if (btn) btn.style.opacity = '0.6';
      try {
        const adaptable = pagesState.map((p) => ({
          templateId: p.templateId, images: p.imagesJson, texts: p.textsJson,
        }));
        const ids = collectPhotoIds(adaptable);
        const dataUrls = await photoStore.getDataUrls(ids);
        const { renderAlbumPdf } = await import('@/lib/pdf/render');
        const blob = await renderAlbumPdf(adaptable, (id) => dataUrls[id]);

        // Local download — useful even if R2 isn't configured (e.g. mock runs).
        const url = URL.createObjectURL(blob);
        const aEl = document.createElement('a');
        aEl.href = url;
        aEl.download = (currentTitle || 'album') + '.pdf';
        document.body.appendChild(aEl);
        aEl.click();
        aEl.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);

        try {
          const signRes = await fetch(`/api/v1/albums/${albumId}/pdf-upload-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contentType: 'application/pdf', size: blob.size }),
          });
          const signJson = await signRes.json();
          if (!signJson.ok) throw new Error(signJson.error?.message ?? 'sign failed');
          const { putUrl, r2Key } = signJson.data;
          const putRes = await fetch(putUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/pdf' },
            body: blob,
          });
          if (!putRes.ok) throw new Error(`R2 PUT ${putRes.status}`);
          await fetch(`/api/v1/albums/${albumId}/pdf`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ r2Key }),
          });
        } catch (uploadErr) {
          console.error('PDF cloud upload failed', uploadErr);
        }
      } catch (e) {
        console.error('PDF export failed', e);
      } finally {
        exportingPdf = false;
        if (btn) btn.style.opacity = '';
      }
    }
    function hideAwait() { const w = byId('awaitUser'); if (w) w.style.display = 'none'; }
    function restAwait() { const w = byId('awaitUser'); if (w) { chatBody!.appendChild(w); w.style.display = 'flex'; } }
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
      try {
        const photos: { photoId: string; base64: string; width: number; height: number }[] = [];
        for (const f of Array.from(files).slice(0, 30)) {
          const photoId = crypto.randomUUID();
          const c = await compressFile(f, photoId);
          await photoStore.put(photoId, f);
          photos.push({ photoId, base64: c.base64, width: c.width, height: c.height });
        }
        const requestId = crypto.randomUUID();
        const res = await fetch(`/api/v2/albums/${albumId}/add-photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, language: currentLang, photos }),
        });
        const json = await res.json();
        if (!json.ok) {
          if (json.error?.code === 'CREDIT_INSUFFICIENT') {
            window.location.assign(localizePath('/credits?from=album', locale));
            return;
          }
          fail(json.error?.message ?? aT('加图失败，请重试。', 'Add failed — please try again.'));
          return;
        }
        const reqId: string = json.data.requestId;
        // Poll the add job; on completion reload to paint the appended pages.
        for (let i = 0; i < 160; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const sres = await fetch(`/api/v2/albums/${albumId}/add-photos?requestId=${reqId}`);
          const sjson = await sres.json();
          const status = sjson.data?.status;
          if (status === 'completed') {
            window.location.reload();
            return;
          }
          if (status === 'failed') {
            fail(sjson.data?.error ?? aT('加图失败，请重试。', 'Add failed — please try again.'));
            return;
          }
        }
        fail(aT('处理超时，请稍后刷新查看。', 'Timed out — refresh later to check.'));
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
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
      openPhotoPicker,
      closePhotoPicker,
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
    else restAwait();

    /* ─── Authoring init: seed the opening message, expose the single "finish the
       whole book" action, hide the editing-only add-chapter affordance. ─── */
    async function finalizeBook() {
      if (finishing || sending) return;
      finishing = true;
      const fb = finishBar?.querySelector('.finish-btn') as HTMLButtonElement | null;
      if (fb) {
        fb.disabled = true;
        fb.textContent = aT('正在生成你的纪念册…', 'Creating your memoir…');
      }
      try {
        await postFinalize(albumId);
        // Album is now AGENT_RUNNING ("completing"). Reload hands control back to
        // page.tsx's poll → building shell → editor once layout_json lands.
        window.location.reload();
      } catch (e) {
        finishing = false;
        if (fb) {
          fb.disabled = false;
          fb.textContent = aT('完成全书', 'Finish the whole book');
        }
        if (e instanceof UnauthorizedError) {
          window.location.assign(localizePath(`/login?from=/album/${albumId}`, locale));
          return;
        }
        if (e instanceof CreditInsufficientError) {
          window.location.assign(localizePath('/credits?from=authoring', locale));
          return;
        }
        appendAiText(e instanceof Error ? e.message : String(e));
      }
    }
    if (isAuthoring) {
      // The add-photo "+" in the input stays visible during authoring too (its real
      // "append photos to this album" flow is the mid-edit add feature — still WIP
      // server-side; for now it opens the dormant picker like editing does).
      // (Removed) The "完成全书" finish bar + disclaimer used to live above the input
      // here. Per product decision it's gone entirely — no finalize CTA in this
      // surface anymore (showFinishBar/hideFinishBar are now no-ops).
      $('.authoring-finish-bar')?.remove();

      // Lead with Yujee's self-intro so both opening branches start with it,
      // before the task message.
      appendAiText(
        aT(
          '我是 Yujee，你的杂志制作小助手。文案不满意，随时可以调。',
          "Hi, I'm Yujee — your magazine-making assistant. Don't love the wording? Tweak it anytime.",
        ),
      );

      // Drive the opening of the 3-state flow.
      if (draftSkel && hasTheme(draftSkel.theme)) {
        // Theme already fixed (the user wrote a prompt at creation) → skip straight
        // into the story stage on the first chapter. Finish bar shows here.
        appendAiText(
          aT(
            '草稿已就绪，我已经按你写的定好了主题。接下来我们一章一章把故事聊清楚吧，你也可以随时直接完成全书。',
            "Your draft is ready, and I've set the theme from what you wrote. Let's go chapter by chapter to flesh out the story — or finish the whole book anytime.",
          ),
        );
        enterStoryStage(0, /*announce*/ true);
      } else {
        // Theme stage: stepper on 确定主题, no finish bar. Open with themeAsk, then
        // fetch the candidate themes (postTheme) and render them as pickable chips.
        authStage = 'theme';
        setChatState(2);
        hideFinishBar();
        appendAiText(t('themeAsk'));
        updateAuthInputPlaceholder();
        void (async () => {
          sending = true;
          await runThemeTurn();
          sending = false;
        })();
      }
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
    function spreadOfFlatPage(i: number) { return Math.floor((i + 1) / 2); }
    function railFromDraft() {
      if (!draftSkel) return;
      chapters = draftSkel.chapters.map((c) => ({
        label: c.label,
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
    };
  }, []);

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
          <span className="btn-glow">
            <button className="btn-primary bg-fg text-white px-4 sm:px-7 py-2.5 rounded-pill text-[13px] font-semibold flex items-center gap-1.5 transition-transform hover:-translate-y-px" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }} data-action="exportPdf">
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

            {/* 3-state stepper: 加载 → 确定主题 → 章节故事. Hidden in editing mode
                (the finalized editor has no creation flow); building highlights
                "加载", authoring tracks the cursor (theme / story). */}
            <div className="state-stepper" id="stateStepper">
              <span className={`state-pill${building ? ' active' : ''}`} data-state="1"><span className="state-dot" /><span data-i18n="stateLoading">加载</span></span>
              <span className="state-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><polyline points="9 18 15 12 9 6" /></svg></span>
              <span className="state-pill" data-state="2"><span className="state-dot" /><span data-i18n="stateTheme">确定主题</span></span>
              <span className="state-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><polyline points="9 18 15 12 9 6" /></svg></span>
              <span className="state-pill" data-state="3"><span className="state-dot" /><span data-i18n="stateStory">章节故事</span></span>
            </div>

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
                <span className="await-label" data-i18n="awaitUser">在听，随时和我说～</span>
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
    </div>
  );
}
