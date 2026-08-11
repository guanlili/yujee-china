# Template JSON library

Each template lives in `packages/contracts/templates/<id>.json`. The file-name
stem must equal the top-level `id`. These JSON files are the **single source of
truth**; `pnpm --filter @yujee/contracts templates:generate` regenerates
`src/templates.generated.ts` from them (never edit the generated file by hand).
Keep JSON pretty-printed with 2-space indentation.

The contract shape is defined by `src/templates.ts` (zod) and mirrored by the
Python loader `engine/src/workflows/core/layout/templates.py`. The project-level
technical context lives in the root `README.md`.

## 新增一个模板要动的地方

模板 id 是渲染锚点契约的一部分,散落在多处,漏一处就是契约漂移。当前触点:

1. `packages/contracts/templates/<id>.json` —— 唯一真相
2. `pnpm templates:generate` 重新生成 `src/templates.generated.ts`(**不要手改**)
3. `packages/contracts/src/render/html-templates/<id>.ts` —— HTML 镜像,带
   `data-text-key` / `data-image-slot` 锚点
4. 同目录 `registry.ts` 登记
5. `apps/web/src/components/album/templates/<id>/` —— React 渲染组件
6. `apps/web/src/components/album/web-registry.ts` 登记(**渲染注册表的唯一真相**)
7. `packages/contracts/src/templates.test.ts` 的 `EXPECTED_TEMPLATE_IDS`
   硬编码清单 —— 不加新 id 该测试直接红

`registry-parity.test.ts` 和 `templates:check` 只挡得住其中一部分,提交前跑
`pnpm typecheck && pnpm --filter @yujee/contracts test`。

**文字槽 id 必须按 role 派号**,不能自己起名:`title/title2…`、`body/body2…`、
`explain/explain2…`、`label/label2…`(顺序即出现顺序)。`templates.test.ts` 里
「text slot ids follow the role-derived naming rule」会校验这条。

## V3 fields

```jsonc
{
  "id": "mag-08",
  "category": "interior",          // cover | interior | toc | ending
  "pairing": null,                 // interior-only forced spread pairing; default omitted
  "images": [ { "id": "image" } ], // image slots — id only
  "svgs":   [ { "id": "divider", "variableDecor": true } ], // optional decoration vector slots
  "texts": [
    { "id": "title", "role": "title",      "lang": "user", "variableDecor": true },
    { "id": "body",  "role": "body",       "lang": "user" },
    { "id": "label", "role": "decoration", "lang": "en",   "variableDecor": true },
    { "id": "label2","role": "decoration", "lang": "en" }
  ],
  "items": {                       // optional: the single repeat group (renders N times)
    "images": [ { "id": "image" } ],
    "texts":  [ { "id": "explain", "role": "explain", "lang": "user" } ]
  }
}
```

- **`category`** — drives template selection: 选版是**确定性**的(`/v3/select-layout`,
  零 AI 调用),只从与该页 category 匹配的池子里挑。`toc` = contents page,
  `ending` = back/closing page。
- **`images[]`** — each slot is `{ id }`; any photo can go in any slot, fit is
  handled by the layout (object-fit). Multiple slots use `image1` / `image2` … in
  reading order.
- **`svgs[]`** — decorative vector slots (icon / divider / flourish). Pure
  decoration, never filled with user content.
  - `role`: `title | body | explain | decoration` (captions are always `explain`,
    prose is always `body`)。**id 由 role 派号,不能自己起名** —— 见上面「新增一个模板
    要动的地方」。
  - `lang`: `user` (follows the user's language) or `en` (fixed English, used for
    decoration like dates/numbers/labels).
  - ~~`hint`~~ —— **该字段已从契约删除**,带 `hint` 的槽会被 strict 解析拒绝。
    别再按旧文档往 JSON 里加。
  - `variableDecor`: optional boolean (default false). Marks slots whose colour /
    font / stroke may be themed (旧 `apply-theme` 端点已删,现在由设计 Agent 的
    `set_text_colors` / `set_text_fonts` 消费). Meaningful only on `title` /
    `decoration` / `svg` slots — never on `body` / `explain`.
- **`items`** — the one repeat group; its `images[]` / `texts[]` slots are
  addressed at render time as `<slotId>[<n>]`.

## Current engine note

Templates are category-only: `category` replaces the legacy `slot` / `scene`
split. Image-slot `orientation`, `quality`, and `composition` are still current:
the deterministic selection and assignment engine uses them to match photos to
slots. The generated registry is locked by template checks and skeleton fixtures
under `packages/contracts/fixtures/skeleton/`.

<!-- doc-scope
paths: packages/contracts/templates/*.json, packages/contracts/src/templates.ts, packages/contracts/src/render/html-templates/**, apps/web/src/components/album/web-registry.ts
checked-at: 293b1d2d
-->
