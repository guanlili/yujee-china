"""兼容 package:旧 editing 入口按需转发到 story flow。"""

from __future__ import annotations


def __getattr__(name: str):  # noqa: ANN202 - Python module lazy export hook
    if name in {"EditChatError", "run"}:
        from .handler import EditChatError, run

        return {"EditChatError": EditChatError, "run": run}[name]
    raise AttributeError(name)


__all__ = ["EditChatError", "run"]
