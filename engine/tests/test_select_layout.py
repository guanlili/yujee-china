import pytest

from src.workflows.core.layout import select_layout as select_layout_agent
from src.workflows.core.layout import skeleton_v3, templates
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


def _interior_template_with_capacity(capacity: int) -> str:
    ids = skeleton_v3.candidate_ids("interior", capacity)
    if not ids:
        pytest.skip(f"template registry has no interior capacity {capacity}")
    return ids[0]


def _raw_page_for_chapter(chapter) -> dict:  # noqa: ANN001
    photos = list(chapter.photos)
    template_id = _interior_template_with_capacity(len(photos))
    slots = skeleton_v3.image_slot_keys(templates.TEMPLATES[template_id])
    return {
        "chapterId": chapter.chapterId,
        "templateId": template_id,
        "slots": {slot: photo.photoId for slot, photo in zip(slots, reversed(photos), strict=True)},
    }


@pytest.mark.asyncio
async def test_select_layout_falls_back_wraps_and_fills_generic_copy():
    # 默认路径(未开 inline judge)不调评委 → 代码直接包裹候选并补 generic_copy。
    pages, usage = await select_layout.select_pages(_request())

    assert [page["pageIndex"] for page in pages] == list(range(len(pages)))
    # 封面/封底不再在排版这步生成:Stage2 只产 interior 页,首页即第一张 interior。
    assert len(pages) >= 1
    assert {pid for page in pages for pid in page["images"].values()} == {"p1", "p2"}
    assert any(value for page in pages for key, value in page["texts"].items() if key == "folio")
    assert usage.geminiCallCount == 0


@pytest.mark.asyncio
async def test_select_layout_fallback_writes_trace_marker(monkeypatch, tmp_path):
    trace_path = tmp_path / "llm-trace.txt"
    monkeypatch.setenv("YUJEE_LLM_TRACE", str(trace_path))

    # 候选生成抛错 => 整批回退确定性 skeleton,并写 fallback marker。
    def boom(*args, **kwargs):  # noqa: ANN002, ANN003
        raise RuntimeError("Candidate gen unavailable")

    monkeypatch.setattr(select_layout.candidate_gen_v3, "generate_candidates", boom)

    await select_layout.select_pages(_request())

    trace = trace_path.read_text(encoding="utf-8")
    assert "select-layout fallback" in trace
    assert "Candidate gen unavailable" in trace
    assert "chapterIds=['ch_1']" in trace


@pytest.mark.asyncio
async def test_select_layout_inline_judge_completed_callback_contains_pages(monkeypatch):
    # 向后兼容单段模式(inline_judge=True):直接发 completed + pages。
    monkeypatch.setattr(
        select_layout.get_settings(), "select_layout_inline_judge", True, raising=False
    )
    events = []

    async def capture_post(url, envelope):  # noqa: ANN001
        events.append(envelope.model_dump(exclude_none=True, mode="json"))

    async def fake_select_pages(req):  # noqa: ANN001
        return (
            [{"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p1"}, "texts": {}}],
            select_layout.V3Usage(durationMs=1, geminiCallCount=0, models=select_layout.V3Models()),
        )

    monkeypatch.setattr(select_layout.callback, "post", capture_post)
    monkeypatch.setattr(select_layout, "select_pages", fake_select_pages)

    await select_layout.run_with_timeout(_request())

    assert [event["event"] for event in events] == ["progress", "progress", "progress", "completed"]
    assert events[-1]["jobKind"] == "select-layout"
    assert events[-1]["pages"] == [
        {"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p1"}, "texts": {}}
    ]


@pytest.mark.asyncio
async def test_select_layout_default_emits_candidates_callback(monkeypatch):
    # P2 默认两阶段:phase 1 发 candidates 回调(候选结构),不调 Gemini,不推进 stage。
    events = []

    async def capture_post(url, envelope):  # noqa: ANN001
        events.append(envelope.model_dump(exclude_none=True, mode="json"))

    monkeypatch.setattr(select_layout.callback, "post", capture_post)

    await select_layout.run_with_timeout(_request())

    # 一个 layout 进度 + 一个 candidates 回调。
    kinds = [e["event"] for e in events]
    assert "candidates" in kinds
    cand = next(e for e in events if e["event"] == "candidates")
    assert cand["jobKind"] == "select-layout"
    assert cand["units"] and cand["units"][0]["candidates"]


