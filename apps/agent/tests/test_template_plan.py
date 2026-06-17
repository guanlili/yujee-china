"""Unit tests for the #172 LLM one-shot template planner.

The LLM is always MOCKED (no live calls). Covers: a valid plan → valid pages;
hallucinated templateId → repaired/dropped; page photo-count != slot count →
repaired; missing/duplicate photoId handled; unparseable/empty output →
deterministic fallback. The deterministic skeleton path is verified to stay the
safety net (validate_and_build_chapter_pages returns [] → caller falls back)."""

from __future__ import annotations

import asyncio
import json
from collections import Counter
from typing import Any

import pytest

from src import templates as registry
from src.schemas_v2 import V2Chapter, V2Cluster, V2Exif, V2Photo, V2PhotoAnalysis
from src.services import skeleton, template_plan


# ---------- fixtures ----------------------------------------------------------


def _analysis(idx: int, quality: str = "detail", orientation: str = "portrait") -> V2PhotoAnalysis:
    return V2PhotoAnalysis(
        photoId=f"p{idx}",
        description=f"photo {idx}",
        tags=["test"],
        quality=quality,
        orientation=orientation,
        peopleCount="1",
        scene="outdoor",
        mood="warm",
    )


def _photo(idx: int, quality: str = "detail", orientation: str = "portrait") -> V2Photo:
    return V2Photo(
        photoId=f"p{idx}",
        analysis=_analysis(idx, quality, orientation),
        exif=V2Exif(takenAt=None, place=None, order=idx),
        duplicateOf=None,
        used=True,
    )


def _chapter(chapter_id: str, photo_ids: list[str]) -> V2Chapter:
    return V2Chapter(
        chapterId=chapter_id,
        state="empty",
        cluster=V2Cluster(label="Chapter", timeRange=None, place=None, role="body"),
        photoIds=photo_ids,
        pages=[],
    )


def _skeleton_input(photos: list[V2Photo], chapters: list[V2Chapter]) -> dict[str, Any]:
    return {
        "albumId": "alb_plan",
        "photos": [p.model_dump(mode="json") for p in photos],
        "chapters": [c.model_dump(mode="json") for c in chapters],
    }


def _complete_returning(payload: dict[str, Any]):
    async def complete(**_kwargs: Any):
        return {
            "choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 7},
        }

    return complete


def _complete_raw(content: str | None):
    async def complete(**_kwargs: Any):
        return {
            "choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0},
        }

    return complete


# helper: pick a valid interior templateId for a given photo count.
def _interior_template_for_count(count: int) -> str:
    for tid in registry.TEMPLATE_IDS:
        tpl = registry.TEMPLATES[tid]
        if tpl["slot"] == "interior" and tid != "mag-02" and len(tpl["images"]) == count:
            return tid
    raise AssertionError(f"no interior template with {count} image slots")


# ---------- valid plan --------------------------------------------------------


def test_valid_plan_produces_pages_with_matching_slot_counts():
    photos = [_photo(1, "hero"), _photo(2, "detail"), _photo(3, "detail")]
    chapter = _chapter("ch1", ["p1", "p2", "p3"])
    t1 = _interior_template_for_count(1)
    t2 = _interior_template_for_count(2)
    payload = {
        "pages": [
            {"chapterId": "ch1", "templateId": t1, "photoIds": ["p1"]},
            {"chapterId": "ch1", "templateId": t2, "photoIds": ["p2", "p3"]},
        ]
    }
    raw, _usage = asyncio.run(
        template_plan.plan_templates(
            [chapter], photos, "en", complete=_complete_returning(payload)
        )
    )
    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, [chapter]), raw)

    pages = result["chapters"][0]["pages"]
    assert [len(p["images"]) for p in pages] == [1, 2]
    # Every page's image count equals its template's slot count.
    for page in pages:
        assert len(page["images"]) == len(registry.TEMPLATES[page["templateId"]]["images"])
    # Every chapter photo placed at least once.
    placed = {pid for page in pages for pid in page["images"].values()}
    assert placed == {"p1", "p2", "p3"}


# ---------- hallucinated templateId -------------------------------------------


