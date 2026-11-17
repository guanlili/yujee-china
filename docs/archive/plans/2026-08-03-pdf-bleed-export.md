# PDF 出血导出实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDF 导出增加「印刷版(含 3mm 出血)」选项:边缘延伸生成出血,页面尺寸等比 216×303mm。

**Architecture:** 规格 `docs/specs/2026-08-03-pdf-bleed-export-design.md`。纯函数层
(`extend-canvas-edges.ts`:mm→px 换算 + 画布边缘延伸 + jsPDF 页面尺寸)→ 栅格管线
`render-raster.ts` 加 `bleedMm` 参数 → 双端导出菜单各加一个「印刷版 PDF」入口。
印刷版**只本地下载,不上传 R2**(云端 PDF 保持标准版,分享/完成态语义不变)。

**Tech Stack:** html2canvas-pro + jsPDF(浏览器栅格管线)· node:test + tsx · 命令式 DOM(桌面)/ React(移动)

## Global Constraints

- 出血固定 3mm;默认无出血;`bleedMm: 0`(缺省)路径输出逐字节不变。
- 换算基准:794px ↔ 210mm(`CSS_PX_PER_MM = 794/210`);jsPDF 页面尺寸用**浮点** CSS px
  (物理比例精确 216×303mm),画布出血宽用 `Math.round(cssPx × scale)` 整数。
- 测试:`pnpm --filter @yujee/web exec tsx --test <file>`;全包 `cd apps/web && pnpm test`。
- 当前分支 `feat/collab-editing`;`git add` 只加本任务文件;commit 尾注
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 上线时机:数据库配额恢复后随下一批推 main。

---

### Task 1: 纯函数层 —— 换算 + 画布边缘延伸

**Files:**
- Create: `apps/web/src/lib/pdf/extend-canvas-edges.ts`
- Test: `apps/web/src/lib/pdf/extend-canvas-edges.test.ts`

**Interfaces:**
- Produces(Task 2/3 逐字消费):

```ts
export const CSS_PX_PER_MM: number; // 794 / 210
export function bleedCssPx(bleedMm: number): number; // 浮点,3 → ≈11.3428
export function pdfPageFormat(bleedMm: number): [number, number]; // [794+2b, 1123+2b],b=bleedCssPx
/** 画布四边各加 bleedPx:中间贴原图,最外 1px 行/列拉伸成边条,四角用角像素填。
 *  bleedPx <= 0 时原样返回 source。createCanvas 可注入(测试用假画布)。 */
export function extendCanvasEdges(
  source: HTMLCanvasElement,
  bleedPx: number,
  createCanvas?: (w: number, h: number) => HTMLCanvasElement,
): HTMLCanvasElement;
```

- [ ] **Step 1: 写失败测试** — 假画布记录 drawImage 调用,断言几何(node 无真 canvas,
  真像素由取证脚本覆盖,见 Task 4):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { CSS_PX_PER_MM, bleedCssPx, extendCanvasEdges, pdfPageFormat } from './extend-canvas-edges';

test('换算:CSS_PX_PER_MM 与 3mm 出血值', () => {
  assert.ok(Math.abs(CSS_PX_PER_MM - 794 / 210) < 1e-9);
  assert.ok(Math.abs(bleedCssPx(3) - (3 * 794) / 210) < 1e-9);
  assert.deepEqual(pdfPageFormat(0), [794, 1123]);
  const [w, h] = pdfPageFormat(3);
  assert.ok(Math.abs(w - (794 + 2 * bleedCssPx(3))) < 1e-9);
  assert.ok(Math.abs(h - (1123 + 2 * bleedCssPx(3))) < 1e-9);
});

type Draw = { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };
function fakeCanvas(w: number, h: number, draws: Draw[]) {
  return {
    width: w,
    height: h,
    getContext: () => ({
      imageSmoothingEnabled: true,
      drawImage: (_src: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) =>
        draws.push({ sx, sy, sw, sh, dx, dy, dw, dh }),
    }),
  } as unknown as HTMLCanvasElement;
}

