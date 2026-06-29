"""纪念册文字槽的基于 role 的写作指引。

模板声明每个文字槽的 *role*(title / body / explain / decoration)和 *language*
(user / en)—— 但它们刻意不带写作指令。每个 role 怎么写都集中放在这里、一处,并被
注入到创作 prompt。见 docs/agent/template-redesign.md §5。

这是 AI 重写的核心:逐槽告诉模型这是什么类型的文字、这种类型该读起来如何。decoration
槽(日期、数字、英文副标签)是由确定性层填充的视觉点缀,所以被排除在模型被要求写的内容
之外。
"""

from __future__ import annotations

from typing import Any

from ...engine import templates as registry
# 每个 role 该读起来如何。保持精简 —— 这段会原样进入 prompt。
ROLE_GUIDES: dict[str, str] = {
    "title": (
        "a short, evocative heading — the one line that anchors the page; "
        "a few words, no full sentence, no ending punctuation"
    ),
    "body": (
        "the narrative voice — first person, the felt story behind the moment; "
        "warm and specific, never generic filler"
    ),
    "explain": (
        "a caption grounded in what is actually visible in the photo — concrete "
        "and short; never invent people, places, or dates"
    ),
    "decoration": (
        "visual furniture only — a date, number, or short label for rhythm; "
        "terse, meaning is secondary (filled automatically, do not write it)"
    ),
}

# 模型负责撰写的 role(decoration 自动填充)。
AUTHORED_ROLES = ("title", "body", "explain")


def guides_block() -> str:
    """给创作 system prompt 用的一段紧凑的 role 写作指引。"""
    lines = ["Write each text slot to its role:"]
    for role in AUTHORED_ROLES:
        lines.append(f"- {role}: {ROLE_GUIDES[role]}.")
    lines.append(
        "Each slot below is tagged with its role and language. Write `lang=user` "
        "slots in the reader's language; write `lang=en` slots in short universal "
        "English or digits. Respect each slot's maxChars."
    )
    return "\n".join(lines)


def page_slot_specs(template_id: str) -> list[dict[str, Any]]:
    """一个模板的逐创作槽 {id, role, lang, maxChars?, repeat?, hint?}。

    驱动 prompt:它告诉模型一页上它必须填的每个槽的 role。decoration 槽被略去(由确定性
    层填充)。

    逐槽的 ``hint``(由模板设计者撰写,存在模板 JSON 里)在存在时原样透传 —— 写作 LM
    把它当作那个具体槽的意图(§4.2(4) 逐槽 hint 透传)。在这里带上它是叠加性的:不暴露
    hint 的调用方只需忽略这个额外的 key。
    """
    tpl = registry.get(template_id)
    if not tpl:
        return []
    item_texts = [
        item
        for item in tpl.get("items", {}).get("texts", [])
        if item["role"] in AUTHORED_ROLES
    ]
    repeat_item_hint = item_texts[0].get("hint") if len(item_texts) == 1 else None
    specs: list[dict[str, Any]] = []
    for slot in tpl["texts"]:
        if slot["role"] not in AUTHORED_ROLES:
            continue
        spec: dict[str, Any] = {
            "id": slot["id"],
            "role": slot["role"],
            "lang": slot["lang"],
        }
        if slot.get("repeat") is True:
            spec["repeat"] = True
        if slot.get("maxChars"):
            spec["maxChars"] = slot["maxChars"]
        if slot.get("hint"):
            spec["hint"] = slot["hint"]
        elif slot.get("repeat") is True and repeat_item_hint:
            spec["hint"] = repeat_item_hint
        specs.append(spec)
    return specs
