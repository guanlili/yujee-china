'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getWebTemplate } from './web-registry';
import { adaptPageToTemplateData, type ResolveImage } from './adapt-layout';
import { PAGE } from './templates/constants';
import type { EditorPage } from './types';

// v2 editor preview canvas (design-v1 editor.html, issue #143). A 1.414:1
// two-page spread rendered in 3D perspective with a page-turn flip animation,
// plus the surrounding canvas chrome the redesign introduces:
//   • bottom glassmorphism thumbnail strip (prev/next + indicator + per-spread thumbs)
//   • a zoom control (zoom out past min → whole-magazine overview grid)
//   • a floating, collapsible spread rail on the left of the canvas
//   • an overview grid showing every spread at once
// This is the preview/navigation layer only — editing, chat, export, and the
// topbar stay in AlbumEditor. Pages still render through the real web templates
// at the canonical 794×1123 canvas, so visuals are honest.

const FLIP_MS = 900; // matches .flipper transition in editor.html
const ZMIN = 0.5;
const ZMAX = 2;
const ZSTEP = 0.25;

interface Strings {
  prevPage: string;
  nextPage: string;
  noPages: string;
  editPage: string;
  // "{current} / {total}"
  pageIndicator: string;
  overview: string;
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  chaptersLabel: string;
  collapseChapters: string;
  expandChapters: string;
  // "Spread {n}"
  spreadLabel: string;
}

interface Props {
  pages: EditorPage[];
  totalPages: number;
  resolveImage: ResolveImage;
  /** Currently selected page (array index into `pages`). */
  selected: number;
  /** Select a page by array index (also moves the book to its spread). */
  onSelect: (pageArrayIndex: number) => void;
  /** Open the edit drawer for the page at the given array index. */
  onEditPage: (pageArrayIndex: number) => void;
  t: Strings;
}

