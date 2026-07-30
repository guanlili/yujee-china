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
   背景上,底色由相册的画板背景属性决定、默认走网页端同款 --bg;左下角画板背景与
   密度两枚圆钮、右下角 AI 气泡) + 底部书册预览栏(渲染真实版面,照片走 thumb 档)。
   **书不做自由缩放**:密度是离散档位,尺寸由 fitBox 算好重绘,不用 transform 拉伸。

   本文件刻意不 import photoStore / fetch 之类的副作用:数据加载在 MobileEditorRoot,
   这样这棵树能被 renderToStaticMarkup 直接断言(仓里无 jsdom)。
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { EditorPage } from '../../types';
import { buildSpreads, isSoloSpread, spreadPageIndices, spreadRenderKind } from '../../spreads';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';
import { pageFolioInfos } from '../../page-html-dom';
import type { ResolveImage } from '../../adapt-layout';
import { cycleDensity, type Density } from '../mobile-canvas';
import { browseScreen, browseUnits, stepScreen, screenStartOfPage, type BrowseScreen } from './browse-window';
import { fitBox, spreadAspect } from './fit-box';
import {
  FLIP_EASE,
  FLIP_MS,
  FLIP_SETTLE_MS,
  canFlip,
  leafGeometry,
  leafLayers,
  leafShading,
  type FlipDir,
  type ScreenShape,
} from './flip';
import { EditView, type TextHit, type ImageHit } from './EditView';
import { MobileTopbar } from './MobileTopbar';
import { MobileStrip } from './MobileStrip';
import { IconBoardBg } from './icons';
import type { SelRect } from './page-edit';
import type { ImagePosValue } from '../image-edit-util';
import type { PhotoFilterState } from '@/lib/photo/filter-state';

export type MobileEditorProps = {
  pages: EditorPage[];
  resolve: ResolveImage;
  /** 缩略档(thumb tier)解析器,给书册预览栏用;缺省回落主画布那档。 */
  resolveThumb?: ResolveImage;
  /** 垫底画板背景的 CSS background 值(相册级),无则走网页端默认底(--bg)。 */
  boardBackground?: string | null;
  title: string;
  zh: boolean;
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
  onPageBg: () => void;
  onPickImage: () => void;
  onPickText: () => void;
  onDeletePage: () => void;
};

/** 开页与开页之间的缝(px)。 */
const GAP = 10;
/** 书页四周露出的垫底背景(px):书居中浮起,不顶满可视区。 */
const INSET = 24;
/** iOS 左缘返回手势让位。 */
const EDGE_GUARD = 20;
/** 判定为横滑的最小位移。 */
const SWIPE_MIN = 48;
/** 位移在此以内视为轻点(而非滑动)。 */
const TAP_MAX = 10;

