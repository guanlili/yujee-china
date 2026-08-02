# 图片编辑弹窗 Figma 式预览调位设计(仅桌面)

- 日期: 2026-08-02
- 影响面: `apps/web` editor-v2 桌面(`EditorPort.tsx`、`editor-port.css`、
  `image-edit-util.ts`);移动端**不动**
- 背景: 2026-08-01 的「统一长按」两轮修补后,画布上 pan(慢速微调)与长按交换
  在时间维度(8px/350ms)上仍不可切分。用户拍板改走 Figma 模型:**位置调整整体
  搬进点击后的编辑弹窗**,画布上的照片拖拽调位交互删除。

## 已定决策

| 议题 | 决策 |
|---|---|
| 画布单击照片 | 选中 + 出编辑弹窗(现状不变) |
| 画布长按照片 0.35s | 拾起交换 —— **选中与否都可以**;2026-08-02 上午加的「选中槽不武装计时器」guard 撤销(pan 已不在画布上,冲突源头消失) |
| 画布拖拽照片 | **不再调位置**,也不做任何事;空白拖动平移画布照旧 |
| 位置调整入口 | 弹窗内 Figma 式交互预览:整图 contain 显示、棋盘格垫底、当前裁切范围亮框、框外压暗;在预览内拖动 = 调位置,即时映到画布,松手走现有 `commitImagePos()` |
| 缩放 | 弹窗滑块 + 画布滚轮(悬停选中图)均保留 |
| 弹窗按钮 | 换图 / 风格(滤镜) / 复位 / 删除 原样保留;「拖动平移」hint 文案删除 |
| 移动端 | 完全不动(触屏直接拖 pan 顺手,冲突已由编辑态不武装长按解决) |

## 预览几何(纯函数,进 image-edit-util.ts)

渲染模型(见该文件抬头):img cover-fit 于图框,`object-position: x% y%` +
`scale ≥ 1`。推导可见裁切窗口在**原图**上的位置:

- `k0 = max(frameW/natW, frameH/natH)`,`k = k0 * scale`
- 可见比例 `fx = frameW/(natW*k)`、`fy = frameH/(natH*k)`(均 ≤1)
- 裁切窗口左/上(原图比例):`left = x/100 * (1-fx)`、`top = y/100 * (1-fy)`

新增两个导出(配单测):

```ts
export type CropFraction = { left: number; top: number; width: number; height: number };
/** 可见裁切窗口(原图归一化坐标)。尺寸非法(0/负/NaN)→ null。 */
export function coverCropFraction(natW, natH, frameW, frameH, pos): CropFraction | null;
/** 预览内拖动 → 新 ImagePos。dx>0(把图往右拖)= 露出图的左侧 = x 减小,
 *  与 dragToImagePos 同一方向语义;满幅无余量的轴(fx≥1)忽略该轴。
 *  previewW/H 为预览里整图的渲染像素尺寸。 */
export function previewDragToImagePos(start, dxPx, dyPx, previewW, previewH, crop): ImagePosValue;
```

换算:`x' = clamp(x - dx*100 / (previewW*(1-fx)))`(fy 同理),复用 `clampImagePos`。

## 弹窗结构(buildImgEditOverlay 重排)

```
.img-edit-overlay(竖排卡片,仍由 positionImgEditOverlay 贴选中图框下方)
  .img-edit-preview      ← 定宽高盒(≤200×150),棋盘格底,overflow:hidden
    img.img-edit-preview-img   ← 同 src 整图 contain(按 nat 比例算出 pw×ph)
    .img-edit-crop             ← 亮框 absolute,框外用大 box-shadow 压暗
  .img-edit-zoom(现有滑块)
  按钮行:换图 / 风格 / 复位 / 删除
```

- `renderImgEditPreview()`:按 `imgEdit` 现算 pw/ph 与裁切框;调用点 = selectImage、
  slider input、滚轮缩放、复位、预览拖动、reattachImgEdit。
- 图片未加载完(naturalWidth=0)→ 预览隐藏,`load` 事件后重渲。
- 预览指针事件:down 记起点+起始 pos+setPointerCapture;move 走
  `previewDragToImagePos` → `applyLiveImagePos`(画布即时)+ 重渲裁切框;
  up → `commitImagePos()`(所见即所存链路不变)。

## 画布手势拆除

- 删 `onImgPointerDown/Move/Up` 及两处绑定(pageLeft/pageRight、#ovGrid),
  连带 `dragging/dragStart/dragStartPos/dragMoved` 状态;
  `onOvPointerDown` 的 `if (dragging || swapDrag)` 门收敛为 `if (swapDrag)`。
- 滚轮缩放 `onImgWheel` 保留。
- `onSwapPointerDown` 撤掉选中槽 guard;`beginSwapDrag` 的 live 位移回放保留
  (滑块/预览拖动中途仍可能有未提交位移,防御不撤)。

## 测试

- `image-edit-util.test.ts`:coverCropFraction(横/竖图、scale>1、非法尺寸)、
  previewDragToImagePos(方向、clamp、满幅轴忽略)。
- `image-swap-wiring.test.ts`:删「选中槽不武装」测试,换成「画布无照片 pan
  监听 + 长按对选中照片同样有效」的 pin;`dragging` 相关 regex 同步。
- 弹窗结构 pin:overlay 含 `.img-edit-preview`/`.img-edit-crop`,预览 up 走
  commitImagePos。
