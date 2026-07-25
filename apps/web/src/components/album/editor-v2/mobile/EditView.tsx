'use client';

/* ════════════════════════════════════════════════════════════════════════════
   EditView —— 编辑态视图。

   浏览态点某页进来:那页放大到满屏单页(**按新尺寸重绘,不是 transform 拉伸** ——
   移动端不做书的自由缩放),左右滑逐页翻,顶栏返回退回浏览态。
   底部是一级栏四格:背景 · 图片 · 文字 · 删除(按设计稿)。

   翻页语义(单页、逐页、夹边)与浏览态密度 1 完全一致 → 父层直接复用 stepScreen,
   这里只发 onStep(dir)/onExit,不自己算页。

   一级栏各格点开的二级面板(页面底色取色器等)在后续切片接线,一律复用现有成品弹窗,
   不另画一套。
   ════════════════════════════════════════════════════════════════════════════ */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { EditorPage } from '../../types';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';
import { pageFolioNumbers, pageFolioSides } from '../../page-html-dom';
import type { ResolveImage } from '../../adapt-layout';
import { fitBox, spreadAspect } from './fit-box';
import { MobileTopbar } from './MobileTopbar';
import { IconPageBg, IconImage, IconText, IconTrash, IconSparkle } from './icons';

export type EditViewProps = {
  pages: EditorPage[];
  resolve: ResolveImage;
  boardBackground?: string | null;
  /** 正在编辑的页 index。 */
  editPage: number;
  /** 顶栏返回:退回浏览态。 */
  onExit: () => void;
  /** 左右滑翻页:+1 下一页 / -1 上一页(夹边由父层的 stepScreen 处理)。 */
  onStep: (dir: 1 | -1) => void;
  onShare?: () => void;
  onExport?: () => void;
  onMore?: () => void;
  onOpenChat?: () => void;
  /** 一级栏四格(后续切片接现有成品弹窗)。 */
  onPageBg?: () => void;
  onPickImage?: () => void;
  onPickText?: () => void;
  onDeletePage?: () => void;
};

/** 编辑态页面四周留白:比浏览态更满(单页受宽本就左右留白,这里只给一点呼吸)。 */
const INSET = 12;
const EDGE_GUARD = 20; // iOS 左缘返回让位
const SWIPE_MIN = 48;

export function EditView({
  pages,
  resolve,
  boardBackground,
  editPage,
  onExit,
  onStep,
  onShare,
  onExport,
  onMore,
  onOpenChat,
  onPageBg,
  onPickImage,
  onPickText,
  onDeletePage,
}: EditViewProps) {
  const [area, setArea] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const boardRef = useRef<HTMLDivElement>(null);

  const folios = useMemo(() => pageFolioNumbers(pages.map((p) => p.templateId)), [pages]);
  const folioSides = useMemo(() => pageFolioSides(pages.map((p) => p.templateId)), [pages]);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setArea((prev) =>
        Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
          ? prev
          : { w: r.width, h: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const page = pages[editPage] ?? null;
  const ctx: PageFaceCtx = {
    folio: folios[editPage] ?? null,
    folioSide: folioSides[editPage] ?? 'right',
    total: pages.length,
    resolve,
  };
  const box = fitBox(
    Math.max(0, area.w - INSET * 2),
    Math.max(0, area.h - INSET * 2),
    spreadAspect(1),
  );

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
    onStep(dx < 0 ? 1 : -1);
  };

  return (
    <div
      className="mobile-editor"
      data-mode="edit"
      style={boardBackground ? { background: boardBackground } : undefined}
    >
      <MobileTopbar
        title={`第 ${editPage + 1} 页`}
        onBack={onExit}
        backLabel="返回浏览"
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
        <div className="mspread" style={{ width: box.w, height: box.h }}>
          <div className="mpage" style={{ width: box.w }}>
            <div
              className="mpage-face"
              dangerouslySetInnerHTML={{
                __html: box.w > 0 ? pageFaceHTML(page, box.w, box.h, ctx) : '',
              }}
            />
          </div>
        </div>

        <button type="button" className="mai" aria-label="AI 助手" onClick={onOpenChat}>
          <IconSparkle className="mai-ic" />
        </button>
      </div>

      {/* 一级栏:都是页面级入口,不用先选中。图片/文字点开后才是「先选中再编辑」。 */}
      <nav className="ml1" aria-label="编辑工具">
        <button type="button" className="ml1-cell" onClick={onPageBg}>
          <IconPageBg className="ml1-ic" />
          <span>背景</span>
        </button>
        <button type="button" className="ml1-cell" onClick={onPickImage}>
          <IconImage className="ml1-ic" />
          <span>图片</span>
        </button>
        <button type="button" className="ml1-cell" onClick={onPickText}>
          <IconText className="ml1-ic" />
          <span>文字</span>
        </button>
        <button type="button" className="ml1-cell" data-danger="1" onClick={onDeletePage}>
          <IconTrash className="ml1-ic" />
          <span>删除</span>
        </button>
      </nav>
    </div>
  );
}
