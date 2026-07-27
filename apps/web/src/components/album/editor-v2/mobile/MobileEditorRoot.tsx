'use client';

/* ════════════════════════════════════════════════════════════════════════════
   MobileEditorRoot —— 移动端这棵树的数据容器。

   副作用(IndexedDB 取照片、blob URL、路由、落库)只住在这里,展示层 MobileEditor
   保持纯组件 → 能被 renderToStaticMarkup 直接断言(仓里没有 jsdom)。

   这里同时是**编辑焦点的持有者**:哪一页在编、选中了哪个槽、面板开着没有。
   这些原本住在展示层,导致弹窗所在的容器层不知道用户在编哪一页 —— 任何页级改动
   都无处可落。焦点上提之后,「改动 → 打进页面 → 落库」才是一条完整的链。

   编辑落地的口径(与桌面刻意不同,见 page-edit.ts):
     · 面板打开时对当前页拍快照(draftBase)+ 记下元素初始样式(textBase)
     · 每次改动都从快照重算,即时打进 pagesState → 那一页重渲(所见)
     · 「完成」才 PATCH(所存);「取消」把快照放回去
   预览与落库共用 page-html-dom 的同一批 patcher,所以所见即所存。

   照片解析口径与桌面一致:屏显用 display 档派生图(不动原图,architecture invariant 1),
   本地没有时回落服务器压缩快照(photo-snapshot §5.3)。
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { photoStore } from '@/lib/photo/store';
import { presetImageUrl, type BoardBackground } from '@/lib/board-bg/presets';
import { photoStore as _photoStoreForBg } from '@/lib/photo/store';
import { BoardBgSheet } from './modals/BoardBgSheet';
import {
  ExportMenuModal,
  CollageModal,
  ExportProgressModal,
  ExportFailModal,
} from './modals/ExportModals';
import { ShareLinkModal } from './modals/ShareLinkModal';
import { MoreSheet, NoticeModal } from './modals/MoreSheet';
import { useExport } from './use-export';
import { useShareLink } from './use-share-link';
import { usePhotoBackup } from './use-photo-backup';
import { useDesignChat } from './use-design-chat';
import { resolveBackTarget } from './back-nav';
import { ElementSheet } from './modals/ElementSheet';
import { TextPanel } from './modals/TextPanel';
import { PageBgPanel } from './modals/PageBgPanel';
import type { Locale } from '@/lib/i18n/routing';
import { collectPhotoIds, type ResolveImage } from '../../adapt-layout';
import { interiorSpreads } from '@/lib/export/collage';
import { computeExportUnlocked } from '../export-gate-util';
import { extractPhotoIds, type AlbumDetail, type EditorPage } from '../../types';
import { MobileEditor } from './MobileEditor';
import { MobileToast } from './MobileToast';
import { AiChatSheet } from './modals/AiChatSheet';
import {
  applyImageClear,
  applyImagePos,
  applyImageSwap,
  imagesPatchBody,
  applyPageBg,
  applyTextEdit,
  imagePosPatchBody,
  pageBgPatchBody,
  probeToState,
  readImagePos,
  readPageBg,
  textPatchBody,
  type SelRect,
  type TextStyleState,
} from './page-edit';
import { DEFAULT_IMAGE_POS, type ImagePosValue } from '../image-edit-util';
import { PhotoPickerSheet } from './modals/PhotoPickerSheet';
import type { TextHit, ImageHit } from './EditView';
// 样式在容器里引:展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
// token 与桌面共用同一份(共享设计系统,不共享 DOM)。
import '../editor-tokens.css';
import './mobile-editor.css';
// 弹窗借用桌面成品样式(见 modals/ModalHost.tsx)。样式 import 只放容器层 ——
// 展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
import '../editor-port.css';

/** 选中态。文字与图片共用一个高亮框,靠 kind 区分后续用哪个面板/落哪条库。
 *  文字带 base(打开面板那一刻的真实样式,取消要回到这里);图片不需要 ——
 *  它的「原状」在 draftBase 那张整页快照里。 */
type Selection =
  | { kind: 'text'; slotId: string; rect: SelRect; base: TextStyleState }
  | { kind: 'image'; slotId: string; rect: SelRect };

