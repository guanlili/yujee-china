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
   长按拖拽交换图片走的是同一条路子:跟手的幽灵和落点高亮都是本组件渲染的兄弟节点,
   落点判定同样只靠「这一点上有谁」(见 imageSlotAtPoint)。

   面板升起时会盖住屏幕下 2/3(.mes-card 是 66vh)。若选中的元素正落在被盖住的
   区域,把书整体上移到面板之上 —— 这是「让被编辑的东西看得见」,不是自由缩放。
   ════════════════════════════════════════════════════════════════════════════ */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AT } from '@/lib/i18n/pick';

import type { EditorPage } from '../../types';
import { editableTextOf } from '../editable-text';
import { pageFaceHTML, type PageFaceCtx } from '../page-face';
import { pageFolioInfos } from '../../page-html-dom';
import { useFitTextBoxes } from '../../use-fit-text-boxes';
import { isSpreadTemplate } from '../../templates/constants';
import { getTemplate } from '@yujee/contracts/templates';
import type { ResolveImage } from '../../adapt-layout';
import { fitBox, spreadAspect } from './fit-box';
import { MobileTopbar } from './MobileTopbar';
import { IconPageBg, IconFilter, IconImage, IconText, IconTrash, IconReset } from './icons';
import {
  resolveEffectiveFilter,
  type PhotoFilterState,
} from '@/lib/photo/filter-state';

/** 图片工具栏的高度与离图的间距 —— 用来判断挂图下方还是翻到上方(与 CSS 保持一致)。 */
const IMG_BAR_H = 40;
const IMG_BAR_GAP = 8;
import type { ComputedProbe, SelRect } from './page-edit';
import { clampImagePos, dragToImagePos, type ImagePosValue } from '../image-edit-util';
import {
  SWAP_EDGE_FLIP_MS,
  SWAP_LONG_PRESS_MS,
  edgeFlipDirection,
  exceedsLongPressSlop,
  sameSwapSlot,
  type SwapSlotRef,
} from '../image-swap';

/** 点中一个文字槽后交给父层的全部信息(父层据此开面板、落库)。 */
export type TextHit = { slotId: string; rect: SelRect; probe: ComputedProbe };

/** 点中一个图片槽。rect 用的是**图框**(overflow:hidden 的外框)而不是 img 本身 ——
 *  scale>1 时 img 的 rect 是放大后被裁掉的那个尺寸,拿它画高亮会跑到框外。 */
export type ImageHit = { slotId: string; rect: SelRect };

