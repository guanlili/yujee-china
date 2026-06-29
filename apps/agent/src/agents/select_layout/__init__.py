"""排版选模板 Agent: 给已分好的章节,让 Gemini 每页选模板并把照片映射到图槽。"""

from __future__ import annotations

from .handler import gemini_layout
from .schema import GeminiLayoutResult, GeminiLayoutUnavailable

__all__ = ["GeminiLayoutResult", "GeminiLayoutUnavailable", "gemini_layout"]
