# Realistic spread paper design

## Scope

- Improve the normal two-page reading spread on desktop Web and mobile.
- Make the center fold, page curvature, paper edges, resting shadow, and turning
  leaf read as one coherent physical book.
- Preserve current page content, layout dimensions, page selection, touch
  gestures, and export output.
- Do not add a center fold to covers, endings, single-page views, or continuous
  double-wide templates.

## Current failure

Desktop currently represents the spine with a one-pixel soft border. It becomes
nearly invisible on dark layouts and does not deform the perceived paper
surface. Mobile has a wider dark gradient, but it is an isolated flat overlay:
the adjacent pages have no matching inner curvature or paper-edge response.
Both therefore read as two rectangles placed side by side rather than an open
book.

## Visual model

The effect uses CSS layers only. It does not modify saved page HTML or exported
pixels.

### Resting spread

The spread owns the large environmental shadow beneath the book. Each page owns
its paper edge and the subtle inner curvature nearest the binding.

The center fold is a responsive band made from three coordinated signals:

1. a narrow dark contact seam at the exact center;
2. soft shadows expanding onto both inner page edges;
3. a restrained reflected highlight beside the seam.

The combined gradient must remain visible on both light and dark layouts without
washing out page content. Desktop uses a wider band because the book is larger;
mobile clamps the band to the available page width.

The outer page edges receive only a thin highlight and low-contrast dark edge.
They must support the book illusion without becoming a decorative frame.

### Turning leaf

The existing 3D leaf geometry and timing remain unchanged. The moving leaf gains
an inner-fold shade, a softer outward drop shadow, and distinct front/back
lighting. The shadow is strongest around the middle of the turn and remains
subordinate to page content.

## State rules

- Normal paired interior pages: full spine, inner curvature, paper edges, and
  book shadow.
- Cover and ending solo pages: paper edge and page shadow only; no center fold.
- Single-page mobile/edit views: paper edge and page shadow only; no center fold.
- Continuous double-wide templates: paper edge and book shadow only; no center
  seam or opposing inner-page curvature.
- Empty trailing interior half: preserve the current empty-half behavior and do
  not fabricate a page.
- Selected/editable overlays stay above the paper effects and remain clickable.
- Flip leaves stay above the resting spine while pointer events pass through.

## Implementation boundaries

- Desktop changes stay in the existing `.book`, `.page`, `.flipper`, and `.leaf`
  visual layers in `editor-port.css`.
- Mobile changes stay in `.mspread`, `.mpage`, `.mleaf`, and their existing
  state attributes in `mobile-editor.css`.
- Existing spread classification remains the source of truth; no new page-kind
  inference is introduced in CSS.
- No raster texture assets, WebGL, canvas post-processing, schema changes, or
  rendering-library changes.

## Verification

- Add failing structural tests before production changes.
- Tests assert that paired spreads receive a multi-stop center fold and
  side-specific inner curvature on both desktop and mobile.
- Tests assert that solo, single-page, and double-wide states suppress the center
  fold.
- Tests assert that paper-effect layers do not intercept clicks and remain below
  selection and flipping layers.
- Run targeted spread/mobile tests, TypeScript checking, and the full Web test
  suite.
- Inspect desktop and mobile running previews when a browser surface is
  available; if none is connected, report that visual-device verification
  remains for the user's live testing.
