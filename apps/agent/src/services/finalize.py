"""Stage 5 finalize for Agent v2 — deterministic AlbumDraft → LayoutV2.

This is a pure function (no LLM, no network, no DB). It implements
docs/agent/rebuild-tech-plan.md §5.2:

  ⓪ ensure a complete theme (derive_default_theme when /theme was skipped),
  ① fill ambiance copy for chapters that were never chatted (no invented
     proper nouns — only photo analysis + EXIF/cluster facts, §10.3),
  ② write the ending closing line (mixed: anchor on user words when present),
  ③ build the TOC (mag-02, flat bracket-path `items[i].title` keys, P0-3),
  ④ derive cover/ending under the reuse budget (≤2, ending first, cover falls
     back to active template-compatible pages when no photo budget remains, §4.4 / P0-4),
  ⑤ flatten the tree to a contiguous pages[] (cover → toc? → chapters → ending)
     and strip photos to the external 5-field PhotoAnalysis (tree never leaks,
     invariant 12),
  ⑥ validate the flat layout (validate_v2): pages ∈ [1, 48], first page is a
     cover category template, fill-in-hero is exempt only for cover/ending, no
     photoId used more than twice.

The deterministic §4.4 cover/ending/toc construction is shared with the W1
skeleton engine — finalize re-derives ending/toc (and the cover, unless the user
authored one via /theme) from the (possibly regrouped) tree so the flat layout
always satisfies validate_v2 regardless of stale basePages.

Scope: this is the deterministic finalize *core* (issue #117). The §5.2 LLM
niceties — model-written ambiance/ending prose and `smooth_tone_and_template_
rhythm` — are deferred to the route/LLM integration layer; here every text slot
gets safe deterministic copy so the function stays pure and CI runs token-free.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Mapping

from .. import templates as registry
from ..schemas import Magazine, Page, PhotoAnalysis
from ..schemas_v2 import (
    AlbumDraft,
    LayoutV2,
    V2Chapter,
    V2Photo,
    V2Theme,
)
from . import layout_rules, skeleton


# v2 page bound (tech-plan §5.2 / M2): content-driven, not a formula. The flat
# layout schema (LayoutV2) also enforces this; validate_v2 restates it so a
# violation surfaces as a readable AGENT_OUTPUT_VALIDATION string.
_MAX_PAGES = 48

_DEFAULT_SUBJECT = {"en": "Life in photographs", "zh": "照片里的时光"}


class FinalizeError(Exception):
    """Raised when the flattened layout fails validate_v2 (→ AGENT_OUTPUT_VALIDATION)."""


# ---------- public entry point ------------------------------------------------


def finalize(draft: AlbumDraft) -> LayoutV2:
    """Flatten an authoring tree into the external flat LayoutV2."""

    theme = ensure_theme(draft)
    language = draft.meta.language
    pool_by_id = {photo.photoId: photo for photo in draft.photoPool}
    used_photos = [photo for photo in draft.photoPool if photo.used]

    # ① + chapter pages — keep image assignments; fill texts for un-chatted chapters.
    body_pages: list[dict[str, Any]] = []
    toc_chapters: list[dict[str, Any]] = []
    for chapter in draft.chapters:
        body_pages.extend(_chapter_pages(chapter, pool_by_id, theme, language))
        toc_chapters.append(
            {"chapterId": chapter.chapterId, "cluster": chapter.cluster.model_dump()}
        )

    # ④ ending is always re-derived under the shared §4.4 reuse budget (ending
    #    first; it has no user-authored customization). The cover is re-derived
    #    too, EXCEPT when the /theme stage already chose one — then we preserve
    #    the user's cover (template + hero photo) and only backfill empty texts,
    #    matching §5.2's `ensure_cover`-only-when-theme-missing intent.
    skeleton_photos = [_skeleton_photo(photo) for photo in used_photos]
    derived_cover, ending = skeleton.build_base_pages("", skeleton_photos, body_pages)
    ending["texts"] = _ending_texts(ending["templateId"], theme, draft, language)

    draft_cover = draft.basePages.cover
    if _theme_authored(draft.meta.theme) and _is_valid_cover(draft_cover):
        cover = _with_image_pos(
            {
                "pageIndex": 0,
                "templateId": draft_cover.templateId,
                "images": dict(draft_cover.images),
                "texts": layout_rules.clamp_texts_for_template(
                    draft_cover.templateId, dict(draft_cover.texts)
                )
                or _cover_texts(draft_cover.templateId, theme),
            },
            draft_cover,
        )
    else:
        cover = derived_cover
        cover["texts"] = _cover_texts(cover["templateId"], theme)

    # ③ TOC decision uses the page count before the optional TOC page (matches
    # skeleton.needs_toc): ≥4 chapters AND ≥8 pages.
    total_without_toc = 1 + len(body_pages) + 1
    toc: dict[str, Any] | None = None
    if skeleton.needs_toc(toc_chapters, total_without_toc):
        toc = skeleton.build_toc(toc_chapters)
        toc["texts"] = _clamp_array_texts("mag-02", toc["texts"])

    # ⑤ flatten + reindex (cover → toc? → chapters → ending).
    flat_pages = [cover]
    if toc is not None:
        flat_pages.append(toc)
    flat_pages.extend(body_pages)
    flat_pages.append(ending)
    for page_index, page in enumerate(flat_pages):
        page["pageIndex"] = page_index

    magazine = _magazine(theme, draft)
    photos = [_strip_to_base5(photo) for photo in used_photos]
    pages = [Page(**page) for page in flat_pages]
    layout = LayoutV2(magazine=magazine, photos=photos, pages=pages)

    # ⑥ hard validation (invariant 9).
    problem = validate_v2(layout)
    if problem is not None:
        raise FinalizeError(problem)
    return layout


# ---------- ⓪ ensure theme ----------------------------------------------------


def ensure_theme(draft: AlbumDraft) -> V2Theme:
    """Return a complete V2Theme, deriving a deterministic default when the user
    skipped /theme and went straight to finalize (tech-plan §5.2 / B7).

    No LLM here: subject = existing subject → promptHint → first chapter label →
    language default; tone defaults to ``warm``; style falls back to meta.style.
    """

    partial = draft.meta.theme
    subject = (
        _nonempty(partial.subject if partial else None)
        or _nonempty(draft.meta.promptHint)
        or _first_chapter_label(draft)
        or _DEFAULT_SUBJECT.get(draft.meta.language, _DEFAULT_SUBJECT["en"])
    )
    tone = _nonempty(partial.tone if partial else None) or "warm"
    style = (partial.style if partial and partial.style else None) or draft.meta.style
    return V2Theme(
        subject=subject,
        occasion=_nonempty(partial.occasion if partial else None) or None,
        timeframe=_nonempty(partial.timeframe if partial else None) or None,
        tone=tone,
        style=style,
    )


def _first_chapter_label(draft: AlbumDraft) -> str:
    for chapter in draft.chapters:
        label = chapter.cluster.label.strip()
        if label:
            return label
    return ""


def _theme_authored(theme: Any) -> bool:
    """True when the user reached the /theme stage (a real subject was set), so a
    cover the user customized must be preserved rather than re-derived."""

    return bool(theme is not None and _nonempty(theme.subject))


def _is_valid_cover(cover: Page) -> bool:
    tpl = registry.get(cover.templateId)
    if tpl is None or tpl["slot"] != "cover":
        return False
    return all(slot in cover.images for slot in registry.image_slot_ids(tpl))


# ---------- ① chapter ambiance copy ------------------------------------------


def _chapter_pages(
    chapter: V2Chapter,
    pool_by_id: Mapping[str, V2Photo],
    theme: V2Theme,
    language: str,
) -> list[dict[str, Any]]:
    # Chapters the user actually authored keep their copy; everything else gets
    # safe ambiance copy that invents no proper nouns (§10.3).
    keep_texts = chapter.state in ("generated", "finalized")
    pages: list[dict[str, Any]] = []
    for page in chapter.pages:
        if keep_texts and page.texts:
            texts = layout_rules.clamp_texts_for_template(page.templateId, dict(page.texts))
        else:
            texts = _ambiance_texts(page, chapter, pool_by_id, language)
        pages.append(
            _with_image_pos(
                {
                    "pageIndex": 0,
                    "templateId": page.templateId,
                    "images": dict(page.images),
                    "texts": texts,
                },
                page,
            )
        )
    return pages


def _with_image_pos(flat: dict[str, Any], src: Page) -> dict[str, Any]:
    """Flatten the per-slot position override through finalize (#165 invariant
    12). Only slots that actually carry an override survive; absent slots stay
    absent so the renderer applies its 50/50/1 default and pre-#165 albums are
    byte-unchanged. A slot whose photo no longer appears in `images` is dropped
    (a stale override on a removed image must not ride along)."""

    src_pos = getattr(src, "imagePos", None)
    if not src_pos:
        return flat
    kept = {slot: pos for slot, pos in src_pos.items() if slot in flat["images"]}
    if kept:
        flat["imagePos"] = {slot: pos.model_dump() for slot, pos in kept.items()}
    return flat


def _ambiance_texts(
    page: Page,
    chapter: V2Chapter,
    pool_by_id: Mapping[str, V2Photo],
    language: str,
) -> dict[str, str]:
    """Deterministic atmosphere copy for an un-chatted chapter page.

    Only ``cluster.place`` / ``cluster.timeRange`` (EXIF/grouping facts from the
    tree) may appear as concrete names — never anything the model invented
    (§10.3 / test_v2_skipped_no_proper_nouns)."""

    tpl = registry.get(page.templateId)
    if not tpl:
        return {}
    place = _nonempty(chapter.cluster.place)
    time_range = _nonempty(chapter.cluster.timeRange)
    summary = _page_photo_summary(page, pool_by_id, language)
    detail = _join(place, time_range, summary) or summary

    texts: dict[str, str] = {}
    for meta in tpl["texts"]:
        slot = meta["id"]
        role = meta["role"]
        if role == "decoration":  # was 'meta' (and now folds in the old 'label')
            continue
        if meta.get("repeat") is True:  # was type=='array'
            texts[slot] = (
                _join(place, time_range, "soft light, quiet details")
                if language == "en"
                else _join(place, time_range, "柔和光线、安静细节")
            )
        elif role == "title":  # was 'heading'
            texts[slot] = (
                _join(place, "moments") if language == "en" else _join(place, "时光")
            ) or ("quiet moments" if language == "en" else "安静片刻")
        elif role == "explain":  # was 'caption' (old 'quote' now maps to 'body')
            texts[slot] = (
                _join(place, time_range)
                or ("visible details" if language == "en" else "照片细节")
            )
        else:  # body (was 'paragraph'/'quote') and any other copy
            texts[slot] = detail
    return layout_rules.clamp_texts_for_template(page.templateId, texts)


def _page_photo_summary(
    page: Page,
    pool_by_id: Mapping[str, V2Photo],
    language: str,
) -> str:
    photos = [pool_by_id[pid] for pid in page.images.values() if pid in pool_by_id]
    if not photos:
        return (
            "A quiet pause between the surrounding photographs."
            if language == "en"
            else "这一页留住相邻照片之间的安静停顿。"
        )
    if language == "zh":
        return "照片里有柔和的光线、动作和细节。"
    moods = sorted({p.analysis.mood for p in photos if p.analysis.mood})
    scenes = sorted({p.analysis.scene for p in photos if p.analysis.scene})
    mood = moods[0] if moods else "quiet"
    scene = scenes[0] if scenes else "scene"
    return f"A {mood} {scene} page shaped by light, texture, and small gestures."


# ---------- ② ending closing line + cover copy --------------------------------


def _ending_texts(
    template_id: str,
    theme: V2Theme,
    draft: AlbumDraft,
    language: str,
) -> dict[str, str]:
    anchor = _closing_anchor(draft)
    line = anchor or _default_ending_line(theme, language)
    secondary = theme.timeframe or theme.occasion or theme.subject
    return _frame_texts(template_id, [line, secondary, theme.tone])


def _closing_anchor(draft: AlbumDraft) -> str:
    """Mixed ending: anchor on the user's own closing words when the closing
    chapter recorded any (§4.4)."""

    # closing chapters first, then the rest — each scanned once.
    closing = [c for c in draft.chapters if c.cluster.role == "closing"]
    others = [c for c in draft.chapters if c.cluster.role != "closing"]
    for chapter in closing + others:
        brief = chapter.brief
        if brief:
            words = _nonempty(brief.userWords) or _nonempty(brief.factNote)
            if words:
                return words
    return ""


def _default_ending_line(theme: V2Theme, language: str) -> str:
    if language == "zh":
        return "故事仍在继续。"
    return "The story continues."


def _cover_texts(template_id: str, theme: V2Theme) -> dict[str, str]:
    subtitle = theme.occasion or theme.timeframe or theme.tone
    return _frame_texts(template_id, [theme.subject, subtitle, theme.tone])


def _frame_texts(template_id: str, values: list[str]) -> dict[str, str]:
    """Fill every non-meta text slot of a cover/ending frame template, cycling
    through `values` so each slot gets real, non-empty copy."""

    tpl = registry.get(template_id)
    if not tpl:
        return {}
    fallback = values[0] if values else ""
    texts: dict[str, str] = {}
    index = 0
    for meta in tpl["texts"]:
        slot = meta["id"]
        # role=='decoration' folds in the former 'meta' (page numbers); skip it,
        # matching the prior `type == 'meta'` exclusion of decorative slots.
        if meta["role"] == "decoration":
            continue
        value = values[index] if index < len(values) else fallback
        index += 1
        if value:
            texts[slot] = value
    return layout_rules.clamp_texts_for_template(template_id, texts)


def _clamp_array_texts(template_id: str, texts: dict[str, str]) -> dict[str, str]:
    """Clamp flat bracket-path values against their base array slot's max chars.

    clamp_texts_for_template only matches literal slot keys, so it silently skips
    `items[i].title`; resolve the base slot (`items`) before reading maxChars so a
    pathologically long chapter label can't ship unbounded into the TOC."""

    tpl = registry.get(template_id)
    if not tpl:
        return dict(texts)
    text_by_id = registry.text_slot_map(tpl)
    out: dict[str, str] = {}
    for key, value in texts.items():
        cons = text_by_id.get(key.split("[", 1)[0])
        max_chars = cons.get("maxChars") if cons else None
        out[key] = (
            layout_rules.clamp_text(value, max_chars)
            if isinstance(max_chars, int)
            else value
        )
    return out