// One album page rendered through its real web template, scaled to fill a half
// of the spread (or a thumbnail). `width`/`height` is the rendered pixel size.
function PageFace({
  page,
  totalPages,
  resolveImage,
  width,
  height,
}: {
  page: EditorPage | null;
  totalPages: number;
  resolveImage: ResolveImage;
  width: number;
  height: number;
}) {
  if (!page) {
    return <div style={{ width, height, background: 'var(--surface)' }} />;
  }
  const Template = getWebTemplate(page.templateId);
  const data = adaptPageToTemplateData(
    { templateId: page.templateId, images: page.imagesJson, texts: page.textsJson },
    resolveImage,
  );
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
        {Template ? (
          <Template data={data} totalPages={totalPages} />
        ) : (
          <div style={{ padding: 24, fontSize: 14 }}>Unknown template: {page.templateId}</div>
        )}
      </div>
    </div>
  );
}

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
  selected,
  onSelect,
  onEditPage,
  t,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();

  // Spreads of two pages: spread s -> array indices [2s, 2s+1]. Odd last page
  // gets a blank facing page so the book always shows a full spread.
  const spreadCount = Math.max(1, Math.ceil(pages.length / 2));
  const spreadOf = (arrayIndex: number) => Math.floor(arrayIndex / 2);
  const pagesOfSpread = useCallback(
    (s: number): [EditorPage | null, EditorPage | null] => [pages[s * 2] ?? null, pages[s * 2 + 1] ?? null],
    [pages],
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

  // Zoom + overview state. Zooming out past ZMIN drops into the whole-magazine
  // overview grid; zooming back in (or picking a spread) returns to the book.
  const [zoom, setZoom] = useState(1);
  const [overview, setOverview] = useState(false);

  // Collapsible floating spread rail (design .chapter-card / rail-collapsed).
  const [railCollapsed, setRailCollapsed] = useState(false);

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
      const idx = pages[s * 2] != null ? s * 2 : pages[s * 2 + 1] != null ? s * 2 + 1 : -1;
      if (idx >= 0 && idx !== selected) onSelect(idx);
    },
    [pages, selected, onSelect],
  );

  const goToSpread = useCallback(
    (to: number) => {
      if (to < 0 || to >= spreadCount || to === spread || anim) return;
      const dir: 'next' | 'prev' = to > spread ? 'next' : 'prev';

      // Turning the page is navigation: keep the parent selection in step so the
      // active thumbnail and selection-driven UI follow the visible spread.
      syncSelectionToSpread(to);

      // Reduced motion: jump straight to the target spread, no leaf animation.
      if (reducedMotion) {
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
    [spread, spreadCount, anim, reducedMotion, syncSelectionToSpread],
  );

  // prev/next on the strip move one spread at a time.
  const step = (dir: -1 | 1) => goToSpread(spread + dir);

  // Clicking a page face selects it AND opens the edit drawer (the primary
  // UI-1a affordance), then turns the book to that page's spread if needed.
  const editPage = (arrayIndex: number) => {
    if (arrayIndex < 0 || arrayIndex >= pages.length) return;
    onSelect(arrayIndex);
    onEditPage(arrayIndex);
    goToSpread(spreadOf(arrayIndex));
  };

  // ─── Zoom + overview controls (design zoom-ctrl + book-overview) ───
  const enterOverview = () => setOverview(true);
  const exitOverview = useCallback(() => {
    setOverview(false);
    setZoom(1);
  }, []);
  const zoomBy = useCallback(
    (d: number) => {
      if (overview) {
        if (d > 0) exitOverview(); // zoom in from overview returns to the book
        return;
      }
      const nz = Math.round((zoom + d) * 100) / 100;
      if (nz < ZMIN) {
        enterOverview(); // zoom out past min → see the whole magazine
        return;
      }
      setZoom(Math.min(ZMAX, nz));
    },
    [overview, zoom, exitOverview],
  );
  const resetZoom = () => {
    if (overview) {
      exitOverview();
      return;
    }
    setZoom(1);
  };
  const toggleOverview = () => (overview ? exitOverview() : enterOverview());
  const openSpreadFromOverview = (s: number) => {
    exitOverview();
    goToSpread(s);
  };

  // Cmd/Ctrl + wheel zoom over the canvas (design wheel handler).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? ZSTEP : -ZSTEP);
      }
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

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

  const onLeftHalf = selected === spread * 2;
  const onRightHalf = selected === spread * 2 + 1;

  const indicator = useMemo(
    () => t.pageIndicator.replace('{current}', String(spread + 1)).replace('{total}', String(spreadCount)),
    [t.pageIndicator, spread, spreadCount],
  );
  const zoomPctLabel = overview ? t.overview : `${Math.round(zoom * 100)}%`;

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
      <PageFace page={page} totalPages={totalPages} resolveImage={resolveImage} width={halfW} height={book.h} />
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
        </>
      )}
    </div>
  );

  // ─── Whole-magazine overview grid (design book-overview / ov-grid) ───
  if (overview) {
    return (
      <div ref={stageRef} className="relative flex h-full w-full overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto px-7 pb-20 pt-10 [scrollbar-width:thin]">
          <div className="mx-auto grid max-w-[1100px] grid-cols-[repeat(auto-fill,minmax(300px,1fr))] content-start gap-6">
            {Array.from({ length: spreadCount }, (_, s) => {
              const [ol, or] = pagesOfSpread(s);
              const active = s === spread;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => openSpreadFromOverview(s)}
                  className="group/ov block text-left transition-transform hover:-translate-y-[3px]"
                >
                  <div
                    className="relative flex aspect-[1.414/1] overflow-hidden rounded-[3px] bg-[var(--surface)]"
                    style={{
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 10px 26px rgba(0,0,0,0.10)',
                      outline: active ? '2px solid var(--accent)' : undefined,
                      outlineOffset: active ? 2 : undefined,
                    }}
                  >
                    <div className="flex-1 overflow-hidden">
                      <PageFace page={ol} totalPages={totalPages} resolveImage={resolveImage} width={150} height={106} />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <PageFace page={or} totalPages={totalPages} resolveImage={resolveImage} width={150} height={106} />
                    </div>
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-1/2 z-[2] w-px -translate-x-1/2"
                      style={{ background: 'var(--border-soft)' }}
                    />
                  </div>
                  <div className="mt-2.5 text-center font-mono text-[11px] tracking-[0.04em] text-[var(--fg-2)]">
                    {t.spreadLabel.replace('{n}', String(s + 1))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <ZoomControl
          zoomPctLabel={zoomPctLabel}
          overview={overview}
          t={t}
          onZoomOut={() => zoomBy(-ZSTEP)}
          onZoomIn={() => zoomBy(ZSTEP)}
          onReset={resetZoom}
          onToggleOverview={toggleOverview}
        />
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ perspective: 2400 }}
    >
      {book.w > 0 && (
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
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            transition: 'transform var(--motion-base) var(--ease)',
          }}
        >
          {/* under layer: the resting spread (target pages slot in beneath the leaf during a flip) */}
          <Half page={underLeft} pageArrayIndex={spread * 2} side="left" active={onLeftHalf} />
          <Half page={underRight} pageArrayIndex={spread * 2 + 1} side="right" active={onRightHalf} />

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
                <PageFace page={leafFront} totalPages={totalPages} resolveImage={resolveImage} width={halfW} height={book.h} />
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
                <PageFace page={leafBack} totalPages={totalPages} resolveImage={resolveImage} width={halfW} height={book.h} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Floating, collapsible spread rail (design .chapter-card) ─── */}
      {spreadCount > 1 && (
        <div
          className="absolute left-5 top-1/2 z-[7] hidden -translate-y-1/2 flex-col items-stretch gap-0.5 overflow-y-auto rounded-[20px] border border-white/60 p-1.5 lg:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            width: railCollapsed ? 'auto' : 84,
            maxHeight: '70%',
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            transition: 'width var(--motion-base) var(--ease), padding var(--motion-base) var(--ease)',
          }}
        >
          {!railCollapsed && (
            <>
              <div className="px-2 pb-1.5 pt-0.5 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--meta)]">
                {t.chaptersLabel}
              </div>
              <div className="flex flex-col gap-0.5">
                {Array.from({ length: spreadCount }, (_, s) => {
                  const active = s === spread;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => goToSpread(s)}
                      disabled={!!anim}
                      title={t.spreadLabel.replace('{n}', String(s + 1))}
                      className={`flex flex-col gap-px rounded-[13px] px-2.5 py-1.5 text-left transition-colors ${
                        active ? 'bg-black/[0.06]' : 'hover:bg-black/[0.05]'
                      }`}
                    >
                      <span className={`font-mono text-[9.5px] font-semibold tracking-[0.04em] ${active ? 'text-[var(--fg)]' : 'text-[var(--meta)]'}`}>
                        {String(s + 1).padStart(2, '0')}
                      </span>
                      <span className={`truncate text-[12px] font-semibold leading-tight ${active ? 'text-[var(--fg)]' : 'text-[var(--fg-2)]'}`}>
                        {t.spreadLabel.replace('{n}', String(s + 1))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setRailCollapsed((v) => !v)}
            title={railCollapsed ? t.expandChapters : t.collapseChapters}
            aria-label={railCollapsed ? t.expandChapters : t.collapseChapters}
            className={`flex h-[18px] w-[30px] items-center justify-center self-center rounded-full text-[var(--muted)] transition-colors hover:bg-black/[0.06] hover:text-[var(--fg)] ${railCollapsed ? '' : 'mt-0.5'}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[13px] w-[13px] transition-transform"
              style={{ transform: railCollapsed ? 'rotate(180deg)' : undefined }}
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
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
            return (
              <button
                key={s}
                type="button"
                onClick={() => goToSpread(s)}
                disabled={!!anim}
                title={t.spreadLabel.replace('{n}', String(s + 1))}
                className="flex-shrink-0 transition-transform hover:-translate-y-px"
              >
                <div
                  className="relative flex h-[34px] w-[52px] overflow-hidden rounded-[3px]"
                  style={{
                    border: `1.5px solid ${active ? 'var(--fg)' : 'transparent'}`,
                    boxShadow: active ? '0 0 0 1.5px rgba(0,0,0,0.08)' : undefined,
                    background: 'var(--bg)',
                  }}
                >
                  <div className="h-full flex-1 overflow-hidden">
                    <PageFace page={tl} totalPages={totalPages} resolveImage={resolveImage} width={26} height={34} />
                  </div>
                  <div className="h-full flex-1 overflow-hidden">
                    <PageFace page={tr} totalPages={totalPages} resolveImage={resolveImage} width={26} height={34} />
                  </div>
                  <div
                    aria-hidden
                    className="absolute inset-y-1 left-1/2 z-[1] w-px -translate-x-1/2"
                    style={{ background: 'var(--border-soft)' }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Zoom control (zoom out past min → overview) ─── */}
      <ZoomControl
        zoomPctLabel={zoomPctLabel}
        overview={overview}
        t={t}
        onZoomOut={() => zoomBy(-ZSTEP)}
        onZoomIn={() => zoomBy(ZSTEP)}
        onReset={resetZoom}
        onToggleOverview={toggleOverview}
      />
    </div>
  );
}

// Glass zoom pill (design .zoom-ctrl): −  100%  +  | overview-toggle.
function ZoomControl({
  zoomPctLabel,
  overview,
  t,
  onZoomOut,
  onZoomIn,
  onReset,
  onToggleOverview,
}: {
  zoomPctLabel: string;
  overview: boolean;
  t: Pick<Strings, 'zoomIn' | 'zoomOut' | 'resetZoom' | 'overview'>;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
  onToggleOverview: () => void;
}) {
  const btn =
    'flex h-7 w-7 items-center justify-center rounded-full text-[var(--fg-2)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)]';
  return (
    <div
      className="absolute bottom-3.5 right-4 z-[8] flex items-center gap-px rounded-full border border-[var(--border-soft)] p-1"
      style={{
        background: 'rgba(255,255,255,0.86)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}
    >
      <button type="button" onClick={onZoomOut} title={t.zoomOut} aria-label={t.zoomOut} className={btn}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onReset}
        title={t.resetZoom}
        className="min-w-[46px] cursor-pointer select-none text-center font-mono text-[11px] text-[var(--fg-2)]"
      >
        {zoomPctLabel}
      </button>
      <button type="button" onClick={onZoomIn} title={t.zoomIn} aria-label={t.zoomIn} className={btn}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <span className="mx-[3px] h-4 w-px bg-[var(--border-soft)]" />
      <button
        type="button"
        onClick={onToggleOverview}
        title={t.overview}
        aria-label={t.overview}
        className={`${btn} ${overview ? 'bg-[var(--bg)] text-[var(--fg)]' : ''}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
    </div>
  );
}
