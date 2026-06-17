"""Real vision stage: Volcano Ark `doubao-seed-1-6-vision` in a single
multi-image call. Output schema mirrors docs/agent/design.md §2.6 with the 5
extension fields (peopleCount / scene / mood / timeOfDay / location).

Privacy: photo base64 is passed into the upstream HTTP body and then the
local reference is dropped; we never log it or hand it back to the caller."""

from math import ceil
import re
from typing import Any

from pydantic import ValidationError

from ..logging_config import get_logger
from ..schemas import LayoutRequest, PhotoAnalysis, PhotoGroup, VisionResult
from ..settings import get_settings
from . import ai_client
from .vision_provider import VisionSlotError, estimate_cost_usd, select_vision_slot

log = get_logger("vision")


_ALLOWED_QUALITY = {"hero", "detail", "fill"}
_ALLOWED_ORIENT = {"portrait", "landscape", "square"}
_ALLOWED_PEOPLE = {"0", "1", "2-3", "4+"}
_ALLOWED_SCENE = {"indoor", "outdoor", "nature", "city", "interior"}
_ALLOWED_MOOD = {"warm", "cool", "sentimental", "energetic", "quiet"}
_ALLOWED_TIME = {"morning", "day", "evening", "night"}


class VisionError(Exception):
    """Vision stage failed in a way that should surface as AGENT_VISION_FAILED."""


def _photo_orientation(width: int, height: int) -> str:
    if width > height * 1.05:
        return "landscape"
    if height > width * 1.05:
        return "portrait"
    return "square"


def _build_system_prompt(photo_count: int) -> str:
    hero_cap = max(1, ceil(photo_count / 3))
    return (
        "You analyze a batch of memoir photos for an AI-curated photo album. "
        "Output STRICT JSON only: a JSON object with keys photos and groups. "
        "photos must be a JSON array of length equal to the number of input "
        "images, in the SAME ORDER as the inputs. Do not wrap with code fences "
        "or commentary.\n\n"
        "Each photos[] element must be an object with EXACTLY these keys:\n"
        '  "description": one short English sentence (<=120 chars) about what is visible. '
        "Describe only what is visible. Do not invent people, places, or events.\n"
        '  "tags": 3-6 short English keywords (lowercase words or hyphenated phrases).\n'
        '  "quality": one of "hero" | "detail" | "fill". '
        'Pick "hero" only for striking, narratively strong images that can carry a full page; '
        '"detail" for solid supporting shots; "fill" for small / atmospheric / background-quality images.\n'
        '  "orientation": one of "portrait" | "landscape" | "square" — describe the photo crop.\n'
        '  "peopleCount": one of "0" | "1" | "2-3" | "4+".\n'
        '  "scene": one of "indoor" | "outdoor" | "nature" | "city" | "interior".\n'
        '  "mood": one of "warm" | "cool" | "sentimental" | "energetic" | "quiet".\n'
        '  "timeOfDay": one of "morning" | "day" | "evening" | "night", or null if uncertain.\n'
        '  "location": a short free-text guess (e.g. "Kyoto street", "kitchen") or null.\n\n'
        "groups must be an array of 1-5 objects that cluster adjacent narrative moments:\n"
        '  "groupId": short stable id such as "g1".\n'
        '  "label": short English theme label.\n'
        '  "photoIds": photo ids from the input batch only.\n'
        '  "role": one of "opening" | "body" | "closing", or null.\n\n'
        f"HARD RULE: at most {hero_cap} of the {photo_count} photos may have quality=\"hero\". "
        "If you would exceed the cap, downgrade the weaker ones to \"detail\"."
    )


def _build_user_content(req: LayoutRequest) -> list[dict[str, Any]]:
    photo_manifest = "\n".join(
        f"{idx + 1}. photoId={photo.photoId} width={photo.width} height={photo.height}"
        for idx, photo in enumerate(req.photos)
    )
    parts: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "User memoir prompt (context only, do not re-emit verbatim):\n"
                f"{req.prompt}\n\n"
                f"Photos follow in order (count={len(req.photos)}). "
                "Use these exact photoId values in groups[].photoIds:\n"
                f"{photo_manifest}\n\n"
                'Return {"photos":[...], "groups":[...]} with photos in the same order.'
            ),
        }
    ]
    for photo in req.photos:
        parts.append({"type": "image_url", "image_url": {"url": photo.base64}})
    return parts


