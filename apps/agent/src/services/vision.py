"""Real vision stage: Volcano Ark `doubao-seed-1-6-vision` in a single
multi-image call. Output schema mirrors docs/agent/design.md §2.6 with the 5
extension fields (peopleCount / scene / mood / timeOfDay / location).

Privacy: photo base64 is passed into the upstream HTTP body and then the
local reference is dropped; we never log it or hand it back to the caller."""

from math import ceil
from typing import Any

from pydantic import ValidationError

from ..logging_config import get_logger
from ..schemas import LayoutRequest, PhotoAnalysis
from ..settings import get_settings
from . import ai_client

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
        "Output STRICT JSON only: a JSON array of length equal to the number "
        "of input images, in the SAME ORDER as the inputs. Do not wrap with "
        "code fences or commentary.\n\n"
        "Each array element must be an object with EXACTLY these keys:\n"
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
        f"HARD RULE: at most {hero_cap} of the {photo_count} photos may have quality=\"hero\". "
        "If you would exceed the cap, downgrade the weaker ones to \"detail\"."
    )


def _build_user_content(req: LayoutRequest) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "User memoir prompt (context only, do not re-emit verbatim):\n"
                f"{req.prompt}\n\n"
                f"Photos follow in order (count={len(req.photos)}). "
                "Return a JSON array of analyses in the same order."
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


async def analyze(req: LayoutRequest) -> tuple[list[PhotoAnalysis], int]:
    """Run vision on all photos in one batched call. Returns
    (analyses, total_tokens_billed_to_vision). Raises VisionError on any
    failure that should map to AGENT_VISION_FAILED."""
    settings = get_settings()
    if not settings.ark_api_key:
        raise VisionError("ARK_API_KEY missing; cannot run real vision stage")

    fallback_orients = [_photo_orientation(p.width, p.height) for p in req.photos]
    photo_ids = [p.photoId for p in req.photos]
    photo_count = len(req.photos)
    log.info("vision.call.start", photo_count=photo_count, model=settings.ark_vision_model)

    messages = [
        {"role": "system", "content": _build_system_prompt(photo_count)},
        {"role": "user", "content": _build_user_content(req)},
    ]

    try:
        response = await ai_client.chat_completion(
            base_url=settings.ark_base_url,
            api_key=settings.ark_api_key,
            model=settings.ark_vision_model,
            messages=messages,
            timeout_seconds=settings.ark_timeout_seconds,
            temperature=0.2,
            max_tokens=4096,
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

    if not isinstance(parsed, list):
        raise VisionError(f"vision response is not a JSON array (got {type(parsed).__name__})")
    if len(parsed) != photo_count:
        raise VisionError(
            f"vision response length {len(parsed)} != photo count {photo_count}"
        )

    analyses = [
        _coerce_one(item, photo_id=photo_ids[i], fallback_orient=fallback_orients[i])
        for i, item in enumerate(parsed)
    ]
    analyses = _enforce_hero_cap(analyses)

    log.info(
        "vision.call.ok",
        photo_count=photo_count,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )
    return analyses, prompt_tokens + completion_tokens
