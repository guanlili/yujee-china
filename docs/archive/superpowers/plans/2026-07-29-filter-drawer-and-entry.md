# Filter Drawer And Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile filter and background selectors consistent bottom drawers, move desktop whole-book Style out of the top bar and into the selected-image Style panel, and keep filter selection responsive during preview generation.

**Architecture:** Extend the existing mobile `ModalHost` with an opt-in bottom-sheet variant shared by `FilterSheet` and `BoardBgSheet`. Keep `FilterBar` as the single filter UI and add an optional controlled scope switch for desktop image-resource usage. Preserve all persistence and rendering flows while changing only entry placement, interaction availability, and tokenized presentation.

**Tech Stack:** React 19, TypeScript, Next.js 15, CSS design tokens, Node test runner through `tsx --test`.

## Global Constraints

- Reuse the existing modal and filter components.
- Mobile drawers are full-width, 66vh, bottom-aligned, top-corner radius 22px, and vertically scrollable.
- Desktop Style is not rendered in the global top bar.
- Desktop selected-image Style supports both `photo` and `book` scopes.
- Preview generation never disables filter selection.
- Do not change LUT persistence, export, snapshot, or unsupported-device contracts.

---

### Task 1: Shared mobile bottom drawer

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/mobile/modals/ModalHost.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/modals/FilterSheet.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/modals/BoardBgSheet.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/mobile-editor.css`
- Test: `apps/web/src/components/album/editor-v2/mobile/mobile-filter.test.ts`
- Test: `apps/web/src/components/album/editor-v2/mobile/modals/modals.test.ts`

**Interfaces:**
- Consumes: existing `ModalHostProps`.
- Produces: `variant?: 'center' | 'bottom-sheet'` and shared `.mobile-bottom-sheet` markup/styles.

- [ ] **Step 1: Write failing structural tests**

Add assertions that both mobile filter and board-background markup include
`mobile-bottom-sheet`, `mobile-sheet-grab`, and a scrollable body contract, and
that CSS aligns the modal overlay to the bottom with the exact shared height and
top-corner radius.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test \
  src/components/album/editor-v2/mobile/mobile-filter.test.ts \
  src/components/album/editor-v2/mobile/modals/modals.test.ts
```

Expected: FAIL because the bottom-sheet variant and shared class do not exist.

- [ ] **Step 3: Implement the shared variant**

Add the optional variant to `ModalHost`, append a `mobile-bottom-sheet-overlay`
class to the overlay, append `mobile-bottom-sheet` to the card, and render:

```tsx
{variant === 'bottom-sheet' && (
  <div className="mobile-sheet-grab" aria-hidden="true"><span /></div>
)}
```

Pass `variant="bottom-sheet"` from both `FilterSheet` and `BoardBgSheet`.
Style the shared overlay/card as bottom-aligned, full-width, 66vh, with
`22px 22px 0 0` radius and safe-area-aware internal scrolling.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests PASS.

---

### Task 2: Responsive filter selection and scope switch

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/FilterBar.tsx`
- Modify: `apps/web/src/components/album/editor-v2/editor-port.css`
- Test: `apps/web/src/components/album/editor-v2/desktop-filter-wiring.test.ts`
- Test: `apps/web/src/components/album/editor-v2/mobile/mobile-filter.test.ts`

**Interfaces:**
- Consumes: `scope: 'book' | 'photo'`, `photoId`, and existing `onChange`.
- Produces: optional `onScopeChange?: (scope: 'book' | 'photo') => void`.

- [ ] **Step 1: Write failing behavior/structure tests**

Assert that an `onScopeChange` prop renders a two-button scope control with
pressed state, that Filter and Original buttons have no `disabled` attribute
during loading, and that panel/card radii use `--radius-lg` and `--radius-md`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test \
  src/components/album/editor-v2/desktop-filter-wiring.test.ts \
  src/components/album/editor-v2/mobile/mobile-filter.test.ts
```

Expected: FAIL for the missing scope control, disabled buttons, and hard-coded radii.

- [ ] **Step 3: Implement minimal filter UI changes**

Add:

```ts
onScopeChange?: (scope: FilterScope) => void;
```

Render a segmented `filter-scope-switch` only when the callback is provided.
Remove preview-state `disabled` attributes from filter cards. Add a stable
preview placeholder wrapper so missing images do not collapse cards. Replace
the panel and card radius literals with the editor tokens.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests PASS.

---

### Task 3: Move desktop Style into image resources

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`
- Modify: `apps/web/src/components/album/editor-v2/editor-port.css`
- Test: `apps/web/src/components/album/editor-v2/desktop-filter-wiring.test.ts`

**Interfaces:**
- Consumes: existing selected-image `openPhotoFilter('photo', photoId)` action.
- Produces: the desktop `FilterBar` scope callback and no top-bar Style entry.

- [ ] **Step 1: Write failing desktop-entry tests**

Assert that `EditorTopbar` no longer accepts or renders `openBookFilter` or
`filter-topbar-btn`, that the selected-image overlay still owns Style, and that
the desktop `FilterBar` receives:

```tsx
onScopeChange={setFilterScope}
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test \
  src/components/album/editor-v2/desktop-filter-wiring.test.ts
```

Expected: FAIL because the top-bar Style entry is still present and the panel has no scope callback.

- [ ] **Step 3: Implement the entry move**

Remove `openBookFilter` and the Style button from `EditorTopbar`. Remove the
now-unused desktop whole-book opener. Keep the selected-image Style action and
pass `onScopeChange={setFilterScope}` to the desktop `FilterBar`; retain the
selected `filterPhotoId` while switching scopes so returning to Current photo
continues to target the same image.

Include `.img-edit-style` in the same button shell/hover rules as Replace and
Reset so the image-resource toolbar has one visual grammar.

- [ ] **Step 4: Run test and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

---

### Task 4: Regression verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: completed tasks.
- Produces: test and typecheck evidence.

- [ ] **Step 1: Run focused filter tests**

```bash
pnpm --filter @yujee/web exec tsx --test \
  src/components/album/editor-v2/filter-controller.test.ts \
  src/components/album/editor-v2/desktop-filter-wiring.test.ts \
  src/components/album/editor-v2/mobile/mobile-filter.test.ts \
  src/components/album/editor-v2/mobile/modals/modals.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run editor filter regression tests**

```bash
pnpm --filter @yujee/web exec tsx --test \
  src/components/album/editor-v2/authoring-filter-remount.test.ts \
  src/components/album/editor-v2/photo-snapshot-editor.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @yujee/web typecheck
```

Expected: exit code 0.

- [ ] **Step 4: Inspect the final diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only the planned files are modified.
