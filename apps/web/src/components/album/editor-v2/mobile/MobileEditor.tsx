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
import { buildSpreads, isSoloSpread } from '../../spreads';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';
import { pageFolioNumbers, pageFolioSides } from '../../page-html-dom';
import type { ResolveImage } from '../../adapt-layout';
import { cycleDensity, type Density } from '../mobile-canvas';
import { browseScreen, stepScreen, screenStartOfPage } from './browse-window';
import { fitBox, spreadAspect } from './fit-box';
import { EditView } from './EditView';
import { MobileTopbar } from './MobileTopbar';
import { MobileStrip } from './MobileStrip';
import { IconBoardBg, IconSparkle } from './icons';

export type MobileEditorProps = {
  pages: EditorPage[];
  resolve: ResolveImage;
  /** 缩略档(thumb tier)解析器,给书册预览栏用;缺省回落主画布那档。 */
  resolveThumb?: ResolveImage;
  /** 垫底画板背景的 CSS background 值(相册级),无则走网页端默认底(--bg)。 */
  boardBackground?: string | null;
  title: string;
  onBack?: () => void;
  /** 以下动作接现有成品弹窗(分享/导出/更多/画板背景),后续切片接线。 */
  onShare?: () => void;
  onExport?: () => void;
  onMore?: () => void;
  onBoardBg?: () => void;
  onOpenChat?: () => void;
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
  onBack,
  onShare,
  onExport,
  onMore,
  onBoardBg,
  onOpenChat,
}: MobileEditorProps) {
  const [density, setDensity] = useState<Density>(2);
  const [startPage, setStartPage] = useState(0);
  const [editPage, setEditPage] = useState<number | null>(null);
  const [area, setArea] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const boardRef = useRef<HTMLDivElement>(null);

  const spreads = useMemo(() => buildSpreads(pages), [pages]);
  const folios = useMemo(() => pageFolioNumbers(pages.map((p) => p.templateId)), [pages]);
  const folioSides = useMemo(() => pageFolioSides(pages.map((p) => p.templateId)), [pages]);
  const screen = useMemo(
    () => browseScreen(spreads, pages, startPage, density),
    [spreads, pages, startPage, density],
  );

  // 只量一次板子;每页多大由 fitBox 算出来,不靠 CSS 比例硬凑(会被 max-width 夹破)。
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
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
  }, []);

  const ctxOf = (pageIdx: number): PageFaceCtx => ({
    folio: folios[pageIdx] ?? null,
    folioSide: folioSides[pageIdx] ?? 'right',
    total: pages.length,
    resolve,
  });

  // 缩略条的 ctx 必须是稳定引用:它是整条 useMemo 的依赖,每帧新函数 = 每帧重渲几十页。
  const thumbCtxOf = useCallback(
    (pageIdx: number): PageFaceCtx => ({
      folio: folios[pageIdx] ?? null,
      folioSide: folioSides[pageIdx] ?? 'right',
      total: pages.length,
      resolve: resolveThumb ?? resolve,
    }),
    [folios, folioSides, pages.length, resolveThumb, resolve],
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
      const host = (e.target as HTMLElement).closest<HTMLElement>('[data-page-index]');
      const pi = host?.dataset.pageIndex;
      if (pi != null && pi !== '') setEditPage(Number(pi));
      return;
    }
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return; // 不够横 / 更像竖滑
    setStartPage((cur) => stepScreen(spreads, pages, cur, density, dx < 0 ? 1 : -1));
  };

  // 退出编辑态:浏览游标对齐到刚编辑那页所在的屏,回来不迷路。
  const exitEdit = () => {
    setEditPage((cur) => {
      if (cur != null) setStartPage(screenStartOfPage(spreads, pages, cur, density));
      return null;
    });
  };

  if (editPage != null) {
    return (
      <EditView
        pages={pages}
        resolve={resolve}
        boardBackground={boardBackground}
        editPage={editPage}
        onExit={exitEdit}
        onStep={(dir) =>
          setEditPage((cur) => (cur == null ? cur : stepScreen(spreads, pages, cur, 1, dir)))
        }
        onShare={onShare}
        onExport={onExport}
        onMore={onMore}
        onOpenChat={onOpenChat}
      />
    );
  }

  const availW = Math.max(0, area.w - INSET * 2);
  const availH = Math.max(0, area.h - INSET * 2);
  const rows = Math.max(1, screen.spreadIndices.length);
  const rowH = (availH - GAP * (rows - 1)) / rows;

  return (
    <div className="mobile-editor" data-mode="browse" data-density={density}>
      <MobileTopbar
        title={title}
        onBack={onBack ?? (() => {})}
        backLabel="返回"
        onShare={onShare}
        onExport={onExport}
        onMore={onMore}
      />

      <div
        ref={boardRef}
        className="mboard"
        style={boardBackground ? { background: boardBackground } : undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        {screen.spreadIndices.map((si) => {
          const sp = spreads[si];
          const solo = isSoloSpread(sp, pages);
          const halves: (number | null)[] =
            screen.onlyPage !== null
              ? [screen.onlyPage] // 密度 1:开页内只留游标那一页
              : solo
                ? [sp.left ?? sp.right ?? null]
                : [sp.left, sp.right];
          const box = fitBox(availW, rowH, spreadAspect(halves.length));
          return (
            <div
              className="mspread"
              key={si}
              data-solo={solo ? '1' : undefined}
              style={{ width: box.w, height: box.h }}
            >
              {halves.map((pi, half) => (
                <div
                  className="mpage"
                  key={half}
                  data-page-index={pi ?? undefined}
                  style={{ width: box.w / halves.length }}
                >
                  {/* 页面内容天生是 HTML 字符串(模板产出)。这个节点由本组件独占,
                      没有第二方会重建它 —— 与旧实现的根本区别。 */}
                  <div
                    className="mpage-face"
                    dangerouslySetInnerHTML={{
                      __html:
                        box.w > 0
                          ? pageFaceHTML(
                              pi == null ? null : (pages[pi] ?? null),
                              box.w / halves.length,
                              box.h,
                              ctxOf(pi ?? -1),
                            )
                          : '',
                    }}
                  />
                </div>
              ))}
            </div>
          );
        })}

        {/* 画布状态类控件落在左下角 —— 导航栏是「离开这屏去哪」,这里是「这屏怎么看」 */}
        <div className="mfab-col">
          <button type="button" className="mfab" aria-label="画板背景" onClick={onBoardBg}>
            <IconBoardBg className="mfab-ic" />
          </button>
          <button
            type="button"
            className="mfab"
            aria-label="一屏几页"
            onClick={() => setDensity((d) => cycleDensity(d))}
          >
            <span className="mfab-num">{density}</span>
          </button>
        </div>

        <button type="button" className="mai" aria-label="AI 助手" onClick={onOpenChat}>
          <IconSparkle className="mai-ic" />
        </button>
      </div>

      <MobileStrip
        pages={pages}
        currentPage={startPage}
        thumbCtxOf={thumbCtxOf}
        onJump={(pi) => setStartPage(screenStartOfPage(spreads, pages, pi, density))}
      />
    </div>
  );
}
