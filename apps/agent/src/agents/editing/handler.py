"""兼容入口:旧 editing handler 路径转发到 story flow。"""

from __future__ import annotations

from ...agents.tools.layout import gemini_layout
from ...story.flow import *  # noqa: F403 - 兼容历史 import 面
