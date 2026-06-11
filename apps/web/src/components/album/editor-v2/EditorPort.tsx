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

import { useEffect, useRef } from 'react';
import './editor-port.css';

export function EditorPort() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

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
        detailChapters: '详细章节',
        balLow: '余额不足',
        balDesc: '当前余额不足以生成新章节，充值后即可继续创作',
        balRecharge: '去充值',
        bpLead: '哎呀，贝壳不够啦，再添几枚贝壳继续生成你的纪念册～',
        bpTitle: '购买贝壳',
        bpSub: '<b>1 个贝壳</b>，可处理 10 张照片',
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
        detailChapters: 'Chapter details',
        balLow: 'Balance running low',
        balDesc: 'Not enough balance to generate a new chapter — top up to keep creating',
        balRecharge: 'Top up',
        bpLead: 'Oops, you\'re running low on shells. Add a few more to keep creating your album.',
        bpTitle: 'Buy shells',
        bpSub: '<b>1 shell</b> processes 10 photos',
        bpBuy: 'Buy shells',
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

    let currentLang = 'zh';
    const t = (key: string) =>
      (i18n[currentLang] && i18n[currentLang][key]) || i18n.zh[key] || key;

    // expose alert hooks (original uses inline onclick="alert(t('...'))")
    (root as unknown as { __t: (k: string) => string }).__t = t;

    /* ─── CHAPTERS data (verbatim) ─── */
    interface Photo { url: string; cap?: string; span?: boolean }
    interface Chapter {
      eyebrow: string; title: string; meta: string; pages: string; footer: string;
      narrative: string; photos: Photo[]; pageNum: string; pageRightNum: string; ctxTag: string;
    }
    const CHAPTERS: Chapter[] = [
      {
        eyebrow: 'CHAPTER 01',
        title: '海边时光',
        meta: '2024.04.06 · 厦门 · 6 张照片',
        pages: 'P. 2–3 / 17',
        footer: '厦门 · 鼓浪屿',
        narrative: `那天的<span class="hl">风很轻</span>，沙子是温热的。我们沿着环岛路一直走，海浪一遍又一遍地把脚印抹平，又一遍又一遍地让我们重新走过。
          你说想看一次完整的潮起潮落，于是我们坐了整个下午，看远处的船像一只被慢慢拉远的风筝。
          后来才知道，<span class="hl">那种叫不出名字的安静</span>，就是旅行最珍贵的部分。`,
        photos: [
          { url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&q=80', cap: '环岛路 · 上午十点', span: true },
          { url: 'https://images.unsplash.com/photo-1519046904884-53103b34b206?w=400&q=80' },
          { url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=80' },
        ],
        pageNum: '02 · 海边时光',
        pageRightNum: '03',
        ctxTag: '第 1 章',
      },
      {
        eyebrow: 'CHAPTER 02',
        title: '古街探味',
        meta: '2024.04.07 · 中山路 · 7 张照片',
        pages: 'P. 8–9 / 17',
        footer: '厦门 · 中山路',
        narrative: `老巷子里有<span class="hl">沙茶面的烟火气</span>，墙根贴着早褪色的招牌。
          卖花生汤的阿姨说，她在这条街做了三十二年了，她记得每一个常客的口味。
          我们点了一碗最老派的，她笑着多舀了一勺。<span class="hl">所谓人情味</span>，大概就是这样的一勺。`,
        photos: [
          { url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80', cap: '中山路 · 黄昏', span: true },
          { url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&q=80' },
          { url: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=400&q=80' },
        ],
        pageNum: '08 · 古街探味',
        pageRightNum: '09',
        ctxTag: '第 2 章',
      },
      {
        eyebrow: 'CHAPTER 03',
        title: '日落归途',
        meta: '2024.04.08 · 演武大桥 · 4 张照片',
        pages: 'P. 14–15 / 17',
        footer: '厦门 · 演武大桥',
        narrative: `回程的车上，<span class="hl">夕阳把云烧成橘子味</span>。
          你靠在窗边睡着了，我没忍心叫你。
          高铁穿过一段又一段海岸，每一次海面被切开，光就跟着碎一次。
          我想，这趟旅行最完整的画面，<span class="hl">大概不在相机里</span>，在你睡着时窗外那片橘色里。`,
        photos: [
          { url: 'https://images.unsplash.com/photo-1495567720989-cebdbdd97913?w=600&q=80', cap: '演武大桥 · 17:42', span: true },
          { url: 'https://images.unsplash.com/photo-1502635385003-ee1e6a1a742d?w=400&q=80' },
          { url: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=400&q=80' },
        ],
        pageNum: '14 · 日落归途',
        pageRightNum: '15',
        ctxTag: '第 3 章',
      },
    ];

    function rebuildChapters() {
      CHAPTERS[0].title = t('ch1TitleBook');
      CHAPTERS[0].meta = t('ch1Meta');
      CHAPTERS[0].narrative = t('ch1Narrative');
      CHAPTERS[0].photos[0].cap = t('ch1PhotoCap');
      CHAPTERS[0].pageNum = t('ch1PageNum');
      CHAPTERS[0].footer = t('ch1Footer');
      CHAPTERS[0].ctxTag = t('ch1CtxTag');

      CHAPTERS[1].title = t('ch2TitleBook');
      CHAPTERS[1].meta = t('ch2Meta');
      CHAPTERS[1].narrative = t('ch2Narrative');
      CHAPTERS[1].photos[0].cap = t('ch2PhotoCap');
      CHAPTERS[1].pageNum = t('ch2PageNum');
      CHAPTERS[1].footer = t('ch2Footer');
      CHAPTERS[1].ctxTag = t('ch2CtxTag');

      CHAPTERS[2].title = t('ch3TitleBook');
      CHAPTERS[2].meta = t('ch3Meta');
      CHAPTERS[2].narrative = t('ch3Narrative');
      CHAPTERS[2].photos[0].cap = t('ch3PhotoCap');
      CHAPTERS[2].pageNum = t('ch3PageNum');
      CHAPTERS[2].footer = t('ch3Footer');
      CHAPTERS[2].ctxTag = t('ch3CtxTag');
    }

    function photoGridHTML(photos: Photo[]) {
      return `<div class="photo-grid">` + photos.map((p) =>
        `<div class="photo${p.span ? ' span-2' : ''}" style="background-image:url('${p.url}')">${p.cap ? `<div class="cap">${p.cap}</div>` : ''}</div>`,
      ).join('') + `</div>`;
    }
    function coverHTML(c: Chapter) {
      return `
        <div class="ch-eyebrow">${c.eyebrow}</div>
        <div class="ch-mark">${c.title}</div>
        <div class="ch-meta-line">${c.meta}</div>
        <p class="ch-narrative">${c.narrative}</p>
        <div class="page-num left">${c.pageNum}</div>`;
    }
    function photoSideHTML(c: Chapter) {
      return `${photoGridHTML(c.photos)}
        <div class="photo-foot"><span>${c.footer}</span><span>${c.pageRightNum}</span></div>`;
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

      rebuildChapters();
      renderRail();
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
    let lastCardedCh = 0;

    function paintSpread(i: number) {
      const c = CHAPTERS[i];
      pageLeft.innerHTML = coverHTML(c);
      pageRight.innerHTML = photoSideHTML(c);
      if (pageInd) pageInd.textContent = c.pages;
      if (ctxBadge) ctxBadge.textContent = c.ctxTag;
      $$('.chapter').forEach((el, j) => el.classList.toggle('active', j === i));
      $$('.m-chapter-chip').forEach((el, j) => el.classList.toggle('active', j === i));
      updateThumbUI(i);
    }

    function flipTo(nextIdx: number, dir: 'next' | 'prev') {
      if (flipping || nextIdx === currentCh) return;
      flipping = true;
      const cur = CHAPTERS[currentCh];
      const nxt = CHAPTERS[nextIdx];

      if (dir === 'next') {
        leafFront.innerHTML = photoSideHTML(cur);
        leafBack.innerHTML = coverHTML(nxt);
        pageRight.innerHTML = photoSideHTML(nxt);
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
        leafFront.innerHTML = coverHTML(cur);
        leafBack.innerHTML = photoSideHTML(nxt);
        pageLeft.innerHTML = coverHTML(nxt);
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
    function renderRail() {
      const list = byId('chapterList');
      if (list) {
        list.innerHTML = CHAPTERS.map((c, i) => {
          const photoN = c.photos ? c.photos.length : 0;
          const numStr = String(i + 1).padStart(2, '0');
          const shortTitle = [...c.title].length > 2 ? [...c.title].slice(0, 2).join('') + '…' : c.title;
          return `<div class="chapter${i === currentCh ? ' active' : ''}" data-ch="${i}" title="${c.title}">
            <span class="chapter-num">${numStr}</span>
            <span class="chapter-title">${shortTitle}</span>
            <span class="chapter-meta">${photoN} ${t('photosWord')}</span>
          </div>`;
        }).join('');
        list.querySelectorAll('.chapter').forEach((el) => {
          el.addEventListener('click', () => {
            const i = +el.getAttribute('data-ch')!;
            if (i !== currentCh) flipTo(i, i > currentCh ? 'next' : 'prev');
            selectChapterStory(i);
          });
        });
      }

      const mbar = byId('mobileChapterBar');
      if (mbar) {
        mbar.innerHTML = CHAPTERS.map((c, i) =>
          `<button class="m-chapter-chip${i === currentCh ? ' active' : ''}" data-ch="${i}">${c.ctxTag} · ${c.title}</button>`,
        ).join('');
        mbar.querySelectorAll('.m-chapter-chip').forEach((el) => {
          el.addEventListener('click', () => {
            const i = +el.getAttribute('data-ch')!;
            if (i !== currentCh) flipTo(i, i > currentCh ? 'next' : 'prev');
            selectChapterStory(i);
          });
        });
      }
    }

    const openDetail = () => bodyEl.classList.add('detail-open');
    const closeDetail = () => bodyEl.classList.remove('detail-open');
    const toggleChat = () => bodyEl.classList.toggle('chat-collapsed');
    const toggleRail = () => bodyEl.classList.toggle('rail-collapsed');

    /* ─── Thumbnail strip ─── */
    function updateThumbUI(chIdx: number) {
      $$('.thumb-item').forEach((el, i) => el.classList.toggle('active', i === chIdx));
      const ti = byId('thumbInd');
      if (ti) ti.textContent = (chIdx + 1) + ' / ' + CHAPTERS.length;
    }
    function goToSpread(chIdx: number) {
      if (chIdx === currentCh || chIdx < 0 || chIdx >= CHAPTERS.length) return;
      flipTo(chIdx, chIdx > currentCh ? 'next' : 'prev');
      updateThumbUI(chIdx);
    }
    function thumbNav(dir: number) {
      let next = currentCh + dir;
      if (next < 0) next = CHAPTERS.length - 1;
      if (next >= CHAPTERS.length) next = 0;
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
    function miniSpreadHTML(c: Chapter) {
      const photos = (c.photos || []).slice(0, 4);
      const cells = photos.map((p) => `<div class="ov-photo${p.span ? ' span2' : ''}" style="background-image:url('${p.url}')"></div>`).join('');
      return `<div class="ov-page ov-left">
          <div class="ov-eyebrow">${c.eyebrow}</div>
          <div class="ov-title">${c.title}</div>
          <div class="ov-meta">${c.meta}</div>
        </div>
        <div class="ov-page ov-right"><div class="ov-photos">${cells}</div></div>`;
    }
    function renderOverview() {
      const g = byId('ovGrid');
      if (!g) return;
      g.innerHTML = CHAPTERS.map((c, i) =>
        `<div class="ov-spread${i === currentCh ? ' ov-current' : ''}" data-ovidx="${i}">
          <div class="ov-book">${miniSpreadHTML(c)}</div>
          <div class="ov-cap">${c.ctxTag} · ${c.title}</div>
        </div>`).join('');
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
      selectChapterStory(i);
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

    /* ─── New-chapter flow ─── */
    let pendingPhotoCount = 0;
    function confirmNewChapter() {
      pendingPhotoCount = $$('#pickGrid .pick-photo.sel').length;
      if (pendingPhotoCount === 0) return;
      closePhotoPicker();

      setChatState(1);
      hideAwait();
      const load = document.createElement('div');
      load.className = 'msg ai';
      load.innerHTML = `<div class="load-block"><div class="load-spinner"></div><span class="load-label">${t('loadingNewChapter')}</span></div>`;
      chatBody!.appendChild(load); scrollChat();

      setTimeout(() => {
        load.remove();
        setChatState(2);
        const a = document.createElement('div');
        a.className = 'msg ai';
        a.innerHTML = `
          <div class="thinking-block"><span class="thinking-label">${t('themeThinking').replace('{n}', String(pendingPhotoCount))}</span></div>
          <div class="ai-text">${t('themeAsk')}</div>
          <div class="ai-actions flex gap-2 mt-3.5 flex-wrap">
            <button class="chip-select" data-theme>${t('themeOpt1')}</button>
            <button class="chip-select" data-theme>${t('themeOpt2')}</button>
            <button class="chip-select" data-theme>${t('themeOpt3')}</button>
          </div>
          <div class="name-time">${t('justNow')}</div>`;
        a.querySelectorAll('[data-theme]').forEach((b) =>
          b.addEventListener('click', () => pickTheme(b as HTMLElement)));
        chatBody!.appendChild(a); restAwait(); scrollChat();
      }, 1800);
    }

    function pickTheme(btn: HTMLElement) {
      btn.parentNode!.querySelectorAll('.chip-select').forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
      const theme = btn.textContent!;

      const n = CHAPTERS.length + 1;
      const photos: Photo[] = PICK_PHOTOS.slice(0, Math.max(1, Math.min(pendingPhotoCount, 3))).map((url, k) => (
        k === 0 ? { url: url.replace('w=300', 'w=600'), cap: theme, span: true } : { url }
      ));
      CHAPTERS.push({
        eyebrow: 'CHAPTER ' + String(n).padStart(2, '0'),
        title: theme,
        meta: t('newChapterMeta').replace('{n}', String(pendingPhotoCount)),
        pages: 'P. ' + (n * 2) + '–' + (n * 2 + 1) + ' / ' + (n * 2 + 1),
        footer: theme,
        narrative: t('newChapterNarrative'),
        photos,
        pageNum: String(n * 2).padStart(2, '0') + ' · ' + theme,
        pageRightNum: String(n * 2 + 1).padStart(2, '0'),
        ctxTag: (currentLang === 'zh' ? '第 ' + n + ' 章' : 'Ch. ' + n),
      });
      renderRail();
      const newIdx = CHAPTERS.length - 1;
      goToSpread(newIdx);

      setTimeout(() => {
        setChatState(3);
        const a = document.createElement('div');
        a.className = 'msg ai';
        a.innerHTML = `
          <div class="thinking-block"><span class="thinking-label">${t('themeConfirmed').replace('{theme}', theme)}</span></div>
          <div class="ai-text">${t('storyStart')}</div>
          <div class="name-time">${t('justNow')}</div>`;
        chatBody!.appendChild(a); restAwait(); scrollChat();
        lastCardedCh = newIdx;
        input?.focus();
      }, 480);
    }

    function selectChapterStory(i: number) {
      setChatState(3);
      if (ctxBadge) ctxBadge.textContent = CHAPTERS[i].ctxTag;
      if (i !== lastCardedCh) pushChapterCard(i);
      lastCardedCh = i;
    }

    /* ─── Chapter card in conversation ─── */
    function chapterCardHTML(i: number) {
      const c = CHAPTERS[i];
      const ps = (c.photos || []).slice(0, 4);
      const thumbs = ps.map((p) => `<div class="cc-thumb" style="background-image:url('${p.url}')"></div>`).join('');
      const photoN = c.photos ? c.photos.length : 0;
      return `<div class="chap-card" data-ch="${i}">
        <div class="cc-thumbs">${thumbs}</div>
        <div class="cc-foot">
          <div class="cc-info">
            <div class="cc-title-row"><span class="cc-title">${c.title}</span><span class="cc-tag">${c.ctxTag}</span></div>
            <div class="cc-meta">${photoN} ${t('photosWord')} · ${t('justEdited')}</div>
          </div>
          <button class="cc-view" data-viewch="${i}">${t('viewLayout')}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>
        </div>
      </div>`;
    }
    function bindViewChapter(scope: HTMLElement) {
      scope.querySelectorAll('[data-viewch]').forEach((b) => {
        if ((b as HTMLElement).dataset.bound) return;
        (b as HTMLElement).dataset.bound = '1';
        b.addEventListener('click', () => viewChapter(+b.getAttribute('data-viewch')!));
      });
    }
    function pushChapterCard(i: number) {
      const d = document.createElement('div');
      d.className = 'msg ai';
      d.innerHTML = chapterCardHTML(i);
      chatBody!.appendChild(d); bindViewChapter(d); scrollChat();
    }
    function viewChapter(i: number) {
      if (i !== currentCh) flipTo(i, i > currentCh ? 'next' : 'prev');
      if (window.matchMedia('(max-width:767px)').matches) {
        openDetail();
      } else {
        const b = byId('book');
        if (b) { b.classList.remove('book-flash'); void b.offsetWidth; b.classList.add('book-flash'); }
      }
    }

    /* ─── Chat send ─── */
    const chatBody = byId('chatBody');
    const input = byId('msgInput') as HTMLTextAreaElement | null;
    const sendBtnEl = byId('sendBtn');
    function send() {
      if (!input) return;
      const txt = input.value.trim();
      if (!txt) return;
      const u = document.createElement('div');
      u.className = 'msg user';
      u.innerHTML = `<div class="bubble"></div>`;
      u.querySelector('.bubble')!.textContent = txt;
      chatBody!.appendChild(u);
      input.value = ''; input.style.height = 'auto';
      hideAwait();
      chatBody!.scrollTop = chatBody!.scrollHeight;
      setTimeout(() => {
        const a = document.createElement('div');
        a.className = 'msg ai';
        a.innerHTML = `
          <div class="thinking-block active">
            <img class="think-jelly" src="/jellyfish-loop.png" alt="">
            <span class="thinking-label">${t('thinking')}</span>
            <span class="thinking-dots"><span></span><span></span><span></span></span>
          </div>`;
        chatBody!.appendChild(a);
        chatBody!.scrollTop = chatBody!.scrollHeight;
        setTimeout(() => {
          a.querySelector('.thinking-block')!.classList.remove('active');
          a.querySelector('.thinking-label')!.textContent = t('analyzedFeedback');
          const textEl = document.createElement('div');
          textEl.className = 'ai-text';
          textEl.textContent = t('aiReplyDefault');
          const time = document.createElement('div');
          time.className = 'name-time';
          time.textContent = t('justNow');
          a.appendChild(textEl);
          a.appendChild(time);
          restAwait();
          chatBody!.scrollTop = chatBody!.scrollHeight;
        }, 1500);
      }, 400);
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
    const actions: Record<string, () => void> = {
      exportPdf: () => alert(t('alertExportPdf')),
      toggleUserMenu,
      toggleChat,
      toggleRail,
      openDetail,
      closeDetail,
      toggleOverview,
      resetZoom,
      openPhotoPicker,
      closePhotoPicker,
      uploadStub: () => alert(t('alertUploadStub')),
      confirmNewChapter,
      buyShells: () => { window.location.href = 'pricing.html'; },
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
    // thumb items go to spread
    $$('[data-gospread]').forEach((el) => {
      const idx = parseInt(el.getAttribute('data-gospread')!, 10);
      const fn = () => goToSpread(idx);
      el.addEventListener('click', fn);
      actionHandlers.push({ el, fn });
    });

    /* ─── seeded chat chips (採納 / 再寫一版 / 我來改 / 章節名) ─── */
    $$('[data-chip]').forEach((el) => {
      const which = el.getAttribute('data-chip')!;
      const fn = () => {
        if (which === 'accept') alert(t('alertAccepted'));
        else if (which === 'rewrite') alert(t('alertRewrite'));
        else if (which === 'editMyself') {
          const q = el.closest('.msg')!.querySelector('.ai-quote') as HTMLElement;
          q.setAttribute('contenteditable', 'true');
          q.focus();
          alert(t('alertEditMyself'));
        }
      };
      el.addEventListener('click', fn);
      actionHandlers.push({ el, fn });
    });
    $$('[data-name-chip]').forEach((el) => {
      const fn = () => {
        el.parentNode!.querySelectorAll('.chip-select').forEach((c) => c.classList.remove('selected'));
        el.classList.add('selected');
        const m = $('.ch-mark');
        if (m) m.textContent = el.textContent;
        alert(t('alertChapterUpdated') + el.textContent);
      };
      el.addEventListener('click', fn);
      actionHandlers.push({ el, fn });
    });

    /* ─── Init: language → rail → seed conversation card ─── */
    rebuildChapters();
    setLang(currentLang);
    renderRail();
    setChatState(3);

    // bind seeded chapter card (the JS seedChapterCard inserted after first AI msg)
    (function seedChapterCard() {
      const firstAi = chatBody!.querySelector('.msg.ai');
      const card = document.createElement('div');
      card.className = 'msg ai max-w-full';
      card.innerHTML = chapterCardHTML(currentCh);
      bindViewChapter(card);
      if (firstAi && firstAi.nextSibling) chatBody!.insertBefore(card, firstAi.nextSibling);
      else chatBody!.appendChild(card);
    })();
    lastCardedCh = currentCh;

    const completeTimer = setTimeout(() => {
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
          <span className="album-title font-display font-bold text-[14px] text-fg px-2 py-1 rounded-pill border border-transparent transition-colors hover:bg-bg cursor-text truncate" contentEditable suppressContentEditableWarning data-i18n="albumTitle">2024 厦门三日游</span>
          <span className="save-badge text-[11px] text-muted hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-bg rounded-pill" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)', fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}><span className="pulse w-1.5 h-1.5 rounded-full bg-gg" /><span data-i18n="saved">已保存</span></span>
        </div>
        <div className="top-right flex items-center gap-1 sm:gap-2 shrink-0">
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
        </div>
      </div>

      <div className="workspace flex-1 overflow-hidden relative md:flex" style={{ height: 'calc(100vh - 53px)' }}>

        <button className="chat-fold-btn chat-fold-expand" data-action="toggleChat" data-i18n-title="expandChat" title="展开对话" aria-label="展开对话">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="9 18 15 12 9 6" /></svg>
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

            <div className="chapter-card hidden md:flex" id="chapterCard" style={{ width: '62px', gap: '2px', marginRight: '0px', marginLeft: '-16px' }}>
              <div className="chapter-card-head" data-i18n="chaptersLabel" style={{ marginTop: '0px', marginRight: '2px' }}>章节</div>
              <div className="chapter-list" id="chapterList" style={{ width: '53px', margin: '0px 0px -1px -3px', gap: '2px', fontSize: '14px', paddingTop: '0px' }} />
              <button className="chapter-toggle" data-action="toggleRail" data-i18n-title="collapseChapters" title="收起章节" aria-label="收起章节">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
              </button>
            </div>
          </div>

        </main>

        <div className="pane-chat-col md:order-1 md:w-[360px] shrink-0 md:flex">
          <aside className="pane pane-right chat-card relative flex flex-col overflow-hidden bg-surface md:flex-1">
            <button className="chat-fold-btn chat-fold-collapse" data-action="toggleChat" data-i18n-title="collapseChat" title="折叠对话" aria-label="折叠对话">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="15 18 9 12 9 6" /></svg>
            </button>
            <div className="md:hidden flex items-center px-4 py-3 border-b border-bdsoft flex-shrink-0">
              <button className="ml-auto flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-pill bg-bg text-fg2 text-[12.5px] font-semibold hover:bg-border-soft transition-colors shrink-0" data-action="openDetail">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[15px] h-[15px]"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                <span data-i18n="detailChapters">详细章节</span>
              </button>
            </div>

            <div className="chat-body flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-6" id="chatBody" style={{ gap: '24px' }}>
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
                <div className="bp-lead" data-i18n="bpLead">哎呀，贝壳不够啦，再添几枚贝壳继续生成你的纪念册～</div>
                <div className="bp-card">
                  <span className="bp-ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[26px] h-[26px]"><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /><line x1="2" y1="12" x2="22" y2="12" /></svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="bp-title" data-i18n="bpTitle">购买贝壳</div>
                    <div className="bp-sub" data-i18n-html="bpSub"><b>1 个贝壳</b>，可处理 10 张照片</div>
                  </div>
                  <button className="bp-buy" data-action="buyShells" data-i18n="bpBuy">去购买</button>
                </div>
              </div>
              <div className="await-user" id="awaitUser">
                <img className="await-jelly" src="/jellyfish-icon.png" alt="" style={{ width: '40px', height: '40px' }} />
                <span className="await-label" data-i18n="awaitUser">在听，随时和我说～</span>
              </div>
            </div>

            <div className="chat-input m-3 shrink-0 bg-surface border border-bdsoft rounded-pill flex items-end transition-all" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <button className="add-ch-btn w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg m-2" data-action="openPhotoPicker" data-i18n-title="addChapter" title="新增章节" aria-label="新增章节">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              <textarea className="flex-1 outline-none resize-none bg-transparent text-fg text-[13.5px] leading-relaxed border-none pl-1 py-3" style={{ fontFamily: 'var(--font-body)' }} data-i18n-placeholder="inputPlaceholder" placeholder="输入消息..." rows={1} id="msgInput" />
              <span className="btn-glow btn-glow-round shrink-0 m-2">
                <button className="send-btn w-8 h-8 rounded-full bg-fg text-white flex items-center justify-center cursor-pointer transition-transform hover:-translate-y-px" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }} id="sendBtn" data-i18n-title="send" title="发送">
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
