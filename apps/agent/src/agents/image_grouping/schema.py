"""Stage1 grouping contract."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GroupingChapter:
    chapterId: str
    photoIds: list[str]


@dataclass(frozen=True)
class GroupingResult:
    chapters: list[GroupingChapter]
    unplacedPhotoIds: list[str]
