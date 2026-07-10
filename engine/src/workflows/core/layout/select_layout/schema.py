"""Stage2 排版选模板 agent 的输出结构。"""

from __future__ import annotations

from dataclasses import dataclass


class GeminiLayoutUnavailable(Exception):
    """Raised when the layout judge provider is not configured or failed."""


@dataclass(frozen=True)
class LayoutJudgeResult:
    """LLM 评委从 N 个代码随机候选里选出的最佳候选 index。"""

    winner_index: int
    call_count: int = 0
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
