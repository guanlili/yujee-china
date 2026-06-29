"""兼容入口:旧 editing handler 路径转发到 story flow。"""

from __future__ import annotations

from ...agents.tools import layout as _layout_tool
from ...story.flow import *  # noqa: F403 - 兼容历史 import 面

# 旧测试/旧调用方曾通过 edit_handler.select_layout_agent monkeypatch 版式模型。
# story flow 实际调用的是 agents.tools.layout.select_layout_agent;这里暴露同一个
# module object,保证 monkeypatch 仍能影响真实执行路径。
select_layout_agent = _layout_tool.select_layout_agent