def test_hallucinated_template_id_is_repaired_not_crashed():
    photos = [_photo(1, "hero"), _photo(2, "detail")]
    chapter = _chapter("ch1", ["p1", "p2"])
    payload = {
        "pages": [
            {"chapterId": "ch1", "templateId": "mag-DOES-NOT-EXIST", "photoIds": ["p1"]},
            {"chapterId": "ch1", "templateId": "totally-made-up", "photoIds": ["p2"]},
        ]
    }
    raw, _ = asyncio.run(
        template_plan.plan_templates(
            [chapter], photos, "en", complete=_complete_returning(payload)
        )
    )
    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, [chapter]), raw)

    pages = result["chapters"][0]["pages"]
    # Unknown ids repaired to real interior templates; no crash; both photos placed.
    assert pages, "expected repaired pages, not an empty chapter"
    for page in pages:
        assert registry.is_known(page["templateId"])
        assert registry.TEMPLATES[page["templateId"]]["slot"] == "interior"
    placed = {pid for page in pages for pid in page["images"].values()}
    assert placed == {"p1", "p2"}


def test_cover_or_ending_template_id_is_rejected_and_repaired():
    photos = [_photo(1, "hero")]
    chapter = _chapter("ch1", ["p1"])
    cover_id = next(
        tid for tid in registry.TEMPLATE_IDS if registry.TEMPLATES[tid]["slot"] == "cover"
    )
    payload = {"pages": [{"chapterId": "ch1", "templateId": cover_id, "photoIds": ["p1"]}]}
    raw, _ = asyncio.run(
        template_plan.plan_templates(
            [chapter], photos, "en", complete=_complete_returning(payload)
        )
    )
    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, [chapter]), raw)
    pages = result["chapters"][0]["pages"]
    # The model's cover id must not survive on an interior body page.
    for page in pages:
        assert registry.TEMPLATES[page["templateId"]]["slot"] == "interior"


def test_ending_template_id_is_rejected_and_repaired():
    """An ENDING-slot templateId is non-interior just like a cover id, so the
    planner must reject/repair it off body pages (companion to the cover case)."""
    photos = [_photo(1, "hero")]
    chapter = _chapter("ch1", ["p1"])
    ending_id = next(
        tid for tid in registry.TEMPLATE_IDS if registry.TEMPLATES[tid]["slot"] == "ending"
    )
    payload = {"pages": [{"chapterId": "ch1", "templateId": ending_id, "photoIds": ["p1"]}]}
    raw, _ = asyncio.run(
        template_plan.plan_templates(
            [chapter], photos, "en", complete=_complete_returning(payload)
        )
    )
    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, [chapter]), raw)
    pages = result["chapters"][0]["pages"]
    # The model's ending id must not survive on an interior body page.
    assert pages
    for page in pages:
        assert registry.TEMPLATES[page["templateId"]]["slot"] == "interior"


# ---------- photo-count != slot count -----------------------------------------


def test_photo_count_mismatch_is_repaired_to_a_count_matching_template():
    photos = [_photo(1, "hero"), _photo(2, "detail"), _photo(3, "detail")]
    chapter = _chapter("ch1", ["p1", "p2", "p3"])
    # Claim a 1-slot template but hand it 3 photos → count mismatch.
    t1 = _interior_template_for_count(1)
    payload = {"pages": [{"chapterId": "ch1", "templateId": t1, "photoIds": ["p1", "p2", "p3"]}]}
    raw, _ = asyncio.run(
        template_plan.plan_templates(
            [chapter], photos, "en", complete=_complete_returning(payload)
        )
    )
    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, [chapter]), raw)

    pages = result["chapters"][0]["pages"]
    assert pages
    for page in pages:
        # Repaired so slot count matches the photos actually on the page.
        assert len(page["images"]) == len(registry.TEMPLATES[page["templateId"]]["images"])
    placed = {pid for page in pages for pid in page["images"].values()}
    assert placed == {"p1", "p2", "p3"}


# ---------- duplicate / foreign / missing photoIds ----------------------------


def test_duplicate_photo_on_same_page_is_deduped():
    photos = [_photo(1, "hero"), _photo(2, "detail")]
    chapter = _chapter("ch1", ["p1", "p2"])
    t2 = _interior_template_for_count(2)
    # p1 twice on one page → after dedup only 1 photo → repaired to a 1-slot page.
    payload = {"pages": [{"chapterId": "ch1", "templateId": t2, "photoIds": ["p1", "p1"]}]}
    raw, _ = asyncio.run(
        template_plan.plan_templates(
            [chapter], photos, "en", complete=_complete_returning(payload)
        )
    )
    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, [chapter]), raw)
    pages = result["chapters"][0]["pages"]
    # No page may carry the same photo twice.
    for page in pages:
        values = list(page["images"].values())
        assert len(values) == len(set(values))
    # Both real chapter photos still placed (p2 swept in as a leftover).
    placed = {pid for page in pages for pid in page["images"].values()}
    assert placed == {"p1", "p2"}