def _coerce_one(item: Any, photo_id: str, fallback_orient: str) -> PhotoAnalysis:
    if not isinstance(item, dict):
        raise VisionError(f"vision item for {photo_id} is not an object")

    description = str(item.get("description") or "").strip() or "A moment from your story."
    tags = item.get("tags") or []
    if not isinstance(tags, list):
        tags = [str(tags)]
    tags = [str(t).strip() for t in tags if str(t).strip()][:6]
    if not tags:
        tags = ["memoir"]

    quality = str(item.get("quality") or "").lower()
    if quality not in _ALLOWED_QUALITY:
        quality = "detail"

    orientation = str(item.get("orientation") or "").lower()
    if orientation not in _ALLOWED_ORIENT:
        orientation = fallback_orient

    people = str(item.get("peopleCount") or "").strip()
    if people not in _ALLOWED_PEOPLE:
        people = "0"

    scene = str(item.get("scene") or "").lower()
    if scene not in _ALLOWED_SCENE:
        scene = "outdoor"

    mood = str(item.get("mood") or "").lower()
    if mood not in _ALLOWED_MOOD:
        mood = "warm"

    raw_time = item.get("timeOfDay")
    time_of_day: str | None
    if raw_time in (None, "", "null"):
        time_of_day = None
    else:
        candidate = str(raw_time).lower()
        time_of_day = candidate if candidate in _ALLOWED_TIME else None

    raw_loc = item.get("location")
    location = None if raw_loc in (None, "", "null") else str(raw_loc).strip()[:80] or None

    try:
        return PhotoAnalysis(
            photoId=photo_id,
            description=description[:240],
            tags=tags,
            quality=quality,  # type: ignore[arg-type]
            orientation=orientation,  # type: ignore[arg-type]
            peopleCount=people,  # type: ignore[arg-type]
            scene=scene,  # type: ignore[arg-type]
            mood=mood,  # type: ignore[arg-type]
            timeOfDay=time_of_day,  # type: ignore[arg-type]
            location=location,
        )
    except ValidationError as exc:
        raise VisionError(f"vision item failed schema for {photo_id}: {exc.errors()[:1]}") from exc


def _enforce_hero_cap(items: list[PhotoAnalysis]) -> list[PhotoAnalysis]:
    cap = max(1, ceil(len(items) / 3))
    hero_indices = [i for i, p in enumerate(items) if p.quality == "hero"]
    if len(hero_indices) <= cap:
        return items
    # Demote the trailing heroes deterministically.
    for idx in hero_indices[cap:]:
        items[idx] = items[idx].model_copy(update={"quality": "detail"})
    log.info("vision.hero_cap_enforced", cap=cap, demoted=len(hero_indices) - cap)
    return items


def _normalize_group_id(raw: Any, fallback: str) -> str:
    candidate = str(raw or "").strip().lower()
    candidate = re.sub(r"[^a-z0-9]+", "-", candidate).strip("-")
    return candidate or fallback


def _unique_group_id(base: str, used: set[str]) -> str:
    if base not in used:
        used.add(base)
        return base
    suffix = 2
    while f"{base}-{suffix}" in used:
        suffix += 1
    unique = f"{base}-{suffix}"
    used.add(unique)
    return unique


def _fallback_groups(photo_ids: list[str]) -> list[PhotoGroup]:
    if len(photo_ids) == 1:
        return [
            PhotoGroup(groupId="g1", label="Closing", photoIds=[photo_ids[0]], role="closing")
        ]
    if len(photo_ids) == 2:
        return [
            PhotoGroup(groupId="g1", label="Opening", photoIds=[photo_ids[0]], role="opening"),
            PhotoGroup(groupId="g2", label="Closing", photoIds=[photo_ids[1]], role="closing"),
        ]

    return [
        PhotoGroup(groupId="g1", label="Opening", photoIds=[photo_ids[0]], role="opening"),
        PhotoGroup(groupId="g2", label="Body", photoIds=photo_ids[1:-1], role="body"),
        PhotoGroup(groupId="g3", label="Closing", photoIds=[photo_ids[-1]], role="closing"),
    ]


