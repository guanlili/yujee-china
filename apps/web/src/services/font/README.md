# Album Font Delivery

This module makes album font choices visible in both the browser preview and the
PDF export without sending full Chinese font files to the browser.

## Scope

The implementation covers three behaviors:

1. Every rendered template text slot consumes its `#artFont` carrier.
2. PDF font selection is safe for Chinese, English, and mixed-content slots.
3. Every selectable font id resolves to a real font asset instead of a silent
   substitute.

Prompt rewrites and the separate shared-skill migration are outside this work.

## Defaults

When a slot has no explicit `#artFont` carrier, select the default by its text
role and actual content:

| Content | `title` | `body`, `explain`, `decoration` |
|---|---|---|
| Contains Chinese | Noto Serif SC (`noto-serif-sc`) | Noto Sans SC (`noto-sans-sc`) |
| English only | Playfair Display (`playfair-display`) | Inter (`inter`) |

An explicit, role-compatible font carrier wins when it can render the slot.
If an English-only font is selected for text containing Chinese, use the Chinese
default for that role. A mixed Chinese/English slot uses the Chinese family for
the whole slot so browser and PDF output remain deterministic and glyph-safe.

## Delivery Architecture

### Chinese fonts

- Keep full Chinese TTF files under `apps/web/fonts/`; they are server-only and
  included in the font endpoint's Vercel output trace.
- Extend the authenticated font subset endpoint to accept the selected Chinese
  font ids together with the album charset.
- Validate every requested id against a closed server-side manifest and cap the
  request to the three role fonts used by one album.
- Subset only requested fonts with the existing `subset-font` dependency.
- Return id-keyed base64 subsets. Do not expose full Chinese font files through
  `public/`.
- Memoize identical in-flight and completed requests in the browser by font-id
  set plus charset, then load returned subsets through `FontFace`.

### English fonts

- Store the small English font files under `apps/web/public/fonts/` with their
  license files.
- Register each family through `@font-face` with `font-display: swap` for browser
  rendering. The raster PDF export screenshots the same browser rendering, so
  preview and export use the same family by construction. (The retired vector
  PDF path used to require a separate renderer-side font registration.)

### Rendering

- Centralize default and language-safe family selection in the theme-font
  resolver.
- Wire the resolved Web/PDF family into every title, body, explanation, and
  decoration slot across all registered template pairs.
- Extend shared folio renderers to accept the resolved decoration font.
- Preserve existing color-carrier behavior and all template geometry.

## Failure Behavior

- Unknown font ids are rejected by the existing design-agent role validation
  and by the server subset manifest.
- A missing or failed Chinese subset request falls back to the role default
  Noto subset; it must not leave an unrenderable family in PDF output.
- English font loading uses the role default stack while the requested file is
  loading.
- Font delivery failures never alter album text, color carriers, page structure,
  or image placement.

## Verification

Implementation is complete only when automated checks prove:

- all declared font ids have matching Web/PDF asset registrations;
- every rendered template text slot consumes both color and font carriers;
- ordinary and repeat slots use the correct title/body/decoration family;
- Chinese titles default to Noto Serif SC;
- other Chinese text defaults to Noto Sans SC;
- English titles default to Playfair Display;
- other English text defaults to Inter;
- an English-only font on Chinese text falls back to the correct CJK family;
- browser font loading memoizes equivalent subset requests;
- the subset endpoint rejects unknown ids and returns only requested fonts;
- representative Web markup and PDF font resolution agree;
- existing design-agent, contracts, Web, and Engine verification remains green,
  except for documented pre-existing baseline failures.