export type EditViewProps = {
  pages: EditorPage[];
  /** 相册子集字体是否已注册(见 MobileEditorRoot 的 useAlbumFonts)。字体到货换行会变,
   *  文字槽的字号自适应必须据此重跑。 */
  fontsReady: boolean;
  resolve: ResolveImage;
  boardBackground?: string | null;
  aT: AT;
  /** 正在编辑的页 index。 */
  editPage: number;
  /** 当前选中的槽(父层持有;null = 没选中)。文字与图片共用这一个高亮。 */
  selection: { slotId: string; rect: SelRect } | null;
  /** 选中的是图片时:当前的位置/缩放(拖动/捏合以它为起点)。 */
  imagePos: ImagePosValue | null;
  photoFilter: PhotoFilterState | null;
  selectedPhotoId: string | null;
  lutSupported: boolean;
  /** 面板是否升起 —— 决定要不要把书上移让出位置。 */
  sheetOpen: boolean;
  /** 顶栏返回:退回浏览态。 */
  onExit: () => void;
  /** 左右滑翻页:+1 下一页 / -1 上一页(夹边由父层的 stepScreen 处理)。 */
  onStep: (dir: 1 | -1) => void;
  /** 点中文字槽。 */
  onSelectText: (hit: TextHit) => void;
  /** 点中图片槽 → 选中它(缩放/平移直接用手势,不开面板)。 */
  onSelectImage: (hit: ImageHit) => void;
  /** 拖动/捏合过程中的实时位置(父层即时打进书,不落库)。 */
  onImagePos: (pos: ImagePosValue) => void;
  /** 手指离开 = 一次调整结束(父层落库,与桌面「松手即存」同口径)。 */
  onImagePosCommit: () => void;
  /** 图片工具栏:换一张(开本册照片选择器)。 */
  onReplaceImage: () => void;
  /** 图片工具栏:清空这个图槽(版式不变,框还在)。 */
  onClearImage: () => void;
  /** 图片工具栏:位置/缩放复位。 */
  onResetImagePos: () => void;
  onPhotoFilter: () => void;
  /** 长按拾起一张图、拖到另一个图槽松手 → 两个槽对调(可跨页,见 image-swap.ts)。 */
  onSwapImage: (from: SwapSlotRef, to: SwapSlotRef) => void;
  /** 点页面空白处:取消选中。 */
  onClearSelection: () => void;
  /** 交互 handler 一律必填(理由同 MobileEditor):漏接 = 死按钮 = 编译不过。 */
  /** 顶栏「保存」= 备份照片到云端(同桌面那枚),透传给 MobileTopbar。 */
  onSave: () => void;
  backupState: 'idle' | 'backing-up' | 'backed-up' | 'failed';
  backupProgress: { done: number; total: number } | null;
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

/** 工具栏住在画板里面,但它自己的横向滚动和按钮不能冒泡成图片拖动。 */
export function shouldStartBoardGesture(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return typeof element?.closest !== 'function' || element.closest('.mimg-bar') === null;
}

export function EditView({
  pages,
  fontsReady,
  resolve,
  boardBackground,
  aT,
  editPage,
  selection,
  imagePos,
  photoFilter,
  selectedPhotoId,
  lutSupported,
  sheetOpen,
  onExit,
  onStep,
  onSelectText,
  onSelectImage,
  onImagePos,
  onImagePosCommit,
  onSwapImage,
  onReplaceImage,
  onClearImage,
  onResetImagePos,
  onPhotoFilter,
  onClearSelection,
  onSave,
  backupState,
  backupProgress,
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

  const folioInfos = useMemo(() => pageFolioInfos(pages.map((p) => p.templateId)), [pages]);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0×0 一律不收(理由同 MobileEditor:节点卸载时 RO 会报 0,收了就把页面渲染成空)。
      if (r.width < 1 || r.height < 1) return;
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
  const selectedFilter = selectedPhotoId
    ? resolveEffectiveFilter(photoFilter, selectedPhotoId)
    : null;
  const ctx: PageFaceCtx = {
    folio: folioInfos[editPage]?.folio ?? null,
    folioSide: folioInfos[editPage]?.side ?? 'right',
    total: pages.length,
    resolve,
  };
  // 双宽跨页(#303)在编辑态也得按两页宽摆,否则整张跨页被压成半宽。
  const wide = page && isSpreadTemplate(page.templateId) ? 2 : 1;
  const box = fitBox(
    Math.max(0, area.w - INSET * 2),
    Math.max(0, area.h - INSET * 2),
    spreadAspect(wide),
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

  // 文字槽的字号自适应(理由同 MobileEditor:模板文字槽是写死的固定高度,页根
  // overflow:hidden —— 不收字号,溢出的部分直接被裁掉)。编辑态每次重绘页面之后都要跑:
  // 换页、改文案、改字体、改画板尺寸都会改变换行。
  useFitTextBoxes(spreadRef);

  const swipe = useRef<{ x: number; y: number } | null>(null);
  // 滑动收尾浏览器还会补一记 click —— 不吞掉的话一次翻页会顺手改掉选中。
  const moved = useRef(false);
  /**
   * 只认「本视图自己按下去的那一记」click。
   *
   * 浏览态是 pointerup 里 onEnterEdit 切进编辑态的,而那一次触摸的 **click 事件随后才派发**
   * —— 那时页面已经换成编辑态了,click 就落在刚挂上的书页上,于是「点一页进编辑」会顺手
   * 选中落点下的元素、直接弹出面板(真机表现:一进编辑态就自己开了图片面板,而且怎么点
   * 文字都还是图片面板)。这一记 click 前面没有属于本视图的 pointerdown,据此丢掉它。
   * 用「有没有自己的 pointerdown」判,而不是拿时间窗去猜。
   */
  const armed = useRef(false);

  /* ── 选中图片后的手势:单指拖 = 平移画面,双指捏 = 缩放 ──────────────────────
     只在**已选中那张图**上生效;没选中时手指落在图上仍然是翻页,不然一进编辑态
     就再也翻不了页了。几何全部走 image-edit-util(与桌面同一份、已单测)。 */
  const imgDrag = useRef<{
    start: ImagePosValue;
    x: number;
    y: number;
    boxW: number;
    boxH: number;
  } | null>(null);
  const pinch = useRef<{ start: ImagePosValue; dist: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  /** 图片槽的命中。用 `[data-image-slot]` 而不是 `img[data-image-slot]`:
   *  模板把图片包在同样带该属性的 overflow:hidden 外框里。 */
  const imageSlotAt = (target: EventTarget | null): HTMLElement | null =>
    (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-image-slot]') ?? null;

  /**
   * 点中了哪个槽 —— 按**这一点上的 z 序**判定,谁在最上层就是谁。
   *
   * 为什么不只看 e.target:真机抓到,模板里文字与图片互相叠压时,click 的 target 常常是
   * 底下那个 <img>(而同一坐标 elementFromPoint 给的是文字)。只认 target 的话,
   * 这类页面上的文字**一个都选不中**,点哪儿都开图片面板。
   *
   * elementsFromPoint 返回的就是「从上到下都有谁」,取第一个能归到槽的即可 ——
   * 用户看到谁在上面,点中的就是谁,不用猜。
   */
  const slotAtPoint = (
    x: number,
    y: number,
    doc: Document,
  ): { kind: 'text'; el: HTMLElement } | { kind: 'image'; el: HTMLElement } | null => {
    for (const node of doc.elementsFromPoint(x, y)) {
      const text = (node as HTMLElement).closest?.<HTMLElement>('[data-text-key]');
      if (text?.dataset.textKey) return { kind: 'text', el: text };
      const img = (node as HTMLElement).closest?.<HTMLElement>('[data-image-slot]');
      if (img?.getAttribute('data-image-slot')) return { kind: 'image', el: img };
      // 走到 .mpage-face 还没归到任何槽 → 这一点就是空白,别再往外找
      if ((node as HTMLElement).classList?.contains('mpage-face')) return null;
    }
    return null;
  };

  /**
   * 图片面板开着 = 现在整块画板都在为「挪这张图」服务:随便从哪儿拖都是平移,双指就是缩放。
   *
   * 为什么不做成「必须精确拖在那张图上」:模板经常在图上叠装饰层(边框/色块/文字),
   * 真机上手指落点十有八九命中的是装饰而不是图槽,表现为「选得中、拖不动」。
   * 选中框已经画着,意图没有歧义,不必再赌落点。
   * 代价是这期间横滑不翻页 —— 正在编这张图,本来也不该翻页。
   *
   * 判据只看 imagePos:Root 传下来的就是 `selection.kind === 'image' ? imagePos : null`,
   * 非空即「当前选中的是图槽」。**不要再 && sheetOpen** —— 缩放/平移已经改成直接在画布上
   * 捏合拖动、不开弹窗了(换图/删除走选中框旁的小工具栏),再挂着弹窗条件就等于手势永远不生效。
   */
  const imageEditing = imagePos != null;

  const twoFingerDist = (): number => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /* ── 长按拾起 → 拖到另一个图槽松手 = 两张图对调 ─────────────────────────────
     直接拖已经有主人了(没选中是翻页、选中是平移画面),所以交换要一个明确的进入动作:
     按住 SWAP_LONG_PRESS_MS 把图拾起来。理由与阈值都在 image-swap.ts。

     跟手的幽灵和落点高亮都是**本组件渲染的兄弟节点**,不往页面 DOM 里加类/改样式 ——
     与选中高亮同一条路子(见抬头「选中链路」)。 */
  const swapPress = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null);
  const [swap, setSwap] = useState<{
    from: SwapSlotRef;
    src: string | null;
    /** 幽灵跟的是**视口**坐标(它是 fixed);落点高亮用相对 .mspread 的坐标。 */
    x: number;
    y: number;
    target: { ref: SwapSlotRef; rect: SelRect } | null;
  } | null>(null);
  const swapRef = useRef<typeof swap>(null);
  swapRef.current = swap;
  /** 边缘自动翻页的计时器与当前方向(拖到画板左右缘停住就一页页往前/往后翻)。 */
  const edgeFlip = useRef<{ dir: 1 | -1; timer: number } | null>(null);
  /** onStep 每次渲染都是新函数,而自动翻页跑在定时器里 —— 走 ref 才不会翻第二页时用到旧的。 */
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  /** 这一点最上层的图槽(文字盖在图上时也要能放下 —— 落点看的是图,不是装饰)。 */
  const imageSlotAtPoint = (x: number, y: number, doc: Document): HTMLElement | null => {
    for (const node of doc.elementsFromPoint(x, y)) {
      const img = (node as HTMLElement).closest?.<HTMLElement>('[data-image-slot]');
      if (img?.getAttribute('data-image-slot')) return img;
      if ((node as HTMLElement).classList?.contains('mpage-face')) return null;
    }
    return null;
  };

  const cancelSwapPress = () => {
    if (!swapPress.current) return;
    window.clearTimeout(swapPress.current.timer);
    swapPress.current = null;
  };
  const stopEdgeFlip = () => {
    if (!edgeFlip.current) return;
    window.clearInterval(edgeFlip.current.timer);
    edgeFlip.current = null;
  };
  const endSwap = (pointerId?: number) => {
    cancelSwapPress();
    stopEdgeFlip();
    if (pointerId != null && boardRef.current?.hasPointerCapture?.(pointerId)) {
      boardRef.current.releasePointerCapture(pointerId);
    }
    swapRef.current = null;
    setSwap(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!shouldStartBoardGesture(e.target)) return;
    armed.current = true; // 这一记是本视图自己按下的,随后的 click 才作数
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 第二根手指落下 → 进入捏合,取消单指平移与翻页(顺带放弃长按拾起:两指不是长按)
    if (pointers.current.size === 2 && imageEditing && imagePos) {
      swipe.current = null;
      imgDrag.current = null;
      cancelSwapPress();
      pinch.current = { start: imagePos, dist: twoFingerDist() };
      return;
    }
    if (!e.isPrimary) return;
    moved.current = false;
    // 长按候选:手指按在一个**有照片**的图槽上就起表。空框拾不起来(拖个空框出去没意义);
    // 空框作为落点是允许的,那是「把这张挪过去」。
    // 编辑态(选中了照片)一律不起表(2026-08-02 复测拍板):选中期间**整板**都是
    // pan 的地盘(平移不要求按在图上,理由见 L310 附近),而 pan 是慢速小幅微调,
    // 350ms 内常常不足 8px slop,停顿更是天然动作 —— 计时器一到手势就被抢走。
    // 要交换,先点空白取消选中再长按(与桌面同一心智:选中 = 调这张,未选中 = 可交换)。
    cancelSwapPress();
    const pressed = imageSlotAtPoint(
      e.clientX,
      e.clientY,
      (e.target as HTMLElement).ownerDocument,
    );
    const pressedSlot = pressed?.getAttribute('data-image-slot') ?? null;
    const pressedPhoto = pressedSlot && page ? page.imagesJson[pressedSlot] : undefined;
    if (!imageEditing && pressedSlot && pressedPhoto && page) {
      const from: SwapSlotRef = { pageIndex: page.pageIndex, slotId: pressedSlot };
      const { clientX: px, clientY: py, pointerId } = e;
      swapPress.current = {
        pointerId,
        x: px,
        y: py,
        timer: window.setTimeout(() => {
          swapPress.current = null;
          // 拾起的这一刻,其它手势全部让位:这一拖不再是平移画面,也不再是翻页。
          imgDrag.current = null;
          swipe.current = null;
          moved.current = true; // 松手那记 click 不该改选中
          // 抓住指针:松手可能落在画板外(一级栏、顶栏),不抓的话 pointerup 收不到,
          // 幽灵就会一直挂着。抓在画板自己身上,坐标判定(elementsFromPoint)不受影响。
          boardRef.current?.setPointerCapture?.(pointerId);
          const next = { from, src: resolve(pressedPhoto) ?? null, x: px, y: py, target: null };
          swapRef.current = next;
          setSwap(next);
        }, SWAP_LONG_PRESS_MS),
      };
    }
    if (imageEditing && imagePos && selection) {
      // dragToImagePos 要的是 img 的**渲染后**尺寸(含缩放)。图铺满外框、再整体 scale,
      // 所以 渲染后尺寸 = 外框尺寸 × scale。外框尺寸用选中那一刻记下的 rect ——
      // 它一定存在,也不用去 DOM 里找那个 <img>(移动端不许 querySelector)。
      imgDrag.current = {
        start: imagePos,
        x: e.clientX,
        y: e.clientY,
        boxW: selection.rect.width * imagePos.scale,
        boxH: selection.rect.height * imagePos.scale,
      };
      swipe.current = null; // 这一下不是翻页
      return;
    }
    swipe.current = e.clientX <= EDGE_GUARD ? null : { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const press = swapPress.current;
    if (press && press.pointerId === e.pointerId) {
      // 拾起前抖超阈值 = 用户本来就想平移/翻页,取消候选。
      if (exceedsLongPressSlop(e.clientX - press.x, e.clientY - press.y)) cancelSwapPress();
    }
    const dragging = swapRef.current;
    if (dragging) {
      moved.current = true;
      const doc = (e.target as HTMLElement).ownerDocument;
      const hostRect = spreadRef.current?.getBoundingClientRect();
      const hit = imageSlotAtPoint(e.clientX, e.clientY, doc);
      const slotId = hit?.getAttribute('data-image-slot') ?? null;
      let target: { ref: SwapSlotRef; rect: SelRect } | null = null;
      if (hit && slotId && page && hostRect) {
        const ref: SwapSlotRef = { pageIndex: page.pageIndex, slotId };
        if (!sameSwapSlot(ref, dragging.from)) {
          // 高亮贴**图框**而不是 img(scale>1 时 img 的 rect 是放大后被裁掉的尺寸)。
          const frame = hit.tagName === 'IMG' ? (hit.parentElement ?? hit) : hit;
          const r = frame.getBoundingClientRect();
          target = {
            ref,
            rect: {
              left: r.left - hostRect.left,
              top: r.top - hostRect.top,
              width: r.width,
              height: r.height,
            },
          };
        }
      }
      const next = { ...dragging, x: e.clientX, y: e.clientY, target };
      swapRef.current = next;
      setSwap(next);
      // 编辑态一屏只有一页,跨页交换靠「拖到边缘停住 → 自动翻页 → 继续拖」。
      const board = boardRef.current?.getBoundingClientRect();
      const dir = board ? edgeFlipDirection(e.clientX, board) : null;
      if (dir !== (edgeFlip.current?.dir ?? null)) {
        stopEdgeFlip();
        if (dir) {
          edgeFlip.current = {
            dir,
            timer: window.setInterval(() => stepRef.current(dir), SWAP_EDGE_FLIP_MS),
          };
        }
      }
      return;
    }
    const pz = pinch.current;
    if (pz && pointers.current.size >= 2) {
      const d = twoFingerDist();
      if (pz.dist > 0 && d > 0) {
        onImagePos(clampImagePos({ ...pz.start, scale: pz.start.scale * (d / pz.dist) }));
      }
      return;
    }
    const dr = imgDrag.current;
    if (dr) {
      moved.current = true;
      onImagePos(dragToImagePos(dr.start, e.clientX - dr.x, e.clientY - dr.y, dr.boxW, dr.boxH));
    }
  };

  const endImageGesture = () => {
    const had = imgDrag.current != null || pinch.current != null;
    imgDrag.current = null;
    pinch.current = null;
    if (had) onImagePosCommit(); // 松手即存(同桌面)
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    cancelSwapPress();
    const dragging = swapRef.current;
    if (dragging) {
      endSwap(e.pointerId);
      if (dragging.target) onSwapImage(dragging.from, dragging.target.ref);
      return;
    }
    if (imgDrag.current || pinch.current) {
      if (pointers.current.size === 0) endImageGesture();
      return;
    }
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
    // 不是本视图按下去的那一记(见 armed 的说明:从浏览态切进来时会补一记 click)
    if (!armed.current) return;
    armed.current = false;
    if (moved.current) {
      moved.current = false;
      return;
    }
    const host = spreadRef.current;
    if (!host) return;
    const target = e.target as HTMLElement;
    const hit = slotAtPoint(e.clientX, e.clientY, target.ownerDocument);
    if (!hit) {
      onClearSelection();
      return;
    }
    const s0 = host.getBoundingClientRect();
    if (hit.kind === 'image') {
      // 高亮贴**图框**(overflow:hidden 的外框)而不是 img:scale>1 时 img 的 rect
      // 是放大后被裁掉的尺寸,拿它画框会跑到槽外面去。
      // 命中的可能是 img 本身,也可能就是外框 —— 是 img 就取它父级。
      const frame = hit.el.tagName === 'IMG' ? (hit.el.parentElement ?? hit.el) : hit.el;
      const fr = frame.getBoundingClientRect();
      onSelectImage({
        slotId: hit.el.getAttribute('data-image-slot')!,
        rect: { left: fr.left - s0.left, top: fr.top - s0.top, width: fr.width, height: fr.height },
      });
      return;
    }
    // [data-text-key] 是文字槽的权威标记(与桌面同口径)。隐藏的 folio 槽是
    // display:none、folio 覆盖层是 pointer-events:none,都命不中。
    const el = hit.el;
    const slotId = el.dataset.textKey!;
    const t = el.getBoundingClientRect();
    const s = host.getBoundingClientRect();
    // rect 取的是**缩放后**的视觉尺寸(页面整体 transform:scale)→ 高亮框天然贴合;
    // computed 的字号是缩放前的 CSS px → 正是要写进 794×1123 版面的值。
    const cs = window.getComputedStyle(el);
    onSelectText({
      slotId,
      rect: { left: t.left - s.left, top: t.top - s.top, width: t.width, height: t.height },
      probe: {
        // editableTextOf 不是 textContent:槽里可能有 <br>(AI 写的),textarea 要看到真换行。
        text: editableTextOf(el),
        fontSize: cs.fontSize,
        color: cs.color,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textAlign: cs.textAlign,
        fontFamily: cs.fontFamily,
      },
    });
  };

  // data-album-fonts-ready:同 MobileEditor —— 标记 + 让字体到货真的触发一次 commit。
  return (
    <div
      className="mobile-editor"
      data-mode="edit"
      data-album-fonts-ready={fontsReady}
      style={boardBackground ? { background: boardBackground } : undefined}
    >
      <MobileTopbar
        title={aT(`第 ${editPage + 1} 页`, `Page ${editPage + 1}`)}
        aT={aT}
        onBack={onExit}
        backLabel={aT('返回浏览', 'Back to browsing')}
        onSave={onSave}
        backupState={backupState}
        backupProgress={backupProgress}
        onShare={onShare}
        onExport={onExport}
        onMore={onMore}
      />

      <div
        ref={boardRef}
        className="mboard"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          swipe.current = null;
          endSwap(e.pointerId);
          endImageGesture();
        }}
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

          {/* 交换的落点提示。与 .msel 同一条路子:自己渲染的兄弟节点,不去给页面节点加类。 */}
          {swap?.target && (
            <div
              className="mswap-target"
              aria-hidden="true"
              style={{
                left: swap.target.rect.left,
                top: swap.target.rect.top,
                width: swap.target.rect.width,
                height: swap.target.rect.height,
              }}
            />
          )}

          {/* 图片工具栏:风格能力可用时加「风格」;缩放和平移不放这儿 ——
              那两件直接在图上捏合、拖动(见 imageEditing),弹窗里放滑杆是多此一举。
              贴着选中框走:优先挂在图下方,下面装不下就翻到上方(长图/贴底的图)。 */}
          {selection && imagePos && (
            <div
              className="mimg-bar"
              style={{
                // 水平**居中于画布**而不是跟着图槽走:跟随的话,贴右缘的图槽会把工具栏
                // 顶出画布外(真机上「删除」直接被裁掉一半)。要跟随就得测出自身宽度再夹取,
                // 而宽度随语言变(中/英按钮文案不等长)。选中框已经说明在编哪个了,
                // 工具栏只要够得着就行,不必再指一次。
                left: box.w / 2,
                // 垂直仍跟着图走:优先挂图下方,下面装不下就翻到上方。
                top:
                  selection.rect.top + selection.rect.height + IMG_BAR_GAP + IMG_BAR_H <= box.h
                    ? selection.rect.top + selection.rect.height + IMG_BAR_GAP
                    : Math.max(IMG_BAR_GAP, selection.rect.top - IMG_BAR_GAP - IMG_BAR_H),
              }}
            >
              <button type="button" className="mimg-btn" onClick={onReplaceImage}>
                <IconImage className="mimg-ic" />
                <span>{aT('换图', 'Replace')}</span>
              </button>
              <button type="button" className="mimg-btn" onClick={onResetImagePos}>
                <IconReset className="mimg-ic" />
                <span>{aT('复位', 'Reset')}</span>
              </button>
              {lutSupported && selectedPhotoId && (
                <button
                  type="button"
                  className="mimg-btn"
                  aria-pressed={selectedFilter != null}
                  onClick={onPhotoFilter}
                >
                  <IconFilter className="mimg-ic" />
                  <span>{aT('风格', 'Style')}</span>
                </button>
              )}
              <button type="button" className="mimg-btn" data-danger="1" onClick={onClearImage}>
                <IconTrash className="mimg-ic" />
                <span>{aT('删除', 'Delete')}</span>
              </button>
            </div>
          )}
        </div>

        {/* AI 浮标:紧凑的圆形图标按钮,小水母稳定浮在左上层。 */}
        <button
          type="button"
          className="mai"
          aria-label={aT('展开对话', 'Expand chat')}
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
        </button>

        {/* 跟手的幽灵。fixed + 视口坐标,所以挂在哪一层都不影响;pointer-events:none
            是硬要求 —— 它盖在手指底下,不放行的话 elementsFromPoint 只会命中它自己,
            落点判定当场失灵。 */}
        {swap && (
          <div
            className="mswap-ghost"
            aria-hidden="true"
            style={{
              left: swap.x,
              top: swap.y,
              ...(swap.src ? { backgroundImage: `url("${swap.src}")` } : {}),
            }}
          />
        )}
      </div>

      {/* 一级栏:背景是页面级入口;图片/文字是「点页面上的元素来选中」的提示入口。 */}
      <nav className="ml1" aria-label={aT('编辑工具', 'Editing tools')}>
        <button type="button" className="ml1-cell" onClick={onPageBg}>
          <IconPageBg className="ml1-ic" />
          <span>{aT('背景', 'Background')}</span>
        </button>
        <button type="button" className="ml1-cell" onClick={onPickImage}>
          <IconImage className="ml1-ic" />
          <span>{aT('图片', 'Photo')}</span>
        </button>
        <button type="button" className="ml1-cell" onClick={onPickText}>
          <IconText className="ml1-ic" />
          <span>{aT('文字', 'Text')}</span>
        </button>
        {(() => {
          // 非内页(封面/目录/封尾)置灰:仍可点,点了由容器层 toast 说明原因 ——
          // 沿用「不做死按钮」口径,置灰只是视觉预告,服务端另有二次把关。
          const current = editPage != null ? pages[editPage] : undefined;
          const deletable = current
            ? getTemplate(current.templateId)?.category === 'interior'
            : false;
          return (
            <button
              type="button"
              className="ml1-cell"
              data-danger="1"
              aria-disabled={deletable ? undefined : true}
              onClick={onDeletePage}
            >
              <IconTrash className="ml1-ic" />
              <span>{aT('删除', 'Delete')}</span>
            </button>
          );
        })()}
      </nav>
    </div>
  );
}
