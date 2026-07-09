"""排版选模板 Agent。

P1 新逻辑:代码随机生成 N 个整章候选,Gemini 当评委选最佳(`judge_layout`)。
旧的「Gemini 直接排版」(`gemini_layout`)暂保留给 case4-swap 迁移期。
"""

from __future__ import annotations

from .handler import gemini_layout, judge_layout, judge_layout_doubao, judge_layout_thumbnails
from .schema import GeminiLayoutResult, GeminiLayoutUnavailable, LayoutJudgeResult

__all__ = [
    "GeminiLayoutResult",
    "GeminiLayoutUnavailable",
    "LayoutJudgeResult",
    "gemini_layout",
    "judge_layout",
    "judge_layout_doubao",
    "judge_layout_thumbnails",
]
