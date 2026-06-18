"""Real vision stage: Volcano Ark `doubao-seed-1-6-vision` in a single
multi-image call. Output schema mirrors docs/agent/design.md §2.6 with the 5
extension fields (peopleCount / scene / mood / timeOfDay / location).

Privacy: photo base64 is passed into the upstream HTTP body and then the
local reference is dropped; we never log it or hand it back to the caller."""

import asyncio
from dataclasses import dataclass
from math import ceil
import re
from typing import Any

from pydantic import ValidationError

from ..logging_config import get_logger
from ..schemas import (
    Focal,
    LayoutRequest,
    PhotoAnalysis,
    PhotoGroup,
    V3AnalyzePhoto,
    V3Chapter,
    V3ChapterPhoto,
    V3LayoutTree,
    VisionResult,
)
from ..settings import get_settings
from ..skills import load_skill
from . import ai_client
from .vision_provider import (
    VisionSlot,
    VisionSlotError,
    ark_vision_slot,
    estimate_cost_usd,
    openai_vision_slot,
    select_vision_slot,
)

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
        '  "location": a short free-text guess (e.g. "Kyoto street", "kitchen") or null.\n'
        '  "focal": the MAIN SUBJECT\'s center in the ORIGINAL photo as '
        '{"x":0..1,"y":0..1} normalized fractions (x = left→right, y = top→bottom). '
        "Prefer a face when people are present; otherwise the visual subject. Use "
        "null when there is no clear subject (then the album centers the photo).\n\n"
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


def _coerce_focal(raw: Any) -> Focal | None:
    """Parse the model's focal hint into a clamped Focal, or None when absent /
    malformed (caller then falls back to the centered 0.5/0.5 default). Accepts an
    {x,y} object; out-of-range numbers are clamped into [0, 1]."""
    if not isinstance(raw, dict):
        return None
    try:
        x = float(raw.get("x"))  # type: ignore[arg-type]
        y = float(raw.get("y"))
    except (TypeError, ValueError):
        return None
    x = max(0.0, min(1.0, x))
    y = max(0.0, min(1.0, y))
    return Focal(x=x, y=y)


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

    focal = _coerce_focal(item.get("focal"))

    try:
        return PhotoAnalysis(
            photoId=photo_id,
            description=description[:240],
            tags=tags,
            quality=quality,  # type: ignore[arg-type]
            orientation=orientation,  # type: ignore[arg-type]
            focal=focal,
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


# =============================================================================
# V3 describe-content (issue #182): one recognition-model call → 章节树.
#
# The model authors ONLY 3 things (v3-requirements §4.1):
#   ① partition photos into chapters (分章)  ② each chapter `description`
#   ③ each photo `sceneDescription`
# Everything else (width/height/orientation/takenAt) is code-filled (WP1.2) and
# never round-trips through the LLM — see `_assemble_v3_tree`.
#
# Provider failover (architecture §6.8 第 2 条 / v3-impl-plan §6.2): PRIMARY =
# OpenAI (GPT-5.5 Mini, `OPENAI_*`); FAILOVER = 火山 doubao (`ARK_*`). We降级火山
# when the OpenAI slot still 5xx/times-out after ai_client's one retry within the
# tighter `describe_openai_timeout_seconds` budget, OR the whole batch overruns
# `describe_batch_deadline_seconds`. The降级语义 (先 GPT、自动降级火山) is fixed;
# the numbers are tunable.
# =============================================================================


@dataclass(frozen=True)
class V3DescribeResult:
    """describe-content output for one analyze batch. `tree` carries ONLY the 3
    LLM-authored fields + the code-filled deterministic photo attrs; `model` is the
    slot actually hit (so Usage.models.vision reflects真实 provider, not hardwired)."""

    tree: V3LayoutTree
    tokens_billed: int
    model: str
    provider: str


def _build_v3_system_prompt(language: str) -> str:
    lang_name = "Chinese" if language == "zh" else "English"
    return load_skill("describe_content", LANGUAGE=lang_name)


def _build_v3_user_content(
    photos: list[V3AnalyzePhoto], prompt_hint: str | None
) -> list[dict[str, Any]]:
    """Build the multi-image user turn. The manifest carries each photoId + its
    code-computed `takenAt` as the分章 time signal (§4.1(c)). NO GPS/place is ever
    placed in the manifest (§3 privacy)."""
    manifest_lines = []
    for idx, photo in enumerate(photos):
        taken = (photo.exif.takenAt if photo.exif else None) or "unknown"
        manifest_lines.append(
            f"{idx + 1}. photoId={photo.photoId} takenAt={taken}"
        )
    manifest = "\n".join(manifest_lines)
    hint_block = (
        f"User memoir prompt (context only, do not re-emit verbatim):\n{prompt_hint}\n\n"
        if prompt_hint
        else ""
    )
    parts: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"{hint_block}"
                f"Photos follow in order (count={len(photos)}). Use these exact "
                "photoId values; takenAt is the capture-time signal for chapter "
                "boundaries:\n"
                f"{manifest}\n\n"
                'Return {"chapters":[...]} per the system instructions.'
            ),
        }
    ]
    for photo in photos:
        parts.append({"type": "image_url", "image_url": {"url": photo.base64}})
    return parts


