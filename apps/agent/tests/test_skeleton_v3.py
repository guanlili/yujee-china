"""V3 deterministic skeleton engine (WP0.4 / #179).

Covers the category + image-slot-count pooling, the legal-candidate exposure for
select-template, the pure-code fallback ("N photos → pick a template that holds
them, slot in order"), and the chapter→pages partition. No quality/hero/
orientation/scene anywhere.
"""

from __future__ import annotations

import pytest

from src.engine import templates
from src.schemas import V3TemplateCandidate
from src.engine import skeleton_v3 as sk


def test_pools_are_keyed_by_category_not_slot():
    # mag-02 is slot=interior but category=toc — it must land in the toc pool,
    # never the interior pool (category != slot, the §9 distinction).
    assert "mag-02" in sk.POOLS["toc"][0]
    interior_ids = {tid for bucket in sk.POOLS["interior"].values() for tid in bucket}
    assert "mag-02" not in interior_ids
    # Every registry template is pooled exactly once.
    pooled = [tid for cat in sk.POOLS.values() for bucket in cat.values() for tid in bucket]
    assert sorted(pooled) == sorted(templates.TEMPLATE_IDS)


def test_pools_index_by_image_slot_count():
    for category, by_capacity in sk.POOLS.items():
        for capacity, ids in by_capacity.items():
            for tid in ids:
                assert sk.image_capacity(templates.TEMPLATES[tid]) == capacity
                assert sk.template_category(templates.TEMPLATES[tid]) == category
            # ids are sorted for deterministic fallback selection.
            assert ids == sorted(ids)


def test_candidate_ids_exact_capacity_and_category():
    candidates = sk.candidate_ids("interior", 2)
    assert candidates  # there are 2-image interior templates
    for tid in candidates:
        tpl = templates.TEMPLATES[tid]
        assert sk.template_category(tpl) == "interior"
        assert sk.image_capacity(tpl) == 2


def test_legal_candidates_shape_for_select_template():
    candidates = sk.legal_candidates("interior", 3)
    assert candidates
    parsed = [V3TemplateCandidate(**candidate) for candidate in candidates]

    expected_ids = {
        template_id
        for template_id in templates.TEMPLATE_IDS
        if sk.template_category(templates.TEMPLATES[template_id]) == "interior"
        and sk.image_capacity(templates.TEMPLATES[template_id]) >= 3
    }
    assert {candidate.templateId for candidate in parsed} == expected_ids
    assert all(candidate.category == "interior" for candidate in parsed)
    assert all(candidate.imageSlotCount >= 3 for candidate in parsed)
    assert any(candidate.imageSlotCount > 3 for candidate in parsed)


def test_fallback_prefers_exact_capacity():
    # 3-photo interior: mag-04 is the only exact-3 template.
    assert sk.pick_template_v3("interior", 3) == "mag-04"
    # 1-photo interior: smallest sorted id among the 1-slot interiors.
    pick = sk.pick_template_v3("interior", 1)
    assert sk.image_capacity(templates.TEMPLATES[pick]) == 1


def test_fallback_falls_to_closest_larger_when_no_exact_capacity(monkeypatch):
    # Synthetic pool with a capacity gap (2 and 4, no 3) proves the closest-larger
    # rule: 3 photos -> the 4-slot template, never a smaller one.
    monkeypatch.setattr(sk, "POOLS", {"interior": {2: ["t2"], 4: ["t4"]}})
    assert sk.pick_template_v3("interior", 3) == "t4"
    assert sk.pick_template_v3("interior", 2) == "t2"  # exact preferred
    assert sk.max_capacity("interior") == 4


def test_fallback_raises_when_no_template_can_hold_n():
    # Largest interior capacity is finite; exceeding it on a single page raises
    # (callers partition first via partition_photos_v3).
    too_many = sk.max_capacity("interior") + 1
    with pytest.raises(ValueError):
        sk.pick_template_v3("interior", too_many)


def test_assign_images_in_declaration_order_no_matching():
    tpl_id = "mag-04"  # 3 image slots
    slot_ids = templates.image_slot_ids(templates.TEMPLATES[tpl_id])
    mapping = sk.assign_images_v3(tpl_id, ["a", "b", "c"])
    # Photos go into slots in declaration order — nothing about quality/orientation.
    assert mapping == {slot_ids[0]: "a", slot_ids[1]: "b", slot_ids[2]: "c"}


