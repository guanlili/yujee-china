"""根据分章中间结果组装 Stage1 V3 layout tree。"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence

from ..layout import accent_color
from ....contracts.schemas import (
    V3AnalyzePhoto,
    V3Chapter,
    V3ChapterPhoto,
    V3LayoutTree,
)
from .schema import GroupingResult, UnplacedAssignments


# 无任何 EXIF 时间时的章标识回退文案;重名消歧也认这个常量。
NO_TIME_LABEL = "这一段"


def deterministic_chapter_label(
    *, taken_ats: Sequence[str], places: Sequence[str]
) -> str:
    """章标题的确定性派生:时间跨度(最早日 – 最晚日)+ 最常见地名。

    砍掉豆包识图后章不再有 AI 命名,这是 story 环节聊天卡片和 compose 环节上下文
    唯一的章标识。写出跨度而非只写年月,是为了让同月的两章天然可区分。

    注意:唯一调用点 `assemble_stage1_tree` 恒传 `places=[]` —— §3 隐私口径下坐标
    止步于浏览器,分析期拿不到地名,地名要到采访环节才写回 `chapter.place`。这个
    参数是留给后续拿到地名后重算标签的占位。

    同月同日仍可能撞名(同一天拍的两章),最终去重由 `assemble_stage1_tree` 里的
    重复标签消歧兜底。
    """
    place = Counter(p for p in places if p).most_common(1)
    place_part = place[0][0] if place else ""
    time_part = _time_span_label(taken_ats)
    parts = [p for p in (time_part, place_part) if p]
    return " · ".join(parts) if parts else NO_TIME_LABEL


def _time_span_label(taken_ats: Sequence[str]) -> str:
    """把一组 ISO 时间戳压成中文日期跨度,如 `2024 年 03 月 11–14 日`。"""
    stamps = sorted(t for t in taken_ats if t)
    if not stamps:
        return ""
    first, last = stamps[0][:10], stamps[-1][:10]
    fy, fm, fd = first[:4], first[5:7], first[8:10]
    ly, lm, ld = last[:4], last[5:7], last[8:10]
    if first == last:
        return f"{fy} 年 {fm} 月 {fd} 日"
    if (fy, fm) == (ly, lm):
        return f"{fy} 年 {fm} 月 {fd}–{ld} 日"
    if fy == ly:
        return f"{fy} 年 {fm} 月 {fd} 日 – {lm} 月 {ld} 日"
    return f"{fy} 年 {fm} 月 {fd} 日 – {ly} 年 {lm} 月 {ld} 日"


def _disambiguate_labels(labels: Sequence[str]) -> list[str]:
    """给重复的章标识追加序号,保证同一棵树里章标识两两不同。

    首个保持原样,后续依次 `… · 第 2 段`;无时间的回退标识用 `这一段 2`。
    """
    used: set[str] = set()
    seen: Counter[str] = Counter()
    result: list[str] = []
    for label in labels:
        seen[label] += 1
        ordinal = seen[label]
        candidate = label if ordinal == 1 else _with_ordinal(label, ordinal)
        while candidate in used:
            ordinal += 1
            candidate = _with_ordinal(label, ordinal)
        used.add(candidate)
        result.append(candidate)
    return result


def _with_ordinal(label: str, ordinal: int) -> str:
    if label == NO_TIME_LABEL:
        return f"{NO_TIME_LABEL} {ordinal}"
    return f"{label} · 第 {ordinal} 段"


def assemble_stage1_tree(
    grouping: GroupingResult,
    assignments: UnplacedAssignments,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
) -> V3LayoutTree:
    if not grouping.chapters:
        raise ValueError("Stage1 grouping produced no chapters")

    input_index = {photo_id: idx for idx, photo_id in enumerate(photos_by_id)}
    chapter_members = {
        chapter.chapterId: list(chapter.photoIds) for chapter in grouping.chapters
    }
    target_ids = set(chapter_members)
    unplaced = set(grouping.unplacedPhotoIds)
    assigned_ids = set(assignments.assignments)

    missing = sorted(unplaced - assigned_ids)
    unknown = sorted(assigned_ids - unplaced)
    if missing or unknown:
        raise ValueError(
            f"unplaced assignments must cover exactly unplaced photos "
            f"(missing={missing}, unknown={unknown})"
        )
    for photo_id, chapter_id in assignments.assignments.items():
        if chapter_id not in target_ids:
            raise ValueError(f"unplaced assignment target does not exist: {chapter_id}")
        chapter_members[chapter_id].append(photo_id)

    seen: list[str] = []
    for chapter_id, members in chapter_members.items():
        members.sort(key=lambda pid: _photo_order(pid, photos_by_id, input_index))
        chapter_members[chapter_id] = members
        seen.extend(members)

    expected = set(photos_by_id)
    if set(seen) != expected or len(seen) != len(set(seen)):
        missing = sorted(expected - set(seen))
        duplicated = sorted(pid for pid in set(seen) if seen.count(pid) > 1)
        unknown = sorted(set(seen) - expected)
        raise ValueError(
            "Stage1 tree membership must cover each input photo exactly once "
            f"(missing={missing}, duplicated={duplicated}, unknown={unknown})"
        )

    chapters: list[V3Chapter] = []
    for source in grouping.chapters:
        members = chapter_members[source.chapterId]
        if not members:
            continue
        photos: list[V3ChapterPhoto] = []
        for photo_id in members:
            src = photos_by_id[photo_id]
            photos.append(
                V3ChapterPhoto(
                    photoId=photo_id,
                    # 砍掉豆包识图后不再有逐图场景描述,分析期恒为空串。
                    sceneDescription="",
                    width=src.width,
                    height=src.height,
                    orientation=_orientation(src.width, src.height),  # type: ignore[arg-type]
                    # 构图也是识图产物,没有识图就交给排版按朝向自行匹配。
                    composition=None,
                    takenAt=src.exif.takenAt if src.exif else None,
                )
            )
        chapters.append(
            V3Chapter(
                chapterId=source.chapterId,
                # 章标识:确定性派生(时间跨度 + 地名),落在 title。
                # 重名(同月/同日、或都没 EXIF)在下面统一消歧。
                # description 是写目录(TOC)环节的位置,分析期保持默认空串。
                title=deterministic_chapter_label(
                    taken_ats=[p.takenAt or "" for p in photos],
                    # 地名由 Web 采访环节写回 chapter.place,分析期无地名可用(§3 隐私:
                    # 坐标止步于浏览器,EXIF 只带 takenAt)。
                    places=[],
                ),
                # 关键词此前来自识图分章,砍掉后分析期为空,设计环节自行降级。
                keywords=[],
                extractedColor=accent_color.accent_of_group(members, photos_by_id),
                accentColor=None,
                artFont=None,
                photos=photos,
            )
        )

    if not chapters:
        raise ValueError("Stage1 tree produced no non-empty chapters")

    # Web 侧只在 title 为空串时才降级(description → `Group N`),重名章会让用户看到
    # 一串无法区分的标题,所以这里保证同一棵树内章标识两两不同。
    for chapter, label in zip(chapters, _disambiguate_labels([c.title for c in chapters])):
        chapter.title = label
    return V3LayoutTree(chapters=chapters)


def _orientation(width: int, height: int) -> str:
    if width > height * 1.05:
        return "landscape"
    if height > width * 1.05:
        return "portrait"
    return "square"


def _photo_order(
    photo_id: str,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
    input_index: Mapping[str, int],
) -> tuple[int, str, int]:
    photo = photos_by_id[photo_id]
    taken_at = photo.exif.takenAt if photo.exif and photo.exif.takenAt else ""
    return (0 if taken_at else 1, taken_at, input_index.get(photo_id, len(input_index)))
