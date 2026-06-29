import asyncio

import pytest

from src import settings as settings_module
from src.agents import select_layout as select_layout_agent
from src.engine import legalize, skeleton_v3, template_previews, templates
from src.schemas import V3Chapter, V3ChapterPhoto


def _chapter(photo_ids: list[str]) -> V3Chapter:
    return V3Chapter(
        chapterId="ch_1",
        description="A quiet coast morning",
        accentColor=None,
        artFont=None,
        photos=[
            V3ChapterPhoto(
                photoId=pid,
                sceneDescription=f"scene {pid}",
                width=800,
                height=600,
                orientation="landscape",
                takenAt="2024-03-15T08:30:00" if idx == 0 else None,
            )
            for idx, pid in enumerate(photo_ids)
        ],
    )


def _interior_template_with_capacity(capacity: int) -> str:
    ids = skeleton_v3.candidate_ids("interior", capacity)
    if not ids:
        pytest.skip(f"template registry has no interior capacity {capacity}")
    return ids[0]


def test_template_previews_are_complete_for_interior_templates():
    previews = template_previews.load_template_previews()
    interior_ids = {
        template_id
        for template_id, template in templates.TEMPLATES.items()
        if template["category"] == "interior"
    }

    assert interior_ids.issubset(previews.by_template.keys())
    for capacity in skeleton_v3.POOLS.get("interior", {}):
        assert ("interior", capacity) in previews.bucket_images


def test_build_candidates_uses_capacity_buckets_not_caller_candidates():
    candidates = legalize.build_candidate_catalog("interior", max_photo_count=2)
    assert candidates
    assert {candidate["imageSlotCount"] for candidate in candidates}.issubset({1, 2})
    assert all("previewImage" in candidate for candidate in candidates)


def test_gemini_layout_preserves_legal_slot_mapping():
    chapter = _chapter(["p1", "p2"])
    template_id = _interior_template_with_capacity(2)
    slot_a, slot_b = skeleton_v3.image_slot_keys(templates.TEMPLATES[template_id])[:2]

    pages = legalize.legalize_layout(
        [chapter],
        [
            {
                "chapterId": "ch_1",
                "templateId": template_id,
                "slots": {slot_a: "p2", slot_b: "p1"},
            }
        ],
    )

    assert len(pages) == 1
    assert pages[0]["templateId"] == template_id
    assert pages[0]["images"] == {slot_a: "p2", slot_b: "p1"}


def test_gemini_layout_falls_back_only_for_illegal_or_missing_slots():
    chapter = _chapter(["p1", "p2"])
    template_id = _interior_template_with_capacity(2)
    slot_a = skeleton_v3.image_slot_keys(templates.TEMPLATES[template_id])[0]

    pages = legalize.legalize_layout(
        [chapter],
        [
            {
                "chapterId": "ch_1",
                "templateId": template_id,
                "slots": {slot_a: "p1"},
            }
        ],
    )

    assert len(pages) == 1
    assert set(pages[0]["images"].values()) == {"p1", "p2"}
    assert pages[0]["images"] != {slot_a: "p1"}


def test_gemini_layout_accepts_case4_swap_mode_without_rejecting(monkeypatch):
    monkeypatch.setattr(
        settings_module.get_settings(), "select_layout_api_key", None, raising=False
    )

    with pytest.raises(select_layout_agent.GeminiLayoutUnavailable):
        asyncio.run(
            select_layout_agent.gemini_layout(
                [_chapter(["p1"])], mode="case4-swap", allowAddPages=True
            )
        )
