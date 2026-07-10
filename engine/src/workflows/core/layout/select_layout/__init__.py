"""排版评委 Agent——统一真图缩略图逻辑。

代码随机生成候选,浏览器渲染真图缩略图,评委看图选最佳(`judge_layout_thumbnails`,
gemini 优先、豆包兜底);单页换版式复用同一评委(`judge_page_template`)。
"""

from __future__ import annotations

from .handler import judge_layout_thumbnails, judge_page_template, judge_thumbnails_batch
from .schema import GeminiLayoutUnavailable, LayoutBatchJudgeResult, LayoutJudgeResult

__all__ = [
    "GeminiLayoutUnavailable",
    "LayoutBatchJudgeResult",
    "LayoutJudgeResult",
    "judge_layout_thumbnails",
    "judge_page_template",
    "judge_thumbnails_batch",
]