export function MobileEditor({
  pages,
  resolve,
  resolveThumb,
  boardBackground,
  title,
  zh,
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
  onPageBg,
  onPickImage,
  onPickText,
  onDeletePage,
}: MobileEditorProps) {
  const [density, setDensity] = useState<Density>(2);
  const [startPage, setStartPage] = useState(0);
  const [area, setArea] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const boardRef = useRef<HTMLDivElement>(null);

  // 翻纸动效:anim 非 null = 正在翻,toStart 是翻完之后的游标。
  const [anim, setAnim] = useState<{ dir: FlipDir; toStart: number } | null>(null);
  const [leafAngle, setLeafAngle] = useState(0);
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
    () => browseScreen(spreads, pages, startPage, density),
    [spreads, pages, startPage, density],
  );
  /* 缩略条的格子。**不依赖 startPage** —— 翻页只挪高亮,不该让整条重新分组。 */
  const stripUnits = useMemo(
    () => browseUnits(spreads, pages, density),
    [spreads, pages, density],
  );

  /** 一个开页在本屏里实际摆出来的「面」。
   *  三种画法与桌面共用同一套分类(spreadRenderKind):
   *    solo 封面/封尾 → 单页宽容器,一张面
   *    full 双宽跨页(#303)→ **双页宽**容器,仍只有一张面(画面本就连续,无中缝)
   *    pair 普通内页 → 双页宽容器,左右各一半(null = 空白半页)
   *  返回 faces 与 wide:wide 决定容器按几页宽算,faces.length 决定摆几张面。
   *  两者必须分开 —— full 是「一张面 + 双页宽」,把它当 halves.length===1 会缩成半宽。 */
  const layoutOf = useCallback(
    (scr: BrowseScreen, si: number): { faces: (number | null)[]; wide: 1 | 2 } => {
      const sp = spreads[si];
      if (!sp) return { faces: [], wide: 1 };
      // 在 sp.kind 上窄化(不是在 spreadRenderKind 的返回值上)—— 这样读 .left/.right
      // 才是类型安全的,也正是 #303 把 Spread 改成判别式联合要达到的效果。
      if (sp.kind === 'full') return { faces: [sp.page], wide: 2 };
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
      return {
        rows: scr.spreadIndices.length,
        faces: lay.faces.length,
        // 密度 1 把对开压成一页看,但它既不是封面独页也不是双宽页 —— 那两个标记按
        // 开页本身的类别取,不受密度影响(否则密度 1 会被误判成 solo 而永远硬切)。
        solo: kind === 'solo',
        full: kind === 'full',
      };
    },
    [soleLayout, spreads, pages],
  );

  /** 翻一屏。几何允许就走翻纸动效,否则直接切(见 flip.ts 的 canFlip)。 */
  const goScreen = (dir: 1 | -1) => {
    if (anim) return; // 翻纸过程中不接新的翻页(同 FlipBook)
    const toStart = stepScreen(spreads, pages, startPage, density, dir);
    if (toStart === startPage) return; // 已在夹边
    const to = browseScreen(spreads, pages, toStart, density);
    const fromShape = shapeOf(screen);
    const toShape = shapeOf(to);
    const ok =
      fromShape != null && toShape != null && canFlip(fromShape, toShape, reducedMotion);
    if (!ok) {
      setStartPage(toStart);
      return;
    }
    const d: FlipDir = dir === 1 ? 'next' : 'prev';
    setAnim({ dir: d, toStart });
    setLeafAngle(0);
    // 下一帧才给终止角,transition 才会跑(同 FlipBook)。
    requestAnimationFrame(() => setLeafAngle(leafGeometry(d, fromShape.faces).endAngle));
    flipTimer.current = window.setTimeout(() => {
      setStartPage(toStart);
      setAnim(null);
      setLeafAngle(0);
      flipTimer.current = null;
    }, FLIP_MS + FLIP_SETTLE_MS);
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
        resolve={resolve}
        boardBackground={boardBackground}
        zh={zh}
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
          setStartPage(screenStartOfPage(spreads, pages, editPage, density));
          onExitEdit(editPage);
        }}
        onStep={(dir) => onEnterEdit(stepScreen(spreads, pages, editPage, 1, dir))}
        onSelectText={onSelectText}
        onSelectImage={onSelectImage}
        onImagePos={onImagePos}
        onImagePosCommit={onImagePosCommit}
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
  const rows = Math.max(1, screen.spreadIndices.length);
  const rowH = (availH - GAP * (rows - 1)) / rows;
  // 翻纸中的目标屏(整屏算一次,不在 map 里反复算)。
  const toScreen = anim ? browseScreen(spreads, pages, anim.toStart, density) : null;

  return (
    <div
      className="mobile-editor"
      data-mode="browse"
      data-density={density}
      style={boardBackground ? { background: boardBackground } : undefined}
    >
      <MobileTopbar
        title={title}
        zh={zh}
        onBack={onBack ?? (() => {})}
        backLabel={zh ? '返回' : 'Back'}
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
          const layers =
            anim != null && toLayout != null
              ? leafLayers(anim.dir, resting.faces.length, resting.faces, toLayout.faces)
              : null;
          const faces: (number | null)[] = layers ? layers.under : resting.faces;
          // 容器按 wide 算宽(双宽跨页是「一张面 + 两页宽」),不按面数算 ——
          // 否则 full 会被缩成半宽。
          const box = fitBox(availW, rowH, spreadAspect(resting.wide));
          const face = (pi: number | null, w: number) =>
            box.w > 0
              ? pageFaceHTML(pi == null ? null : (pages[pi] ?? null), w, box.h, ctxOf(pi ?? -1))
              : '';
          const geo = layers && anim ? leafGeometry(anim.dir, faces.length) : null;
          return (
            <div
              className="mspread"
              key={si}
              data-solo={kind === 'solo' ? '1' : undefined}
              data-kind={kind}
              // 书脊中缝只在**真的摆了两张面**时才画。判据是渲染出的面数,不是 solo:
              // 密度 1 时 onlyPage 只留一页(那个开页并不 solo),按 solo 判会给单页画中缝;
              // 双宽跨页(full)也只有一张面 —— 画面本就连续,同样不该有中缝。
              data-halves={faces.length}
              style={{ width: box.w, height: box.h }}
            >
              {faces.map((pi, half) => (
                <div
                  className="mpage"
                  key={half}
                  data-page-index={pi ?? undefined}
                  style={{ width: box.w / faces.length }}
                >
                  {/* 页面内容天生是 HTML 字符串(模板产出)。这个节点由本组件独占,
                      没有第二方会重建它 —— 与旧实现的根本区别。 */}
                  <div
                    className="mpage-face"
                    dangerouslySetInnerHTML={{ __html: face(pi, box.w / faces.length) }}
                  />
                </div>
              ))}

              {/* 翻动中的那张纸:正面是翻走的页(带书脊侧受光),背面是翻进来的页。
                  几何/受光/时长全部取自 FlipBook 的 page-turn。 */}
              {geo && layers && anim && (
                <div
                  className="mleaf"
                  aria-hidden="true"
                  style={{
                    left: box.w * geo.leftFrac,
                    width: box.w * geo.widthFrac,
                    transformOrigin: geo.origin,
                    transform: `rotateY(${leafAngle}deg)`,
                    transition: `transform ${FLIP_MS}ms ${FLIP_EASE}`,
                  }}
                >
                  <div className="mleaf-face">
                    <div
                      className="mpage-face"
                      dangerouslySetInnerHTML={{ __html: face(layers.front, box.w * geo.widthFrac) }}
                    />
                    <div className="mleaf-shade" style={{ background: leafShading(anim.dir) }} />
                  </div>
                  <div className="mleaf-face mleaf-back">
                    <div
                      className="mpage-face"
                      dangerouslySetInnerHTML={{ __html: face(layers.back, box.w * geo.widthFrac) }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* 画布状态类控件落在左下角 —— 导航栏是「离开这屏去哪」,这里是「这屏怎么看」 */}
        <div className="mfab-col">
          <button
            type="button"
            className="mfab"
            aria-label={zh ? '画板背景' : 'Board background'}
            onClick={onBoardBg}
          >
            <IconBoardBg className="mfab-ic" />
          </button>
          <button
            type="button"
            className="mfab"
            aria-label={zh ? '一屏几页' : 'Pages per screen'}
            onClick={() => setDensity((d) => cycleDensity(d))}
          >
            <span className="mfab-num">{density}</span>
          </button>
        </div>

        {/* AI 浮标:黑色胶囊 + 小水母从左上角探出来(逐条对齐桌面 .chat-fold-expand)。
            水母是 mix-blend-mode:multiply —— 必须**探出到胶囊外面**,压在黑底上会直接消失。 */}
        <button
          type="button"
          className="mai"
          aria-label={zh ? '展开对话' : 'Expand chat'}
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
          <span>{zh ? '对话' : 'Chat'}</span>
        </button>
      </div>

      <MobileStrip
        pages={pages}
        units={stripUnits}
        zh={zh}
        // 翻纸一开始就把预览栏的高亮挪到目标页 —— 导航状态跟着「要去哪」走,
        // 不等 900ms 动画结束(同桌面 goToSpread 里先 syncSelectionToSpread)。
        currentPage={anim ? anim.toStart : startPage}
        thumbCtxOf={thumbCtxOf}
        // 格子起点已经是屏起点,不必再过 screenStartOfPage 吸附一次。
        onJump={setStartPage}
      />
    </div>
  );
}