export function MobileEditorRoot({
  detail,
  pages: incomingPages,
  locale,
  onBack,
}: {
  detail: AlbumDetail;
  /** 书页。**由调用方给** —— 真实相册的书住在草稿(authoring)里,那边的 pages
     带 htmlJson(页面真相);detail.pages 走的是没有 html 的旧表,拿不到真相。 */
  pages: EditorPage[];
  locale: Locale;
  /** 顶栏返回。默认回「我的相册」;dev 预览页覆盖它,免得一点就被踢出预览。 */
  onBack?: () => void;
}) {
  const router = useRouter();
  const zh = locale === 'zh';
  // 浏览态顶栏「返回」:同源来处就回上一页(从相册预览/分享页点进来的人要回到那儿),
  // 没有来处或站外跳入则落到相册列表 —— 无脑 back() 会把人踢出站。判据见 back-nav.ts。
  const goBack = useCallback(() => {
    const target = resolveBackTarget(
      typeof document === 'undefined' ? '' : document.referrer,
      typeof window === 'undefined' ? '' : window.location.origin,
    );
    if (target === 'history') router.back();
    else router.push(`/${locale}/my-albums`);
  }, [router, locale]);
  // 本地可变副本:编辑即时反映在这里(书立刻变),落库另走 HTTP。
  // 服务端真相变了(草稿重载)→ 以服务端为准整体换掉。
  const [pages, setPages] = useState<EditorPage[]>(incomingPages);
  useEffect(() => setPages(incomingPages), [incomingPages]);

  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  // 缩略档单独取:书册预览栏一条几十页,用主画布的 display 档会拖垮解码与滚动。
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [uploadBgUrl, setUploadBgUrl] = useState<string | null>(null);
  const [bgSheetOpen, setBgSheetOpen] = useState(false);
  // 画板背景弹窗的两视图:色板 / 完整取色器(与文字、书页底色同一个取色器组件)。
  const [bgSheetView, setBgSheetView] = useState<'main' | 'color'>('main');
  // 弹窗开关。行为(导出渲染 / 分享上传)后续接线,这里先让 UI 可开可核对。
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [collageOpen, setCollageOpen] = useState(false);
  const [collageDensity, setCollageDensity] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // 换图:本册照片选择器。点一张即换即关,不做「选中+完成」两步。
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);

  // ── 编辑焦点 ──────────────────────────────────────────────────────────────
  const [editPage, setEditPage] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  // 元素编辑 sheet:'text' = 文字,'pagebg' = 页面底色。null = 关。
  // 图片没有面板了(缩放平移走手势、换图删除走小工具栏),所以这里只剩文字和书页底色。
  const [sheetKind, setSheetKind] = useState<'text' | 'pagebg' | null>(null);
  // mes 的三视图之一:main / font(完整字体列表)。取色器完整版随取色行为一起接。
  const [sheetView, setSheetView] = useState<'main' | 'font' | 'color'>('main');
  // 面板打开那一刻的整页快照:每次改动都从它重算,取消就是把它放回去。
  const [draftBase, setDraftBase] = useState<EditorPage | null>(null);
  const [textState, setTextState] = useState<TextStyleState | null>(null);
  const [pageBg, setPageBg] = useState<string | null>(null);

  // 未实现功能的统一反馈:点了给一句「即将上线」,不做死按钮。
  const [toast, setToast] = useState<string | null>(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const say = useCallback((label: string) => {
    setToast(label);
    // 3 秒后自动消失(用 setTimeout,与桌面 alert 不同,不阻塞)。
    window.setTimeout(() => setToast((cur) => (cur === label ? null : cur)), 3000);
  }, []);
  const soon = useCallback(
    (what: string, whatEn: string) => say(zh ? `${what}即将上线` : `${whatEn} — coming soon`),
    [say, zh],
  );
  // 画板背景是相册级视觉属性:本地先落地(立刻可见),再 PATCH 持久化(与桌面同一通道)。
  const [boardBgOverride, setBoardBgOverride] = useState<BoardBackground | null | undefined>(
    undefined,
  );

  const photoIds = useMemo(
    () => [
      ...new Set([
        ...extractPhotoIds(detail.album.layoutJson),
        ...collectPhotoIds(
          pages.map((p) => ({ templateId: p.templateId, images: p.imagesJson, texts: p.textsJson })),
        ),
      ]),
    ],
    [detail.album.layoutJson, pages],
  );

  useEffect(() => {
    let cancelled = false;
    void photoStore.getTierUrls(photoIds, 'display').then((urls) => {
      if (!cancelled) setImageUrls(urls);
    });
    void photoStore.getTierUrls(photoIds, 'thumb').then((urls) => {
      if (!cancelled) setThumbUrls(urls);
    });
  return () => {
      cancelled = true;
    };
  }, [photoIds]);



  // ── 落库:与桌面同一通道(PATCH /api/v1/albums/{id}/pages/{index})。 ────────
  // 服务端按同一批 patcher 把改动打进存库 html,前端不重复实现落库侧写回。
  // 内容改动失败必须说话 —— 静默失败会让用户以为改好了,刷新才发现白改。
  const persistPage = useCallback(
    (pageIndex: number, body: Record<string, unknown>) => {
      void fetch(`/api/v1/albums/${detail.album.id}/pages/${pageIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((res) => {
          if (!res.ok) say(zh ? '没保存成功,请重试' : "Couldn't save — please retry");
        })
        .catch(() => say(zh ? '没保存成功,请重试' : "Couldn't save — please retry"));
    },
    [detail.album.id, say, zh],
  );

  const closeSheet = () => {
    setSheetKind(null);
    setSheetView('main');
    setDraftBase(null);
    setTextState(null);
  };

  /** 取消:把面板打开那一刻的整页快照放回去(不需要反向撤销)。 */
  const cancelSheet = () => {
    if (draftBase != null && editPage != null) {
      const base = draftBase;
      setPages((prev) => prev.map((p, i) => (i === editPage ? base : p)));
    }
    closeSheet();
  };

  /** 改动即时打进书:总是从快照重算,反复改不累加。 */
  const previewPage = (next: EditorPage) => {
    setPages((prev) => prev.map((p, i) => (i === editPage ? next : p)));
  };

  const openTextSheet = (
    sel: Extract<Selection, { kind: 'text' }>,
    page: EditorPage,
  ) => {
    setSelection(sel);
    setDraftBase(page);
    setTextState(sel.base);
    setSheetView('main');
    setSheetKind('text');
  };

  const onSelectText = (hit: TextHit) => {
    if (editPage == null) return;
    const page = pages[editPage];
    if (!page) return;
    openTextSheet(
      { kind: 'text', slotId: hit.slotId, rect: hit.rect, base: probeToState(hit.probe) },
      page,
    );
  };

  const onTextChange = (patch: Partial<TextStyleState>) => {
    if (selection?.kind !== 'text' || !textState || !draftBase) return;
    const next = { ...textState, ...patch };
    setTextState(next);
    previewPage(applyTextEdit(draftBase, selection.slotId, next, selection.base).page);
  };

  const onTextDone = () => {
    if (selection?.kind !== 'text' || !textState || !draftBase || editPage == null) {
      closeSheet();
      return;
    }
    const { page, props } = applyTextEdit(draftBase, selection.slotId, textState, selection.base);
    previewPage(page);
    persistPage(page.pageIndex, textPatchBody(page, selection.slotId, props));
    closeSheet();
  };

  // ── 图片:拖动平移 / 捏合缩放 / 复位(线上就这三件) ──────────────────────────
  const [imagePos, setImagePos] = useState<ImagePosValue | null>(null);
  // 落库要读「此刻最新的位置」,而 setState 是异步的:同一个事件里先 live 再 commit 时,
  // commit 读到的 state 还是旧值 —— 结果是用旧位置把刚预览的新位置覆盖回去,
  // 表现为「滑块动了、图没动、还落了个错的库」。所以真值走 ref,state 只管渲染。
  const imagePosRef = useRef<ImagePosValue | null>(null);

  /** 点中图槽 = 选中它,**不开弹窗**:缩放/平移直接在图上捏合拖动(EditView 的 imageEditing),
   *  换图/复位/删除走选中框旁那条小工具栏。弹窗里放缩放滑杆是多此一举,还挡着图看不见效果。 */
  const onSelectImage = (hit: ImageHit) => {
    if (editPage == null) return;
    const page = pages[editPage];
    if (!page) return;
    const pos = readImagePos(page, hit.slotId);
    setSelection({ kind: 'image', slotId: hit.slotId, rect: hit.rect });
    setDraftBase(page);
    imagePosRef.current = pos;
    setImagePos(pos);
  };

  /** 工具栏「复位」:位置/缩放回到默认并落库(与松手即存同口径)。 */
  const onResetImagePos = () => {
    if (selection?.kind !== 'image' || !draftBase || editPage == null) return;
    const page = applyImagePos(draftBase, selection.slotId, DEFAULT_IMAGE_POS);
    imagePosRef.current = DEFAULT_IMAGE_POS;
    setImagePos(DEFAULT_IMAGE_POS);
    previewPage(page);
    persistPage(page.pageIndex, imagePosPatchBody(page));
    setDraftBase(page);
  };

  /** 工具栏「删除」:清空这个图槽 —— 版式不变,框还占着位,以后放张图回去就复原。 */
  const onClearImage = () => {
    if (selection?.kind !== 'image' || editPage == null) return;
    const base = pages[editPage];
    if (!base) return;
    const page = applyImageClear(base, selection.slotId);
    previewPage(page);
    persistPage(page.pageIndex, imagesPatchBody(page));
    setSelection(null);
    setImagePos(null);
    imagePosRef.current = null;
    setDraftBase(null);
  };

  /** 工具栏「换图」:开本册照片选择器(照片就在浏览器本地,不用上传)。 */
  const onReplaceImage = () => {
    if (selection?.kind !== 'image') return;
    setPhotoPickerOpen(true);
  };

  /** 选好了那张:只改数据层,html 的 {{IMG_SRC:slot}} token 原样不动。 */
  const onPickPhoto = (photoId: string) => {
    setPhotoPickerOpen(false);
    if (selection?.kind !== 'image' || editPage == null) return;
    const base = pages[editPage];
    if (!base) return;
    // 换的是内容不是版面:位置/缩放留着,新图沿用当前构图。
    const page = applyImageSwap(base, selection.slotId, photoId);
    previewPage(page);
    persistPage(page.pageIndex, imagesPatchBody(page));
    setDraftBase(page);
  };

  /** 手指还在动:只即时打进书,不落库(与文字面板同一「所见即所存但未存」的口径)。 */
  const onImagePosLive = (pos: ImagePosValue) => {
    if (selection?.kind !== 'image' || !draftBase) return;
    imagePosRef.current = pos;
    setImagePos(pos);
    previewPage(applyImagePos(draftBase, selection.slotId, pos));
  };

  /** 松手即存(同桌面):把这一刻的位置落库。 */
  const onImagePosCommit = () => {
    const pos = imagePosRef.current;
    if (selection?.kind !== 'image' || !draftBase || pos == null || editPage == null) return;
    const page = applyImagePos(draftBase, selection.slotId, pos);
    previewPage(page);
    persistPage(page.pageIndex, imagePosPatchBody(page));
    // 落完把快照推进到当前状态,下一次拖动从这里起算(否则会从最初那次重新算)。
    setDraftBase(page);
  };

  const openPageBgSheet = () => {
    if (editPage == null) return;
    const page = pages[editPage];
    if (!page) return;
    setDraftBase(page);
    setPageBg(readPageBg(page));
    setSheetView('main');
    setSheetKind('pagebg');
  };

  const onPageBgChange = (color: string | null) => {
    if (!draftBase) return;
    setPageBg(color);
    previewPage(applyPageBg(draftBase, color));
  };

  const onPageBgDone = () => {
    if (!draftBase || editPage == null) {
      closeSheet();
      return;
    }
    const page = applyPageBg(draftBase, pageBg);
    previewPage(page);
    persistPage(page.pageIndex, pageBgPatchBody(pageBg));
    closeSheet();
  };

  // 用户上传的画板底图只存在本地(BoardBackground kind==='upload');取不到就回落无背景。
  const boardBg =
    boardBgOverride !== undefined ? boardBgOverride : (detail.album.boardBackground ?? null);

  const applyBoardBg = (bg: BoardBackground | null) => {
    setBoardBgOverride(bg);
    // 视觉属性,持久化失败静默(下次刷新回退,不打断用户)—— 与桌面同一处置。
    void fetch(`/api/v1/albums/${detail.album.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardBackground: bg }),
    }).catch(() => undefined);
  };

  const uploadBoardBg = (file: File) => {
    const key = `boardbg-${detail.album.id}-${file.size}-${file.name}`;
    void _photoStoreForBg
      .put(key, file)
      .then(() => applyBoardBg({ kind: 'upload', key }))
      .catch(() => undefined);
  };

  // ── 导出 / 分享 / 照片备份 ───────────────────────────────────────────────────
  // 渲染与上传全部复用桌面那批库(见 use-export / use-share-link / use-photo-backup),
  // 这里只负责把它们接到移动端的弹窗上。
  const exporter = useExport({
    albumId: detail.album.id,
    title: detail.album.title,
    zh,
    pages,
    background: boardBg,
  });
  const backup = usePhotoBackup(
    detail.album.id,
    // 已备份过的那些不重传(声明顺序:snapshotUrls 在下面才 memo,这里直接读 detail)
    Object.keys(detail.album.photoSnapshotUrls ?? {}),
  );
  const share = useShareLink(detail.album.id, locale, zh);
  // AI 对话:瘦客户端直连 design-chat(桌面那套 ChatPanel 依赖协调器上下文,移动端没有)。
  const chat = useDesignChat(detail.album.id, zh);

  // 导出闸门(与桌面 computeExportUnlocked 同口径):没到 ready / 故事没写完不给导出。
  // allDone 要问 story-progress —— detail 里只有 stage。
  const [storyAllDone, setStoryAllDone] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v3/albums/${detail.album.id}/story-progress`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setStoryAllDone(Boolean(j?.data?.allDone));
      })
      .catch(() => {
        if (!cancelled) setStoryAllDone(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detail.album.id]);
  // 还没问回来时不拦(null):宁可让用户点一下看到提示,也不要把按钮无声禁掉。
  const exportUnlocked =
    storyAllDone == null || computeExportUnlocked(detail.album.stage, storyAllDone);

  /** 书里用到的照片(备份/分享要的就是这一批)。 */
  const bookPhotoIds = photoIds;

  /** 备份照片到云端。顶栏「保存」与「更多」里那条走同一份 —— 两个入口一个行为,
   *  免得日后改文案/口径只改一处。备份态显示在顶栏按钮上,这里只补一句结果提示。 */
  const runBackup = useCallback(() => {
    void backup.backup(bookPhotoIds).then(({ missing, uploaded }) => {
      if (missing === 0) say(zh ? '照片已全部备份' : 'All photos backed up');
      else if (uploaded > 0)
        say(
          zh
            ? `备份了 ${uploaded} 张,还差 ${missing} 张(原图可能不在这台设备)`
            : `Backed up ${uploaded}, ${missing} still missing (originals may be on another device)`,
        );
      else say(zh ? '备份失败,请重试' : 'Backup failed — please retry');
    });
  }, [backup, bookPhotoIds, say, zh]);

  const openExport = () => {
    if (!exportUnlocked) {
      say(zh ? '故事还没写完,写完才能导出' : 'Finish your story first, then you can export');
      return;
    }
    setExportMenuOpen(true);
  };
  useEffect(() => {
    if (boardBg?.kind !== 'upload') {
      setUploadBgUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void photoStore
      .getBlob(boardBg.key)
      .catch(() => undefined)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUploadBgUrl(objectUrl);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [boardBg]);

  const snapshotUrls = useMemo(
    () => detail.album.photoSnapshotUrls ?? {},
    [detail.album.photoSnapshotUrls],
  );
  // 两档都要稳定引用:缩略条按 ctx 引用做 memo,每帧新函数会让整条重渲。
  const resolve: ResolveImage = useCallback(
    (id) => imageUrls[id] ?? snapshotUrls[id],
    [imageUrls, snapshotUrls],
  );
  const resolveThumb: ResolveImage = useCallback(
    (id) => thumbUrls[id] ?? imageUrls[id] ?? snapshotUrls[id],
    [thumbUrls, imageUrls, snapshotUrls],
  );

  const boardBackground =
    boardBg == null
      ? null
      : boardBg.kind === 'color'
        ? boardBg.color
        : boardBg.kind === 'preset'
          ? `center / cover no-repeat url("${presetImageUrl(boardBg.presetId)}")`
          : uploadBgUrl
            ? `center / cover no-repeat url("${uploadBgUrl}")`
            : null;

  return (
    <>
    <MobileEditor
      pages={pages}
      resolve={resolve}
      resolveThumb={resolveThumb}
      boardBackground={boardBackground}
      title={detail.album.title}
      zh={zh}
      onBack={onBack ?? goBack}
      onSave={runBackup}
      backupState={backup.state}
      backupProgress={backup.progress}
      editPage={editPage}
      onEnterEdit={(pi) => {
        // 换页 = 换了编辑对象:选中与开着的面板都失效(rect 也不再对得上)。
        if (pi !== editPage) {
          setSelection(null);
          closeSheet();
        }
        setEditPage(pi);
      }}
      onExitEdit={() => {
        setEditPage(null);
        setSelection(null);
        closeSheet();
      }}
      selection={selection}
      imagePos={selection?.kind === 'image' ? imagePos : null}
      sheetOpen={sheetKind != null}
      onSelectText={onSelectText}
      onSelectImage={onSelectImage}
      onImagePos={onImagePosLive}
      onImagePosCommit={onImagePosCommit}
      onReplaceImage={onReplaceImage}
      onClearImage={onClearImage}
      onResetImagePos={onResetImagePos}
      onClearSelection={() => {
        // 面板开着时点页面空白不该悄悄取消选中(面板正绑在那个槽上)。
        if (sheetKind == null) setSelection(null);
      }}
      onBoardBg={() => {
        setBgSheetView('main');
        setBgSheetOpen(true);
      }}
      onExport={openExport}
      onShare={() => {
        share.reset();
        setShareOpen(true);
      }}
      onPageBg={openPageBgSheet}
      onPickImage={() => {
        // 图片没有面板了:一级栏这格 = 换图入口,与选中框旁工具栏的「换图」同一动作。
        // 缩放/平移不在这里 —— 那两件直接在图上捏合拖动。
        if (selection?.kind === 'image' && editPage != null && pages[editPage]) {
          setPhotoPickerOpen(true);
        } else {
          say(zh ? '点页面上的照片来选中它' : 'Tap a photo on the page to select it');
        }
      }}
      onPickText={() => {
        // 一级栏的「文字」不代表某个具体槽 —— 有选中就把面板叫回来,没选中就告诉
        // 用户怎么选(不做「打开一个不知道在编谁的面板」这种假入口)。
        if (selection?.kind === 'text' && editPage != null && pages[editPage]) {
          openTextSheet(selection, pages[editPage]!);
        } else {
          say(zh ? '点页面上的文字来选中它' : 'Tap the text on the page to select it');
        }
      }}
      onMore={() => setMoreOpen(true)}
      onOpenChat={() => {
        void chat.loadHistory(); // 打开时拉一次历史,两端看到同一段对话
        setAiChatOpen(true);
      }}
      onDeletePage={() => soon('删除页面', 'Delete page')}
    />
    <BoardBgSheet
      open={bgSheetOpen}
      zh={zh}
      current={boardBg}
      view={bgSheetView}
      onOpenPicker={() => setBgSheetView('color')}
      onBackToMain={() => setBgSheetView('main')}
      onClose={() => {
        setBgSheetOpen(false);
        setBgSheetView('main');
      }}
      onPick={(bg) => {
        applyBoardBg(bg);
        // 取色器里连续调色不该每动一下就把弹窗关掉;色板/图片是一次性选择,选完即关。
        if (bgSheetView !== 'color') setBgSheetOpen(false);
      }}
      onUpload={(f) => {
        uploadBoardBg(f);
        setBgSheetOpen(false);
      }}
    />
    <ExportMenuModal
      open={exportMenuOpen}
      zh={zh}
      onClose={() => setExportMenuOpen(false)}
      onCollage={() => {
        setExportMenuOpen(false);
        setCollageOpen(true); // 拼图要先问一张图放几个跨页
      }}
      onLive={() => {
        setExportMenuOpen(false);
        void exporter.exportLive();
      }}
      onSinglePages={() => {
        setExportMenuOpen(false);
        void exporter.exportSinglePages();
      }}
      onPdf={() => {
        setExportMenuOpen(false);
        void exporter.exportPdf();
      }}
    />
    <CollageModal
      open={collageOpen}
      zh={zh}
      spreadCount={interiorSpreads(pages).length}
      density={collageDensity}
      onPickDensity={setCollageDensity}
      onClose={() => setCollageOpen(false)}
      onConfirm={() => {
        const d = collageDensity;
        setCollageOpen(false);
        if (d == null) return;
        void exporter.exportCollage(d as 1 | 2 | 3 | 6);
      }}
    />
    <ExportProgressModal
      open={exporter.progress != null}
      zh={zh}
      label={
        exporter.progress == null
          ? ''
          : exporter.progress.total > 0
            ? `${exporter.progress.done} / ${exporter.progress.total}`
            : '…'
      }
      percent={exporter.progress?.percent ?? 0}
    />
    <ExportFailModal
      open={exporter.failed}
      zh={zh}
      onClose={exporter.dismissFailed}
      onRetry={() => {
        exporter.dismissFailed();
        void exporter.exportPdf();
      }}
    />
    <NoticeModal
      open={exporter.liveUnsupported != null}
      zh={zh}
      title={zh ? '这台设备导不了视频' : 'Video export unavailable'}
      message={exporter.liveUnsupported ?? ''}
      onClose={exporter.dismissLiveUnsupported}
    />
    <MoreSheet
      open={moreOpen}
      zh={zh}
      backupState={backup.state}
      backupProgress={backup.progress}
      onClose={() => setMoreOpen(false)}
      onBackupPhotos={runBackup}
    />
    <ShareLinkModal
      open={shareOpen}
      zh={zh}
      link={share.state.link}
      busy={share.state.stage === 'uploading' || share.state.stage === 'creating'}
      hint={share.state.hint ?? undefined}
      onConfirm={() => void share.create(bookPhotoIds, backup.backup)}
      onCopy={() => void share.copy()}
      onClose={() => setShareOpen(false)}
    />
    {sheetKind != null && (
      <ElementSheet
        open
        zh={zh}
        title={
          sheetView === 'font'
            ? zh ? '字体' : 'Font'
            : sheetView === 'color'
            ? zh ? '颜色' : 'Color'
            : sheetKind === 'text'
              ? zh ? '文字' : 'Text'
              : zh ? '书页背景' : 'Page background'
        }
        onCancel={cancelSheet}
        onDone={sheetKind === 'text' ? onTextDone : onPageBgDone}
      >
        {sheetKind === 'text' && textState != null ? (
          <TextPanel
            zh={zh}
            view={sheetView}
            state={textState}
            onChange={onTextChange}
            onOpenFontList={() => setSheetView('font')}
            onBackToMain={() => setSheetView('main')}
            onMoreColors={() => setSheetView('color')}
          />
        ) : (
          <PageBgPanel
            zh={zh}
            value={pageBg}
            view={sheetView === 'color' ? 'color' : 'main'}
            onChange={onPageBgChange}
            onOpenPicker={() => setSheetView('color')}
            onBackToMain={() => setSheetView('main')}
          />
        )}
      </ElementSheet>
    )}
    <PhotoPickerSheet
      open={photoPickerOpen}
      zh={zh}
      photoIds={photoIds}
      urls={thumbUrls}
      currentPhotoId={
        selection?.kind === 'image' && editPage != null
          ? pages[editPage]?.imagesJson[selection.slotId]
          : null
      }
      onPick={onPickPhoto}
      onClose={() => setPhotoPickerOpen(false)}
    />
    <AiChatSheet
      open={aiChatOpen}
      zh={zh}
      messages={chat.messages}
      status={chat.status}
      onClose={() => setAiChatOpen(false)}
      onSend={(text) =>
        void chat.send(text, editPage, (nextPages) => {
          // AI 改完书:committed 的 pages 直接换上,画板原地反映(不重拉草稿、不闪屏)。
          // 同时把编辑焦点收掉 —— 选中框的 rect 是按旧版面算的,换书后不再对得上。
          setPages(nextPages);
          setSelection(null);
          closeSheet();
        })
      }
    />
    <MobileToast text={toast} />
    </>
  );
}
