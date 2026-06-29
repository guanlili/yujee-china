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
    description: str
    chapterTitleHint: str
    chapterKeywords: list[str]
    chapterVisualSummary: str


@dataclass(frozen=True)
class GroupingParams:
    timeGapDays: float = 7.0
    exportGapHours: float = 48.0
    placeKm: float = 200.0
    alphaIn: float = 0.45
    tauIn: float = 0.86
    alphaOut: float = 0.45
    tauOut: float = 0.72
    miscMin: int = 2
    subsplitMin: int = 5
    # 时间维度拆出的小章节 <=10 张时不进 CLIP,直接进入后续章节描述。
    clipMinPhotos: int = 11
    # 多个时间组可并发做视觉子分组,但默认不把单台 CLIP worker 打满。
    visualConcurrency: int = 3

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
