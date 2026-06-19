"""V3 deterministic finalize — V3 layout tree + pages -> flat AlbumLayoutPlan.

The V3 path of finalize (issue #179 / WP0.4). A *new* code path next to v2
`finalize.py`; the v2 finalize and its quality/hero/page0-cover rules stay
untouched until the v1/v2 teardown (WP6.1 / #197).

V3 finalize (docs/agent/v3-requirements.md §9 / §4.5; v3-implementation-plan §3
WP0.4) differs from v2 finalize:

  * **Cover is optional** — page 0 is NOT forced to be a cover-category
    template (covers can be skipped, §4.4). No "page 0 must be cover" rule.
  * **No quality / hero / orientation** — image slots carry none in V3, so there
    is no fill-in-hero check and no hero-slot protection. Aspect-ratio mismatch is
    the renderer's center-cover concern.
  * **Recognizes V3 template fields** — validation accepts ``svgs`` slots, the
    ``items`` repeat group, ``variableDecor`` flags, ``category``, chapter accent
    color and art font. Repeat-group content is addressed by the declared
    bracket-path slot ids (``cells[0].image``), already enumerated by the loader.

This WP delivers the V3 finalize *basis* (flatten + a V3-shaped validate). The
single merged validate (one path shared by finalize + edit) is WP5.1 — this is
the deterministic core it will build on, and it does not touch v2's
``finalize.validate_v2``.

Scope note: the external render contract ``AlbumLayoutPlan`` still carries the
legacy ``quality`` field on each photo (it mirrors @yujee/contracts
PhotoAnalysis, unchanged this WP). V3 input photos have no quality, so finalize
synthesizes a neutral ``"detail"`` quality on output — quality is inert in V3
(no hero protection consumes it). When the contract drops the field this synth
goes away.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from .. import templates as registry
from ..schemas import (
    THEME_ACCENT_CARRIER_SUFFIX,
    THEME_FONT_CARRIER_SUFFIX,
    THEME_USER_PROSE_ROLES,
    AlbumLayoutPlan,
    LayoutPhotoAnalysis,
    Magazine,
    Page,
    V3Chapter,
    V3FinalizeRequest,
    V3LayoutTree,
)


# V3 flat-layout page bound (matches v2's [1, 48]; the flat schema also enforces
# >= 1). A V3 album with no pages cannot ship.
_MAX_PAGES = 48

# Repeat-group / bracket-path slot key, e.g. ``cells[0].image`` or ``titles[3]``.
# The part before the first ``[`` is the base slot the template declares (image
# slots are enumerated per-index by the loader; repeat text slots stay as the
# base key with a numeric index).
_BASE_SLOT_RE = re.compile(r"^([^\[]+)")

# Neutral inert quality for the external render contract (see module docstring).
_V3_OUTPUT_QUALITY = "detail"

_DEFAULT_TITLE = {"en": "Life in photographs", "zh": "照片里的时光"}

# variableDecor theme-carrier 文法 (§3 树边界):章节 accentColor/artFont 烘焙进
# `page.texts` 的 STRING 值 —— 绝不是树形字段。约定是 `packages/contracts` 的单一真相源
# (`theme-carrier.ts` ↔ `schemas.py`),finalize 不再私有持有,改 import 共享定义:
#   * SVG variableDecor 槽 + EMPTY decoration variableDecor 槽 → 槽自己的
#     `texts[slotId]` 值即 accentColor(矢量/装饰字形以该色绘制)—— 这把 WP3.2 svg seam
#     收口为最终扁平形态。
#   * 持 USER PROSE(title)或 code-owned 装饰值(非空 date/folio)的 variableDecor 槽 →
#     内容保留,章节色/字体走 sibling carrier 键,prose/值永不被覆盖。
# A real slot id 是普通 id 或 bracket-path(`cells[0].image`),均不含 ``#``,故 carrier
# 键与声明槽零碰撞,validate_v3 只把它们认作 theme carrier。
_ACCENT_SUFFIX = THEME_ACCENT_CARRIER_SUFFIX
_FONT_SUFFIX = THEME_FONT_CARRIER_SUFFIX
_USER_PROSE_ROLES = THEME_USER_PROSE_ROLES


class FinalizeV3Error(Exception):
    """Raised when the flattened V3 layout fails validate_v3."""


def finalize_v3(request: V3FinalizeRequest) -> AlbumLayoutPlan:
    """Flatten a V3 layout tree + preview pages into the external AlbumLayoutPlan.

    Pure function (no LLM/network/DB). Steps:
      ① collect every photo referenced by the tree, shaped to the external
         render contract (synthesizing the inert legacy quality field);
      ② flatten the preview `pages` as-is (cover optional — no forced page 0),
         reindexing pageIndex sequentially;
      ②b bake each chapter's variableDecor theme (accentColor / artFont, incl.
         the WP3.2 svg seam) into that chapter's flat pages — the per-chapter
         color/font lives ONLY in the tree until this point (§3 树边界), and is
         landed into `pages[].texts` here so the flat render contract never
         carries a tree-shaped field;
      ③ build the magazine header from the language + first chapter;
      ④ hard-validate the flat layout with the SINGLE `validate_v3` (§6.8 第 7
         条 校验单一真相源) and raise on the first violation.
    """
    language = request.language

    photos = _collect_photos(request)
    pages = _flatten_pages(request.pages)
    pages = _bake_variable_decor(pages, request.tree)
    magazine = _magazine(request, language)

    layout = AlbumLayoutPlan(magazine=magazine, photos=photos, pages=pages)

    problem = validate_v3(layout)
    if problem is not None:
        raise FinalizeV3Error(problem)
    return layout


# ---------- ① photos ----------------------------------------------------------


def _collect_photos(request: V3FinalizeRequest) -> list[LayoutPhotoAnalysis]:
    """Every distinct photo in the tree, in first-seen order, shaped for output.

    Description comes from the chapter photo's ``sceneDescription``; tags default
    empty (V3 has no tag dimension here); ``quality`` is the inert neutral value
    (see module docstring); orientation is carried through; focal is omitted (no
    focal dimension in the V3 chapter photo → renderer 50/50 default)."""
    out: list[LayoutPhotoAnalysis] = []
    seen: set[str] = set()
    for chapter in request.tree.chapters:
        for photo in chapter.photos:
            if photo.photoId in seen:
                continue
            seen.add(photo.photoId)
            out.append(
                LayoutPhotoAnalysis(
                    photoId=photo.photoId,
                    description=photo.sceneDescription,
                    tags=[],
                    quality=_V3_OUTPUT_QUALITY,
                    orientation=photo.orientation,
                )
            )
    return out


# ---------- ② flatten ---------------------------------------------------------


def _flatten_pages(pages: list[Page]) -> list[Page]:
    """Reindex the preview pages sequentially from 0, order preserved.

    Cover optionality lives here: we do NOT inject or require a cover page — the
    pages arrive in their authored order and we only renumber pageIndex so the
    flat layout is contiguous."""
    return [page.model_copy(update={"pageIndex": idx}) for idx, page in enumerate(pages)]


# ---------- ②b variableDecor bake (章节色/字体/SVG → 扁平页, §3 树边界 收口) ----


def _bake_variable_decor(pages: list[Page], tree: V3LayoutTree) -> list[Page]:
    """Bake every chapter's `{accentColor, artFont}` into that chapter's flat pages.

    This lands the §3 树边界 contract: the per-chapter theme lives ONLY in the tree
    (`V3Chapter.accentColor/artFont`) through analyze/story/theme/cover; finalize is
    the single point where it is baked into the flat `page.texts` so the render
    contract (`magazine + photos + pages[]`) never carries a tree-shaped field.

    Page→chapter mapping: V3 is 一图一章不跨章, so a body page's photos all belong to
    one chapter. We map each page to the FIRST chapter that owns any of the page's
    image photoIds. Pages with no owning chapter (e.g. a WP4.1 cover/ending spread
    not tied to a chapter, or a page whose chapter has a null theme) are left exactly
    as-is — no theme to bake. Idempotent: re-baking the same tree yields identical
    texts (it overwrites the carriers / svg-seam values, never appends)."""
    owner = _page_chapter_index(pages, tree)
    out: list[Page] = []
    for page in pages:
        chapter = owner.get(page.pageIndex)
        if chapter is None or chapter.accentColor is None:
            # No resolvable chapter, or chapter theme not chosen yet → nothing to bake.
            out.append(page)
            continue
        out.append(_bake_page(page, chapter.accentColor, chapter.artFont))
    return out


def _page_chapter_index(
    pages: list[Page], tree: V3LayoutTree
) -> dict[int, V3Chapter]:
    """Map each page's `pageIndex` to its owning chapter via photoId membership.

    Builds a photoId → chapter lookup (first-seen chapter wins, matching the
    first-seen dedupe in `_collect_photos`), then assigns each page to the chapter
    owning its first resolvable image photoId. A page whose photos belong to no
    chapter is simply absent from the result (left un-themed by the caller)."""
    photo_owner: dict[str, V3Chapter] = {}
    for chapter in tree.chapters:
        for photo in chapter.photos:
            photo_owner.setdefault(photo.photoId, chapter)

    mapping: dict[int, V3Chapter] = {}
    for page in pages:
        for photo_id in page.images.values():
            chapter = photo_owner.get(photo_id)
            if chapter is not None:
                mapping[page.pageIndex] = chapter
                break
    return mapping


def _bake_page(page: Page, accent_color: str, art_font: str | None) -> Page:
    """Return a copy of `page` with its template's variableDecor slots themed.

    * SVG variableDecor slots → `texts[svgId] = accent_color` (the vector is painted
      in the accent color; lands the WP3.2 apply-theme svg seam as the final flat
      form, re-derived from the tree so the tree is the single source of truth).
    * variableDecor TEXT slots (standalone + inside the `items` repeat group):
        - an EMPTY decoration slot → `texts[slotId] = accent_color` (a pure-decoration
          glyph the renderer paints in the accent color);
        - a slot holding USER PROSE (title) or a non-empty code-owned decoration value
          → content is kept verbatim; the chapter color/font ride sibling carrier keys
          `texts[slotId#accentColor]` / `texts[slotId#artFont]` (never clobbered).
    Non-variableDecor slots and 普通正文 (body/explain) values are never touched."""
    template = registry.get(page.templateId)
    if template is None:
        # Unknown template (validate_v3 will reject it later); nothing to bake.
        return page

    texts = dict(page.texts)

    for svg in template.get("svgs") or []:
        if not svg.get("variableDecor"):
            continue
        slot_id = svg.get("id")
        if slot_id:
            texts[slot_id] = accent_color

    _bake_text_slots(texts, registry.text_slots(template), accent_color, art_font)
    items = template.get("items")
    if items:
        _bake_text_slots(texts, items.get("texts") or [], accent_color, art_font)

    return page.model_copy(update={"texts": texts})


def _bake_text_slots(
    texts: dict[str, str],
    slots: list[dict[str, Any]],
    accent_color: str,
    art_font: str | None,
) -> None:
    """Bake the chapter theme into the variableDecor TEXT slots of one slot list.

    Mutates `texts` in place. For repeat-group (`items`) slots the declared base id
    may be addressed per-index in the page (`caption[0]`); we theme every present key
    whose base matches a variableDecor slot, plus the bare base key if present."""
    for slot in slots:
        if not slot.get("variableDecor"):
            continue
        slot_id = slot.get("id")
        if not slot_id:
            continue
        role = str(slot.get("role") or "")
        for key in _matching_text_keys(texts, slot_id):
            existing = texts.get(key)
            if role in _USER_PROSE_ROLES or existing:
                # Keep user prose / code-owned decoration value; theme rides carriers.
                texts[f"{key}{_ACCENT_SUFFIX}"] = accent_color
                if art_font is not None:
                    texts[f"{key}{_FONT_SUFFIX}"] = art_font
            else:
                # Empty decoration slot the theme owns → the accent color glyph.
                texts[key] = accent_color
        if not _matching_text_keys(texts, slot_id):
            # Slot declared variableDecor but not present on the page (e.g. an empty
            # decoration slot generic-copy never filled): bake the accent color in.
            if role not in _USER_PROSE_ROLES:
                texts[slot_id] = accent_color
            else:
                texts[f"{slot_id}{_ACCENT_SUFFIX}"] = accent_color
                if art_font is not None:
                    texts[f"{slot_id}{_FONT_SUFFIX}"] = art_font


def _matching_text_keys(texts: dict[str, str], base_slot: str) -> list[str]:
    """Present text keys whose base slot == `base_slot` (bare id or bracket-path).

    A repeat-group base ``caption`` matches ``caption``, ``caption[0]``, ``caption[1]``;
    carrier keys (``…#accentColor``) are excluded so re-baking is idempotent."""
    out: list[str] = []
    for key in texts:
        if _ACCENT_SUFFIX in key or _FONT_SUFFIX in key:
            continue
        if _base_slot(key) == base_slot:
            out.append(key)
    return out


# ---------- ③ magazine header -------------------------------------------------


def _magazine(request: V3FinalizeRequest, language: str) -> Magazine:
    title = _first_nonempty_description(request) or _DEFAULT_TITLE.get(
        language, _DEFAULT_TITLE["en"]
    )
    return Magazine(
        title=_clamp(title, 60),
        subtitle=None,
        style="editorial",
        language=language,
    )


def _first_nonempty_description(request: V3FinalizeRequest) -> str:
    for chapter in request.tree.chapters:
        text = (chapter.description or "").strip()
        if text:
            return text
    return ""


def _clamp(text: str, max_chars: int) -> str:
    return text if len(text) <= max_chars else text[:max_chars].rstrip()


# ---------- ④ validate_v3 -----------------------------------------------------


def _base_slot(slot: str) -> str:
    match = _BASE_SLOT_RE.match(slot)
    return match.group(1) if match else slot


def _carrier_base(slot: str) -> str | None:
    """The owning slot id of a theme-carrier key, or None if `slot` is not a carrier.

    `title#accentColor` → `title`; `caption[0]#artFont` → `caption[0]`. Returns None
    for a plain slot id so the normal slot-membership check runs."""
    for suffix in (_ACCENT_SUFFIX, _FONT_SUFFIX):
        if slot.endswith(suffix):
            return slot[: -len(suffix)]
    return None


def _is_variable_decor_slot(
    slot_key: str,
    text_by_id: dict[str, Any],
    item_text_by_id: dict[str, Any],
    svg_ids: set[str],
) -> bool:
    """Whether `slot_key` (bare id or bracket-path) names a declared variableDecor slot.

    Resolves the key's base against the template's text slots, `items` text slots and
    svg slots; only a slot marked ``variableDecor:true`` may carry a baked theme."""
    base = _base_slot(slot_key)
    text_slot = text_by_id.get(base) or item_text_by_id.get(base)
    if text_slot is not None and text_slot.get("variableDecor"):
        return True
    return base in svg_ids


def validate_v3(layout: AlbumLayoutPlan) -> str | None:
    """V3 flat-layout hard rules. Returns the first violation as a human-readable
    string, or None when the layout is shippable.

    Differs from v2 ``finalize.validate_v2``:
      * NO "page 0 must be cover" rule — covers are optional in V3.
      * NO fill-in-hero / quality / orientation check — those dimensions are gone.
      * Recognizes V3 repeat-group / bracket-path slots, ``svgs`` and ``items``
        via the loader's declared slot ids.

    Enforced:
      * 1..48 pages, sequential pageIndex.
      * Every template id is known.
      * Every image/text slot key belongs to its template. V3 allows larger
        templates to be underfilled when a legal candidate only needs capacity
        >= N, so only present image keys are validated.
      * Bracket-path text keys are accepted only for declared repeat bases.
      * Every referenced photoId exists in photos[]; no photo twice on one page;
        no photo reused more than twice across the album; no unused photo.
    """
    pages = layout.pages
    photo_ids = {photo.photoId for photo in layout.photos}

    if not 1 <= len(pages) <= _MAX_PAGES:
        return f"pages count {len(pages)} outside supported range 1..{_MAX_PAGES}"

    for expected_idx, page in enumerate(pages):
        if page.pageIndex != expected_idx:
            return (
                f"pageIndex {page.pageIndex} at position {expected_idx} "
                f"(must be sequential)"
            )

    used_counts: Counter[str] = Counter()
    for page in pages:
        template = registry.get(page.templateId)
        if template is None:
            return f"page {page.pageIndex}: templateId {page.templateId} not in TemplateRegistry"

        image_by_id = registry.image_slot_map(template)
        text_by_id = registry.text_slot_map(template)
        # svg decoration slots (§9) live in `page.texts` as a themed-decoration carrier
        # baked by finalize (WP5.1; seam from apply-theme WP3.2 #190): the slot's value
        # is the chapter accent color the renderer paints the vector in. They are NOT
        # text slots, so accept their ids here too (additive, V3-only — v2 finalize.py
        # is untouched).
        svg_ids = {svg["id"] for svg in (template.get("svgs") or [])}
        # `items` repeat-group declared text-slot bases (§9): the unique V3 repeat
        # carrier (replaces the deprecated top-level `repeat:true`). An items text slot
        # may appear in page.texts as the bare base (`caption`) or per-index
        # (`caption[0]`). variableDecor flags ride the slot defs themselves.
        items = template.get("items") or {}
        item_text_by_id = {slot["id"]: slot for slot in (items.get("texts") or [])}

        for slot in page.images:
            if slot not in image_by_id:
                return (
                    f"page {page.pageIndex}: image slot '{slot}' not in "
                    f"template {page.templateId}"
                )
        for slot in page.texts:
            # ②b theme carriers (§3 树边界): finalize bakes the chapter accentColor/
            # artFont into `<slotId>#accentColor` / `<slotId>#artFont` string keys when
            # the slot holds user prose / a code-owned value. Accept a carrier iff its
            # owning slot is a declared variableDecor slot (svg / text / items.text).
            carrier_base = _carrier_base(slot)
            if carrier_base is not None:
                if _is_variable_decor_slot(carrier_base, text_by_id, item_text_by_id, svg_ids):
                    continue
                return (
                    f"page {page.pageIndex}: theme carrier '{slot}' has no "
                    f"variableDecor slot in template {page.templateId}"
                )
            base = _base_slot(slot)
            text_slot = text_by_id.get(base)
            if text_slot is None:
                if slot in svg_ids:
                    continue  # themed svg-decoration key (baked), not a text slot
                item_slot = item_text_by_id.get(base)
                if item_slot is not None:
                    continue  # declared `items` repeat-group text slot (bare or [i])
                return (
                    f"page {page.pageIndex}: text slot '{slot}' not in "
                    f"template {page.templateId}"
                )
            if "[" in slot and not text_slot.get("repeat"):
                return (
                    f"page {page.pageIndex}: text slot '{slot}' is not a repeat "
                    f"slot in template {page.templateId}"
                )

        seen_on_page: set[str] = set()
        for slot, pid in page.images.items():
            if pid not in photo_ids:
                return f"page {page.pageIndex}: photoId {pid} not in photos[]"
            if pid in seen_on_page:
                return f"page {page.pageIndex}: photoId {pid} used twice on same page"
            seen_on_page.add(pid)
            used_counts[pid] += 1

    unused = [pid for pid in photo_ids if used_counts[pid] == 0]
    if unused:
        return f"unused photos: {sorted(unused)[:3]}"

    # Album-wide reuse cap: a photo may appear at most twice TOTAL. Unlike v2
    # (which exempts page 0 because page 0 is always the cover), V3 has an
    # optional cover, so there is no special first page — every placement counts.
    overused = [pid for pid, count in used_counts.items() if count > 2]
    if overused:
        return f"photos reused more than 2 times: {sorted(overused)[:3]}"

    return None