test('extendCanvasEdges:输出尺寸 +2B,原图贴在 (B,B),四边一像素拉伸,四角补齐', () => {
  const draws: Draw[] = [];
  const source = { width: 100, height: 200 } as HTMLCanvasElement;
  const out = extendCanvasEdges(source, 10, (w, h) => fakeCanvas(w, h, draws));
  assert.equal(out.width, 120);
  assert.equal(out.height, 220);
  // 中心
  assert.ok(draws.some((d) => d.sx === 0 && d.sy === 0 && d.sw === 100 && d.sh === 200 && d.dx === 10 && d.dy === 10 && d.dw === 100 && d.dh === 200));
  // 四边:最外 1px 行/列 → B 宽条带
  assert.ok(draws.some((d) => d.sy === 0 && d.sh === 1 && d.dy === 0 && d.dh === 10 && d.dx === 10 && d.dw === 100), '上边条');
  assert.ok(draws.some((d) => d.sy === 199 && d.sh === 1 && d.dy === 210 && d.dh === 10, ), '下边条');
  assert.ok(draws.some((d) => d.sx === 0 && d.sw === 1 && d.dx === 0 && d.dw === 10 && d.dy === 10 && d.dh === 200), '左边条');
  assert.ok(draws.some((d) => d.sx === 99 && d.sw === 1 && d.dx === 110 && d.dw === 10), '右边条');
  // 四角(以左上/右下为代表)
  assert.ok(draws.some((d) => d.sx === 0 && d.sy === 0 && d.sw === 1 && d.sh === 1 && d.dx === 0 && d.dy === 0 && d.dw === 10 && d.dh === 10));
  assert.ok(draws.some((d) => d.sx === 99 && d.sy === 199 && d.sw === 1 && d.sh === 1 && d.dx === 110 && d.dy === 210));
  assert.equal(draws.length, 9, '中心 + 4 边 + 4 角,不多画');
});

test('extendCanvasEdges:bleedPx=0 原样返回', () => {
  const source = { width: 5, height: 5 } as HTMLCanvasElement;
  assert.equal(extendCanvasEdges(source, 0), source);
});
```

- [ ] **Step 2: 确认失败** — Run: `pnpm --filter @yujee/web exec tsx --test src/lib/pdf/extend-canvas-edges.test.ts`;Expected: FAIL(模块不存在)
- [ ] **Step 3: 实现**

```ts
// A4 页面像素基准:页面 794 CSS px ↔ 成品 210mm(constants.PAGE 同源,不重复引避免环)。
export const CSS_PX_PER_MM = 794 / 210;

export function bleedCssPx(bleedMm: number): number {
  return bleedMm * CSS_PX_PER_MM;
}

// jsPDF 页面尺寸(CSS px,浮点保物理比例精确):含出血即等比 216×303mm。
export function pdfPageFormat(bleedMm: number): [number, number] {
  const b = bleedCssPx(bleedMm);
  return [794 + 2 * b, 1123 + 2 * b];
}

// 出血 = 边缘延伸(2026-08-03 设计):内容零位移零缩放,最外 1px 拉伸填出血条,
// 裁切漂移时露出的是颜色延续而不是白边。B<=0 原样返回。
export function extendCanvasEdges(
  source: HTMLCanvasElement,
  bleedPx: number,
  createCanvas: (w: number, h: number) => HTMLCanvasElement = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  },
): HTMLCanvasElement {
  if (bleedPx <= 0) return source;
  const B = Math.round(bleedPx);
  const W = source.width;
  const H = source.height;
  const out = createCanvas(W + 2 * B, H + 2 * B);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  // 中心
  ctx.drawImage(source, 0, 0, W, H, B, B, W, H);
  // 四边:最外 1px 行/列拉伸成 B 宽条带
  ctx.drawImage(source, 0, 0, W, 1, B, 0, W, B); // 上
  ctx.drawImage(source, 0, H - 1, W, 1, B, H + B, W, B); // 下
  ctx.drawImage(source, 0, 0, 1, H, 0, B, B, H); // 左
  ctx.drawImage(source, W - 1, 0, 1, H, W + B, B, B, H); // 右
  // 四角:角落 1px 填充
  ctx.drawImage(source, 0, 0, 1, 1, 0, 0, B, B);
  ctx.drawImage(source, W - 1, 0, 1, 1, W + B, 0, B, B);
  ctx.drawImage(source, 0, H - 1, 1, 1, 0, H + B, B, B);
  ctx.drawImage(source, W - 1, H - 1, 1, 1, W + B, H + B, B, B);
  return out;
}
```

- [ ] **Step 4: 确认通过** — Run 同 Step 2 + `pnpm --filter @yujee/web typecheck`;Expected: PASS
- [ ] **Step 5: Commit** — `git add apps/web/src/lib/pdf/extend-canvas-edges.ts apps/web/src/lib/pdf/extend-canvas-edges.test.ts && git commit -m "feat(web): 出血纯函数层 —— mm 换算 + 画布边缘延伸"`

---

### Task 2: 栅格管线接 bleedMm

**Files:**
- Modify: `apps/web/src/lib/pdf/render-raster.ts`(`RasterPdfOptions` ≈:30、`renderAlbumPdfRaster` ≈:283-320)

**Interfaces:**
- Consumes: Task 1 的 `bleedCssPx` / `pdfPageFormat` / `extendCanvasEdges`
- Produces: `RasterPdfOptions.bleedMm?: number`(Task 3 的两端调用传 3)

- [ ] **Step 1: 改造** — `RasterPdfOptions` 加 `bleedMm?: number; // 出血毫米数,默认 0(印刷版传 3)`;
  `renderAlbumPdfRaster` 内:

