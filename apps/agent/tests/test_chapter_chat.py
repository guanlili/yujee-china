import json

import pytest

from src.schemas import Page
from src.schemas_v2 import V2ChapterChatRequest, V2PhotoAnalysis, V2Theme
from src.services import chapter_chat


def _usage_response(payload: dict, prompt_tokens: int = 13, completion_tokens: int = 8):
    return {
        "choices": [{"message": {"content": json.dumps(payload)}}],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        },
    }


def _photo(photo_id: str, description: str, tags: list[str] | None = None) -> V2PhotoAnalysis:
    return V2PhotoAnalysis(
        photoId=photo_id,
        description=description,
        tags=tags or ["rain", "street"],
        quality="hero",
        orientation="landscape",
        peopleCount="0",
        scene="city",
        mood="quiet",
        timeOfDay="evening",
    )


def _req(
    state: str,
    user_message: str,
    *,
    language: str = "en",
    place: str | None = None,
    history: list[dict] | None = None,
    brief: dict | None = None,
) -> V2ChapterChatRequest:
    return V2ChapterChatRequest(
        albumId="alb_1",
        language=language,
        theme=V2Theme(
            subject="quiet spring",
            tone="warm and reflective",
            style="warm-film",
        ),
        chapter={
            "chapterId": "ch_1",
            "state": state,
            "cluster": {
                "label": "rainy streets",
                "place": place,
                "timeRange": "2025-04" if place else None,
                "role": "body",
            },
            "photos": [
                _photo("p1", "lanterns reflected on wet pavement in Kyoto"),
                _photo("p2", "close detail of an umbrella near Shibuya", ["umbrella"]),
            ],
            "brief": brief,
            "pages": [
                Page(pageIndex=2, templateId="mag-13", images={"image": "p1"}, texts={}),
                Page(pageIndex=3, templateId="mag-02", images={}, texts={}),
            ],
        },
        history=history or [],
        userMessage=user_message,
    )


def test_chapter_prompt_scopes_to_one_chapter_without_base64():
    messages = chapter_chat.build_messages(_req("empty", "What should I tell?"), ask_count=0)

    assert "V2ChapterChatResponse" in messages[0]["content"]
    assert "rainy streets" in messages[1]["content"]
    assert "lanterns reflected" in messages[1]["content"]
    assert "base64" not in messages[1]["content"].lower()
    assert "albumId" not in messages[1]["content"]


@pytest.mark.asyncio
async def test_chapter_state_machine_empty_to_asking_then_auto_brief_ready():
    async def first_complete(**_kwargs):
        return _usage_response(
            {
                "assistantReply": "What detail should this chapter remember?",
                "chapterBrief": {"mood": "curious"},
                "state": "asking",
            }
        )

    first = await chapter_chat.run(
        _req("empty", "Start this chapter"),
        ask_count=0,
        complete=first_complete,
    )

    assert first.state == "asking"
    assert first.chapterBrief is not None
    assert first.pagesTexts is None

    async def second_complete(**_kwargs):
        return _usage_response(
            {
                "assistantReply": "One more question?",
                "chapterBrief": {
                    "userWords": "We walked after dinner.",
                    "factNote": "after dinner walk",
                    "mood": "gentle",
                },
                "state": "asking",
            }
        )

    second = await chapter_chat.run(
        _req("asking", "We walked after dinner.", history=[{"role": "assistant", "content": first.assistantReply}]),
        ask_count=1,
        complete=second_complete,
    )

    assert second.state == "brief_ready"
    assert second.chapterBrief is not None
    assert second.chapterBrief.factNote == "after dinner walk"
    assert second.pagesTexts is None


@pytest.mark.asyncio
async def test_brief_ready_generates_page_texts_and_generated_state():
    async def fake_complete(**_kwargs):
        return _usage_response(
            {
                "assistantReply": "I wrote this chapter from your notes.",
                "pagesTexts": [
                    {
                        "pageIndex": 2,
                        "texts": {"title": "after dinner rain", "subtitle": "a slow walk"},
                    },
                    {
                        "pageIndex": 3,
                        "texts": {"items": "wet pavement, warm light"},
                    },
                ],
            }
        )

    res = await chapter_chat.run(
        _req("brief_ready", "Generate", brief={"factNote": "after dinner walk", "mood": "gentle"}),
        ask_count=2,
        complete=fake_complete,
    )

    assert res.state == "generated"
    assert res.pagesTexts is not None
    assert [p.pageIndex for p in res.pagesTexts] == [2, 3]
    assert res.pagesTexts[0].texts["title"] == "after dinner rain"
    assert res.usage.planningInputTokens == 13
    assert res.usage.planningOutputTokens == 8