def test_assign_images_accepts_photo_mappings():
    mapping = sk.assign_images_v3("mag-04", [{"photoId": "x"}, {"photoId": "y"}, {"photoId": "z"}])
    assert set(mapping.values()) == {"x", "y", "z"}


def test_assign_images_rejects_overflow():
    with pytest.raises(ValueError):
        sk.assign_images_v3("mag-03", ["a", "b"])  # mag-03 holds 1


def test_assign_images_into_repeat_group_template():
    # mag-10's single items.images slot `image` expands to image[0..k-1] as its
    # addressable grid capacity (k = _ITEMS_GRID_CAPACITY).
    mapping = sk.assign_images_v3("mag-10", ["a", "b", "c", "d"])
    assert mapping == {
        "image[0]": "a",
        "image[1]": "b",
        "image[2]": "c",
        "image[3]": "d",
    }


def test_fallback_fixture_ten_photos_pick_holding_templates_in_order():
    """§9 fallback fixture: N photos → pick templates that can hold them, slot in
    order. With the interior max of 4, 10 photos pack as 4 + 4 + 2, photos kept
    in their original order across pages."""
    photo_ids = [f"p{i}" for i in range(10)]
    pages = sk.build_skeleton_v3([{"photos": photo_ids}])

    # Every chunk maps to a template that can hold it; capacities sum to N.
    placed: list[str] = []
    for page in pages:
        tpl = templates.TEMPLATES[page["templateId"]]
        assert sk.template_category(tpl) == "interior"
        assert len(page["images"]) <= sk.image_capacity(tpl)
        placed.extend(page["images"].values())

    # No photo lost, no photo duplicated, original order preserved.
    assert placed == photo_ids
    assert [p["pageIndex"] for p in pages] == list(range(len(pages)))
    # 10 photos, interior max 4 -> 4 + 4 + 2.
    assert [len(p["images"]) for p in pages] == [4, 4, 2]


def test_partition_photos_chunks_by_max_capacity():
    chunks = sk.partition_photos_v3([str(i) for i in range(10)], category="interior")
    assert [len(c) for c in chunks] == [4, 4, 2]
    # flattening recovers the original order.
    assert [pid for c in chunks for pid in c] == [str(i) for i in range(10)]


def test_partition_empty_photos_is_empty():
    assert sk.partition_photos_v3([]) == []


def test_partition_photos_does_not_require_contiguous_capacities(monkeypatch):
    # The fallback can legally use the closest larger template, so capacity gaps
    # are fine: 7 photos with max capacity 4 become 4 + 3, and the 3-photo chunk
    # may later pick a 4-slot template.
    monkeypatch.setattr(sk, "POOLS", {"interior": {2: ["t2"], 4: ["t4"]}})
    chunks = sk.partition_photos_v3([str(i) for i in range(7)], category="interior")
    assert [len(chunk) for chunk in chunks] == [4, 3]


def test_build_skeleton_skips_empty_chapters_and_reindexes():
    pages = sk.build_skeleton_v3(
        [{"photos": ["a", "b"]}, {"photos": []}, {"photos": ["c"]}]
    )
    assert [p["pageIndex"] for p in pages] == [0, 1]
    placed = [pid for p in pages for pid in p["images"].values()]
    assert placed == ["a", "b", "c"]


def test_build_page_uses_given_template_id():
    page = sk.build_page_v3("interior", ["a"], template_id="mag-08", page_index=3)
    assert page["templateId"] == "mag-08"
    assert page["pageIndex"] == 3
    assert list(page["images"].values()) == ["a"]
    assert page["texts"] == {}


def test_aspect_ratio_mismatch_never_rejected_at_assignment():
    # A landscape photo into a template whose legacy fixture marks its image slot
    # portrait-only must still slot fine — V3 does no orientation hard rule.
    page = sk.build_page_v3("interior", ["wide"], template_id="mag-08")
    assert page["images"] == {templates.image_slot_ids(templates.TEMPLATES["mag-08"])[0]: "wide"}
