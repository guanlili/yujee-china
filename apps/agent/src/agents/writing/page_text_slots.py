"""页面创作文字槽的规格 + 清洗护栏(从 chapter-chat handler 抽出的共享层)。

chapter-chat 的 write/edit 和统一创作 agent loop 都要"按某页模板的合法创作槽来钳文字"
(保留集 = 模板创作槽、按 maxChars 钳、丢空值)。原本这些函数是 `writing/handler.py` 的私有
实现;loop 复用它们而 handler 又调 loop 会造成循环 import,故抽到这里。纯函数、只读模板注册表,
不持任何状态。
"""

from __future__ import annotations

import re
from typing import Any

from ...engine import templates as registry
from ...schemas import Page
from . import guides as writing_guides

# repeat 槽展开后的 bracket key(如 `cells[0]`):base 名 + 索引。
BRACKET_KEY_RE = re.compile(r"^([A-Za-z0-9_-]+)\[(\d+)\](?:\..*)?$")


def slot_specs_by_index(pages: list[Page]) -> dict[int, list[dict[str, Any]]]:
    """逐页的创作槽规格(id/role/lang/maxChars[/repeat][/hint]),按 pageIndex 索引。"""
    return {page.pageIndex: slot_specs_for_page(page) for page in pages}


def slot_specs_for_page(page: Page) -> list[dict[str, Any]]:
    """一个具体页的创作文字槽。

    普通槽按声明保持。repeat 槽被展开成渲染器能为本页实际图片槽寻址的 bracket key,例如
    一个有 ``cells[0].image`` 和 ``cells[1].image`` 的 mag-10 页会暴露 ``cells[0]`` 和
    ``cells[1]``。当未来某模板只有 V3 ``items.texts`` 声明时,用相同的图片索引把那些 item
    key 暴露为 ``caption[0]`` 等。
    """
    tpl = registry.get(page.templateId)
    if not tpl:
        return []

    base_specs = writing_guides.page_slot_specs(page.templateId)
    indices_by_base = _bracket_indices_by_base(page.images.keys())
    all_indices = sorted({idx for indices in indices_by_base.values() for idx in indices})

    specs: list[dict[str, Any]] = []
    expanded_bases: set[str] = set()
    for spec in base_specs:
        slot_id = str(spec["id"])
        if spec.get("repeat") is True:
            indices = indices_by_base.get(slot_id, [])
            if indices:
                expanded_bases.add(slot_id)
                for idx in indices:
                    item_spec = {**spec, "id": f"{slot_id}[{idx}]", "repeatIndex": idx}
                    item_spec.pop("repeat", None)
                    specs.append(item_spec)
                continue
        specs.append(spec)

    # V3 items.texts 以 itemId[index] 寻址。若模板已有一个创作的顶层 repeat 槽
    # (mag-10 的遗留 `cells`),以那条路径作为渲染器兼容的真相源;否则 items.texts 成为
    # 每个页 item 的必填创作槽。
    item_texts = tpl.get("items", {}).get("texts", [])
    has_authored_repeat = bool(expanded_bases)
    if all_indices:
        for slot in item_texts:
            if slot["role"] not in writing_guides.AUTHORED_ROLES:
                continue
            if has_authored_repeat:
                continue
            for idx in all_indices:
                specs.append(_slot_spec(slot, slot_id=f"{slot['id']}[{idx}]", repeat_index=idx))
    return specs


def clean_texts(raw_texts: dict[str, Any], specs: list[dict[str, Any]]) -> dict[str, str]:
    """只保留本页的创作槽,trim,丢空值,钳到 maxChars。

    漂移的模型既无法注入不存在的槽位 id(保留集 = 模板的创作槽),也无法撑爆某槽
    (maxChars 钳)。这是 chapter-chat 文字编辑与创作 loop write_texts 共用的护栏。"""
    allowed = {str(spec["id"]) for spec in specs}
    max_chars = _max_chars_by_slot(specs)
    out: dict[str, str] = {}
    for key, value in raw_texts.items():
        if not isinstance(key, str) or key not in allowed:
            continue
        text = as_text(value)
        if not text:
            continue
        cap = max_chars.get(key)
        out[key] = text[:cap] if cap else text
    return out


def as_text(value: Any) -> str:
    """非空字符串则 trim 返回,否则空串。"""
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _bracket_indices_by_base(keys: Any) -> dict[str, list[int]]:
    indices: dict[str, set[int]] = {}
    for key in keys:
        if not isinstance(key, str):
            continue
        match = BRACKET_KEY_RE.fullmatch(key)
        if not match:
            continue
        indices.setdefault(match.group(1), set()).add(int(match.group(2)))
    return {base: sorted(values) for base, values in indices.items()}


def _slot_spec(slot: dict[str, Any], *, slot_id: str, repeat_index: int | None = None) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "id": slot_id,
        "role": slot["role"],
        "lang": slot["lang"],
    }
    if slot.get("maxChars"):
        spec["maxChars"] = slot["maxChars"]
    if slot.get("hint"):
        spec["hint"] = slot["hint"]
    if repeat_index is not None:
        spec["repeatIndex"] = repeat_index
    return spec


def _max_chars_by_slot(specs: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for spec in specs:
        max_chars = spec.get("maxChars")
        if isinstance(max_chars, int) and max_chars > 0:
            out[str(spec["id"])] = max_chars
    return out