def test_foreign_photo_id_is_dropped_and_omitted_photo_swept_in():
    photos = [_photo(1, "hero"), _photo(2, "detail")]
    chapter = _chapter("ch1", ["p1", "p2"])
    t1 = _interior_template_for_count(1)
    # Page references a photo from no chapter ("p999"); p2 omitted entirely.
    payload = {"pages": [{"chapterId": "ch1", "templateId": t1, "photoIds": ["p999"]}]}
    raw, _ = asyncio.run(
        template_plan.plan_templates(
            [chapter], photos, "en", complete=_complete_returning(payload)
        )
    )
    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, [chapter]), raw)
    placed = {pid for page in result["chapters"][0]["pages"] for pid in page["images"].values()}
    # Foreign id never placed; both real photos (incl. the omitted p2) are present.
    assert "p999" not in placed
    assert placed == {"p1", "p2"}


def test_mixed_page_drops_foreign_id_keeps_real_and_sweeps_omitted():
    """A MIXED page (real photoIds + one foreign id) must: drop ONLY the foreign id,
    still build a valid page from the surviving real photo(s), and sweep any photo
    the model omitted so every real chapter photo lands at least once. This is the
    in-page drop + sweep path — distinct from the all-foreign 'zero usable pages →
    whole-chapter deterministic fallback' covered above."""
    photos = [_photo(1, "hero"), _photo(2, "detail"), _photo(3, "detail")]
    chapter = _chapter("ch1", ["p1", "p2", "p3"])
    t2 = _interior_template_for_count(2)
    # One MIXED page: real p1 + foreign p999 (a 2-slot template). After dropping the
    # foreign id only p1 survives → repaired to a count-matching page. p2/p3 omitted
    # entirely → must be swept in deterministically.
    payload = {"pages": [{"chapterId": "ch1", "templateId": t2, "photoIds": ["p1", "p999"]}]}
    raw, _ = asyncio.run(
        template_plan.plan_templates(
            [chapter], photos, "en", complete=_complete_returning(payload)
        )
    )
    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, [chapter]), raw)
    pages = result["chapters"][0]["pages"]
    # The mixed page still produced real pages (NOT a wholesale chapter fallback
    # that would have ignored the model's page entirely).
    assert pages
    for page in pages:
        # Every page is a valid interior page with slot count == photo count.
        assert registry.TEMPLATES[page["templateId"]]["slot"] == "interior"
        assert len(page["images"]) == len(registry.TEMPLATES[page["templateId"]]["images"])
    placed = {pid for page in pages for pid in page["images"].values()}
    # Foreign id dropped; every real photo (incl. omitted p2/p3) swept in ≥1.
    assert "p999" not in placed
    assert placed == {"p1", "p2", "p3"}


# ---------- unparseable / empty → deterministic fallback ----------------------


def test_unparseable_output_raises_so_caller_falls_back():
    photos = [_photo(1, "hero"), _photo(2, "detail")]
    chapter = _chapter("ch1", ["p1", "p2"])
    with pytest.raises(template_plan.TemplatePlanError):
        asyncio.run(
            template_plan.plan_templates(
                [chapter], photos, "en", complete=_complete_raw("not json at all <<>>")
            )
        )


def test_empty_output_raises_so_caller_falls_back():
    photos = [_photo(1)]
    chapter = _chapter("ch1", ["p1"])
    with pytest.raises(template_plan.TemplatePlanError):
        asyncio.run(
            template_plan.plan_templates(
                [chapter], photos, "en", complete=_complete_raw(None)
            )
        )


def test_chapter_with_zero_usable_plan_pages_falls_back_to_deterministic():
    """A chapter whose model pages are all unusable → validate returns [] → the
    deterministic skeleton.build_chapter_pages produces the pages instead."""
    photos = [_photo(1, "hero"), _photo(2, "detail"), _photo(3, "detail")]
    chapter = _chapter("ch1", ["p1", "p2", "p3"])
    # Every page references only foreign ids → nothing clean survives.
    raw = [
        {"chapterId": "ch1", "templateId": "mag-bogus", "photoIds": ["x", "y"]},
        {"chapterId": "ch1", "templateId": "mag-bogus2", "photoIds": ["z"]},
    ]
    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, [chapter]), raw)
    deterministic = skeleton.build_skeleton(_skeleton_input(photos, [chapter]))
    # Body pages match the deterministic engine's chapter pages exactly.
    assert result["chapters"][0]["pages"] == deterministic["chapters"][0]["pages"]


