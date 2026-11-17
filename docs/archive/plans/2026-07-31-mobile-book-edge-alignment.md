# Mobile Book Edge Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the mobile cover from the center to the right page slot and the ending page to the left page slot, with both leaves rotating around the center spine.

**Architecture:** Keep the existing fixed two-page `bookBox` and half-page physical size. Express the special leaf geometry as a pure function in `flip.ts`; at rest, offset the existing half-width solo container into its matching page slot without changing its size or shadow box.

**Tech Stack:** React, TypeScript, CSS, Node test runner through `tsx`

## Global Constraints

- Mobile browse density remains fixed at `2`.
- Cover and ending pages remain exactly `bookBox.w / 2` wide and `bookBox.h` high.
- Cover occupies the right slot and turns left around the center spine.
- Ending occupies the left slot and turns right around the center spine.
- Desktop `FlipBook`, page data, exports, APIs, and database remain unchanged.
- Reduced-motion behavior remains a direct switch.

---

### Task 1: Align solo pages and their turning leaves to the spine

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/mobile/flip.test.ts`
- Modify: `apps/web/src/components/album/editor-v2/mobile/mobile-editor.test.ts`
- Modify: `apps/web/src/components/album/editor-v2/mobile/flip.ts`
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx`

**Interfaces:**
- Consumes: `FlipTransition`, canonical `bookBox`, and the current solo role from `ScreenShape`.
- Produces: `edgeSoloGeometry(transition): LeafGeometry` and resting solo offsets in `MobileEditor`.

- [ ] **Step 1: Write failing geometry tests**

Update the special geometry expectations in `flip.test.ts`:

```ts
test('独页贴着真实书脊：封面占右页位，封尾占左页位', () => {
  assert.deepEqual(edgeSoloGeometry('cover-open'), {
    leftFrac: 0.5,
    widthFrac: 0.5,
    origin: 'left center',
    endAngle: -180,
  });
  assert.deepEqual(edgeSoloGeometry('ending-open'), {
    leftFrac: 0,
    widthFrac: 0.5,
    origin: 'right center',
    endAngle: 180,
  });
});
```

Add a component structure test in `mobile-editor.test.ts` that requires the resting page offsets:

```ts
test('封面停右页位、封尾停左页位，不再居中', () => {
  const src = source('MobileEditor.tsx');
  assert.match(src, /marginLeft:\s*restingSoloRole === 'cover' \? bookBox\.w \/ 2/);
  assert.match(src, /marginRight:\s*restingSoloRole === 'ending' \? bookBox\.w \/ 2/);
  assert.doesNotMatch(src, /centeredSoloGeometry/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test \
  src/components/album/editor-v2/mobile/flip.test.ts \
  src/components/album/editor-v2/mobile/mobile-editor.test.ts
```

Expected: FAIL because `edgeSoloGeometry` and the left/right resting offsets do not exist; the current special geometry starts at `leftFrac: 0.25`.

- [ ] **Step 3: Implement the minimal geometry and resting offsets**

In `flip.ts`, replace `centeredSoloGeometry` with:

```ts
export function edgeSoloGeometry(
  transition: Exclude<FlipTransition, 'spread'>,
): LeafGeometry {
  return transition === 'cover-open'
    ? { leftFrac: 0.5, widthFrac: 0.5, origin: 'left center', endAngle: -180 }
    : { leftFrac: 0, widthFrac: 0.5, origin: 'right center', endAngle: 180 };
}
```

In `MobileEditor.tsx`, use `edgeSoloGeometry` for animation. Keep the resting solo box half-width, and apply a half-book outer margin so the flex-centered margin box fills the canonical book width:

```ts
const restingSoloRole =
  !soloTransition && kind === 'solo' ? shapeOf(screen)?.soloRole ?? null : null;

style={{
  width: box.w,
  height: box.h,
  marginLeft: restingSoloRole === 'cover' ? bookBox.w / 2 : undefined,
  marginRight: restingSoloRole === 'ending' ? bookBox.w / 2 : undefined,
}}
```

This keeps the visible paper and its shadow half-width while placing the cover on the right and ending on the left. During a special flip the container expands to the full `bookBox`; `edgeSoloGeometry` puts the leaf at the same physical coordinates, preventing a jump.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the focused command from Step 2.

Expected: all tests pass with zero failures.

- [ ] **Step 5: Run regression verification**

Run:

```bash
pnpm --filter @yujee/web test
pnpm --filter @yujee/web typecheck
pnpm docs:check
```

Expected: Web tests have zero failures, TypeScript exits `0`, and docs validation passes except for warnings caused only by pre-existing unrelated uncommitted files.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/components/album/editor-v2/mobile/flip.test.ts \
  apps/web/src/components/album/editor-v2/mobile/mobile-editor.test.ts \
  apps/web/src/components/album/editor-v2/mobile/flip.ts \
  apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx \
  docs/plans/2026-07-31-mobile-book-edge-alignment.md
git commit -m "fix(editor): align mobile covers to book spine"
```
