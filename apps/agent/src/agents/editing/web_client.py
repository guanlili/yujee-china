"""兼容入口:旧 editing web client 路径直接别名到 story web client 模块。"""

from __future__ import annotations

import sys

from ...story import web_client as _web_client

sys.modules[__name__] = _web_client
