# Mobile Two-Page Flipbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile album preview a fixed two-page flipbook with consistent physical page sizing, paper shadows, a left-opening cover, and a right-opening ending page.

**Architecture:** Keep the existing mobile React preview tree and pure flip helpers. Fix the `MobileEditor` caller to density 2, calculate one canonical two-page book box for every screen, extend the pure transition model for the two explicitly supported solo-page transitions, and render those transitions through the existing 3D leaf DOM.

**Tech Stack:** React 19, TypeScript, Node test runner through `tsx --test`, CSS 3D transforms.

## Global Constraints

- The change applies only to the mobile preview; desktop `FlipBook` remains unchanged.
- Do not add a third-party flipbook dependency.
- Do not change page data, templates, backend APIs, persistence, or exports.
- Keep cover and ending pages the same physical single-page size as an interior leaf.
- Cover opens left only when moving forward into the body.
- Ending opens right only when moving backward into the body.
- Respect `prefers-reduced-motion` by switching directly.
- Preserve full-width spread templates and odd trailing interior blank-half semantics.
- Preserve the user's unrelated working-tree changes.

---

### Task 1: Lock Mobile Browse Mode to One Two-Page Spread

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/mobile-editor.test.ts`

**Interfaces:**
- Consumes: `browseScreen`, `browseUnits`, `stepScreen`, and `screenStartOfPage` with density `2`.
- Produces: `MOBILE_BROWSE_DENSITY = 2` as the single mobile browse density and a canonical `bookBox` whose half-width is the physical page width.

- [ ] **Step 1: Write failing component-source tests**

Add these assertions to `mobile-editor.test.ts`:

```ts
test('浏览态固定双页:不再渲染 1/2/4 密度按钮', () => {
  const html = render();
  assert.equal(html.includes('aria-label="一屏几页"'), false);
  assert.equal(html.includes('aria-label="Pages per screen"'), false);
  const src = source('MobileEditor.tsx');
  assert.match(src, /const MOBILE_BROWSE_DENSITY = 2 as const/);
  assert.doesNotMatch(src, /cycleDensity|setDensity|useState<Density>/);
});

test('封面封尾与正文共用同一个物理单页尺寸', () => {
  const src = source('MobileEditor.tsx');
  assert.match(src, /const bookBox = fitBox\(availW, availH, spreadAspect\(2\)\)/);
  assert.match(src, /resting\.wide === 1[\s\S]{0,120}bookBox\.w \/ 2/);
  assert.doesNotMatch(
    src,
    /fitBox\(availW,\s*rowH,\s*spreadAspect\(resting\.wide\)\)/,
    '按每屏宽度各自 fit 会让独页比正文单页更大',
  );
});
```

Update the existing skeleton and control tests so they expect `data-density="2"` but only the board-background FAB.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd apps/web
pnpm exec tsx --test src/components/album/editor-v2/mobile/mobile-editor.test.ts
```

Expected: FAIL because `cycleDensity`, the density button, and per-layout `fitBox` are still present.

- [ ] **Step 3: Implement the fixed density and canonical book box**

In `MobileEditor.tsx`:

```ts
import { type Density } from '../mobile-canvas';

const MOBILE_BROWSE_DENSITY = 2 as const satisfies Density;
```

Remove the density state and replace all browse-mode density arguments with `MOBILE_BROWSE_DENSITY`. Keep edit-mode `stepScreen(..., 1, dir)` unchanged.

Replace the per-row/per-layout sizing with:

```ts
const availW = Math.max(0, area.w - INSET * 2);
const availH = Math.max(0, area.h - INSET * 2);
const bookBox = fitBox(availW, availH, spreadAspect(2));
```

Inside the spread render:

```ts
const box =
  resting.wide === 1
    ? { w: bookBox.w / 2, h: bookBox.h }
    : bookBox;
```

Remove the density FAB and keep only:

```tsx
<div className="mfab-col">
  <button
    type="button"
    className="mfab"
    aria-label={zh ? '画板背景' : 'Board background'}
    onClick={onBoardBg}
  >
    <IconBoardBg className="mfab-ic" />
  </button>
</div>
```

- [ ] **Step 4: Run the targeted tests and verify GREEN**

Run:

