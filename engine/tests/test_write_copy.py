"""AI copy writer (write_copy) 单测:排版选定之后,豆包把文案写进每页文字槽。

只 mock `ai_client.chat_completion`(test_vision_groups.py 同款 harness),不发真实网络
请求 —— 真实联调由用户自己另外跑。
"""

from __future__ import annotations

import asyncio
import json

import pytest

from src.providers import ai_client
from src.workflows.core.layout.write_copy import handler as write_copy_handler
from src.workflows.core.layout.write_copy.schema import WriteCopyResult


def _unit(*, chapter_context: str = "厦门海边度假,轻松愉快") -> dict:
    return {
        "chapterId": "ch_1",
        "chapterContext": chapter_context,
        "photos": [
            {
                "photoId": "p1",
                "ref200px": "data:image/jpeg;base64,AAAA",
                "orientation": "landscape",
                "takenAt": "2024-05-01T10:00:00Z",
                "sceneDescription": "两个人在海边看日落",
            },
            {
                "photoId": "p2",
                "ref200px": "data:image/jpeg;base64,BBBB",
                "orientation": "portrait",
                "takenAt": "2024-05-01T11:00:00Z",
                "sceneDescription": "沙滩上的脚印",
            },
        ],
    }


def _completion(content: dict) -> dict:
    return {
        "choices": [{"message": {"content": json.dumps(content, ensure_ascii=False)}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }


def _set_deepseek_key(monkeypatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fake_deep")
    from src import settings as s

    s.reset_settings_cache()


def _clear_deepseek_key(monkeypatch) -> None:
    """真正清掉 key。

    Settings 用 pydantic-settings 的 env_file=".env" 【直接读文件】—— 光「不设环境变量」
    是盖不住的:开发机 .env 里有真 key,「无 key 降级」永远模拟不出来(只会在 CI 无 .env
    时碰巧过)。所以这里把 env_file 关掉,只认环境变量 + 源码默认值。
    """
    from src import settings as s

    monkeypatch.setitem(s.Settings.model_config, "env_file", None)
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret")  # 唯一必填字段
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")               # 判空是 `if not ...`
    s.reset_settings_cache()


def test_write_copy_fills_title_and_body_slots(monkeypatch):
    _set_deepseek_key(monkeypatch)
    calls: list[dict] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return _completion(
            {
                "pages": [
                    {
                        "pageIndex": 0,
                        "texts": {
                            "title": "海边黄昏",
                            "explain": "夕阳把海水染成金色,我们并肩坐在沙滩上。",
                        },
                    }
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert result.pages_texts == {
        0: {
            "title": "海边黄昏",
            "explain": "夕阳把海水染成金色,我们并肩坐在沙滩上。",
        }
    }
    assert result.call_count == 1
    assert result.model
    assert result.input_tokens == 10
    assert result.output_tokens == 20
    assert len(calls) == 1

    # sanity: payload sent to the model carries chapterContext + language + the
    # page's writable slot specs(decoration 也在内 —— 装饰文案 AI 也写,页码除外)。
    sent_messages = calls[0]["messages"]
    user_text = sent_messages[1]["content"]
    assert isinstance(user_text, str)  # 纯文本调用:不再组 parts、不附图
    payload = json.loads(user_text)
    assert payload["chapterContext"] == "厦门海边度假,轻松愉快"
    assert payload["language"] == "zh"
    assert payload["pages"][0]["pageIndex"] == 0
    # decoration 槽(如 date)也送给模型 —— 装饰文案也要写。页码不在此列:它已经
    # 不是模板槽位了(展示层按页序统一生成)。
    sent_slot_ids = {slot["id"] for slot in payload["pages"][0]["textSlots"]}
    assert {"title", "explain"} <= sent_slot_ids
    assert "folio" not in sent_slot_ids
    # 不再给模型任何字数上限:模板已不声明 maxChars,篇幅由 sample 示范。
    for slot in payload["pages"][0]["textSlots"]:
        assert "maxChars" not in slot
    # deepseek 纯文本:照片以 sceneDescription 进上下文,photoId 一律短 id,
    # 真实 UUID 绝不进模型 payload(约定:给 AI 的 id 都要转换)。
    photos = payload["pages"][0]["photos"]
    assert photos[0]["photoId"] == "1"
    assert photos[0]["sceneDescription"] == "两个人在海边看日落"
    assert "p1" not in user_text  # 真实 photoId 不出现
    assert "image_url" not in user_text


def test_write_copy_does_not_clamp_text(monkeypatch):
    # 全链路无字数校验:AI 自然成文,长文原样透传(渲染层 fit-text 负责装下)。
    _set_deepseek_key(monkeypatch)

    long_title = "这是一段远超过标题最大字符数限制的超长标题文本用来测试裁剪逻辑是否生效"
    assert len(long_title) > 24

    async def fake_completion(**kwargs):
        return _completion(
            {
                "pages": [
                    {
                        "pageIndex": 0,
                        "texts": {
                            "title": long_title,
                            "explain": "正常长度的正文。",
                        },
                    }
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    # 原样返回,不截断。
    assert result.pages_texts[0]["title"] == long_title
    assert result.pages_texts[0]["explain"] == "正常长度的正文。"


def test_write_copy_writes_decoration_slots_but_not_unknown_ones(monkeypatch):
    """decoration 槽也写(装饰文案装饰属性强,但仍然是要写的文案)。
    模型返回模板里【没有】的槽仍然被丢弃(只认本页槽位规格)。
    页码不在此列 —— 它已经不是模板槽位了(展示层按当前页序统一生成)。"""
    _set_deepseek_key(monkeypatch)
    calls: list[dict] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return _completion(
            {
                "pages": [
                    {
                        "pageIndex": 0,
                        "texts": {
                            "title": "海边黄昏",
                            "explain": "夕阳把海水染成金色。",
                            "date": "05/24",          # decoration 槽 → 收下
                            "notASlot": "越界内容",    # 模板里没有 → 丢掉
                        },
                    }
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",  # title / body / date(decoration)
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    
    assert result.pages_texts[0]["title"] == "海边黄昏"
    assert "notASlot" not in result.pages_texts[0], "模板里没有的槽必须丢弃"

    # 请求侧:decoration 槽也发给模型。
    payload = json.loads(calls[0]["messages"][1]["content"])
    sent_slot_ids = {slot["id"] for slot in payload["pages"][0]["textSlots"]}
    assert "folio" not in sent_slot_ids, "页码不该出现在任何模板槽位里"


def test_write_copy_provider_error_returns_empty_result(monkeypatch):
    _set_deepseek_key(monkeypatch)

    async def fake_completion(**kwargs):
        raise ai_client.AIRequestError("boom", status_code=500, kind="5xx")

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert result == WriteCopyResult(pages_texts={})
    assert result.call_count == 0


def test_write_copy_page_with_only_decoration_slots_is_skipped_no_call(monkeypatch):
    _set_deepseek_key(monkeypatch)
    calls: list[dict] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return _completion({"pages": []})

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-06",  # only a folio (decoration) text slot
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert result.pages_texts == {}
    assert result.call_count == 0
    assert len(calls) == 0


def test_write_copy_missing_deepseek_key_returns_empty_no_call(monkeypatch):
    # 无 DEEPSEEK_API_KEY 时,write_copy 必须优雅降级成空结果、不调模型、不抛异常。
    _clear_deepseek_key(monkeypatch)
    calls: list[dict] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return _completion({"pages": []})

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert result.pages_texts == {}
    assert len(calls) == 0


# ---------- 示例文案来源:槽位自己的 sample(单一真相)-------------------------
# 同一个 sample 串既是 Web 画板的预览占位,也是这里喂给写作 LM 的输出示例。
# 曾经并存的 copy-examples/ 目录已删除(两套示例=信息误差)。


def test_writable_slot_spec_takes_sample_from_the_template_slot():
    # mag-01 的 title 槽在模板 JSON 里带 sample → spec 里必须原样带上,供模型照着写。
    # 注意用 handler 自己绑定的 templates 模块:别的测试会 reload 该模块,
    # 直接 import 拿到的可能是另一个模块对象。
    registry = write_copy_handler.templates

    template = registry.get("mag-01")
    assert template is not None
    declared = {slot["id"]: slot.get("sample") for slot in registry.text_slots(template)}

    specs = write_copy_handler._writable_text_slots({"templateId": "mag-01"})
    by_id = {spec["id"]: spec for spec in specs}

    assert by_id["title"]["sample"] == declared["title"]
    assert by_id["body"]["sample"] == declared["body"]


def test_writable_slot_spec_omits_sample_when_slot_has_none(monkeypatch):
    # 无 sample 的槽:spec 不带 sample 键(优雅降级,绝不 KeyError)。
    registry = write_copy_handler.templates

    fake = {
        "id": "no-sample",
        "category": "interior",
        "images": [{"id": "image"}],
        "texts": [{"id": "body", "role": "body", "lang": "user"}],
    }
    monkeypatch.setitem(registry.TEMPLATES, "no-sample", fake)

    specs = write_copy_handler._writable_text_slots({"templateId": "no-sample"})

    # lang 是契约必填,必须原样带上(标 en 的槽不发就会被 AI 用中文写);sample 无则省略。
    assert specs == [{"id": "body", "role": "body", "lang": "user"}]
    assert "sample" not in specs[0]


def test_writable_slot_spec_forwards_lang(monkeypatch):
    # lang 决定该槽写用户语言还是英文。曾经【完全没发】,于是标 en 的装饰槽
    #(日期/编号/英文标签)被 AI 用中文写。这条守护它一直在 payload 里。
    registry = write_copy_handler.templates
    fake = {
        "id": "with-en",
        "category": "interior",
        "images": [{"id": "image"}],
        "texts": [
            {"id": "title", "role": "title", "lang": "user", "sample": "标题示例"},
            {"id": "label", "role": "decoration", "lang": "en", "sample": "No.01"},
        ],
    }
    monkeypatch.setitem(registry.TEMPLATES, "with-en", fake)

    specs = write_copy_handler._writable_text_slots({"templateId": "with-en"})

    by_id = {s["id"]: s for s in specs}
    assert by_id["title"]["lang"] == "user"
    assert by_id["label"]["lang"] == "en"
    # 每个 spec 都必须带 lang —— 不是可选。
    assert all("lang" in s for s in specs)


def test_writable_slot_spec_expands_items_texts_per_page_instance():
    """items 重复组的文字槽按页面实际格数展开成 base[i]。
    曾经完全没喂 —— mag-10(顶层零文字、全部文字在 items)整页一个字都不写。"""
    page = {
        "templateId": "mag-10",
        "images": {"image[0]": "p1", "image[1]": "p2", "image[2]": "p3", "image[3]": "p4"},
        "texts": {},
    }
    specs = write_copy_handler._writable_text_slots(page)
    ids = [s["id"] for s in specs]
    assert ids == ["explain[0]", "explain[1]", "explain[2]", "explain[3]"], ids
    # 每个展开实例都继承 base 槽的 role/lang/sample。
    for s in specs:
        assert s["role"] == "explain"
        assert s["lang"] == "user"
        assert s.get("sample"), "mag-10 的 explain 声明了 sample,展开后不该丢"


def test_writable_slot_spec_items_expansion_follows_actual_photo_count():
    """页面只放了 2 张照片 → 只展开 explain[0..1],不多写空格子的文案。"""
    page = {
        "templateId": "mag-10",
        "images": {"image[0]": "p1", "image[1]": "p2"},
        "texts": {},
    }
    ids = [s["id"] for s in write_copy_handler._writable_text_slots(page)]
    assert ids == ["explain[0]", "explain[1]"], ids
