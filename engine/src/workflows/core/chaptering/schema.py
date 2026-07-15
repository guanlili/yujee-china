"""Stage1 分章中间结构契约。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class GroupingChapter:
    chapterId: str
    photoIds: list[str]


@dataclass(frozen=True)
class GroupingResult:
    chapters: list[GroupingChapter]
    unplacedPhotoIds: list[str]


@dataclass(frozen=True)
class NewChapter:
    chapterId: str
    photoIds: list[str]
    chapterTitleHint: str
    chapterKeywords: list[str]
    chapterVisualSummary: str
    # 目录(TOC)占位:新建章节也不写 description,后期写目录才填。
    description: str = ""


@dataclass(frozen=True)
class GroupingParams:
    # 有拍摄时间的照片:相邻间隔 >48h 才开新簇。
    timeGapDays: float = 2.0
    exportGapHours: float = 48.0
    placeKm: float = 200.0
    # 簇内快速通道:相邻拍摄间隔 ≤2h 且浏览器测算的共址 clusterId 相同(非空)的
    # 照片直接成组,不进 CLIP+颜色子分组。
    directGapHours: float = 2.0
    alphaIn: float = 0.45
    tauIn: float = 0.86
    alphaOut: float = 0.45
    tauOut: float = 0.72
    miscMin: int = 2
    # 每个时间/地点簇都进 CLIP+颜色子分组:≥3 张即拆,2 张的簇保持一起。
    subsplitMin: int = 3
    clipMinPhotos: int = 3
    # 0/None = 有几个簇就并发跑几个(不封顶);>0 时作为并发上限。
    visualConcurrency: int = 0

    @classmethod
    def from_input(cls, value: Any) -> "GroupingParams":
        if value is None:
            return cls()
        if isinstance(value, cls):
            return value
        if isinstance(value, dict):
            data = value
        elif hasattr(value, "model_dump"):
            data = value.model_dump(exclude_none=True)
        else:
            data = {
                key: getattr(value, key)
                for key in cls.__dataclass_fields__
                if getattr(value, key, None) is not None
            }
        merged = {**cls().__dict__, **{k: v for k, v in data.items() if v is not None}}
        return cls(**merged)


@dataclass(frozen=True)
class UnplacedAssignments:
    assignments: dict[str, str]
    newChapters: list[NewChapter] = field(default_factory=list)