@pytest.mark.asyncio
async def test_skipped_generation_removes_unprovided_proper_nouns():
    async def fake_complete(**_kwargs):
        return _usage_response(
            {
                "assistantReply": "Drafted safely.",
                "pagesTexts": [
                    {
                        "pageIndex": 2,
                        "texts": {
                            "title": "Kyoto and Shibuya memories",
                            "subtitle": "Alice met Ken at Golden Gate Bridge",
                        },
                    },
                    {
                        "pageIndex": 3,
                        "texts": {"items": "Kyoto, Shibuya, Golden Gate Bridge"},
                    },
                ],
            }
        )

    res = await chapter_chat.run(
        _req("skipped", "skip this chapter", place=None),
        ask_count=0,
        complete=fake_complete,
    )

    assert res.state == "generated"
    assert res.pagesTexts is not None
    all_text = " ".join(text for page in res.pagesTexts for text in page.texts.values())
    for forbidden in ("Kyoto", "Shibuya", "Alice", "Ken", "Golden Gate Bridge"):
        assert forbidden not in all_text


@pytest.mark.asyncio
async def test_skipped_generation_allows_exif_place():
    async def fake_complete(**_kwargs):
        return _usage_response(
            {
                "assistantReply": "Drafted safely.",
                "pagesTexts": [
                    {
                        "pageIndex": 2,
                        "texts": {
                            "title": "Osaka evening",
                            "subtitle": "Golden Gate Bridge should not stay",
                        },
                    }
                ],
            }
        )

    res = await chapter_chat.run(
        _req("skipped", "skip this chapter", place="Osaka"),
        ask_count=0,
        complete=fake_complete,
    )

    all_text = " ".join(text for page in res.pagesTexts or [] for text in page.texts.values())
    assert "Osaka" in all_text
    assert "Golden Gate Bridge" not in all_text


@pytest.mark.asyncio
async def test_skipped_generation_does_not_whitelist_assistant_or_brief_names():
    async def fake_complete(**_kwargs):
        return _usage_response(
            {
                "assistantReply": "Drafted safely.",
                "pagesTexts": [
                    {
                        "pageIndex": 2,
                        "texts": {
                            "title": "Paris evening",
                            "subtitle": "Alice and Ken near the Louvre",
                        },
                    }
                ],
            }
        )

    res = await chapter_chat.run(
        _req(
            "skipped",
            "skip this chapter",
            history=[{"role": "assistant", "content": "Was this in Paris with Alice?"}],
            brief={"factNote": "Paris with Ken", "mood": "warm"},
        ),
        ask_count=0,
        complete=fake_complete,
    )

    all_text = " ".join(text for page in res.pagesTexts or [] for text in page.texts.values())
    for forbidden in ("Paris", "Alice", "Ken", "Louvre"):
        assert forbidden not in all_text


@pytest.mark.asyncio
async def test_skipped_generation_is_safe_for_chinese_model_proper_nouns():
    async def fake_complete(**_kwargs):
        return _usage_response(
            {
                "assistantReply": "已生成。",
                "pagesTexts": [
                    {
                        "pageIndex": 2,
                        "texts": {
                            "title": "小明在东京",
                            "subtitle": "王阿姨和李叔叔去了浅草寺",
                        },
                    }
                ],
            }
        )

    res = await chapter_chat.run(
        _req("skipped", "跳过这一章", language="zh"),
        ask_count=0,
        complete=fake_complete,
    )

    all_text = " ".join(text for page in res.pagesTexts or [] for text in page.texts.values())
    for forbidden in ("小明", "东京", "王阿姨", "李叔叔", "浅草寺"):
        assert forbidden not in all_text


@pytest.mark.parametrize(
    "message",
    [
        "Please don't skip this chapter.",
        "Should we skip this chapter?",
    ],
)
@pytest.mark.asyncio
async def test_non_affirmative_skip_message_does_not_generate_chapter(message: str):
    async def fake_complete(**_kwargs):
        return _usage_response(
            {
                "assistantReply": "What detail should this chapter remember?",
                "chapterBrief": {"mood": "curious"},
                "state": "asking",
            }
        )

    res = await chapter_chat.run(
        _req("empty", message),
        ask_count=0,
        complete=fake_complete,
    )

    assert res.state == "asking"
    assert res.pagesTexts is None
