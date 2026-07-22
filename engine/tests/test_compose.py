"""compose:按章并发写文案 + 全局封面/字体。失败绝不阻断交付。

仓库没配 asyncio_mode,异步测试一律 `asyncio.run(...)` 包在同步测试里。
"""

from __future__ import annotations

import asyncio
import json

from src.workflows.core.compose import handler as compose_handler

_CHAPTER = {
    "chapterId": "c1",
    "title": "2024 年 3 月 · 杭州",
    "chapterContext": "那年春天我回了老家。",
    "photos": [
        {
            "photoId": "p1",
            "ref200px": "data:image/jpeg;base64,AAAA",
            "takenAt": "2024-03-02T09:00:00Z",
            "place": "杭州",
        }
    ],
    "pages": [{"pageIndex": 0, "templateId": "mag-01", "images": {"image": "p1"}}],
}

_COVER_SLOTS = [{"id": "title", "role": "title", "sample": "My Story"}]
_ENDING_SLOTS = [{"id": "closing", "role": "body", "sample": "…"}]


def _gemini_response(text: str, *, in_tok: int = 10, out_tok: int = 5) -> dict:
    """Gemini native generateContent 的真实响应形状(client 返回的就是这个 dict)。"""
    return {
        "candidates": [{"content": {"parts": [{"text": text}]}}],
        "usageMetadata": {"promptTokenCount": in_tok, "candidatesTokenCount": out_tok},
    }


def _set_key(monkeypatch) -> None:
    monkeypatch.setenv("SELECT_LAYOUT_API_KEY", "fake_gemini")
    from src import settings as s

    s.reset_settings_cache()


def _run(monkeypatch, fake_generate):
    _set_key(monkeypatch)
    monkeypatch.setattr(compose_handler.gemini_client, "generate_content", fake_generate)
    return asyncio.run(compose_handler.compose_chapter(_CHAPTER, language="zh"))


# ── 章节批次 ──────────────────────────────────────────────────────────────────


def test_chapter_batch_parses_pages_texts(monkeypatch):
    async def fake_generate(*args, **kwargs):
        return _gemini_response('{"pages":[{"pageIndex":0,"texts":{"title":"糖色"}}]}')

    result = _run(monkeypatch, fake_generate)
    assert result.pages_texts == {0: {"title": "糖色"}}
    assert (result.call_count, result.input_tokens, result.output_tokens) == (1, 10, 5)


