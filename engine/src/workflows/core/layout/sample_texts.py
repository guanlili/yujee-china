"""排版落地时把模板 `sample` 填进 `texts`。

用户在 story 环节看到的是有字的版面,而不是空文字框;compose 环节 Gemini 写出
真文案后逐槽覆盖。写不出来的槽保留 sample —— 交付永不空页。
"""

from __future__ import annotations

from typing import Any

from . import templates


def _item_instance_count(template: Any, page: dict[str, Any]) -> int:
    """本页 items 重复组的实际格数。

    格数从页面 images 的 `image[i]` 键推导(items 的图片展开就是这么生成的),
    与 write_copy 里 `_writable_text_slots` 的规则保持一致。
    """
    items = template.get("items") or {}
    image_bases = {slot["id"] for slot in (items.get("images") or [])}
    count = 0
    for key in (page.get("images") or {}):
        base, _, rest = str(key).partition("[")
        if base in image_bases and rest.endswith("]"):
            count = max(count, int(rest[:-1]) + 1)
    return count


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

            # items 重复组的文字槽:按本页实际格数展开成 `base[i]` 再填 sample。
            # 不展开的话,mag-10 这类顶层零文字、全部文字在 items 的模板会整页空框。
            item_texts = (template.get("items") or {}).get("texts") or []
            if item_texts:
                instance_count = _item_instance_count(template, page)
                for slot in item_texts:
                    sample = slot.get("sample")
                    if not sample:
                        continue
                    for i in range(instance_count):
                        slot_id = f"{slot['id']}[{i}]"
                        if not texts.get(slot_id):
                            texts[slot_id] = sample
        out.append({**page, "texts": texts})
    return out
