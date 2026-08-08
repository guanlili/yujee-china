'use client';

/* ════════════════════════════════════════════════════════════════════════════
   MobileEditor —— 移动端自己的那棵 UI 树。

   与桌面 EditorPort **不共用任何一个 DOM 节点**:这棵树里的节点全部由 React 拥有,
   桌面那边的 renderOverview/innerHTML 重建碰不到它们。共享的只有:
     · page-face(一页书长什么样)
     · browse-window / fit-box(这一屏显示什么、怎么摆)
     · 落库通道(HTTP,后续切片接)
   手势、chrome、面板全部各写各的 —— 手机和电脑本来就该不一样。

   浏览态布局(按设计稿):顶栏(返回/书名/分享·导出·更多) + 画板(书居中浮在垫底
   背景上,底色由相册的画板背景属性决定、默认走网页端同款 --bg;左下角画板背景
   圆钮、右下角 AI 气泡) + 底部书册预览栏(渲染真实版面,照片走 thumb 档)。
   **书不做自由缩放**:浏览态固定双页,尺寸由 fitBox 算好重绘,不用 transform 拉伸。

   本文件刻意不 import photoStore / fetch 之类的副作用:数据加载在 MobileEditorRoot,
   这样这棵树能被 renderToStaticMarkup 直接断言(仓里无 jsdom)。
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AT } from '@/lib/i18n/pick';

import type { EditorPage } from '../../types';
import { buildSpreads, isSoloSpread, pageSlot, spreadPageIndices, spreadRenderKind } from '../../spreads';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';
import { pageFolioInfos } from '../../page-html-dom';
import { useFitTextBoxes } from '../../use-fit-text-boxes';
import type { ResolveImage } from '../../adapt-layout';
import type { Density } from '../mobile-canvas';
import { browseScreen, browseUnits, stepScreen, screenStartOfPage, type BrowseScreen } from './browse-window';
import { fitBox, spreadAspect } from './fit-box';
import {
  EDGE_FLIP_MS,
  FLIP_EASE,
  FLIP_MS,
  FLIP_SETTLE_MS,
  edgeBackHalf,
  edgeLayers,
  edgeMotion,
  flipTransition,
  leafGeometry,
  leafHalves,
  leafLayers,
  leafShading,
  type FlipDir,
  type FlipTransition,
  type LeafHalf,
  type ScreenShape,
} from './flip';
import { EditView, type TextHit, type ImageHit } from './EditView';
import { MobileTopbar } from './MobileTopbar';
import { MobileStrip } from './MobileStrip';
import { IconBoardBg } from './icons';
import type { SelRect } from './page-edit';
import type { ImagePosValue } from '../image-edit-util';
import type { SwapSlotRef } from '../image-swap';
import type { PhotoFilterState } from '@/lib/photo/filter-state';

export type MobileEditorProps = {
  pages: EditorPage[];
  /** 相册子集字体是否已注册(见 MobileEditorRoot 的 useAlbumFonts)。
   *  字体到货会改变换行 → 文字槽的字号自适应必须据此重跑一遍。 */
  fontsReady: boolean;
  resolve: ResolveImage;
  /** 缩略档(thumb tier)解析器,给书册预览栏用;缺省回落主画布那档。 */
  resolveThumb?: ResolveImage;
  /** 垫底画板背景的 CSS background 值(相册级),无则走网页端默认底(--bg)。 */
  boardBackground?: string | null;
  title: string;
  aT: AT;
  onBack?: () => void;
  /** 正在编辑的页(null = 浏览态)。**由父层持有** —— 弹窗与落库都住在
     MobileEditorRoot,它必须知道用户在编哪一页,否则任何页级改动无处可落。 */
  editPage: number | null;
  onEnterEdit: (pageIndex: number) => void;
  onExitEdit: (pageIndex: number) => void;
  /** 编辑态的选中态(同样由父层持有:面板要绑到被选中的槽上)。 */
  selection: { slotId: string; rect: SelRect } | null;
  /** 选中的是图片时它当前的位置/缩放(拖动/捏合的起点)。 */
  imagePos: ImagePosValue | null;
  photoFilter: PhotoFilterState | null;
  selectedPhotoId: string | null;
  lutSupported: boolean;
  sheetOpen: boolean;
  onSelectText: (hit: TextHit) => void;
  onSelectImage: (hit: ImageHit) => void;
  onImagePos: (pos: ImagePosValue) => void;
  onImagePosCommit: () => void;
  /** 长按拾起一张图拖到另一个图槽 → 两个槽对调(可跨页)。 */
  onSwapImage: (from: SwapSlotRef, to: SwapSlotRef) => void;
  /** 预览栏长按拖拽换序(2026-08-02):非恒等置换即拖即存,落库在容器层。 */
  onReorder: (permutation: number[]) => void;
  /** 图片工具栏三件(透传给 EditView)。 */
  onReplaceImage: () => void;
  onClearImage: () => void;
  onResetImagePos: () => void;
  onPhotoFilter: () => void;
  onClearSelection: () => void;
  /** 交互 handler 一律必填 —— 「可选」等于「可以不接」,漏一个就是死按钮。
     必填后:谁漏传谁编译不过(见 MobileEditorRoot)。 */
  /** 顶栏「保存」= 备份照片到云端(同桌面那枚),透传给 MobileTopbar。 */
  onSave: () => void;
  backupState: 'idle' | 'backing-up' | 'backed-up' | 'failed';
  backupProgress: { done: number; total: number } | null;
  onShare: () => void;
  onExport: () => void;
  onMore: () => void;
  onBoardBg: () => void;
  onOpenChat: () => void;
  /** 聊天驱动的跳页(章节卡/采访推进):浏览游标对齐到 page 所在的屏。
     seq 递增触发 —— 同一页再跳一次也要重新对齐(用户可能已翻走)。 */
  navSignal?: { page: number; seq: number } | null;
  onPageBg: () => void;
  onPickImage: () => void;
  onPickText: () => void;
  onDeletePage: () => void;
};

