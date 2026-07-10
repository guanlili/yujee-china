# Task 1 Report: Resolver defaults and language safety

## Status

Implemented Task 1 only in the `feat/album-typography` worktree.

## RED

Tests were added before either production file was changed.

Command:

```bash
pnpm --filter @yujee/web exec tsx --test src/components/album/templates/theme-carrier.test.ts
```

Exit: `1`

Output summary:

```text
✔ resolveThemeCarrier returns sibling accent/font without changing base text
✖ resolveThemeCarrier defaults each role by the slot text language
✔ resolveThemeCarrier lets an explicit role-compatible font render English text
✖ resolveThemeCarrier ignores an explicit font that is incompatible with the role
✖ resolveThemeCarrier falls back from English-only fonts for Chinese and mixed text
✔ remaining existing theme-carrier tests
ℹ tests 13
ℹ pass 10
ℹ fail 3
```

The three failures matched the missing behavior:

```text
defaults: actual undefined, expected Noto Serif SC
role safety: actual Inter, expected Playfair Display
CJK safety: actual Playfair Display, expected Noto Serif SC
```

## GREEN

After the minimum catalog and resolver implementation, the same focused command was run again.

Command:

```bash
pnpm --filter @yujee/web exec tsx --test src/components/album/templates/theme-carrier.test.ts
```

Exit: `0`

Output:

```text
✔ resolveThemeCarrier returns sibling accent/font without changing base text
✔ resolveThemeCarrier defaults each role by the slot text language
✔ resolveThemeCarrier lets an explicit role-compatible font render English text
✔ resolveThemeCarrier ignores an explicit font that is incompatible with the role
✔ resolveThemeCarrier falls back from English-only fonts for Chinese and mixed text
✔ mag-03 consumes location carrier as style without rendering raw color text
✔ resolveThemeCarrier reads repeat-slot carriers without clobbering repeat text
✔ mag-08 consumes title carrier while preserving title text
✔ mag-02 web resolves repeat title carriers per row
✔ web templates consume every text variableDecor carrier as style only
✔ every rendered text slot consumes its accent carrier (web + pdf)
✔ PDF templates resolve every text variableDecor carrier in source
✔ PDF templates uppercase carrier text for decoration slots in source
ℹ tests 13
ℹ pass 13
ℹ fail 0
```

Additional verification:

```bash
pnpm --filter @yujee/web typecheck
```

Exit: `0`

The first typecheck exposed two local union-narrowing errors in the new resolver. They were corrected, after which both typecheck and the focused suite were rerun successfully.

## Files

- `apps/web/src/components/album/templates/theme-carrier.test.ts`
- `apps/web/src/components/album/templates/theme-carrier.ts`
- `apps/web/src/components/album/templates/font-catalog.ts`
- `.superpowers/sdd/task-1-report.md`

## Self-review

- `FONT_CATALOG` is compile-time complete through `satisfies Record<ArtFontPack, AlbumFontCatalogEntry>`.
- Role defaults match the approved matrix: Chinese title uses Noto Serif SC; other Chinese roles use Noto Sans SC; English title uses Playfair Display; other English roles use Inter.
- Han detection applies the Chinese family to the entire mixed-language slot.
- Explicit families win only when their catalog role is compatible and their script coverage can render the content.
- `text`, `accentColor`, and the original `artFont` carrier value are preserved; only the resolved Web/PDF families fall back.
- The role argument is optional for now so existing two-argument template callers retain their pre-Task-2 behavior and Web typecheck stays green. Task 2 remains responsible for wiring explicit roles into every renderer.
- No prompt, Engine, shared-skill migration, template renderer, dependency, or main-checkout file was changed.

## Known follow-on scope

- Several catalog entries intentionally retain the existing nearest registered Web/PDF family until Task 3 vendors and registers every real asset.
- Templates do not receive role defaults until Task 2 supplies the role argument at each render call.
