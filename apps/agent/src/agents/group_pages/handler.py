"""V3 group-pages:识图分析后,AI 按画面效果把【章内】照片重分页 —— 确定性分页当参考 + 兜底。

§8.3 安全模型「模型出意图、确定性引擎保合法」:模型读 analysis 已识别的文字信号
(sceneDescription / orientation / takenAt) + 确定性基线(`partition_photos_v3`),为每章
提出页分组;`skeleton_v3.validate_grouping` 守三条硬护栏(每页 1..容量上限、不丢不重、
保持原顺序)。任一不合法 / LLM 失败 / provider 缺失 → 该章回退确定性基线。

无状态 / 隐私 (§3):只发文字(章节内照片的 photoId + 场景句 + 朝向 + 拍摄时间),无
base64 / GPS。永不抛错:分组失败时预览仍走确定性分页成功。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping, Sequence

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

log = get_logger("group_pages")

# 本环节只重分正文页;池子始终是 interior 类别(cover/toc/ending 归其它环节)。
_INTERIOR: skeleton_v3.Category = "interior"

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]


class GroupPagesError(Exception):
    """分组的 LLM 步骤以一种必须触发确定性回退的方式失败(provider 缺失 / 上游报错 /
    响应不可解析)。绝不作为硬错误外抛 —— 预览总能经确定性分页成功。"""


# ---------- 字段读取(兼容 pydantic 对象与纯 mapping)----------------------


def _attr(obj: Mapping[str, Any] | Any, key: str) -> Any:
    return obj[key] if isinstance(obj, Mapping) else getattr(obj, key)


def _chapter_id(chapter: Mapping[str, Any] | Any) -> str:
    return str(_attr(chapter, "chapterId"))


def _photos(chapter: Mapping[str, Any] | Any) -> list[Any]:
    return list(_attr(chapter, "photos"))


def _photo_id(photo: Mapping[str, Any] | Any) -> str:
    return str(_attr(photo, "photoId"))


def _scene(photo: Mapping[str, Any] | Any) -> str:
    return str(_attr(photo, "sceneDescription") or "")


def _orientation(photo: Mapping[str, Any] | Any) -> str:
    return str(_attr(photo, "orientation") or "")


def _taken_at(photo: Mapping[str, Any] | Any) -> str:
    # takenAt 可选:pydantic 缺省 None / dict 缺键。AttributeError(对象)与 KeyError(mapping)都吞。
    try:
        return str(_attr(photo, "takenAt") or "")
    except (AttributeError, KeyError):
        return ""


# ---------- 确定性基线(参考 + 兜底)----------------------------------------


def _baseline(chapters: Sequence[Any]) -> dict[str, list[list[str]]]:
    """每章的确定性分页(photoId 块列表),给模型当参考、也是兜底。空章跳过。"""
    out: dict[str, list[list[str]]] = {}
    for chapter in chapters:
        photos = _photos(chapter)
        if not photos:
            continue
        out[_chapter_id(chapter)] = [
            [_photo_id(p) for p in chunk]
            for chunk in skeleton_v3.partition_photos_v3(photos, category=_INTERIOR)
        ]
    return out


# ---------- LLM 意图 --------------------------------------------------------


def _select_slot(settings: Any) -> VisionSlot:
    """provider 策略同 select-template:OpenAI 为主、火山 doubao failover;纯文字,哪个都行。
    两者都没配 → 抛 GroupPagesError(调用方走确定性兜底)。"""
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
        raise GroupPagesError(f"no group-pages slot configured: {exc}") from exc


def _build_user_content(chapters: Sequence[Any], baseline: dict[str, list[list[str]]]) -> str:
    """逐章给:按序照片(photoId | 朝向 | 拍摄时间 | 场景)+ 确定性基线参考。无 base64 / GPS。"""
    cap = skeleton_v3.max_capacity(_INTERIOR)
    blocks: list[str] = []
    for chapter in chapters:
        photos = _photos(chapter)
        if not photos:
            continue
        cid = _chapter_id(chapter)
        photo_lines = "\n".join(
            f"    - {_photo_id(p)} | {_orientation(p) or '朝向未知'} | "
            f"{_taken_at(p) or '时间未知'} | {_scene(p) or '(无描述)'}"
            for p in photos
        )
        blocks.append(
            f"章节 {cid}({len(photos)} 张):\n"
            f"  按顺序的照片(photoId | 朝向 | 拍摄时间 | 场景):\n{photo_lines}\n"
            f"  确定性基线(参考,可据效果重分):{baseline[cid]}"
        )
    manifest = "\n\n".join(blocks)
    return (
        f"每页最多 {cap} 张照片。按画面效果 / 时间连贯性把每章照片分页 —— 可比基线拆得更细,"
        "让同一页的照片在场景 / 主体 / 情绪上连贯,避免一页过挤或落单孤页。\n"
        "硬性约束:每页 1..上限 张;保持照片原顺序(相册是时间序);每张照片恰好出现一次,不丢不重。\n\n"
        f"{manifest}\n\n"
        '返回 {"chapters":[{"chapterId":"...","pages":[["photoId",...],...]}]} —— 每章一条,'
        "其 pages 必须按序覆盖该章全部照片。"
    )


def _parse_grouping(parsed: Any) -> dict[str, list[list[str]]]:
    """从模型 JSON 取 chapterId -> 页分组(photoId 列表的列表)。忽略畸形条目;
    调用方逐章校验合法性,非法者回退基线。"""
    if not isinstance(parsed, dict):
        raise GroupPagesError("group-pages response is not a JSON object")
    rows = parsed.get("chapters")
    if not isinstance(rows, list):
        raise GroupPagesError("group-pages response missing chapters[] array")
    out: dict[str, list[list[str]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        cid = row.get("chapterId")
        pages = row.get("pages")
        if not isinstance(cid, str) or not cid or not isinstance(pages, list):
            continue
        norm: list[list[str]] = []
        for page in pages:
            if not isinstance(page, list):
                continue
            norm.append([str(x) for x in page if isinstance(x, str) and x])
        out[cid] = norm
    return out


async def _call_model(
    chapters: Sequence[Any],
    baseline: dict[str, list[list[str]]],
    *,
    complete: CompleteFn | None,
) -> dict[str, list[list[str]]]:
    messages = [
        {
            "role": "system",
            "content": load_prompt(_PROMPT_DIR / "group_pages.md", common=("json_only",)),
        },
        {"role": "user", "content": _build_user_content(chapters, baseline)},
    ]
    if complete is not None:
        try:
            response = await complete(messages)
        except ai_client.AIRequestError as exc:
            raise GroupPagesError(f"group-pages injected call failed: {exc}") from exc
    else:
        slot = _select_slot(get_settings())
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
            raise GroupPagesError(f"group-pages upstream call failed: {exc}") from exc
    try:
        raw_text = ai_client.extract_text(response)
        parsed = ai_client.parse_json_loose(raw_text)
    except ValueError as exc:
        raise GroupPagesError(f"group-pages response unparseable: {exc}") from exc
    return _parse_grouping(parsed)


# ---------- 公开 API --------------------------------------------------------


async def group_chapter_pages(
    chapters: Sequence[V3Chapter],
    *,
    complete: CompleteFn | None = None,
) -> dict[str, list[list[str]]]:
    """每章按效果重分页,返回 chapterId -> 页分组(photoId 块列表)。

    模型提分组、`validate_grouping` 守合法;任何不合法 / LLM 失败 / provider 缺失,
    该章回退确定性基线。空章不出现在结果里。绝不抛错。"""
    baseline = _baseline(chapters)
    if not baseline:
        return {}
    try:
        proposed = await _call_model(chapters, baseline, complete=complete)
    except GroupPagesError as exc:
        log.info("group_pages.fallback_all", error=str(exc))
        return baseline

    result: dict[str, list[list[str]]] = {}
    for chapter in chapters:
        photos = _photos(chapter)
        if not photos:
            continue
        cid = _chapter_id(chapter)
        ids = [_photo_id(p) for p in photos]
        cand = proposed.get(cid)
        if cand is not None and skeleton_v3.validate_grouping(cand, ids, category=_INTERIOR):
            result[cid] = cand
        else:
            if cand is not None:
                log.info("group_pages.fallback_chapter", chapter_id=cid)
            result[cid] = baseline[cid]
    return result
