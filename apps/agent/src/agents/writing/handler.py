"""兼容入口:旧 writing handler 路径直接别名到 story handler 模块。"""

from __future__ import annotations

import sys

from ..story import handler as _story_handler

sys.modules[__name__] = _story_handler