# ---------- ⑤ flatten helpers -------------------------------------------------


def _skeleton_photo(photo: V2Photo) -> dict[str, Any]:
    """Minimal photo shape the deterministic skeleton engine consumes (quality +
    orientation drive placement; order breaks ties)."""

    analysis: dict[str, Any] = {
        "photoId": photo.photoId,
        "quality": photo.analysis.quality,
        "orientation": photo.analysis.orientation,
    }
    # #169: carry focal so the re-derived cover/ending also get the focal-driven
    # default imagePos (skeleton.build_image_pos reads analysis.focal).
    if photo.analysis.focal is not None:
        analysis["focal"] = photo.analysis.focal.model_dump()
    return {
        "photoId": photo.photoId,
        "analysis": analysis,
        "exif": {"order": photo.exif.order},
        "used": True,
    }


def _strip_to_base5(photo: V2Photo) -> PhotoAnalysis:
    """Drop the internal extension fields (peopleCount/scene/mood/timeOfDay) so
    the external contract keeps only the base fields (invariant 12).

    #169: `focal` is a BASE field, not an extension — it MUST survive finalize so
    the flat layout's default imagePos can center on the subject. Keep it."""

    analysis = photo.analysis
    return PhotoAnalysis(
        photoId=analysis.photoId,
        description=analysis.description,
        tags=list(analysis.tags),
        quality=analysis.quality,
        orientation=analysis.orientation,
        focal=analysis.focal,
    )