def _sanitize_groups(raw_groups: Any, photo_ids: list[str]) -> list[PhotoGroup]:
    if not isinstance(raw_groups, list):
        return _fallback_groups(photo_ids)

    allowed_ids = set(photo_ids)
    allowed_roles = {"opening", "body", "closing"}
    used_group_ids: set[str] = set()
    groups: list[PhotoGroup] = []

    for item in raw_groups:
        if not isinstance(item, dict):
            continue

        seen_photo_ids: set[str] = set()
        group_photo_ids: list[str] = []
        raw_photo_ids = item.get("photoIds") if isinstance(item.get("photoIds"), list) else []
        for raw_pid in raw_photo_ids:
            pid = str(raw_pid)
            if pid in allowed_ids and pid not in seen_photo_ids:
                seen_photo_ids.add(pid)
                group_photo_ids.append(pid)
        if not group_photo_ids:
            continue

        idx = len(groups) + 1
        group_id = _unique_group_id(
            _normalize_group_id(item.get("groupId"), f"g{idx}"),
            used_group_ids,
        )
        label = str(item.get("label") or "").strip() or f"Group {idx}"
        raw_role = item.get("role")
        role = raw_role if isinstance(raw_role, str) and raw_role in allowed_roles else None
        groups.append(
            PhotoGroup(
                groupId=group_id,
                label=label[:80],
                photoIds=group_photo_ids,
                role=role,  # type: ignore[arg-type]
            )
        )

    return groups or _fallback_groups(photo_ids)


async def analyze(req: LayoutRequest) -> tuple[VisionResult, int, str]:
    """Run vision on all photos in one batched call. Returns
    (vision_result, total_tokens_billed_to_vision, resolved_model). The resolved
    model is the slot's actual model id (doubao or gpt-*), so callers can report
    the true `models.vision` in Usage instead of hardwiring the ark model — the
    slot helper is the single source of truth for which provider was hit (#166).
    Raises VisionError on any failure that should map to AGENT_VISION_FAILED."""
    settings = get_settings()
    try:
        slot = select_vision_slot(settings)
    except VisionSlotError as exc:
        raise VisionError(str(exc)) from exc

    fallback_orients = [_photo_orientation(p.width, p.height) for p in req.photos]
    photo_ids = [p.photoId for p in req.photos]
    photo_count = len(req.photos)
    log.info(
        "vision.call.start",
        photo_count=photo_count,
        provider=slot.provider,
        model=slot.model,
    )

    messages = [
        {"role": "system", "content": _build_system_prompt(photo_count)},
        {"role": "user", "content": _build_user_content(req)},
    ]

    try:
        response = await ai_client.chat_completion(
            base_url=slot.base_url,
            api_key=slot.api_key,
            model=slot.model,
            messages=messages,
            timeout_seconds=slot.timeout_seconds,
            temperature=0.2,
            max_tokens=8192,
            response_format=slot.response_format,
            # doubao's `thinking` knob is set here only for the ark slot; the
            # openai slot's extra_body is always None (OpenAI 400s on `thinking`).
            extra_body=slot.extra_body,
        )
    except ai_client.AIRequestError as exc:
        raise VisionError(f"vision upstream call failed: {exc}") from exc
    # Drop our local handle to the user_content (with base64s) before parsing.
    messages = []  # noqa: F841
    del messages

    try:
        raw_text = ai_client.extract_text(response)
        parsed = ai_client.parse_json_loose(raw_text)
    except ValueError as exc:
        raise VisionError(f"vision response unparseable: {exc}") from exc

    prompt_tokens, completion_tokens = ai_client.extract_usage(response)

    raw_groups: Any = []
    if isinstance(parsed, dict):
        photos_raw = parsed.get("photos")
        raw_groups = parsed.get("groups", [])
    elif isinstance(parsed, list):
        photos_raw = parsed
    else:
        raise VisionError(
            f"vision response is not a JSON object or array (got {type(parsed).__name__})"
        )

    if not isinstance(photos_raw, list):
        raise VisionError(
            f"vision response photos is not a JSON array (got {type(photos_raw).__name__})"
        )
    if len(photos_raw) != photo_count:
        raise VisionError(
            f"vision response length {len(photos_raw)} != photo count {photo_count}"
        )

    analyses = [
        _coerce_one(item, photo_id=photo_ids[i], fallback_orient=fallback_orients[i])
        for i, item in enumerate(photos_raw)
    ]
    analyses = _enforce_hero_cap(analyses)
    groups = _sanitize_groups(raw_groups, photo_ids)

    log.info(
        "vision.call.ok",
        provider=slot.provider,
        model=slot.model,
        photo_count=photo_count,
        group_count=len(groups),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        # None for per-image-billed providers (doubao); a USD estimate for GPT.
        est_cost_usd=estimate_cost_usd(slot.model, prompt_tokens, completion_tokens),
    )
    return (
        VisionResult(photos=analyses, groups=groups),
        prompt_tokens + completion_tokens,
        slot.model,
    )
