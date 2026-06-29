"""story agent 的模型输出结构别名。

当前章节故事仍复用 V3 contract schema。这个文件先占住 agent 输出结构的位置,
后续接 agent loop 时把 tool-call / final-answer 的结构化 schema 放在这里。
"""

from __future__ import annotations

from ...schemas import V3ChapterChatKind, V3ChapterChatResponse

StoryTurnKind = V3ChapterChatKind
StoryTurnResponse = V3ChapterChatResponse

__all__ = ["StoryTurnKind", "StoryTurnResponse"]