def test_full_draft_structure_matches_deterministic_shape():
    """Cover/ending/toc and flat page ordering are identical to build_skeleton —
    only interior selection differs (#172). Verify the structural invariants."""
    # 15 fill photos in 5 chapters of 3 → each chapter's all-fill 3-up splits into
    # 2 pages (2+1) → 10 body pages, 5 chapters → TOC threshold met (>=4 ch, >=8 pg).
    photos = [_photo(i, "fill") for i in range(1, 16)]
    chapters = [
        _chapter(f"ch{c}", [f"p{c * 3 - 2}", f"p{c * 3 - 1}", f"p{c * 3}"]) for c in range(1, 6)
    ]
    # Build a valid plan from the deterministic partition.
    plan_pages: list[dict[str, Any]] = []
    by_id = {p.photoId: p for p in photos}
    for ch in chapters:
        ch_photos = [
            {"photoId": pid, "analysis": by_id[pid].analysis.model_dump(mode="json"), "used": True}
            for pid in ch.photoIds
        ]
        for i, page in enumerate(skeleton.partition_chapter_photos(ch_photos)):
            tid = skeleton.pick_template(
                "chapter", len(page), page, album_id="alb_plan", chapter_id=ch.chapterId,
                page_ordinal=i, scene=skeleton.page_scene(page),
            )
            plan_pages.append(
                {"chapterId": ch.chapterId, "templateId": tid,
                 "photoIds": [p["photoId"] for p in page]}
            )

    result = template_plan.build_skeleton_with_plan(_skeleton_input(photos, chapters), plan_pages)
    base = result["basePages"]
    assert base["cover"]["templateId"]
    assert registry.TEMPLATES[base["cover"]["templateId"]]["slot"] == "cover"
    assert registry.TEMPLATES[base["ending"]["templateId"]]["slot"] == "ending"
    assert base["toc"] is not None and base["toc"]["templateId"] == "mag-02"
    # Flat pages: cover first, ending last, pageIndex contiguous.
    flat = result["pages"]
    assert flat[0] is base["cover"]
    assert flat[-1] is base["ending"]
    assert [p["pageIndex"] for p in flat] == list(range(len(flat)))
    # Every used photo appears somewhere in the body.
    body_placed = {
        pid for ch in result["chapters"] for page in ch["pages"] for pid in page["images"].values()
    }
    assert body_placed == {p.photoId for p in photos}


# ---------- global ≤2 reuse cap enforced end-to-end (#172 must-fix) ------------


def _flat_use_counts(result: Any) -> Counter:
    """Total appearances of every photoId across the WHOLE skeleton (flat pages —
    cover + toc + body + ending). Reproduces codex's `Counter` probe."""
    counts: Counter = Counter()
    for page in result["pages"]:
        for pid in page["images"].values():
            if isinstance(pid, str):
                counts[pid] += 1
    return counts


def test_body_packed_at_cap_forces_base_overreuse_then_deterministic_fallback():
    """codex probe: the LLM packs every photo into the body at the 2x cap, so the
    photo budget is exhausted and build_base_pages is forced to re-place an
    already-twice-used photo into cover/ending → some photoId ends up used >2 times
    (codex: Counter({'p1':4,'p2':2})), which finalize/layout_rules REJECT.

    The global-cap check must catch this and fall back WHOLESALE to the
    deterministic skeleton (reserves fresh photos for cover/ending). Assert: the
    result equals build_skeleton's output AND every photoId appears ≤2 times."""
    # 2 photos, single chapter. A 1-slot template lets us place each photo on its
    # own page exactly twice → body Counter == {p1:2, p2:2}, exhausting the budget.
    photos = [_photo(1, "hero"), _photo(2, "hero")]
    chapter = _chapter("ch1", ["p1", "p2"])
    t1 = _interior_template_for_count(1)
    payload = {
        "pages": [
            {"chapterId": "ch1", "templateId": t1, "photoIds": ["p1"]},
            {"chapterId": "ch1", "templateId": t1, "photoIds": ["p1"]},
            {"chapterId": "ch1", "templateId": t1, "photoIds": ["p2"]},
            {"chapterId": "ch1", "templateId": t1, "photoIds": ["p2"]},
        ]
    }
    raw, _ = asyncio.run(
        template_plan.plan_templates(
            [chapter], photos, "en", complete=_complete_returning(payload)
        )
    )
    skel_input = _skeleton_input(photos, [chapter])
    result = template_plan.build_skeleton_with_plan(skel_input, raw)

    # No photoId may appear more than twice across the whole final draft.
    counts = _flat_use_counts(result)
    assert all(c <= 2 for c in counts.values()), counts
    # The fix is "fall back to deterministic": the chosen draft IS the
    # deterministic skeleton (which reserves fresh photos for cover/ending).
    deterministic = skeleton.build_skeleton(skel_input)
    assert result == deterministic
