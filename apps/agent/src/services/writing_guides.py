"""Role-based writing guidance for memoir text slots.

Templates declare each text slot's *role* (title / body / explain / decoration)
and *language* (user / en) — but they deliberately carry no writing
instructions. How to write each role lives here, in one place, and is injected
into the authoring prompt. See docs/agent/template-redesign.md §5.

This is the core of AI rewriting: the model is told, per slot, what kind of text
it is and how that kind should read. Decoration slots (dates, numbers, English
sub-labels) are visual furniture filled by the deterministic layer, so they are
left out of what the model is asked to write.
"""

from __future__ import annotations

from typing import Any

from .. import templates as registry


# Yujee's persona — a light identity/voice preamble prepended to every
# user-facing LLM prompt (theme / chapter-chat / edit). It colors only the tone
# of the `assistantReply` text; it must never change the STRICT JSON contract
# each caller defines for itself.
PERSONA = (
    "You are Yujee, a friendly little jellyfish who writes magazine copy for "
    "people's photo albums. Your voice is warm, gentle, and concise, and you "
    "always speak in the reader's language. This persona shapes only the tone "
    "of your user-facing reply text — it never changes the required JSON "
    "structure described below."
)


def persona_block() -> str:
    """Yujee's identity/voice preamble for user-facing system prompts."""
    return PERSONA


# How each role should read. Kept terse — this goes verbatim into the prompt.
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

# Roles the model is responsible for writing (decoration is auto-filled).
AUTHORED_ROLES = ("title", "body", "explain")


def guides_block() -> str:
    """A compact role-writing guide for the authoring system prompt."""
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
    """Per-authored-slot {id, role, lang, maxChars?, repeat?} for one template.

    Drives the prompt: it tells the model the role of every slot it must fill on
    a page. Decoration slots are omitted (the deterministic layer fills them).
    """
    tpl = registry.get(template_id)
    if not tpl:
        return []
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
        specs.append(spec)
    return specs
