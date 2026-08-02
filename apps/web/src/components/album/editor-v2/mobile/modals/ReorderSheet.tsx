'use client';

/* 页序弹窗(移动端,2026-08-02 设计)。网格缩略图长按拖拽插入重排;
   「完成」把工作序合成一个置换交给容器层落库,「取消」/遮罩直接丢弃。
   合法缝隙/置换/指针几何全部来自共享 page-reorder.ts;本组件只做 DOM:
   渲格子、量 rect、画插入条。子树守则:不碰 document,状态住本组件。
   弹窗壳走 ModalHost(.editor-port 宿主),网格样式直接命中桌面 preorder-*
   规则,移动端只在 mobile-editor.css 里做尺寸微调。 */

import { useEffect, useRef, useState } from 'react';

import type { EditorPage } from '../../../types';
import type { ResolveImage } from '../../../adapt-layout';
import { pageFolioInfos } from '../../../page-html-dom';
import { pageBox } from '../../../templates/constants';
import { pageFaceHTML } from '../../page-face';
import { SWAP_LONG_PRESS_MS, SWAP_LONG_PRESS_SLOP } from '../../image-swap';
import {
  applyMove,
  buildInsertPermutation,
  gapFromPointer,
  isAnchoredTemplate,
  legalGaps,
  type CellRect,
} from '../../page-reorder';
import { ModalHost } from './ModalHost';

const CELL_H = 108;

type Drag = {
  pointerId: number;
  from: number;
  startX: number;
  startY: number;
  timer: ReturnType<typeof setTimeout> | null;
  lifted: boolean;
  gap: number | null;
  x: number;
  y: number;
};

