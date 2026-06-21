"""Real vision stage: Volcano Ark `doubao-seed-1-6-vision` in a single
multi-image call. V3 design §2 uses visible scene/time signals for grouping;
the V3 authoring tree has no location/place dimension.

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
    call_count: int = 1


def _build_v3_system_prompt(language: str) -> str:
    lang_name = "Chinese" if language == "zh" else "English"
    return load_skill("describe_content", LANGUAGE=lang_name)


def _build_v3_user_content(
    photos: list[V3AnalyzePhoto], prompt_hint: str | None
) -> list[dict[str, Any]]:
    """Build the multi-image user turn. The manifest carries each photoId + its
    code-computed `takenAt` as the分章 time signal (§4.1(c)), plus — when the
    browser pre-grouped photos (#232) — an opaque `cluster` label per photo so the
    model honors cluster boundaries. NO GPS/place is ever placed in the manifest
    (§3 privacy); `cluster` is a bare same-place/same-time tag, not a coordinate.

    NOTE: cluster labels are expressed in the SIMPLE-id space (1,2,3…) the model
    sees — `photos` here are already remapped by `_describe_call`, and their
    `clusterId` rides through `model_copy`. They are RE-LABELED to c1/c2/… in the
    order clusters first appear in THIS call's manifest so the model never sees a
    global cluster index that doesn't match its local batch."""
    # Re-label this call's clusters to dense local c1/c2/… (order of first
    # appearance). Photos without a clusterId get no tag → model groups them freely.
    local_label: dict[str, str] = {}
    for photo in photos:
        cid = photo.clusterId
        if cid is not None and cid not in local_label:
            local_label[cid] = f"c{len(local_label) + 1}"
    has_clusters = bool(local_label)

    manifest_lines = []
    for idx, photo in enumerate(photos):
        taken = (photo.exif.takenAt if photo.exif else None) or "unknown"
        line = f"{idx + 1}. photoId={photo.photoId} takenAt={taken}"
        if photo.clusterId is not None:
            line += f" cluster={local_label[photo.clusterId]}"
        manifest_lines.append(line)
    manifest = "\n".join(manifest_lines)
    hint_block = (
        f"User memoir prompt (context only, do not re-emit verbatim):\n{prompt_hint}\n\n"
        if prompt_hint
        else ""
    )
    cluster_block = ""
    if has_clusters:
        cluster_block = (
            "\n\nThese photos are PRE-GROUPED into clusters (the `cluster` tag in "
            "the manifest marks which cluster each photo belongs to). Rules:\n"
            "  - Photos of the SAME cluster MUST stay together and go into "
            "chapter(s) that contain NO photo from any other cluster.\n"
            "  - Photos of DIFFERENT clusters must NEVER be merged into one "
            "chapter.\n"
            "  - A cluster MAY be split into several adjacent sub-chapters if it "
            "is large and spans distinct scenes — but each such chapter still "
            "holds only that one cluster's photos.\n"
            "  - Emit clusters in the manifest order (c1, then c2, …)."
        )
    parts: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"{hint_block}"
                f"Photos follow in order (count={len(photos)}). Use these exact "
                "photoId values; takenAt is the capture-time signal for chapter "
                "boundaries:\n"
                f"{manifest}"
                f"{cluster_block}\n\n"
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

    Validation guards (§4.1 一图一章不跨章 + LLM 只写 3 处):
      * Every input photo must land in exactly ONE chapter; duplicate, unknown,
        or omitted photoIds make the model output invalid.
      * Chapter `description` and photo `sceneDescription` must be present; code
        never authors fallback prose for those LLM-owned fields.
      * width/height/orientation/takenAt come ONLY from the request — the model's
        copies (if any) are ignored.
      * accentColor/artFont stay null placeholders (theme stage fills them, §4.1).
    """
    by_id = {p.photoId: p for p in photos}
    raw_chapters = parsed.get("chapters") if isinstance(parsed, dict) else None
    if not isinstance(raw_chapters, list):
        raise VisionError("describe-content response missing chapters[] array")

    def _required_text(raw: Any, *, field: str, max_len: int) -> str:
        if not isinstance(raw, str):
            raise VisionError(f"describe-content {field} must be a string")
        text = raw.strip()
        if not text:
            raise VisionError(f"describe-content {field} is required")
        if len(text) > max_len:
            raise VisionError(f"describe-content {field} exceeds {max_len} chars")
        return text

    def _photo_node(photo_id: str, scene_raw: Any) -> V3ChapterPhoto:
        src = by_id[photo_id]
        scene = _required_text(
            scene_raw, field=f"scenes.{photo_id}", max_len=300
        )
        return V3ChapterPhoto(
            photoId=photo_id,
            sceneDescription=scene,
            width=src.width,
            height=src.height,
            orientation=_orientation(src.width, src.height),  # type: ignore[arg-type]
            takenAt=src.exif.takenAt if src.exif else None,
        )

    chapters: list[V3Chapter] = []
    claimed: set[str] = set()
    for ch_idx, raw in enumerate(raw_chapters):
        if not isinstance(raw, dict):
            raise VisionError(f"describe-content chapter {ch_idx + 1} must be an object")
        scenes = raw.get("scenes")
        if not isinstance(scenes, dict):
            raise VisionError(f"describe-content chapter {ch_idx + 1} missing scenes object")
        raw_ids = raw.get("photoIds")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise VisionError(f"describe-content chapter {ch_idx + 1} missing photoIds[]")
        description = _required_text(
            raw.get("description"),
            field=f"chapters[{ch_idx}].description",
            max_len=600,
        )
        chapter_photos: list[V3ChapterPhoto] = []
        for raw_pid in raw_ids:
            if not isinstance(raw_pid, str) or not raw_pid.strip():
                raise VisionError(f"describe-content chapter {ch_idx + 1} has invalid photoId")
            pid = raw_pid.strip()
            if pid not in by_id:
                raise VisionError(f"describe-content referenced unknown photoId: {pid}")
            if pid in claimed:
                raise VisionError(f"describe-content duplicated photoId: {pid}")
            claimed.add(pid)
            chapter_photos.append(_photo_node(pid, scenes.get(pid)))
        chapters.append(
            V3Chapter(
                chapterId=f"ch_{len(chapters) + 1}",
                description=description,
                accentColor=None,  # theme stage fills (§4.1)
                artFont=None,
                photos=chapter_photos,
            )
        )

    missed = [p.photoId for p in photos if p.photoId not in claimed]
    if missed:
        raise VisionError(f"describe-content omitted photoIds: {', '.join(missed)}")

    if not chapters:
        raise VisionError("describe-content produced no usable chapters")
    return V3LayoutTree(chapters=chapters)


def _remap_describe_photo_ids(parsed: Any, real_by_simple: dict[str, str]) -> Any:
    """识图模型用简单序号 id(1,2,3…)作答 → 映射回真实 photoId(serial→hash)。
    映射 chapters[].photoIds 列表 + chapters[].scenes 的 key。模型偶发幻觉的未知序号
    原样留下(不在映射表里),由 _assemble_v3_tree 的 unknown/omitted 校验拦截。"""
    if not isinstance(parsed, dict):
        return parsed
    chapters = parsed.get("chapters")
    if not isinstance(chapters, list):
        return parsed
    for ch in chapters:
        if not isinstance(ch, dict):
            continue
        ids = ch.get("photoIds")
        if isinstance(ids, list):
            ch["photoIds"] = [
                real_by_simple.get(i.strip(), i.strip()) if isinstance(i, str) else i
                for i in ids
            ]
        scenes = ch.get("scenes")
        if isinstance(scenes, dict):
            ch["scenes"] = {
                (real_by_simple.get(k.strip(), k.strip()) if isinstance(k, str) else k): v
                for k, v in scenes.items()
            }
    return parsed


# =============================================================================
# WP-C (#232): cluster-aware describe — partition by clusterId, schedule whole
# clusters into concurrent routes by COUNT, merge local trees in global order.
# =============================================================================


def _partition_into_clusters(
    photos: list[V3AnalyzePhoto],
) -> list[list[V3AnalyzePhoto]]:
    """Group photos by `clusterId` (the browser's same-place/same-time label,
    #232). Returns a list of clusters; each cluster keeps its photos in input
    order. Clusters are SEQUENCED by their earliest `takenAt` (time order); ties
    and missing takenAt fall back to the cluster's first-appearance order. Cluster
    = chapter floor: a cluster is never split across routes.

    Photos whose `clusterId` is None are NOT merged together — each null photo is
    its own singleton "cluster" so the model is free to group it. When EVERY photo
    is null this yields one singleton per photo, which the count-based scheduler
    still collapses into the single legacy route (≤20) or balanced routes."""
    order: list[str] = []  # cluster keys in first-appearance order
    members: dict[str, list[V3AnalyzePhoto]] = {}
    null_seq = 0
    for photo in photos:
        if photo.clusterId is None:
            null_seq += 1
            key = f"\x00null:{null_seq}"  # unique sentinel → singleton cluster
        else:
            key = photo.clusterId
        if key not in members:
            members[key] = []
            order.append(key)
        members[key].append(photo)

    appear_idx = {key: i for i, key in enumerate(order)}

    def _earliest(key: str) -> tuple[int, str, int]:
        # Sort key: (has_taken_at?, earliest takenAt iso, first-appearance index).
        # Photos with takenAt sort before those without; ISO strings sort
        # chronologically; first-appearance index is the stable tiebreaker.
        takens = [
            p.exif.takenAt
            for p in members[key]
            if p.exif and p.exif.takenAt
        ]
        if takens:
            return (0, min(takens), appear_idx[key])
        return (1, "", appear_idx[key])

    return [members[k] for k in sorted(order, key=_earliest)]


def _plan_describe_routes(
    clusters: list[list[V3AnalyzePhoto]], route_count: int
) -> list[list[V3AnalyzePhoto]]:
    """Bin-pack whole clusters into `route_count` routes balanced by photo count
    (greedy largest-cluster-first into the currently-lightest route). A cluster is
    NEVER split across routes (簇不跨路). Cluster global order is recoverable at
    merge time from each photo's position, so packing order here is irrelevant to
    the final chapter sequence. Empty routes are dropped."""
    if route_count <= 1:
        flat = [p for cluster in clusters for p in cluster]
        return [flat] if flat else []

    # Largest clusters first so a single oversized cluster lands alone-ish and
    # small clusters fill the gaps → balanced张数 (bin-pack first-fit-decreasing).
    ordered = sorted(clusters, key=len, reverse=True)
    routes: list[list[V3AnalyzePhoto]] = [[] for _ in range(route_count)]
    loads = [0] * route_count
    for cluster in ordered:
        target = min(range(route_count), key=lambda i: loads[i])
        routes[target].extend(cluster)
        loads[target] += len(cluster)
    return [r for r in routes if r]


def _route_count_for(total: int, settings: Any) -> int:
    """Count-driven concurrency WIDTH (#232): ≤lo → 1, >lo → 2, >hi → 3 (capped
    by describe_max_concurrency). Thresholds never re-cut semantic clusters."""
    lo = settings.describe_concurrency_threshold_lo
    hi = settings.describe_concurrency_threshold_hi
    if total <= lo:
        return 1
    width = 3 if total > hi else 2
    return min(width, max(1, settings.describe_max_concurrency))


def _merge_route_trees(
    sequenced_photos: list[V3AnalyzePhoto], route_trees: list[V3LayoutTree]
) -> V3LayoutTree:
    """Concatenate per-route local chapter trees into one global tree (#232).

    `sequenced_photos` is the photo list already flattened in GLOBAL CLUSTER ORDER
    (clusters sorted by earliest takenAt — see `_partition_into_clusters`), NOT raw
    request order. Routes carry disjoint sets of whole clusters, so ordering each
    route's chapters by the sequenced index of their first photo lands chapters in
    cluster (time) order across routes; a cluster sub-chaptered within one route
    stays contiguous because it occupies a contiguous range of the sequenced order.
    Chapters are then renumbered ch_1..N; photo order within a chapter is preserved
    as authored. The union MUST cover every photo exactly once (each route already
    passed `_assemble_v3_tree`'s one-photo-one-chapter guard on its slice; here we
    re-assert global coverage so a scheduling/merge bug can't silently drop or
    duplicate a photo). We ALSO enforce the cluster boundary deterministically: a
    single chapter may not mix photos from two different (non-null) clusters — the
    prompt requests this, and a misbehaving model that merges clusters is rejected
    here so 异簇不并章 holds even if the model ignores the instruction."""
    global_pos = {p.photoId: i for i, p in enumerate(sequenced_photos)}
    cluster_of = {p.photoId: p.clusterId for p in sequenced_photos}

    ordered_chapters: list[V3Chapter] = []
    for tree in route_trees:
        for ch in tree.chapters:
            ordered_chapters.append(ch)
    # Stable sort by the sequenced (cluster/time) index of each chapter's first
    # photo → chapters land in global cluster order across routes.
    ordered_chapters.sort(
        key=lambda ch: global_pos.get(ch.photos[0].photoId, len(global_pos))
        if ch.photos
        else len(global_pos)
    )

    seen: set[str] = set()
    renumbered: list[V3Chapter] = []
    for ch in ordered_chapters:
        chapter_clusters: set[str] = set()
        for ph in ch.photos:
            if ph.photoId in seen:
                raise VisionError(
                    f"describe-content merge duplicated photoId: {ph.photoId}"
                )
            seen.add(ph.photoId)
            cid = cluster_of.get(ph.photoId)
            if cid is not None:  # null-cluster photos carry no boundary constraint
                chapter_clusters.add(cid)
        if len(chapter_clusters) > 1:
            raise VisionError(
                "describe-content merge mixed distinct clusters in one chapter: "
                + ", ".join(sorted(chapter_clusters))
            )
        renumbered.append(
            V3Chapter(
                chapterId=f"ch_{len(renumbered) + 1}",
                description=ch.description,
                accentColor=ch.accentColor,
                artFont=ch.artFont,
                photos=ch.photos,
            )
        )

    missed = [p.photoId for p in sequenced_photos if p.photoId not in seen]
    if missed:
        raise VisionError(
            f"describe-content merge omitted photoIds: {', '.join(missed)}"
        )
    if not renumbered:
        raise VisionError("describe-content merge produced no chapters")
    return V3LayoutTree(chapters=renumbered)


# 小模型(豆包)非确定性偷懒:照片一多就漏几张/重复/错认序号。这类是可恢复失误,
# 带「必须覆盖全部 N 张」纠正提示 + 升温在同一 slot 内重抽,通常能修;结构性错误
# (缺 chapters[] 等)重试无益,直接上抛。注:浏览器侧 geo+date 预分组上线后单批变小,
# 此重试退化为纯兜底保险。
MAX_DESCRIBE_ATTEMPTS = 3


def _is_recoverable_describe_error(exc: VisionError) -> bool:
    """模型漏/重/错认 photoId 是非确定性失误,值得带纠正提示重抽。"""
    msg = str(exc)
    return (
        "omitted photoIds" in msg
        or "duplicated photoId" in msg
        or "referenced unknown photoId" in msg
    )


async def _describe_call(
    slot: VisionSlot, photos: list[V3AnalyzePhoto], language: str, prompt_hint: str | None
) -> tuple[V3LayoutTree, int]:
    """One recognition-model call on `slot`. Returns (tree, tokens_billed). Raises
    ai_client.AIRequestError on upstream failure (caller decides failover) and
    VisionError on an unusable response.

    模型漏/重/错认 photoId 时,在同一 slot 内带纠正提示重抽,最多 MAX_DESCRIBE_ATTEMPTS
    次(累计计费 tokens);用尽仍不完整才抛 VisionError。"""
    # 给识图模型只喂简单序号 id(1,2,3…),它抄不错;拿回结果再映射回真实 photoId。
    # 真实 photoId 是长 hash,小模型(豆包)常抄岔/截断 → 「unknown photoId」失败。
    simple_photos = [
        p.model_copy(update={"photoId": str(i + 1)}) for i, p in enumerate(photos)
    ]
    real_by_simple = {str(i + 1): p.photoId for i, p in enumerate(photos)}
    n = len(simple_photos)
    system_prompt = _build_v3_system_prompt(language)
    user_content = _build_v3_user_content(simple_photos, prompt_hint)

    total_tokens = 0
    last_err: VisionError | None = None
    for attempt in range(MAX_DESCRIBE_ATTEMPTS):
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        if attempt > 0 and last_err is not None:
            # 上一次漏/重/错认照片 → 明确要求覆盖全部 N 张再重抽(升温打破确定性偷懒)。
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"上一次输出有问题:{last_err}。必须把全部 {n} 张照片"
                        f"(序号 1 到 {n})每一张都恰好放进一个章节——一张都不能漏、"
                        f"不能重复、不能用不存在的序号。请重新输出完整 JSON。"
                    ),
                }
            )
        response = await ai_client.chat_completion(
            base_url=slot.base_url,
            api_key=slot.api_key,
            model=slot.model,
            messages=messages,
            timeout_seconds=slot.timeout_seconds,
            temperature=0.2 if attempt == 0 else 0.5,
            max_tokens=8192,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
        )
        # Drop the local handle to user content (base64s) before parsing (§3 privacy).
        messages = []  # noqa: F841
        del messages

        prompt_tokens, completion_tokens = ai_client.extract_usage(response)
        total_tokens += prompt_tokens + completion_tokens

        try:
            raw_text = ai_client.extract_text(response)
            parsed = ai_client.parse_json_loose(raw_text)
        except ValueError as exc:
            # 解析失败保持原行为(同类畸形输出不靠重试,直接抛)。
            raise VisionError(f"describe-content response unparseable: {exc}") from exc

        parsed = _remap_describe_photo_ids(parsed, real_by_simple)
        try:
            tree = _assemble_v3_tree(parsed, photos)
        except VisionError as exc:
            if (
                not _is_recoverable_describe_error(exc)
                or attempt == MAX_DESCRIBE_ATTEMPTS - 1
            ):
                raise
            last_err = exc
            log.warning(
                "v3_describe.retry",
                provider=slot.provider,
                attempt=attempt + 1,
                reason=str(exc)[:120],
            )
            continue
        return tree, total_tokens

    # 末次可恢复错误已在循环里 raise;此处仅防御性兜底。
    raise last_err or VisionError("describe-content failed after retries")


async def _describe_on_slot(
    slot: VisionSlot,
    photos: list[V3AnalyzePhoto],
    language: str,
    prompt_hint: str | None,
    *,
    settings: Any,
) -> tuple[V3LayoutTree, int, int]:
    """Cluster-aware describe on ONE provider slot (#232). Returns
    (merged_tree, tokens_billed, route_count).

    - Partition photos by clusterId, schedule whole clusters into N count-driven
      concurrent routes (N=1 degrades to the legacy single call).
    - Run each route's `_describe_call` concurrently via asyncio.gather; each route
      keeps its own omitted-photo retry safety net over its own slice.
    - Merge the per-route local trees in global cluster order, renumber ch_1..N.

    Raises ai_client.AIRequestError if ANY route hits an upstream transport
    failure (caller decides failover); VisionError on an unusable/merge-invalid
    response. gather(return_exceptions=False) means the first transport error
    propagates and the slow-but-healthy paths are cancelled — failover then runs
    ONCE on the other slot for the whole batch, never per-route, so concurrency
    never multiplies the failover fan-out."""
    clusters = _partition_into_clusters(photos)
    route_count = _route_count_for(len(photos), settings)
    routes = _plan_describe_routes(clusters, route_count)

    if len(routes) <= 1:
        # Legacy single-batch path (also the all-null backward-compatible case).
        tree, tokens = await _describe_call(slot, photos, language, prompt_hint)
        return tree, tokens, 1

    log.info(
        "v3_describe.routes.plan",
        provider=slot.provider,
        routes=len(routes),
        sizes=[len(r) for r in routes],
    )
    results = await asyncio.gather(
        *(
            _describe_call(slot, route_photos, language, prompt_hint)
            for route_photos in routes
        )
    )
    route_trees = [tree for tree, _ in results]
    total_tokens = sum(tokens for _, tokens in results)
    # Merge in GLOBAL CLUSTER ORDER: flatten the takenAt-sequenced partition so the
    # merge orders cross-route chapters by cluster/time, not by raw request order.
    sequenced = [p for cluster in clusters for p in cluster]
    merged = _merge_route_trees(sequenced, route_trees)
    return merged, total_tokens, len(routes)


async def describe_content(
    photos: list[V3AnalyzePhoto],
    *,
    language: str,
    prompt_hint: str | None = None,
) -> V3DescribeResult:
    """V3 analyze step (b): one recognition-model call → 章节树 (§4.1).

    Failover: try OpenAI (GPT-5.5 Mini) first within the tighter describe budget;
    on AIRequestError (5xx/timeout after ai_client's retry), or when the whole
    batch exceeds `describe_batch_deadline_seconds`,降级火山 doubao (ARK).
    OpenAI 4xx/missing-key failures are configuration/request errors and do not
    fail over. The whole call is additionally bounded by
    `describe_batch_deadline_seconds` so a slow-but-not-erroring primary still
    triggers failover instead of hanging the analyze job.

    Raises VisionError if BOTH providers fail or neither is configured — the route
    maps it to AGENT_VISION_FAILED."""
    settings = get_settings()
    photo_count = len(photos)
    if photo_count == 0:
        raise VisionError("describe-content called with no photos")

    deadline = settings.describe_batch_deadline_seconds

    try:
        # 本地/豆包模式:vision_provider="ark" 时识图直接用火山 doubao 主力(带 thinking
        # 配置,避免 JSON 截断),不走打不通的 OpenAI。生产用 OpenAI 时设 vision_provider="openai"。
        if settings.vision_provider == "ark":
            primary_slot = ark_vision_slot(settings)
        else:
            primary_slot = openai_vision_slot(
                settings,
                timeout_seconds=settings.describe_openai_timeout_seconds,
                model=settings.describe_openai_model,
            )
    except VisionSlotError as exc:
        log.warning("v3_describe.primary_unconfigured", error=str(exc))
        raise VisionError(f"describe-content primary unavailable: {exc}") from exc

    log.info(
        "v3_describe.call.start",
        provider=primary_slot.provider,
        model=primary_slot.model,
        photo_count=photo_count,
    )
    try:
        # The deadline wraps the WHOLE concurrent route set (asyncio.gather inside
        # _describe_on_slot). One slow route therefore trips failover ONCE for the
        # entire batch — never per-route — so concurrency never multiplies the
        # failover fan-out. Wall-clock ≈ the slowest route, not their sum (#232).
        tree, tokens, routes = await asyncio.wait_for(
            _describe_on_slot(
                primary_slot, photos, language, prompt_hint, settings=settings
            ),
            timeout=deadline,
        )
        log.info(
            "v3_describe.call.ok",
            provider=primary_slot.provider,
            model=primary_slot.model,
            chapters=len(tree.chapters),
            routes=routes,
        )
        return V3DescribeResult(
            tree=tree,
            tokens_billed=tokens,
            model=primary_slot.model,
            provider=primary_slot.provider,
            call_count=routes,
        )
    except asyncio.TimeoutError as exc:
        # Batch deadline overrun → 降级火山.
        log.warning(
            "v3_describe.primary_failover",
            provider=primary_slot.provider,
            reason=type(exc).__name__,
        )
    except ai_client.AIRequestError as exc:
        if not exc.failover_eligible:
            raise VisionError(f"describe-content primary failed: {exc}") from exc
        log.warning(
            "v3_describe.primary_failover",
            provider=primary_slot.provider,
            reason=exc.kind or type(exc).__name__,
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
        tree, tokens, routes = await _describe_on_slot(
            fallback_slot, photos, language, prompt_hint, settings=settings
        )
    except ai_client.AIRequestError as exc:
        raise VisionError(f"describe-content火山 failover failed: {exc}") from exc

    log.info(
        "v3_describe.failover.ok",
        provider=fallback_slot.provider,
        model=fallback_slot.model,
        chapters=len(tree.chapters),
        routes=routes,
    )
    # call_count = primary attempt (1) + the failover slot's真实路数 so Usage
    # reflects that failover happened AND how many concurrent calls produced it.
    return V3DescribeResult(
        tree=tree,
        tokens_billed=tokens,
        model=fallback_slot.model,
        provider=fallback_slot.provider,
        call_count=1 + routes,
    )
