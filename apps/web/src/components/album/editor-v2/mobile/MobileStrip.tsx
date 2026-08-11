'use client';

/* 书册预览栏(浏览态底部):整本书一条横排渲染真实版面,当前格描黑框,点即跳。

   **一格 = 画布的一屏**,不是一页。早先是一页一格,而点击走 screenStartOfPage 会把游标
   吸到所在屏的起点 —— 密度 2 下每个开页的右页于是成了死格:点它游标回到左页,高亮不落在
   你点的那一格,再点还是没反应。8 页的书有 3 个死格,看着就像坏了。格子改成按屏出之后,
   格与屏一一对应,死格在构造上不可能存在。分屏口径来自 browse-window,与画布同一份。

   照片走 **thumb 档派生图(~240px)** —— 与桌面缩略图条同一分级。主画布用 display
   档(~1600px),拿它来渲一整条几十页的小图会把解码和滚动一起拖垮(屏显分级的原因)。

   ── 长按拖拽换序(2026-08-02 迭代)──────────────────────────────────────────
   长按 350ms 拾起一页(锚定页拾不起来),沿栏拖到合法缝隙出插入条,松手即存:
   单次移动合成置换交给容器层 onReorder(乐观 + 回滚在容器层)。合法缝隙/置换/
   指针几何全部来自共享 page-reorder.ts。
   横向滚动的共存:touch-action 不动,拾起**前**动超 slop 取消计时回落原生滚动;
   拾起**后**由 track 上的非 passive touchmove preventDefault() 拦掉浏览器平移
   (touch-action 中途改不生效,只能在事件层拦)。拖完吞掉一次冒泡 click,
   否则松手会顺带触发格子按钮的 onJump。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AT } from '@/lib/i18n/pick';

import type { EditorPage } from '../../types';
import { pageSlot } from '../../spreads';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';
import { SWAP_LONG_PRESS_MS, SWAP_LONG_PRESS_SLOP } from '../image-swap';
import {
  applyMove,
  buildInsertPermutation,
  gapFromPointer,
  isAnchoredTemplate,
  legalGaps,
  type CellRect,
} from '../page-reorder';
import type { BrowseUnit } from './browse-window';

/** 单页尺寸(794:1123)。一格里并排几页由 unit 决定。 */
export const STRIP_CELL_W = 40;
export const STRIP_CELL_H = Math.round((STRIP_CELL_W * 1123) / 794);

export type MobileStripProps = {
  pages: EditorPage[];
  /** 格子 = 屏,来自 browseUnits(与画布同一套分屏)。 */
  units: BrowseUnit[];
  aT: AT;
  /** 当前页游标,用来描高亮框。 */
  currentPage: number;
  /** 缩略档的渲染上下文(照片走 thumb tier)。引用必须稳定,否则每帧重渲整条。 */
  thumbCtxOf: (pageIndex: number) => PageFaceCtx;
  onJump: (pageIndex: number) => void;
  /** 长按拖拽换序的落库通道:非恒等置换(perm[newIndex]=oldIndex)即拖即存。 */
  onReorder: (permutation: number[]) => void;
};

type StripDrag = {
  pointerId: number;
  /** 拾起的页(pageIndex,与 faces 顺序恒等)。 */
  from: number;
  startX: number;
  startY: number;
  timer: ReturnType<typeof setTimeout> | null;
  lifted: boolean;
  /** 拾起后真的拖动过(位移超 slop)。**没动过的长按 = 普通点击**:不吞 click、
   *  不算落点 —— 否则「瞄准小格子按久一点」就成了什么都不发生的死区
   *  (2026-08-03 真机回归:中间页点不中,封面因是锚定页不进机器反而幸免)。 */
  moved: boolean;
  gap: number | null;
  x: number;
  y: number;
};