```ts
  const bleedMm = options.bleedMm ?? 0;
  const pageFormat = pdfPageFormat(bleedMm); // [794,1123] 或含出血
  const bleedDevicePx = Math.round(bleedCssPx(bleedMm) * scale);
  // …
  const doc = new jsPDF({ unit: 'px', format: pageFormat, orientation: 'portrait' });
  // …每个 face(含双宽拆半后的半页):
  const bled = extendCanvasEdges(face, bleedDevicePx);
  const img = bled.toDataURL('image/jpeg', jpegQuality);
  if (!first) doc.addPage(pageFormat, 'portrait');
  first = false;
  doc.addImage(img, 'JPEG', 0, 0, pageFormat[0], pageFormat[1]);
```

  顶部 import `{ bleedCssPx, extendCanvasEdges, pdfPageFormat } from './extend-canvas-edges'`。
  出血注释一行:出血在**拆半之后**做(双宽页每半各自四边延伸,书脊侧也延伸,印厂拼版通用)。
- [ ] **Step 2: 验证** — Run: `pnpm --filter @yujee/web typecheck` + 既有
  `pnpm --filter @yujee/web exec tsx --test src/lib/pdf/render-raster-flatten.test.ts`;Expected: PASS
  (bleedMm 缺省 0 时 `extendCanvasEdges` 原样返回、`pdfPageFormat(0)` = [794,1123],原路径不变)
- [ ] **Step 3: Commit** — `git add apps/web/src/lib/pdf/render-raster.ts && git commit -m "feat(web): 栅格 PDF 管线支持 bleedMm 出血参数"`

---

### Task 3: 双端导出菜单加「印刷版 PDF」+ 接线守卫

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/mobile/modals/ExportModals.tsx`(PDF 项后加钮,≈:79-85)
- Modify: `apps/web/src/components/album/editor-v2/mobile/use-export.ts`(`exportPdf` ≈:306 接参数)
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditorRoot.tsx`(接线新回调)
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`(菜单钮 ≈:954、dispatch、`renderPdfOnce` ≈:5361 接参数、出血版跳过上传)
- Test: `apps/web/src/components/album/editor-v2/pdf-bleed-wiring.test.ts`(新建,镜像既有源码 pin 式守卫)

**Interfaces:**
- Consumes: Task 2 的 `RasterPdfOptions.bleedMm`
- Produces: 移动端 `ExportMenuModal` 新 prop `onPdfBleed: () => void`(必填,漏接编译不过);
  `use-export.exportPdf(opts?: { bleedMm?: number })`;桌面 `data-action="exportPdfBleed"`。

- [ ] **Step 1: 移动端** — `ExportModals.tsx` PDF 钮后加(文案即「默认 3mm」的告知点):

```tsx
        <button
          className="export-opt"
          onClick={onPdfBleed}
          data-testid="export-opt-pdf-bleed"
          title={zh ? '四边各加 3mm 出血,供印刷厂裁切;页面尺寸相当于 216×303mm' : 'Adds 3mm bleed on all sides for print trimming; page equals 216×303mm'}
        >
          <svg {...stroke}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6" />
            <path d="M3 12h18" strokeDasharray="2 2" />
          </svg>
          <span>{zh ? '印刷版 PDF · 含 3mm 出血' : 'Print PDF · 3mm bleed'}</span>
        </button>
