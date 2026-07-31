"""回调失败必须留下可诊断的错误描述。

回归:回调用 `error=str(exc)` 记日志,而 httpx 的超时/连接异常 `str()` 是**空字符串**
(ReadTimeout('') → ''),于是 web 慢到撞 10s 超时时,日志里只剩

    {"error": "", "attempt": 1, "event": "callback.error"}

三次重试全这样,然后 callback.giveup —— Agent 明明算完了(select_layout.completed
pages=9),结果却送不回 Web,前端一直转圈。而唯一的线索被 str(exc) 吞掉,查不出是超时
还是连不上。异常类型名必须留下。
"""

import httpx
import pytest

from src.api.callback import _describe_exc


@pytest.mark.parametrize(
    "exc",
    [
        httpx.ReadTimeout(""),
        httpx.ConnectTimeout(""),
        httpx.ConnectError(""),
        httpx.WriteTimeout(""),
        httpx.PoolTimeout(""),
    ],
)
def test_describe_exc_never_empty_for_message_less_httpx_errors(exc):
    """httpx 这几个异常 str() 为空,描述里至少要有类型名。"""
    assert str(exc) == "", "前提:这些异常的 str() 本来就是空的"
    described = _describe_exc(exc)
    assert described, f"{type(exc).__name__} 的描述不能是空串"
    assert type(exc).__name__ in described, f"描述里必须有类型名,实际: {described!r}"


def test_describe_exc_keeps_message_when_present():
    """有消息时类型名和消息都要在。"""
    described = _describe_exc(httpx.ConnectError("connection refused"))
    assert "ConnectError" in described
    assert "connection refused" in described


def test_describe_exc_distinguishes_timeout_from_refused():
    """超时和连不上必须在日志里能区分开 —— 两者的处置完全不同。"""
    timeout = _describe_exc(httpx.ReadTimeout(""))
    refused = _describe_exc(httpx.ConnectError(""))
    assert timeout != refused
