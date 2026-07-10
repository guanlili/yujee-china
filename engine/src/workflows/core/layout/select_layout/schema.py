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


@dataclass(frozen=True)
class LayoutBatchJudgeResult:
    """一次会话里逐单元判图的结果:winners[i] = 第 i 个输入单元的最佳候选 index。

    多个章节单元(有些章一共就两三页)合并进同一次评委会话,省掉逐章开会话的
    往返与重复 system prompt;usage 归属整批。"""

    winners: list[int]
    call_count: int = 0
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
