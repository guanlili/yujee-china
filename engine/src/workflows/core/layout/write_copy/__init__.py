"""排版选定之后,把章节文案写进每页文字槽的 agent。"""

from __future__ import annotations

from .handler import write_copy
from .schema import WriteCopyResult

__all__ = ["write_copy", "WriteCopyResult"]