```bash
cd apps/web
pnpm exec tsx --test \
  src/components/album/editor-v2/mobile/mobile-editor.test.ts \
  src/components/album/editor-v2/mobile/browse-window.test.ts \
  src/components/album/editor-v2/mobile/fit-box.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add \
  apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx \
  apps/web/src/components/album/editor-v2/mobile/mobile-editor.test.ts
git commit -m "feat(editor): fix mobile preview to two pages"
```

### Task 2: Model Supported Cover and Ending Transitions

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/mobile/flip.ts`
- Modify: `apps/web/src/components/album/editor-v2/mobile/flip.test.ts`

**Interfaces:**
- Consumes: `FlipDir`, `ScreenShape`, and the shared `shouldDirectSwitch` fallback.
- Produces:
  - `SoloRole = 'cover' | 'ending' | null`
  - `FlipTransition = 'spread' | 'cover-open' | 'ending-open'`
  - `flipTransition(from, to, dir, reducedMotion): FlipTransition | null`
  - `centeredSoloGeometry(transition): LeafGeometry`
  - `centeredSoloLayers(from, to): LeafLayers`

- [ ] **Step 1: Write failing pure-function tests**

Replace the old “solo always hard-switches” expectation and add:

```ts
test('封面只在前进到正文时向左翻', () => {
  assert.equal(flipTransition(cover(), pair(), 'next', false), 'cover-open');
  assert.equal(flipTransition(cover(), pair(), 'prev', false), null);
  assert.equal(flipTransition(pair(), cover(), 'prev', false), null);
});

test('封尾只在返回正文时向右翻', () => {
  assert.equal(flipTransition(ending(), pair(), 'prev', false), 'ending-open');
  assert.equal(flipTransition(ending(), pair(), 'next', false), null);
  assert.equal(flipTransition(pair(), ending(), 'next', false), null);
});

test('独页特殊翻页仍尊重减弱动效和双宽页边界', () => {
  assert.equal(flipTransition(cover(), pair(), 'next', true), null);
  assert.equal(flipTransition(ending(), pair(), 'prev', true), null);
  assert.equal(flipTransition(cover(), full(), 'next', false), null);
});

test('居中独页保持半本书宽,封面向左、封尾向右', () => {
  assert.deepEqual(centeredSoloGeometry('cover-open'), {
    leftFrac: 0.25,
    widthFrac: 0.5,
    origin: 'left center',
    endAngle: -180,
  });
  assert.deepEqual(centeredSoloGeometry('ending-open'), {
    leftFrac: 0.25,
    widthFrac: 0.5,
    origin: 'right center',
    endAngle: 180,
  });
});

test('独页翻开时正文跨页在底层,独页本身是纸片正面', () => {
  assert.deepEqual(centeredSoloLayers([0], [1, 2]), {
    under: [1, 2],
    front: 0,
    back: null,
  });
});
```

Update the test helpers so cover and ending carry distinct `soloRole` values.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd apps/web
pnpm exec tsx --test src/components/album/editor-v2/mobile/flip.test.ts
```

Expected: FAIL because the new transition functions and solo roles do not exist.

- [ ] **Step 3: Implement the transition model**

In `flip.ts`, evolve `ScreenShape` and add:

```ts
export type SoloRole = 'cover' | 'ending' | null;
export type FlipTransition = 'spread' | 'cover-open' | 'ending-open';

export type ScreenShape = {
  rows: number;
  faces: number;
  soloRole: SoloRole;
  full: boolean;
};

export function flipTransition(
  from: ScreenShape,
  to: ScreenShape,
  dir: FlipDir,
  reducedMotion: boolean,
): FlipTransition | null {
  if (reducedMotion || from.rows !== 1 || to.rows !== 1 || from.full || to.full) return null;
  if (from.soloRole === 'cover' && to.soloRole === null && to.faces === 2 && dir === 'next') {
    return 'cover-open';
  }
  if (from.soloRole === 'ending' && to.soloRole === null && to.faces === 2 && dir === 'prev') {
    return 'ending-open';
  }
  if (
    shouldDirectSwitch(
      false,
      from.soloRole !== null,
      to.soloRole !== null,
      false,
      false,
    )
  ) {
    return null;
  }
  if (from.faces !== to.faces) return null;
  return from.faces === 1 || from.faces === 2 ? 'spread' : null;
}

export function centeredSoloGeometry(
  transition: Exclude<FlipTransition, 'spread'>,
): LeafGeometry {
  return transition === 'cover-open'
    ? { leftFrac: 0.25, widthFrac: 0.5, origin: 'left center', endAngle: -180 }
    : { leftFrac: 0.25, widthFrac: 0.5, origin: 'right center', endAngle: 180 };
}

export function centeredSoloLayers(
  from: (number | null)[],
  to: (number | null)[],
): LeafLayers {
  return { under: to, front: from[0] ?? null, back: null };
}
```

