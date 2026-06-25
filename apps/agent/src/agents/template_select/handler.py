"""V3 select-template:识图模型从【合法】候选集里为每页挑 templateId;LLM 调用失败时
走纯代码 fallback(WP1.4 / #183)。

它建在 WP0.4 确定性引擎(`skeleton_v3`)之上,遵循 §8.3 安全模型 ——「模型出意图、
确定性引擎保合法」:

  * 章节树(WP1.3)被切成逐页 chunk,每个不大于 interior 类别最大的模板
    (`skeleton_v3.partition_photos_v3`)。每个 chunk 恰好变成一个 interior 页。
  * 对每页我们用 `skeleton_v3.legal_candidates("interior", N)` 算出其【合法】候选集
    —— interior 类别里 image-slot 数能容纳本页 N 张照片的每一个模板。模型【只】看到
    这些候选 id(外加章节/场景上下文),并且必须返回取自这一确切列表的 templateId。
    合法集之外的选择(幻觉 / 错页 id)被拒,该页 fallback —— 模型绝无法注入非法
    templateId(§9 / §6.8 第 6 条)。
  * 任何地方都不做质量 / hero / 朝向匹配。照片按声明顺序摆进槽
    (`skeleton_v3.assign_images_v3`);宽高比不符是渲染器 center-cover 的事,在这里
    绝不算错误。

Fallback (§9):LLM 调用失败时(transport/timeout/无法解析/不可用),整份预览回退到纯
代码路径 —— `skeleton_v3.build_skeleton_v3`,它逐 chunk 挑一个能容纳 N 张照片的模板
(优先恰好容量,否则最接近的更大),并按顺序摆进去。「10 张照片 → 一个能放 10 张的
模板,按顺序摆。」不做质量/hero 匹配,宽高比不符也不拒。

无状态 / 隐私 (§3):本环节【只】给模型发送文字(章节描述 + 场景句子 + 候选 id)——
无 base64,无 GPS/place,没有任何识图模型在 WP1.3 未曾写过的东西。
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

# 本环节每页都是 interior 正文页(cover/toc/ending 归后续 WP 所有);因此候选池始终是
# interior 类别。
_INTERIOR: skeleton_v3.Category = "interior"


class SelectTemplateError(Exception):
    """select-template 的 LLM 步骤以一种必须触发纯代码 fallback
    (`skeleton_v3.build_skeleton_v3`)的方式失败时抛。绝不作为硬错误向调用方外抛 ——
    预览总能经确定性路径成功。"""


# ---------- 页面规划(纯代码)----------------------------------------


def _photo_id(photo: Mapping[str, Any] | Any) -> str:
    """从一个 V3ChapterPhoto 模型或纯 mapping 里取出 photoId。"""
    if isinstance(photo, Mapping):
        return str(photo["photoId"])
    return str(photo.photoId)


def _scene(photo: Mapping[str, Any] | Any) -> str:
    if isinstance(photo, Mapping):
        return str(photo.get("sceneDescription") or "")
    return str(getattr(photo, "sceneDescription", "") or "")


class _PlannedPage:
    """一个逐页 chunk:它来自哪一章、它的照片、以及它可用的合法候选 templateId。
    `pageId` 是一个稳定句柄,LLM 会原样回带,好让我们把它的选择对到正确的页。"""

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


def _chapter_chunks(
    chapter: V3Chapter,
    photos: Sequence[Any],
    grouping: Mapping[str, Sequence[Sequence[str]]] | None,
) -> list[list[Any]]:
    """该章的逐页照片 chunk:给了 AI 分组(`group_pages`)就按它重建(photoId→照片对象),
    否则走确定性分页(`partition_photos_v3`)。AI 分组上游已用 `validate_grouping` 校验过
    (不丢不重保序);这里再 try 防御 —— 任何 id 对不上立刻退确定性分页。"""
    pages = grouping.get(chapter.chapterId) if grouping else None
    if not pages:
        return [list(c) for c in skeleton_v3.partition_photos_v3(photos, category=_INTERIOR)]
    by_id = {_photo_id(p): p for p in photos}
    try:
        return [[by_id[pid] for pid in page] for page in pages]
    except KeyError:
        return [list(c) for c in skeleton_v3.partition_photos_v3(photos, category=_INTERIOR)]


def plan_pages(
    chapters: Sequence[V3Chapter],
    grouping: Mapping[str, Sequence[Sequence[str]]] | None = None,
) -> list[_PlannedPage]:
    """把每一章切成逐页 chunk,连同各自的合法候选集。

    分页来源:给了 `grouping`(AI 按效果重分,`group_pages`)就用它,否则确定性
    `partition_photos_v3`。无论哪种,select-template 仍只改每页用【哪个】模板,绝不再改
    照片怎么分到各页(分页此刻已定)。没有照片的章节被跳过(一章绝不产出空页)。"""
    planned: list[_PlannedPage] = []
    for ch_idx, chapter in enumerate(chapters):
        photos = list(chapter.photos)
        if not photos:
            continue
        for chunk in _chapter_chunks(chapter, photos, grouping):
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


# ---------- LLM 意图 --------------------------------------------------------


def _select_slot(settings: Any) -> VisionSlot:
    """复用 describe-content 的 provider 策略:OpenAI (GPT-5.5 Mini) 为主,
    火山 doubao 为 failover。本环节是纯文字,所以哪个 slot 都行;配了主就用主,否则用
    ark slot。两者都没配时抛 SelectTemplateError(调用方随后走纯代码 fallback)。"""
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
    """一份紧凑的文字清单:逐页给出其照片数 + 章节/场景上下文 + 模型必须从中挑选的合法
    候选 id。无 base64,无 place/GPS。"""
    blocks: list[str] = []
    for page in pages:
        scene_lines = "\n".join(
            f"    - {_photo_id(p)}: {_scene(p) or '(无描述)'}" for p in page.photos
        )
        candidate_lines = "\n".join(
            f"    - {c['templateId']}(可容纳 {c['imageSlotCount']} 张)" for c in page.candidates
        )
        blocks.append(
            f"页 {page.page_id} —— {len(page.photos)} 张照片\n"
            f"  章节:{page.chapter.description or '(无描述)'}\n"
            f"  场景:\n{scene_lines}\n"
            f"  候选 candidates(恰好挑一个 templateId):\n{candidate_lines}"
        )
    manifest = "\n\n".join(blocks)
    return (
        f"{manifest}\n\n"
        '返回 {"pages":[{"pageId":...,"templateId":...}]},每页一个条目,'
        "每个 templateId 都取自该页的 candidates。"
    )


def _parse_choices(parsed: Any) -> dict[str, str]:
    """从模型 JSON 里取 pageId -> 所选 templateId。忽略畸形行;调用方校验合法性,并对任何
    缺失/非法的逐页 fallback。"""
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
        {
            "role": "system",
            "content": load_prompt(
                _PROMPT_DIR / "select_template.md", common=("json_only",)
            ),
        },
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


# ---------- 公开 API --------------------------------------------------------


def _fallback_pages(pages: Sequence[_PlannedPage]) -> list[dict[str, Any]]:
    """对规划好的页做纯代码 §9 fallback:逐页 `pick_template_v3` 挑一个能容纳其照片的
    模板(优先恰好容量,否则最接近的更大),`build_page_v3` 按声明顺序摆进去。不做
    质量/hero/朝向匹配。这正是 `build_skeleton_v3` 对同一切分产出的结果 —— 作为一个
    专用 helper 保留,使部分 fallback 路径(部分 LLM 选择合法、部分不合法)能逐页复用它。"""
    return [
        skeleton_v3.build_page_v3(
            _INTERIOR, [_photo_id(p) for p in page.photos], page_index=i
        )
        for i, page in enumerate(pages)
    ]


async def select_template_pages(
    chapters: Sequence[V3Chapter],
    grouping: Mapping[str, Sequence[Sequence[str]]] | None = None,
) -> list[dict[str, Any]]:
    """构建预览正文页:模型从各页合法候选里挑 templateId;任何 LLM 失败时走纯代码
    fallback(WP1.4 / §9)。

    分页由 `grouping`(AI 按效果重分,`group_pages`)决定;不给则确定性分页。

    返回一个扁平的 page dict 列表,形如 `schemas.Page`
    (pageIndex/templateId/images/texts),pageIndex 连续、texts 为空(通用文案/颜色
    在稍后叠加 —— WP1.5)。绝不抛错:失败的 LLM 调用、缺失的 provider、不可用的响应,
    统统降级到等价于 `build_skeleton_v3` 的确定性 fallback,使预览总能成功。"""
    pages = plan_pages(chapters, grouping)
    if not pages:
        return []

    settings = get_settings()
    try:
        slot = _select_slot(settings)
        # 整个环节受 describe 预算约束,免得慢模型把 analyze 作业拖过自己的截止;超时则 fallback。
        choices = await asyncio.wait_for(
            _call_model(slot, pages),
            timeout=settings.describe_batch_deadline_seconds,
        )
    except (SelectTemplateError, asyncio.TimeoutError) as exc:
        log.warning("select_template.fallback", reason=str(exc), pages=len(pages))
        return _fallback_pages(pages)
    except Exception as exc:  # noqa: BLE001 —— 绝不让本环节硬失败而连累预览
        log.warning("select_template.fallback_unhandled", reason=str(exc), pages=len(pages))
        return _fallback_pages(pages)

    out: list[dict[str, Any]] = []
    fell_back = 0
    for i, page in enumerate(pages):
        chosen = choices.get(page.page_id)
        # 防幻觉:选择必须是【本页】合法候选之一。任何缺失 / 集外的都降级为本页的确定性
        # 挑选 —— 模型绝无法注入非法或跨页的 templateId。
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
