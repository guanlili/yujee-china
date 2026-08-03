'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getWebTemplate } from './web-registry';
import { adaptPageToTemplateData, type ResolveImage } from './adapt-layout';
import { applyFolioOverlay, pageFolioInfos, preferredPageHtml, type FolioSide, type PageFolio } from './page-html-dom';
import { FittedPageHtml } from './FittedPageHtml';
import { buildSpreads, isSoloSpread, shouldDirectSwitch, spreadIndexOfPage, spreadPageIndices } from './spreads';
import { PAGE, pageBox } from './templates/constants';
import type { EditorPage } from './types';
import { useAlbumFonts } from '@/lib/font/album-font-loader';

// UI-1b 3D flipbook: a 1.414:1 two-page spread with a
// center-spine shadow, perspective transform, and a page-turn animation between
// spreads. 唯一消费方是免登分享页(SharedAlbum)。导航是书两侧各一枚小圆钮
// (2026-08-03 用户拍板:底部缩略图条退场、分享页不画选中框 —— 分享是纯阅读面,
// 不是编辑器)。This is the preview/navigation layer only — editing, chat,
// export, and the topbar stay in the editor.

const FLIP_MS = 900; // matches .flipper transition in editor.html

// 高仿真书体投影:三层(贴地 1px / 近影 / 远影),与 editor-port .book 同一配方。
// 分享页与编辑器书籍模式必须是同一本书的质感,改这里要连 editor-port.css 一起改。
const BOOK_SHADOW =
  '0 1px 2px rgba(20,24,23,.16), 0 10px 24px rgba(20,24,23,.13), 0 28px 58px rgba(20,24,23,.10)';

// 书口纸张堆叠(页缘):细竖线模拟叠起来的纸芯边缘。放在书体矩形之外、书影之上,
// 上下各缩一点 —— 纸芯比封面略短,才像真书。strip 本身不可点、不进无障碍树。
function PaperEdges({ sides, width }: { sides: readonly ('left' | 'right')[]; width: number }) {
  return (
    <>
      {sides.map((side) => (
        <div
          key={side}
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            top: '0.8%',
            bottom: '0.6%',
            width,
            [side]: -width,
            background:
              'repeating-linear-gradient(90deg, #fcfbf8 0px, #fcfbf8 1.6px, #d9d4ca 1.6px, #d9d4ca 2.4px)',
            borderRadius: side === 'left' ? '2px 0 0 2px' : '0 2px 2px 0',
            boxShadow:
              side === 'left'
                ? 'inset -1px 0 0 rgba(24,28,27,.10), 0 1px 2px rgba(20,24,23,.12)'
                : 'inset 1px 0 0 rgba(24,28,27,.10), 0 1px 2px rgba(20,24,23,.12)',
          }}
        />
      ))}
    </>
  );
}

interface Strings {
  prevPage: string;
  nextPage: string;
  noPages: string;
  editPage: string;
}

/** 书体上的一个面:pair 的半页,或双宽页(#303)裁出来的一半(half 标注哪半)。 */
type BookFace = { page: EditorPage | null; index: number; half?: 'left' | 'right' };

