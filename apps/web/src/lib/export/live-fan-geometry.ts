/* ════════════════════════════════════════════════════════════════════════════
   live-fan-geometry —— Live 导出里「整本书摊在两侧的扇形页堆」的几何(纯函数,零 DOM)。

   效果源头是用户给的「新翻书效果录屏」。逐帧量下来,那些卡片**不是**绕书脊旋转的:
   绕书脊往后转会让外缘缩进书里去,而录屏里的卡是**朝外越铺越远**、同时**越来越矮**。
   真正的规律是整摞朝书脊外侧一个消失点等比缩小 ——

       消失点  V = 书脊 ± vp × 半页宽   (纵向与书同高)
       第 j 张 = 同一个页面矩形以 V 为中心缩放 k_j
       k_j    = 1 - (1 - kMin) · (j / count)^γ

   于是外缘落在  半页宽 × (vp + (1-vp)·k)  处。参考录屏实测 vp=4.25 / kMin=0.75,
   最外一张 1.81×半页宽 —— 测试锁的就是这条换算(它证明 vp/kMin 的含义没被改坏),
   **不是出片值**:录屏是横屏构图,那么满的扇形塞进 3:4 竖版书就只剩 560 宽、
   页面上的字全糊。出片实际取 LIVE_FAN_SHAPE(1.32×),见下。

   这条规律的两个好处不是顺带的:
     · 卡是**正矩形**,画的时候一次 drawImage 就贴完,不必像翻动那张纸那样逐列切片;
     · 深度 j 允许带小数 —— 翻页过渡的进度 t 直接当 pos = k + t 传进来,整摞就
       随翻页平滑推进一格,不需要为扇形另写一套动画。
   ════════════════════════════════════════════════════════════════════════════ */

export interface FanParams {
  /** 摊开跨页的宽/高(画布 px)。 */
  bookW: number;
  bookH: number;
  /** 书脊横坐标与书的纵向中线。 */
  spineX: number;
  centerY: number;
  /** 每侧最多铺几张。0 = 关掉扇形。 */
  count: number;
  /** 消失点离书脊多少个半页宽。越大铺得越开。 */
  vp: number;
  /** 最深一张缩到多少(0–1)。 */
  kMin: number;
  /** 疏密分布指数。<1 = 靠近书的这几张更密(与录屏一致)。 */
  gamma: number;
  /** 最深一张压暗多少(0–1)。 */
  dark: number;
  /** 最深一张的折叠角(度)。页面绕自己内侧的竖轴折,宽度按 cos 收。 */
  thetaMax: number;
  /** 折叠角的分布指数。越小 = 刚离开正中就折得越急。 */
  gammaA: number;
}

export interface FanCard {
  /** 这张卡露的是哪一屏(views 的下标)。 */
  view: number;
  /** +1 = 书脊右侧(还没翻的页);-1 = 左侧(翻过的页)。 */
  side: 1 | -1;
  /** 连续深度,(0, count]。整数 = 停在某一格,小数 = 翻页推进途中。 */
  depth: number;
  /** 纵深缩放系数。 */
  k: number;
  /** 折叠因子 cos(θ)。1 = 完全摊平,0 = 侧立成一条线。 */
  fold: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 叠在卡上的压暗强度(0–1)。 */
  dark: number;
}

/**
 * 出片用的这一组(不含书本身的尺寸)。**live-video 直接取这一份**,不在那边另抄一遍;
 * 谁想调扇形只改这里,出画守卫(live-video-fan-grid.test.ts)也盯着这一份。
 *
 * 与录屏原值(4.25 / 0.75,外扩 0.81×半页)的差别是刻意的:竖版画幅横向不够,
 * 照搬会把书压到 560 宽。这组外扩 0.32×半页,书还能保住 760。
 */
export const LIVE_FAN_SHAPE = {
  count: 7,
  vp: 5.2,
  kMin: 0.8,
  gamma: 0.62,
  dark: 0.3,
  thetaMax: 72,
  gammaA: 0.22,
} as const satisfies Omit<FanParams, 'bookW' | 'bookH' | 'spineX' | 'centerY'>;

