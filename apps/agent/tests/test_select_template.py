"""V3 select-template (WP1.4 / #183).

Covers the §8.3 safety model — the recognition model picks each page's templateId
from the LEGAL candidate set, and a hallucinated / cross-page / out-of-set choice
is rejected and degrades to the deterministic pick. Covers the §9 pure-code
fallback (LLM failure → "N photos → a template that holds them, slotted in order",
no quality/hero/orientation matching) and that aspect-ratio mismatch never errors.

No network: the model call is monkeypatched; the no-key path exercises the real
fallback. Pairs with test_skeleton_v3.py (the deterministic engine these build on).
"""

from __future__ import annotations

import asyncio

import pytest

from src.engine import templates
from src.schemas import Page, V3Chapter, V3ChapterPhoto
from src import ai_client
from src.services import select_template as st
from src.engine import skeleton_v3 as sk


# ---------- helpers -----------------------------------------------------------


def _photo(idx: int, *, width: int = 800, height: int = 600) -> V3ChapterPhoto:
    orient = "landscape" if width > height else "portrait" if height > width else "square"
    return V3ChapterPhoto(
        photoId=f"p{idx}",
        sceneDescription=f"scene {idx}",
        width=width,
        height=height,
        orientation=orient,  # type: ignore[arg-type]
        takenAt=None,
    )


def _chapter(n_photos: int, *, chapter_id: str = "ch_1", **photo_kwargs) -> V3Chapter:
    return V3Chapter(
        chapterId=chapter_id,
        description=f"chapter with {n_photos} photos",
        accentColor=None,
        artFont=None,
        photos=[_photo(i + 1, **photo_kwargs) for i in range(n_photos)],
    )


def _run(chapters):
    return asyncio.run(st.select_template_pages(chapters))


