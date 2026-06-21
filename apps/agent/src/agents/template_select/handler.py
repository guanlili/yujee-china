"""V3 select-template: the recognition model picks each page's templateId from
the LEGAL candidate set; pure-code fallback when the LLM call fails (WP1.4 / #183).

This sits on top of the WP0.4 deterministic engine (`skeleton_v3`) and follows the
§8.3 safety model — "model emits intent, deterministic engine guarantees legality":

  * The chapter tree (WP1.3) is partitioned into per-page chunks no larger than the
    interior category's biggest template (`skeleton_v3.partition_photos_v3`). Each
    chunk becomes exactly one interior page.
  * For each page we compute its LEGAL candidate set with
    `skeleton_v3.legal_candidates("interior", N)` — every template in the interior
    category whose image-slot count can hold the page's N photos. The model is shown
    ONLY those candidate ids (plus the chapter/scene context) and must return a
    templateId drawn from that exact list. A choice outside the legal set (a
    hallucinated / wrong-page id) is rejected and that page falls back — the model
    can never inject an illegal templateId (§9 / §6.8 第 6 条).
  * NO quality / hero / orientation matching anywhere. Photos are slotted in
    declaration order (`skeleton_v3.assign_images_v3`); aspect-ratio mismatch is the
    renderer's center-cover concern, never an error here.

Fallback (§9): when the LLM call fails (transport/timeout/unparseable/unusable) the
WHOLE preview reverts to the pure-code path — `skeleton_v3.build_skeleton_v3`, which
picks, per chunk, a template that can hold the N photos (exact capacity preferred,
else closest larger) and slots them in order. "10 photos → a template that holds 10,
slotted in order." No quality/hero matching, mismatched aspect ratios unrejected.

Stateless / privacy (§3): this stage sends ONLY text (chapter descriptions + scene
sentences + candidate ids) to the model — no base64, no GPS/place, nothing the
recognition model did not already author in WP1.3.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Mapping, Sequence

from ...logging_config import get_logger
from ...schemas import V3Chapter
from ...settings import get_settings
from ...prompts import load_prompt
from ... import ai_client
from ...engine import skeleton_v3
from ...vision_provider import (
    VisionSlot,
    VisionSlotError,
    ark_vision_slot,
    openai_vision_slot,
)

_PROMPT_DIR = Path(__file__).resolve().parent

log = get_logger("select_template")

# Every page in this stage is an interior body page (cover/toc/ending are owned by
# later WPs); the candidate pool is therefore always the interior category.
_INTERIOR: skeleton_v3.Category = "interior"


class SelectTemplateError(Exception):
    """The select-template LLM step failed in a way that must trigger the pure-code
    fallback (`skeleton_v3.build_skeleton_v3`). Never surfaced to the caller as a
    hard error — the preview always succeeds via the deterministic path."""


# ---------- page planning (pure code) ----------------------------------------


def _photo_id(photo: Mapping[str, Any] | Any) -> str:
    """photoId out of a V3ChapterPhoto model or a plain mapping."""
    if isinstance(photo, Mapping):
        return str(photo["photoId"])
    return str(photo.photoId)


def _scene(photo: Mapping[str, Any] | Any) -> str:
    if isinstance(photo, Mapping):
        return str(photo.get("sceneDescription") or "")
    return str(getattr(photo, "sceneDescription", "") or "")


class _PlannedPage:
    """One per-page chunk: which chapter it came from, its photos, and the legal
    candidate templateIds it may use. `pageId` is a stable handle the LLM echoes
    back so we can match its choice to the right page."""

    __slots__ = ("page_id", "chapter_index", "chapter", "photos", "candidates")

    def __init__(
        self,
        page_id: str,
        chapter_index: int,
        chapter: V3Chapter,
        photos: list[Any],
        candidates: list[dict[str, Any]],
    ) -> None:
        self.page_id = page_id
        self.chapter_index = chapter_index
        self.chapter = chapter
        self.photos = photos
        self.candidates = candidates

    @property
    def legal_ids(self) -> set[str]:
        return {c["templateId"] for c in self.candidates}


def plan_pages(chapters: Sequence[V3Chapter]) -> list[_PlannedPage]:
    """Partition every chapter into per-page chunks with their legal candidate sets.

    Mirrors `skeleton_v3.build_skeleton_v3`'s partition so the LLM and fallback paths
    produce the SAME page count / photo grouping — select-template only changes WHICH
    template each page uses, never how photos are split across pages. Chapters with no
    photos are skipped (a chapter never yields an empty page)."""
    planned: list[_PlannedPage] = []
    for ch_idx, chapter in enumerate(chapters):
        photos = list(chapter.photos)
        if not photos:
            continue
        for chunk in skeleton_v3.partition_photos_v3(photos, category=_INTERIOR):
            page_id = f"pg_{len(planned) + 1}"
            candidates = skeleton_v3.legal_candidates(_INTERIOR, len(chunk))
            planned.append(
                _PlannedPage(
                    page_id=page_id,
                    chapter_index=ch_idx,
                    chapter=chapter,
                    photos=list(chunk),
                    candidates=candidates,
                )
            )
    return planned


# ---------- LLM intent --------------------------------------------------------


def _select_slot(settings: Any) -> VisionSlot:
    """Reuse the describe-content provider policy: OpenAI (GPT-5.5 Mini) primary,
    火山 doubao failover. This stage is text-only so either slot works; we pick the
    primary when configured, else the ark slot. Raises SelectTemplateError when
    neither is configured (caller then takes the pure-code fallback)."""
    try:
        return openai_vision_slot(
            settings,
            timeout_seconds=settings.describe_openai_timeout_seconds,
            model=settings.describe_openai_model,
        )
    except VisionSlotError:
        pass
    try:
        return ark_vision_slot(settings)
    except VisionSlotError as exc:
        raise SelectTemplateError(f"no select-template slot configured: {exc}") from exc


def _build_user_content(pages: Sequence[_PlannedPage]) -> str:
    """A compact text manifest: per page, its photo count + chapter/scene context +
    the legal candidate ids the model must choose among. No base64, no place/GPS."""
    blocks: list[str] = []
    for page in pages:
        scene_lines = "\n".join(
            f"    - {_photo_id(p)}: {_scene(p) or '(no description)'}" for p in page.photos
        )
        candidate_lines = "\n".join(
            f"    - {c['templateId']} (holds {c['imageSlotCount']})" for c in page.candidates
        )
        blocks.append(
            f"Page {page.page_id} — {len(page.photos)} photo(s)\n"
            f"  Chapter: {page.chapter.description or '(no description)'}\n"
            f"  Scenes:\n{scene_lines}\n"
            f"  candidates (pick exactly one templateId):\n{candidate_lines}"
        )
    manifest = "\n\n".join(blocks)
    return (
        f"{manifest}\n\n"
        'Return {"pages":[{"pageId":...,"templateId":...}]} with one entry per page, '
        "each templateId taken from that page's candidates."
    )


def _parse_choices(parsed: Any) -> dict[str, str]:
    """pageId -> chosen templateId from the model's JSON. Ignores malformed rows; the
    caller validates legality and falls back per page for anything missing/illegal."""
    if not isinstance(parsed, dict):
        raise SelectTemplateError("select-template response is not a JSON object")
    rows = parsed.get("pages")
    if not isinstance(rows, list):
        raise SelectTemplateError("select-template response missing pages[] array")
    choices: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        page_id = row.get("pageId")
        template_id = row.get("templateId")
        if isinstance(page_id, str) and isinstance(template_id, str) and template_id:
            choices[page_id] = template_id
    return choices


async def _call_model(slot: VisionSlot, pages: Sequence[_PlannedPage]) -> dict[str, str]:
    messages = [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "select_template.md")},
        {"role": "user", "content": _build_user_content(pages)},
    ]
    try:
        response = await ai_client.chat_completion(
            base_url=slot.base_url,
            api_key=slot.api_key,
            model=slot.model,
            messages=messages,
            timeout_seconds=slot.timeout_seconds,
            temperature=0.2,
            max_tokens=2048,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
        )
    except ai_client.AIRequestError as exc:
        raise SelectTemplateError(f"select-template upstream call failed: {exc}") from exc
    try:
        raw_text = ai_client.extract_text(response)
        parsed = ai_client.parse_json_loose(raw_text)
    except ValueError as exc:
        raise SelectTemplateError(f"select-template response unparseable: {exc}") from exc
    return _parse_choices(parsed)


# ---------- public API --------------------------------------------------------


def _fallback_pages(pages: Sequence[_PlannedPage]) -> list[dict[str, Any]]:
    """Pure-code §9 fallback for the planned pages: per page, `pick_template_v3`
    chooses a template that can hold its photos (exact capacity preferred, else
    closest larger) and `build_page_v3` slots them in declaration order. No
    quality/hero/orientation matching. This is exactly what `build_skeleton_v3`
    yields for the same partition — kept as a dedicated helper so the
    partial-fallback path (some LLM choices legal, some not) reuses it per page."""
    return [
        skeleton_v3.build_page_v3(
            _INTERIOR, [_photo_id(p) for p in page.photos], page_index=i
        )
        for i, page in enumerate(pages)
    ]


async def select_template_pages(chapters: Sequence[V3Chapter]) -> list[dict[str, Any]]:
    """Build the preview body pages: model picks each page's templateId from its
    legal candidates; pure-code fallback on any LLM failure (WP1.4 / §9).

    Returns a flat list of page dicts shaped like `schemas.Page`
    (pageIndex/templateId/images/texts) with sequential pageIndex and empty texts
    (generic copy/colors are layered later — WP1.5). NEVER raises: a failed LLM call,
    a missing provider, or an unusable response all degrade to the deterministic
    `build_skeleton_v3`-equivalent fallback so the preview always succeeds."""
    pages = plan_pages(chapters)
    if not pages:
        return []

    settings = get_settings()
    try:
        slot = _select_slot(settings)
        # The whole stage is bounded by the describe budget so a slow model can't
        # hang the analyze job past its own deadline; on timeout we fall back.
        choices = await asyncio.wait_for(
            _call_model(slot, pages),
            timeout=settings.describe_batch_deadline_seconds,
        )
    except (SelectTemplateError, asyncio.TimeoutError) as exc:
        log.warning("select_template.fallback", reason=str(exc), pages=len(pages))
        return _fallback_pages(pages)
    except Exception as exc:  # noqa: BLE001 — never let this stage hard-fail the preview
        log.warning("select_template.fallback_unhandled", reason=str(exc), pages=len(pages))
        return _fallback_pages(pages)

    out: list[dict[str, Any]] = []
    fell_back = 0
    for i, page in enumerate(pages):
        chosen = choices.get(page.page_id)
        # Hallucinate-proof: the choice must be one of THIS page's legal candidates.
        # Anything missing / out-of-set degrades to the deterministic pick for this
        # page — the model can never inject an illegal or cross-page templateId.
        if chosen not in page.legal_ids:
            chosen = None
            fell_back += 1
        out.append(
            skeleton_v3.build_page_v3(
                _INTERIOR,
                [_photo_id(p) for p in page.photos],
                template_id=chosen,
                page_index=i,
            )
        )
    log.info(
        "select_template.ok",
        provider=slot.provider,
        model=slot.model,
        pages=len(pages),
        model_picked=len(pages) - fell_back,
        per_page_fallback=fell_back,
    )
    return out