export function MobileStrip({ pages, units, aT, currentPage, thumbCtxOf, onJump, onReorder }: MobileStripProps) {
  // 按页缓存(不按格):切密度只是重新分组,不该让每一页的 HTML 重渲一遍。
  const faces = useMemo(
    () => pages.map((p, i) => pageFaceHTML(p, STRIP_CELL_W, STRIP_CELL_H, thumbCtxOf(i))),
    [pages, thumbCtxOf],
  );

  const [, bump] = useState(0); // 拖拽视觉态存 ref,变更时手动重渲
  const dragRef = useRef<StripDrag | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  // face 节点按 pageIndex 记 ref:这棵树的节点归 React 所有,量自己的节点走 ref,
  // 不走选择器查找(架构守卫盯着,见 mobile-editor.test.ts)。
  const faceEls = useRef<(HTMLElement | null)[]>([]);
  /** 拖拽尾巴的 click 抑制窗(时间戳):真拖之后浏览器**不一定**补发 click
   *  (移动超阈就不发),用「下一次 click 消费」的布尔标记会一直挂着、吞掉之后
   *  一次无辜点按 —— 改用短时间窗,过期自动失效。 */
  const suppressUntilRef = useRef(0);

  // 拾起后拦掉浏览器横向平移(见文件头)。React 的 onTouchMove 是 passive,
  // preventDefault 无效,必须原生挂 {passive:false} —— 挂在 track 自己身上,
  // 不碰 document(子树守则)。
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current?.lifted) e.preventDefault();
    };
    track.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => track.removeEventListener('touchmove', onTouchMove);
  }, []);

  const faceRects = (): CellRect[] =>
    pages.map((_, i) => {
      const el = faceEls.current[i];
      if (!el) return { left: 0, top: -10_000, width: 0, height: 0 }; // 量不到:远离指针,不会被吸中
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });

  const endDrag = (commitMove: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    dragRef.current = null;
    // 只有真的拖动过才吞 click —— 原地松手(哪怕拾起过)回落为普通点击,照常跳页。
    if (d.lifted && d.moved) suppressUntilRef.current = Date.now() + 350;
    if (commitMove && d.lifted && d.moved && d.gap !== null) {
      const perm = buildInsertPermutation(applyMove(pages.map((_, i) => i), d.from, d.gap));
      if (perm) onReorder(perm);
    }
    bump((n) => n + 1);
  };

  const onFaceDown = (pi: number) => (e: React.PointerEvent) => {
    if (dragRef.current || isAnchoredTemplate(pages[pi]!.templateId)) return;
    const target = e.currentTarget as HTMLElement;
    const d: StripDrag = {
      pointerId: e.pointerId,
      from: pi,
      startX: e.clientX,
      startY: e.clientY,
      timer: null,
      lifted: false,
      moved: false,
      gap: null,
      x: e.clientX,
      y: e.clientY,
    };
    d.timer = setTimeout(() => {
      d.timer = null;
      // 指针可能早已在格外松掉(endDrag 没机会跑):capture 会抛 —— 那就不是
      // 一次拖拽,整个作废,不留下吞点击的僵尸。
      try {
        target.setPointerCapture(d.pointerId);
      } catch {
        if (dragRef.current === d) dragRef.current = null;
        return;
      }
      d.lifted = true;
      bump((n) => n + 1);
    }, SWAP_LONG_PRESS_MS);
    dragRef.current = d;
  };

  const onTrackMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.lifted) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > SWAP_LONG_PRESS_SLOP) {
        if (d.timer) clearTimeout(d.timer);
        dragRef.current = null; // 是滚动,不是长按
      }
      return;
    }
    // 拾起后同样过 slop 才算「在拖」:手指的天然抖动不该吞点击,更不该凑出落点。
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= SWAP_LONG_PRESS_SLOP) return;
    d.moved = true;
    const track = trackRef.current;
    if (track) {
      const tr = track.getBoundingClientRect();
      if (e.clientX < tr.left + 30) track.scrollLeft -= 12;
      else if (e.clientX > tr.right - 30) track.scrollLeft += 12;
    }
    const ids = pages.map((p) => p.templateId);
    const identity = pages.map((_, i) => i);
    d.gap = gapFromPointer(faceRects(), legalGaps(ids, identity, d.from), e.clientX, e.clientY);
    bump((n) => n + 1);
  };

  const label = (u: BrowseUnit) => {
    const first = u.pageIndices[0] ?? 0;
    const last = u.pageIndices[u.pageIndices.length - 1] ?? first;
    if (first === last) return aT(`第 ${first + 1} 页`, `Page ${first + 1}`);
    return aT(`第 ${first + 1}–${last + 1} 页`, `Pages ${first + 1}–${last + 1}`);
  };

  const drag = dragRef.current;

  // 插入条几何:g<n 用第 g 面左缘,g=n 用末面右缘(viewport → track 内容坐标)。
  const barStyle = (() => {
    const track = trackRef.current;
    if (!drag?.lifted || drag.gap === null || !track) return null;
    const rects = faceRects();
    const at = rects[drag.gap] ?? null;
    const prev = rects[drag.gap - 1] ?? null;
    const edge = at ?? prev;
    if (!edge) return null;
    const tr = track.getBoundingClientRect();
    return {
      left: (at ? at.left : prev!.left + prev!.width) - tr.left + track.scrollLeft - 2,
      top: edge.top - tr.top,
      height: edge.height,
    };
  })();

  return (
    <nav className="mstrip" aria-label={aT('书册预览', 'Book preview')}>
      <div
        ref={trackRef}
        className="mstrip-track"
        onPointerMove={onTrackMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
      >
        {units.map((u) => {
          // 高亮按「游标是否落在这一格」判,不是「等于格子起点」—— 翻页动画中途游标
          // 可能停在格内任意一页,按起点比会整格熄灭。
          const active = u.pageIndices.includes(currentPage);
          return (
            <button
              type="button"
              key={u.startPage}
              className="mstrip-cell"
              data-current={active ? '1' : undefined}
              data-span={u.pageIndices.length}
              aria-label={label(u)}
              aria-current={active ? 'true' : undefined}
              onClick={() => {
                if (Date.now() < suppressUntilRef.current) {
                  suppressUntilRef.current = 0; // 拖拽尾巴,消费即失效
                  return;
                }
                onJump(u.startPage);
              }}
            >
              {u.pageIndices.map((pi) => (
                <span
                  key={pi}
                  ref={(el) => {
                    faceEls.current[pi] = el;
                  }}
                  className="mstrip-face"
                  data-slot={pageSlot(pages[pi]!)}
                  data-lifted={drag?.lifted && drag.from === pi ? '1' : undefined}
                  onPointerDown={onFaceDown(pi)}
                  dangerouslySetInnerHTML={{ __html: faces[pi]! }}
                />
              ))}
            </button>
          );
        })}
        {barStyle && <div className="mstrip-bar" style={barStyle} />}
        {drag?.lifted && (
          <div
            className="mstrip-ghost"
            style={{ left: drag.x - 14, top: drag.y - STRIP_CELL_H }}
            dangerouslySetInnerHTML={{ __html: faces[drag.from]! }}
          />
        )}
      </div>
    </nav>
  );
}
