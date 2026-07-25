'use client';

/* ════════════════════════════════════════════════════════════════════════════
   EditView —— 编辑态视图。

   浏览态点某页进来:那页放大到满屏单页(**按新尺寸重绘,不是 transform 拉伸** ——
   移动端不做书的自由缩放),左右滑逐页翻,顶栏返回退回浏览态。
   底部是一级栏四格:背景 · 图片 · 文字 · 删除(按设计稿)。

   翻页语义(单页、逐页、夹边)与浏览态密度 1 完全一致 → 父层直接复用 stepScreen,
   这里只发 onStep(dir)/onExit,不自己算页。

   ── 选中链路 ──────────────────────────────────────────────────────────────
   页面内容是 pageFaceHTML 产出的 HTML 字符串,那些节点 React 不拥有,而移动端
   又不许碰 document/querySelector。所以选中只用**事件里的 target**:
     · 命中:target.closest('[data-text-key]') 拿槽 id
     · 位置:target 与 .mspread 的 rect 相减 → 画一个 React 拥有的高亮框
     · 初值:getComputedStyle(target) 读当前字号/颜色/对齐,面板打开即显示真实样式
   一个 querySelector 都不需要,高亮也不是往别人的 DOM 里塞节点。

   面板升起时会盖住屏幕下 2/3(.mes-card 是 66vh)。若选中的元素正落在被盖住的
   区域,把书整体上移到面板之上 —— 这是「让被编辑的东西看得见」,不是自由缩放。
   ════════════════════════════════════════════════════════════════════════════ */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { EditorPage } from '../../types';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';
import { pageFolioNumbers, pageFolioSides } from '../../page-html-dom';
import type { ResolveImage } from '../../adapt-layout';
import { fitBox, spreadAspect } from './fit-box';
import { MobileTopbar } from './MobileTopbar';
import { IconPageBg, IconImage, IconText, IconTrash } from './icons';
import type { ComputedProbe, SelRect } from './page-edit';

/** 点中一个文字槽后交给父层的全部信息(父层据此开面板、落库)。 */
export type TextHit = { slotId: string; rect: SelRect; probe: ComputedProbe };

export type EditViewProps = {
  pages: EditorPage[];
  resolve: ResolveImage;
  boardBackground?: string | null;
  zh: boolean;
  /** 正在编辑的页 index。 */
  editPage: number;
  /** 当前选中的文字槽(父层持有;null = 没选中)。 */
  selection: { slotId: string; rect: SelRect } | null;
  /** 面板是否升起 —— 决定要不要把书上移让出位置。 */
  sheetOpen: boolean;
  /** 顶栏返回:退回浏览态。 */
  onExit: () => void;
  /** 左右滑翻页:+1 下一页 / -1 上一页(夹边由父层的 stepScreen 处理)。 */
  onStep: (dir: 1 | -1) => void;
  /** 点中文字槽。 */
  onSelectText: (hit: TextHit) => void;
  /** 点中图片槽(本版不接图片编辑 → 父层给反馈,不做死区)。 */
  onSelectImage: () => void;
  /** 点页面空白处:取消选中。 */
  onClearSelection: () => void;
  /** 交互 handler 一律必填(理由同 MobileEditor):漏接 = 死按钮 = 编译不过。 */
  onShare: () => void;
  onExport: () => void;
  onMore: () => void;
  onOpenChat: () => void;
  onPageBg: () => void;
  onPickImage: () => void;
  onPickText: () => void;
  onDeletePage: () => void;
};

/** 编辑态页面四周留白:比浏览态更满(单页受宽本就左右留白,这里只给一点呼吸)。 */
const INSET = 12;
const EDGE_GUARD = 20; // iOS 左缘返回让位
const SWIPE_MIN = 48;
/** 位移超过这个数就当滑动:随后那记合成 click 不该改选中。 */
const TAP_MAX = 10;
/** .mes-card 的高度(editor-port.css: height:66vh)—— 上移量按它算。 */
const SHEET_VH = 0.66;
/** 被编辑元素与面板顶边之间留的呼吸。 */
const LIFT_PAD = 12;