/** 书页四周露出的垫底背景(px):书居中浮起,不顶满可视区。 */
const INSET = 24;
/** 移动浏览只保留一个双页跨页；共享 Density 仍保留 1/4 给其他旧调用方。 */
const MOBILE_BROWSE_DENSITY = 2 as const satisfies Density;
/** iOS 左缘返回手势让位。 */
const EDGE_GUARD = 20;
/** 判定为横滑的最小位移。 */
const SWIPE_MIN = 48;
/** 位移在此以内视为轻点(而非滑动)。 */
const TAP_MAX = 10;

export function MobileEditor({
  pages,
  fontsReady,
  resolve,
  resolveThumb,
  boardBackground,
  title,
  aT,
  onBack,
  editPage,
  onEnterEdit,
  onExitEdit,
  selection,
  imagePos,
  photoFilter,
  selectedPhotoId,
  lutSupported,
  sheetOpen,
  onSelectText,
  onSelectImage,
  onImagePos,
  onImagePosCommit,
  onSwapImage,
  onReorder,
  onReplaceImage,
  onClearImage,
  onResetImagePos,
  onPhotoFilter,
  onClearSelection,
  onSave,
  backupState,
  backupProgress,
  onShare,
  onExport,
  onMore,
  onBoardBg,
  onOpenChat,
  navSignal,
  onPageBg,
  onPickImage,
  onPickText,
  onDeletePage,
}: MobileEditorProps) {
  const [startPage, setStartPage] = useState(0);
  const [area, setArea] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const boardRef = useRef<HTMLDivElement>(null);

  // 翻纸动效:anim 非 null = 正在翻,toStart 是翻完之后的游标。
  const [anim, setAnim] = useState<{
    dir: FlipDir;
    toStart: number;
    transition: FlipTransition;
  } | null>(null);
  const [leafAngle, setLeafAngle] = useState(0);
  const [bookShiftPct, setBookShiftPct] = useState(0);
  const flipTimer = useRef<number | null>(null);
  // 无障碍:系统设了减弱动效就不翻纸,直接切(同 FlipBook)。渲染期不读 matchMedia。
  const [reducedMotion, setReducedMotion] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReducedMotion(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  useLayoutEffect(
    () => () => {
      if (flipTimer.current != null) window.clearTimeout(flipTimer.current);
    },
    [],
  );

  const spreads = useMemo(() => buildSpreads(pages), [pages]);
  const folioInfos = useMemo(() => pageFolioInfos(pages.map((p) => p.templateId)), [pages]);
  const screen = useMemo(
    () => browseScreen(spreads, pages, startPage, MOBILE_BROWSE_DENSITY),
    [spreads, pages, startPage],
  );
  /* 缩略条的格子。**不依赖 startPage** —— 翻页只挪高亮,不该让整条重新分组。 */
  const stripUnits = useMemo(
    () => browseUnits(spreads, pages, MOBILE_BROWSE_DENSITY),
    [spreads, pages],
  );

  /* 聊天驱动的跳页:只认 seq 变化(spreads/pages 变不该触发重跳 —— 那是换书,
     游标已由别的逻辑处理);跳的瞬间从当前 spreads 取最新对齐。 */
  useEffect(() => {
    if (!navSignal) return;
    setStartPage(screenStartOfPage(spreads, pages, navSignal.page, MOBILE_BROWSE_DENSITY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navSignal?.seq]);

  /** 一个开页在本屏里实际摆出来的「面」。
   *  三种画法与桌面共用同一套分类(spreadRenderKind):
   *    solo 封面/封尾 → 单页宽容器,一张面
   *    full 双宽跨页(#303)→ 双页宽容器,**同一页摆两次**(左半裁/右半裁)——
   *      装订在一起的两个半页:有中缝、各带页码角、各自参与翻页(位置即半边)
   *    pair 普通内页 → 双页宽容器,左右各一半(null = 空白半页)
   *  返回 faces 与 wide:wide 决定容器按几页宽算,faces.length 决定摆几张面。 */
  const layoutOf = useCallback(
    (scr: BrowseScreen, si: number): { faces: (number | null)[]; wide: 1 | 2 } => {
      const sp = spreads[si];
      if (!sp) return { faces: [], wide: 1 };
      // 在 sp.kind 上窄化(不是在 spreadRenderKind 的返回值上)—— 这样读 .left/.right
      // 才是类型安全的,也正是 #303 把 Spread 改成判别式联合要达到的效果。
      if (sp.kind === 'full') return { faces: [sp.page, sp.page], wide: 2 };
      // 密度 1:开页内只留游标那一页(双宽页不适用 —— 它没有半页可留)
      if (scr.onlyPage !== null) return { faces: [scr.onlyPage], wide: 1 };
      if (isSoloSpread(sp, pages)) return { faces: spreadPageIndices(sp), wide: 1 };
      return { faces: [sp.left, sp.right], wide: 2 };
    },
    [spreads, pages],
  );

  /** 一屏只有一个开页时它的半边,否则 null。
   *  翻纸两端都必须经这个口子取 —— 曾经拿**当前屏的开页序号**去查目标屏,
   *  halvesOf 读的是 spreads[si],于是查回来还是当前那个开页:纸片正反面画的是同一屏,
   *  看起来「翻了但没换页」。单测抓不到(纯函数本身是对的),只有真机能看出来。 */
  const soleLayout = useCallback(
    (scr: BrowseScreen): { faces: (number | null)[]; wide: 1 | 2 } | null =>
      scr.spreadIndices.length === 1 ? layoutOf(scr, scr.spreadIndices[0]!) : null,
    [layoutOf],
  );

  /** 一屏的形状,喂给 flip.ts 判断能不能翻纸。 */
  const shapeOf = useCallback(
    (scr: BrowseScreen): ScreenShape | null => {
      const si = scr.spreadIndices[0];
      const lay = soleLayout(scr);
      if (lay == null || si == null) return null;
      const kind = spreadRenderKind(spreads[si], pages);
      const pageIndex = spreadPageIndices(spreads[si])[0];
      const slot =
        kind === 'solo' && pageIndex != null && pages[pageIndex]
          ? pageSlot(pages[pageIndex]!)
          : null;
      return {
        rows: scr.spreadIndices.length,
        faces: lay.faces.length,
        soloRole: slot === 'cover' || slot === 'ending' ? slot : null,
        full: kind === 'full',
      };
    },
    [soleLayout, spreads, pages],
  );

  /** 翻一屏。纯函数同时决定普通跨页、封面左翻、封尾右翻或安全直切。 */
  const goScreen = (dir: 1 | -1) => {
    if (anim) return; // 翻纸过程中不接新的翻页(同 FlipBook)
    const toStart = stepScreen(spreads, pages, startPage, MOBILE_BROWSE_DENSITY, dir);
    if (toStart === startPage) return; // 已在夹边
    const to = browseScreen(spreads, pages, toStart, MOBILE_BROWSE_DENSITY);
    const fromShape = shapeOf(screen);
    const toShape = shapeOf(to);
    const d: FlipDir = dir === 1 ? 'next' : 'prev';
    const transition =
      fromShape != null && toShape != null
        ? flipTransition(fromShape, toShape, d, reducedMotion)
        : null;
    if (!transition) {
      setStartPage(toStart);
      return;
    }
    const edge = transition === 'spread' ? null : edgeMotion(transition);
    setLeafAngle(edge?.startAngle ?? 0);
    setBookShiftPct(edge?.startShiftPct ?? 0);
    setAnim({ dir: d, toStart, transition });
    // 下一帧才给终止角,transition 才会跑(同 FlipBook)。
    requestAnimationFrame(() => {
      setLeafAngle(
        transition === 'spread'
          ? leafGeometry(d, fromShape!.faces).endAngle
          : edge!.endAngle,
      );
      setBookShiftPct(edge?.endShiftPct ?? 0);
    });
    flipTimer.current = window.setTimeout(() => {
      setStartPage(toStart);
      setAnim(null);
      setLeafAngle(0);
      setBookShiftPct(0);
      flipTimer.current = null;
    }, (edge ? EDGE_FLIP_MS : FLIP_MS) + FLIP_SETTLE_MS);
  };

  // 量板子;每页多大由 fitBox 算出来,不靠 CSS 比例硬凑(会被 max-width 夹破)。
  //
  // 依赖必须带上 browsing:进编辑态时这棵子树整个 return 成 EditView,浏览态的 .mboard
  // **被卸载**。若依赖是 []:①effect 不重跑,②RO 还盯着那个已脱离文档的旧节点。返回浏览态
  // 挂的是新节点,却永远量不到 → area 停在 0 → fitBox(0) → 整页渲染成空串 → 书全白且
  // 再也回不来。这是真实事故「从编辑返回内容被清空」的根因。
  const browsing = editPage == null;
  useLayoutEffect(() => {
    if (!browsing) return;
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // 0×0 一律不收:节点被卸载/藏起来时 RO 会报 0,拿它覆盖掉好的测量值就是上面那个事故。
      // 留着上一次的好尺寸,返回时首帧就能正确渲染,不闪白。
      if (r.width < 1 || r.height < 1) return;
      setArea((prev) =>
        Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
          ? prev // 同尺寸不重渲,避免 ResizeObserver 自激
          : { w: r.width, h: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [browsing]);

  // 文字槽的字号自适应(实现与「字体到货后再收一次」都在 useFitTextBoxes)。
  // 模板把文字槽写死成固定高度、页根又是 overflow:hidden —— 不收字号,溢出的部分就被
  // **裁掉**。桌面在 paintEl、导出在 render-raster 都跑这一步,移动端曾经整棵树都没跑,
  // 这正是「手机上文字被切掉一截」的根因之一(另一半是没加载子集字体)。
  //
  // 挂在 .mboard 上跑一次即可:那一步是对 root 内所有 [data-text-key] 的遍历,一屏里的
  // 两张面、翻纸时的正反面都在这个容器内,不必逐个 face 各挂一遍。幂等且带记忆化。
  useFitTextBoxes(boardRef, browsing);

  const ctxOf = (pageIdx: number): PageFaceCtx => ({
    folio: folioInfos[pageIdx]?.folio ?? null,
    folioSide: folioInfos[pageIdx]?.side ?? 'right',
    total: pages.length,
    resolve,
  });

  // 缩略条的 ctx 必须是稳定引用:它是整条 useMemo 的依赖,每帧新函数 = 每帧重渲几十页。
  const thumbCtxOf = useCallback(
    (pageIdx: number): PageFaceCtx => ({
      folio: folioInfos[pageIdx]?.folio ?? null,
      folioSide: folioInfos[pageIdx]?.side ?? 'right',
      total: pages.length,
      resolve: resolveThumb ?? resolve,
    }),
    [folioInfos, pages.length, resolveThumb, resolve],
  );

  // 单指左右滑翻屏;轻点进编辑。竖滑不响应 —— 浏览态画布不滚(手机上「滚动的画布」
  // 和「滚动的页面内容」永远抢手指,见 MOBILE-CANVAS-DESIGN 手势契约)。
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    swipe.current = e.clientX <= EDGE_GUARD ? null : { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) < TAP_MAX && Math.abs(dy) < TAP_MAX) {
      if (anim) return; // 翻纸过程中点到的是正在飞的纸,不当作选页
      const host = (e.target as HTMLElement).closest<HTMLElement>('[data-page-index]');
      const pi = host?.dataset.pageIndex;
      if (pi != null && pi !== '') onEnterEdit(Number(pi));
      return;
    }
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return; // 不够横 / 更像竖滑
    goScreen(dx < 0 ? 1 : -1);
  };

  if (editPage != null) {
    return (
      <EditView
        pages={pages}
        fontsReady={fontsReady}
        resolve={resolve}
        boardBackground={boardBackground}
        aT={aT}
        editPage={editPage}
        selection={selection}
        imagePos={imagePos}
        photoFilter={photoFilter}
        selectedPhotoId={selectedPhotoId}
        lutSupported={lutSupported}
        sheetOpen={sheetOpen}
        onReplaceImage={onReplaceImage}
        onClearImage={onClearImage}
        onResetImagePos={onResetImagePos}
        onPhotoFilter={onPhotoFilter}
        onExit={() => {
          // 浏览游标对齐到刚编辑那页所在的屏,回来不迷路。
          setStartPage(screenStartOfPage(spreads, pages, editPage, MOBILE_BROWSE_DENSITY));
          onExitEdit(editPage);
        }}
        onStep={(dir) => onEnterEdit(stepScreen(spreads, pages, editPage, 1, dir))}
        onSelectText={onSelectText}
        onSelectImage={onSelectImage}
        onImagePos={onImagePos}
        onImagePosCommit={onImagePosCommit}
        onSwapImage={onSwapImage}
        onClearSelection={onClearSelection}
        onSave={onSave}
        backupState={backupState}
        backupProgress={backupProgress}
        onShare={onShare}
        onExport={onExport}
        onMore={onMore}
        onOpenChat={onOpenChat}
        onPageBg={onPageBg}
        onPickImage={onPickImage}
        onPickText={onPickText}
        onDeletePage={onDeletePage}
      />
    );
  }

  const availW = Math.max(0, area.w - INSET * 2);
  const availH = Math.max(0, area.h - INSET * 2);
  // 全书只算一套物理纸张尺寸：正文用完整双页盒，封面/封尾取它的一半宽。
  // 若独页自己按单页比例 fit，它会在同一画板里长得比正文单页更大。
  const bookBox = fitBox(availW, availH, spreadAspect(2));
  // 翻纸中的目标屏(整屏算一次,不在 map 里反复算)。
  const toScreen = anim
    ? browseScreen(spreads, pages, anim.toStart, MOBILE_BROWSE_DENSITY)
    : null;
  const restingSoloRole = anim == null ? shapeOf(screen)?.soloRole ?? null : null;

  // data-album-fonts-ready 与桌面 EditorPort / FlipBook / PagePreview 同一个标记,同时也是
  // fontsReady 唯一的用处:子集字体到货 → 这棵子树收到新 prop → commit → useFitTextBoxes
  // 自然重收一次字号(那个 hook 每次 commit 都跑,不绑依赖数组)。
  return (
    <div
      className="mobile-editor"
      data-mode="browse"
      data-density={MOBILE_BROWSE_DENSITY}
      data-album-fonts-ready={fontsReady}
      style={boardBackground ? { background: boardBackground } : undefined}
    >
      <MobileTopbar
        title={title}
        aT={aT}
        onBack={onBack ?? (() => {})}
        backLabel={aT('返回', 'Go back')}
        onSave={onSave}
        backupState={backupState}
        backupProgress={backupProgress}
        onShare={onShare}
        onExport={onExport}
        onMore={onMore}
      />

      <div
        ref={boardRef}
        className="mboard"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        {screen.spreadIndices.map((si) => {
          const kind = spreadRenderKind(spreads[si], pages);
          const resting = layoutOf(screen, si);
          // 翻纸中:底层画的是「原屏 + 目标屏」拼出来的那一层(见 flip.ts 的 leafLayers),
          // 纸片转过 90° 后露出来的就是它。翻纸只发生在一屏一个开页时,故 anim 时必为这一格。
          // 目标屏的面必须经 soleLayout 从**目标屏自己**取(理由见 soleLayout 抬头)。
          const toLayout = toScreen ? soleLayout(toScreen) : null;
          const activeEdgeMotion =
            anim != null && anim.transition !== 'spread' ? edgeMotion(anim.transition) : null;
          const layers =
            anim != null && toLayout != null
              ? anim.transition === 'spread'
                ? leafLayers(anim.dir, resting.faces.length, resting.faces, toLayout.faces)
                : edgeLayers(anim.transition, resting.faces, toLayout.faces)
              : null;
          const faces: (number | null)[] = layers ? layers.under : resting.faces;
          // 封面/封尾静止与开合都保留完整双页坐标系：纸仍是半宽，但书体本身
          // 只靠 translateX 在单页居中位和双页中缝位之间移动，不再瞬间扩容。
          const box =
            restingSoloRole != null || activeEdgeMotion != null
              ? bookBox
              : resting.wide === 1
                ? { w: bookBox.w / 2, h: bookBox.h }
                : bookBox;
          const faceWidth = restingSoloRole != null ? bookBox.w / 2 : box.w / faces.length;
          // half:双宽页(#303)按位置裁半(0 左 1 右);普通页 pageFaceHTML 自动忽略。
          const face = (pi: number | null, w: number, half?: LeafHalf) =>
            box.w > 0
              ? pageFaceHTML(pi == null ? null : (pages[pi] ?? null), w, box.h, ctxOf(pi ?? -1), half)
              : '';
          const geo =
            layers && anim
              ? anim.transition === 'spread'
                ? leafGeometry(anim.dir, resting.faces.length)
                : edgeMotion(anim.transition)
              : null;
          const restingShiftPct =
            restingSoloRole === 'cover' ? -25 : restingSoloRole === 'ending' ? 25 : 0;
          return (
            <div
              className="mspread"
              key={si}
              data-solo={kind === 'solo' ? '1' : undefined}
              data-kind={kind}
              data-edge-motion={activeEdgeMotion ? '1' : undefined}
              data-edge-opening={activeEdgeMotion?.opening ? '1' : undefined}
              data-edge-closing={activeEdgeMotion && !activeEdgeMotion.opening ? '1' : undefined}
              data-resting-solo={restingSoloRole ? '1' : undefined}
              // 书脊中缝只在**真的摆了两张面**时才画。判据是渲染出的面数,不是 solo:
              // 密度 1 时 onlyPage 只留一页(那个开页并不 solo),按 solo 判会给单页画中缝;
              // 双宽跨页(full)也只有一张面 —— 画面本就连续,同样不该有中缝。
              data-halves={faces.length}
              data-paper-spine={faces.length === 2 && faces.every((pageIndex) => pageIndex != null) ? '1' : undefined}
              style={{
                width: box.w,
                height: box.h,
                transform: `translateX(${activeEdgeMotion ? bookShiftPct : restingShiftPct}%)`,
                transition: activeEdgeMotion
                  ? `transform ${EDGE_FLIP_MS}ms ${FLIP_EASE}`
                  : undefined,
              }}
            >
              {faces.map((pi, half) => (
                <div
                  className="mpage"
                  key={half}
                  data-page-index={pi ?? undefined}
                  style={{
                    width: faceWidth,
                    marginLeft:
                      restingSoloRole === 'cover' && half === 0 ? bookBox.w / 2 : undefined,
                  }}
                >
                  {/* 页面内容天生是 HTML 字符串(模板产出)。这个节点由本组件独占,
                      没有第二方会重建它 —— 与旧实现的根本区别。 */}
                  <div
                    className="mpage-face"
                    dangerouslySetInnerHTML={{
                      __html: face(
                        pi,
                        faceWidth,
                        faces.length === 2 ? (half === 0 ? 'left' : 'right') : undefined,
                      ),
                    }}
                  />
                </div>
              ))}

              {/* 翻动中的那张纸:正面是翻走的页(带书脊侧受光),背面是翻进来的页。
                  几何/受光/时长全部取自 FlipBook 的 page-turn。
                  双宽页(#303)按 flip.ts 的半边语义裁半:spread 翻页走 leafHalves,
                  封皮开合正面是封面/封尾(从不双宽),背面走 edgeBackHalf。 */}
              {geo && layers && anim && (
                <div
                  className="mleaf"
                  aria-hidden="true"
                  style={{
                    left: box.w * geo.leftFrac,
                    width: box.w * geo.widthFrac,
                    transformOrigin: geo.origin,
                    transform: `rotateY(${leafAngle}deg)`,
                    transition: `transform ${
                      anim.transition === 'spread' ? FLIP_MS : EDGE_FLIP_MS
                    }ms ${FLIP_EASE}`,
                  }}
                >
                  <div className="mleaf-face">
                    <div
                      className="mpage-face"
                      dangerouslySetInnerHTML={{
                        __html: face(
                          layers.front,
                          box.w * geo.widthFrac,
                          anim.transition === 'spread' ? leafHalves(anim.dir).front : undefined,
                        ),
                      }}
                    />
                    <div className="mleaf-shade" style={{ background: leafShading(anim.dir) }} />
                  </div>
                  <div className="mleaf-face mleaf-back">
                    <div
                      className="mpage-face"
                      dangerouslySetInnerHTML={{
                        __html: face(
                          layers.back,
                          box.w * geo.widthFrac,
                          anim.transition === 'spread'
                            ? leafHalves(anim.dir).back
                            : edgeBackHalf(anim.transition),
                        ),
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* 画布背景属于当前画板状态,留在左下角,不塞进顶栏导航。 */}
        <div className="mfab-col">
          <button
            type="button"
            className="mfab"
            aria-label={aT('画板背景', 'Board background')}
            onClick={onBoardBg}
          >
            <IconBoardBg className="mfab-ic" />
          </button>
        </div>

        {/* AI 浮标:紧凑的圆形图标按钮,小水母稳定浮在左上层。 */}
        <button
          type="button"
          className="mai"
          aria-label={aT('展开对话', 'Expand chat')}
          onClick={onOpenChat}
        >
          <img className="mai-jelly" src="/jellyfish-icon.png" alt="" />
          <svg
            className="mai-chat-ic"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>

      <MobileStrip
        pages={pages}
        units={stripUnits}
        aT={aT}
        // 翻纸一开始就把预览栏的高亮挪到目标页 —— 导航状态跟着「要去哪」走,
        // 不等 900ms 动画结束(同桌面 goToSpread 里先 syncSelectionToSpread)。
        currentPage={anim ? anim.toStart : startPage}
        thumbCtxOf={thumbCtxOf}
        // 格子起点已经是屏起点,不必再过 screenStartOfPage 吸附一次。
        onJump={setStartPage}
        onReorder={onReorder}
      />
    </div>
  );
}
