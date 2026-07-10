"""V3 select-layout(P2 两段式,唯一路径)编排测试。

phase 1 只做代码随机候选生成 + candidates 回调,不调任何 AI;
评委(真图缩略图)在 judge-layout phase 2,见 test_judge_layout_flow.py。
旧内联线框评委路径已整条移除。
"""

import pytest

from src.workflows import select_layout
from src.contracts.schemas import SelectLayoutRequest


def _request() -> SelectLayoutRequest:
    return SelectLayoutRequest.model_validate(
        {
            "requestId": "layout-r1",
            "callbackUrl": "https://example.com/api/v3/internal/job-progress",
            "language": "en",
            "chapters": [
                {
                    "chapterId": "ch_1",
                    "structureHint": "coast morning",
                    "photos": [
                        {
                            "photoId": "p1",
                            "ref200px": "data:image/jpeg;base64,AA==",
                            "orientation": "landscape",
                            "takenAt": "2024-03-15T08:30:00",
                        },
                        {
                            "photoId": "p2",
                            "ref200px": "data:image/jpeg;base64,BB==",
                            "orientation": "portrait",
                            "takenAt": None,
                        },
                    ],
                }
            ],
        }
    )


def _multi_request(chapters: list[dict]) -> SelectLayoutRequest:
    return SelectLayoutRequest.model_validate(
        {
            "requestId": "layout-r1",
            "callbackUrl": "https://example.com/api/v3/internal/job-progress",
            "language": "en",
            "chapters": chapters,
        }
    )


def _chapter(chapter_id: str, photo_ids: list[str]) -> dict:
    return {
        "chapterId": chapter_id,
        "structureHint": f"story {chapter_id}",
        "photos": [
            {
                "photoId": photo_id,
                "ref200px": f"data:image/jpeg;base64,{idx + 1}A==",
                "orientation": "landscape",
                "takenAt": None,
            }
            for idx, photo_id in enumerate(photo_ids)
        ],
    }


@pytest.mark.asyncio
async def test_select_layout_emits_candidates_callback(monkeypatch):
    # P2 两阶段:phase 1 发 candidates 回调(候选结构),不调 AI,不推进 stage。
    events = []

    async def capture_post(url, envelope):  # noqa: ANN001
        events.append(envelope.model_dump(exclude_none=True, mode="json"))

    monkeypatch.setattr(select_layout.callback, "post", capture_post)

    await select_layout.run_with_timeout(_request())

    kinds = [e["event"] for e in events]
    assert "candidates" in kinds
    cand = next(e for e in events if e["event"] == "candidates")
    assert cand["jobKind"] == "select-layout"
    assert cand["units"] and cand["units"][0]["candidates"]
    assert cand["usage"]["geminiCallCount"] == 0


def test_select_candidates_splits_oversized_chapter_by_max_images(monkeypatch):
    # 超大章按 max_images_per_batch 拆段,每段独立生成候选(段照片不同 => 各段候选不同)。
    settings = select_layout.get_settings()
    monkeypatch.setattr(settings, "select_layout_max_images_per_batch", 2)
    segments: list[list[str]] = []
    real_gen = select_layout.candidate_gen_v3.generate_candidates

    def spy_gen(photos, **kwargs):  # noqa: ANN001, ANN003
        segments.append([p.photoId for p in photos])
        return real_gen(photos, **kwargs)

    monkeypatch.setattr(select_layout.candidate_gen_v3, "generate_candidates", spy_gen)

    units, usage = select_layout.select_candidates(
        _multi_request([_chapter("ch_big", ["p1", "p2", "p3", "p4", "p5"])])
    )

    assert segments == [["p1", "p2"], ["p3", "p4"], ["p5"]]
    # 封面 unit 在最前,随后三段章节 unit(unitKey 带段首 photoId 区分)。
    assert units[0].kind == "cover" and units[0].unitKey == "__cover__"
    chapter_units = [u for u in units if u.kind == "chapter"]
    assert [u.unitKey for u in chapter_units] == ["ch_big#p1", "ch_big#p3", "ch_big#p5"]
    assert usage.geminiCallCount == 0


def test_select_candidates_seed_is_per_unit_deterministic(monkeypatch):
    # seed = requestId#chapterId#段首 photoId:同请求内每 unit 不同、跨调用可复现。
    seen: list[str] = []
    real_gen = select_layout.candidate_gen_v3.generate_candidates

    def spy_gen(photos, **kwargs):  # noqa: ANN001, ANN003
        seen.append(str(kwargs.get("seed")))
        return real_gen(photos, **kwargs)

    monkeypatch.setattr(select_layout.candidate_gen_v3, "generate_candidates", spy_gen)

    req = _multi_request([_chapter("ch_1", ["p1"]), _chapter("ch_2", ["p2"])])
    select_layout.select_candidates(req)
    first = list(seen)
    seen.clear()
    select_layout.select_candidates(req)

    assert first == ["layout-r1#ch_1#p1", "layout-r1#ch_2#p2"]
    assert seen == first


def test_select_candidates_emits_cover_unit_first():
    # 设计步封面候选:cover 类目单图模板 × hero 照片(focal 优先),单页候选,kind='cover'。
    units, _ = select_layout.select_candidates(
        _multi_request(
            [
                {
                    "chapterId": "ch_1",
                    "structureHint": "s",
                    "photos": [
                        {"photoId": "pw", "ref200px": "data:image/jpeg;base64,AA==",
                         "orientation": "landscape", "takenAt": None, "composition": "wide"},
                        {"photoId": "pf", "ref200px": "data:image/jpeg;base64,BB==",
                         "orientation": "portrait", "takenAt": None, "composition": "focal"},
                    ],
                }
            ]
        )
    )
    cover = units[0]
    assert cover.kind == "cover" and cover.chapterId == "__cover__"
    assert 2 <= len(cover.candidates) <= 4
    for cand in cover.candidates:
        assert len(cand.pages) == 1  # 封面候选恒为单页
    # hero 排序:focal 照片进候选(排在 wide 前)。
    first_photo = list(cover.candidates[0].pages[0].images.values())[0]
    assert first_photo == "pf"