@pytest.fixture
def no_keys(monkeypatch):
    """Force both vision slots unconfigured so select_template takes the pure-code
    fallback without any network — conftest already sets mock mode, this nails the
    keys to empty for determinism."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ARK_API_KEY", raising=False)
    from src import settings as s

    s.reset_settings_cache()
    yield
    s.reset_settings_cache()


def _mock_model(monkeypatch, choices_by_page):
    """Make the model return a fixed {pageId: templateId} mapping (or raise)."""

    async def fake_call(slot, pages):
        if isinstance(choices_by_page, Exception):
            raise choices_by_page
        return dict(choices_by_page)

    # Pretend a slot is configured so _select_slot succeeds, then short-circuit the
    # network at _call_model.
    monkeypatch.setattr(st, "_call_model", fake_call)
    monkeypatch.setattr(
        st,
        "_select_slot",
        lambda settings: st.VisionSlot(
            provider="openai",
            base_url="http://x",
            api_key="k",
            model="gpt-5.5-mini",
            timeout_seconds=5,
            extra_body=None,
            response_format=None,
            supports_json_object=True,
        ),
    )


# ---------- page planning -----------------------------------------------------


def test_plan_pages_partitions_like_the_engine():
    # interior max capacity is 4 in the current registry → 10 photos = 4 + 4 + 2.
    chapter = _chapter(10)
    pages = st.plan_pages([chapter])
    sizes = [len(p.photos) for p in pages]
    cap = sk.max_capacity("interior")
    assert sizes == [cap] * (10 // cap) + ([10 % cap] if 10 % cap else [])
    # Page ids are stable and sequential.
    assert [p.page_id for p in pages] == [f"pg_{i + 1}" for i in range(len(pages))]


def test_plan_pages_candidates_are_legal_for_each_page():
    pages = st.plan_pages([_chapter(2)])
    for page in pages:
        legal = sk.legal_candidates("interior", len(page.photos))
        assert page.candidates == legal
        # every candidate can hold the page's photos (capacity >= N), interior only.
        for cand in page.candidates:
            assert cand["category"] == "interior"
            assert cand["imageSlotCount"] >= len(page.photos)


def test_plan_pages_skips_empty_chapters():
    empty = V3Chapter(
        chapterId="ch_empty", description="x", accentColor=None, artFont=None, photos=[]
    )
    pages = st.plan_pages([empty, _chapter(1, chapter_id="ch_2")])
    assert len(pages) == 1
    assert pages[0].photos[0].photoId == "p1"


# ---------- model picks only from legal candidates ----------------------------


def test_model_choice_inside_legal_set_is_used(monkeypatch):
    pages = st.plan_pages([_chapter(2)])
    legal = pages[0].candidates
    assert legal, "expected a 2-photo interior candidate in the registry"
    chosen_id = legal[-1]["templateId"]  # a non-default legal pick
    _mock_model(monkeypatch, {pages[0].page_id: chosen_id})

    result = _run([_chapter(2)])
    assert len(result) == 1
    assert result[0]["templateId"] == chosen_id
    # photos slotted in declaration order, no quality/hero matching.
    assert list(result[0]["images"].values()) == ["p1", "p2"]


def test_hallucinated_id_is_rejected_and_falls_back_per_page(monkeypatch):
    chapter = _chapter(2)
    pages = st.plan_pages([chapter])
    _mock_model(monkeypatch, {pages[0].page_id: "mag-does-not-exist"})

    result = _run([chapter])
    # Illegal id rejected → that page uses the deterministic pick (never the fake id).
    assert result[0]["templateId"] != "mag-does-not-exist"
    assert result[0]["templateId"] == sk.pick_template_v3("interior", 2)
    assert list(result[0]["images"].values()) == ["p1", "p2"]


def test_cross_page_id_is_rejected(monkeypatch):
    # A 10-photo chapter → 3 pages. Feed page pg_1 a candidate that is only legal for
    # page pg_3 (a smaller-capacity template) — it must be rejected for pg_1.
    chapter = _chapter(10)
    pages = st.plan_pages([chapter])
    big_page, small_page = pages[0], pages[-1]  # 4 photos vs 2 photos
    # an id legal for the small page but NOT for the big page (capacity too small).
    small_only = {c["templateId"] for c in small_page.candidates} - {
        c["templateId"] for c in big_page.candidates
    }
    if not small_only:
        pytest.skip("registry has no capacity gap to exercise cross-page rejection")
    bad_for_big = sorted(small_only)[0]
    _mock_model(monkeypatch, {big_page.page_id: bad_for_big})

    result = _run([chapter])
    # pg_1 rejected the cross-page id and used its own legal deterministic pick.
    assert result[0]["templateId"] != bad_for_big
    assert result[0]["templateId"] in {c["templateId"] for c in big_page.candidates}


def test_partial_choices_other_pages_fall_back(monkeypatch):
    chapter = _chapter(10)
    pages = st.plan_pages([chapter])
    # Only answer the first page; the rest are missing → per-page deterministic pick.
    legal_first = pages[0].candidates[0]["templateId"]
    _mock_model(monkeypatch, {pages[0].page_id: legal_first})

    result = _run([chapter])
    assert len(result) == len(pages)
    assert result[0]["templateId"] == legal_first
    for i in range(1, len(result)):
        assert result[i]["templateId"] == sk.pick_template_v3("interior", len(pages[i].photos))


# ---------- LLM-failure fallback (§9) -----------------------------------------


def test_llm_failure_falls_back_to_pure_code(monkeypatch):
    chapter = _chapter(10)
    _mock_model(monkeypatch, ai_client.AIRequestError("boom"))

    result = _run([chapter])
    # Identical to the deterministic engine for the same chapter tree.
    expected = sk.build_skeleton_v3([chapter.model_dump(mode="json")])
    assert result == expected
    # Every photo placed, slotted in order, no quality/hero matching.
    placed = [pid for page in result for pid in page["images"].values()]
    assert placed == [f"p{i + 1}" for i in range(10)]


def test_no_provider_configured_falls_back(no_keys):
    chapter = _chapter(3)
    result = _run([chapter])
    expected = sk.build_skeleton_v3([chapter.model_dump(mode="json")])
    assert result == expected


def test_select_template_uses_v3_describe_model_not_v2_openai_default(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "fake_oai")
    monkeypatch.setenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("DESCRIBE_OPENAI_MODEL", "gpt-5.5-mini")
    from src import settings as s

    s.reset_settings_cache()
    try:
        slot = st._select_slot(s.get_settings())
        assert slot.model == "gpt-5.5-mini"
    finally:
        s.reset_settings_cache()


def test_unparseable_response_falls_back(monkeypatch):
    chapter = _chapter(2)

    async def fake_call(slot, pages):
        raise st.SelectTemplateError("unparseable")

    monkeypatch.setattr(st, "_call_model", fake_call)
    monkeypatch.setattr(
        st,
        "_select_slot",
        lambda settings: st.VisionSlot(
            provider="ark",
            base_url="http://x",
            api_key="k",
            model="doubao",
            timeout_seconds=5,
            extra_body=None,
            response_format=None,
            supports_json_object=False,
        ),
    )
    result = _run([chapter])
    assert result == sk.build_skeleton_v3([chapter.model_dump(mode="json")])


# ---------- robustness --------------------------------------------------------


def test_orientation_mismatch_never_errors(monkeypatch):
    # All-portrait photos into a layout chosen with no orientation rule: must not
    # raise — aspect mismatch is the renderer's center-cover concern (§6.8 第 6 条).
    chapter = _chapter(4, width=600, height=900)  # portrait
    pages = st.plan_pages([chapter])
    landscape_pick = pages[0].candidates[0]["templateId"]
    _mock_model(monkeypatch, {pages[0].page_id: landscape_pick})
    result = _run([chapter])
    assert list(result[0]["images"].values()) == ["p1", "p2", "p3", "p4"]


def test_empty_chapters_yield_no_pages():
    assert _run([]) == []
    empty = V3Chapter(
        chapterId="ch_e", description="x", accentColor=None, artFont=None, photos=[]
    )
    assert _run([empty]) == []


def test_result_pages_revalidate_as_page_schema(monkeypatch):
    chapter = _chapter(5)
    _mock_model(monkeypatch, ai_client.AIRequestError("force fallback"))
    result = _run([chapter])
    pages = [Page(**p) for p in result]
    # sequential pageIndex, every photo placed exactly once.
    assert [p.pageIndex for p in pages] == list(range(len(pages)))
    placed = sorted(pid for p in pages for pid in p.images.values())
    assert placed == sorted(f"p{i + 1}" for i in range(5))


def test_parse_choices_ignores_malformed_rows():
    parsed = {
        "pages": [
            {"pageId": "pg_1", "templateId": "mag-08"},
            {"pageId": "pg_2"},  # missing templateId
            "junk",  # not an object
            {"pageId": 3, "templateId": "mag-01"},  # non-string pageId
        ]
    }
    choices = st._parse_choices(parsed)
    assert choices == {"pg_1": "mag-08"}


def test_parse_choices_rejects_non_object():
    with pytest.raises(st.SelectTemplateError):
        st._parse_choices(["not", "a", "dict"])
    with pytest.raises(st.SelectTemplateError):
        st._parse_choices({"no_pages": True})
