"""group_pages agent:识图分析后,AI 按画面效果重分章内页(确定性当参考 + 兜底)。"""

from __future__ import annotations

from .handler import GroupPagesError, group_chapter_pages

__all__ = ["GroupPagesError", "group_chapter_pages"]
