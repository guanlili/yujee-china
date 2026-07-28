// 相册垫底背景 → canvas 画法。拼图导出与 Live(九宫格/翻页)导出共用这一份。
//
// 为什么要共用:垫底背景是**相册级视觉属性**,用户在画板上选一次,预览、拼图、Live
// 三处看到的必须是同一个底。各写各的迟早漂移 —— 九宫格那份原本就只认 kind==='color',
// 选了预设图或上传图会静默回落成写死的 #c9c5b9,用户选的背景压根没出现在成片里。
//
// 三种背景形态见 lib/board-bg/presets 的 BoardBackground:
//   color  → 纯色填充
//   preset → 内置图(/board-bg/*,同源,不污染 canvas)
//   upload → 用户上传图,只存本地 IndexedDB;换设备/清缓存取不到 → 回落中性底
// 未选 / 图缺失 → 中性底(柔和竖向浅灰渐变,不喧宾夺主)。

import { presetImageUrl, type BoardBackground } from '@/lib/board-bg/presets';
import { photoStore } from '@/lib/photo/store';

/** 把背景填进给定矩形。解析好之后是同步的 —— Live 导出要在 rAF 逐帧循环里调它,
 *  那里不能 await(一 await 就掉帧,录出来的视频会顿)。 */
export type BoardBgPainter = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) => void;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 内置预设图是同源(/board-bg/*),同源不会污染 canvas,无需 crossOrigin。
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('bg image load failed: ' + src));
    img.src = src;
  });
}

// 上传的垫底背景只存本地(photoStore):取 blob → 同源 objectURL → 载入(不污染导出画布)。
// 载入完成即撤 URL(位图已解码,后续 drawImage 仍有效)。缺失(换设备)返回 null → 回落中性底。
async function loadBoardUpload(key: string): Promise<HTMLImageElement | null> {
  const blob = await photoStore.getBlob(key).catch(() => undefined);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try { return await loadImage(url); } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** cover 铺满目标矩形,居中裁切(与画板预览同口径:不留白、不变形)。 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / img.width, height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

/**
 * 解析一次背景(该载的图先载好),返回同步 painter。
 * 载图失败一律不抛 —— 导出不该因为背景图取不到就整个失败,回落中性底即可。
 */
export async function resolveBoardBgPainter(
  bg: BoardBackground | null | undefined,
): Promise<BoardBgPainter> {
  let image: HTMLImageElement | null = null;
  if (bg?.kind === 'preset') {
    image = await loadImage(presetImageUrl(bg.presetId)).catch(() => null);
  } else if (bg?.kind === 'upload') {
    image = await loadBoardUpload(bg.key);
  }
  return (ctx, x, y, width, height) => {
    if (bg?.kind === 'color') {
      ctx.fillStyle = bg.color;
      ctx.fillRect(x, y, width, height);
      return;
    }
    if (image) {
      drawCover(ctx, image, x, y, width, height);
      return;
    }
    const g = ctx.createLinearGradient(x, y, x, y + height);
    g.addColorStop(0, '#eef1f3');
    g.addColorStop(1, '#f5f4f1');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, width, height);
  };
}
