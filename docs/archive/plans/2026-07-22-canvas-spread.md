# 画布双页排版（跨页）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一个模板可以横跨左右两页（跨页大图 / 通栏版式），engine 分页链路零改动。

**Architecture:** 模板 JSON 新增 `spread: true` 标记 → 该模板画布宽度翻倍（1588×1123）。
全仓写死 `PAGE.width` 的渲染面改调 `pageBox(templateId)`。左右页配对与页码的两份重复
逻辑抽成单一 `placePages()` 走查，双页页占满一整个 spread、吃掉两个页码。
PDF 导出时双宽截一张、从中间切成两页 A4。

**Tech Stack:** TypeScript / zod（契约）· React（模板组件）· Python + TypedDict/pydantic（engine 镜像）·
`node:test` + `tsx --test`（web 测试）· pytest（engine 测试）· html2canvas-pro + jsPDF（导出）

## Global Constraints

- 分支 `feat/canvas-spread-wedding`。**不切回 main，不在 main 上提交。**
- **回归基线：任一现有单页模板的渲染输出逐像素不变。** 每个任务改完都要能论证这一点。
- 模板注册是**三处原子**：`packages/contracts/templates/<id>.json` + `apps/web/src/components/album/templates/<id>/index.tsx`（登记进 `web-registry.ts`）+ `packages/contracts/src/render/html-templates/<id>.ts`（登记进 `registry.ts`）。少一处测试即挂。
- **contracts 的 zod 有两份**：`packages/contracts/src/templates.ts` 与 `packages/contracts/scripts/gen-templates.ts` 里的内联镜像。两边必须同步，否则 `pnpm templates:check` 报漂移。
- **Python 有两份镜像**：`engine/src/workflows/core/layout/templates.py`（TypedDict + 手写校验）与 `engine/src/contracts/schemas.py`（pydantic，`extra="forbid"`）。两边都是 strict，漏一处则新模板 JSON 一落地 engine 加载即失败。
- engine 侧 `candidate_gen_v3` / `skeleton_v3` **一行都不改**。若发现必须改，停下来问用户。
- 不启用 `TemplatePairing`（`forced/with/side`），保持原样。
- 测试命令：web `pnpm --filter @yujee/web test`；契约 `pnpm templates:check`；engine `cd engine && .venv/bin/python -m pytest`。

---

## File Structure

**新建**
- `packages/contracts/src/render/page-box.ts` — 单一职责：由 templateId 算出该页画布尺寸
- `apps/web/src/components/album/page-layout.ts` — 单一职责：把页序走查成「每页落在第几个 spread、占哪一侧」
- `apps/web/src/components/album/page-layout.test.ts`
- `packages/contracts/templates/mag-54.json` + `apps/web/src/components/album/templates/mag-54/index.tsx` + `packages/contracts/src/render/html-templates/mag-54.ts` — 首个跨页模板（机制验证样板）

**修改**
- `packages/contracts/src/templates.ts` — `TemplateDef` 加 `spread`
- `packages/contracts/scripts/gen-templates.ts` — 内联 zod 镜像同步
- `packages/contracts/src/render/index.ts` — 导出 page-box
- `engine/src/workflows/core/layout/templates.py`、`engine/src/contracts/schemas.py` — Python 双镜像
- `apps/web/src/components/album/spreads.ts` — `Spread` 加 `full`，改由 `placePages` 派生
- `apps/web/src/components/album/page-html-dom.ts` — 两个 folio 函数合并为 `pageFolioInfos`，`applyFolioOverlay` 支持双页码
- `apps/web/src/components/album/templates/web-utils.tsx` — `WebPage` 按 pageBox
- `apps/web/src/components/album/editor-v2/EditorPort.tsx` — `faceHTML`、离屏盒、`paintSpread`
- `apps/web/src/components/album/FlipBook.tsx`、`PagePreview.tsx`、`lib/photo/candidate-thumbnail.tsx`
- `apps/web/src/lib/pdf/render-raster.ts` — 切页
- `apps/web/src/lib/export/single-pages.ts` — 跟随新 folio API

---

### Task 1: 契约层 `spread` 字段 + `pageBox()`

**Files:**
- Modify: `packages/contracts/src/templates.ts:99-124`
- Modify: `packages/contracts/scripts/gen-templates.ts:67-88`
- Create: `packages/contracts/src/render/page-box.ts`
- Modify: `packages/contracts/src/render/index.ts:3`
- Create: `packages/contracts/src/render/page-box.test.ts`
- Modify: `packages/contracts/src/templates.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces:
  - `TemplateDef.spread?: boolean`
  - `pageBox(templateId: string): { width: number; height: number }`
  - `isSpreadTemplate(templateId: string): boolean`
  - 从 `@yujee/contracts/render` 与 `@yujee/contracts/render/page-box` 两处均可 import

- [ ] **Step 1: 写失败测试（schema）**

追加到 `packages/contracts/src/templates.test.ts` 末尾：

```ts
test('spread is accepted on interior templates', () => {
  const parsed = TemplateDef.safeParse({
    id: 'x', category: 'interior', spread: true, images: [{ id: 'image1' }], texts: [],
  });
  assert.equal(parsed.success, true);
});

test('spread is rejected on non-interior templates', () => {
  const parsed = TemplateDef.safeParse({
    id: 'x', category: 'cover', spread: true, images: [{ id: 'image1' }], texts: [],
  });
  assert.equal(parsed.success, false);
});

test('spread and pairing are mutually exclusive', () => {
  const parsed = TemplateDef.safeParse({
    id: 'x', category: 'interior', spread: true,
    pairing: { forced: true, with: 'y', side: 'left' },
    images: [{ id: 'image1' }], texts: [],
  });
  assert.equal(parsed.success, false);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/contracts && pnpm test 2>&1 | tail -20`
Expected: FAIL —— 前两条因 `.strict()` 拒绝未知键 `spread` 而 `success:false`（第一条断言 true 失败）。

- [ ] **Step 3: 改 `packages/contracts/src/templates.ts`**

在 `TemplatePairing` 定义之后、`TemplateDef` 之前插入注释与字段。把 `TemplateDef` 改成：

```ts
export const TemplateDef = z
  .object({
    id: z.string().min(1),
    // V3:分类(§9),唯一分类字段,替代旧 slot+scene。
    category: TemplateCategory,
    pairing: TemplatePairing.nullable().optional(),
    // 跨页(#303):该模板画布宽度翻倍(PAGE.width*2),独占一整个 spread,
    // 大图/大标题可横穿中缝。engine 仍把它当普通一页参与分页,不需要知道左右页。
    // 只在 interior 有意义;与 pairing 互斥(pairing 是「两个窄模板配对」的另一条路)。
    spread: z.boolean().optional(),
    styles: z.array(z.string().min(1)).optional(),
    images: z.array(TemplateImageSlot),
    // V3:装饰矢量图槽(可选,§9)。
    svgs: z.array(TemplateSvgSlot).optional(),
    texts: z.array(TemplateTextSlot),
    // V3:唯一重复组(可选,§9)。
    items: TemplateItems.optional(),
  })
  .strict()
  .superRefine((template, ctx) => {
    // pairing 只在 interior 有意义(cover/toc/ending 单独成页,不参与 spread 配对)。
    if (template.pairing && template.category !== 'interior') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pairing is only valid on interior templates',
        path: ['pairing'],
      });
    }
    if (template.spread && template.category !== 'interior') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'spread is only valid on interior templates',
        path: ['spread'],
      });
    }
    if (template.spread && template.pairing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'spread and pairing are mutually exclusive',
        path: ['spread'],
      });
    }
  });
