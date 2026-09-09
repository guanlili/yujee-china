// 抠图的纯算法层:只吃 RGBA 数组、吐 alpha 掩膜,不碰 canvas/DOM,可在 node:test 下直接跑。
// 与 lut-math.ts 同一分层套路(engine.ts 负责 Blob <-> ImageData)。
//
// 做法是「从四边漫水填充」:把画面边缘当背景种子,颜色接近的邻居一路吞进去,
// 吞不动的地方就是主体。**它成立的前提是背景相对干净、且与主体有色差。**
// 老照片翻拍、背景杂乱、主体与背景同色这几种情况它会失手 —— 那是像素法的
// 固有局限,不是实现缺陷,同目录测试把这个行为钉住了。将来换成浏览器端分割
// 模型时,替换的是这个文件,engine.ts 与调用方都不用动。

export type CutoutOptions = {
  /** 颜色容差(0-255 的欧氏距离)。越大吞得越狠,越容易连主体一起吃掉。 */
  tolerance: number;
  /**
   * 一种颜色要占到边缘的多大比例,才算「背景色」。默认 0.15。
   *
   * 为什么需要这道闸:主体贴边太常见了(肩膀顶到两侧、人被下边裁掉)。若不加限制,
   * 那几个贴边的主体像素自己就成了背景种子,顺着主体一路吞进去,整个人就没了。
   * 按边缘占比过滤之后,少数贴边的主体像素达不到门槛,不会起种。
   */
  minBorderShare?: number;
};

const DEFAULT_MIN_BORDER_SHARE = 0.15;
/** 估算边缘主色时的采样上限:全量两两比较在大图上是 O(n²),没必要。 */
const BORDER_SAMPLE_LIMIT = 512;

const FOREGROUND = 255;
const BACKGROUND = 0;

function borderIndices(width: number, height: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < width; x += 1) {
    out.push(x);
    if (height > 1) out.push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    out.push(y * width);
    if (width > 1) out.push(y * width + width - 1);
  }
  return out;
}

/**
 * 边缘上占比够大的那几种颜色。采样比较,返回每簇的代表色。
 * 返回空数组 = 边缘没有可信的背景色,调用方应当放弃抠图。
 */
function dominantBorderColours(
  rgba: Uint8ClampedArray,
  borderIdx: number[],
  opts: CutoutOptions,
): [number, number, number][] {
  if (borderIdx.length === 0) return [];
  const step = Math.max(1, Math.floor(borderIdx.length / BORDER_SAMPLE_LIMIT));
  const samples: number[] = [];
  for (let i = 0; i < borderIdx.length; i += step) samples.push(borderIdx[i]!);

  const minShare = opts.minBorderShare ?? DEFAULT_MIN_BORDER_SHARE;
  const kept: [number, number, number][] = [];
  for (const idx of samples) {
    const a = idx * 4;
    const r = rgba[a]!;
    const g = rgba[a + 1]!;
    const b = rgba[a + 2]!;
    // 已经被现有簇覆盖的就不重复登记
    if (kept.some((c) => Math.hypot(c[0] - r, c[1] - g, c[2] - b) <= opts.tolerance)) continue;
    let near = 0;
    for (const other of samples) {
      if (colorDistance(rgba, other * 4, r, g, b) <= opts.tolerance) near += 1;
    }
    if (near / samples.length >= minShare) kept.push([r, g, b]);
  }
  return kept;
}

