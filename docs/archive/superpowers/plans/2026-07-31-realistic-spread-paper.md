# Realistic Spread Paper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normal paired spreads on desktop Web and mobile read as a physical open book through a visible center fold, page curvature, paper edges, environmental shadow, and coherent turning-leaf lighting.

**Architecture:** Keep the effect entirely in the existing editor preview CSS layers. Desktop uses `.book`, `.page`, `.flipper`, and `.leaf`; mobile uses `.mspread`, `.mpage`, `.mleaf`, and the existing `data-halves`/`data-kind` state. A single structural regression test reads both stylesheets and protects the layer, state-suppression, z-index, and pointer-event contracts.

**Tech Stack:** React 19, Next.js 15, TypeScript, CSS pseudo-elements and 3D transforms, Node `node:test`, `tsx`.

## Global Constraints

- Do not modify saved page HTML, exported pixels, page dimensions, gestures, or spread classification.
- Do not show a center fold on covers, endings, single-page views, empty halves, or continuous double-wide templates.
- Paper-effect layers must not intercept pointer input.
- Selection overlays must stay above resting paper effects; turning leaves must stay above the spine.
- Add no raster texture assets, WebGL, canvas post-processing, schema changes, or dependencies.

---

## File Structure

- Create `apps/web/src/components/album/editor-v2/spread-paper-realism.test.ts`: structural contract for desktop and mobile paper layers.
- Modify `apps/web/src/components/album/editor-v2/editor-port.css`: desktop resting spread and turning-leaf lighting.
- Modify `apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx`: expose whether both physical page halves are occupied.
- Modify `apps/web/src/components/album/editor-v2/mobile/mobile-editor.css`: responsive mobile fold, page curvature, paper edge, and turning-leaf lighting.

### Task 1: Desktop open-book surface

**Files:**
- Create: `apps/web/src/components/album/editor-v2/spread-paper-realism.test.ts`
- Modify: `apps/web/src/components/album/editor-v2/editor-port.css:109-245`

**Interfaces:**
- Consumes: existing `.book-solo`, `.book-single`, `.book-full`, `.page-left`, `.page-right`, `.flipper`, `.leaf.front`, and `.leaf.back` classes.
- Produces: a desktop fold band on `.book::before`, center seam on `.book::after`, page curvature on `.page::before`, and leaf lighting on `.leaf::before`.

- [ ] **Step 1: Write the failing desktop test**

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = readFileSync(join(here, 'editor-port.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('desktop paired spread has a responsive fold band, center seam, and side curvature', () => {
  assert.match(desktop, /\.editor-port \.book::before\{[^}]*width:\s*clamp\(/s);
  assert.match(desktop, /\.editor-port \.book::after\{[^}]*left:\s*50%[^}]*pointer-events:\s*none/s);
  assert.match(desktop, /\.editor-port \.book:not\(\.book-solo\):not\(\.book-full\) \.page-left::before/s);
  assert.match(desktop, /\.editor-port \.book:not\(\.book-solo\):not\(\.book-full\) \.page-right::before/s);
});

test('desktop fold is absent on solo and continuous double-wide states', () => {
  assert.match(desktop, /\.editor-port \.book\.book-solo::before[^}]*display:\s*none/s);
  assert.match(desktop, /\.editor-port \.book\.book-solo::after[^}]*display:\s*none/s);
  assert.match(desktop, /\.editor-port \.book\.book-full::before[^}]*display:\s*none/s);
  assert.match(desktop, /\.editor-port \.book\.book-full::after[^}]*display:\s*none/s);
});