```

- [ ] **Step 4: 同步 `packages/contracts/scripts/gen-templates.ts:67-88` 的内联镜像**

把该文件里的 `TemplateDef` 改成与上一步**逐字相同**的定义（含三条 superRefine 与注释可省略，但字段与 issue message 必须一致）。

- [ ] **Step 5: 运行 schema 测试，确认通过**

Run: `cd packages/contracts && pnpm test 2>&1 | tail -20`
Expected: PASS，三条新用例全绿。

Run: `pnpm templates:check`
Expected: 通过（无漂移）。

- [ ] **Step 6: 写 pageBox 失败测试**

Create `packages/contracts/src/render/page-box.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { PAGE } from './constants';
import { isSpreadTemplate, pageBox } from './page-box';

test('normal template keeps the A4 page box', () => {
  assert.deepEqual(pageBox('mag-03'), { width: PAGE.width, height: PAGE.height });
  assert.equal(isSpreadTemplate('mag-03'), false);
});

test('unknown template falls back to the A4 page box', () => {
  assert.deepEqual(pageBox('does-not-exist'), { width: PAGE.width, height: PAGE.height });
  assert.equal(isSpreadTemplate('does-not-exist'), false);
});
```

- [ ] **Step 7: 运行，确认失败**

Run: `cd packages/contracts && pnpm test 2>&1 | tail -20`
Expected: FAIL —— `Cannot find module './page-box'`。

- [ ] **Step 8: 写 `packages/contracts/src/render/page-box.ts`**

```ts
import { getTemplate } from '../templates';
import { PAGE } from './constants';

// 跨页(#303):一个 spread 模板 = 一张双宽画布(1588×1123),独占一整个物理跨页。
// 所有渲染面(画板/翻书/预览/PDF/拼图/候选缩略图)都必须按这里给的尺寸开盒,
// 而不是直接读 PAGE —— 单页模板的返回值与 PAGE 完全相同,故老模板逐像素不变。
export interface PageBox {
  width: number;
  height: number;
}

export function isSpreadTemplate(templateId: string): boolean {
  return getTemplate(templateId)?.spread === true;
}

export function pageBox(templateId: string): PageBox {
  return isSpreadTemplate(templateId)
    ? { width: PAGE.width * 2, height: PAGE.height }
    : { width: PAGE.width, height: PAGE.height };
}
```

- [ ] **Step 9: 从 render 桶导出**

`packages/contracts/src/render/index.ts` 在 `export * from './constants';` 下一行加：

```ts
export * from './page-box';
```

- [ ] **Step 10: 运行，确认通过**

Run: `cd packages/contracts && pnpm test 2>&1 | tail -20`
Expected: PASS

Run: `pnpm --filter @yujee/contracts typecheck`
Expected: 无错误。

- [ ] **Step 11: Commit**

```bash
git add packages/contracts/src/templates.ts packages/contracts/src/templates.test.ts \
        packages/contracts/scripts/gen-templates.ts \
        packages/contracts/src/render/page-box.ts packages/contracts/src/render/page-box.test.ts \
        packages/contracts/src/render/index.ts
git commit -m "feat(contracts): 模板 spread 标记 + pageBox() 双宽画布 #303"
```

---

### Task 2: engine Python 双镜像

**Files:**
- Modify: `engine/src/workflows/core/layout/templates.py:59-85`（TypedDict + `_TEMPLATE_KEYS`）与 `:272-320`（`_validate_template`）
- Modify: `engine/src/contracts/schemas.py:418-447`
- Modify: `engine/tests/test_template_loader.py`

**Interfaces:**
- Consumes: Task 1 的 `spread` 字段语义（interior-only、与 pairing 互斥）
- Produces: engine 能加载带 `spread: true` 的模板 JSON 而不报错；非 interior 或与 pairing 并存时抛 `RuntimeError` / `ValidationError`

- [ ] **Step 1: 写失败测试**

追加到 `engine/tests/test_template_loader.py`：

```python
def test_loader_accepts_spread_on_interior(tmp_path):
    from src.workflows.core.layout import templates

    (tmp_path / "spread-ok.json").write_text(json.dumps({
        "id": "spread-ok", "category": "interior", "spread": True,
        "images": [{"id": "image1"}],
        "texts": [{"id": "title", "role": "title", "lang": "user"}],
    }), encoding="utf-8")

    loaded = templates._load_templates_from_dir(tmp_path)
    assert loaded["spread-ok"]["spread"] is True


def test_loader_rejects_spread_on_cover(tmp_path):
    from src.workflows.core.layout import templates

    (tmp_path / "spread-bad.json").write_text(json.dumps({
        "id": "spread-bad", "category": "cover", "spread": True,
        "images": [{"id": "image1"}],
        "texts": [{"id": "title", "role": "title", "lang": "user"}],
    }), encoding="utf-8")

    with pytest.raises(RuntimeError, match="spread is only valid on interior"):
        templates._load_templates_from_dir(tmp_path)
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd engine && .venv/bin/python -m pytest tests/test_template_loader.py -q 2>&1 | tail -20`
Expected: FAIL —— `template registry load failed: ... has unsupported fields: ['spread']`。

- [ ] **Step 3: 改 `engine/src/workflows/core/layout/templates.py`**

`TemplateDef` TypedDict（`:59`）加一行，紧跟 `pairing`：

```python
    pairing: NotRequired[Pairing | None]
    # 跨页(#303):画布双宽,独占一整个 spread。只在 interior 有效,与 pairing 互斥。
    spread: NotRequired[bool]