def test_chapter_batch_failure_returns_empty_not_raise(monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("gemini down")

    assert _run(monkeypatch, boom).pages_texts == {}


def test_slot_ids_outside_template_are_dropped(monkeypatch):
    async def fake_generate(*args, **kwargs):
        return _gemini_response('{"pages":[{"pageIndex":0,"texts":{"title":"ok","nope":"x"}}]}')

    assert "nope" not in _run(monkeypatch, fake_generate).pages_texts.get(0, {})


def test_photos_enter_context_as_real_images(monkeypatch):
    """核心改动的守卫:照片必须以真图进 Gemini 上下文,不能退回文字描述。"""
    seen: dict = {}

    async def fake_generate(**kwargs):
        seen["messages"] = kwargs["messages"]
        return _gemini_response('{"pages":[]}')

    _run(monkeypatch, fake_generate)
    blob = str(seen["messages"])
    assert "image_url" in blob
    assert "data:image/jpeg;base64,AAAA" in blob
    # 豆包已砍,sceneDescription 恒空 —— 绝不能再以文字描述冒充照片内容。
    assert "sceneDescription" not in blob


def test_chapter_call_is_written_not_judged(monkeypatch):
    """写文案不是判图:客户端默认 temperature=0.1 会让每章一个腔调,成稿要自己给温度。"""
    seen: dict = {}

    async def fake_generate(**kwargs):
        seen.update(kwargs)
        return _gemini_response('{"pages":[]}')

    _run(monkeypatch, fake_generate)
    assert seen["temperature"] > 0.1
    assert seen["max_output_tokens"] == 8192


def test_chapter_payload_carries_user_story_and_all_text_slots(monkeypatch):
    """chapterContext 是用户讲的原话(最高优先级素材),必须进上下文;
    模板的全部文字槽(含 decoration)都要发出去写。"""
    seen: dict = {}

    async def fake_generate(**kwargs):
        seen["messages"] = kwargs["messages"]
        return _gemini_response('{"pages":[]}')

    _run(monkeypatch, fake_generate)
    payload = json.loads(seen["messages"][1]["content"][0]["text"])
    assert payload["chapterContext"] == "那年春天我回了老家。"
    assert payload["chapterTitle"] == "2024 年 3 月 · 杭州"
    slot_ids = {slot["id"] for slot in payload["pages"][0]["textSlots"]}
    assert slot_ids == {"title", "label", "body"}
    # 照片时间/地点是硬事实,跟图一起说明;真实 UUID 绝不入模(短 id)。
    blob = str(seen["messages"])
    assert "杭州" in blob and "p1" not in blob


def test_chapter_without_writable_slots_skips_the_call(monkeypatch):
    _set_key(monkeypatch)
    called: list[int] = []

    async def fake_generate(**kwargs):
        called.append(1)
        return _gemini_response("{}")

    monkeypatch.setattr(compose_handler.gemini_client, "generate_content", fake_generate)
    chapter = {**_CHAPTER, "pages": [{"pageIndex": 0, "templateId": "不存在的模板", "images": {}}]}
    result = asyncio.run(compose_handler.compose_chapter(chapter, language="zh"))
    assert result.pages_texts == {} and called == []


def test_chapter_without_gemini_key_returns_empty(monkeypatch):
    monkeypatch.delenv("SELECT_LAYOUT_API_KEY", raising=False)
    from src import settings as s

    s.reset_settings_cache()

    async def fake_generate(**kwargs):
        raise AssertionError("缺 key 时不该发起调用")

    monkeypatch.setattr(compose_handler.gemini_client, "generate_content", fake_generate)
    assert asyncio.run(compose_handler.compose_chapter(_CHAPTER, language="zh")).pages_texts == {}


# ── 全局批次(封面/封尾文案 + 字体) ──────────────────────────────────────────


def _run_global(monkeypatch, fake_generate, **overrides):
    _set_key(monkeypatch)
    monkeypatch.setattr(compose_handler.gemini_client, "generate_content", fake_generate)
    kwargs = {
        "language": "zh",
        "album_title": "",
        "chapter_titles": ["糖色"],
        "chapter_contexts": ["海边度假"],
        "cover_slots": _COVER_SLOTS,
        "ending_slots": _ENDING_SLOTS,
        "user_font_choice": None,
    }
    kwargs.update(overrides)
    return asyncio.run(compose_handler.compose_global(**kwargs))


def test_global_writes_cover_and_ending_and_resolves_fonts_by_scene(monkeypatch):
    async def fake_generate(**kwargs):
        return _gemini_response(
            json.dumps(
                {
                    "scene": "清新",
                    "coverTexts": {"title": "海边的夏天"},
                    "endingTexts": {"closing": "潮声不止。"},
                },
                ensure_ascii=False,
            )
        )

    result = _run_global(monkeypatch, fake_generate)
    assert result.cover_texts == {"title": "海边的夏天"}
    assert result.ending_texts == {"closing": "潮声不止。"}
    # AI 只输出场景名,字体由代码按 场景×语言 查表填(AI 永不接触字体 id)。
    assert result.fonts == {
        "title": "lxgw-wenkai",
        "body": "lxgw-wenkai",
        "decoration": "dancing-script",
    }


def test_global_drops_slot_ids_outside_the_template(monkeypatch):
    async def fake_generate(**kwargs):
        return _gemini_response('{"coverTexts":{"title":"A","hacker":"B"},"endingTexts":{}}')

    assert _run_global(monkeypatch, fake_generate).cover_texts == {"title": "A"}


def test_global_user_font_choice_wins_and_scene_menu_is_not_sent(monkeypatch):
    """用户在设计卡里选过字体 → 直接采用,不让模型碰字体(载荷里连场景菜单都不发)。"""
    seen: dict = {}

    async def fake_generate(**kwargs):
        seen["messages"] = kwargs["messages"]
        return _gemini_response('{"scene":"清新","coverTexts":{},"endingTexts":{}}')

    chosen = {"title": "long-cang", "body": "noto-sans-sc", "decoration": "sacramento"}
    result = _run_global(monkeypatch, fake_generate, user_font_choice=chosen)
    assert result.fonts == chosen
    payload = json.loads(seen["messages"][1]["content"])
    assert "scenes" not in payload


def test_global_illegal_user_font_falls_back_to_scene(monkeypatch):
    async def fake_generate(**kwargs):
        return _gemini_response('{"scene":"清新","coverTexts":{},"endingTexts":{}}')

    result = _run_global(
        monkeypatch, fake_generate, user_font_choice={"title": "comic-sans", "body": "x"}
    )
    assert result.fonts["title"] == "lxgw-wenkai"


def test_global_failure_falls_back_to_defaults_and_album_title(monkeypatch):
    async def boom(**kwargs):
        raise RuntimeError("gemini down")

    result = _run_global(monkeypatch, boom, language="en", album_title="Summer by the Sea")
    assert result.fonts == {
        "title": "playfair-display",
        "body": "eb-garamond",
        "decoration": "great-vibes",
    }
    # 封面标题槽兜相册标题;其余槽留空串(Web 侧保留模板 sample)。
    assert result.cover_texts == {"title": "Summer by the Sea"}
    assert result.ending_texts == {"closing": ""}
    assert result.call_count == 0


def test_scene_presets_wellformed_and_legal():
    """场景表守卫:精调场景/字体时手滑写错 id、漏 role、装饰用错字体,当场红。"""
    assert compose_handler._DEFAULT_SCENE in compose_handler._SCENE_PRESETS
    for name, preset in compose_handler._SCENE_PRESETS.items():
        assert preset["keywords"], f"{name} 缺触发关键词"
        for lang in ("zh", "en"):
            trio = preset[lang]
            assert set(trio) == {"title", "body", "decoration"}, f"{name}.{lang} 三 role 不齐"
            for role, font in trio.items():
                assert font in compose_handler._LEGAL_FONTS, f"{name}.{lang}.{role} 非法字体: {font}"
            assert trio["decoration"] in compose_handler._DECORATION_SCRIPTS


# ── 编排:按章并发 + 一次回调 ────────────────────────────────────────────────


def _compose_request(chapter_count: int = 2):
    from src.contracts.schemas import ComposeRequest

    chapters = []
    for i in range(chapter_count):
        chapters.append(
            {
                "chapterId": f"c{i}",
                "title": f"第 {i} 章",
                "chapterContext": "用户讲的故事",
                "photos": [{"photoId": f"p{i}", "ref200px": "data:image/jpeg;base64,AA=="}],
                "pages": [{"pageIndex": i, "templateId": "mag-01", "images": {"image": f"p{i}"}}],
            }
        )
    return ComposeRequest(
        requestId="req-1",
        callbackUrl="https://example.com/api/v3/internal/job-progress",
        language="zh",
        albumTitle="我的书",
        coverTemplateId="mag-01",
        endingTemplateId="mag-01",
        coverSlots=_COVER_SLOTS,
        endingSlots=_ENDING_SLOTS,
        userFontChoice=None,
        chapters=chapters,
    )


def _capture_callbacks(monkeypatch):
    from src.workflows import compose as compose_flow

    seen: list = []

    async def fake_post(url, envelope):
        seen.append(envelope)
        return True

    monkeypatch.setattr(compose_flow.callback, "post", fake_post)
    return seen


def test_compose_merges_chapters_into_one_completed_callback(monkeypatch):
    from src.workflows import compose as compose_flow
    from src.workflows.core.compose.schema import ComposeChapterResult, ComposeGlobalResult

    seen = _capture_callbacks(monkeypatch)

    async def fake_chapter(chapter, *, language):
        idx = chapter.pages[0].pageIndex
        return ComposeChapterResult(
            pages_texts={idx: {"title": f"章 {idx}"}}, call_count=1, input_tokens=3, output_tokens=4
        )

    async def fake_global(**kwargs):
        return ComposeGlobalResult(
            cover_texts={"title": "我的书"},
            ending_texts={"closing": "再见"},
            fonts={"title": "noto-serif-sc", "body": "noto-serif-sc", "decoration": "great-vibes"},
            call_count=1,
            input_tokens=1,
            output_tokens=2,
            model="gemini-2.5-flash",
        )

    monkeypatch.setattr(compose_flow.compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_flow.compose_agent, "compose_global", fake_global)

    asyncio.run(compose_flow.run_with_timeout(_compose_request()))

    completed = [e for e in seen if e.event == "completed"]
    assert len(completed) == 1
    body = completed[0]
    assert body.jobKind == "compose"
    assert body.pagesTexts == {0: {"title": "章 0"}, 1: {"title": "章 1"}}
    assert body.coverTexts == {"title": "我的书"}
    assert body.fonts["title"] == "noto-serif-sc"
    assert body.usage.geminiCallCount == 3
    assert body.usage.planningInputTokens == 7
    assert not [e for e in seen if e.event == "failed"]


def test_one_chapter_failing_does_not_fail_the_job(monkeypatch):
    """某章写不出来 → 该章页面不出现在 pagesTexts(Web 保留模板 sample),不发 failed。"""
    from src.workflows import compose as compose_flow
    from src.workflows.core.compose.schema import ComposeChapterResult, ComposeGlobalResult

    seen = _capture_callbacks(monkeypatch)

    async def fake_chapter(chapter, *, language):
        if chapter.chapterId == "c0":
            return ComposeChapterResult()
        return ComposeChapterResult(pages_texts={1: {"title": "写出来了"}}, call_count=1)

    async def fake_global(**kwargs):
        return ComposeGlobalResult()

    monkeypatch.setattr(compose_flow.compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_flow.compose_agent, "compose_global", fake_global)

    asyncio.run(compose_flow.run_with_timeout(_compose_request()))

    completed = [e for e in seen if e.event == "completed"]
    assert len(completed) == 1
    assert completed[0].pagesTexts == {1: {"title": "写出来了"}}
    assert not [e for e in seen if e.event == "failed"]


def test_compose_trace_summary_never_carries_base64(monkeypatch):
    """§隐私:照片 base64 只在请求内存里,永不落盘/进日志/进 trace 摘要。"""
    from src.workflows import compose as compose_flow

    summary = compose_flow._trace_request_summary(_compose_request())
    assert "base64" not in json.dumps(summary, ensure_ascii=False)
    assert summary["chapters"][0]["photos"][0]["hasRef200px"] is True
