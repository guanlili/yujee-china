"""章节描述 Agent: 给已分好的章节写摘要、关键词和标题提示。"""

from __future__ import annotations

from ..vision_error import VisionError
from .handler import describe_chapters
from .schema import DescribeResult

__all__ = ["DescribeResult", "VisionError", "describe_chapters"]