```

`_TEMPLATE_KEYS`（`:79`）加 `"spread"`：

```python
_TEMPLATE_KEYS = {
    "id", "category", "pairing", "spread", "styles", "images", "texts", "svgs", "items",
}
```

`_validate_template` 里，在处理 `pairing` 的那段之后插入：

```python
    if "spread" in data:
        spread = data["spread"]
        if not isinstance(spread, bool):
            raise _fail(f"{source}.spread must be a boolean")
        if spread and data["category"] != "interior":
            raise _fail(f"{source}.spread is only valid on interior templates")
        if spread and out.get("pairing") is not None:
            raise _fail(f"{source}.spread and pairing are mutually exclusive")
        out["spread"] = spread
```

- [ ] **Step 4: 改 `engine/src/contracts/schemas.py` 的 pydantic 镜像**

`TemplateDef`（`:418`）在 `pairing` 下一行加：

```python
    pairing: TemplatePairing | None = None
    # 跨页(#303):画布双宽,独占一整个 spread。mirrors TS TemplateDef.spread。
    spread: bool = None
```

`model_post_init`（`:443`）补两条校验：

```python
    def model_post_init(self, __context: object) -> None:
        # pairing 只在 interior 有意义(mirrors TS superRefine)。
        if self.pairing is not None and self.category != "interior":
            raise ValueError("pairing is only valid on interior templates")
        if self.spread and self.category != "interior":
            raise ValueError("spread is only valid on interior templates")
        if self.spread and self.pairing is not None:
            raise ValueError("spread and pairing are mutually exclusive")
```

- [ ] **Step 5: 运行，确认通过**

Run: `cd engine && .venv/bin/python -m pytest tests/ -q 2>&1 | tail -20`
Expected: PASS，全套 engine 测试绿（确认没碰坏 `candidate_gen_v3` / `skeleton_v3`）。

- [ ] **Step 6: Commit**

```bash
git add engine/src/workflows/core/layout/templates.py engine/src/contracts/schemas.py \
        engine/tests/test_template_loader.py
git commit -m "feat(engine): 模板契约镜像 spread 字段(interior-only,与 pairing 互斥) #303"
```

---

### Task 3: 单一配对走查 `placePages()`，`buildSpreads` 改由它派生

**Files:**
- Create: `apps/web/src/components/album/page-layout.ts`
- Create: `apps/web/src/components/album/page-layout.test.ts`
- Modify: `apps/web/src/components/album/spreads.ts`
- Modify: `apps/web/src/components/album/spreads.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isSpreadTemplate(templateId)`
- Produces:
  - `type PageSide = 'left' | 'right' | 'both'`
  - `interface PagePlacement { spreadIndex: number; side: PageSide }`
  - `function placePages(templateIds: string[]): PagePlacement[]`
  - `interface Spread { left: number | null; right: number | null; full?: number }` —— `full` 存在时 `left`/`right` 恒为 `null`

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/components/album/page-layout.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import { placePages } from './page-layout';

const COVER = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.category === 'cover')!;
const SPREAD = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.spread === true);

test('interior pages pair in order after a solo cover', () => {
  assert.deepEqual(placePages([COVER, 'mag-03', 'mag-05', 'mag-06']), [
    { spreadIndex: 0, side: 'right' },
    { spreadIndex: 1, side: 'left' },
    { spreadIndex: 1, side: 'right' },
    { spreadIndex: 2, side: 'left' },
  ]);
});

test('a spread template owns a whole spread and never becomes a right half', (t) => {
  if (!SPREAD) return t.skip('还没有 spread 模板(Task 8 会加 mag-54)');
  // mag-03 单独占了一个左半页;spread 页不能被塞进它的右半,必须自己起一个 spread。
  assert.deepEqual(placePages([COVER, 'mag-03', SPREAD, 'mag-05']), [
    { spreadIndex: 0, side: 'right' },
    { spreadIndex: 1, side: 'left' },
    { spreadIndex: 2, side: 'both' },
    { spreadIndex: 3, side: 'left' },
  ]);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @yujee/web test 2>&1 | grep -A3 page-layout | head -20`
Expected: FAIL —— `Cannot find module './page-layout'`。

- [ ] **Step 3: 写 `apps/web/src/components/album/page-layout.ts`**

```ts
import { getTemplate } from '@yujee/contracts/templates';
import { isSpreadTemplate } from '@yujee/contracts/render/page-box';

// 左右页配对的**唯一**走查(#303)。此前 spreads.ts 与 page-html-dom.ts 各写了一份
// 同样的配对逻辑,双份真相 —— 跨页一进来两边都得改且极易漂移,故收敛到这里。
// 版面模型:cover 单独起右页(recto),ending 单独收左页(verso);其余 interior+toc
// 顺序两两配;spread 模板独占一整个跨页(side='both')。

export type PageSide = 'left' | 'right' | 'both';

export interface PagePlacement {
  /** 该页落在第几个物理跨页上(从 0 起)。 */
  spreadIndex: number;
  /** 占跨页的哪一侧;'both' = 双宽模板占满整个跨页。 */
  side: PageSide;
}

function isSolo(templateId: string): 'cover' | 'ending' | null {
  const category = getTemplate(templateId)?.category;
  if (category === 'cover') return 'cover';
  if (category === 'ending') return 'ending';
  return null;
}

export function placePages(templateIds: string[]): PagePlacement[] {
  const out: PagePlacement[] = [];
  let spreadIndex = 0;
  // 已经占了当前跨页左半、还等着右半来配的页;null = 当前跨页还空着。
  let pendingLeft = false;

  const closePending = () => {
    if (pendingLeft) {
      spreadIndex += 1;
      pendingLeft = false;
    }
  };

  for (const templateId of templateIds) {
    const solo = isSolo(templateId);
    if (solo) {
      closePending();
      out.push({ spreadIndex, side: solo === 'cover' ? 'right' : 'left' });
      spreadIndex += 1;
      continue;
    }
    // 双宽模板要独占一整个跨页。若当前跨页已被上一页占了左半,先把那个跨页收掉
    // (它的右半留空),否则双宽页会被当成右半塞进去 —— 整本从这里开始错位。
    if (isSpreadTemplate(templateId)) {
      closePending();
      out.push({ spreadIndex, side: 'both' });
      spreadIndex += 1;
      continue;
    }
    if (!pendingLeft) {
      out.push({ spreadIndex, side: 'left' });
      pendingLeft = true;
    } else {
      out.push({ spreadIndex, side: 'right' });
      spreadIndex += 1;
      pendingLeft = false;
    }
  }

  return out;
}
```

- [ ] **Step 4: 运行，确认通过（第二条会 skip，Task 8 后转绿）**

Run: `pnpm --filter @yujee/web test 2>&1 | grep -A3 page-layout | head -20`
Expected: PASS（含 1 条 skip）。

- [ ] **Step 5: 把 `buildSpreads` 改由 `placePages` 派生**

