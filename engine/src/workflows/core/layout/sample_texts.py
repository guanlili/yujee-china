"""排版落地时把模板 `sample` 填进 `texts`。

用户在 story 环节看到的是有字的版面,而不是空文字框;compose 环节 Gemini 写出
真文案后逐槽覆盖。写不出来的槽保留 sample —— 交付永不空页。
"""

from __future__ import annotations

from typing import Any

from . import templates


def fill_sample_texts(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for page in pages:
        template = templates.get(page.get("templateId")) if isinstance(page.get("templateId"), str) else None
        texts = dict(page.get("texts") or {})
        if template is not None:
            for slot in templates.text_slots(template):
                sample = slot.get("sample")
                if sample and not texts.get(slot["id"]):
                    texts[slot["id"]] = sample
        out.append({**page, "texts": texts})
    return out
