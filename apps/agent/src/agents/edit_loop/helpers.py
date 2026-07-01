"""edit_loop 自包含的槽位规格 + 文案清洗助手(从 story/handler 迁入)。

这些是编辑环节(以及共享的 cover_v3,经 agents/tools/text 再导出)需要的纯函数:

  page_slot_specs(page)           —— 一个具体页的创作文字槽(展开 repeat / items.texts)。
  _template_max_chars(template_id)—— 模板各创作槽的 maxChars(服务端钳长护栏的真相源)。
  _max_chars_for_key(key, by_base)—— 单个 slot key 的 maxChars(普通槽 / bracket base)。
  clean_texts(raw, specs, ...)    —— 只保留模板声明的 text slot,每值钳到该 slot 的 maxChars。

历史上这 4 个函数住在 agents/story/handler.py(chapter-chat 写手)。把它们迁入 edit_loop
让编辑环节自包含;chapter-chat handler 与 agents/tools/text(cover_v3 用)反过来从这里导入,
保持单一真相源。例驱动(maxChars 不进 model-facing 规格)与服务端钳裁的解耦与原实现一致。
"""

from __future__ import annotations

import re
from typing import Any

from ...engine import templates as registry

_BRACKET_KEY_RE = re.compile(r"^([A-Za-z0-9_-]+)\[(\d+)\](?:\..*)?$")

# Page 仅用于类型标注;运行时鸭子类型(templateId / images),避免顶层循环 import。


def page_slot_specs(page: Any) -> list[dict[str, Any]]:
    """一个具体页的创作文字槽。

    普通槽按声明保持。repeat 槽被展开成渲染器能为本页实际图片槽寻址的 bracket key,例如
    一个有 ``cells[0].image`` 和 ``cells[1].image`` 的 mag-10 页会暴露 ``cells[0]`` 和
    ``cells[1]``。当未来某模板只有 V3 ``items.texts`` 声明时,用相同的图片索引把那些 item
    key 暴露为 ``caption[0]`` 等。
    """
    # 按需导入 guides:避免「helpers → story 包 init → story.handler → helpers」的循环
    # (story.handler 在模块顶层从本模块导入这些助手)。guides 自身无此依赖,运行时取安全。
    from ..story import guides as writing_guides

    tpl = registry.get(page.templateId)
    if not tpl:
        return []

    base_specs = writing_guides.page_slot_specs(page.templateId)
    indices_by_base = _bracket_indices_by_base(page.images.keys())
    all_indices = sorted({idx for indices in indices_by_base.values() for idx in indices})

    # `base_specs` 来自 writing_guides(带 role/maxChars,供代码过滤);model-facing 槽规格
    # 一律经 `_slot_spec` 归一 —— 只留 id/lang/hint(+repeatIndex),不外泄 role/maxChars。
    specs: list[dict[str, Any]] = []
    expanded_bases: set[str] = set()
    for spec in base_specs:
        slot_id = str(spec["id"])
        if spec.get("repeat") is True:
            indices = indices_by_base.get(slot_id, [])
            if indices:
                expanded_bases.add(slot_id)
                for idx in indices:
                    specs.append(_slot_spec(spec, slot_id=f"{slot_id}[{idx}]", repeat_index=idx))
                continue
        specs.append(_slot_spec(spec, slot_id=slot_id))

    # V3 items.texts 以 itemId[index] 寻址。若模板已有一个创作的顶层 repeat 槽
    # (mag-10 的遗留 `cells`),本 WP 以那条路径作为渲染器兼容的真相源;否则 items.texts
    # 成为每个页 item 的必填创作槽。
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


def _bracket_indices_by_base(keys: Any) -> dict[str, list[int]]:
    indices: dict[str, set[int]] = {}
    for key in keys:
        if not isinstance(key, str):
            continue
        match = _BRACKET_KEY_RE.fullmatch(key)
        if not match:
            continue
        indices.setdefault(match.group(1), set()).add(int(match.group(2)))
    return {base: sorted(values) for base, values in indices.items()}


def _slot_spec(slot: dict[str, Any], *, slot_id: str, repeat_index: int | None = None) -> dict[str, Any]:
    # 例驱动(example-driven):模型靠逐页「输出示例」+ 逐槽 hint 写作,不再靠规则约束。
    # 故 model-facing 的槽规格只留 id/lang(语言所需)/hint(写什么)/repeatIndex;
    # 不再带 maxChars(无字数约束进 prompt)与 role(示例已表达每槽的性质)。
    spec: dict[str, Any] = {
        "id": slot_id,
        "lang": slot["lang"],
    }
    if slot.get("hint"):
        spec["hint"] = slot["hint"]
    if repeat_index is not None:
        spec["repeatIndex"] = repeat_index
    return spec


def _authored_slot_ids(specs: list[dict[str, Any]]) -> set[str]:
    return {str(spec["id"]) for spec in specs}


def _template_max_chars(template_id: str) -> dict[str, int]:
    """模板各创作槽的 maxChars(按 base slot id),从 registry 直接取 —— 服务端钳长护栏的
    真相源。maxChars 已从 model-facing 槽规格里移除(例驱动,prompt 不带字数),但服务端
    仍据此钳裁防溢出;两件事解耦,各取所需。repeat / items.texts 的 base id 也收进来,
    bracket key(``explain[0]``)按其 base(``explain``)查表。"""
    tpl = registry.get(template_id)
    if not tpl:
        return {}
    out: dict[str, int] = {}
    for slot in tpl.get("texts", []):
        max_chars = slot.get("maxChars")
        if isinstance(max_chars, int) and max_chars > 0:
            out[str(slot["id"])] = max_chars
    for slot in tpl.get("items", {}).get("texts", []):
        max_chars = slot.get("maxChars")
        if isinstance(max_chars, int) and max_chars > 0:
            out[str(slot["id"])] = max_chars
    return out


def _max_chars_for_key(key: str, by_base: dict[str, int]) -> int | None:
    """槽 key 的 maxChars:先按整 key 查(普通槽),再按 bracket base 查(repeat / item 槽)。"""
    if key in by_base:
        return by_base[key]
    match = _BRACKET_KEY_RE.fullmatch(key)
    if match:
        return by_base.get(match.group(1))
    return None


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def clean_texts(
    raw_texts: dict[str, Any], specs: list[dict[str, Any]], *, template_id: str | None = None
) -> dict[str, str]:
    """Public text cleaner for non-writing callers such as cover_v3.

    When a concrete template id is available, use the registry maxChars path. Older
    call sites that only have already-expanded specs still get slot filtering and
    per-spec caps.
    """
    allowed = _authored_slot_ids(specs)
    if template_id:
        max_chars = _template_max_chars(template_id)
    else:
        max_chars = {
            str(spec["id"]): int(spec["maxChars"])
            for spec in specs
            if isinstance(spec.get("id"), str)
            and isinstance(spec.get("maxChars"), int)
            and spec["maxChars"] > 0
        }
    out: dict[str, str] = {}
    for key, value in raw_texts.items():
        if not isinstance(key, str) or key not in allowed:
            continue
        text = _text(value)
        if not text:
            continue
        cap = _max_chars_for_key(key, max_chars) if template_id else max_chars.get(key)
        out[key] = text[:cap] if cap else text
    return out


__all__ = [
    "clean_texts",
    "page_slot_specs",
    "_authored_slot_ids",
    "_bracket_indices_by_base",
    "_max_chars_for_key",
    "_slot_spec",
    "_template_max_chars",
    "_text",
]