interface Props {
  pages: EditorPage[];
  totalPages: number;
  resolveImage: ResolveImage;
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
  half,
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
  /** 双宽页(#303)裁半:框是半页宽,内容按整幅缩放,右半左移一个框宽。
   *  「拆渲染不拆数据」—— 数据仍是一页,书上是装订在一起的两个半页。
   *  只对双宽模板生效,普通页忽略。 */
  half?: 'left' | 'right';
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
  const box = pageBox(page.templateId);
  const wide = half != null && box.width > PAGE.width;
  const scale = wide
    ? Math.min((width * 2) / box.width, height / box.height)
    : Math.min(width / box.width, height / box.height);
  // transform 列表右→左生效:先 scale 再平移,平移量因此是屏幕 px(正好一个框宽)。
  const shift = wide && half === 'right' ? `translateX(${-width}px) ` : '';
  return (
    <div style={{ width, height, overflow: 'hidden', background: '#fff' }}>
      <div
        style={{
          transform: `${shift}scale(${scale})`,
          transformOrigin: 'top left',
          width: box.width,
          height: box.height,
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
  selected,
  onSelect,
  onEditPage,
  t,
}: Props) {
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
  // 只对「左右两半」的跨页有意义。双宽(#303)跨页是**一整张**双宽面,不是两半 ——
  // 它走 fullIndexOf/fullPageOf,这里返回两个空半页只是为了让配对渲染分支安全地
  // 短路(渲染时先判 fullIndexOf,永远不会拿这两个 null 去画)。
  const pagesOfSpread = useCallback(
    (s: number): [EditorPage | null, EditorPage | null] => {
      const sp = spreads[s];
      if (!sp || sp.kind === 'full') return [null, null];
      return [
        sp.left != null ? pages[sp.left] ?? null : null,
        sp.right != null ? pages[sp.right] ?? null : null,
      ];
    },
    [pages, spreads],
  );
  // 书体渲染用的「左右两个面」。pair = 左右两页;full(#303)= **同一页摆两次**,
  // 左半裁/右半裁 —— 装订在一起的两个半页,有中缝、各带页码角、各自参与叶片翻页。
  // 数据仍是一页(拆渲染不拆数据),点任一半编辑的都是那一页。
  const facesOfSpread = useCallback(
    (s: number): [BookFace, BookFace] => {
      const sp = spreads[s];
      if (!sp) return [{ page: null, index: -1 }, { page: null, index: -1 }];
      if (sp.kind === 'full') {
        const page = pages[sp.page] ?? null;
        return [
          { page, index: sp.page, half: 'left' },
          { page, index: sp.page, half: 'right' },
        ];
      }
      return [
        { page: sp.left != null ? pages[sp.left] ?? null : null, index: sp.left ?? -1 },
        { page: sp.right != null ? pages[sp.right] ?? null : null, index: sp.right ?? -1 },
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
      // 翻页钮的让位随断点走(与 Tailwind md/产品 767 移动判定同一边界):
      // 桌面钮在书两侧 → 横向各留 52px(12 贴边 + 36 钮 + 4 隙);
      // 移动端(≤767)钮在底部居中 → 纵向留 88px,横向只留呼吸边。
      const mobile = window.innerWidth < 768;
      const availH = el.clientHeight - (mobile ? 88 : 32);
      const availW = el.clientWidth - (mobile ? 16 : 104);
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
  // 书脊沟槽宽随书宽走(editor-port 用 clamp(26px,3.8vw,44px);这里书宽是实测 px)。
  const spineW = Math.max(26, Math.min(44, Math.round(book.w * 0.038)));
  // 书口纸叠宽:约书宽 1.1%,最少 6px(太窄看不出纸线)。
  const edgeW = Math.max(6, Math.round(book.w * 0.011));

  // Sync the parent selection to a page belonging to the given spread so the
  // active-thumbnail highlight (and any selection-driven UI) tracks the book.
  const syncSelectionToSpread = useCallback(
    (s: number) => {
      // 该跨页占的第一个真实页(双宽跨页就是它自己那一页)。
      const idx = spreadPageIndices(spreads[s])[0] ?? -1;
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
      // 双宽(#303)跨页**不再**直切:facesOfSpread 把它裁成装订在一起的左右两半,
      // 叶片翻页照常(翻进它=背面是它的左半,翻出它=正面是它的右半)。
      // 原因的 OR 逻辑住在 shouldDirectSwitch(spreads.ts,真单测覆盖),这里
      // 只负责把每个原因当独立的位置参数传进去 —— 不做任何 && / || 的现场拼接。
      if (
        shouldDirectSwitch(reducedMotion, soloOf(spread), soloOf(to))
      ) {
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

  // Leaf faces depend on flip direction. Forward: the current right face is the
  // leaf front; it turns to reveal the next spread's left face (leaf back), and
  // the next right face is painted underneath. Backward is the mirror.
  // 面一律经 facesOfSpread 取 —— 双宽(#303)在这里已经是「左半/右半」两个面,
  // 叶片与底层拿到的 half 随面走,翻进翻出双宽页与普通跨页同一条路径。
  const [curFaceL, curFaceR] = facesOfSpread(spread);
  const target = anim ? facesOfSpread(anim.to) : null;
  let underLeft = curFaceL;
  let underRight = curFaceR;
  let leafFront: BookFace | null = null;
  let leafBack: BookFace | null = null;
  if (anim && target) {
    if (anim.dir === 'next') {
      underRight = target[1]; // new right face sits beneath the turning leaf
      leafFront = curFaceR; // outgoing right face, on the right half
      leafBack = target[0]; // incoming left face
    } else {
      underLeft = target[0]; // new left face sits beneath the turning leaf
      leafFront = curFaceL; // outgoing left face, on the left half
      leafBack = target[1]; // incoming right face
    }
  }

  // Solo cover/ending: render a single centered page (no blank facing half, no
  // spine). Animation is already suppressed for solo edges in goToSpread, so the
  // book is only ever solo while at rest (anim is null) — the single page is
  // whichever half the spread occupies.
  const soloHere = isSoloSpread(spreads[spread], pages);
  const soloPage = soloHere ? (curLeft ?? curRight) : null;
  const soloArrayIndex = soloHere ? (spreadPageIndices(spreads[spread])[0] ?? -1) : -1;

  if (pages.length === 0) {
    return (
      <div ref={stageRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
        <p className="text-[var(--text-sm)] text-[var(--muted)]">{t.noPages}</p>
      </div>
    );
  }

  // A clickable half-page: selects + opens edit on its own page, shows the edit
  // affordance on hover (preserving the UI-1a "click page to edit" behaviour).
  // 双宽(#303)的两个半面共用同一 pageArrayIndex:点任一半编辑的都是那一页。
  // 分享页是纯阅读面,选中态不画任何描边框(2026-08-03 用户拍板)。
  const Half = ({
    page,
    pageArrayIndex,
    side,
    half,
  }: {
    page: EditorPage | null;
    pageArrayIndex: number;
    side: 'left' | 'right';
    half?: 'left' | 'right';
  }) => (
    <div
      className="group/half relative"
      style={{ width: halfW, height: book.h, background: 'var(--surface)' }}
    >
      <PageFace page={page} totalPages={totalPages} resolveImage={resolveImage} width={halfW} height={book.h} folio={folioOf(page)} folioSide={folioSideOf(page)} half={half} />
      {page && (
        <>
          <button
            type="button"
            onClick={() => editPage(pageArrayIndex)}
            onDoubleClick={() => editPage(pageArrayIndex)}
            className="absolute inset-0 cursor-pointer"
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
        // 高仿真:合上的书 —— 书口纸叠只出现在开口侧(封面朝右、封尾朝左)。
        <div className="relative" style={{ width: halfW, height: book.h }}>
          <PaperEdges sides={[spread === 0 ? 'right' : 'left']} width={edgeW} />
          <div
            className="relative flex h-full w-full"
            style={{
              borderRadius: 3,
              background: 'var(--surface)',
              boxShadow: BOOK_SHADOW,
              overflow: 'hidden',
            }}
          >
            <Half page={soloPage} pageArrayIndex={soloArrayIndex} side="left" />
          </div>
        </div>
      )}

      {book.w > 0 && !soloHere && (
        // pair 与双宽(#303)同一条渲染路径:双宽页经 facesOfSpread 裁成装订在一起的
        // 左右两半 —— 有中缝、有弧面明暗、参与叶片翻页(拆渲染不拆数据)。
        <div className="relative" style={{ width: book.w, height: book.h }}>
          {/* 书口纸张堆叠:摊开的书两侧都露纸芯 */}
          <PaperEdges sides={['left', 'right']} width={edgeW} />
          <div
            className="relative flex h-full w-full"
            style={{
              borderRadius: 3,
              background: 'var(--surface)',
              boxShadow: BOOK_SHADOW,
              transformStyle: 'preserve-3d',
              overflow: 'hidden',
            }}
          >
            {/* under layer: the resting spread (target faces slot in beneath the leaf during a flip) */}
            <Half page={underLeft.page} pageArrayIndex={underLeft.index} side="left" half={underLeft.half} />
            <Half page={underRight.page} pageArrayIndex={underRight.index} side="right" half={underRight.half} />

            {/* 左右半页向书脊的弧面明暗(与 editor-port .page-left/.page-right::before 同配方) */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 z-[4]"
              style={{
                width: halfW,
                background: 'linear-gradient(90deg, transparent 72%, rgba(255,255,255,.06) 86%, rgba(0,0,0,.13) 100%)',
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-[4]"
              style={{
                left: halfW,
                width: halfW,
                background: 'linear-gradient(90deg, rgba(0,0,0,.12) 0%, rgba(255,255,255,.07) 14%, transparent 28%)',
              }}
            />

            {/* center spine shadow:书脊沟槽(宽渐变折光带)+ 1px 接缝(与 editor-port .book::before/::after 同配方) */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1/2 z-[5] -translate-x-1/2"
              style={{
                width: spineW,
                background:
                  'linear-gradient(90deg, rgba(255,255,255,.10) 0%, rgba(0,0,0,.04) 24%, rgba(0,0,0,.16) 46%, rgba(0,0,0,.24) 50%, rgba(255,255,255,.13) 54%, rgba(0,0,0,.05) 76%, rgba(255,255,255,.08) 100%)',
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1/2 z-[5] -translate-x-1/2"
              style={{
                width: 1,
                background: 'rgba(16,20,19,.28)',
                boxShadow: '-1px 0 rgba(255,255,255,.12), 1px 0 rgba(0,0,0,.08)',
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
                  // 翻动中的纸自己带一片移动投影(box-shadow 随叶片一起转;不能用
                  // filter —— 会把 preserve-3d 的两面拍扁,editor 侧同款教训)。
                  boxShadow: '0 14px 28px rgba(20,24,23,.18)',
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{ backfaceVisibility: 'hidden', background: 'var(--surface)' }}
                >
                  <PageFace page={leafFront?.page ?? null} totalPages={totalPages} resolveImage={resolveImage} width={halfW} height={book.h} folio={folioOf(leafFront?.page ?? null)} folioSide={folioSideOf(leafFront?.page ?? null)} half={leafFront?.half} />
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
                  <PageFace page={leafBack?.page ?? null} totalPages={totalPages} resolveImage={resolveImage} width={halfW} height={book.h} folio={folioOf(leafBack?.page ?? null)} folioSide={folioSideOf(leafBack?.page ?? null)} half={leafBack?.half} />
                  {/* page-turn shading on the leaf back(落地后它是靠书脊的那半;
                      面已 rotateY(180°) 镜像,所以 div 的左即视觉上的右) */}
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        anim.dir === 'next'
                          ? 'linear-gradient(90deg, rgba(0,0,0,.08), transparent 30%)'
                          : 'linear-gradient(90deg, transparent 70%, rgba(0,0,0,.08))',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 翻页小圆钮:桌面在书两侧垂直居中;移动端(≤767,同 md 断点)在底部居中一排。
             到头淡出不可点、翻页动画中禁点。 ─── */}
      {(() => {
        const navBtns = [
          { dir: -1 as const, label: t.prevPage, points: '15 18 9 12 15 6', hidden: spread === 0 },
          { dir: 1 as const, label: t.nextPage, points: '9 18 15 12 9 6', hidden: spread >= spreadCount - 1 },
        ];
        const navBtn = ({ dir, label, points, hidden }: (typeof navBtns)[number], className: string) => (
          <button
            key={dir}
            type="button"
            onClick={() => step(dir)}
            disabled={hidden || !!anim}
            title={label}
            aria-label={label}
            className={`h-9 w-9 items-center justify-center rounded-full text-[var(--fg-2)] transition-opacity hover:text-[var(--fg)] disabled:pointer-events-none ${hidden ? 'opacity-0' : 'disabled:opacity-40'} ${className}`}
            style={{
              background: 'rgba(255,255,255,0.8)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <polyline points={points} />
            </svg>
          </button>
        );
        return (
          <>
            {navBtns.map((b) =>
              navBtn(b, `absolute top-1/2 z-[7] hidden -translate-y-1/2 md:flex ${b.dir === -1 ? 'left-3' : 'right-3'}`),
            )}
            <div className="absolute bottom-5 left-1/2 z-[7] flex -translate-x-1/2 items-center gap-4 md:hidden">
              {navBtns.map((b) => navBtn(b, 'flex'))}
            </div>
          </>
        );
      })()}
    </div>
  );
}
