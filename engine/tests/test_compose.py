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


def test_chapter_malformed_json_missing_brace_is_salvaged(monkeypatch):
    """真实事故(315f6769,含 mag-59 的章):模型输出只少一个闭合括号,
    过去整章两页文案全被丢弃、页面回退 sample —— 必须能修复并保住两页。"""
    two_pages = {
        **_CHAPTER,
        "pages": [
            {"pageIndex": 0, "templateId": "mag-01", "images": {"image": "p1"}},
            {"pageIndex": 1, "templateId": "mag-01", "images": {"image": "p1"}},
        ],
    }

    async def fake_generate(*args, **kwargs):
        # 第二页对象缺 `}`:`…"}]}` 应为 `…"}}]}`,与线上 trace 同形。
        return _gemini_response(
            '{"pages":[{"pageIndex":0,"texts":{"title":"A"}},'
            '{"pageIndex":1,"texts":{"title":"B"}]}'
        )

    _set_key(monkeypatch)
    monkeypatch.setattr(compose_handler.gemini_client, "generate_content", fake_generate)
    result = asyncio.run(compose_handler.compose_chapter(two_pages, language="zh"))
    assert result.pages_texts == {0: {"title": "A"}, 1: {"title": "B"}}


def test_chapter_retries_once_then_succeeds(monkeypatch):
    """瞬时失败(网络抖动/空正文)不值一整章 sample:失败后重试一次。"""
    calls: list[int] = []

    async def flaky(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("transient")
        return _gemini_response('{"pages":[{"pageIndex":0,"texts":{"title":"糖色"}}]}')

    result = _run(monkeypatch, flaky)
    assert result.pages_texts == {0: {"title": "糖色"}}
    assert len(calls) == 2
    # usage 口径:两次调用都算次数,token 记成功那次的。
    assert result.call_count == 2


def test_chapter_retry_also_fails_returns_empty(monkeypatch):
    """重试仍失败 → 维持既有兜底:空结果、不抛、恰好两次调用。"""
    calls: list[int] = []

    async def boom(*args, **kwargs):
        calls.append(1)
        raise RuntimeError("gemini down")

    assert _run(monkeypatch, boom).pages_texts == {}
    assert len(calls) == 2


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


def test_chapter_without_gemini_key_skips_the_call(monkeypatch):
    """缺 key 的闸门守卫:必须**一次调用都不发**(不然每章都往 googleapis 打无 key 请求)。

    哨兵只能用计数器,不能靠在 fake 里 raise —— compose_chapter 的兜底是
    `except Exception`,AssertionError 是它的子类,会被吞掉后照样返回空结果。"""
    monkeypatch.delenv("SELECT_LAYOUT_API_KEY", raising=False)
    from src import settings as s

    s.reset_settings_cache()
    called: list[int] = []

    async def fake_generate(**kwargs):
        called.append(1)
        return _gemini_response("{}")

    monkeypatch.setattr(compose_handler.gemini_client, "generate_content", fake_generate)
    result = asyncio.run(compose_handler.compose_chapter(_CHAPTER, language="zh"))
    assert result.pages_texts == {} and called == []


def test_global_without_gemini_key_skips_the_call(monkeypatch):
    """全局批次同一道闸门:缺 key 时落确定性兜底,不发调用。"""
    monkeypatch.delenv("SELECT_LAYOUT_API_KEY", raising=False)
    from src import settings as s

    s.reset_settings_cache()
    called: list[int] = []

    async def fake_generate(**kwargs):
        called.append(1)
        return _gemini_response("{}")

    monkeypatch.setattr(compose_handler.gemini_client, "generate_content", fake_generate)
    result = asyncio.run(
        compose_handler.compose_global(
            language="zh",
            album_title="我的书",
            chapter_titles=["糖色"],
            chapter_contexts=["海边度假"],
            cover_slots=_COVER_SLOTS,
            ending_slots=_ENDING_SLOTS,
        )
    )
    assert called == []
    assert result.cover_texts == {"title": "我的书"} and result.call_count == 0


def test_chapter_with_malformed_item_index_returns_empty_not_raise(monkeypatch):
    """页面 images 里的 `image[x]` 非数字下标会让 int() 抛 ValueError ——
    它发生在模型调用之前,兜底的 try 必须从 page_specs 构建就罩住。"""
    _set_key(monkeypatch)

    async def fake_generate(**kwargs):
        return _gemini_response('{"pages":[]}')

    monkeypatch.setattr(compose_handler.gemini_client, "generate_content", fake_generate)
    chapter = {
        **_CHAPTER,
        "pages": [{"pageIndex": 0, "templateId": "mag-10", "images": {"image[x]": "p1"}}],
    }
    assert asyncio.run(compose_handler.compose_chapter(chapter, language="zh")).pages_texts == {}


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


def test_global_retries_once_then_succeeds(monkeypatch):
    """全局批次同章节批次:一次瞬时失败重试一次,而不是封面/封尾直接落兜底。"""
    calls: list[int] = []

    async def flaky(**kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("transient")
        return _gemini_response('{"coverTexts":{"title":"海边的夏天"},"endingTexts":{}}')

    result = _run_global(monkeypatch, flaky)
    assert result.cover_texts == {"title": "海边的夏天"}
    assert len(calls) == 2 and result.call_count == 2


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


def test_chapter_raising_does_not_fail_the_job(monkeypatch):
    """硬约束的最后一道门:章节任务**抛异常**(handler 兜底没罩住的边角)时,
    也只是这一章掉队 —— 回调里绝不能出现 failed,其余章的文案照常交付。"""
    from src.workflows import compose as compose_flow
    from src.workflows.core.compose.schema import ComposeChapterResult, ComposeGlobalResult

    seen = _capture_callbacks(monkeypatch)

    async def fake_chapter(chapter, *, language):
        if chapter.chapterId == "c0":
            raise RuntimeError("page_specs 炸了")
        return ComposeChapterResult(pages_texts={1: {"title": "写出来了"}}, call_count=1)

    async def fake_global(**kwargs):
        return ComposeGlobalResult(cover_texts={"title": "我的书"})

    monkeypatch.setattr(compose_flow.compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_flow.compose_agent, "compose_global", fake_global)

    asyncio.run(compose_flow.run_with_timeout(_compose_request()))

    # 逐章心跳后事件序列是 progress×(N+1) + completed;关键是一个 failed 都没有。
    assert [e.event for e in seen][-1] == "completed"
    assert not [e for e in seen if e.event == "failed"]
    completed = [e for e in seen if e.event == "completed"]
    assert completed[0].pagesTexts == {1: {"title": "写出来了"}}
    assert completed[0].coverTexts == {"title": "我的书"}


def test_global_raising_does_not_fail_the_job(monkeypatch):
    """全局批次抛出去同理:封面/字体退回空,书照常成稿。"""
    from src.workflows import compose as compose_flow
    from src.workflows.core.compose.schema import ComposeChapterResult

    seen = _capture_callbacks(monkeypatch)

    async def fake_chapter(chapter, *, language):
        return ComposeChapterResult(pages_texts={chapter.pages[0].pageIndex: {"title": "有"}})

    async def fake_global(**kwargs):
        raise RuntimeError("global 炸了")

    monkeypatch.setattr(compose_flow.compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_flow.compose_agent, "compose_global", fake_global)

    asyncio.run(compose_flow.run_with_timeout(_compose_request()))

    assert [e.event for e in seen][-1] == "completed"
    assert not [e for e in seen if e.event == "failed"]
    assert [e for e in seen if e.event == "completed"][0].pagesTexts == {
        0: {"title": "有"},
        1: {"title": "有"},
    }


def test_每章完成都发一次心跳_共_n_加一次_progress(monkeypatch):
    """Web 侧靠 progress 心跳判活。只在 t=0 发一次的话,10 章的大书会被 Web 的僵尸
    扫描当成卡死扫掉,成稿回调回来时 job 已 FAILED,整本书的文案被静默丢弃。"""
    from src.workflows import compose as compose_flow
    from src.workflows.core.compose.schema import ComposeChapterResult, ComposeGlobalResult

    seen = _capture_callbacks(monkeypatch)

    async def fake_chapter(chapter, *, language):
        return ComposeChapterResult(pages_texts={chapter.pages[0].pageIndex: {"title": "有"}})

    async def fake_global(**kwargs):
        return ComposeGlobalResult()

    monkeypatch.setattr(compose_flow.compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_flow.compose_agent, "compose_global", fake_global)

    asyncio.run(compose_flow.run_with_timeout(_compose_request(chapter_count=4)))

    progresses = [e.progress for e in seen if e.event == "progress"]
    assert len(progresses) == 5  # t=0 起手 + 每章一次
    assert progresses[0] == 0
    assert progresses == sorted(progresses)  # 只进不退
    assert progresses[-1] == 95  # 收尾留给 completed 的 100
    assert [e.stage for e in seen if e.event == "progress"] == ["compose"] * 5


def test_写不出来的章也发心跳(monkeypatch):
    """掉队的章同样要推进心跳 —— 否则一章卡住就再没有判活信号。"""
    from src.workflows import compose as compose_flow
    from src.workflows.core.compose.schema import ComposeChapterResult, ComposeGlobalResult

    seen = _capture_callbacks(monkeypatch)

    async def fake_chapter(chapter, *, language):
        if chapter.chapterId == "c0":
            raise RuntimeError("这一章炸了")
        return ComposeChapterResult(pages_texts={chapter.pages[0].pageIndex: {"title": "有"}})

    async def fake_global(**kwargs):
        return ComposeGlobalResult()

    monkeypatch.setattr(compose_flow.compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_flow.compose_agent, "compose_global", fake_global)

    asyncio.run(compose_flow.run_with_timeout(_compose_request(chapter_count=2)))

    assert len([e for e in seen if e.event == "progress"]) == 3
    assert len([e for e in seen if e.event == "completed"]) == 1


def test_心跳发不出去也不阻断交付(monkeypatch):
    """失败绝不阻断交付:progress 回调整个挂掉,书照样成稿。"""
    from src.workflows import compose as compose_flow
    from src.workflows.core.compose.schema import ComposeChapterResult, ComposeGlobalResult

    seen: list = []

    async def flaky_post(url, envelope):
        if envelope.event == "progress":
            raise RuntimeError("callback 挂了")
        seen.append(envelope)
        return True

    monkeypatch.setattr(compose_flow.callback, "post", flaky_post)

    async def fake_chapter(chapter, *, language):
        return ComposeChapterResult(pages_texts={chapter.pages[0].pageIndex: {"title": "有"}})

    async def fake_global(**kwargs):
        return ComposeGlobalResult()

    monkeypatch.setattr(compose_flow.compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_flow.compose_agent, "compose_global", fake_global)

    asyncio.run(compose_flow.run_with_timeout(_compose_request(chapter_count=2)))

    assert [e.event for e in seen] == ["completed"]
    assert seen[0].pagesTexts == {0: {"title": "有"}, 1: {"title": "有"}}


def test_compose_trace_summary_never_carries_base64(monkeypatch):
    """§隐私:照片 base64 只在请求内存里,永不落盘/进日志/进 trace 摘要。"""
    from src.workflows import compose as compose_flow

    summary = compose_flow._trace_request_summary(_compose_request())
    assert "base64" not in json.dumps(summary, ensure_ascii=False)
    assert summary["chapters"][0]["photos"][0]["hasRef200px"] is True


# ── 可观测性:没有真图进上下文时必须留痕 ────────────────────────────────────


def test_chapter_without_any_image_logs_a_warning(monkeypatch):
    """refs 全空 = 整章「不看图写文案」,把本环节的灵魂架空,必须留一条 warning。

    Web 侧拿不到 IndexedDB 缩略图(换浏览器/清站点数据/跨设备)时 refs={} 照常提交,
    生产上除了这条日志没有任何痕迹。"""
    warnings: list[tuple] = []
    monkeypatch.setattr(
        compose_handler.log,
        "warning",
        lambda event, **kw: warnings.append((event, kw)),
    )
    chapter = {**_CHAPTER, "photos": [{"photoId": "p1", "ref200px": ""}]}
    page_specs = [{"pageIndex": 0, "textSlots": [{"id": "title"}], "photoIds": ["p1"]}]

    compose_handler._build_chapter_messages(chapter, page_specs, language="zh")

    assert ("compose.chapter_without_images", {"chapter_id": "c1", "photos": 1}) in warnings


def test_chapter_with_images_does_not_warn(monkeypatch):
    warnings: list[tuple] = []
    monkeypatch.setattr(
        compose_handler.log, "warning", lambda event, **kw: warnings.append((event, kw))
    )
    page_specs = [{"pageIndex": 0, "textSlots": [{"id": "title"}], "photoIds": ["p1"]}]

    compose_handler._build_chapter_messages(_CHAPTER, page_specs, language="zh")

    assert not [w for w in warnings if w[0] == "compose.chapter_without_images"]


def test_compose_accepted_log_records_photos_total(monkeypatch):
    """接单日志只记 chapters/language 的话,「零张真图进模型」在生产上查无对证。"""
    from src.api import routes

    seen: list[tuple] = []
    monkeypatch.setattr(routes.log, "info", lambda event, **kw: seen.append((event, kw)))

    class _Bg:
        def add_task(self, *args, **kwargs):
            pass

    asyncio.run(routes.submit_compose(_compose_request(chapter_count=2), _Bg()))

    accepted = [kw for event, kw in seen if event == "v3_compose.accepted"]
    assert accepted and accepted[0]["photos_total"] == 2


# ── 整体超时不许连坐:已写完的章必须成稿 ────────────────────────────────────


def test_slow_chapter_times_out_alone_and_the_rest_still_complete(monkeypatch):
    """某章超时 = 这一章掉队(保留模板 sample),其余章的文案照常成稿。

    以前是外层一刀切 600s:一章卡住 → 整个 job failed → 已写好的 N−1 章全部作废,
    用户拿到一本纯 sample 的书 + 一次失败。"""
    from src.workflows import compose as compose_flow
    from src.workflows.core.compose.schema import ComposeChapterResult, ComposeGlobalResult

    seen = _capture_callbacks(monkeypatch)
    settings = compose_flow.get_settings()
    monkeypatch.setattr(settings, "compose_chapter_timeout_seconds", 0.05)

    async def fake_chapter(chapter, *, language):
        idx = chapter.pages[0].pageIndex
        if idx == 1:
            await asyncio.sleep(5)  # 这一章永远写不完
        return ComposeChapterResult(pages_texts={idx: {"title": f"章 {idx}"}})

    async def fake_global(**kwargs):
        return ComposeGlobalResult()

    monkeypatch.setattr(compose_flow.compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_flow.compose_agent, "compose_global", fake_global)

    asyncio.run(compose_flow.run_with_timeout(_compose_request(chapter_count=2)))

    assert not [e for e in seen if e.event == "failed"]
    completed = [e for e in seen if e.event == "completed"]
    assert len(completed) == 1
    # 写完的第 0 章在;超时的第 1 章缺席(Web 保留模板 sample)。
    assert completed[0].pagesTexts == {0: {"title": "章 0"}}


# ── 标题走英文、正文跟用户语言(#307) ──────────────────────────────────────────


def test_title_slots_are_forced_to_english_body_follows_user_language():
    """标题类槽一律英文,正文/图注跟用户语言。

    模板 JSON 里 39 个 title 槽有 37 个声明 lang="user";产品决定标题统一走英文
    (杂志感),所以在 payload 构建处按 role 覆盖,而不是去改用户手维护的模板 JSON。
    """
    page = {"pageIndex": 0, "templateId": "mag-01", "images": {}}
    specs = {s["id"]: s for s in compose_handler._writable_text_slots(page)}

    assert specs["title"]["role"] == "title"
    assert specs["title"]["lang"] == "en", "title 槽必须被强制成 en"
    # 正文保持模板声明的 user,跟随用户系统语言
    assert specs["body"]["lang"] == "user", "body 槽必须保持 user"


def test_chapter_payload_sent_to_gemini_marks_title_en_body_user(monkeypatch):
    """端到端:真正发给 Gemini 的请求体里,title 槽 lang=en、body 槽 lang=user。

    只测 _writable_text_slots 不够 —— 要确认覆盖后的 lang 真的进了请求体。
    用户消息是 parts 列表,第一个 text part 就是载荷 JSON(字符串,需再解一层)。
    """
    captured: dict = {}

    async def fake_generate(**kwargs):
        captured.update(kwargs)
        return _gemini_response('{"pages":[]}')

    _run(monkeypatch, fake_generate)

    user_msg = next(m for m in captured["messages"] if m["role"] == "user")
    payload = json.loads(user_msg["content"][0]["text"])
    specs = {
        spec["id"]: spec
        for page in payload["pages"]
        for spec in page["textSlots"]
    }
    assert specs["title"]["lang"] == "en", f"title 应为 en,实际 {specs['title']}"
    assert specs["body"]["lang"] == "user", f"body 应为 user,实际 {specs['body']}"
    # decoration 保持模板声明(mag-01 的 label 本就是 en),不被标题规则波及
    assert specs["label"]["role"] == "decoration"


# ── 追加范围成稿:空封面/封尾槽跳过全局批次 ───────────────────────────────────


def test_追加范围成稿_无封面封尾槽时全局批次不调_gemini(monkeypatch):
    """coverSlots/endingSlots 全空(追加范围成稿):全局批次直接跳过 ——
    不调 Gemini,coverTexts/endingTexts/fonts 全空;章节批次照常写。"""
    from src.workflows import compose as compose_flow
    from src.workflows.core import compose as compose_agent

    _set_key(monkeypatch)

    async def fake_chapter(chapter, *, language):
        return compose_agent.ComposeChapterResult(
            pages_texts={0: {"title": "新章标题"}}, call_count=1
        )

    global_called = []

    async def fake_global(**kwargs):
        global_called.append(True)
        raise AssertionError("no cover/ending slots -> global batch must be skipped")

    posted: list = []

    async def fake_post(url, envelope):
        posted.append(envelope)

    monkeypatch.setattr(compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_agent, "compose_global", fake_global)
    monkeypatch.setattr(compose_flow.callback, "post", fake_post)

    req = compose_flow.ComposeRequest.model_validate(
        {
            "requestId": "req-append",
            "callbackUrl": "http://web.test/cb",
            "language": "zh",
            "chapters": [_CHAPTER],
        }
    )
    asyncio.run(compose_flow._run_compose(compose_flow._Job(req)))

    # 全局批次不应该被调用
    assert global_called == [], "global batch should be skipped when coverSlots/endingSlots are empty"

    completed = next(e for e in posted if getattr(e, "event", "") == "completed")
    assert completed.pagesTexts == {0: {"title": "新章标题"}}
    assert completed.coverTexts == {}
    assert completed.endingTexts == {}
    assert completed.fonts == {}
