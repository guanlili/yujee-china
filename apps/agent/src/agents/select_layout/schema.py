"""Stage2 排版选模板 agent 的输出结构。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class GeminiLayoutUnavailable(Exception):
    """Raised when the Gemini layout provider is not configured or failed."""


@dataclass(frozen=True)
class GeminiLayoutResult:
    pages: list[dict[str, Any]]
    call_count: int = 0
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