def _orientation(width: int, height: int) -> str:
    return _photo_orientation(width, height)


def _assemble_v3_tree(
    parsed: Any, photos: list[V3AnalyzePhoto]
) -> V3LayoutTree:
    """Fuse the model's chapter partition (LLM-authored) with the code-filled
    deterministic photo attrs into a validated V3LayoutTree.

    Determinism guards (§4.1 一图一章不跨章 + LLM 只写 3 处):
      * Every input photo lands in exactly ONE chapter; the FIRST chapter that
        claims a photoId wins, later duplicates are dropped.
      * Any photo the model forgot is swept into a trailing chapter so no input is
        lost (the engine never silently drops a user photo).
      * width/height/orientation/takenAt come ONLY from the request — the model's
        copies (if any) are ignored.
      * accentColor/artFont stay null placeholders (theme stage fills them, §4.1).
    """
    by_id = {p.photoId: p for p in photos}
    raw_chapters = parsed.get("chapters") if isinstance(parsed, dict) else None
    if not isinstance(raw_chapters, list):
        raise VisionError("describe-content response missing chapters[] array")

    def _photo_node(photo_id: str, scene_raw: Any) -> V3ChapterPhoto:
        src = by_id[photo_id]
        scene = str(scene_raw or "").strip() or "A moment from your story."
        return V3ChapterPhoto(
            photoId=photo_id,
            sceneDescription=scene[:300],
            width=src.width,
            height=src.height,
            orientation=_orientation(src.width, src.height),  # type: ignore[arg-type]
            takenAt=src.exif.takenAt if src.exif else None,
        )

    chapters: list[V3Chapter] = []
    claimed: set[str] = set()
    for ch_idx, raw in enumerate(raw_chapters):
        if not isinstance(raw, dict):
            continue
        scenes = raw.get("scenes") if isinstance(raw.get("scenes"), dict) else {}
        raw_ids = raw.get("photoIds") if isinstance(raw.get("photoIds"), list) else []
        chapter_photos: list[V3ChapterPhoto] = []
        for raw_pid in raw_ids:
            pid = str(raw_pid)
            if pid in by_id and pid not in claimed:
                claimed.add(pid)
                chapter_photos.append(_photo_node(pid, scenes.get(pid)))
        if not chapter_photos:
            continue
        description = str(raw.get("description") or "").strip() or "A chapter of your story."
        chapters.append(
            V3Chapter(
                chapterId=f"ch_{len(chapters) + 1}",
                description=description[:600],
                accentColor=None,  # theme stage fills (§4.1)
                artFont=None,
                photos=chapter_photos,
            )
        )

    # Sweep any photo the model omitted into a trailing chapter (in input order).
    missed = [p for p in photos if p.photoId not in claimed]
    if missed:
        log.info("v3_describe.swept_unassigned", count=len(missed))
        chapters.append(
            V3Chapter(
                chapterId=f"ch_{len(chapters) + 1}",
                description="A chapter of your story.",
                accentColor=None,
                artFont=None,
                photos=[_photo_node(p.photoId, None) for p in missed],
            )
        )

    if not chapters:
        raise VisionError("describe-content produced no usable chapters")
    return V3LayoutTree(chapters=chapters)


async def _describe_call(
    slot: VisionSlot, photos: list[V3AnalyzePhoto], language: str, prompt_hint: str | None
) -> tuple[V3LayoutTree, int]:
    """One recognition-model call on `slot`. Returns (tree, tokens_billed). Raises
    ai_client.AIRequestError on upstream failure (caller decides failover) and
    VisionError on an unusable response."""
    messages = [
        {"role": "system", "content": _build_v3_system_prompt(language)},
        {"role": "user", "content": _build_v3_user_content(photos, prompt_hint)},
    ]
    response = await ai_client.chat_completion(
        base_url=slot.base_url,
        api_key=slot.api_key,
        model=slot.model,
        messages=messages,
        timeout_seconds=slot.timeout_seconds,
        temperature=0.2,
        max_tokens=8192,
        response_format=slot.response_format,
        extra_body=slot.extra_body,
    )
    # Drop the local handle to user content (base64s) before parsing (§3 privacy).
    messages = []  # noqa: F841
    del messages

    try:
        raw_text = ai_client.extract_text(response)
        parsed = ai_client.parse_json_loose(raw_text)
    except ValueError as exc:
        raise VisionError(f"describe-content response unparseable: {exc}") from exc

    prompt_tokens, completion_tokens = ai_client.extract_usage(response)
    tree = _assemble_v3_tree(parsed, photos)
    return tree, prompt_tokens + completion_tokens


