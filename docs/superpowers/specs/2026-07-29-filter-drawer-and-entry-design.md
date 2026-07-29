# Filter drawer and entry design

## Scope

- Mobile filter selection uses the same bottom-sheet language as the existing
  background selector.
- Desktop removes the whole-book Style action from the global top bar.
- Desktop Style remains an image-resource action and supports both the selected
  photo and the whole book from one panel.
- Filter previews never block selection while thumbnails are being generated.

## Interaction

### Mobile

The filter panel is a bottom drawer aligned to the viewport bottom. It is full
width, 66vh high, rounded only on the top corners, and includes the existing
sheet grab indicator. The header stays visible while the filter list scrolls.
The backdrop and close button retain their current close behavior.

The drawer reuses the same shared bottom-sheet class as the mobile background
selector so their height, radius, animation, shadow, and safe-area behavior
cannot drift.

### Desktop

The global top bar no longer renders Style. Selecting an image exposes the
existing Style action in the image edit toolbar. The opened panel contains a
scope switch for “Current photo” and “Whole book”; it opens on the selected
photo scope.

The panel shell and filter cards use the editor radius tokens:

- panel: `var(--radius-lg)`
- filter card: `var(--radius-md)`
- pills and segmented controls: `var(--radius-pill)`

## Preview behavior

Preview generation remains asynchronous. Filter and Original controls stay
enabled while preview images are pending, allowing an immediate state change.
Generated thumbnails replace placeholders independently. Changing strength may
refresh previews but does not lock interaction.

## Boundaries

- No changes to LUT persistence, rendering, export, or snapshot contracts.
- No redesign of unrelated editor toolbars or modal flows.
- Existing unsupported-device guards remain in place.

## Verification

- Structural tests cover the mobile bottom-sheet contract, desktop top-bar
  removal, image-resource entry, scope switch, tokenized radii, and enabled
  controls during preview loading.
- Existing filter controller, mobile editor, and desktop wiring tests remain
  green.
- The running editor is checked at mobile and desktop viewport sizes when a
  browser surface is available.