test('desktop turning leaf stays above the spine and carries paper lighting', () => {
  assert.match(desktop, /\.editor-port \.flipper\{[^}]*z-index:\s*6/s);
  assert.match(desktop, /\.editor-port \.leaf::before\{[^}]*pointer-events:\s*none/s);
});
```

- [ ] **Step 2: Run the desktop test and verify RED**

Run:

```bash
cd apps/web
pnpm exec tsx --test src/components/album/editor-v2/spread-paper-realism.test.ts
```

Expected: FAIL because `.book::after`, side-specific `.page::before`, and `.leaf::before` do not exist and the current fold is only `1px`.

- [ ] **Step 3: Implement the desktop paper layers**

Replace the current book shadow and one-pixel spine with a larger environmental shadow and a responsive multi-stop fold:

```css
.editor-port .book{
  isolation:isolate;
  border-radius:3px;
  box-shadow:
    0 1px 2px rgba(20,24,23,.16),
    0 10px 24px rgba(20,24,23,.13),
    0 28px 58px rgba(20,24,23,.10);
}
.editor-port .book::before{
  content:'';
  position:absolute;
  top:0;
  bottom:0;
  left:50%;
  width:clamp(26px,3.8vw,44px);
  transform:translateX(-50%);
  z-index:5;
  pointer-events:none;
  background:linear-gradient(90deg,
    rgba(255,255,255,.10) 0%,
    rgba(0,0,0,.04) 24%,
    rgba(0,0,0,.16) 46%,
    rgba(0,0,0,.24) 50%,
    rgba(255,255,255,.13) 54%,
    rgba(0,0,0,.05) 76%,
    rgba(255,255,255,.08) 100%);
}
.editor-port .book::after{
  content:'';
  position:absolute;
  top:0;
  bottom:0;
  left:50%;
  width:1px;
  transform:translateX(-50%);
  z-index:5;
  pointer-events:none;
  background:rgba(16,20,19,.28);
  box-shadow:-1px 0 rgba(255,255,255,.12),1px 0 rgba(0,0,0,.08);
}
.editor-port .book:not(.book-solo):not(.book-full) .page-left::before,
.editor-port .book:not(.book-solo):not(.book-full) .page-right::before{
  content:'';
  position:absolute;
  inset:0;
  z-index:4;
  pointer-events:none;
}
.editor-port .book:not(.book-solo):not(.book-full) .page-left::before{
  background:linear-gradient(90deg,transparent 72%,rgba(255,255,255,.06) 86%,rgba(0,0,0,.13) 100%);
}
.editor-port .book:not(.book-solo):not(.book-full) .page-right::before{
  background:linear-gradient(90deg,rgba(0,0,0,.12) 0%,rgba(255,255,255,.07) 14%,transparent 28%);
}
```

Extend the existing suppression rules to both pseudo-elements:

```css
.editor-port .book.book-solo::before,
.editor-port .book.book-solo::after,
.editor-port .book.book-full::before,
.editor-port .book.book-full::after{display:none;}
```

Add paper lighting inside the moving leaf without changing geometry or timing:

```css
.editor-port .flipper{filter:drop-shadow(0 12px 14px rgba(20,24,23,.20));}
.editor-port .leaf::before{
  content:'';
  position:absolute;
  inset:0;
  z-index:4;
  pointer-events:none;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);
}
.editor-port .leaf.front::before{
  background:linear-gradient(90deg,rgba(0,0,0,.13),transparent 24%,rgba(255,255,255,.07));
}
.editor-port .leaf.back::before{
  background:linear-gradient(90deg,rgba(255,255,255,.08),transparent 70%,rgba(0,0,0,.15));
}
```

- [ ] **Step 4: Run desktop spread regressions and verify GREEN**

Run:

```bash
cd apps/web
pnpm exec tsx --test \
  src/components/album/editor-v2/spread-paper-realism.test.ts \
  src/components/album/editor-v2/cover-single-page.test.ts \
  src/components/album/editor-v2/spread-full-page.test.ts \
  src/components/album/editor-v2/spread-page-padding.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit desktop surface**

```bash
git add \
  apps/web/src/components/album/editor-v2/spread-paper-realism.test.ts \
  apps/web/src/components/album/editor-v2/editor-port.css
git commit -m "fix(editor): restore desktop spread paper depth"
```

