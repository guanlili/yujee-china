'use client';

/* ════════════════════════════════════════════════════════════════════════════
   MobileEditor —— 移动端自己的那棵 UI 树(纯展示层)。

   与桌面 EditorPort **不共用任何一个 DOM 节点**:这棵树里的节点全部由 React 拥有,
   桌面那边的 renderOverview/innerHTML 重建碰不到它们。共享的只有:
     · page-face(一页书长什么样)
     · browse-window / fit-box(这一屏显示什么、怎么摆)
     · 落库通道(HTTP,step 3 接)
   手势、chrome、面板全部各写各的 —— 手机和电脑本来就该不一样。

   本文件刻意不 import photoStore / fetch 之类的副作用:数据加载在 MobileEditorRoot,
   这样这棵树能被 renderToStaticMarkup 直接断言(仓里无 jsdom)。
   ════════════════════════════════════════════════════════════════════════════ */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { EditorPage } from '../../types';
import { buildSpreads, isSoloSpread } from '../../spreads';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';
import { pageFolioNumbers, pageFolioSides } from '../../page-html-dom';
import type { ResolveImage } from '../../adapt-layout';
import { cycleDensity, type Density } from '../mobile-canvas';
import { browseScreen, stepScreen } from './browse-window';
import { fitBox, spreadAspect } from './fit-box';

export type MobileEditorProps = {
  pages: EditorPage[];
  resolve: ResolveImage;
  /** 垫底画板背景的 CSS background 值(相册级),无则透出默认底。 */
  boardBackground?: string | null;
  title: string;
  onBack?: () => void;
};

/** 屏与屏之间、开页与开页之间的缝(px)。 */
const GAP = 10;
/** iOS 左缘返回手势让位:起手落在这条带里就不抢(MOBILE-CANVAS-DESIGN 手势契约)。 */
const EDGE_GUARD = 20;
/** 判定为横滑的最小位移。 */
const SWIPE_MIN = 48;

export function MobileEditor({ pages, resolve, boardBackground, title, onBack }: MobileEditorProps) {
  const [density, setDensity] = useState<Density>(2);
  const [startPage, setStartPage] = useState(0);
  const [area, setArea] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const boardRef = useRef<HTMLDivElement>(null);

  const spreads = useMemo(() => buildSpreads(pages), [pages]);
  const folios = useMemo(() => pageFolioNumbers(pages.map((p) => p.templateId)), [pages]);
  const folioSides = useMemo(() => pageFolioSides(pages.map((p) => p.templateId)), [pages]);
  const screen = useMemo(
    () => browseScreen(spreads, startPage, density),
    [spreads, startPage, density],
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

  const rows = Math.max(1, screen.spreadIndices.length);
  const rowH = (area.h - GAP * (rows - 1)) / rows;

  const ctxOf = (pageIdx: number): PageFaceCtx => ({
    folio: folios[pageIdx] ?? null,
    folioSide: folioSides[pageIdx] ?? 'right',
    total: pages.length,
    resolve,
  });

  // 单指左右滑翻屏。竖滑不响应 —— 浏览态画布不滚(手机上「滚动的画布」和「滚动的
  // 页面内容」永远抢手指,见 MOBILE-CANVAS-DESIGN 手势契约)。
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
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return; // 不够横 / 更像竖滑
    setStartPage((cur) => stepScreen(spreads, cur, density, dx < 0 ? 1 : -1));
  };

  return (
    <div className="mobile-editor" data-density={density}>
      <header className="mtopbar">
        <button type="button" className="mtopbar-back" onClick={onBack} aria-label="返回">
          ‹
        </button>
        <span className="mtopbar-title">{title}</span>
      </header>

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
          const box = fitBox(area.w, rowH, spreadAspect(halves.length));
          return (
            <div
              className="mspread"
              key={si}
              data-solo={solo ? '1' : undefined}
              style={{ width: box.w, height: box.h }}
            >
              {halves.map((pi, half) => (
                <div className="mpage" key={half} style={{ width: box.w / halves.length }}>
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
      </div>

      <nav className="mdock">
        <button
          type="button"
          className="mdens"
          aria-label="一屏几页"
          onClick={() => setDensity((d) => cycleDensity(d))}
        >
          {density}
        </button>
        <span className="mfolio">{pages.length > 0 ? `${startPage + 1} / ${pages.length}` : ''}</span>
      </nav>
    </div>
  );
}
