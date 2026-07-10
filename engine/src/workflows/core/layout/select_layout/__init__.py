"""排版选模板 Agent。

代码随机生成 N 个整章候选,LLM 评委选最佳:生产走豆包(`judge_layout_doubao`),
另有 gemini 评委(`judge_layout` / `judge_layout_thumbnails`)。
"""

from __future__ import annotations

from .handler import judge_layout, judge_layout_doubao, judge_layout_thumbnails, judge_page_template
from .schema import GeminiLayoutUnavailable, LayoutJudgeResult

__all__ = [
    "GeminiLayoutUnavailable",
    "LayoutJudgeResult",
    "judge_layout",
    "judge_layout_doubao",
    "judge_layout_thumbnails",
    "judge_page_template",
]
