"""parse_json_loose:LLM 坏 JSON 的宽容解析。

真实事故(2026-07-31,requestId=315f6769):含 mag-59(8 个文字槽)的章,Gemini
JSON 模式输出整体完好、只少一个闭合括号 —— 解析失败导致整章两页文案(含已写好的
那页)全部丢弃,页面回退成模板 sample,用户看到「没有自动写文案」。
"""

from __future__ import annotations

import pytest

from src.providers.ai_client import parse_json_loose


def test_valid_json_passthrough():
    assert parse_json_loose('{"a": 1}') == {"a": 1}


def test_fenced_json_still_parses():
    assert parse_json_loose('```json\n{"a": 1}\n```') == {"a": 1}


def test_prose_wrapped_json_still_parses():
    assert parse_json_loose('好的,结果如下:{"a": 1} 以上。') == {"a": 1}


def test_missing_one_closing_brace_is_repaired():
    """真实事故形状:第二页对象少一个 `}`(`…"}]}` 应为 `…"}}]}`)。

    两页文案必须都救回来 —— 尤其第一页是模型已经完整写好的。"""
    raw = (
        '{"pages":[{"pageIndex":3,"texts":{"title":"A Glimpse"}},'
        '{"pageIndex":4,"texts":{"title":"Blooming","explain":"花海"}]}'
    )
    parsed = parse_json_loose(raw)
    assert parsed == {
        "pages": [
            {"pageIndex": 3, "texts": {"title": "A Glimpse"}},
            {"pageIndex": 4, "texts": {"title": "Blooming", "explain": "花海"}},
        ]
    }


def test_truncated_mid_string_salvages_complete_prefix():
    """maxOutputTokens 截断:字符串写到一半戛然而止。

    完整的第一页要救回;写了一半的槽宁可丢弃也不要半句话进书。"""
    raw = (
        '{"pages":[{"pageIndex":0,"texts":{"title":"done"}},'
        '{"pageIndex":1,"texts":{"title":"cut off he'
    )
    parsed = parse_json_loose(raw)
    pages = parsed["pages"]
    assert pages[0] == {"pageIndex": 0, "texts": {"title": "done"}}
    # 第二页允许以「无 texts / 空 texts」形式存在,但绝不能带着残句。
    for page in pages[1:]:
        for text in (page.get("texts") or {}).values():
            assert text != "cut off he"


def test_truncated_after_closers_missing_is_repaired():
    """尾部闭合符整段缺失(输出在值结束后被掐断)。"""
    raw = '{"pages":[{"pageIndex":0,"texts":{"title":"完整"}}'
    parsed = parse_json_loose(raw)
    assert parsed["pages"][0]["texts"] == {"title": "完整"}


def test_hopeless_garbage_still_raises():
    with pytest.raises(ValueError):
        parse_json_loose("这里根本没有 JSON")


def test_empty_still_raises():
    with pytest.raises(ValueError):
        parse_json_loose("")
