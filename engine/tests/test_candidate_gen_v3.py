"""排版随机候选生成 + 图槽匹配的确定性/合法性测试(P1)。"""

from src.workflows.core.layout import candidate_gen_v3 as gen
from src.workflows.core.layout import slot_matcher_v3 as matcher


def _photos(n: int, *, orientation: str = "landscape", composition: str | None = "wide"):
    return [
        {"photoId": f"p{i}", "orientation": orientation, "composition": composition}
        for i in range(n)
    ]


def _all_photo_ids(candidate) -> list[str]:
    return [pid for page in candidate for pid in page["images"].values()]


def test_candidates_cover_every_photo_once():
    photos = _photos(7)
    for cand in gen.generate_candidates(photos, seed="r1", count=3):
        ids = _all_photo_ids(cand)
        assert sorted(ids) == [f"p{i}" for i in range(7)]
        assert len(ids) == len(set(ids))  # 不重


def test_same_seed_is_deterministic():
    photos = _photos(6)
    a = gen.generate_candidates(photos, seed="seed-x", count=3)
    b = gen.generate_candidates(photos, seed="seed-x", count=3)
    assert [[p["templateId"] for p in c] for c in a] == [
        [p["templateId"] for p in c] for c in b
    ]


def test_different_seed_varies():
    photos = _photos(6)
    a = gen.generate_candidates(photos, seed="seed-a", count=3)
    b = gen.generate_candidates(photos, seed="seed-b", count=3)
    assert [[p["templateId"] for p in c] for c in a] != [
        [p["templateId"] for p in c] for c in b
    ]


def test_generates_up_to_count_distinct():
    cands = gen.generate_candidates(_photos(7), seed="r2", count=3)
    assert 1 <= len(cands) <= 3
    sigs = {tuple((p["templateId"], tuple(sorted(p["images"].items()))) for p in c) for c in cands}
    assert len(sigs) == len(cands)  # 候选互不相同


def test_single_photo_still_produces_candidate():
    cands = gen.generate_candidates(_photos(1), seed="r3", count=3)
    assert cands
    assert _all_photo_ids(cands[0]) == ["p0"]


def test_empty_photos_returns_empty():
    assert gen.generate_candidates([], seed="r4", count=3) == []


# ── slot matcher 兜底阶梯 ──────────────────────────────────────────────


def test_matcher_returns_none_on_count_mismatch():
    # mag-04 容量 2,给 1 张 => None
    assert matcher.match_photos_to_template("mag-04", _photos(1)) is None


def test_matcher_fills_all_slots():
    r = matcher.match_photos_to_template("mag-04", _photos(2))
    assert r is not None
    assert sorted(r.values()) == ["p0", "p1"]


def test_matcher_degrades_to_sequential_when_no_attr_fit():
    # 即使照片属性和槽位约束不符,最底层顺序填也保证产出(不死锁)。
    photos = [
        {"photoId": "p0", "orientation": "portrait", "composition": "closeup"},
        {"photoId": "p1", "orientation": "portrait", "composition": "closeup"},
    ]
    r = matcher.match_photos_to_template("mag-04", photos)
    assert r is not None
    assert sorted(r.values()) == ["p0", "p1"]
