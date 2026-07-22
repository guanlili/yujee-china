"""V3 select-layout(纯确定性一把出 pages)编排测试。

排版不再有候选/缩略图/评委两阶段:一次请求 → 逐 unit 取唯一确定性候选 → 最终化 →
填模板 sample 文案 → 一次 `completed` 回调。全程零 AI 调用。
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


def _used_photo_ids(pages: list[dict]) -> list[str]:
    out: list[str] = []
    for page in pages:
        out.extend(page["images"].values())
    return out


@pytest.mark.asyncio
async def test_select_layout_emits_completed_with_pages(monkeypatch):
    # 一把出页:只发 progress + completed,不再有 candidates 事件,不调 AI。
    events = []

    async def capture_post(url, envelope):  # noqa: ANN001
        events.append(envelope.model_dump(exclude_none=True, mode="json"))

    monkeypatch.setattr(select_layout.callback, "post", capture_post)

    await select_layout.run_with_timeout(_request())

    kinds = [e["event"] for e in events]
    assert "candidates" not in kinds
    assert kinds[-1] == "completed"
    done = events[-1]
    assert done["jobKind"] == "select-layout"
    assert done["pages"]
    assert done["usage"]["geminiCallCount"] == 0
    # 页码连续从 0 起。
    assert [p["pageIndex"] for p in done["pages"]] == list(range(len(done["pages"])))


@pytest.mark.asyncio
async def test_select_layout_pages_carry_sample_texts(monkeypatch):
    events = []

    async def capture_post(url, envelope):  # noqa: ANN001
        events.append(envelope.model_dump(exclude_none=True, mode="json"))

    monkeypatch.setattr(select_layout.callback, "post", capture_post)
    await select_layout.run_with_timeout(_request())

    pages = events[-1]["pages"]
    # 模板自带 sample 的文字槽必须已经填上(至少有一页有非空 texts)。
    assert any(page["texts"] for page in pages)


def test_build_pages_covers_every_photo_exactly_once():
    # 最重要的正确性约束:每张照片恰好出现在一个页面的一个图槽里,不重不漏。
    req = _multi_request(
        [
            _chapter("ch_1", [f"a{i}" for i in range(1, 8)]),
            _chapter("ch_2", [f"b{i}" for i in range(1, 4)]),
        ]
    )
    pages, usage = select_layout.build_pages(req)

    used = _used_photo_ids(pages)
    expected = [f"a{i}" for i in range(1, 8)] + [f"b{i}" for i in range(1, 4)]
    assert sorted(used) == sorted(expected)
    assert len(used) == len(set(used))
    assert usage.geminiCallCount == 0


def test_build_pages_covers_every_photo_exactly_once_when_chapter_is_split(monkeypatch):
    # 超大章被 max_images_per_batch 拆段后,合并回来的页仍然不重不漏。
    settings = select_layout.get_settings()
    monkeypatch.setattr(settings, "select_layout_max_images_per_batch", 2)
    req = _multi_request([_chapter("ch_big", [f"p{i}" for i in range(1, 8)])])

    pages, _ = select_layout.build_pages(req)

    used = _used_photo_ids(pages)
    assert sorted(used) == sorted(f"p{i}" for i in range(1, 8))
    assert len(used) == len(set(used))
    assert [p["pageIndex"] for p in pages] == list(range(len(pages)))


def test_build_pages_requests_exactly_one_candidate_per_unit(monkeypatch):
    # 确定性选版:每个 unit 只要 1 个候选,且生成器确实只给 1 个。
    counts: list[int] = []
    real_gen = select_layout.candidate_gen_v3.generate_candidates

    def spy_gen(photos, **kwargs):  # noqa: ANN001, ANN003
        assert kwargs.get("count") == 1
        cands = real_gen(photos, **kwargs)
        counts.append(len(cands))
        return cands

    monkeypatch.setattr(select_layout.candidate_gen_v3, "generate_candidates", spy_gen)
    select_layout.build_pages(_multi_request([_chapter("ch_1", ["p1", "p2", "p3"])]))

    assert counts == [1]


def test_build_pages_splits_oversized_chapter_by_max_images(monkeypatch):
    # 超大章按 max_images_per_batch 拆段,每段独立生成候选。
    settings = select_layout.get_settings()
    monkeypatch.setattr(settings, "select_layout_max_images_per_batch", 2)
    segments: list[list[str]] = []
    real_gen = select_layout.candidate_gen_v3.generate_candidates

    def spy_gen(photos, **kwargs):  # noqa: ANN001, ANN003
        segments.append([p.photoId for p in photos])
        return real_gen(photos, **kwargs)

    monkeypatch.setattr(select_layout.candidate_gen_v3, "generate_candidates", spy_gen)

    pages, usage = select_layout.build_pages(
        _multi_request([_chapter("ch_big", ["p1", "p2", "p3", "p4", "p5"])])
    )

    assert segments == [["p1", "p2"], ["p3", "p4"], ["p5"]]
    assert usage.geminiCallCount == 0


def test_build_pages_seed_is_per_unit_deterministic(monkeypatch):
    # seed = requestId#chapterId#段首 photoId:同请求内每 unit 不同、跨调用可复现。
    seen: list[str] = []
    real_gen = select_layout.candidate_gen_v3.generate_candidates

    def spy_gen(photos, **kwargs):  # noqa: ANN001, ANN003
        seen.append(str(kwargs.get("seed")))
        return real_gen(photos, **kwargs)

    monkeypatch.setattr(select_layout.candidate_gen_v3, "generate_candidates", spy_gen)

    req = _multi_request([_chapter("ch_1", ["p1"]), _chapter("ch_2", ["p2"])])
    first_pages, _ = select_layout.build_pages(req)
    first = list(seen)
    seen.clear()
    second_pages, _ = select_layout.build_pages(req)

    assert first == ["layout-r1#ch_1#p1", "layout-r1#ch_2#p2"]
    assert seen == first
    # 同请求两次调用输出完全一致(纯确定性)。
    assert first_pages == second_pages