function colorDistance(
  px: Uint8ClampedArray,
  a: number,
  r: number,
  g: number,
  b: number,
): number {
  const dr = px[a]! - r;
  const dg = px[a + 1]! - g;
  const db = px[a + 2]! - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 从四条边向内漫水,返回每像素的 alpha(255=主体,0=背景)。
 * 每个种子按**它自己的颜色**作参照扩散,所以四角底色不同(渐变背景、暗角)也各扩各的。
 */
export function buildAlphaMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: CutoutOptions,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height).fill(FOREGROUND);
  if (width <= 0 || height <= 0) return mask;

  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const seedR: number[] = [];
  const seedG: number[] = [];
  const seedB: number[] = [];

  const borderIdx = borderIndices(width, height);
  const backgroundColours = dominantBorderColours(rgba, borderIdx, opts);
  // 边缘上没有任何一种颜色占到门槛(比如整条边都是杂乱内容)—— 宁可什么都不抠,
  // 也不要瞎抠一气把人脸吃掉。
  if (backgroundColours.length === 0) return mask;

  const pushSeed = (idx: number) => {
    if (visited[idx]) return;
    const a = idx * 4;
    const hit = backgroundColours.find(
      (c) => colorDistance(rgba, a, c[0], c[1], c[2]) <= opts.tolerance,
    );
    if (!hit) return; // 贴边的主体像素在这里被挡住,不会起种
    visited[idx] = 1;
    stack.push(idx);
    seedR.push(hit[0]);
    seedG.push(hit[1]);
    seedB.push(hit[2]);
  };

  for (const idx of borderIdx) pushSeed(idx);

  while (stack.length > 0) {
    const idx = stack.pop()!;
    const r = seedR.pop()!;
    const g = seedG.pop()!;
    const b = seedB.pop()!;
    if (colorDistance(rgba, idx * 4, r, g, b) > opts.tolerance) continue;

    mask[idx] = BACKGROUND;
    const x = idx % width;
    const y = (idx - x) / width;
    const neighbours = [
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
    ];
    for (const n of neighbours) {
      if (n < 0 || visited[n]) continue;
      visited[n] = 1;
      stack.push(n);
      // 参照色跟着**种子**走而不是跟着邻居走:跟邻居走会一路漂移,
      // 缓变的背景能一直吞到主体里去。
      seedR.push(r);
      seedG.push(g);
      seedB.push(b);
    }
  }

  return mask;
}

/**
 * 边界羽化:把硬边磨成过渡。不羽化的话边缘是像素级锯齿,放进书里一眼就是机器抠的。
 * 用的是方形均值,半径很小(1-2)时够用且快。
 */
export function featherMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return mask;
  const out = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          sum += mask[ny * width + nx]!;
          count += 1;
        }
      }
      out[y * width + x] = Math.round(sum / count);
    }
  }
  return out;
}

// ── 服务端 mask 的读法 ─────────────────────────────────────────────────────
// 上面那套漫水填充是**没有语义**的兜底(2026-08-29 验证「棚拍人像 5 张 0 张能用」,
// 自动抠图因此被否决)。真正能用的是服务端 isnet-general-use 的分割 mask,由
// `album_photos.profile.maskKey` 指向 R2 的一张 PNG。这里只做「把那张 PNG 的像素
// 翻译成 alpha」这一件纯计算的事。
//
// 两种形状都要读对,而且读错**不会报错**,只会表现成「整张全透明」或「抠图没生效」:
//   · 带 alpha 的 RGBA:主体不透明、背景透明 → 直接用 alpha 通道;
//   · 灰度(canvas 解出来 alpha 恒 255):主体白、背景黑 → 用亮度。
// 判据是「有没有任何一个像素 alpha < 255」,而不是猜文件格式。

/** BT.601 亮度权重(与人眼感知一致;mask 本来就近乎灰度,这里只是稳妥取值)。 */
function luma(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

export function alphaFromMaskPixels(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const count = Math.floor(rgba.length / 4);
  const out = new Uint8ClampedArray(count);
  let hasAlpha = false;
  for (let i = 0; i < count; i += 1) {
    if (rgba[i * 4 + 3]! < 255) { hasAlpha = true; break; }
  }
  for (let i = 0; i < count; i += 1) {
    const base = i * 4;
    out[i] = hasAlpha
      ? rgba[base + 3]!
      : luma(rgba[base]!, rgba[base + 1]!, rgba[base + 2]!);
  }
  return out;
}
