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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useRouter } from 'next/navigation';

import { photoStore } from '@/lib/photo/store';
import { presetImageUrl, type BoardBackground } from '@/lib/board-bg/presets';
import { photoStore as _photoStoreForBg } from '@/lib/photo/store';
import { BoardBgSheet } from './modals/BoardBgSheet';
import {
  ExportMenuModal,
  CollageModal,
  LiveStyleModal,
  PdfStyleModal,
  ExportProgressModal,
  ExportReadyModal,
  ExportFailModal,
} from './modals/ExportModals';
import { ShareLinkModal } from './modals/ShareLinkModal';
import { MoreSheet, NoticeModal } from './modals/MoreSheet';
import { useExport } from './use-export';
import { useShareLink } from './use-share-link';
import { usePhotoBackup } from './use-photo-backup';
import { usePhotoOriginalSync } from '@/lib/hooks/use-photo-original-sync';
import { useChromeSession } from '@/components/app/useChromeSession';
import { useChatCoordinator } from './use-chat-coordinator';
import { resolveBackTarget } from './back-nav';
import { ElementSheet } from './modals/ElementSheet';
import { TextPanel } from './modals/TextPanel';
import { PageBgPanel } from './modals/PageBgPanel';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { collectPhotoIds, type ResolveImage } from '../../adapt-layout';
import { interiorSpreads } from '@/lib/export/collage';
import type { DraftSkeleton } from '@/lib/album/authoring-client';
import {
  extractPhotoIds,
  type AlbumDetail,
  type EditorPage,
  type StoryProgress,
} from '../../types';
import { MobileEditor } from './MobileEditor';
import { MobileToast } from './MobileToast';
import { ChatPanel, type ChatMode } from '../ChatPanel';
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
import { swapImageSlots, type SwapSlotRef } from '../image-swap';
import { PhotoPickerSheet } from './modals/PhotoPickerSheet';
import { ReorderSheet } from './modals/ReorderSheet';
import { ModalHost } from './modals/ModalHost';
import { getTemplate } from '@yujee/contracts/templates';
import { FilterSheet } from './modals/FilterSheet';
import type { TextHit, ImageHit } from './EditView';
import {
  normalizePhotoFilterState,
  type PhotoFilterState,
} from '@/lib/photo/filter-state';
import { lutEngine } from '@/lib/photo/lut/engine';
import { useAlbumFonts } from '@/lib/font/album-font-loader';
import {
  createFilterSaveController,
  createLatestCommit,
} from '../filter-controller';
// 样式在容器里引:展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
// token 与桌面共用同一份(共享设计系统,不共享 DOM)。
import '../editor-tokens.css';
import './mobile-editor.css';
// 弹窗借用桌面成品样式(见 modals/ModalHost.tsx)。样式 import 只放容器层 ——
// 展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
import '../editor-port.css';

/** ChatPanel 要求这个 setter(桌面壳用它控 loading 骨架);移动树没有对应 UI,
 *  给一个模块级稳定引用,不在 JSX 里写内联空箭头。 */
