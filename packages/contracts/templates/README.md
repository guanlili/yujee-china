# Template JSON library

Each template lives in `packages/contracts/templates/<id>.json`. The file-name
stem must equal the top-level `id`. These JSON files are the **single source of
truth**; `pnpm --filter @yujee/contracts templates:generate` regenerates
`src/templates.generated.ts` from them (never edit the generated file by hand).
Keep JSON pretty-printed with 2-space indentation.

The contract shape is defined by `src/templates.ts` (zod) and mirrored by the
Python loader `apps/agent/src/templates.py`. See `docs/agent/v3-requirements.md`
§9 for the full V3 spec.

## V3 fields

```jsonc
{
  "id": "mag-08",
  "category": "interior",          // cover | interior | toc | ending
  "pairing": null,                 // interior-only forced spread pairing; default omitted
  "images": [ { "id": "image" } ], // image slots — id only
  "svgs":   [ { "id": "divider", "variableDecor": true } ], // optional decoration vector slots
  "texts": [
    { "id": "title", "role": "title",      "lang": "user", "maxChars": 12,  "hint": "…", "variableDecor": true },
    { "id": "body",  "role": "body",       "lang": "user", "maxChars": 180, "hint": "…" },
    { "id": "date",  "role": "decoration", "lang": "en",   "maxChars": 12,  "variableDecor": true },
    { "id": "folio", "role": "decoration", "lang": "en",   "maxChars": 2 }
  ],
  "items": {                       // optional: the single repeat group (renders N times)
    "images": [ { "id": "image" } ],
    "texts":  [ { "id": "caption", "role": "explain", "lang": "user", "maxChars": 70, "hint": "…" } ]
  }
}
```

- **`category`** — drives template selection: the agent picks only from the pool
  matching the page's category. `toc` = contents page, `ending` = back/closing page.
- **`images[]`** — each slot is `{ id }`; any photo can go in any slot, fit is
  handled by the layout (object-fit). Multiple slots use `image1` / `image2` … in
  reading order.
- **`svgs[]`** — decorative vector slots (icon / divider / flourish). Pure
  decoration, never filled with user content.
- **`texts[]`** — `{ id, role, lang, maxChars?, hint?, variableDecor? }`.
  - `role`: `title | body | explain | decoration` (captions are always `explain`,
    prose is always `body`; `decoration` ids use function names `folio`/`date`/`label`).
  - `lang`: `user` (follows the user's language) or `en` (fixed English, used for
    decoration like dates/numbers/labels).
  - `maxChars`: hard length cap, tuned against the physical layout height.
  - `hint`: natural-language writing guidance fed to the slot-filling LLM (what to
    write + how). Disambiguates multiple same-role slots. Does not affect layout.
  - `variableDecor`: optional boolean (default false). Marks slots whose colour /
    font / stroke may be themed by `apply-theme`. Meaningful only on `title` /
    `decoration` / `svg` slots — never on `body` / `explain`.
- **`items`** — the one repeat group; its `images[]` / `texts[]` slots are
  addressed at render time as `<slotId>[<n>]`.

## Transitional note (WP0.2)

These templates currently carry the V3 fields **alongside** their legacy fields
(`slot`, `scene`, image `orientation` / `quality`, and `repeat` text slots). The
deterministic template-picking engine — a shared TS↔Python contract locked by the
golden fixtures in `packages/contracts/fixtures/skeleton/` — still reads the legacy
fields, so they are kept until that engine is rewritten onto `category` / `items`
(together with the Python loader rewrite, WP0.4). Once both ends switch over, the
legacy fields are removed.
