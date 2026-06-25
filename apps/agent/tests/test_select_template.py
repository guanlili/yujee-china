"""V3 template_select — deterministic page-planning helpers (WP1.4 / #183).

【重构(统一识图调用)】:读图 + 分章 + 选模板分页已合并进 image_understanding 的一次识图
调用,select-template 的 LLM 编排已删除(原 _call_model/_select_slot/_parse_choices/
select_template.md)。每页 templateId 的合法性护栏现由 image_understanding 在调用后用
skeleton_v3 保证 —— 那一侧的覆盖见 test_vision_groups.py / test_v3_analyze.py;模板库本身的
合法候选/兜底逻辑见 test_skeleton_v3.py。

本文件只覆盖 template_select 仍保留的纯代码页面规划 helper:`plan_pages`(章节切逐页 chunk +
每页配合法候选)与 `fallback_pages`(逐页确定性 §9 兜底)。
"""

from __future__ import annotations

from src.schemas import V3Chapter, V3ChapterPhoto
from src.agents.template_select import handler as st
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


# ---------- page planning -----------------------------------------------------


def test_plan_pages_partitions_like_the_engine():
    # 10 photos at interior max capacity → chunks like partition_photos_v3.
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
        # legal_ids exposes the candidate id set.
        assert page.legal_ids == {c["templateId"] for c in page.candidates}


def test_plan_pages_skips_empty_chapters():
    empty = V3Chapter(
        chapterId="ch_empty", description="x", accentColor=None, artFont=None, photos=[]
    )
    pages = st.plan_pages([empty, _chapter(1, chapter_id="ch_2")])
    assert len(pages) == 1
    assert pages[0].photos[0].photoId == "p1"


def test_plan_pages_uses_given_grouping_when_provided():
    chapter = _chapter(4)
    grouping = {"ch_1": [["p1", "p2"], ["p3", "p4"]]}
    pages = st.plan_pages([chapter], grouping)
    assert [[_p.photoId for _p in pg.photos] for pg in pages] == [["p1", "p2"], ["p3", "p4"]]


def test_plan_pages_falls_back_when_grouping_ids_mismatch():
    # grouping referencing an unknown id → that chapter degrades to partition_photos_v3.
    chapter = _chapter(3)
    grouping = {"ch_1": [["p1", "nope"], ["p3"]]}
    pages = st.plan_pages([chapter], grouping)
    expected = sk.partition_photos_v3([p.photoId for p in chapter.photos], category="interior")
    assert [[_p.photoId for _p in pg.photos] for pg in pages] == [
        [str(x) for x in chunk] for chunk in expected
    ]


# ---------- §9 deterministic fallback -----------------------------------------


def test_fallback_pages_match_build_skeleton():
    chapter = _chapter(10)
    pages = st.plan_pages([chapter])
    result = st.fallback_pages(pages)
    # Identical to the deterministic engine for the same chapter tree.
    expected = sk.build_skeleton_v3([chapter.model_dump(mode="json")])
    assert result == expected
    # Every photo placed, slotted in order, no quality/hero matching.
    placed = [pid for page in result for pid in page["images"].values()]
    assert placed == [f"p{i + 1}" for i in range(10)]
    # sequential pageIndex.
    assert [p["pageIndex"] for p in result] == list(range(len(result)))


def test_fallback_pages_orientation_mismatch_never_errors():
    # All-portrait photos into the deterministic pick: must not raise — aspect
    # mismatch is the renderer's center-cover concern (§6.8 第 6 条).
    chapter = _chapter(4, width=600, height=900)  # portrait
    pages = st.plan_pages([chapter])
    result = st.fallback_pages(pages)
    placed = [pid for page in result for pid in page["images"].values()]
    assert placed == ["p1", "p2", "p3", "p4"]


def test_fallback_pages_empty_when_no_pages():
    assert st.fallback_pages([]) == []
    assert st.plan_pages([]) == []