async def describe_content(
    photos: list[V3AnalyzePhoto],
    *,
    language: str,
    prompt_hint: str | None = None,
) -> V3DescribeResult:
    """V3 analyze step (b): one recognition-model call → 章节树 (§4.1).

    Failover: try OpenAI (GPT-5.5 Mini) first within the tighter describe budget;
    on AIRequestError (5xx/timeout after ai_client's retry) OR a missing OpenAI
    key,降级火山 doubao (ARK). The whole call is additionally bounded by
    `describe_batch_deadline_seconds` so a slow-but-not-erroring primary still
    triggers failover instead of hanging the analyze job.

    Raises VisionError if BOTH providers fail or neither is configured — the route
    maps it to AGENT_VISION_FAILED."""
    settings = get_settings()
    photo_count = len(photos)
    if photo_count == 0:
        raise VisionError("describe-content called with no photos")

    deadline = settings.describe_batch_deadline_seconds

    # --- PRIMARY: OpenAI (GPT-5.5 Mini) --------------------------------------
    primary_slot: VisionSlot | None = None
    try:
        primary_slot = openai_vision_slot(
            settings, timeout_seconds=settings.describe_openai_timeout_seconds
        )
    except VisionSlotError as exc:
        log.warning("v3_describe.primary_unconfigured", error=str(exc))

    if primary_slot is not None:
        log.info(
            "v3_describe.call.start",
            provider=primary_slot.provider,
            model=primary_slot.model,
            photo_count=photo_count,
        )
        try:
            tree, tokens = await asyncio.wait_for(
                _describe_call(primary_slot, photos, language, prompt_hint),
                timeout=deadline,
            )
            log.info(
                "v3_describe.call.ok",
                provider=primary_slot.provider,
                model=primary_slot.model,
                chapters=len(tree.chapters),
            )
            return V3DescribeResult(
                tree=tree,
                tokens_billed=tokens,
                model=primary_slot.model,
                provider=primary_slot.provider,
            )
        except (ai_client.AIRequestError, asyncio.TimeoutError) as exc:
            # 5xx/timeout after retry, or batch overran the deadline → 降级火山.
            log.warning(
                "v3_describe.primary_failover",
                provider=primary_slot.provider,
                reason=type(exc).__name__,
            )
        # A VisionError (unparseable / unusable response) is NOT a transport
        # failure; it propagates rather than wasting a second provider on the same
        # malformed-output class of bug.

    # --- FAILOVER: 火山 doubao (ARK) -----------------------------------------
    try:
        fallback_slot = ark_vision_slot(settings)
    except VisionSlotError as exc:
        raise VisionError(
            f"describe-content failover unavailable (火山 slot): {exc}"
        ) from exc

    log.info(
        "v3_describe.failover.start",
        provider=fallback_slot.provider,
        model=fallback_slot.model,
        photo_count=photo_count,
    )
    # The failover call is bounded by the ark slot's own per-call timeout
    # (ark_timeout_seconds + ai_client's one retry); the whole analyze job is in
    # turn capped by background_task_timeout_seconds. We deliberately do NOT also
    # wrap it in the primary's tighter `describe_batch_deadline_seconds` budget —
    # that deadline exists to flip a slow-but-healthy GPT over to 火山, not to
    # prematurely cut 火山 (whose own per-call ceiling is the larger ark budget).
    try:
        tree, tokens = await _describe_call(
            fallback_slot, photos, language, prompt_hint
        )
    except ai_client.AIRequestError as exc:
        raise VisionError(f"describe-content火山 failover failed: {exc}") from exc

    log.info(
        "v3_describe.failover.ok",
        provider=fallback_slot.provider,
        model=fallback_slot.model,
        chapters=len(tree.chapters),
    )
    return V3DescribeResult(
        tree=tree,
        tokens_billed=tokens,
        model=fallback_slot.model,
        provider=fallback_slot.provider,
    )
