'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getWebTemplate } from './web-registry';
import { adaptPageToTemplateData, type ResolveImage } from './adapt-layout';
import { applyFolioOverlay, pageFolioInfos, preferredPageHtml, type FolioSide, type PageFolio } from './page-html-dom';
import { FittedPageHtml } from './FittedPageHtml';
import { buildSpreads, isSoloSpread, spreadIndexOfPage } from './spreads';
import { PAGE } from './templates/constants';
import type { EditorPage } from './types';
import { useAlbumFonts } from '@/lib/font/album-font-loader';

// UI-1b 3D flipbook: a 1.414:1 two-page spread with a
// center-spine shadow, perspective transform, and a page-turn animation between
// spreads. A bottom glassmorphism thumbnail strip (prev/next + indicator +
// per-spread thumbnails) drives navigation. This is the preview/navigation
// layer only — editing, chat, export, and the topbar stay in AlbumEditor.

const FLIP_MS = 900; // matches .flipper transition in editor.html

interface Strings {
  prevPage: string;
  nextPage: string;
  noPages: string;
  editPage: string;
  // "{current} / {total}"
  pageIndicator: string;
}

interface Props {
  pages: EditorPage[];
  totalPages: number;
  resolveImage: ResolveImage;
  /** 缩略图条用的低清解析器(~240px 派生图)。缺省回退 resolveImage。 */
  resolveThumbImage?: ResolveImage;
  /** Currently selected page (array index into `pages`). */
  selected: number;
  /** Select a page by array index (also moves the book to its spread). */
  onSelect: (pageArrayIndex: number) => void;
  /** Open the edit drawer for the page at the given array index.
   * 只读场景(免登分享页)不传:铅笔按钮不渲染,点击页面仅选中/翻页。 */
  onEditPage?: (pageArrayIndex: number) => void;
  t: Strings;
}

