"""章节描述 Agent。

输入是已经由 `chaptering.grouping` 分好的章节;本 Agent 只写章节级
description/titleHint/keywords/visualSummary,不做散落照片归章。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from ... import ai_client
from ...logging_config import get_logger
from ...schemas import V3AnalyzePhoto
from ...settings import get_settings
from ...skills import SKILLS_DIR, load_prompt
from ...engine.simple_id import from_simple_at_paths, to_simple
from ...vision_provider import (
    VisionSlot,
    VisionSlotError,
    ark_vision_slot,
    openai_vision_slot,
)
from ..image_grouping.schema import GroupingResult
from ..vision_error import VisionError
from .schema import DescribeResult

_PROMPT_DIR = Path(__file__).resolve().parent
_DESCRIBE_CHAPTERS_SIMPLE_KEY_PATHS = (
    ("chapters", "*", "scenes", "*"),
    ("unplacedScenes", "*"),
)
MAX_DESCRIBE_ATTEMPTS = 3

log = get_logger("chapter_describer")


def _build_system_prompt(language: str) -> str:
    lang_name = "中文" if language == "zh" else "英文"
    return load_prompt(_PROMPT_DIR / "describe_chapters.md", LANGUAGE=lang_name)


def _build_user_content(
    grouping: GroupingResult,
    photos_by_id: dict[str, V3AnalyzePhoto],
    prompt_hint: str | None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    ordered_ids: list[str] = []
    for chapter in grouping.chapters:
        ordered_ids.extend(chapter.photoIds)
    ordered_ids.extend(grouping.unplacedPhotoIds)

    seen: set[str] = set()
    unique_ordered_ids: list[str] = []
    for photo_id in ordered_ids:
        if photo_id in seen:
            continue
        if photo_id not in photos_by_id:
            raise VisionError(f"describe-chapters referenced unknown photoId: {photo_id}")
        seen.add(photo_id)
        unique_ordered_ids.append(photo_id)

    simple_ids, real_by_simple = to_simple(unique_ordered_ids)
    simple_by_real = {
        real_id: simple_id
        for simple_id, real_id in zip(simple_ids, unique_ordered_ids, strict=True)
    }

    manifest_lines: list[str] = []
    if prompt_hint:
        manifest_lines.append(f"纪念册提示: {prompt_hint}")
    manifest_lines.append("已固定章节:")
    for chapter in grouping.chapters:
        photo_ids = ", ".join(simple_by_real[pid] for pid in chapter.photoIds)
        manifest_lines.append(f"- {chapter.chapterId}: [{photo_ids}]")
    if grouping.unplacedPhotoIds:
        unplaced = ", ".join(simple_by_real[pid] for pid in grouping.unplacedPhotoIds)
        manifest_lines.append(f"等待补充分章的散落照片: [{unplaced}]")

    parts: list[dict[str, Any]] = [{"type": "text", "text": "\n".join(manifest_lines)}]
    for photo_id in unique_ordered_ids:
        parts.append(
            {"type": "image_url", "image_url": {"url": photos_by_id[photo_id].base64}}
        )
    return parts, real_by_simple


def _required_text(raw: Any, *, field: str, max_len: int) -> str:
    if not isinstance(raw, str):
        raise VisionError(f"describe-chapters {field} must be a string")
    text = raw.strip()
    if not text:
        raise VisionError(f"describe-chapters {field} is required")
    if len(text) > max_len:
        raise VisionError(f"describe-chapters {field} exceeds {max_len} chars")
    return text


def _optional_text(
    raw: Any,
    *,
    field: str,
    max_len: int,
    fallback: str = "",
) -> str:
    if raw is None:
        return fallback
    return _required_text(raw, field=field, max_len=max_len)


def _keyword_list(raw: Any, *, field: str) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise VisionError(f"describe-chapters {field} must be an array")
    keywords: list[str] = []
    for index, item in enumerate(raw[:6]):
        if not isinstance(item, str):
            raise VisionError(f"describe-chapters {field}[{index}] must be a string")
        text = item.strip()
        if text:
            keywords.append(text[:40])
    return keywords


def _assemble_result(parsed: Any, grouping: GroupingResult) -> DescribeResult:
    raw_chapters = parsed.get("chapters") if isinstance(parsed, dict) else None
    if not isinstance(raw_chapters, list):
        raise VisionError("describe-chapters response missing chapters[] array")

    raw_by_id: dict[str, dict[str, Any]] = {}
    for idx, raw in enumerate(raw_chapters):
        if not isinstance(raw, dict):
            raise VisionError(f"describe-chapters chapter {idx + 1} must be an object")
        raw_id = raw.get("chapterId")
        chapter_id = raw_id if isinstance(raw_id, str) and raw_id else ""
        if not chapter_id and idx < len(grouping.chapters):
            chapter_id = grouping.chapters[idx].chapterId
        if not chapter_id:
            raise VisionError(f"describe-chapters chapter {idx + 1} missing chapterId")
        raw_by_id[chapter_id] = raw

    chapter_descriptions: dict[str, str] = {}
    image_descriptions: dict[str, str] = {}
    chapter_title_hints: dict[str, str] = {}
    chapter_keywords: dict[str, list[str]] = {}
    chapter_visual_summaries: dict[str, str] = {}

    for chapter in grouping.chapters:
        raw = raw_by_id.get(chapter.chapterId)
        if raw is None:
            raise VisionError(f"describe-chapters omitted chapterId: {chapter.chapterId}")
        scenes = raw.get("scenes", {})
        if scenes is None:
            scenes = {}
        if not isinstance(scenes, dict):
            raise VisionError(f"describe-chapters {chapter.chapterId} scenes must be an object")

        # 章节 description 不再由识图阶段写:留作目录(TOC)占位,后期写目录才填。
        title_hint = _optional_text(
            raw.get("titleHint"),
            field=f"{chapter.chapterId}.titleHint",
            max_len=120,
        )
        # visualSummary 仍必填:它是逐照片 sceneDescription 的兜底来源(原先由 description
        # 兜底,description 取消后由 visualSummary 顶上),缺失触发 recoverable 重试。
        visual_summary = _required_text(
            raw.get("visualSummary"),
            field=f"{chapter.chapterId}.visualSummary",
            max_len=300,
        )
        keywords = _keyword_list(raw.get("keywords"), field=f"{chapter.chapterId}.keywords")

        chapter_title_hints[chapter.chapterId] = title_hint
        chapter_keywords[chapter.chapterId] = keywords
        chapter_visual_summaries[chapter.chapterId] = visual_summary
        for photo_id in chapter.photoIds:
            raw_scene = scenes.get(photo_id)
            if raw_scene is None:
                image_descriptions[photo_id] = visual_summary
            else:
                image_descriptions[photo_id] = _required_text(
                    raw_scene,
                    field=f"scenes.{photo_id}",
                    max_len=300,
                )

    raw_unplaced = parsed.get("unplacedScenes", {}) if isinstance(parsed, dict) else {}
    if raw_unplaced is None:
        raw_unplaced = {}
    if grouping.unplacedPhotoIds and not isinstance(raw_unplaced, dict):
        raise VisionError("describe-chapters unplacedScenes must be an object")
    for photo_id in grouping.unplacedPhotoIds:
        raw_scene = raw_unplaced.get(photo_id) if isinstance(raw_unplaced, dict) else None
        if raw_scene is not None:
            image_descriptions[photo_id] = _required_text(
                raw_scene,
                field=f"unplacedScenes.{photo_id}",
                max_len=300,
            )

    return DescribeResult(
        chapterDescriptions=chapter_descriptions,
        imageDescriptions=image_descriptions,
        chapterTitleHints=chapter_title_hints,
        chapterKeywords=chapter_keywords,
        chapterVisualSummaries=chapter_visual_summaries,
    )


def _is_recoverable_error(exc: VisionError) -> bool:
    msg = str(exc)
    return (
        "omitted chapterId" in msg
        or ".keywords" in msg
        or ".visualSummary" in msg
    )


async def _call(
    slot: VisionSlot,
    grouping: GroupingResult,
    photos_by_id: dict[str, V3AnalyzePhoto],
    language: str,
    prompt_hint: str | None,
    *,
    max_output_tokens: int,
) -> tuple[DescribeResult, int]:
    user_content, real_by_simple = _build_user_content(grouping, photos_by_id, prompt_hint)
    total_tokens = 0
    last_err: VisionError | None = None

    for attempt in range(MAX_DESCRIBE_ATTEMPTS):
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": _build_system_prompt(language)},
            {"role": "user", "content": user_content},
        ]
        if attempt > 0 and last_err is not None:
            messages.append(
                {
                    "role": "user",
                    "content": load_prompt(
                        SKILLS_DIR / "describe_retry.md",
                        N=str(len(real_by_simple)),
                        ERR=str(last_err),
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
            max_tokens=max_output_tokens,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
        )
        prompt_tokens, completion_tokens = ai_client.extract_usage(response)
        total_tokens += prompt_tokens + completion_tokens
        raw_text = ai_client.extract_text(response)
        try:
            parsed = ai_client.parse_json_loose(raw_text)
        except ValueError as exc:
            raise VisionError(f"describe-chapters response unparseable: {exc}") from exc

        parsed = from_simple_at_paths(
            parsed,
            real_by_simple,
            value_paths=(),
            key_paths=_DESCRIBE_CHAPTERS_SIMPLE_KEY_PATHS,
        )
        try:
            return _assemble_result(parsed, grouping), total_tokens
        except VisionError as exc:
            if not _is_recoverable_error(exc) or attempt == MAX_DESCRIBE_ATTEMPTS - 1:
                raise
            last_err = exc
            log.warning(
                "chapter_describer.retry",
                provider=slot.provider,
                attempt=attempt + 1,
                reason=str(exc)[:120],
            )

    raise last_err or VisionError("describe-chapters failed after retries")


async def describe_chapters(
    grouping: GroupingResult,
    photos_by_id: dict[str, V3AnalyzePhoto],
    *,
    language: str,
    prompt_hint: str | None = None,
) -> DescribeResult:
    """描述已固定的 Stage1 章节,不产出 pages/templates。"""
    settings = get_settings()
    if not photos_by_id:
        raise VisionError("describe-chapters called with no photos")

    try:
        if settings.vision_provider == "ark":
            primary_slot = ark_vision_slot(settings)
        else:
            primary_slot = openai_vision_slot(
                settings,
                timeout_seconds=settings.describe_openai_timeout_seconds,
                model=settings.describe_openai_model,
            )
    except VisionSlotError as exc:
        raise VisionError(f"describe-chapters primary unavailable: {exc}") from exc

    try:
        result, tokens = await asyncio.wait_for(
            _call(
                primary_slot,
                grouping,
                photos_by_id,
                language,
                prompt_hint,
                max_output_tokens=settings.describe_max_output_tokens,
            ),
            timeout=settings.describe_batch_deadline_seconds,
        )
        return DescribeResult(
            chapterDescriptions=result.chapterDescriptions,
            imageDescriptions=result.imageDescriptions,
            chapterTitleHints=result.chapterTitleHints,
            chapterKeywords=result.chapterKeywords,
            chapterVisualSummaries=result.chapterVisualSummaries,
            tokens_billed=tokens,
            model=primary_slot.model,
            provider=primary_slot.provider,
            call_count=1,
        )
    except asyncio.TimeoutError:
        log.warning("chapter_describer.primary_failover", provider=primary_slot.provider)
    except ai_client.AIRequestError as exc:
        if not exc.failover_eligible:
            raise VisionError(f"describe-chapters primary failed: {exc}") from exc
        log.warning(
            "chapter_describer.primary_failover",
            provider=primary_slot.provider,
            reason=exc.kind or type(exc).__name__,
        )

    try:
        fallback_slot = ark_vision_slot(settings)
    except VisionSlotError as exc:
        raise VisionError(f"describe-chapters failover unavailable: {exc}") from exc
    try:
        result, tokens = await _call(
            fallback_slot,
            grouping,
            photos_by_id,
            language,
            prompt_hint,
            max_output_tokens=settings.describe_max_output_tokens,
        )
    except ai_client.AIRequestError as exc:
        raise VisionError(f"describe-chapters failover failed: {exc}") from exc

    return DescribeResult(
        chapterDescriptions=result.chapterDescriptions,
        imageDescriptions=result.imageDescriptions,
        chapterTitleHints=result.chapterTitleHints,
        chapterKeywords=result.chapterKeywords,
        chapterVisualSummaries=result.chapterVisualSummaries,
        tokens_billed=tokens,
        model=fallback_slot.model,
        provider=fallback_slot.provider,
        call_count=2,
    )