### Task 2: Mobile open-book surface

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/spread-paper-realism.test.ts`
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx:470-500`
- Modify: `apps/web/src/components/album/editor-v2/mobile/mobile-editor.css:116-180,298-360`

**Interfaces:**
- Consumes: existing `faces`, `data-kind`, `data-resting-solo`, `.mpage`, `.mleaf`, `.mleaf-face`, and `.mleaf-back`.
- Produces: `data-paper-spine="1"` only when two real page halves are occupied, plus responsive mobile fold/seam pseudo-elements, side-specific page curvature, and front/back turning-leaf lighting.

- [ ] **Step 1: Extend the test with failing mobile contracts**

```ts
const mobile = readFileSync(join(here, 'mobile/mobile-editor.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('mobile paired spread has a responsive fold, seam, and side curvature', () => {
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\]::before\{[^}]*width:\s*clamp\(/s);
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\]::after\{[^}]*left:\s*50%[^}]*pointer-events:\s*none/s);
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\] \.mpage:first-of-type::before/s);
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\] \.mpage:nth-of-type\(2\)::before/s);
});

test('mobile exposes a spine only when both rendered halves contain real pages', () => {
  const component = readFileSync(join(here, 'mobile/MobileEditor.tsx'), 'utf8');
  assert.match(
    component,
    /data-paper-spine=\{faces\.length === 2 && faces\.every\(\(pageIndex\) => pageIndex != null\) \? '1' : undefined\}/,
  );
});

test('mobile moving leaf stays above the fold and carries two-sided lighting', () => {
  assert.match(mobile, /\.mobile-editor \.mleaf\{[^}]*z-index:\s*6/s);
  assert.match(mobile, /\.mobile-editor \.mleaf-face::after\{[^}]*pointer-events:\s*none/s);
  assert.match(mobile, /\.mobile-editor \.mleaf-back::after/s);
});
```

- [ ] **Step 2: Run the mobile test and verify RED**

Run:

```bash
cd apps/web
pnpm exec tsx --test src/components/album/editor-v2/spread-paper-realism.test.ts
```

Expected: desktop cases PASS and mobile cases FAIL because the current mobile fold has a fixed `24px` width, no seam or side-specific curvature, and keys off face count even when one half is empty.

- [ ] **Step 3: Implement mobile paper layers**

Expose the real two-page condition from the existing `faces` array:

```tsx
data-halves={faces.length}
data-paper-spine={
  faces.length === 2 && faces.every((pageIndex) => pageIndex != null) ? '1' : undefined
}
```

Enhance the existing spread shadow and replace the fixed fold:

```css
.mobile-editor .mspread{
  isolation:isolate;
  border-radius:2px;
  box-shadow:
    0 1px 2px rgba(20,24,23,.18),
    0 9px 22px rgba(20,24,23,.14),
    0 24px 48px rgba(20,24,23,.12);
}
.mobile-editor .mspread[data-paper-spine='1']::before{
  width:clamp(18px,6vw,30px);
  background:linear-gradient(90deg,
    rgba(255,255,255,.10) 0%,
    rgba(0,0,0,.04) 23%,
    rgba(0,0,0,.16) 46%,
    rgba(0,0,0,.24) 50%,
    rgba(255,255,255,.14) 54%,
    rgba(0,0,0,.05) 77%,
    rgba(255,255,255,.08) 100%);
}
.mobile-editor .mspread[data-paper-spine='1']::after{
  content:'';
  position:absolute;
  top:0;
  bottom:0;
  left:50%;
  width:1px;
  transform:translateX(-50%);
  z-index:5;
  pointer-events:none;
  background:rgba(16,20,19,.30);
  box-shadow:-1px 0 rgba(255,255,255,.13),1px 0 rgba(0,0,0,.08);
}
```

Give each page a matching inner curve while keeping the existing edge overlay:

