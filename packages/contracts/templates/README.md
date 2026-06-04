# Template JSON Library

Each template lives in `packages/contracts/templates/<id>.json`. The file name stem must match the top-level `id`.

Required fields:

- `id`: unique template id, equal to the file name stem.
- `category`: one of `cover`, `spread`, `single`, `grid`, or `closing`.
- `imageSlots`: object keyed by image slot name. Each slot may include `orientation` (`portrait`, `landscape`, `square`) and `quality` (`hero`, `detail`, `fill`) as soft hints.
- `textSlots`: object keyed by text slot name. Each slot must include `type`, one of `heading`, `caption`, `label`, `meta`, `paragraph`, `quote`, or `array`.

Optional fields:

- `textSlots[*].recommendedMaxChars`: soft recommended text length. Do not use legacy `maxChars` or `minChars`.
- `styles`: omit unless the template has meaningful style-specific data. Omitted means the template is available for all styles.

Keep JSON pretty-printed with 2-space indentation.
