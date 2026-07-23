"""compose agent:用户选完设计后的一次性成稿(章节文案 + 封面封尾文案 + 字体)。"""

from __future__ import annotations

from .handler import compose_chapter, compose_global
from .schema import ComposeChapterResult, ComposeGlobalResult

__all__ = [
    "compose_chapter",
    "compose_global",
    "ComposeChapterResult",
    "ComposeGlobalResult",
]