改写 `apps/web/src/components/album/spreads.ts`。`Spread` 加 `full`，`buildSpreads` 整体替换：

```ts
import { getTemplate } from '@yujee/contracts/templates';
import { placePages } from './page-layout';
import type { EditorPage } from './types';

// Canvas model (docs/agent/template-redesign.md §4): every page lives on one
// canvas, but the head and tail each hold a solo single-page slot. cover pages
// and ending pages sit alone (outside the spread-pairing system); interior pages
// (toc + body) pair two-up. An odd trailing interior page gets a blank facing
// half. A spread holds array indices into `pages` (null = a blank half).
//
// 配对走查本身住在 page-layout.ts(唯一真相),这里只负责把它转成 Spread 形状。

export interface Spread {
  left: number | null;
  right: number | null;
  /** 双宽(spread)模板占满整个跨页时,它的页数组下标;此时 left/right 恒为 null。 */
  full?: number;
}

// cover / ending sit as solo pages; everything else (toc + interior body) pairs
// two-up. We collapse the category to that solo-vs-paired distinction here.
// Exported so the editor can label a spread by what it holds (封面/封底/内页)。
export function pageSlot(page: EditorPage): 'cover' | 'interior' | 'ending' {
  const category = getTemplate(page.templateId)?.category;
  if (category === 'cover') return 'cover';
  if (category === 'ending') return 'ending';
  return 'interior';
}

export function buildSpreads(pages: EditorPage[]): Spread[] {
  const placements = placePages(pages.map((p) => p.templateId));
  const spreads: Spread[] = [];
  placements.forEach((placement, pageArrayIndex) => {
    while (spreads.length <= placement.spreadIndex) {
      spreads.push({ left: null, right: null });
    }
    const spread = spreads[placement.spreadIndex]!;
    if (placement.side === 'both') spread.full = pageArrayIndex;
    else if (placement.side === 'left') spread.left = pageArrayIndex;
    else spread.right = pageArrayIndex;
  });
  return spreads;
}

// Which spread (index) holds a given page array index; -1 if not found.
export function spreadIndexOfPage(spreads: Spread[], pageArrayIndex: number): number {
  return spreads.findIndex(
    (s) => s.left === pageArrayIndex || s.right === pageArrayIndex || s.full === pageArrayIndex,
  );
}
```

`isSoloSpread` 保持原样，但在函数体最前面加一条早退（双宽页永远不是 solo）：

```ts
export function isSoloSpread(spread: Spread | undefined, pages: EditorPage[]): boolean {
  if (!spread) return false;
  // 双宽页占满整个跨页,不是「单页 leaf」—— 它要保持双页宽的容器。
  if (spread.full != null) return false;
  const hasLeft = spread.left != null;
  ...  // 以下逐字不变
```

- [ ] **Step 6: 运行既有 spreads 测试，确认全绿（回归基线）**

Run: `pnpm --filter @yujee/web test 2>&1 | grep -A5 "spreads" | head -30`
Expected: PASS —— `spreads.test.ts` 原有用例**一条不改**即通过，证明单页行为未变。

- [ ] **Step 7: 全量 web 测试 + typecheck**

Run: `pnpm --filter @yujee/web test 2>&1 | tail -15`
Expected: PASS
Run: `pnpm --filter @yujee/web typecheck`
Expected: 无错误。

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/album/page-layout.ts \
        apps/web/src/components/album/page-layout.test.ts \
        apps/web/src/components/album/spreads.ts
git commit -m "refactor(album): 左右页配对收敛到 placePages(),Spread 支持双宽页 #303"
```

---

### Task 4: 页码统一 —— 双页页吃两个号、贴两侧

**Files:**
- Modify: `apps/web/src/components/album/page-html-dom.ts:246-300`
- Create: `apps/web/src/components/album/page-folio.test.ts`
- Modify: `apps/web/src/lib/pdf/render-raster.ts:7, 116-129`
- Modify: `apps/web/src/lib/export/single-pages.ts:2, 36-46`
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`（`pageFolioNumbers` / `pageFolioSides` 的调用处）

**Interfaces:**
- Consumes: Task 3 的 `placePages()`
- Produces:
  - `type PageFolio = null | number | { left: number; right: number }`
  - `interface PageFolioInfo { folio: PageFolio; side: FolioSide }`
  - `function pageFolioInfos(templateIds: string[]): PageFolioInfo[]`
  - `applyFolioOverlay(html: string, folio: PageFolio, side?: FolioSide): string`
  - **删除** `pageFolioNumbers` 与 `pageFolioSides`（调用处全部改到 `pageFolioInfos`）

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/components/album/page-folio.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import { applyFolioOverlay, pageFolioInfos } from './page-html-dom';

const COVER = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.category === 'cover')!;
const SPREAD = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.spread === true);

test('cover carries no folio; interior numbers from 1 and sides follow the spread', () => {
  assert.deepEqual(pageFolioInfos([COVER, 'mag-03', 'mag-05']), [
    { folio: null, side: 'right' },
    { folio: 1, side: 'left' },
    { folio: 2, side: 'right' },
  ]);
});

test('a spread page eats two folio numbers and prints both sides', (t) => {
  if (!SPREAD) return t.skip('还没有 spread 模板(Task 8 会加 mag-54)');
  assert.deepEqual(pageFolioInfos([COVER, SPREAD, 'mag-03']), [
    { folio: null, side: 'right' },
    { folio: { left: 1, right: 2 }, side: 'left' },
    { folio: 3, side: 'left' },
  ]);
});

