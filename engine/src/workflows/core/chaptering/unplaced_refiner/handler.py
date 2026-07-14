"""补充分章 Agent。

输入是已有章节摘要和散落照片;本 Agent 只决定散落照片进入已有章节,
或形成新的章节。
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .....providers import ai_client
from ..schema import NewChapter, UnplacedAssignments
from ...layout.simple_id import from_simple_at_paths, to_simple
from .....logging_config import get_logger
from .....contracts.schemas import V3AnalyzePhoto
from .....settings import get_settings
from ....prompts import load_prompt
from .....providers.vision_provider import (
    VisionSlot,
    VisionSlotError,
    ark_vision_slot,
)
from ..chapter_describer.schema import DescribeResult
from ..schema import GroupingResult
from ..vision_error import VisionError

_PROMPT_DIR = Path(__file__).resolve().parent
_REFINE_UNPLACED_SIMPLE_KEY_PATHS = (("assignments", "*"),)
_REFINE_UNPLACED_SIMPLE_VALUE_PATHS = (
    ("newChapters", "*", "photoIds", "*"),
)

log = get_logger("unplaced_refiner")


def _build_system_prompt(language: str) -> str:
    lang_name = "中文" if language == "zh" else "英文"
    return load_prompt(_PROMPT_DIR / "refine_unplaced.md", LANGUAGE=lang_name)


def _build_user_content(
    grouping: GroupingResult,
    descriptions: DescribeResult,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
    prompt_hint: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    simple_ids, real_by_simple = to_simple(grouping.unplacedPhotoIds)
    simple_by_real = {
        real_id: simple_id
        for simple_id, real_id in zip(simple_ids, grouping.unplacedPhotoIds, strict=True)
    }

    manifest_lines: list[str] = []
    if prompt_hint:
        manifest_lines.append(f"纪念册提示: {prompt_hint}")
    manifest_lines.append("已有章节:")
    for chapter in grouping.chapters:
        keywords = ", ".join(descriptions.chapterKeywords.get(chapter.chapterId, []))
        title_hint = descriptions.chapterTitleHints.get(chapter.chapterId, "")
        visual_summary = descriptions.chapterVisualSummaries.get(chapter.chapterId, "")
        description = descriptions.chapterDescriptions.get(chapter.chapterId, "")
        manifest_lines.append(
            f"- {chapter.chapterId}: 标题提示={title_hint}; "
            f"关键词=[{keywords}]; 视觉摘要={visual_summary}; "
            f"章节描述={description}"
        )

    manifest_lines.append("散落照片:")
    for photo_id in grouping.unplacedPhotoIds:
        photo = photos_by_id.get(photo_id)
        if photo is None:
            raise VisionError(f"refine-unplaced referenced unknown photoId: {photo_id}")
        taken = (photo.exif.takenAt if photo.exif else None) or "unknown"
        scene = descriptions.imageDescriptions.get(photo_id, "")
        manifest_lines.append(
            f"- {simple_by_real[photo_id]}: 拍摄时间={taken}; 当前画面描述={scene}"
        )

    parts: list[dict[str, Any]] = [{"type": "text", "text": "\n".join(manifest_lines)}]
    for photo_id in grouping.unplacedPhotoIds:
        parts.append(
            {"type": "image_url", "image_url": {"url": photos_by_id[photo_id].base64}}
        )
    return parts, real_by_simple


def _required_text(raw: Any, *, field: str, max_len: int) -> str:
    if not isinstance(raw, str):
        raise VisionError(f"refine-unplaced {field} must be a string")
    text = raw.strip()
    if not text:
        raise VisionError(f"refine-unplaced {field} is required")
    if len(text) > max_len:
        raise VisionError(f"refine-unplaced {field} exceeds {max_len} chars")
    return text


def _keyword_list(raw: Any, *, field: str) -> list[str]:
    if not isinstance(raw, list):
        raise VisionError(f"refine-unplaced {field} must be an array")
    keywords: list[str] = []
    for index, item in enumerate(raw[:6]):
        if not isinstance(item, str):
            raise VisionError(f"refine-unplaced {field}[{index}] must be a string")
        text = item.strip()
        if text:
            keywords.append(text[:40])
    return keywords


def _assemble_result(parsed: Any) -> UnplacedAssignments:
    if not isinstance(parsed, dict):
        raise VisionError("refine-unplaced response must be an object")
    raw_assignments = parsed.get("assignments")
    if not isinstance(raw_assignments, dict):
        raise VisionError("refine-unplaced response missing assignments object")

    assignments: dict[str, str] = {}
    for photo_id, chapter_id in raw_assignments.items():
        if not isinstance(photo_id, str) or not photo_id:
            raise VisionError("refine-unplaced assignment photoId must be a string")
        if not isinstance(chapter_id, str) or not chapter_id:
            raise VisionError(f"refine-unplaced target missing for {photo_id}")
        assignments[photo_id] = chapter_id

    raw_new = parsed.get("newChapters", [])
    if raw_new is None:
        raw_new = []
    if not isinstance(raw_new, list):
        raise VisionError("refine-unplaced newChapters must be an array")

    new_chapters: list[NewChapter] = []
    for index, raw in enumerate(raw_new):
        if not isinstance(raw, dict):
            raise VisionError(f"refine-unplaced newChapters[{index}] must be an object")
        chapter_id = _required_text(
            raw.get("chapterId"),
            field=f"newChapters[{index}].chapterId",
            max_len=80,
        )
        raw_photo_ids = raw.get("photoIds")
        if not isinstance(raw_photo_ids, list):
            raise VisionError(f"refine-unplaced {chapter_id}.photoIds must be an array")
        photo_ids = [
            photo_id.strip()
            for photo_id in raw_photo_ids
            if isinstance(photo_id, str) and photo_id.strip()
        ]
        if len(photo_ids) != len(raw_photo_ids):
            raise VisionError(f"refine-unplaced {chapter_id}.photoIds contain invalid id")
        # 新建章节不写 description(目录占位,后期写目录才填):只取标题/关键词/视觉摘要。
        title_hint = _required_text(
            raw.get("titleHint"),
            field=f"{chapter_id}.titleHint",
            max_len=120,
        )
        keywords = _keyword_list(raw.get("keywords"), field=f"{chapter_id}.keywords")
        visual_summary = _required_text(
            raw.get("visualSummary"),
            field=f"{chapter_id}.visualSummary",
            max_len=300,
        )
        new_chapters.append(
            NewChapter(
                chapterId=chapter_id,
                photoIds=photo_ids,
                chapterTitleHint=title_hint,
                chapterKeywords=keywords,
                chapterVisualSummary=visual_summary,
            )
        )

    return UnplacedAssignments(assignments=assignments, newChapters=new_chapters)


async def _call(
    slot: VisionSlot,
    grouping: GroupingResult,
    descriptions: DescribeResult,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
    language: str,
    *,
    max_output_tokens: int,
) -> UnplacedAssignments:
    user_content, real_by_simple = _build_user_content(grouping, descriptions, photos_by_id)
    response = await ai_client.chat_completion(
        base_url=slot.base_url,
        api_key=slot.api_key,
        model=slot.model,
        messages=[
            {"role": "system", "content": _build_system_prompt(language)},
            {"role": "user", "content": user_content},
        ],
        timeout_seconds=slot.timeout_seconds,
        temperature=0.2,
        max_tokens=max_output_tokens,
        response_format=slot.response_format,
        extra_body=slot.extra_body,
    )
    raw_text = ai_client.extract_text(response)
    try:
        parsed = ai_client.parse_json_loose(raw_text)
    except ValueError as exc:
        raise VisionError(f"refine-unplaced response unparseable: {exc}") from exc
    parsed = from_simple_at_paths(
        parsed,
        real_by_simple,
        value_paths=_REFINE_UNPLACED_SIMPLE_VALUE_PATHS,
        key_paths=_REFINE_UNPLACED_SIMPLE_KEY_PATHS,
    )
    return _assemble_result(parsed)


async def assign_unplaced_to_chapters(
    grouping: GroupingResult,
    descriptions: DescribeResult,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
    *,
    language: str,
) -> UnplacedAssignments:
    """用视觉模型把散落照片归入已有章节或 AI 新增章节。"""
    if not grouping.unplacedPhotoIds:
        return UnplacedAssignments(assignments={})

    settings = get_settings()
    try:
        # 补充分章必须看散落照片本身,先固定使用豆包视觉槽,不跟随全局
        # VISION_PROVIDER 切到 OpenAI。
        slot = ark_vision_slot(settings)
    except VisionSlotError as exc:
        raise VisionError(f"refine-unplaced doubao vision unavailable: {exc}") from exc

    try:
        return await asyncio.wait_for(
            _call(
                slot,
                grouping,
                descriptions,
                photos_by_id,
                language,
                max_output_tokens=settings.describe_max_output_tokens,
            ),
            timeout=settings.describe_batch_deadline_seconds,
        )
    except asyncio.TimeoutError:
        raise VisionError("refine-unplaced doubao vision timed out")
    except ai_client.AIRequestError as exc:
        log.warning(
            "unplaced_refiner.doubao_failed",
            provider=slot.provider,
            reason=exc.kind or type(exc).__name__,
        )
        raise VisionError(f"refine-unplaced doubao vision failed: {exc}") from exc