```css
.mobile-editor .mspread[data-paper-spine='1'] .mpage::before{
  content:'';
  position:absolute;
  inset:0;
  z-index:1;
  pointer-events:none;
}
.mobile-editor .mspread[data-paper-spine='1'] .mpage:first-of-type::before{
  background:linear-gradient(90deg,transparent 70%,rgba(255,255,255,.06) 86%,rgba(0,0,0,.14) 100%);
}
.mobile-editor .mspread[data-paper-spine='1'] .mpage:nth-of-type(2)::before{
  background:linear-gradient(90deg,rgba(0,0,0,.13) 0%,rgba(255,255,255,.07) 14%,transparent 30%);
}
```

Add two-sided leaf light and keep the existing `mleaf-shade` dynamic layer:

```css
.mobile-editor .mleaf{
  filter:drop-shadow(0 12px 14px rgba(20,24,23,.22));
}
.mobile-editor .mleaf-face::after{
  content:'';
  position:absolute;
  inset:0;
  z-index:2;
  pointer-events:none;
  background:linear-gradient(90deg,rgba(0,0,0,.12),transparent 26%,rgba(255,255,255,.07));
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);
}
.mobile-editor .mleaf-back::after{
  background:linear-gradient(90deg,rgba(255,255,255,.08),transparent 70%,rgba(0,0,0,.15));
}
```

Ensure edge-motion opacity animation applies the same concrete timing to the new center seam:

```css
.mobile-editor .mspread[data-edge-opening='1'][data-paper-spine='1']::after{
  animation:medge-under-in 200ms var(--ease) 210ms both;
}
.mobile-editor .mspread[data-edge-closing='1'][data-paper-spine='1']::after{
  animation:medge-under-out 180ms var(--ease) 350ms both;
}
```

- [ ] **Step 4: Run mobile regressions and verify GREEN**

Run:

```bash
cd apps/web
pnpm exec tsx --test \
  src/components/album/editor-v2/spread-paper-realism.test.ts \
  src/components/album/editor-v2/mobile/mobile-editor.test.ts \
  src/components/album/editor-v2/mobile/flip.test.ts \
  src/components/album/editor-v2/mobile/edit-view.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit mobile surface**

```bash
git add \
  apps/web/src/components/album/editor-v2/spread-paper-realism.test.ts \
  apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx \
  apps/web/src/components/album/editor-v2/mobile/mobile-editor.css
git commit -m "fix(editor): restore mobile spread paper depth"
```

### Task 3: Final verification

**Files:**
- Verify: `apps/web/src/components/album/editor-v2/editor-port.css`
- Verify: `apps/web/src/components/album/editor-v2/mobile/mobile-editor.css`
- Verify: `apps/web/src/components/album/editor-v2/spread-paper-realism.test.ts`

**Interfaces:**
- Consumes: completed desktop and mobile CSS contracts from Tasks 1 and 2.
- Produces: evidence that types, full regression suite, local services, and stylesheet formatting are valid.

- [ ] **Step 1: Run TypeScript checking**

Run:

```bash
cd apps/web
pnpm typecheck
```

Expected: exit code `0`.

- [ ] **Step 2: Run the complete Web test suite**

Run:

```bash
cd apps/web
pnpm test
```

Expected: `fail 0`.

- [ ] **Step 3: Check formatting and service health**

Run:

```bash
git diff --check
curl --fail http://localhost:3000/zh/dev/mobile
curl --fail http://localhost:8001/health
curl --fail http://localhost:8787/health
```

Expected: `git diff --check` has no output and all three HTTP requests succeed.

- [ ] **Step 4: Visual verification boundary**

If an in-app browser becomes available, inspect a paired light spread, paired
dark spread, cover, ending, continuous double-wide template, and a mid-turn
frame at desktop and mobile viewport widths. If no browser is connected, do not
substitute another automation surface; report that the user's live test is the
visual verification source.

- [ ] **Step 5: Commit any verification-only corrections**

If Task 3 requires no corrections, do not create an empty commit. If it reveals
a CSS contract issue, add only the affected CSS/test files and commit:

```bash
git commit -m "fix(editor): polish spread paper states"
```