export function ReorderSheet({
  open,
  zh,
  pages,
  resolve,
  onClose,
  onCommit,
}: {
  open: boolean;
  zh: boolean;
  pages: EditorPage[];
  resolve: ResolveImage;
  onClose: () => void;
  /** 「完成」且非恒等时收到 perm[newIndex]=oldIndex;容器层负责乐观落库+回滚。 */
  onCommit: (permutation: number[]) => void;
}) {
  const [order, setOrder] = useState<number[]>([]);
  const [, bump] = useState(0); // 拖拽视觉态(lifted/gap)存 ref,变更时手动重渲
  const dragRef = useRef<Drag | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // 只在打开那一刻建工作序;开着期间外部改书不重置,提交时按长度守卫。
  useEffect(() => {
    if (open) setOrder(pages.map((_, i) => i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const ids = order.map((orig) => pages[orig]!.templateId);
  const folios = pageFolioInfos(ids);
  const drag = dragRef.current;

  const cellRects = (): CellRect[] =>
    [...(gridRef.current?.querySelectorAll<HTMLElement>('.preorder-cell') ?? [])].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });

  const endDrag = (commitMove: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    dragRef.current = null;
    if (commitMove && d.lifted && d.gap !== null) {
      setOrder((cur) => applyMove(cur, d.from, d.gap!));
    } else {
      bump((n) => n + 1);
    }
  };

  const onDown = (pos: number) => (e: React.PointerEvent) => {
    if (dragRef.current || isAnchoredTemplate(pages[order[pos]!]!.templateId)) return;
    const d: Drag = {
      pointerId: e.pointerId,
      from: pos,
      startX: e.clientX,
      startY: e.clientY,
      timer: null,
      lifted: false,
      gap: null,
      x: e.clientX,
      y: e.clientY,
    };
    // 长按拾起(全仓触屏口径);期间移动超 slop 由 onMove 取消计时回落滚动。
    d.timer = setTimeout(() => {
      d.timer = null;
      d.lifted = true;
      gridRef.current?.setPointerCapture(d.pointerId);
      bump((n) => n + 1);
    }, SWAP_LONG_PRESS_MS);
    dragRef.current = d;
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.lifted) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > SWAP_LONG_PRESS_SLOP) {
        if (d.timer) clearTimeout(d.timer);
        dragRef.current = null; // 是滚动,不是拖拽
      }
      return;
    }
    const grid = gridRef.current;
    if (grid) {
      const gr = grid.getBoundingClientRect();
      if (e.clientY < gr.top + 36) grid.scrollTop -= 12;
      else if (e.clientY > gr.bottom - 36) grid.scrollTop += 12;
    }
    d.gap = gapFromPointer(cellRects(), legalGaps(ids, order, d.from), e.clientX, e.clientY);
    bump((n) => n + 1);
  };

  const done = () => {
    if (order.length !== pages.length) {
      onClose(); // 开着期间书被外部改了:这次调整作废
      return;
    }
    const perm = buildInsertPermutation(order);
    onClose();
    if (perm) onCommit(perm);
  };

  // 插入条几何:g<n 用第 g 格左缘,g=n 用末格右缘(viewport → grid 内容坐标)。
  const barStyle = (() => {
    const d2 = dragRef.current;
    const grid = gridRef.current;
    if (!d2?.lifted || d2.gap === null || !grid) return null;
    const rects = cellRects();
    const at = rects[d2.gap] ?? null;
    const prevCell = rects[d2.gap - 1] ?? null;
    const edge = at ?? prevCell;
    if (!edge) return null;
    const gr = grid.getBoundingClientRect();
    return {
      left: (at ? at.left : prevCell!.left + prevCell!.width) - gr.left + grid.scrollLeft - 2,
      top: edge.top - gr.top + grid.scrollTop,
      height: edge.height,
    };
  })();

  return (
    <ModalHost open onClose={onClose} cardClassName="preorder-card" labelledBy="mReorderTitle" testId="reorder-sheet">
      <div className="preorder-head">
        <h3 id="mReorderTitle" className="font-display text-[17px] font-bold">{zh ? '调整页面顺序' : 'Reorder pages'}</h3>
        <p className="preorder-hint">{zh ? '长按拖动页面到新位置。封面、目录与封尾固定不动。' : 'Long-press and drag pages. Cover, contents and ending stay fixed.'}</p>
      </div>
      <div
        ref={gridRef}
        className="preorder-grid"
        onPointerMove={onMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
      >
        {order.map((orig, pos) => {
          const page = pages[orig]!;
          const anchored = isAnchoredTemplate(page.templateId);
          const box = pageBox(page.templateId);
          const w = Math.round((CELL_H * box.width) / box.height);
          const f = folios[pos]!;
          const lifted = drag?.lifted && drag.from === pos;
          return (
            <div
              key={orig}
              className={`preorder-cell${anchored ? ' preorder-locked' : ''}${lifted ? ' preorder-dragging' : ''}`}
              data-pos={pos}
              style={{ width: w, height: CELL_H }}
              onPointerDown={onDown(pos)}
              dangerouslySetInnerHTML={{
                __html:
                  pageFaceHTML(page, w, CELL_H, { folio: f.folio, folioSide: f.side, total: pages.length, resolve }) +
                  (anchored
                    ? '<span class="preorder-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>'
                    : f.folio === null
                      ? ''
                      : typeof f.folio === 'number'
                        ? `<span class="preorder-no preorder-no-${f.side}">${f.folio}</span>`
                        : `<span class="preorder-no preorder-no-left">${f.folio.left}</span><span class="preorder-no preorder-no-right">${f.folio.right}</span>`),
              }}
            />
          );
        })}
        {barStyle && <div className="preorder-bar on" style={barStyle} />}
        {drag?.lifted && (
          <div
            className="preorder-ghost"
            style={{ left: drag.x + 8, top: drag.y + 8, width: 72, height: Math.round(CELL_H * 0.66) }}
            dangerouslySetInnerHTML={{
              __html: pageFaceHTML(pages[order[drag.from]!]!, 72, Math.round(CELL_H * 0.66), {
                folio: null,
                folioSide: 'left',
                total: pages.length,
                resolve,
              }),
            }}
          />
        )}
      </div>
      <div className="preorder-foot">
        <button className="preorder-btn" onClick={onClose} data-testid="m-reorder-cancel">{zh ? '取消' : 'Cancel'}</button>
        <button className="preorder-btn preorder-btn-primary" onClick={done} data-testid="m-reorder-done">{zh ? '完成' : 'Done'}</button>
      </div>
    </ModalHost>
  );
}