@pytest.mark.asyncio
async def test_select_layout_inline_writes_full_chain_trace_without_image_payload(
    monkeypatch, tmp_path
):
    # inline 模式:走完整链路(候选→评委→completed),写 input/output trace,图片脱敏。
    monkeypatch.setattr(
        select_layout.get_settings(), "select_layout_inline_judge", True, raising=False
    )
    trace_path = tmp_path / "llm-trace.txt"
    monkeypatch.setenv("YUJEE_LLM_TRACE", str(trace_path))

    async def capture_post(url, envelope):  # noqa: ANN001
        return True

    async def fake_judge(chapter, candidates):  # noqa: ANN001
        return select_layout_agent.LayoutJudgeResult(winner_index=0)

    monkeypatch.setattr(select_layout.callback, "post", capture_post)
    monkeypatch.setattr(select_layout.select_layout_agent, "judge_layout_doubao", fake_judge)

    await select_layout.run_with_timeout(_request())

    trace = trace_path.read_text(encoding="utf-8")
    assert "select-layout input" in trace
    assert "select-layout output" in trace
    assert "data:image" not in trace
    assert '"templateId":' in trace
    assert "data:image" not in trace


@pytest.mark.asyncio
async def test_select_layout_batches_chapters_by_max_images_per_batch(monkeypatch):
    # 新流程逐 unit 生成候选;分批/并发逻辑不变。按 batch 顺序记录被生成候选的章节,
    # 验证分批边界(max_images_per_batch=2 => [ch_1,ch_2] 一批、[ch_3] 一批,串行并发=1)。
    settings = select_layout.get_settings()
    monkeypatch.setattr(settings, "select_layout_max_images_per_batch", 2)
    monkeypatch.setattr(settings, "select_layout_max_concurrency", 1)
    seen: list[str] = []
    real_gen = select_layout.candidate_gen_v3.generate_candidates

    def spy_gen(photos, **kwargs):  # noqa: ANN001, ANN003
        seen.append(str(kwargs.get("seed")))
        return real_gen(photos, **kwargs)

    monkeypatch.setattr(select_layout.candidate_gen_v3, "generate_candidates", spy_gen)

    await select_layout.select_pages(
        _multi_request(
            [
                _chapter("ch_1", ["p1"]),
                _chapter("ch_2", ["p2"]),
                _chapter("ch_3", ["p3"]),
            ]
        )
    )

    # 每章一次候选生成,seed = requestId#chapterId#firstPid,顺序 = 分批顺序展开。
    assert [s.split("#")[1] for s in seen] == ["ch_1", "ch_2", "ch_3"]


@pytest.mark.asyncio
async def test_select_layout_judge_failure_falls_back_per_chapter(monkeypatch):
    # 某章评委失败 => 该章取第 0 个随机候选(不丢照片);其他章正常评委。
    settings = select_layout.get_settings()
    monkeypatch.setattr(settings, "select_layout_max_images_per_batch", 1)
    monkeypatch.setattr(settings, "select_layout_max_concurrency", 2)

    async def fake_judge(chapter, candidates):  # noqa: ANN001
        if (chapter.get("chapterId") if isinstance(chapter, dict) else chapter.chapterId) == "ch_2":
            raise RuntimeError("judge failed")
        return select_layout_agent.LayoutJudgeResult(
            winner_index=0,
            call_count=1,
            model="gemini-ok",
            input_tokens=10,
            output_tokens=2,
        )

    monkeypatch.setattr(select_layout.select_layout_agent, "judge_layout_doubao", fake_judge)

    pages, usage = await select_layout.select_pages(
        _multi_request(
            [
                _chapter("ch_1", ["p1"]),
                _chapter("ch_2", ["p2"]),
                _chapter("ch_3", ["p3"]),
            ]
        )
    )

    # 三章照片全部排上,没有因评委失败而丢失。
    assert any(set(page["images"].values()) == {"p1"} for page in pages)
    assert any(set(page["images"].values()) == {"p2"} for page in pages)
    assert any(set(page["images"].values()) == {"p3"} for page in pages)
    # token 只从成功评委的两章累计(ch_2 走兜底,calls=0)。
    assert usage.geminiCallCount == 2
    assert usage.models.planning == "gemini-ok"


@pytest.mark.asyncio
async def test_select_layout_splits_a_single_oversized_chapter_by_max_images_per_batch(
    monkeypatch,
):
    # 超大章按 max_images_per_batch 拆段,每段独立生成候选(段照片不同 => 各段候选不同)。
    settings = select_layout.get_settings()
    monkeypatch.setattr(settings, "select_layout_max_images_per_batch", 2)
    monkeypatch.setattr(settings, "select_layout_max_concurrency", 1)
    segments: list[list[str]] = []
    real_gen = select_layout.candidate_gen_v3.generate_candidates

    def spy_gen(photos, **kwargs):  # noqa: ANN001, ANN003
        segments.append([_photo_id(p) for p in photos])
        return real_gen(photos, **kwargs)

    monkeypatch.setattr(select_layout.candidate_gen_v3, "generate_candidates", spy_gen)

    await select_layout.select_pages(
        _multi_request([_chapter("ch_big", ["p1", "p2", "p3", "p4", "p5"])])
    )

    assert segments == [["p1", "p2"], ["p3", "p4"], ["p5"]]


def _photo_id(photo) -> str:  # noqa: ANN001
    return photo.get("photoId") if isinstance(photo, dict) else photo.photoId
