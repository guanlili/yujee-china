"""Template registry loader for the shared JSON template library.

The template source of truth lives in packages/contracts/templates/*.json.
This module keeps the Agent-side public API stable while loading those files
directly at process startup.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict, cast


TemplateCategory = Literal["cover", "spread", "single", "grid", "closing"]
PhotoOrientation = Literal["portrait", "landscape", "square"]
PhotoQuality = Literal["hero", "detail", "fill"]
TextSlotType = Literal["array", "caption", "heading", "label", "meta", "paragraph", "quote"]


class ImageSlot(TypedDict, total=False):
    orientation: list[PhotoOrientation]
    quality: list[PhotoQuality]


class TextSlot(TypedDict):
    type: TextSlotType
    recommendedMaxChars: NotRequired[int]
    # Compatibility for existing Agent rules until their text-length pass moves
    # from maxChars to recommendedMaxChars. Source JSON may not contain this.
    maxChars: NotRequired[int]


class TemplateDef(TypedDict):
    id: str
    category: TemplateCategory
    imageSlots: dict[str, ImageSlot]
    textSlots: dict[str, TextSlot]
    styles: NotRequired[list[str]]


_CATEGORIES = {"cover", "spread", "single", "grid", "closing"}
_ORIENTATIONS = {"portrait", "landscape", "square"}
_QUALITIES = {"hero", "detail", "fill"}
_TEXT_SLOT_TYPES = {"array", "caption", "heading", "label", "meta", "paragraph", "quote"}

_TEMPLATE_KEYS = {"id", "category", "styles", "imageSlots", "textSlots"}
_IMAGE_SLOT_KEYS = {"orientation", "quality"}
_TEXT_SLOT_KEYS = {"type", "recommendedMaxChars"}
_LEGACY_TEXT_KEYS = {"minChars", "maxChars"}


def _fail(message: str) -> RuntimeError:
    return RuntimeError(f"template registry load failed: {message}")


def _require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _fail(f"{label} must be an object")
    return value


def _require_str_keyed_dict(value: Any, label: str) -> dict[str, Any]:
    data = _require_dict(value, label)
    for key in data:
        if not isinstance(key, str) or not key:
            raise _fail(f"{label} keys must be non-empty strings")
    return data


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

    out: ImageSlot = {}
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
    legacy = sorted(set(data) & _LEGACY_TEXT_KEYS)
    if legacy:
        raise _fail(f"{label} uses legacy fields: {legacy}")
    extra = set(data) - _TEXT_SLOT_KEYS
    if extra:
        raise _fail(f"{label} has unsupported fields: {sorted(extra)}")

    slot_type = data.get("type")
    if slot_type not in _TEXT_SLOT_TYPES:
        raise _fail(f"{label}.type must be one of {sorted(_TEXT_SLOT_TYPES)}")

    out: TextSlot = {"type": cast(TextSlotType, slot_type)}
    if "recommendedMaxChars" in data:
        recommended = data["recommendedMaxChars"]
        if isinstance(recommended, bool) or not isinstance(recommended, int) or recommended <= 0:
            raise _fail(f"{label}.recommendedMaxChars must be a positive integer")
        out["recommendedMaxChars"] = recommended
        out["maxChars"] = recommended
    return out


def _validate_template(value: Any, source: Path) -> TemplateDef:
    data = _require_dict(value, str(source))
    missing = {"id", "category", "imageSlots", "textSlots"} - set(data)
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

    category = data["category"]
    if category not in _CATEGORIES:
        raise _fail(f"{source}.category must be one of {sorted(_CATEGORIES)}")

    image_slots = {
        key: _validate_image_slot(slot, f"{source}.imageSlots.{key}")
        for key, slot in _require_str_keyed_dict(data["imageSlots"], f"{source}.imageSlots").items()
    }
    text_slots = {
        key: _validate_text_slot(slot, f"{source}.textSlots.{key}")
        for key, slot in _require_str_keyed_dict(data["textSlots"], f"{source}.textSlots").items()
    }

    out: TemplateDef = {
        "id": template_id,
        "category": cast(TemplateCategory, category),
        "imageSlots": image_slots,
        "textSlots": text_slots,
    }
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


def _summarize_image_slot(slot_name: str, slot: ImageSlot) -> str:
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
        if tpl["imageSlots"]:
            img = "; ".join(
                _summarize_image_slot(slot_name, slot)
                for slot_name, slot in tpl["imageSlots"].items()
            )
        else:
            img = "(text-only)"
        txt = ", ".join(
            f"{slot_name}<={slot.get('recommendedMaxChars', '?')}c"
            for slot_name, slot in tpl["textSlots"].items()
            if slot.get("type") != "meta"
        )
        lines.append(f"- {tid} [{tpl['category']}] images: {img} | texts: {txt}")
    return "\n".join(lines)


TEMPLATES: dict[str, TemplateDef] = _load_default_templates()
COVER_TEMPLATE_IDS = sorted(tid for tid, t in TEMPLATES.items() if t["category"] == "cover")
TEMPLATE_IDS = sorted(TEMPLATES.keys())


def is_known(template_id: str) -> bool:
    return template_id in TEMPLATES


def get(template_id: str) -> TemplateDef | None:
    return TEMPLATES.get(template_id)


def summarize_for_prompt() -> str:
    return _summarize_templates_for_prompt(TEMPLATES)
