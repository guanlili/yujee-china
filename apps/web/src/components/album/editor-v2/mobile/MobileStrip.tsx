'use client';

/* 书册预览栏(浏览态底部):整本书一条横排渲染真实版面,当前格描黑框,点即跳。

   **一格 = 画布的一屏**,不是一页。早先是一页一格,而点击走 screenStartOfPage 会把游标
   吸到所在屏的起点 —— 密度 2 下每个开页的右页于是成了死格:点它游标回到左页,高亮不落在
   你点的那一格,再点还是没反应。8 页的书有 3 个死格,看着就像坏了。格子改成按屏出之后,
   格与屏一一对应,死格在构造上不可能存在。分屏口径来自 browse-window,与画布同一份。

   照片走 **thumb 档派生图(~240px)** —— 与桌面缩略图条同一分级。主画布用 display
   档(~1600px),拿它来渲一整条几十页的小图会把解码和滚动一起拖垮(屏显分级的原因)。 */

import { useMemo } from 'react';

import type { EditorPage } from '../../types';
import { pageSlot } from '../../spreads';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';
import type { BrowseUnit } from './browse-window';

/** 单页尺寸(794:1123)。一格里并排几页由 unit 决定。 */
export const STRIP_CELL_W = 40;
export const STRIP_CELL_H = Math.round((STRIP_CELL_W * 1123) / 794);

export type MobileStripProps = {
  pages: EditorPage[];
  /** 格子 = 屏,来自 browseUnits(与画布同一套分屏)。 */
  units: BrowseUnit[];
  zh: boolean;
  /** 当前页游标,用来描高亮框。 */
  currentPage: number;
  /** 缩略档的渲染上下文(照片走 thumb tier)。引用必须稳定,否则每帧重渲整条。 */
  thumbCtxOf: (pageIndex: number) => PageFaceCtx;
  onJump: (pageIndex: number) => void;
};

export function MobileStrip({ pages, units, zh, currentPage, thumbCtxOf, onJump }: MobileStripProps) {
  // 按页缓存(不按格):切密度只是重新分组,不该让每一页的 HTML 重渲一遍。
  const faces = useMemo(
    () => pages.map((p, i) => pageFaceHTML(p, STRIP_CELL_W, STRIP_CELL_H, thumbCtxOf(i))),
    [pages, thumbCtxOf],
  );

  const label = (u: BrowseUnit) => {
    const first = u.pageIndices[0] ?? 0;
    const last = u.pageIndices[u.pageIndices.length - 1] ?? first;
    if (first === last) return zh ? `第 ${first + 1} 页` : `Page ${first + 1}`;
    return zh ? `第 ${first + 1}–${last + 1} 页` : `Pages ${first + 1}–${last + 1}`;
  };

  return (
    <nav className="mstrip" aria-label={zh ? '书册预览' : 'Book preview'}>
      <div className="mstrip-track">
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
              onClick={() => onJump(u.startPage)}
            >
              {u.pageIndices.map((pi) => (
                <span
                  key={pi}
                  className="mstrip-face"
                  data-slot={pageSlot(pages[pi]!)}
                  dangerouslySetInnerHTML={{ __html: faces[pi]! }}
                />
              ))}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
