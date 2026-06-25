"""V3 select-template:确定性页面规划 helper(WP1.4 / #183 的纯代码部分)。

【重构(统一识图调用)】:读图 + 分章 + 选模板分页已合并进 image_understanding 的【一次】
识图调用 —— 选模板=分页,不再有独立的 select-template LLM 调用。原先这里的 LLM 编排
(`_call_model` / `_select_slot` / `_parse_choices` / `_build_user_content` / `select_template.md`)
已删除;识图模型出的每页 templateId 由 image_understanding 在调用后用 `skeleton_v3` 的确定性
护栏(逐页 `legal_candidates` clamp + 逐章 `validate_grouping` + `partition_photos_v3` 基线兜底)
保证合法(§8.3「模型出意图、确定性引擎保合法」)。

本模块保留的是纯代码的页面规划 helper:把章节切成逐页 chunk,并为每页配上其【合法】候选集
(`skeleton_v3.legal_candidates`)。它建在 WP0.4 确定性引擎(`skeleton_v3`)之上:

  * 章节树被切成逐页 chunk,每个不大于 interior 类别最大的模板
    (`skeleton_v3.partition_photos_v3`)。每个 chunk 恰好变成一个 interior 页。
  * 对每页用 `skeleton_v3.legal_candidates("interior", N)` 算出其合法候选集。
  * 任何地方都不做质量 / hero / 朝向匹配;照片按声明顺序摆进槽。
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from ...schemas import V3Chapter
from ...engine import skeleton_v3


# 本环节每页都是 interior 正文页(cover/toc/ending 归后续 WP 所有);因此候选池始终是
# interior 类别。
_INTERIOR: skeleton_v3.Category = "interior"


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
    `pageId` 是一个稳定句柄。"""

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
    """该章的逐页照片 chunk:给了分组就按它重建(photoId→照片对象),否则走确定性分页
    (`partition_photos_v3`)。分组上游已用 `validate_grouping` 校验过(不丢不重保序);这里
    再 try 防御 —— 任何 id 对不上立刻退确定性分页。"""
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

    分页来源:给了 `grouping` 就用它,否则确定性 `partition_photos_v3`。没有照片的章节被跳过
    (一章绝不产出空页)。"""
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


def fallback_pages(pages: Sequence[_PlannedPage]) -> list[dict[str, Any]]:
    """对规划好的页做纯代码 §9 fallback:逐页 `pick_template_v3` 挑一个能容纳其照片的模板
    (优先恰好容量,否则最接近的更大),`build_page_v3` 按声明顺序摆进去。不做质量/hero/朝向
    匹配。这正是 `build_skeleton_v3` 对同一切分产出的结果 —— 作为一个专用 helper 保留。"""
    return [
        skeleton_v3.build_page_v3(
            _INTERIOR, [_photo_id(p) for p in page.photos], page_index=i
        )
        for i, page in enumerate(pages)
    ]
