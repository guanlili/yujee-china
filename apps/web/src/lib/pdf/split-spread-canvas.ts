// 跨页(#303)导出:双宽页在屏幕上是一张连续的画布,但 PDF 必须是纯 A4 竖版
// (直接送印刷厂,下游不做拼版)。故双宽截一张 → 从正中切成左右两张 A4 依次写入。
// PDF 页数因此 > 数据页数,这是预期行为。

export interface SliceBox {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** 纯几何:把 w×h 切成左右两半(宽为奇数时左半多吃 1px,不丢列)。 */
export function splitBox(w: number, h: number): [SliceBox, SliceBox] {
  const leftW = Math.ceil(w / 2);
  return [
    { sx: 0, sy: 0, sw: leftW, sh: h },
    { sx: leftW, sy: 0, sw: w - leftW, sh: h },
  ];
}

/** 把一张双宽 canvas 切成左右两张。 */
export function splitSpreadCanvas(
  canvas: HTMLCanvasElement,
): [HTMLCanvasElement, HTMLCanvasElement] {
  const [leftBox, rightBox] = splitBox(canvas.width, canvas.height);
  // 显式解构成两个具名变量,而不是 map(...) as [A, A] —— 那个断言是没检查的,
  // splitBox 若哪天返回别的元数,类型系统会闭着眼睛放过去。
  return [cut(canvas, leftBox), cut(canvas, rightBox)];
}

function cut(canvas: HTMLCanvasElement, box: SliceBox): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = box.sw;
  out.height = box.sh;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(canvas, box.sx, box.sy, box.sw, box.sh, 0, 0, box.sw, box.sh);
  return out;
}