const ignoreStoryProgressLoading = () => {};

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
  devExportUnlocked,
  photoFilter: controlledPhotoFilter,
  setPhotoFilter: controlledSetPhotoFilter,
  draftChapters = null,
  chatMode = 'authoring',
}: {
  detail: AlbumDetail;
  /** 书页。**由调用方给** —— 真实相册的书住在草稿(authoring)里,那边的 pages
     带 htmlJson(页面真相);detail.pages 走的是没有 html 的旧表,拿不到真相。 */
  pages: EditorPage[];
  locale: Locale;
  /** 顶栏返回。默认回「我的相册」;dev 预览页覆盖它,免得一点就被踢出预览。 */
  onBack?: () => void;
  /** dev 预览页专用:跳过导出闸门(样例书没有 story-progress,真实相册永远不传)。 */
  devExportUnlocked?: boolean;
  /** EditorPort 提供时跨桌面/移动壳共享；独立预览页不提供时使用本地状态。 */
  photoFilter?: PhotoFilterState | null;
  setPhotoFilter?: Dispatch<SetStateAction<PhotoFilterState | null>>;
  /** 草稿骨架:ChatPanel 的章节卡/追加照片采访要它。authoring 挂载点传真骨架;
     legacy(editing)与 dev 预览没有草稿,传/缺省 null。 */
  draftChapters?: DraftSkeleton | null;
  /** ChatPanel 的模式:V3 真实相册恒为 authoring(与桌面同口径,见 EditorPort
     设备分流处注释);legacy 定稿相册走 editing。 */
  chatMode?: ChatMode;
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
  // 中文字体走 /api/v1/fonts/subset 按需子集,**必须在浏览器里动态注册才存在**。
  // 桌面在 EditorPort、导出在 render-raster/single-pages 都加载了;移动端这棵树曾经
  // 一次都没调 —— 版面里写的 "Noto Serif SC" 等家族根本不存在,整本回退到系统字
  // (PingFang / Songti),字宽字高全变,文字随即溢出固定高度的槽被页根裁掉。
  // fontsReady 往下传:字体到货会改变换行,下游要据此重跑一遍 fitTextBoxes。
  const fontsReady = useAlbumFonts(pages.map((page) => ({ texts: page.textsJson })));
  const [localPhotoFilter, setLocalPhotoFilter] = useState<PhotoFilterState | null>(
    () => normalizePhotoFilterState(detail.album.photoFilter),
  );
  const photoFilter =
    controlledPhotoFilter === undefined ? localPhotoFilter : controlledPhotoFilter;
  const setPhotoFilter = controlledSetPhotoFilter ?? setLocalPhotoFilter;
  const [filterPersistError, setFilterPersistError] = useState<string | null>(null);
  const lastPersistedFilter = useRef(
    JSON.stringify(normalizePhotoFilterState(detail.album.photoFilter)),
  );
  const lutSupported = useMemo(() => lutEngine.isSupported(), []);

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
  // Live 样式(翻页 / 九宫格):与桌面同一步骤 —— 菜单点「Live 图」先选样式再导出。
  const [liveStyleOpen, setLiveStyleOpen] = useState(false);
  const [liveStyle, setLiveStyle] = useState<'flip' | 'nine-grid' | null>(null);
  // PDF 版式(标准 / 印刷 3mm 出血):同 Live 的两步走,但默认预选标准版 ——
  // 大多数人要的就是标准版,少点一下(2026-08-06 版式选择设计)。
  const [pdfStyleOpen, setPdfStyleOpen] = useState(false);
  const [pdfStyle, setPdfStyle] = useState<'standard' | 'bleed'>('standard');
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterScope, setFilterScope] = useState<'book' | 'photo'>('book');
  const [filterPhotoId, setFilterPhotoId] = useState<string | null>(null);
  /** 这次是不是「从某张选中的照片」进来的。是 → 弹窗里给 scope 切换器,可以改成整本书;
   *  否(从「更多 → 全书风格」进来)→ 只有静态标签:那时的 filterPhotoId 只是拿来生成
   *  缩略图的第一张照片,切到「这张照片」等于在改一张用户根本没选过的图。 */
  const [filterPhotoScoped, setFilterPhotoScoped] = useState(false);
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
  const selectedPhotoId =
    selection?.kind === 'image' && editPage != null
      ? pages[editPage]?.imagesJson[selection.slotId] ?? null
      : null;

  // 未实现功能的统一反馈:点了给一句「即将上线」,不做死按钮。
  const [toast, setToast] = useState<string | null>(null);
  /* ── AI 对话 = 桌面同一份 ChatPanel,以贴边抽屉呈现 ──────────────────────────
     宿主 div 带 .editor-port 类(命中桌面对话那批 ≤767 抽屉样式,同 ModalHost 借样
     式的做法),初始 chat-collapsed(收起)。展开/收起走 root class:ChatPanel 自己
     的手柄轻点/下拉会加 chat-collapsed,FAB 把它摘掉 —— 不经 React 状态,与桌面
     .chat-fold-expand / mc-ai-fab 的 openChat 完全同一机制。 */
  const chatRootRef = useRef<HTMLDivElement>(null);
  // ChatPanel 拥有 story-progress 的拉取(挂载即拉、追加照片时轮询);这里只持有状态。
  const [storyProgress, setStoryProgress] = useState<StoryProgress | null>(null);
  // 导出闸门由 ChatPanel 经协调器 setExportGateUi 推过来(它算的是 live stage,比
  // detail.album.stage 新)。默认不拦:宁可点了见提示,不无声禁按钮(与旧口径一致)。
  const [exportGateLocked, setExportGateLocked] = useState(false);
  // 聊天驱动的跳页(章节卡/采访推进):seq 递增让「同一页再跳一次」也生效。
  const [chatNav, setChatNav] = useState<{ page: number; seq: number } | null>(null);
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

  /* 屏显两档的 URL。
     提交器**必须在 effect 内部创建**。早先是 useMemo([]) 建一次 + 一个独立 effect 的
     cleanup 调 dispose() —— 而 dispose 是不可逆的(disposed 没有任何地方改回 false)。
     React StrictMode(Next dev 默认开)会「装作卸载一次再重新挂载」,于是:
       挂载 → 建提交器 → run() → **模拟卸载** → dispose() 永久置位 → 再 run() 直接空转
     提交器活在 useMemo 里、同一个组件实例的模拟重挂不会重建它,结果是 imageUrls 永远
     停在 {},整本书 20 个图槽全部渲染成透明占位 gif —— 真机症状就是「桌面有照片,
     一缩到移动宽度全没了」。桌面免疫是因为那条路(EditorAuthoring)用朴素 cancelled
     标志解析首帧、把结果当 prop 传下去,压根不走这个提交器。
     建在 effect 内:模拟卸载 dispose 掉的是那一对,重跑时新建一对。真卸载同样正确,
     而且不再需要 invalidate —— dispose 已经含了它(generation += 1)。
     守卫见 mobile-image-urls.test.ts。 */
  useEffect(() => {
    const display = createLatestCommit<Record<string, string>>(setImageUrls);
    const thumb = createLatestCommit<Record<string, string>>(setThumbUrls);
    void display.run(() =>
      photoStore.getTierUrls(photoIds, 'display', photoFilter).catch(() => ({})),
    );
    void thumb.run(() =>
      photoStore.getTierUrls(photoIds, 'thumb', photoFilter).catch(() => ({})),
    );
    return () => {
      display.dispose();
      thumb.dispose();
    };
  }, [photoIds, photoFilter]);

  const filterSaver = useMemo(
    () =>
      createFilterSaveController({
        save: async (state, signal) => {
          const response = await fetch(`/api/v1/albums/${detail.album.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photoFilter: state }),
            signal,
          });
          const json = (await response.json().catch(() => null)) as {
            ok?: boolean;
            data?: { photoFilter?: PhotoFilterState | null };
            error?: { message?: string };
          } | null;
          if (!response.ok || !json?.ok) {
            throw new Error(
              json?.error?.message ?? `filter PATCH failed (${response.status})`,
            );
          }
          return normalizePhotoFilterState(json.data?.photoFilter ?? state);
        },
        onSuccess: (normalized) => {
          const serialized = JSON.stringify(normalized);
          lastPersistedFilter.current = serialized;
          setFilterPersistError(null);
          setPhotoFilter((current) =>
            JSON.stringify(current) === serialized ? current : normalized,
          );
        },
        onError: (error) => setFilterPersistError(error.message),
      }),
    [detail.album.id],
  );
  useEffect(() => {
    const serialized = JSON.stringify(photoFilter);
    if (serialized !== lastPersistedFilter.current) filterSaver.schedule(photoFilter);
  }, [filterSaver, photoFilter]);
  useEffect(() => () => filterSaver.dispose(), [filterSaver]);

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

  /** 长按拖拽交换两个图槽(可跨页)。交换语义与「为什么是长按」都在 image-swap.ts。
   *  只动数据层,html 不碰;两页各发一次单页 PATCH(与换图同一条通道)。 */
  const onSwapImage = (from: SwapSlotRef, to: SwapSlotRef) => {
    const result = swapImageSlots(pages, from, to);
    if (!result) return;
    setPages(result.pages);
    for (const pageIndex of result.touched) {
      const next = result.pages.find((p) => p.pageIndex === pageIndex);
      if (next) persistPage(pageIndex, imagesPatchBody(next));
    }
    // 选中的那个槽内容变了,面板快照跟着走;选中框本身(位置)没变,不必重选。
    if (selection?.kind === 'image' && editPage != null) {
      const current = result.pages[editPage];
      if (current) setDraftBase(current);
    }
  };

  // ── 页序弹窗(2026-08-02 设计):主菜单入口,ReorderSheet 里拖拽插入重排。──
  // 「完成」才到这里:乐观重排 + 原子 reorder,失败回滚 + toast,与桌面同口径。
  const [reorderOpen, setReorderOpen] = useState(false);
  const commitReorder = (perm: number[]) => {
    const prev = pages;
    setPages(perm.map((oldIdx, newIdx) => ({ ...prev[oldIdx]!, pageIndex: newIdx })));
    void fetch(`/api/v1/albums/${detail.album.id}/pages/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permutation: perm }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`reorder ${res.status}`);
      })
      .catch(() => {
        setPages(prev);
        say(zh ? '页序没有存上，已恢复原顺序，请重试' : 'Order not saved; restored — please retry');
      });
  };

  // ── 删除书页(2026-08-03 设计):确认弹窗 → 乐观删除 + DELETE,失败回滚 + toast,
  // 与 commitReorder 同口径。spread 记录当前页是否双宽 —— 双宽净减 2 个页位后续
  // 不移位,不用提示翻面;普通内页净减 1,后续页左右互换,确认弹窗里明说。
  const [deleteConfirm, setDeleteConfirm] = useState<{ pageIndex: number; spread: boolean } | null>(
    null,
  );
  const requestDeletePage = () => {
    if (editPage == null || !pages[editPage]) return;
    const tpl = getTemplate(pages[editPage]!.templateId);
    if (tpl?.category !== 'interior') {
      say(zh ? '封面、目录和封底不能删除' : 'Cover, contents and ending pages cannot be deleted');
      return;
    }
    const interiorCount = pages.filter(
      (p) => getTemplate(p.templateId)?.category === 'interior',
    ).length;
    if (interiorCount <= 1) {
      say(zh ? '这是最后一张内页，不能删除' : 'The last interior page cannot be deleted');
      return;
    }
    setDeleteConfirm({ pageIndex: editPage, spread: tpl.spread === true });
  };
  const commitDeletePage = (pageIndex: number) => {
    const prev = pages;
    // 线上契约:URL 里的 idx 是页对象的 pageIndex **字段**(与 persistPage 同口径),
    // 不是数组下标 —— 存量相册的字段可能不连续(2026-08-03 线上 400 复盘)。
    // 本地状态仍按数组位置操作(editPage 是数组下标)。
    const wireIndex = prev[pageIndex]?.pageIndex;
    if (wireIndex == null) return;
    setPages(prev.filter((_, i) => i !== pageIndex).map((p, newIdx) => ({ ...p, pageIndex: newIdx })));
    // 被删的页正处于编辑焦点,必须退出编辑态(留着会指到错位的页)。
    setEditPage(null);
    setSelection(null);
    closeSheet();
    void fetch(`/api/v1/albums/${detail.album.id}/pages/${wireIndex}`, { method: 'DELETE' })
      .then((res) => {
        if (!res.ok) throw new Error(`delete ${res.status}`);
      })
      .catch(() => {
        setPages(prev);
        say(zh ? '页面没有删掉，已恢复，请重试' : 'Page not deleted; restored — please retry');
      });
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
  /** 已备份到服务器的压缩图(photoId→URL)。本地没有原图时的回落。
   *  **展示与导出共用这一份** —— 早先只有展示层接了它,导出自建 resolver 没接,
   *  换设备/清缓存后导出出来是一本空图(见 lib/photo/export-backup-fallback.test.ts)。
   *  声明必须在 useExport 之前:它是 const,放在后面就是 TDZ。 */
  const snapshotUrls = useMemo(
    () => detail.album.photoSnapshotUrls ?? {},
    [detail.album.photoSnapshotUrls],
  );

  // 游客态(匿名影子账号):保存/分享弹登录、导出只本地交付、关自动上云。
  const viewerSession = useChromeSession();
  const isGuest = Boolean(viewerSession.user?.isAnonymous);
  const goLogin = useCallback(() => {
    window.location.assign(
      localizePath(`/login?from=/album/${detail.album.id}`, locale),
    );
  }, [detail.album.id, locale]);

  const exporter = useExport({
    albumId: detail.album.id,
    title: detail.album.title,
    zh,
    pages,
    background: boardBg,
    photoFilter,
    // 展示层与导出层用**同一份**备份表:本地没有原图时都回落到它。
    snapshotUrls,
    skipCloudUpload: isGuest,
  });
  const backup = usePhotoBackup(
    detail.album.id,
    photoFilter,
    detail.album.photoSnapshotRenderVersions ?? {},
  );
  // Task 8(照片真相迁 R2 Phase 0):对账补传 + 远端原图 fetcher,复用上面已算好
  // 的 photoIds(与展示/导出同一份去重来源)。
  usePhotoOriginalSync({
    albumId: detail.album.id,
    photoIds,
    // 游客零 R2 写入:确认是真实账号才开自动对账补传(服务端对游客也是 403)。
    enabled: Boolean(viewerSession.user && !viewerSession.user.isAnonymous),
  });
  const share = useShareLink(detail.album.id, locale, zh);

  // 导出闸门:ChatPanel 挂载即拉 story-progress 并经 setExportGateUi 推锁态过来
  // (追加照片的整个流程里它还会持续轮询刷新)—— 不再自己发第二份同样的请求。
  // devExportUnlocked:dev 预览页直通(样例书没有 story-progress,真实相册不传)。
  const exportUnlocked = devExportUnlocked ?? !exportGateLocked;

  /** 书里用到的照片(备份/分享要的就是这一批)。 */
  const bookPhotoIds = photoIds;
  const openBookFilter = useCallback(() => {
    if (!lutSupported) return;
    setMoreOpen(false);
    setFilterScope('book');
    setFilterPhotoScoped(false);
    setFilterPhotoId(bookPhotoIds[0] ?? null);
    setFilterOpen(true);
  }, [bookPhotoIds, lutSupported]);
  const openSelectedPhotoFilter = useCallback(() => {
    if (!lutSupported || !selectedPhotoId) return;
    setFilterScope('photo');
    setFilterPhotoScoped(true);
    setFilterPhotoId(selectedPhotoId);
    setFilterOpen(true);
  }, [lutSupported, selectedPhotoId]);

  /** 备份照片到云端。顶栏「保存」与「更多」里那条走同一份 —— 两个入口一个行为,
   *  免得日后改文案/口径只改一处。备份态显示在顶栏按钮上,这里只补一句结果提示。 */
  /** 整本重传:把存量的老档备份覆盖成当前上传档(3400)。同 key、同 renderVersion,
   *  所以不会把已有分享打成 409;只是字节更好了。 */
  const rebackup = useCallback(() => {
    if (isGuest) { setMoreOpen(false); goLogin(); return; }
    setMoreOpen(false);
    say(zh ? '正在重新备份…' : 'Re-backing up…');
    void backup.backup(bookPhotoIds, true).then(({ missing, uploaded }) => {
      if (missing === 0) say(zh ? `已重新备份 ${uploaded} 张` : `Re-backed up ${uploaded}`);
      else say(zh ? `还差 ${missing} 张(原图可能不在这台设备)` : `${missing} still missing (originals may be on another device)`);
    });
  }, [backup, bookPhotoIds, say, zh]);

  const runBackup = useCallback(() => {
    // 游客门禁:保存 = 照片快照上云,真实账号能力。
    if (isGuest) { goLogin(); return; }
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

  // 两档都要稳定引用:缩略条按 ctx 引用做 memo,每帧新函数会让整条重渲。
  const resolve: ResolveImage = useCallback(
    (id) => imageUrls[id] ?? snapshotUrls[id],
    [imageUrls, snapshotUrls],
  );
  const resolveThumb: ResolveImage = useCallback(
    (id) => thumbUrls[id] ?? imageUrls[id] ?? snapshotUrls[id],
    [thumbUrls, imageUrls, snapshotUrls],
  );

  // ── ChatPanel 的移动协调器(实现见 use-chat-coordinator.ts) ─────────────────
  // 聊天跳页:编辑态先收回浏览(选中框/面板的 rect 都是按旧焦点算的),再挪浏览游标。
  const goToPage = useCallback((pageIndex: number) => {
    setEditPage(null);
    setSelection(null);
    closeSheet();
    setChatNav((prev) => ({ page: pageIndex, seq: (prev?.seq ?? 0) + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 设计对话 committed:整书原地替换(协调器已重编号),同时把编辑焦点收掉 ——
  // 选中框的 rect 是按旧版面算的,换书后不再对得上(与旧 AiChatSheet 回调同口径)。
  const replacePagesFromChat = useCallback((next: EditorPage[]) => {
    setPages(next);
    setSelection(null);
    closeSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chatCoordinator = useChatCoordinator({
    pages,
    editPage,
    draftChapters,
    resolve,
    replacePages: replacePagesFromChat,
    goToPage,
    setExportGateLocked,
    exportPdf: exporter.exportPdf,
  });

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
      fontsReady={fontsReady}
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
      photoFilter={photoFilter}
      selectedPhotoId={selectedPhotoId}
      lutSupported={lutSupported}
      sheetOpen={sheetKind != null}
      onSelectText={onSelectText}
      onSelectImage={onSelectImage}
      onImagePos={onImagePosLive}
      onImagePosCommit={onImagePosCommit}
      onSwapImage={onSwapImage}
      onReorder={commitReorder}
      onReplaceImage={onReplaceImage}
      onClearImage={onClearImage}
      onResetImagePos={onResetImagePos}
      onPhotoFilter={openSelectedPhotoFilter}
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
        // 游客门禁:分享要冻结快照+写库,真实账号能力。
        if (isGuest) { goLogin(); return; }
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
        // 展开抽屉 = 摘掉 root 的 chat-collapsed(ChatPanel 收起时自己会把类加回去,
        // 与桌面 .chat-fold-expand / mc-ai-fab 的 openChat 同一机制,不经 React 状态)。
        chatRootRef.current?.classList.remove('chat-collapsed');
      }}
      navSignal={chatNav}
      onDeletePage={requestDeletePage}
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
        setLiveStyle(null); // 每次重新选,不带上次的残留
        setLiveStyleOpen(true);
      }}
      onSinglePages={() => {
        setExportMenuOpen(false);
        void exporter.exportSinglePages();
      }}
      onPdf={() => {
        setExportMenuOpen(false);
        setPdfStyle('standard'); // 每次打开都回到标准版,不带上次的残留
        setPdfStyleOpen(true);
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
    <LiveStyleModal
      open={liveStyleOpen}
      zh={zh}
      style={liveStyle}
      onPickStyle={setLiveStyle}
      onClose={() => setLiveStyleOpen(false)}
      onConfirm={() => {
        const picked = liveStyle;
        setLiveStyleOpen(false);
        if (picked === 'nine-grid') void exporter.exportNineGrid();
        else if (picked === 'flip') void exporter.exportLive();
      }}
    />
    <PdfStyleModal
      open={pdfStyleOpen}
      zh={zh}
      style={pdfStyle}
      onPickStyle={setPdfStyle}
      onClose={() => setPdfStyleOpen(false)}
      onConfirm={() => {
        const picked = pdfStyle;
        setPdfStyleOpen(false);
        // 出血值 3 只在这一层出现;use-export 只透传(见 pdf-bleed-wiring.test)。
        if (picked === 'bleed') void exporter.exportPdf({ bleedMm: 3 });
        else void exporter.exportPdf();
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
    <ExportReadyModal
      open={exporter.exportReady}
      zh={zh}
      label={exporter.exportReadyLabel}
      manualFiles={exporter.exportManualFiles}
      onClose={exporter.dismissExportReady}
      onSave={() => {
        void exporter.deliverExport().then((result) => {
          if (result === 'shared') say(zh ? '已打开系统分享' : 'Opened system sharing');
          else if (result === 'downloaded')
            say(zh ? '文件已开始下载' : 'File download started');
          else if (result === 'manual')
            say(zh ? '这台手机打不开系统分享，改成逐张保存' : 'No share sheet here — save them one by one');
        });
      }}
      onSaveFile={(i) => exporter.saveExportFile(i)}
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
      lutSupported={lutSupported}
      onClose={() => setMoreOpen(false)}
      onReorderPages={() => {
        setMoreOpen(false);
        setReorderOpen(true);
      }}
      onBackupPhotos={runBackup}
      onRebackupPhotos={rebackup}
      onPhotoFilter={openBookFilter}
    />
    <ReorderSheet
      open={reorderOpen}
      zh={zh}
      pages={pages}
      resolve={resolveThumb}
      onClose={() => setReorderOpen(false)}
      onCommit={commitReorder}
    />
    <ModalHost
      open={deleteConfirm != null}
      onClose={() => setDeleteConfirm(null)}
      ariaLabel={zh ? '删除页面' : 'Delete page'}
      testId="delete-page-confirm"
    >
      <div className="mdel-body">
        <p className="mdel-title">{zh ? '删除这一页？' : 'Delete this page?'}</p>
        <p className="mdel-text">
          {zh ? '页面上的照片和文字会一起移除。' : 'Its photos and text will be removed together.'}
        </p>
        {deleteConfirm != null && !deleteConfirm.spread && (
          <p className="mdel-text mdel-warn">
            {zh
              ? '删除后，这一页之后的页面左右位置会互换。'
              : 'After deleting, pages after this one will swap left/right sides.'}
          </p>
        )}
      </div>
      <div className="mdel-actions">
        <button type="button" className="mdel-btn" onClick={() => setDeleteConfirm(null)}>
          {zh ? '取消' : 'Cancel'}
        </button>
        <button
          type="button"
          className="mdel-btn mdel-danger"
          data-testid="delete-page-confirm-btn"
          onClick={() => {
            const target = deleteConfirm;
            setDeleteConfirm(null);
            if (target) commitDeletePage(target.pageIndex);
          }}
        >
          {zh ? '删除' : 'Delete'}
        </button>
      </div>
    </ModalHost>
    {lutSupported && filterOpen && (
      <FilterSheet
        open
        locale={locale}
        state={photoFilter}
        scope={filterScope}
        photoId={filterPhotoId}
        persistError={filterPersistError}
        onChange={setPhotoFilter}
        onScopeChange={filterPhotoScoped ? setFilterScope : undefined}
        onRetry={() => filterSaver.retry()}
        onClose={() => setFilterOpen(false)}
      />
    )}
    {filterPersistError && !filterOpen && (
      <button
        type="button"
        className="mobile-filter-save-toast"
        role="alert"
        onClick={() => {
          setFilterOpen(true);
          filterSaver.retry();
        }}
      >
        {zh ? '风格保存失败，点此重试' : 'Style failed to save. Tap to retry.'}
      </button>
    )}
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
    {/* AI 对话:桌面同一份 ChatPanel(完整弹窗 —— 对话/历史回放/采访/加照片/发送),
        以左右、底边贴屏的抽屉呈现。生成阶段与成书之后从此是同一个弹窗,不再有第二套
        瘦实现(2026-08-03 之前的 AiChatSheet 已删)。宿主是 .mobile-editor 的兄弟节点:
        树内 touch-action:none / user-select:none 会废掉输入框与滚动。 */}
    <div
      ref={chatRootRef}
      className="editor-port mobile-chat-port chat-collapsed font-sans antialiased leading-relaxed"
    >
      <ChatPanel
        key={detail.album.id}
        detail={detail}
        locale={locale}
        mode={chatMode}
        draftChapters={draftChapters}
        outerRootRef={chatRootRef}
        coordinator={chatCoordinator}
        breadcrumbStage={storyProgress?.stage ?? detail.album.stage ?? 'analysing'}
        storyProgress={storyProgress}
        setStoryProgress={setStoryProgress}
        setStoryProgressLoading={ignoreStoryProgressLoading}
      />
    </div>
    <MobileToast text={toast} />
    </>
  );
}