def _magazine(theme: V2Theme, draft: AlbumDraft) -> Magazine:
    title = layout_rules.clamp_text(theme.subject, 60) or _DEFAULT_SUBJECT.get(
        draft.meta.language, _DEFAULT_SUBJECT["en"]
    )
    subtitle_raw = theme.occasion or theme.timeframe or theme.tone
    subtitle = layout_rules.clamp_text(subtitle_raw, 100) if subtitle_raw else None
    return Magazine(
        title=title,
        subtitle=subtitle,
        style=draft.meta.style,
        language=draft.meta.language,
    )


# ---------- ⑥ validate_v2 -----------------------------------------------------


def validate_v2(layout: LayoutV2) -> str | None:
    """v2 flat-layout hard rules (tech-plan §5.2). Returns the first violation as
    a human-readable string, or None when the layout is shippable.

    Differs from the v1 layout_rules.violation in three ways:
      ① page bound is [1, 48], not [1, 16];
      ② fill-in-hero is exempt on the cover (page 0) and ending (last page) —
         those frame pages have no alternative template and are absorbed by
         center-cover rendering (§4.4 ruling);
      ③ first page is identified by ``category == 'cover'`` (P2-9), not a name
         prefix.
    """

    pages = layout.pages
    photos = layout.photos
    photo_ids = {photo.photoId for photo in photos}
    by_id = {photo.photoId: photo for photo in photos}

    if not 1 <= len(pages) <= _MAX_PAGES:
        return f"pages count {len(pages)} outside supported range 1..{_MAX_PAGES}"

    first_tpl = registry.get(pages[0].templateId)
    if not first_tpl:
        return f"page 0 templateId {pages[0].templateId} not in TemplateRegistry"
    if first_tpl["slot"] != "cover":
        return (
            f"page 0 templateId {pages[0].templateId} "
            f"category={first_tpl['slot']} (must be cover)"
        )

    for expected_idx, page in enumerate(pages):
        if page.pageIndex != expected_idx:
            return f"pageIndex {page.pageIndex} at position {expected_idx} (must be sequential)"

    ending_index = len(pages) - 1
    used_counts: Counter[str] = Counter()
    reuse_counts: Counter[str] = Counter()
    for index, page in enumerate(pages):
        tpl = registry.get(page.templateId)
        if not tpl:
            return f"page {page.pageIndex}: templateId {page.templateId} not in TemplateRegistry"

        image_by_id = registry.image_slot_map(tpl)
        text_by_id = registry.text_slot_map(tpl)
        for slot in page.images:
            if slot not in image_by_id:
                return f"page {page.pageIndex}: image slot '{slot}' not in template {page.templateId}"
        for slot in page.texts:
            # Repeat slots are written as flat bracket-path keys (`items[i].title`)
            # that the Web adapter rebuilds into an array; validate the base slot
            # and require it to be a `repeat` slot (P0-3).
            base = slot.split("[", 1)[0]
            cons = text_by_id.get(base)
            if cons is None:
                return f"page {page.pageIndex}: text slot '{slot}' not in template {page.templateId}"
            if base != slot and cons.get("repeat") is not True:
                return (
                    f"page {page.pageIndex}: bracket-path key '{slot}' on non-array "
                    f"slot '{base}' in template {page.templateId}"
                )
        for slot in image_by_id:
            if slot not in page.images:
                return f"page {page.pageIndex}: missing image slot '{slot}' in template {page.templateId}"

        hero_exempt = index == 0 or index == ending_index
        seen_on_page: set[str] = set()
        for slot, pid in page.images.items():
            if pid not in photo_ids:
                return f"page {page.pageIndex}: photoId {pid} not in photos[]"
            if pid in seen_on_page:
                return f"page {page.pageIndex}: photoId {pid} used twice on same page"
            seen_on_page.add(pid)
            used_counts[pid] += 1
            if index != 0:
                reuse_counts[pid] += 1

            if not hero_exempt and _fill_in_hero(by_id[pid], image_by_id[slot]):
                return (
                    f"page {page.pageIndex} slot '{slot}': fill photo {pid} "
                    f"cannot be placed in hero slot"
                )

    unused = [pid for pid in photo_ids if used_counts[pid] == 0]
    if unused:
        return f"unused photos: {unused[:3]}"

    overused = [pid for pid, count in reuse_counts.items() if count > 2]
    if overused:
        return f"photos reused more than 2 times: {overused[:3]}"

    return None


def _fill_in_hero(photo: PhotoAnalysis, constraint: Mapping[str, Any]) -> bool:
    qualities = constraint.get("quality") or []
    return photo.quality == "fill" and "hero" in qualities and "fill" not in qualities


# ---------- small utilities ---------------------------------------------------


def _nonempty(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _join(*parts: str) -> str:
    return " ".join(part for part in parts if part)