export function EditView({
  pages,
  resolve,
  boardBackground,
  zh,
  editPage,
  selection,
  sheetOpen,
  onExit,
  onStep,
  onSelectText,
  onSelectImage,
  onClearSelection,
  onShare,
  onExport,
  onMore,
  onOpenChat,
  onPageBg,
  onPickImage,
  onPickText,
  onDeletePage,
}: EditViewProps) {
  // top/vh 只为算「面板升起时书要上移多少」;都在 layout effect 里量,渲染期不读 window。
  const [area, setArea] = useState<{ w: number; h: number; top: number; vh: number }>({
    w: 0,
    h: 0,
    top: 0,
    vh: 0,
  });
  const boardRef = useRef<HTMLDivElement>(null);
  const spreadRef = useRef<HTMLDivElement>(null);

  const folios = useMemo(() => pageFolioNumbers(pages.map((p) => p.templateId)), [pages]);
  const folioSides = useMemo(() => pageFolioSides(pages.map((p) => p.templateId)), [pages]);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      setArea((prev) =>
        Math.abs(prev.w - r.width) < 0.5 &&
        Math.abs(prev.h - r.height) < 0.5 &&
        Math.abs(prev.top - r.top) < 0.5 &&
        prev.vh === vh
          ? prev
          : { w: r.width, h: r.height, top: r.top, vh },
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

  // 书在画板里是居中的 → 开页顶边相对画板的偏移。
  const spreadTop = Math.max(0, (area.h - box.h) / 2);
  // 面板升起且选中的元素被盖住时,把书上移到面板之上(最多移到画板顶边,不去盖顶栏)。
  const lift =
    sheetOpen && selection && area.vh > 0
      ? Math.min(
          spreadTop,
          Math.max(
            0,
            area.top +
              spreadTop +
              selection.rect.top +
              selection.rect.height +
              LIFT_PAD -
              area.vh * (1 - SHEET_VH),
          ),
        )
      : 0;

  const swipe = useRef<{ x: number; y: number } | null>(null);
  // 滑动收尾浏览器还会补一记 click —— 不吞掉的话一次翻页会顺手改掉选中。
  const moved = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    moved.current = false;
    swipe.current = e.clientX <= EDGE_GUARD ? null : { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) > TAP_MAX || Math.abs(dy) > TAP_MAX) moved.current = true;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return; // 不够横 / 更像竖滑
    onStep(dx < 0 ? 1 : -1);
  };

  const onFaceClick = (e: React.MouseEvent) => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    const host = spreadRef.current;
    if (!host) return;
    const target = e.target as HTMLElement;
    if (target.closest('img[data-image-slot]')) {
      onSelectImage();
      return;
    }
    // [data-text-key] 是文字槽的权威标记(与桌面同口径)。隐藏的 folio 槽是
    // display:none、folio 覆盖层是 pointer-events:none,都点不到。
    const el = target.closest<HTMLElement>('[data-text-key]');
    const slotId = el?.dataset.textKey;
    if (!el || !slotId) {
      onClearSelection();
      return;
    }
    const t = el.getBoundingClientRect();
    const s = host.getBoundingClientRect();
    // rect 取的是**缩放后**的视觉尺寸(页面整体 transform:scale)→ 高亮框天然贴合;
    // computed 的字号是缩放前的 CSS px → 正是要写进 794×1123 版面的值。
    const cs = window.getComputedStyle(el);
    onSelectText({
      slotId,
      rect: { left: t.left - s.left, top: t.top - s.top, width: t.width, height: t.height },
      probe: {
        text: el.textContent ?? '',
        fontSize: cs.fontSize,
        color: cs.color,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textAlign: cs.textAlign,
        fontFamily: cs.fontFamily,
      },
    });
  };

  return (
    <div
      className="mobile-editor"
      data-mode="edit"
      style={boardBackground ? { background: boardBackground } : undefined}
    >
      <MobileTopbar
        title={zh ? `第 ${editPage + 1} 页` : `Page ${editPage + 1}`}
        zh={zh}
        onBack={onExit}
        backLabel={zh ? '返回浏览' : 'Back to browsing'}
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
        <div
          ref={spreadRef}
          className="mspread"
          // 编辑态永远是满屏单页 → 没有中缝(与 FlipBook 的 solo 分支同口径)。
          data-halves={1}
          style={{
            width: box.w,
            height: box.h,
            ...(lift > 0 ? { transform: `translateY(${-lift}px)` } : {}),
          }}
        >
          <div className="mpage" style={{ width: box.w }}>
            <div
              className="mpage-face"
              onClick={onFaceClick}
              dangerouslySetInnerHTML={{
                __html: box.w > 0 ? pageFaceHTML(page, box.w, box.h, ctx) : '',
              }}
            />
          </div>
          {selection && (
            <div
              className="msel"
              aria-hidden="true"
              style={{
                left: selection.rect.left,
                top: selection.rect.top,
                width: selection.rect.width,
                height: selection.rect.height,
              }}
            />
          )}
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

      {/* 一级栏:背景是页面级入口;图片/文字是「点页面上的元素来选中」的提示入口。 */}
      <nav className="ml1" aria-label={zh ? '编辑工具' : 'Editing tools'}>
        <button type="button" className="ml1-cell" onClick={onPageBg}>
          <IconPageBg className="ml1-ic" />
          <span>{zh ? '背景' : 'Background'}</span>
        </button>
        <button type="button" className="ml1-cell" onClick={onPickImage}>
          <IconImage className="ml1-ic" />
          <span>{zh ? '图片' : 'Photo'}</span>
        </button>
        <button type="button" className="ml1-cell" onClick={onPickText}>
          <IconText className="ml1-ic" />
          <span>{zh ? '文字' : 'Text'}</span>
        </button>
        <button type="button" className="ml1-cell" data-danger="1" onClick={onDeletePage}>
          <IconTrash className="ml1-ic" />
          <span>{zh ? '删除' : 'Delete'}</span>
        </button>
      </nav>
    </div>
  );
}