Remove `canFlip`; callers must use `flipTransition` so they know which geometry and layers to render.

- [ ] **Step 4: Run the pure tests and verify GREEN**

Run:

```bash
cd apps/web
pnpm exec tsx --test \
  src/components/album/editor-v2/mobile/flip.test.ts \
  src/components/album/spreads.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add \
  apps/web/src/components/album/editor-v2/mobile/flip.ts \
  apps/web/src/components/album/editor-v2/mobile/flip.test.ts
git commit -m "feat(editor): model mobile cover and ending flips"
```

### Task 3: Render Solo Flips and Paper Projection

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/mobile-editor.css`
- Modify: `apps/web/src/components/album/editor-v2/mobile/mobile-editor.test.ts`

**Interfaces:**
- Consumes: `flipTransition`, `centeredSoloGeometry`, `centeredSoloLayers`, `pageSlot`, and the canonical `bookBox`.
- Produces: a single 3D leaf render path that supports ordinary spreads plus the two approved centered-solo transitions.

- [ ] **Step 1: Write failing integration and style tests**

Add to `mobile-editor.test.ts`:

```ts
test('封面和封尾通过角色明确的特殊翻页接入现有纸片层', () => {
  const src = source('MobileEditor.tsx');
  assert.match(src, /pageSlot\(/);
  assert.match(src, /flipTransition\(fromShape, toShape, d, reducedMotion\)/);
  assert.match(src, /centeredSoloGeometry\(anim\.transition\)/);
  assert.match(src, /centeredSoloLayers\(resting\.faces, toLayout\.faces\)/);
  assert.match(src, /data-solo-transition=/);
});

test('纸张具有接触投影、环境投影、纸边高光和翻页投影', () => {
  const css = source('mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const spreadAt = css.indexOf('.mobile-editor .mspread {');
  const spreadRule = css.slice(spreadAt, css.indexOf('}', spreadAt));
  assert.match(spreadRule, /0 2px 5px/);
  assert.match(spreadRule, /0 18px 42px/);
  const pageAt = css.indexOf('.mobile-editor .mpage {');
  const pageRule = css.slice(pageAt, css.indexOf('}', pageAt));
  assert.match(pageRule, /inset 0 0 0 1px/);
  const leafAt = css.indexOf('.mobile-editor .mleaf {');
  const leafRule = css.slice(leafAt, css.indexOf('}', leafAt));
  assert.match(leafRule, /filter:\s*drop-shadow/);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd apps/web
pnpm exec tsx --test \
  src/components/album/editor-v2/mobile/mobile-editor.test.ts \
  src/components/album/editor-v2/mobile/flip.test.ts
```

Expected: FAIL because the component still uses `canFlip` and the CSS lacks the new projection tokens.

- [ ] **Step 3: Integrate the transition model in `MobileEditor`**

Import `pageSlot`, `flipTransition`, `centeredSoloGeometry`, and `centeredSoloLayers`.

Have `shapeOf` identify the solo role:

```ts
const indices = spreadPageIndices(spreads[si]);
const soloRole =
  kind === 'solo' && indices[0] != null
    ? pageSlot(pages[indices[0]]!)
    : null;
return {
  rows: scr.spreadIndices.length,
  faces: lay.faces.length,
  soloRole: soloRole === 'cover' || soloRole === 'ending' ? soloRole : null,
  full: kind === 'full',
};
```

Store the transition in animation state:

```ts
const [anim, setAnim] = useState<{
  dir: FlipDir;
  toStart: number;
  transition: FlipTransition;
} | null>(null);
```

In `goScreen`:

```ts
const d: FlipDir = dir === 1 ? 'next' : 'prev';
const transition =
  fromShape != null && toShape != null
    ? flipTransition(fromShape, toShape, d, reducedMotion)
    : null;
if (!transition) {
  setStartPage(toStart);
  return;
}
setAnim({ dir: d, toStart, transition });
setLeafAngle(0);
requestAnimationFrame(() => {
  const geometry =
    transition === 'spread'
      ? leafGeometry(d, fromShape!.faces)
      : centeredSoloGeometry(transition);
  setLeafAngle(geometry.endAngle);
});
```

In the render loop, select layers and geometry by transition:

```ts
const soloTransition = anim?.transition === 'cover-open' || anim?.transition === 'ending-open';
const layers =
  anim != null && toLayout != null
    ? soloTransition
      ? centeredSoloLayers(resting.faces, toLayout.faces)
      : leafLayers(anim.dir, resting.faces.length, resting.faces, toLayout.faces)
    : null;
const faces = layers ? layers.under : resting.faces;
const box = soloTransition
  ? bookBox
  : resting.wide === 1
    ? { w: bookBox.w / 2, h: bookBox.h }
    : bookBox;
const geo =
  layers && anim
    ? soloTransition
      ? centeredSoloGeometry(anim.transition as 'cover-open' | 'ending-open')
      : leafGeometry(anim.dir, resting.faces.length)
    : null;
```

Expose `data-solo-transition={soloTransition ? '1' : undefined}` on `.mspread`.

- [ ] **Step 4: Add the paper projection styles**

Update `mobile-editor.css`:

```css
.mobile-editor .mspread {
  box-shadow:
    0 2px 5px rgba(24, 28, 27, 0.18),
    0 18px 42px rgba(24, 28, 27, 0.16);
}

.mobile-editor .mleaf {
  filter: drop-shadow(0 10px 12px rgba(24, 28, 27, 0.18));
}

.mobile-editor .mpage {
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.32),
    inset 0 0 0 1.5px rgba(24, 28, 27, 0.04);
}

.mobile-editor .mspread[data-solo-transition='1'] .mpage {
  animation: msolo-under-in 220ms var(--ease) both;
}

@keyframes msolo-under-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

Remove the unused `.mfab-num` rule and update the FAB comment to mention only board background.

- [ ] **Step 5: Run the mobile test group and verify GREEN**

Run:

```bash
cd apps/web
pnpm exec tsx --test \
  src/components/album/editor-v2/mobile/mobile-editor.test.ts \
  src/components/album/editor-v2/mobile/flip.test.ts \
  src/components/album/editor-v2/mobile/browse-window.test.ts \
  src/components/album/editor-v2/mobile/fit-box.test.ts \
  src/components/album/spreads.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add \
  apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx \
  apps/web/src/components/album/editor-v2/mobile/mobile-editor.css \
  apps/web/src/components/album/editor-v2/mobile/mobile-editor.test.ts
git commit -m "feat(editor): add mobile book edge flips and paper depth"
```

### Task 4: Full Verification and Local Visual Check

**Files:**
- Verify only; no production file is created.

**Interfaces:**
- Consumes: the completed fixed-density preview, transition model, and styles.
- Produces: fresh test, typecheck, and browser evidence for handoff.

- [ ] **Step 1: Run all Web tests**

```bash
pnpm --filter @yujee/web test
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 2: Run Web typecheck and documentation checks**

```bash
pnpm --filter @yujee/web typecheck
pnpm docs:check
```

Expected: both commands exit 0.

- [ ] **Step 3: Inspect the running mobile preview**

Open the local album in a mobile viewport and verify:

```text
1. The left-bottom density number is gone; board background remains.
2. Cover is centered and exactly one interior leaf wide.
3. Swiping forward on the cover turns it left.
4. Interior spreads keep two pages, spine shadow, and normal forward/back leaves.
5. Ending is centered and exactly one interior leaf wide.
6. Swiping backward on the ending turns it right.
7. Thumbnails remain cover + per-spread + ending.
8. No page opens the editor during an active flip.
```

- [ ] **Step 4: Inspect the final diff**

```bash
git diff --check
git status --short
git log --oneline -5
```

Expected: no whitespace errors; unrelated user files remain untouched.
