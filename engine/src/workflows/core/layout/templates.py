"""共享 JSON 模板库的模板 registry loader。

模板真相源活在 packages/contracts/templates/*.json。
本模块在保持 Agent 侧公开 API 稳定的同时,在进程启动时
直接加载这些文件。

模板契约是 category-only(v3-requirements §9):每个模板
声明单个 ``category``(cover | toc | interior | ending)。遗留的
``slot`` / ``scene`` 字段已移除。Image-slot ``orientation`` / ``quality``
保留 —— 它们供给用于挑模板和分配照片的确定性 image-slot 特征匹配。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict, cast


TemplateCategory = Literal["cover", "interior", "toc", "ending"]
PhotoOrientation = Literal["portrait", "landscape", "square"]
PhotoQuality = Literal["hero", "detail", "fill"]
PhotoComposition = Literal["closeup", "focal", "wide"]
TextRole = Literal["title", "body", "explain", "decoration"]
TextLang = Literal["user", "en"]
PairingSide = Literal["left", "right"]
Pairing = TypedDict("Pairing", {"forced": bool, "with": str, "side": PairingSide})


class ImageSlot(TypedDict):
    id: str
    orientation: NotRequired[list[PhotoOrientation]]
    quality: NotRequired[list[PhotoQuality]]
    # 槽位接受的画面构图;未声明 = 接受任意构图(与 orientation/quality 一致)。
    composition: NotRequired[list[PhotoComposition]]


class TextSlot(TypedDict):
    id: str
    role: TextRole
    lang: TextLang
    repeat: NotRequired[bool]
    variableDecor: NotRequired[bool]
    # 预览占位示例文案:用户未写文案时,Web 渲染用它占位(不进数据,纯预览)。
    sample: NotRequired[str]


class SvgSlot(TypedDict):
    id: str
    variableDecor: NotRequired[bool]


class Items(TypedDict):
    images: NotRequired[list[ImageSlot]]
    texts: NotRequired[list[TextSlot]]


class TemplateDef(TypedDict):
    id: str
    # category 取代遗留的 slot+scene;svgs = 装饰矢量 slot,
    # items = 单一 repeat group。
    category: TemplateCategory
    images: list[ImageSlot]
    texts: list[TextSlot]
    pairing: NotRequired[Pairing | None]
    # 跨页(#303):画布双宽,独占一整个 spread。只在 interior 有效,与 pairing 互斥。
    spread: NotRequired[bool]
    styles: NotRequired[list[str]]
    svgs: NotRequired[list[SvgSlot]]
    items: NotRequired[Items]


_ORIENTATIONS = {"portrait", "landscape", "square"}
_QUALITIES = {"hero", "detail", "fill"}
_COMPOSITIONS = {"closeup", "focal", "wide"}
_TEXT_ROLES = {"title", "body", "explain", "decoration"}
_TEXT_LANGS = {"user", "en"}
_CATEGORIES = {"cover", "interior", "toc", "ending"}

_TEMPLATE_KEYS = {
    "id", "category", "pairing", "spread", "styles", "images", "texts", "svgs", "items",
}
_IMAGE_SLOT_KEYS = {"id", "orientation", "quality", "composition"}
_TEXT_SLOT_KEYS = {"id", "role", "lang", "repeat", "variableDecor", "sample"}
_SVG_SLOT_KEYS = {"id", "variableDecor"}
_ITEMS_KEYS = {"images", "texts"}
_PAIRING_KEYS = {"forced", "with", "side"}


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


def _optional_string_array(value: Any, label: str) -> list[str]:
    if not isinstance(value, list):
        raise _fail(f"{label} must be an array")
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

    if "composition" in data:
        compositions = _optional_nonempty_string_array(
            data["composition"], f"{label}.composition"
        )
        invalid = sorted(set(compositions) - _COMPOSITIONS)
        if invalid:
            raise _fail(f"{label}.composition has unsupported values: {invalid}")
        out["composition"] = cast(list[PhotoComposition], compositions)

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
    if "repeat" in data:
        repeat = data["repeat"]
        if not isinstance(repeat, bool):
            raise _fail(f"{label}.repeat must be a boolean")
        out["repeat"] = repeat
    if "variableDecor" in data:
        variable_decor = data["variableDecor"]
        if not isinstance(variable_decor, bool):
            raise _fail(f"{label}.variableDecor must be a boolean")
        out["variableDecor"] = variable_decor
    if "sample" in data:
        sample = data["sample"]
        if not isinstance(sample, str) or not sample:
            raise _fail(f"{label}.sample must be a non-empty string")
        if len(sample) > 600:
            raise _fail(f"{label}.sample must be at most 600 characters")
        out["sample"] = sample
    return out


def _validate_svg_slot(value: Any, label: str) -> SvgSlot:
    data = _require_dict(value, label)
    extra = set(data) - _SVG_SLOT_KEYS
    if extra:
        raise _fail(f"{label} has unsupported fields: {sorted(extra)}")

    slot_id = data.get("id")
    if not isinstance(slot_id, str) or not slot_id:
        raise _fail(f"{label}.id must be a non-empty string")

    out: SvgSlot = {"id": slot_id}
    if "variableDecor" in data:
        variable_decor = data["variableDecor"]
        if not isinstance(variable_decor, bool):
            raise _fail(f"{label}.variableDecor must be a boolean")
        out["variableDecor"] = variable_decor
    return out


def _validate_items(value: Any, label: str) -> Items:
    data = _require_dict(value, label)
    extra = set(data) - _ITEMS_KEYS
    if extra:
        raise _fail(f"{label} has unsupported fields: {sorted(extra)}")

    out: Items = {}
    if "images" in data:
        out["images"] = [
            _validate_image_slot(slot_def, f"{label}.images[{idx}]")
            for idx, slot_def in enumerate(_require_list(data["images"], f"{label}.images"))
        ]
    if "texts" in data:
        out["texts"] = [
            _validate_text_slot(slot_def, f"{label}.texts[{idx}]")
            for idx, slot_def in enumerate(_require_list(data["texts"], f"{label}.texts"))
        ]
    return out


def _validate_pairing(value: Any, label: str) -> Pairing | None:
    if value is None:
        return None
    data = _require_dict(value, label)
    missing = _PAIRING_KEYS - set(data)
    if missing:
        raise _fail(f"{label} missing required fields: {sorted(missing)}")
    extra = set(data) - _PAIRING_KEYS
    if extra:
        raise _fail(f"{label} has unsupported fields: {sorted(extra)}")

    forced = data["forced"]
    if not isinstance(forced, bool):
        raise _fail(f"{label}.forced must be a boolean")

    paired_with = data["with"]
    if not isinstance(paired_with, str) or not paired_with:
        raise _fail(f"{label}.with must be a non-empty string")

    side = data["side"]
    if side not in {"left", "right"}:
        raise _fail(f"{label}.side must be one of ['left', 'right']")

    return {"forced": forced, "with": paired_with, "side": cast(PairingSide, side)}


def _validate_template(value: Any, source: Path) -> TemplateDef:
    data = _require_dict(value, str(source))
    missing = {"id", "images", "texts"} - set(data)
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

    if "category" not in data:
        raise _fail(f"{source} must declare category")
    if data["category"] not in _CATEGORIES:
        raise _fail(f"{source}.category must be one of {sorted(_CATEGORIES)}")

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
        "category": cast(TemplateCategory, data["category"]),
        "images": images,
        "texts": texts,
    }
    if "pairing" in data:
        pairing = _validate_pairing(data["pairing"], f"{source}.pairing")
        if pairing is not None and data["category"] != "interior":
            raise _fail(f"{source}.pairing is only valid on interior templates")
        out["pairing"] = pairing
    if "spread" in data:
        spread = data["spread"]
        if not isinstance(spread, bool):
            raise _fail(f"{source}.spread must be a boolean")
        if spread and data["category"] != "interior":
            raise _fail(f"{source}.spread is only valid on interior templates")
        if spread and out.get("pairing") is not None:
            raise _fail(f"{source}.spread and pairing are mutually exclusive")
        out["spread"] = spread
    if "styles" in data:
        out["styles"] = _optional_string_array(data["styles"], f"{source}.styles")
    if "svgs" in data:
        out["svgs"] = [
            _validate_svg_slot(slot_def, f"{source}.svgs[{idx}]")
            for idx, slot_def in enumerate(_require_list(data["svgs"], f"{source}.svgs"))
        ]
    if "items" in data:
        out["items"] = _validate_items(data["items"], f"{source}.items")
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


# ---------- read helpers(dict→array 适配)------------------------------------


def image_slots(template: TemplateDef) -> list[ImageSlot]:
    """模板的所有 image slot,按声明顺序。"""
    return template["images"]


def text_slots(template: TemplateDef) -> list[TextSlot]:
    """模板的所有 text slot,按声明顺序。"""
    return template["texts"]


def image_slot_ids(template: TemplateDef) -> list[str]:
    return [slot["id"] for slot in template["images"]]


def text_slot_ids(template: TemplateDef) -> list[str]:
    return [slot["id"] for slot in template["texts"]]


def image_slot_map(template: TemplateDef) -> dict[str, ImageSlot]:
    """以 id 为键的 image slot,供按名查找。"""
    return {slot["id"]: slot for slot in template["images"]}


def text_slot_map(template: TemplateDef) -> dict[str, TextSlot]:
    """以 id 为键的 text slot,供按名查找。"""
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
    """供 composing/chat-edit prompt 用的紧凑人类可读 registry dump。"""
    lines: list[str] = []
    for tid in sorted(templates):
        tpl = templates[tid]
        if tpl["images"]:
            img = "; ".join(_summarize_image_slot(slot) for slot in tpl["images"])
        else:
            img = "(text-only)"
        # role=='decoration' 收纳了原先的 'meta'(页码)和 'label'
        # (英文子标签);两者都被排除在 prompt 的文字摘要之外,
        # 与此前 `type != 'meta'` 排除页码 slot 的做法一致。
        txt = ", ".join(
            f"{slot['id']}({slot['role']})"
            for slot in tpl["texts"]
            if slot["role"] != "decoration"
        )
        classification = tpl["category"]
        lines.append(f"- {tid} [{classification}] images: {img} | texts: {txt}")
    return "\n".join(lines)


TEMPLATES: dict[str, TemplateDef] = _load_default_templates()
COVER_TEMPLATE_IDS = sorted(
    tid for tid, t in TEMPLATES.items() if t["category"] == "cover"
)
TEMPLATE_IDS = sorted(TEMPLATES.keys())


def is_known(template_id: str) -> bool:
    return template_id in TEMPLATES


def get(template_id: str) -> TemplateDef | None:
    return TEMPLATES.get(template_id)


def summarize_for_prompt() -> str:
    return _summarize_templates_for_prompt(TEMPLATES)