// One album page rendered through its real web template, scaled to fill a half
// of the spread (or a thumbnail). `box` is the rendered pixel size of the page.
// memo 化(性能):翻页/选中变化触发 FlipBook 全量重渲,20+ 页的缩略图条若每次都
// 重建完整页面 DOM 会拖垮交互帧;props 未变的 PageFace 直接复用。
// fitText=false(缩略图)跳过 fit-text 强制重排。
const PageFace = memo(function PageFace({
  page,
  totalPages,
  resolveImage,
  width,
  height,
  folio = null,
  folioSide = 'right',
  fitText = true,
}: {
  page: EditorPage | null;
  totalPages: number;
  resolveImage: ResolveImage;
  width: number;
  height: number;
  // 展示层页签:按当前页序计算(封面/封尾 null),覆盖模板遗留 folio。
  folio?: PageFolio;
  // 页签贴哪侧下角(左页 left / 右页 right),与物理半页一致。
  folioSide?: FolioSide;
  fitText?: boolean;
}) {
  if (!page) {
    return <div style={{ width, height, background: 'var(--surface)' }} />;
  }
  // 页面真相 = 存库 html(含手工版面);缺失时模板即时渲染,再缺回退 React 组件。
  const rawHtml = preferredPageHtml(page, resolveImage);
  const html = rawHtml !== undefined ? applyFolioOverlay(rawHtml, folio, folioSide) : undefined;
  const Template = html === undefined ? getWebTemplate(page.templateId) : null;
  const data =
    Template != null
      ? adaptPageToTemplateData(
          { templateId: page.templateId, images: page.imagesJson, texts: page.textsJson },
          resolveImage,
        )
      : null;
  const scale = Math.min(width / PAGE.width, height / PAGE.height);
  return (
    <div style={{ width, height, overflow: 'hidden', background: '#fff' }}>
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: PAGE.width,
          height: PAGE.height,
        }}
      >
        {html !== undefined ? (
          <FittedPageHtml html={html} fit={fitText} />
        ) : Template && data ? (
          <Template data={data} totalPages={totalPages} imagePos={page.imagePosJson} />
        ) : (
          <div style={{ padding: 24, fontSize: 14 }}>Unknown template: {page.templateId}</div>
        )}
      </div>
    </div>
  );
});

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function FlipBook({
  pages,
  totalPages,
  resolveImage,
  resolveThumbImage,
  selected,
  onSelect,
  onEditPage,
  t,
}: Props) {
  const thumbResolver = resolveThumbImage ?? resolveImage;
  const reducedMotion = usePrefersReducedMotion();
  const fontsReady = useAlbumFonts(pages.map((page) => ({ texts: page.textsJson })));

  // Canvas model: cover/ending sit on their own solo spread; interior pages pair
  // two-up. `spreads` holds the array indices on each spread (null = blank half).
  const spreads = useMemo(() => buildSpreads(pages), [pages]);
  // 展示层页签:每次按当前页序自动计算(内页 1..N;封面/目录/封尾 null)。
  const folioInfos = useMemo(() => pageFolioInfos(pages.map((p) => p.templateId)), [pages]);
  const folioOf = useCallback(
    (page: EditorPage | null): PageFolio => (page ? (folioInfos[pages.indexOf(page)]?.folio ?? null) : null),
    [folioInfos, pages],
  );
  const folioSideOf = useCallback(
    (page: EditorPage | null): FolioSide => (page ? (folioInfos[pages.indexOf(page)]?.side ?? 'right') : 'right'),
    [folioInfos, pages],
  );
  const spreadCount = Math.max(1, spreads.length);
  const spreadOf = useCallback(
    (arrayIndex: number) => {
      const s = spreadIndexOfPage(spreads, arrayIndex);
      return s >= 0 ? s : 0;
    },
    [spreads],
  );
  const pagesOfSpread = useCallback(
    (s: number): [EditorPage | null, EditorPage | null] => {
      const sp = spreads[s];
      return [
        sp?.left != null ? pages[sp.left] ?? null : null,
        sp?.right != null ? pages[sp.right] ?? null : null,
      ];
    },
    [pages, spreads],
  );
  // Is spread `s` a true cover/ending solo page (render single-page, centered,
  // no blank facing half, no spine)? An interior odd-trailing { left:i, right:null }
  // is NOT solo — see isSoloSpread.
  const soloOf = useCallback(
    (s: number) => isSoloSpread(spreads[s], pages),
    [spreads, pages],
  );

  const [spread, setSpread] = useState(() => spreadOf(selected));

  // Keep the book in sync when the selection is driven from elsewhere (e.g. a
  // chat edit that targets a specific page).
  useEffect(() => {
    const target = spreadOf(selected);
    setSpread((cur) => (cur === target ? cur : target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Animation state. `anim` holds the in-flight flip (direction + the spread we
  // are turning toward). While animating we keep painting the *current* spread
  // underneath and render a rotating leaf on top.
  const [anim, setAnim] = useState<null | { dir: 'next' | 'prev'; to: number }>(null);
  const [leafAngle, setLeafAngle] = useState(0);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  // Fit the book into the stage: height drives the size, width follows 1.414:1.
  const stageRef = useRef<HTMLDivElement>(null);
  const [book, setBook] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const availH = el.clientHeight - 96; // room for the thumbnail strip
      const availW = el.clientWidth - 48;
      let h = Math.min(availH, 720);
      let w = h * 1.414;
      if (w > availW) {
        w = availW;
        h = w / 1.414;
      }
      setBook({ w: Math.max(0, w), h: Math.max(0, h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const halfW = book.w / 2;

  // Sync the parent selection to a page belonging to the given spread so the
  // active-thumbnail highlight (and any selection-driven UI) tracks the book.
  const syncSelectionToSpread = useCallback(
    (s: number) => {
      const sp = spreads[s];
      const idx = sp?.left ?? sp?.right ?? -1;
      if (idx >= 0 && idx !== selected) onSelect(idx);
    },
    [spreads, selected, onSelect],
  );

  const goToSpread = useCallback(
    (to: number) => {
      if (to < 0 || to >= spreadCount || to === spread || anim) return;
      const dir: 'next' | 'prev' = to > spread ? 'next' : 'prev';

      // Turning the page is navigation: keep the parent selection in step so the
      // active thumbnail and selection-driven UI follow the visible spread.
      syncSelectionToSpread(to);

      // Reduced motion, OR a solo cover/ending on either end: jump straight to the
      // target spread with no leaf animation. The half-width leaf flip is a
      // double-page⇄double-page move; a solo page has a different (single-page)
      // width, so a cross-width leaf would tear/misplace. A direct switch is the
      // safe transition for solo edges (no residue, no blank flash).
      if (reducedMotion || soloOf(spread) || soloOf(to)) {
        setSpread(to);
        return;
      }

      setAnim({ dir, to });
      setLeafAngle(0);
      // Next frame, kick the leaf to its end angle so the transition runs.
      requestAnimationFrame(() => {
        setLeafAngle(dir === 'next' ? -180 : 180);
      });
      timerRef.current = window.setTimeout(() => {
        setSpread(to);
        setAnim(null);
        setLeafAngle(0);
        timerRef.current = null;
      }, FLIP_MS + 40);
    },
    [spread, spreadCount, anim, reducedMotion, syncSelectionToSpread, soloOf],
  );

  // prev/next on the strip move one spread at a time.
  const step = (dir: -1 | 1) => goToSpread(spread + dir);

  // Clicking a page face selects it AND opens the edit drawer (the primary
  // UI-1a affordance), then turns the book to that page's spread if needed.
  const editPage = (arrayIndex: number) => {
    if (arrayIndex < 0 || arrayIndex >= pages.length) return;
    onSelect(arrayIndex);
    onEditPage?.(arrayIndex);
    goToSpread(spreadOf(arrayIndex));
  };

  const [curLeft, curRight] = pagesOfSpread(spread);

  // Leaf faces depend on flip direction. Forward: the current right page is the
  // leaf front; it turns to reveal the next spread's left page (leaf back), and
  // the next right page is painted underneath. Backward is the mirror.
  const target = anim ? pagesOfSpread(anim.to) : null;
  let underLeft = curLeft;
  let underRight = curRight;
  let leafFront: EditorPage | null = null;
  let leafBack: EditorPage | null = null;
  if (anim && target) {
    if (anim.dir === 'next') {
      underRight = target[1]; // new right page sits beneath the turning leaf
      leafFront = curRight; // outgoing right page, on the right half
      leafBack = target[0]; // incoming left page
    } else {
      underLeft = target[0]; // new left page sits beneath the turning leaf
      leafFront = curLeft; // outgoing left page, on the left half
      leafBack = target[1]; // incoming right page
    }
  }

  const onLeftHalf = selected === spreads[spread]?.left;
  const onRightHalf = selected === spreads[spread]?.right;

  // Solo cover/ending: render a single centered page (no blank facing half, no
  // spine). Animation is already suppressed for solo edges in goToSpread, so the
  // book is only ever solo while at rest (anim is null) — the single page is
  // whichever half the spread occupies.
  const soloHere = isSoloSpread(spreads[spread], pages);
  const soloPage = soloHere ? (curLeft ?? curRight) : null;
  const soloArrayIndex = soloHere ? (spreads[spread]?.left ?? spreads[spread]?.right ?? -1) : -1;
  const soloActive = soloHere && selected === soloArrayIndex;

  const indicator = useMemo(
    () => t.pageIndicator.replace('{current}', String(spread + 1)).replace('{total}', String(spreadCount)),
    [t.pageIndicator, spread, spreadCount],
  );

  if (pages.length === 0) {
    return (
      <div ref={stageRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
        <p className="text-[var(--text-sm)] text-[var(--muted)]">{t.noPages}</p>
      </div>
    );
  }

  // A clickable half-page: selects + opens edit on its own page, shows the edit
  // affordance on hover (preserving the UI-1a "click page to edit" behaviour).
  const Half = ({
    page,
    pageArrayIndex,
    side,
    active,
  }: {
    page: EditorPage | null;
    pageArrayIndex: number;
    side: 'left' | 'right';
    active: boolean;
  }) => (
    <div
      className="group/half relative"
      style={{ width: halfW, height: book.h, background: 'var(--surface)' }}
    >
      <PageFace page={page} totalPages={totalPages} resolveImage={resolveImage} width={halfW} height={book.h} folio={folioOf(page)} folioSide={folioSideOf(page)} />
      {page && (
        <>
          <button
            type="button"
            onClick={() => editPage(pageArrayIndex)}
            onDoubleClick={() => editPage(pageArrayIndex)}
            className="absolute inset-0 cursor-pointer"
            style={active ? { boxShadow: 'inset 0 0 0 2px var(--fg)' } : undefined}
            title={t.editPage}
            aria-label={t.editPage}
          />
          {onEditPage && (
            <button
              type="button"
              onClick={() => editPage(pageArrayIndex)}
              title={t.editPage}
              aria-label={t.editPage}
              className={`absolute top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--fg-2)] opacity-0 shadow-[var(--shadow-card)] transition-opacity hover:text-[var(--fg)] group-hover/half:opacity-100 ${
                side === 'left' ? 'left-2' : 'right-2'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      ref={stageRef}
      data-album-fonts-ready={fontsReady}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ perspective: 2400 }}
    >
      {book.w > 0 && soloHere && (
        // Solo cover/ending: one centered page, half-width container, no facing
        // blank half, no center spine, no leaf. The page-turn into/out of here is
        // a direct switch (see goToSpread), so anim is always null while solo.
        <div
          className="relative flex"
          style={{
            width: halfW,
            height: book.h,
            borderRadius: 2,
            background: 'var(--surface)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.08)',
            overflow: 'hidden',
          }}
        >
          <Half page={soloPage} pageArrayIndex={soloArrayIndex} side="left" active={soloActive} />
        </div>
      )}

      {book.w > 0 && !soloHere && (
        <div
          className="relative flex"
          style={{
            width: book.w,
            height: book.h,
            borderRadius: 2,
            background: 'var(--surface)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.08)',
            transformStyle: 'preserve-3d',
            overflow: 'hidden',
          }}
        >
          {/* under layer: the resting spread (target pages slot in beneath the leaf during a flip) */}
          <Half page={underLeft} pageArrayIndex={spreads[spread]?.left ?? -1} side="left" active={onLeftHalf} />
          <Half page={underRight} pageArrayIndex={spreads[spread]?.right ?? -1} side="right" active={onRightHalf} />

          {/* center spine shadow */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 z-[5] -translate-x-1/2"
            style={{
              width: 24,
              background:
                'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.10) 45%, rgba(0,0,0,0.14) 50%, rgba(0,0,0,0.10) 55%, rgba(0,0,0,0) 100%)',
            }}
          />

          {/* turning leaf */}
          {anim && (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 z-[6]"
              style={{
                width: halfW,
                left: anim.dir === 'next' ? '50%' : 0,
                transformStyle: 'preserve-3d',
                transformOrigin: anim.dir === 'next' ? 'left center' : 'right center',
                transform: `rotateY(${leafAngle}deg)`,
                transition: `transform ${FLIP_MS}ms cubic-bezier(.45,.05,.2,1)`,
              }}
            >
              <div
                className="absolute inset-0"
                style={{ backfaceVisibility: 'hidden', background: 'var(--surface)' }}
              >
                <PageFace page={leafFront} totalPages={totalPages} resolveImage={resolveImage} width={halfW} height={book.h} folio={folioOf(leafFront)} folioSide={folioSideOf(leafFront)} />
                {/* page-turn shading on the leaf front */}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      anim.dir === 'next'
                        ? 'linear-gradient(90deg, transparent 70%, rgba(0,0,0,.08))'
                        : 'linear-gradient(90deg, rgba(0,0,0,.08), transparent 30%)',
                  }}
                />
              </div>
              <div
                className="absolute inset-0"
                style={{ backfaceVisibility: 'hidden', background: 'var(--surface)', transform: 'rotateY(180deg)' }}
              >
                <PageFace page={leafBack} totalPages={totalPages} resolveImage={resolveImage} width={halfW} height={book.h} folio={folioOf(leafBack)} folioSide={folioSideOf(leafBack)} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Bottom glassmorphism thumbnail strip ─── */}
      <div
        className="absolute bottom-3 left-1/2 z-[6] flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5"
        style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        }}
      >
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={spread === 0 || !!anim}
          title={t.prevPage}
          aria-label={t.prevPage}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)] disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span className="min-w-[36px] flex-shrink-0 text-center font-mono text-[10px] font-medium tabular-nums text-[var(--fg-2)]">
          {indicator}
        </span>

        <button
          type="button"
          onClick={() => step(1)}
          disabled={spread >= spreadCount - 1 || !!anim}
          title={t.nextPage}
          aria-label={t.nextPage}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)] disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* per-spread thumbnails */}
        <div className="flex gap-1.5 overflow-x-auto p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {Array.from({ length: spreadCount }, (_, s) => {
            const [tl, tr] = pagesOfSpread(s);
            // Highlight the spread currently shown in the book, not a stale
            // selection — turning the page keeps the two in lockstep.
            const active = s === spread;
            // Solo cover/ending thumbnail: a single centered page, no blank facing
            // half and no spine divider — mirrors the book's solo render. (An
            // interior odd-trailing spread is NOT solo and keeps its blank half.)
            const solo = soloOf(s);
            const soloThumb = solo ? (tl ?? tr) : null;
            return (
              <button
                key={s}
                type="button"
                onClick={() => goToSpread(s)}
                disabled={!!anim}
                title={`${s + 1}`}
                className="flex-shrink-0 transition-transform hover:-translate-y-px"
              >
                <div
                  className={`relative flex h-[34px] overflow-hidden rounded-[3px] ${solo ? 'w-[26px]' : 'w-[52px]'}`}
                  style={{
                    border: `1.5px solid ${active ? 'var(--fg)' : 'transparent'}`,
                    boxShadow: active ? '0 0 0 1.5px rgba(0,0,0,0.08)' : undefined,
                    background: 'var(--bg)',
                  }}
                >
                  {solo ? (
                    <div className="h-full w-full overflow-hidden">
                      <PageFace page={soloThumb} totalPages={totalPages} resolveImage={thumbResolver} fitText={false} width={26} height={34} />
                    </div>
                  ) : (
                    <>
                      <div className="h-full flex-1 overflow-hidden">
                        <PageFace page={tl} totalPages={totalPages} resolveImage={thumbResolver} fitText={false} width={26} height={34} />
                      </div>
                      <div className="h-full flex-1 overflow-hidden">
                        <PageFace page={tr} totalPages={totalPages} resolveImage={thumbResolver} fitText={false} width={26} height={34} />
                      </div>
                      <div
                        aria-hidden
                        className="absolute inset-y-1 left-1/2 z-[1] w-px -translate-x-1/2"
                        style={{ background: 'var(--border-soft)' }}
                      />
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