test('a dual folio injects two page numbers', () => {
  const html = '<div data-template="x"></div>';
  const out = applyFolioOverlay(html, { left: 4, right: 5 });
  assert.equal((out.match(/data-page-folio="true"/g) ?? []).length, 2);
  assert.ok(out.includes('>4</div>'));
  assert.ok(out.includes('>5</div>'));
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @yujee/web test 2>&1 | grep -A3 page-folio | head -20`
Expected: FAIL —— `pageFolioInfos is not a function`（该导出还不存在）。

- [ ] **Step 3: 改 `apps/web/src/components/album/page-html-dom.ts`**

删掉 `pageFolioNumbers`、`pageFolioSides` 两个函数与它们上方的注释块，
`FolioSide` 类型保留，替换为：

```ts
import { placePages } from './page-layout';

const NON_FOLIO_CATEGORIES = new Set(['cover', 'toc', 'ending']);

// 页签不再依赖烘进 html 的 folio 槽(重排页序后必然过期):展示层每次按当前页序
// 计算。封面/目录/封尾不编号。页签贴该页所在物理半页的外侧下角(左页→左下,
// 右页→右下);双宽(spread)页占满整个跨页,故一页吃掉两个号、左下右下各贴一个。
// 侧别一律按 placePages 的真实版面推 ——「奇偶」不等于左右,有没有目录页会整体
// 错位一位。

export type FolioSide = 'left' | 'right';

/** 一页的页码:null=不编号;number=单页一个号;{left,right}=双宽页吃掉的两个号。 */
export type PageFolio = null | number | { left: number; right: number };

export interface PageFolioInfo {
  folio: PageFolio;
  /** 单页页贴哪一侧;双宽页(folio 为对象)时该值无意义,两侧都贴。 */
  side: FolioSide;
}

/** 按当前页序算出每页的页码与贴边。左右页配对走 placePages(唯一真相)。 */
export function pageFolioInfos(templateIds: string[]): PageFolioInfo[] {
  const placements = placePages(templateIds);
  let n = 0;
  return templateIds.map((id, i) => {
    const placement = placements[i]!;
    const category = getTemplate(id)?.category;
    const side: FolioSide = placement.side === 'right' ? 'right' : 'left';
    if (category && NON_FOLIO_CATEGORIES.has(category)) {
      return { folio: null, side };
    }
    if (placement.side === 'both') {
      const left = n + 1;
      const right = n + 2;
      n += 2;
      return { folio: { left, right }, side };
    }
    n += 1;
    return { folio: n, side };
  });
}
```

- [ ] **Step 4: 让 `applyFolioOverlay` 接受 `PageFolio`**

把 `applyFolioOverlay` 整体替换为：

```ts
const FOLIO_ANCHOR_OPEN_RE = /<([a-z0-9]+)((?:[^>]*?)data-text-key="folio(?:\[\d+\])?"[^>]*)>/gi;

function folioMarkup(value: number, side: FolioSide): string {
  const edge = side === 'left' ? 'left:36px' : 'right:36px';
  return (
    `<div data-page-folio="true" style="position:absolute;${edge};bottom:26px;` +
    `font-size:12px;letter-spacing:0.12em;color:#a09b8e;` +
    `font-family:'Inter','Noto Sans SC',sans-serif;pointer-events:none">${value}</div>`
  );
}

/** 展示层页签:隐藏模板遗留 folio 元素;folio 非 null 时在对应侧下角注入统一页码。
 *  双宽页(folio 为 {left,right})左下右下各注入一个。 */
export function applyFolioOverlay(
  html: string,
  folio: PageFolio,
  side: FolioSide = 'right',
): string {
  let out = html.replace(FOLIO_ANCHOR_OPEN_RE, (_full, tag: string, attrs: string) => {
    const nextAttrs = attrs.includes('style="')
      ? attrs.replace('style="', 'style="display:none;')
      : `${attrs} style="display:none"`;
    return `<${tag}${nextAttrs}>`;
  });
  const overlay =
    folio === null
      ? ''
      : typeof folio === 'number'
        ? folioMarkup(folio, side)
        : folioMarkup(folio.left, 'left') + folioMarkup(folio.right, 'right');
  if (overlay) {
    const closeAt = out.lastIndexOf('</div>');
    if (closeAt >= 0) out = out.slice(0, closeAt) + overlay + out.slice(closeAt);
  }
  return out;
}
```

- [ ] **Step 5: 改三处调用点**

`apps/web/src/lib/pdf/render-raster.ts` —— 第 7 行 import 换成 `pageFolioInfos`（去掉 `pageFolioNumbers, pageFolioSides`），
`FaceRenderOptions.folio` 类型由 `number | null` 改为 `PageFolio`，
并把 `renderAlbumPdfRaster` 里的两行换成：

```ts
  // 页签按导出页序计算(内页 1..N;封面/封尾/目录 null),与画板同一套覆盖层。
  const folioInfos = pageFolioInfos(pages.map((p) => p.templateId));
```

循环内：

```ts
    const canvas = await renderFaceToCanvas(pages[i]!, resolveImage, {
      scale, total,
      folio: folioInfos[i]?.folio ?? null,
      folioSide: folioInfos[i]?.side ?? 'right',
    });
```

`apps/web/src/lib/export/single-pages.ts` —— 同样把 `pageFolioNumbers`/`pageFolioSides`
两次调用换成一次 `const folioInfos = pageFolioInfos(pages.map((p) => p.templateId));`，
循环内 `folio: folioInfos[i]?.folio ?? null, folioSide: folioInfos[i]?.side ?? 'right'`。

`apps/web/src/components/album/editor-v2/EditorPort.tsx` —— 用
`grep -n "pageFolioNumbers\|pageFolioSides" apps/web/src/components/album/editor-v2/EditorPort.tsx`
定位全部调用点，按同一模式换成 `pageFolioInfos`。

- [ ] **Step 6: 运行全量测试 + typecheck**

Run: `pnpm --filter @yujee/web test 2>&1 | tail -15`
Expected: PASS（page-folio 第二条 skip）
Run: `pnpm --filter @yujee/web typecheck`
Expected: 无错误 —— typecheck 是这一步的主要护栏，会揪出漏改的调用点。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/album/page-html-dom.ts \
        apps/web/src/components/album/page-folio.test.ts \
        apps/web/src/lib/pdf/render-raster.ts apps/web/src/lib/export/single-pages.ts \
        apps/web/src/components/album/editor-v2/EditorPort.tsx
git commit -m "refactor(album): 页码合并为 pageFolioInfos,双宽页吃两号贴两侧 #303"
```

---

### Task 5: 渲染面改按 `pageBox()` 开盒

**Files:**
- Modify: `apps/web/src/components/album/templates/web-utils.tsx:11-29`
- Modify: `apps/web/src/components/album/templates/constants.ts:2`
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx:1271-1285`（`faceHTML`）与 `:1430-1447`（离屏盒）
- Modify: `apps/web/src/components/album/FlipBook.tsx:86-95`
- Modify: `apps/web/src/components/album/PagePreview.tsx:37-50`
- Modify: `apps/web/src/lib/photo/candidate-thumbnail.tsx:61, 169, 192, 214`

**Interfaces:**
- Consumes: Task 1 的 `pageBox(templateId)`
- Produces: `WebPage` 新增可选 prop `templateId?: string`；不传时行为与今天完全一致（A4）

- [ ] **Step 1: 转发壳补出口**

`apps/web/src/components/album/templates/constants.ts` 改为：

```ts
// 迁至 @yujee/contracts/render(C 方案:渲染簇共享);此壳保持既有 import 不破。
export { COLORS, WEB_FONTS, PDF_FONTS, PAGE, fitDisplayFontSize } from '@yujee/contracts/render';
export { pageBox, isSpreadTemplate, type PageBox } from '@yujee/contracts/render';
```

- [ ] **Step 2: `WebPage` 支持双宽**

`apps/web/src/components/album/templates/web-utils.tsx`：把 import 行改成
`import { COLORS, PAGE, WEB_FONTS, pageBox } from './constants';`，并替换 `WebPage`：

```tsx
interface WebPageProps {
  children: ReactNode;
  dark?: boolean;
  fontFamily?: string;
  className?: string;
  // 跨页(#303):传入则按该模板的画布尺寸开盒(spread 模板双宽)。
  // 不传 = A4,与改动前逐像素一致 —— 现有模板一律不传。
  templateId?: string;
}

export function WebPage({ children, dark, fontFamily, className, templateId }: WebPageProps) {
  const box = templateId ? pageBox(templateId) : { width: PAGE.width, height: PAGE.height };
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: box.width,
        height: box.height,
        background: dark ? COLORS.ink : '#FFFFFF',
        color: dark ? COLORS.paper : COLORS.ink,
        overflow: 'hidden',
        boxSizing: 'border-box',
        fontFamily: fontFamily ?? WEB_FONTS.sansEn,
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: `faceHTML` 与离屏盒按模板开盒**

`EditorPort.tsx:1271-1285` 的 `faceHTML` 替换为：

```tsx
    // The page (A4, or double-wide for a spread template) scaled to fill the
    // given box (matches FlipBook PageFace).
    function faceHTML(
      page: EditorPage | null,
      boxW: number,
      boxH: number,
      resolve: ResolveImage = resolveImage,
    ): string {
      const box = page ? pageBox(page.templateId) : { width: PAGE.width, height: PAGE.height };
      const scale = Math.min(boxW / box.width, boxH / box.height) || 1;
      return (
        `<div style="width:${boxW}px;height:${boxH}px;overflow:hidden;background:#fff">` +
        `<div style="transform:scale(${scale});transform-origin:top left;width:${box.width}px;height:${box.height}px">` +
        faceInner(page, resolve) +
        `</div></div>`
      );
    }
```

`EditorPort.tsx:1425-1447` 的离屏截图盒同理。该块开头已有
`const page = pageByIndex(pageIndex);`，在它的 `if (!page) throw` 之后插入一行：

```tsx
      const box = pageBox(page.templateId);
```

然后把这三处写死的尺寸换掉：`host.style.cssText` 里的 `${PAGE.width}px`/`${PAGE.height}px`
→ `${box.width}px`/`${box.height}px`；`html2canvas(host, { width: PAGE.width, height: PAGE.height, ... })`
→ `{ width: box.width, height: box.height, ... }`。

并在文件 import 区把 `PAGE` 的 import 补上 `pageBox`。

- [ ] **Step 4: FlipBook / PagePreview / candidate-thumbnail 同样处理**

三个文件都是同一套改法：拿到该 face 的 `templateId` → `const box = pageBox(templateId)` →
把 `PAGE.width` 换成 `box.width`、`PAGE.height` 换成 `box.height`。
`candidate-thumbnail.tsx:112` 的 `pageLongEdge` 改为 `Math.max(box.width, box.height)`。

> `candidate-thumbnail.tsx` 是 **LLM 评委看图选排版方案**的输入。这里渲错，
> 评委就选错，错误一路传导到成品——本任务里它优先级最高，务必人工看一眼产出图。

`AlbumCoverPreview.tsx` **不动**：封面永远是 cover 类，不可能是 spread。

- [ ] **Step 5: 运行全量测试 + typecheck**

Run: `pnpm --filter @yujee/web test 2>&1 | tail -15`
Expected: PASS
Run: `pnpm --filter @yujee/web typecheck`
Expected: 无错误。

- [ ] **Step 6: 目视回归（关键）**

Run: `pnpm --filter @yujee/web dev --turbo`
打开 `/zh/dev/template-check`，确认现有模板卡片渲染与改动前**一模一样**。

> 本地 dev 必须带 `--turbo`（webpack 在中文路径下会死锁）。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/album/templates/web-utils.tsx \
        apps/web/src/components/album/templates/constants.ts \
        apps/web/src/components/album/editor-v2/EditorPort.tsx \
        apps/web/src/components/album/FlipBook.tsx \
        apps/web/src/components/album/PagePreview.tsx \
        apps/web/src/lib/photo/candidate-thumbnail.tsx
git commit -m "feat(album): 渲染面按 pageBox() 开盒,支持双宽页 #303"
```

---

### Task 6: 编辑器画板把双宽页画成一整个跨页

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx:1860-1901`（`paintSpread`）
- Modify: `apps/web/src/components/album/editor-v2/editor-port.css`
- Create: `apps/web/src/components/album/editor-v2/spread-full-page.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `Spread.full`、Task 5 的 `pageBox`
- Produces: 画板上双宽页占满左右两个 cell，中缝线隐藏

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/components/album/editor-v2/spread-full-page.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('./editor-port.css', import.meta.url), 'utf8');
const PORT = readFileSync(new URL('./EditorPort.tsx', import.meta.url), 'utf8');

// 双宽页占满整个跨页:右 cell 退场(左 cell flex:1 自动撑满)、中缝线隐藏。
test('book-full collapses the empty half and the spine', () => {
  assert.match(CSS, /\.book\.book-full \.page\.page-empty\{[^}]*display:none/);
  assert.match(CSS, /\.book\.book-full::before\{[^}]*display:none/);
});

test('paintSpread toggles book-full from Spread.full', () => {
  assert.match(PORT, /classList\.toggle\('book-full',\s*spreads\[i\]\?\.full != null\)/);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @yujee/web test 2>&1 | grep -A3 spread-full | head -20`
Expected: FAIL —— CSS/TSX 里都还没有 `book-full`。

- [ ] **Step 3: 加 CSS**

在 `editor-port.css` 的 `.book.book-single` 规则块（约 `:167-174`）之后追加：

```css
/* 跨页(#303):双宽模板占满整个跨页。paintSpread 把它画进左 cell 并让右 cell 变
   page-empty —— 这里让空的那半退场,左 cell 的 flex:1 自动撑满全宽(与 book-single
   同一手法)。中缝线(.book::before)必须隐藏:版面本来就是连续的一张,中间不该有分隔。 */
.editor-port .book.book-full .page.page-empty{ display:none; }
.editor-port .book.book-full::before{ display:none; }
```

> 中缝不是独立元素,是 `.book::before` 伪元素（`editor-port.css:114-120`）。
> 页 cell 是 `.page.page-left#pageLeft` / `.page.page-right#pageRight`，`.page{flex:1}`。

- [ ] **Step 4: 改 `paintSpread`**

在 `EditorPort.tsx:1860` 的 `paintSpread` 里，`spreadPages(i)` 之后加上双宽分支。
把开头几行改为：

```tsx
    function paintSpread(i: number) {
      // 收集态没有版式页;画板走照片网格(renderCollectGrid),不画空版式书。
      if (isCollectMode) return;
      const fullIdx = spreads[i]?.full ?? null;
      // 双宽页占满整个跨页:它画在左 cell 里(CSS 把左 cell 撑成全宽、右 cell 退场)。
      const [lp, rp] = fullIdx != null
        ? [pagesState[fullIdx] ?? null, null]
        : spreadPages(i);
      bookEl.classList.toggle('book-full', spreads[i]?.full != null);
      pageLeft.classList.toggle('page-empty', lp === null);
      pageRight.classList.toggle('page-empty', rp === null);
      // 双宽页没有中缝,不能按「有一半是空」去掉中缝 —— book-full 时中缝已由 CSS 隐藏。
      bookEl.classList.toggle('book-solo', fullIdx == null && (lp === null || rp === null));
      bookEl.classList.toggle('book-single', isSoloSpread(spreads[i], pagesState));
      // 以下逐字不变
      paintEl(pageLeft, lp);
      paintEl(pageRight, rp);
```

- [ ] **Step 5: 运行，确认通过**

Run: `pnpm --filter @yujee/web test 2>&1 | grep -A3 spread-full | head -20`
Expected: PASS
Run: `pnpm --filter @yujee/web test 2>&1 | tail -15`
Expected: 全量 PASS（`spread-page-padding.test.ts`、`flipbook-solo.test.ts` 等既有回归不能挂）

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/album/editor-v2/EditorPort.tsx \
        apps/web/src/components/album/editor-v2/editor-port.css \
        apps/web/src/components/album/editor-v2/spread-full-page.test.ts
git commit -m "feat(editor): 画板把双宽页画成一整个跨页 #303"
```

---

### Task 7: PDF 把双宽页切成两页 A4

**Files:**
- Modify: `apps/web/src/lib/pdf/render-raster.ts:100-135`
- Create: `apps/web/src/lib/pdf/split-spread-canvas.ts`
- Create: `apps/web/src/lib/pdf/split-spread-canvas.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isSpreadTemplate`、Task 4 的 `pageFolioInfos`
- Produces: `function splitSpreadCanvas(canvas: HTMLCanvasElement): [HTMLCanvasElement, HTMLCanvasElement]`

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/lib/pdf/split-spread-canvas.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { splitBox } from './split-spread-canvas';

// 纯几何,不依赖 DOM:双宽画布从正中切两半,左右各占一半宽、全高。
test('splitBox halves the width and keeps the height', () => {
  assert.deepEqual(splitBox(1588, 1123), [
    { sx: 0, sy: 0, sw: 794, sh: 1123 },
    { sx: 794, sy: 0, sw: 794, sh: 1123 },
  ]);
});

test('splitBox handles an odd width without losing a column', () => {
  const [left, right] = splitBox(1589, 1123);
  assert.equal(left.sw + right.sw, 1589);
  assert.equal(right.sx, left.sw);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @yujee/web test 2>&1 | grep -A3 split-spread | head -20`
Expected: FAIL —— `Cannot find module './split-spread-canvas'`。

- [ ] **Step 3: 写 `apps/web/src/lib/pdf/split-spread-canvas.ts`**

```ts
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
  const boxes = splitBox(canvas.width, canvas.height);
  return boxes.map((box) => {
    const out = document.createElement('canvas');
    out.width = box.sw;
    out.height = box.sh;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(canvas, box.sx, box.sy, box.sw, box.sh, 0, 0, box.sw, box.sh);
    return out;
  }) as [HTMLCanvasElement, HTMLCanvasElement];
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @yujee/web test 2>&1 | grep -A3 split-spread | head -20`
Expected: PASS

- [ ] **Step 5: 接进 `renderAlbumPdfRaster`**

`render-raster.ts` 顶部加 import：

```ts
import { isSpreadTemplate } from '@yujee/contracts/render';
import { splitSpreadCanvas } from './split-spread-canvas';
```

把 `renderAlbumPdfRaster` 的循环体替换为：

```ts
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const canvas = await renderFaceToCanvas(page, resolveImage, {
      scale, total,
      folio: folioInfos[i]?.folio ?? null,
      folioSide: folioInfos[i]?.side ?? 'right',
    });
    // 双宽页切成左右两张 A4 依次写入 —— PDF 保持纯竖版,可直送印刷。
    const faces = isSpreadTemplate(page.templateId) ? splitSpreadCanvas(canvas) : [canvas];
    for (const face of faces) {
      const img = face.toDataURL('image/jpeg', jpegQuality);
      if (!first) doc.addPage([PAGE.width, PAGE.height], 'portrait');
      first = false;
      doc.addImage(img, 'JPEG', 0, 0, PAGE.width, PAGE.height);
    }
    options.onProgress?.(i + 1, total);
  }
```

并在循环前加 `let first = true;`（替代原来的 `if (i > 0)` 判断——双宽页会让页序与 `i` 脱钩）。

- [ ] **Step 6: 运行全量测试 + typecheck**

Run: `pnpm --filter @yujee/web test 2>&1 | tail -15`
Expected: PASS
Run: `pnpm --filter @yujee/web typecheck`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/pdf/split-spread-canvas.ts \
        apps/web/src/lib/pdf/split-spread-canvas.test.ts \
        apps/web/src/lib/pdf/render-raster.ts
git commit -m "feat(export): 双宽页 PDF 切成两页 A4 #303"
```

---

### Task 8: 首个跨页模板 mag-54（机制端到端验证）

**Files:**
- Create: `packages/contracts/templates/mag-54.json`
- Create: `apps/web/src/components/album/templates/mag-54/index.tsx`
- Modify: `apps/web/src/components/album/web-registry.ts`
- Create: `packages/contracts/src/render/html-templates/mag-54.ts`
- Modify: `packages/contracts/src/render/html-templates/registry.ts`

**Interfaces:**
- Consumes: Task 1-7 全部
- Produces: `mag-54` —— 一张通栏大图横穿中缝，左页压标题。Task 3/4 里被 skip 的两条用例自动转绿。

> **注意**：模板一旦注册，engine 就可能在生产里选中它。所以 mag-54 必须是一个
> **真能见人的版式**，不是占位测试件。它只有 1 个图槽 + 1 个标题槽，属于
> `POOLS[interior][1]`，会和 mag-03 等单图模板竞争。

- [ ] **Step 1: 写模板 JSON**

Create `packages/contracts/templates/mag-54.json`：

```json
{
  "id": "mag-54",
  "category": "interior",
  "spread": true,
  "images": [
    { "id": "image1", "orientation": ["landscape"], "quality": ["hero"] }
  ],
  "texts": [
    { "id": "title", "role": "title", "lang": "user", "variableDecor": true, "sample": "那一天" }
  ]
}
```

- [ ] **Step 2: 生成契约并确认 spread 落进 generated**

Run: `pnpm templates:generate && grep -n "mag-54" -A4 packages/contracts/src/templates.generated.ts | head -12`
Expected: 能看到 `spread: true`。

- [ ] **Step 3: 写 React 组件**

Create `apps/web/src/components/album/templates/mag-54/index.tsx`：

```tsx
import type { TemplateRenderProps } from '../types';
import { pageBox } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// mag-54(#303 首个跨页模板):通栏满版大图横穿中缝,左半页下方压一行大标题。
// 画布 1588×1123(双宽,PAGE.width*2)。中缝落在 x=794 —— 装订会吃掉中缝附近一点,
// 别把关键信息放进 x∈[750,840];本版式标题在 x=96 起,安全。
const BOX = pageBox('mag-54');
const PAPER = '#f7f4ec';

export function WebMag54({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || '';
  // 槽 title 是 variableDecor,颜色/字体由主题刷;role 从契约查,不写死。
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-54', 'title'));
  return (
    <div style={{ position: 'relative', width: BOX.width, height: BOX.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 通栏满版大图（槽 image1），横穿中缝 */}
      <WebImage
        src={d['image1']}
        style={{ position: 'absolute', left: 0, top: 0, width: BOX.width, height: BOX.height, objectFit: 'cover' }}
        position={imagePos?.['image1']}
        slotId="image1"
      />
      {/* 左半页压标题（槽 title，variableDecor） */}
      <div
        data-text-key="title"
        style={{
          position: 'absolute', left: 96, bottom: 104, width: 560,
          fontFamily: titleTheme.webFontFamily,
          fontSize: 56, lineHeight: 1.28, letterSpacing: '0.04em',
          color: titleTheme.accentColor ?? PAPER,
          textShadow: '0 2px 24px rgba(0,0,0,.45)',
        }}
      >
        {title}
      </div>
    </div>
  );
}
```

> 结构照抄 `apps/web/src/components/album/templates/mag-51/index.tsx`（同为 1 图 + variableDecor 标题）。
> 区别只有两点：根盒用 `BOX`（双宽）而非 `PAGE`，图槽满版。

- [ ] **Step 4: 登记进 web-registry**

`apps/web/src/components/album/web-registry.ts`：
import 区加 `import { WebMag54 } from './templates/mag-54';`，
`WEB_TEMPLATE_REGISTRY` 对象最前面加 `'mag-54': WebMag54,`。

- [ ] **Step 5: 跑注册一致性测试，确认只差 HTML 一处**

Run: `pnpm --filter @yujee/web test 2>&1 | grep -A5 registry-parity | head -20`
Expected: PASS（JSON 与 React 已对齐）

- [ ] **Step 6: 写 HTML 模板**

Create `packages/contracts/src/render/html-templates/mag-54.ts`，导出 `MAG_54_HTML`，
按 `html-templates/README.md` 的锚点契约镜像上面的 React 版：
根节点 `<div data-template="mag-54" style="position:relative;width:1588px;height:1123px;...">`，
图槽容器与 `<img>` 都带 `data-image-slot="image1"`、`src="{{IMG_SRC:image1}}"`、
`object-position:{{IMG_POS:image1|50% 50%}}`、style 末尾拼 `{{IMG_TF:image1}}`，
标题元素带 `data-text-key="title" data-variable-decor`、内容 `{{TEXT:title}}`、
颜色 `{{COLOR:title|#F7F4EC}}`、字体 `{{FONT:title|...}}`。

登记进 `registry.ts`（import + 映射表两处）。

- [ ] **Step 7: 单模板自验 + 全量校验**

Run: `cd packages/contracts && pnpm tsx scripts/lint-one-html-template.ts mag-54`
Expected: 通过
Run: `pnpm templates:check && pnpm template-previews:check`
Expected: 通过

- [ ] **Step 8: 修 engine 里写死的模板数量断言**

`engine/tests/test_template_loader.py` 的 `test_loader_reads_shared_template_json_count`
里有一行写死的 `assert len(json_files) == 43`。mag-54 让它变成 44：

```python
    assert len(json_files) == 44
```

> 这是本任务唯一会「无辜挂掉」的既有测试。别把它当回归失败绕过去，
> 就是要改这个数字——它的作用正是逼你在加模板时看一眼总数。

- [ ] **Step 9: engine 能加载新模板**

Run: `cd engine && .venv/bin/python -m pytest tests/ -q 2>&1 | tail -10`
Expected: PASS —— 证明 Python 双镜像认得 `spread`，且 mag-54 正常进 `POOLS[interior][1]`。

- [ ] **Step 10: 之前 skip 的用例转绿**

Run: `pnpm --filter @yujee/web test 2>&1 | tail -15`
Expected: 全量 PASS，且 `page-layout.test.ts` / `page-folio.test.ts` 里原本 skip 的两条现在真正执行并通过。

- [ ] **Step 11: 目视验收（人工，必须做）**

Run: `pnpm --filter @yujee/web dev --turbo`
打开 `/zh/dev/template-check`，确认：
1. mag-54 卡片是双宽的，大图通栏，标题在左半页
2. 其它模板卡片与改动前一致
3. 导出一次 PDF，确认 mag-54 变成两页 A4 且从中间接得上

- [ ] **Step 12: Commit**

```bash
git add packages/contracts/templates/mag-54.json packages/contracts/src/templates.generated.ts \
        apps/web/src/components/album/templates/mag-54/ apps/web/src/components/album/web-registry.ts \
        packages/contracts/src/render/html-templates/mag-54.ts \
        packages/contracts/src/render/html-templates/registry.ts \
        engine/tests/test_template_loader.py
git commit -m "feat(templates): mag-54 首个跨页模板(通栏大图) #303"
```

---

## 验收

全绿即完工：

```bash
pnpm typecheck
pnpm --filter @yujee/web test
cd engine && .venv/bin/python -m pytest -q
```

外加两条**人工**验收，测试覆盖不到：
1. `/zh/dev/template-check` 目视：老模板逐像素不变、mag-54 通栏正确
2. 导出 PDF：mag-54 切成两页 A4，中缝接得上，页码左下右下各一个

## 明确不做（YAGNI）

- 场景识别 / 婚纱字体配色 / 婚纱选图排序
- 线上画板的「换版式」面板
- `EditorPort.tsx`（4685 行）与 `editor-port.css`（2203 行）的重构
- 启用 `TemplatePairing`
- 印刷出血位 / 拼版（imposition）
- 婚纱版式批量上架 —— 等用户给 Figma fileKey 后另起一轮，走 Task 8 同一套流程
