'use client';

/* 书册预览栏(浏览态底部):整本书一条横排渲染真实版面,当前页描黑框,点即跳。

   照片走 **thumb 档派生图(~240px)** —— 与桌面缩略图条同一分级。主画布用 display
   档(~1600px),拿它来渲一整条几十页的小图会把解码和滚动一起拖垮(屏显分级的原因)。 */

import { useMemo } from 'react';

import type { EditorPage } from '../../types';
import { pageSlot } from '../../spreads';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';

/** 单格尺寸(794:1123)。 */
export const STRIP_CELL_W = 40;
export const STRIP_CELL_H = Math.round((STRIP_CELL_W * 1123) / 794);

export type MobileStripProps = {
  pages: EditorPage[];
  /** 当前屏起始页,用来描高亮框。 */
  currentPage: number;
  /** 缩略档的渲染上下文(照片走 thumb tier)。引用必须稳定,否则每帧重渲整条。 */
  thumbCtxOf: (pageIndex: number) => PageFaceCtx;
  onJump: (pageIndex: number) => void;
};

export function MobileStrip({ pages, currentPage, thumbCtxOf, onJump }: MobileStripProps) {
  // 整条只在书或缩略图 URL 变化时重算 —— 翻页/切密度不该重渲缩略条。
  const faces = useMemo(
    () => pages.map((p, i) => pageFaceHTML(p, STRIP_CELL_W, STRIP_CELL_H, thumbCtxOf(i))),
    [pages, thumbCtxOf],
  );

  return (
    <nav className="mstrip" aria-label="书册预览">
      <div className="mstrip-track">
        {pages.map((p, i) => (
          <button
            type="button"
            key={i}
            className="mstrip-cell"
            data-current={i === currentPage ? '1' : undefined}
            data-slot={pageSlot(p)}
            aria-label={`第 ${i + 1} 页`}
            aria-current={i === currentPage ? 'true' : undefined}
            onClick={() => onJump(i)}
          >
            <span className="mstrip-face" dangerouslySetInnerHTML={{ __html: faces[i] }} />
          </button>
        ))}
      </div>
    </nav>
  );
}