```

  props 加 `onPdfBleed: () => void;`(与 onPdf 并排,注释同款「必填=漏接编译不过」)。
  `use-export.ts`:`exportPdf` 签名改 `useCallback(async (opts?: { bleedMm?: number }) => {…}`,
  渲染调用改 `renderAlbumPdfRaster(adaptable, resolveImage, { scale: 3, onProgress, bleedMm: opts?.bleedMm ?? 0 })`;
  **出血版跳过云端上传**:`if (!opts?.bleedMm) { void runExportWithRetry(() => uploadPdf(…)) }`
  (云端 PDF 保持标准版);文件名出血版 `${stem()}-bleed3mm.pdf`。
  `MobileEditorRoot.tsx` 的 `<ExportMenuModal … onPdf={…}` 处并排加 `onPdfBleed={() => { setExportMenuOpen(false); void exporter.exportPdf({ bleedMm: 3 }); }}`(照 onPdf 现有接法)。
- [ ] **Step 2: 桌面端** — `EditorPort.tsx` :954 PDF 钮后加:

```tsx
            <button className="export-opt" data-action="exportPdfBleed" data-testid="export-opt-pdf-bleed" title={zh ? '四边各加 3mm 出血,供印刷厂裁切;页面尺寸相当于 216×303mm' : 'Adds 3mm bleed on all sides for print trimming; page equals 216×303mm'}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M3 12h18" strokeDasharray="2 2" /></svg>
              <span>{zh ? '印刷版 PDF · 含 3mm 出血' : 'Print PDF · 3mm bleed'}</span>
            </button>
```

  找到处理 `data-action="exportPdf"` 的 dispatch(与 openCollage 等同一处),并排加
  `exportPdfBleed` 分支调用同一条 PDF 导出流程但传 `bleedMm: 3`:`renderPdfOnce` 改签名
  `renderPdfOnce(bleedMm: number)`,内部 `renderAlbumPdfRaster(…, { scale: 3, onProgress: setExportProgress, bleedMm })`;
  出血版**跳过 upload 段**(只本地下载,与移动端同口径),文件名 `-bleed3mm` 后缀;
  export-gate 锁镜像(≈:1489)同样罩住新钮(`$('[data-action="exportPdfBleed"]')`)。
- [ ] **Step 3: 接线守卫** — 新建 `pdf-bleed-wiring.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* PDF 出血导出(2026-08-03 设计)的接线守卫:双端各一个印刷版入口,只有它传
   bleedMm:3;出血版不上传云端;渲染管线消费 bleedMm → pdfPageFormat/extendCanvasEdges。 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');
const editor = read('EditorPort.tsx');
const exportModals = read('mobile', 'modals', 'ExportModals.tsx');
const useExport = read('mobile', 'use-export.ts');
const raster = read('..', '..', '..', 'lib', 'pdf', 'render-raster.ts');

test('渲染管线消费 bleedMm(pdfPageFormat + extendCanvasEdges),缺省 0 走原路径', () => {
  assert.match(raster, /bleedMm\?: number/);
  assert.match(raster, /pdfPageFormat\(bleedMm\)/);
  assert.match(raster, /extendCanvasEdges\(/);
  assert.match(raster, /options\.bleedMm \?\? 0/);
});

test('双端各恰好一个印刷版入口,标注 3mm,默认路径不带出血', () => {
  for (const src of [editor, exportModals]) {
    assert.match(src, /data-testid="export-opt-pdf-bleed"/);
    assert.match(src, /3mm/);
  }
  assert.match(useExport, /bleedMm: opts\?\.bleedMm \?\? 0/);
  const bleedCalls = (editor.match(/bleedMm: 3/g) ?? []).length + (useExport.match(/bleedMm: 3/g) ?? []).length;
  assert.ok(bleedCalls === 0, 'bleedMm:3 只出现在入口回调(MobileEditorRoot/dispatch),渲染层不硬编码');
});

test('出血版只本地下载,不上传云端(云端 PDF 保持标准版)', () => {
  assert.match(useExport, /if \(!opts\?\.bleedMm\)/);
  assert.match(useExport, /-bleed3mm\.pdf|bleed3mm/);
});
```

  (`bleedMm: 3` 的出现位置以实现落点为准修正断言 —— 守卫钉「渲染层不硬编码 3」这条语义。)
- [ ] **Step 4: 验证** — Run: 新守卫 + `pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/mobile/modals/modals.test.ts src/components/album/editor-v2/mobile/click-wiring.test.ts` + `pnpm --filter @yujee/web typecheck`;Expected: PASS
- [ ] **Step 5: Commit** — `git add`(本任务五个文件)`&& git commit -m "feat(web): 双端导出菜单加印刷版 PDF(3mm 出血)"`

---

### Task 4: 全量验证 + 真渲染取证

- [ ] **Step 1: Web 全包** — Run: `cd apps/web && pnpm test`;Expected: PASS
- [ ] **Step 2: 真渲染对照(导出取证法,本地跑)** — 起本地 web(dev 预览页有样例书),
  playwright 驱动 `/zh/dev/mobile` 或 template-check 页触发一次 `bleedMm: 3` 导出,
  断言:输出 PDF 页数不变、页面尺寸 ≈ 816.7×1145.7 px 单位;或对
  `extendCanvasEdges` 在真浏览器 canvas 上跑一次,采样出血条像素 == 相邻边缘像素。
  产物用完即删(临时脚本放 scratchpad)。
- [ ] **Step 3: 汇报** — 对照规格逐条勾验收;声明上线等数据库配额恢复后的下一班车。
