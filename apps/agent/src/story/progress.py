"""章节故事进度推进规则。

AI 可以参与写作与编辑,但是否推进到下一环节必须由业务层的明确规则产出。
"""

from __future__ import annotations

from ..schemas import V3EditChatRequest, V3EditProgressDecision

CONFIRM_CHAPTER_COMMAND = "[confirm-chapter]"
_CONFIRM_CHAPTER_MESSAGES = {CONFIRM_CHAPTER_COMMAND}


def wants_chapter_done(req: V3EditChatRequest) -> bool:
    if not req.focus.chapterId:
        return False
    return req.userMessage.strip().lower() in _CONFIRM_CHAPTER_MESSAGES


def chapter_done_decision() -> V3EditProgressDecision:
    return V3EditProgressDecision(chapterDone=True, advanceTo="theme")


__all__ = ["CONFIRM_CHAPTER_COMMAND", "chapter_done_decision", "wants_chapter_done"]
