"""Template registry loader for the shared JSON template library.

The template source of truth lives in packages/contracts/templates/*.json.
This module keeps the Agent-side public API stable while loading those files
directly at process startup.

Phase 1 of the schema rebuild: the source JSON moved from dict-keyed
``imageSlots``/``textSlots`` + ``category`` to array-shaped ``images``/``texts``
+ ``slot``/``scene``/``pairing``. This module loads the new shape and exposes it
to the rest of the Agent; the new ``scene``/``pairing``/``lang`` fields are
carried through but not yet consumed (no scene-driven template selection, no
forced-pairing logic, no role-driven writing guidance in this phase).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict, cast


TemplateSlot = Literal["cover", "interior", "ending"]
TemplateScene = Literal[
    "opening", "portrait", "scenery", "record", "interlude", "textOnly", "ending"
]
PhotoOrientation = Literal["portrait", "landscape", "square"]
PhotoQuality = Literal["hero", "detail", "fill"]
TextRole = Literal["title", "body", "explain", "decoration"]
TextLang = Literal["user", "en"]
PairingSide = Literal["left", "right"]


class ImageSlot(TypedDict):
    id: str
    orientation: NotRequired[list[PhotoOrientation]]
    quality: NotRequired[list[PhotoQuality]]


class TextSlot(TypedDict):
    id: str
    role: TextRole
    lang: TextLang
    maxChars: NotRequired[int]
    repeat: NotRequired[bool]


class Pairing(TypedDict):
    forced: bool
    with_: NotRequired[str]
    side: NotRequired[PairingSide]


class TemplateDef(TypedDict):
    id: str
    slot: TemplateSlot
    scene: TemplateScene
    images: list[ImageSlot]
    texts: list[TextSlot]
    pairing: NotRequired[dict[str, Any] | None]
    styles: NotRequired[list[str]]


_SLOTS = {"cover", "interior", "ending"}
_SCENES = {
    "opening",
    "portrait",
    "scenery",
    "record",
    "interlude",
    "textOnly",
    "ending",
}
_ORIENTATIONS = {"portrait", "landscape", "square"}
_QUALITIES = {"hero", "detail", "fill"}
_TEXT_ROLES = {"title", "body", "explain", "decoration"}
_TEXT_LANGS = {"user", "en"}

_TEMPLATE_KEYS = {"id", "slot", "scene", "pairing", "styles", "images", "texts"}
_IMAGE_SLOT_KEYS = {"id", "orientation", "quality"}
_TEXT_SLOT_KEYS = {"id", "role", "lang", "maxChars", "repeat"}


def _fail(message: str) -> RuntimeError:
    return RuntimeError(f"template registry load failed: {message}")


def _require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _fail(f"{label} must be an object")
    return value


def _require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise _fail(f"{label} must be an array")
    return value


def _optional_nonempty_string_array(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise _fail(f"{label} must be a non-empty array")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item:
            raise _fail(f"{label} entries must be non-empty strings")
        out.append(item)
    return out


def _validate_image_slot(value: Any, label: str) -> ImageSlot:
    data = _require_dict(value, label)
    extra = set(data) - _IMAGE_SLOT_KEYS
    if extra:
        raise _fail(f"{label} has unsupported fields: {sorted(extra)}")

    slot_id = data.get("id")
    if not isinstance(slot_id, str) or not slot_id:
        raise _fail(f"{label}.id must be a non-empty string")

    out: ImageSlot = {"id": slot_id}
    if "orientation" in data:
        orientations = _optional_nonempty_string_array(data["orientation"], f"{label}.orientation")
        invalid = sorted(set(orientations) - _ORIENTATIONS)
        if invalid:
            raise _fail(f"{label}.orientation has unsupported values: {invalid}")
        out["orientation"] = cast(list[PhotoOrientation], orientations)

    if "quality" in data:
        qualities = _optional_nonempty_string_array(data["quality"], f"{label}.quality")
        invalid = sorted(set(qualities) - _QUALITIES)
        if invalid:
            raise _fail(f"{label}.quality has unsupported values: {invalid}")
        out["quality"] = cast(list[PhotoQuality], qualities)

    return out


def _validate_text_slot(value: Any, label: str) -> TextSlot:
    data = _require_dict(value, label)
    extra = set(data) - _TEXT_SLOT_KEYS
    if extra:
        raise _fail(f"{label} has unsupported fields: {sorted(extra)}")

    slot_id = data.get("id")
    if not isinstance(slot_id, str) or not slot_id:
        raise _fail(f"{label}.id must be a non-empty string")

    role = data.get("role")
    if role not in _TEXT_ROLES:
        raise _fail(f"{label}.role must be one of {sorted(_TEXT_ROLES)}")

    lang = data.get("lang")
    if lang not in _TEXT_LANGS:
        raise _fail(f"{label}.lang must be one of {sorted(_TEXT_LANGS)}")

    out: TextSlot = {
        "id": slot_id,
        "role": cast(TextRole, role),
        "lang": cast(TextLang, lang),
    }
    if "maxChars" in data:
        max_chars = data["maxChars"]
        if isinstance(max_chars, bool) or not isinstance(max_chars, int) or max_chars <= 0:
            raise _fail(f"{label}.maxChars must be a positive integer")
        out["maxChars"] = max_chars
    if "repeat" in data:
        repeat = data["repeat"]
        if not isinstance(repeat, bool):
            raise _fail(f"{label}.repeat must be a boolean")
        out["repeat"] = repeat
    return out


def _validate_template(value: Any, source: Path) -> TemplateDef:
    data = _require_dict(value, str(source))
    missing = {"id", "slot", "scene", "images", "texts"} - set(data)
    if missing:
        raise _fail(f"{source} missing required fields: {sorted(missing)}")
    extra = set(data) - _TEMPLATE_KEYS
    if extra:
        raise _fail(f"{source} has unsupported fields: {sorted(extra)}")

    template_id = data["id"]
    if not isinstance(template_id, str) or not template_id:
        raise _fail(f"{source}.id must be a non-empty string")
    if source.stem != template_id:
        raise _fail(f"{source} id must match file name")

    slot = data["slot"]
    if slot not in _SLOTS:
        raise _fail(f"{source}.slot must be one of {sorted(_SLOTS)}")

    scene = data["scene"]
    if scene not in _SCENES:
        raise _fail(f"{source}.scene must be one of {sorted(_SCENES)}")

    images = [
        _validate_image_slot(slot_def, f"{source}.images[{idx}]")
        for idx, slot_def in enumerate(_require_list(data["images"], f"{source}.images"))
    ]
    texts = [
        _validate_text_slot(slot_def, f"{source}.texts[{idx}]")
        for idx, slot_def in enumerate(_require_list(data["texts"], f"{source}.texts"))
    ]

    out: TemplateDef = {
        "id": template_id,
        "slot": cast(TemplateSlot, slot),
        "scene": cast(TemplateScene, scene),
        "images": images,
        "texts": texts,
    }
    # scene/pairing/lang are carried through but not consumed in Phase 1.
    if "pairing" in data:
        out["pairing"] = data["pairing"]
    if "styles" in data:
        out["styles"] = _optional_nonempty_string_array(data["styles"], f"{source}.styles")
    return out


def _load_templates_from_dir(template_dir: Path) -> dict[str, TemplateDef]:
    if not template_dir.is_dir():
        raise _fail(f"{template_dir} is not a directory")

    json_files = sorted(template_dir.glob("*.json"))
    if not json_files:
        raise _fail(f"{template_dir} contains no template JSON files")

    templates: dict[str, TemplateDef] = {}
    for path in json_files:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            template = _validate_template(raw, path)
        except RuntimeError:
            raise
        except Exception as exc:
            raise _fail(f"{path} could not be parsed: {exc}") from exc

        template_id = template["id"]
        if template_id in templates:
            raise _fail(f"duplicate template id: {template_id}")
        templates[template_id] = template

    return dict(sorted(templates.items()))


def _repo_template_dir_from_file() -> Path | None:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "packages" / "contracts" / "templates"
        if candidate.is_dir():
            return candidate
    return None


def _resolve_template_dir() -> Path:
    explicit = os.environ.get("YUJEE_TEMPLATE_DIR")
    if explicit:
        path = Path(explicit)
        if not path.is_dir():
            raise RuntimeError(f"YUJEE_TEMPLATE_DIR points to a missing template directory: {path}")
        return path

    container_path = Path("/app/packages/contracts/templates")
    if container_path.is_dir():
        return container_path

    repo_path = _repo_template_dir_from_file()
    if repo_path is not None:
        return repo_path

    raise _fail(
        "could not find templates; searched /app/packages/contracts/templates "
        "and parent packages/contracts/templates paths"
    )


def _load_default_templates() -> dict[str, TemplateDef]:
    explicit = os.environ.get("YUJEE_TEMPLATE_DIR")
    template_dir = _resolve_template_dir()
    try:
        return _load_templates_from_dir(template_dir)
    except RuntimeError as exc:
        if explicit:
            raise RuntimeError(f"YUJEE_TEMPLATE_DIR invalid: {explicit}; {exc}") from exc
        raise


# ---------- read helpers (dict→array adaptation) ------------------------------


def image_slots(template: TemplateDef) -> list[ImageSlot]:
    """All image slots of a template, in declaration order."""
    return template["images"]


def text_slots(template: TemplateDef) -> list[TextSlot]:
    """All text slots of a template, in declaration order."""
    return template["texts"]


def image_slot_ids(template: TemplateDef) -> list[str]:
    return [slot["id"] for slot in template["images"]]


def text_slot_ids(template: TemplateDef) -> list[str]:
    return [slot["id"] for slot in template["texts"]]


def image_slot_map(template: TemplateDef) -> dict[str, ImageSlot]:
    """Image slots keyed by id for by-name lookup."""
    return {slot["id"]: slot for slot in template["images"]}


def text_slot_map(template: TemplateDef) -> dict[str, TextSlot]:
    """Text slots keyed by id for by-name lookup."""
    return {slot["id"]: slot for slot in template["texts"]}


def _summarize_image_slot(slot: ImageSlot) -> str:
    slot_name = slot["id"]
    parts: list[str] = []
    if slot.get("orientation"):
        parts.append(f"orient~{'|'.join(slot['orientation'])}")
    if slot.get("quality"):
        prefix = "heroSlot=" if "hero" in slot["quality"] else "quality~"
        parts.append(f"{prefix}{'|'.join(slot['quality'])}")
    body = ",".join(parts) if parts else "any"
    return f"{slot_name}({body})"


def _summarize_templates_for_prompt(templates: dict[str, TemplateDef]) -> str:
    """Compact human-readable registry dump for composing/chat-edit prompts."""
    lines: list[str] = []
    for tid in sorted(templates):
        tpl = templates[tid]
        if tpl["images"]:
            img = "; ".join(_summarize_image_slot(slot) for slot in tpl["images"])
        else:
            img = "(text-only)"
        # role=='decoration' folds in the former 'meta' (page numbers) and 'label'
        # (English sub-labels); both are excluded from the prompt's text summary,
        # matching the prior `type != 'meta'` exclusion of page-number slots.
        txt = ", ".join(
            f"{slot['id']}<={slot.get('maxChars', '?')}c"
            for slot in tpl["texts"]
            if slot["role"] != "decoration"
        )
        lines.append(f"- {tid} [{tpl['slot']}] images: {img} | texts: {txt}")
    return "\n".join(lines)


TEMPLATES: dict[str, TemplateDef] = _load_default_templates()
COVER_TEMPLATE_IDS = sorted(tid for tid, t in TEMPLATES.items() if t["slot"] == "cover")
TEMPLATE_IDS = sorted(TEMPLATES.keys())


def is_known(template_id: str) -> bool:
    return template_id in TEMPLATES


def get(template_id: str) -> TemplateDef | None:
    return TEMPLATES.get(template_id)


def summarize_for_prompt() -> str:
    return _summarize_templates_for_prompt(TEMPLATES)