/** 深度 → 缩放。 */
function scaleAt(depth: number, p: FanParams): number {
  const f = Math.pow(depth / p.count, p.gamma);
  return 1 - (1 - p.kMin) * f;
}

/** 深度 → 折叠角(度)。深度 0 = 摊平。 */
function angleAt(depth: number, p: FanParams): number {
  return p.thetaMax * Math.pow(depth / p.count, p.gammaA);
}

/** 深度 → 压暗。指数比缩放平缓一点,免得靠外那几张糊成一团黑。 */
function darkAt(depth: number, p: FanParams): number {
  return p.dark * Math.pow(depth / p.count, 0.8);
}

function cardAt(view: number, side: 1 | -1, depth: number, p: FanParams): FanCard {
  const hw = p.bookW / 2;
  const k = scaleAt(depth, p);
  const fold = Math.cos((angleAt(depth, p) * Math.PI) / 180);
  const V = p.spineX + side * p.vp * hw;
  const inner = V + (p.spineX - V) * k;
  const outer = V + (p.spineX + side * hw * fold - V) * k;
  const h = p.bookH * k;
  return {
    view,
    side,
    depth,
    k,
    fold,
    x: Math.min(inner, outer),
    y: p.centerY - h / 2,
    w: Math.abs(outer - inner), // = hw · fold · k
    h,
    dark: darkAt(depth, p),
  };
}

/**
 * 站在连续位置 pos(= 视图下标 + 翻页进度 t)时,两侧各该铺哪些卡。
 *
 * 右侧是**还没翻**的页:视图 ⌊pos⌋+1 起往后数,深度 = view - pos;
 * 左侧是**翻过**的页:视图 ⌈pos⌉-1 起往前数,深度 = pos - view。
 * 两边的深度都落在 (0, count] —— 深度趋近 0 的那张正好与中心半页重合,
 * 所以翻页落定时它被中心书盖住、无缝交班,不会闪。
 *
 * 返回顺序是**由深到浅**(先右后左),调用方照序画即可得到正确的前后遮挡。
 */
export function fanCards(pos: number, viewCount: number, p: FanParams): FanCard[] {
  const out: FanCard[] = [];
  if (p.count < 1 || viewCount < 1) return out;
  const hi = Math.ceil(pos);
  const lo = Math.floor(pos);
  // 右侧:视图 ⌈pos⌉ 起往后。**含深度 0** —— pos 为整数时那张就是摊平的右页。
  for (let v = hi + p.count; v >= hi; v--) {
    if (v < 0 || v >= viewCount) continue;
    const depth = v - pos;
    if (depth < 0 || depth > p.count) continue;
    out.push(cardAt(v, 1, depth, p));
  }
  // 左侧:视图 ⌊pos⌋ 起往前。pos 为整数时 ⌊pos⌋ 与 ⌈pos⌉ 是同一屏,
  // 于是它同时出两张深度 0 的卡 —— 正好是摊平跨页的左右两页。
  for (let v = lo - p.count; v <= lo; v++) {
    if (v < 0 || v >= viewCount) continue;
    const depth = pos - v;
    if (depth < 0 || depth > p.count) continue;
    out.push(cardAt(v, -1, depth, p));
  }
  return out;
}

/**
 * 最外一张卡的外缘落在哪(画布 x)。用来守住「扇形别铺出画幅」——
 * 把 vp 从 2.6 调到 3.5 这种很自然的「再铺开一点」会直接出画,
 * 光看几何测试是发现不了的,必须拿出片参数对着画幅宽量。
 */
export function fanOuterEdge(p: FanParams): number {
  const hw = p.bookW / 2;
  if (p.count < 1) return p.spineX + hw;
  const deepest = cardAt(p.count, 1, p.count, p);
  return deepest.x + deepest.w;
}

/**
 * 一张扇形卡该露那一屏的哪一面。
 *
 * 右侧看到的是纸的正面(recto)= 那一屏最右那面;左侧看到的是背面(verso)=
 * 最左那面。封面/封尾是 solo 只有一面,两侧都只能取它。
 */
export function fanFaceIndex(faceCount: number, side: 1 | -1): number {
  if (faceCount <= 1) return 0;
  return side === 1 ? faceCount - 1 : 0;
}
